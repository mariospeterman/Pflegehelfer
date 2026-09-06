import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const [group = "help", action = ""] = process.argv.slice(2);
const baseUrl = process.env.PFH_BASE_URL ?? "http://127.0.0.1:4173";

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const isMutation = init?.method?.toUpperCase() === "POST";
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-demo-user": "u-it",
      ...(isMutation ? { "x-command-id": randomUUID() } : {}),
      ...init?.headers,
    },
  });
  const result: unknown = await response.json();
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

if (group === "preflight") {
  const required = [
    "package.json",
    "pnpm-lock.yaml",
    "config/pflegehelfer.schema.json",
    "deploy/helm/pflegehelfer/Chart.yaml",
  ];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length)
    throw new Error(`Fehlende Dateien: ${missing.join(", ")}`);
  JSON.parse(await readFile("config/pflegehelfer.schema.json", "utf8"));
  console.log(
    "preflight: configuration, lockfile and deployment manifests present",
  );
} else if (group === "status")
  console.log(JSON.stringify(await request("/ready"), null, 2));
else if (group === "provider" && action === "list") {
  const [production, simulators] = await Promise.all([
    request("/api/v1/providers/registry?profile=production"),
    request("/api/v1/providers/registry?profile=synthetic-simulator"),
  ]);
  console.log(JSON.stringify({ production, simulators }, null, 2));
} else if (group === "provider" && action === "test")
  console.log(
    JSON.stringify(
      await request("/api/v1/outbox/process", { method: "POST", body: "{}" }),
      null,
      2,
    ),
  );
else if (group === "demo" && action === "reset")
  console.log(
    JSON.stringify(
      await request("/api/v1/demo/reset", { method: "POST", body: "{}" }),
      null,
      2,
    ),
  );
else if (
  group === "fhir" &&
  ["import", "verify", "validate"].includes(action)
) {
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tools/fhir-validator.ts", action],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} else if (group === "model" && action === "list")
  console.log(JSON.stringify(await request("/api/v1/ai/status"), null, 2));
else if (group === "backup" && action === "restore-test")
  console.log(
    "Run `pnpm build && pnpm verify:ops` for the isolated synthetic restore-integrity test.",
  );
else {
  console.log(
    "Usage: pfhctl preflight | status | provider list|test | demo reset | fhir import|verify|validate | model list | backup restore-test",
  );
  if (group !== "help") process.exitCode = 2;
}
