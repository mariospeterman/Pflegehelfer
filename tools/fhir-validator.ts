import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PflegehelferService } from "../src/core/service.js";

interface LockedArtifact {
  url: string;
  sha256: string;
}

interface ValidatorLock {
  validator: LockedArtifact & { version: string };
  packages: Array<LockedArtifact & { id: string; version: string }>;
}

const action = process.argv[2] ?? "validate";
const cache = resolve(".pfh/fhir-validator");
const lock = JSON.parse(
  await readFile("config/fhir-validator-lock.json", "utf8"),
) as ValidatorLock;
const jar = resolve(cache, `validator-cli-${lock.validator.version}.jar`);
const packageFiles = lock.packages.map((item) =>
  resolve(cache, `${item.id}-${item.version}.tgz`),
);

async function hash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function fetchLocked(artifact: LockedArtifact, destination: string) {
  const response = await fetch(artifact.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== artifact.sha256)
    throw new Error(`Checksum mismatch for ${destination}`);
  await writeFile(destination, bytes, { mode: 0o600 });
}

async function verifyCache() {
  const artifacts: Array<[LockedArtifact, string]> = [
    [lock.validator, jar],
    ...lock.packages.map(
      (item, index) => [item, packageFiles[index]!] as [LockedArtifact, string],
    ),
  ];
  for (const [artifact, path] of artifacts) {
    if (!existsSync(path))
      throw new Error(
        `Missing governed FHIR artifact ${path}; run pfhctl fhir import while connected.`,
      );
    if ((await hash(path)) !== artifact.sha256)
      throw new Error(`FHIR artifact checksum mismatch: ${path}`);
  }
}

if (action === "import") {
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await fetchLocked(lock.validator, jar);
  for (let index = 0; index < lock.packages.length; index += 1)
    await fetchLocked(lock.packages[index]!, packageFiles[index]!);
  await verifyCache();
  console.log("FHIR validator and CH Core packages imported and verified.");
} else if (action === "verify") {
  await verifyCache();
  console.log("FHIR validator cache checksums verified.");
} else if (action === "validate") {
  await verifyCache();
  const input = resolve(cache, "synthetic-resource-bundle.json");
  await writeFile(
    input,
    JSON.stringify({
      resourceType: "Bundle",
      type: "collection",
      entry: new PflegehelferService().fhirResources().map((resource) => ({
        fullUrl: `https://pflegehelfer.example.invalid/fhir/R4/${resource.resourceType}/${resource.id}`,
        resource,
      })),
    }),
    { mode: 0o600 },
  );
  const args = [
    "-jar",
    jar,
    input,
    "-version",
    "4.0.1",
    "-tx",
    "n/a",
    ...packageFiles.flatMap((item) => ["-ig", item]),
  ];
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn("java", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} else {
  throw new Error("Usage: pfhctl fhir import|verify|validate");
}
