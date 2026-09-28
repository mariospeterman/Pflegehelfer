import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { AsrGateway } from "../src/ai/asr-gateway.js";
import {
  parseSiteConfiguration,
  ROLE_ACTION_CEILINGS,
} from "../src/core/site-config.js";
import {
  defaultDirectorySitePackPath,
  loadRuntimeSitePack,
  validateRuntimeSitePackBindings,
} from "../src/core/runtime-instructions.js";
import {
  loadMigrationFiles,
  verifyMigrationHistory,
  type MigrationHistoryRow,
} from "../src/infrastructure/migrations.js";

const [group = "help", action = "", ...arguments_] = process.argv.slice(2);
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
else if (group === "migrations" && action === "status") {
  const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
  if (!databaseUrl)
    throw new Error("PFH_OPERATIONAL_DATABASE_URL ist nicht konfiguriert.");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const migrations = await loadMigrationFiles();
    const history = await pool.query<MigrationHistoryRow>(
      `SELECT version,name,checksum,provenance FROM pfh_migration_history
       ORDER BY version`,
    );
    verifyMigrationHistory(
      migrations,
      history.rows,
      process.env.PFH_DEMO_MODE === "true",
    );
    console.log(
      JSON.stringify(
        {
          status: history.rows.some(
            ({ provenance }) => provenance === "legacy-unverified",
          )
            ? "DEMO_LEGACY_ATTESTATION"
            : "VERIFIED",
          migrations: history.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
} else if (group === "provider" && action === "list") {
  const [production, simulators] = await Promise.all([
    request("/api/v1/providers/registry?profile=production"),
    request("/api/v1/providers/registry?profile=synthetic-simulator"),
  ]);
  console.log(JSON.stringify({ production, simulators }, null, 2));
} else if (group === "provider" && action === "test") {
  const result = (await request(
    "/api/v1/providers/registry?profile=synthetic-simulator",
  )) as { providers?: Array<{ health?: { status?: string } }> };
  console.log(JSON.stringify(result, null, 2));
  if (
    !result.providers?.length ||
    result.providers.some(({ health }) => health?.status !== "available")
  )
    process.exitCode = 1;
} else if (group === "clinical-projection" && action === "manual-head")
  console.log(
    JSON.stringify(
      await request("/api/v1/operations/clinical-projections/manual-head"),
      null,
      2,
    ),
  );
else if (group === "clinical-projection" && action === "retry") {
  const [jobId, expectedErrorCode] = arguments_;
  if (!jobId || !expectedErrorCode)
    throw new Error(
      "Usage: pfhctl clinical-projection retry <job-id> <expected-error-code>",
    );
  console.log(
    JSON.stringify(
      await request(`/api/v1/operations/clinical-projections/${jobId}/retry`, {
        method: "POST",
        body: JSON.stringify({ expectedErrorCode }),
      }),
      null,
      2,
    ),
  );
} else if (group === "demo" && ["status", "list"].includes(action))
  console.log(JSON.stringify(await request("/api/v1/admin/demo"), null, 2));
else if (group === "demo" && action === "export") {
  const outputPath =
    arguments_[0] ?? `pflegehelfer-scenario-${Date.now()}.json`;
  const bundle = await request("/api/v1/admin/demo/export");
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({ status: "exported", outputPath }, null, 2));
} else if (group === "demo" && action === "import") {
  const inputPath = arguments_[0];
  if (!inputPath) throw new Error("Usage: pfhctl demo import <export.json>");
  const bundle = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  console.log(
    JSON.stringify(
      await request("/api/v1/admin/demo/import", {
        method: "POST",
        body: JSON.stringify(bundle),
      }),
      null,
      2,
    ),
  );
} else if (group === "demo" && action === "clone") {
  const [label, clockMode = "frozen", source = "current"] = arguments_;
  if (!label)
    throw new Error(
      'Usage: pfhctl demo clone "Label" [frozen|start-today] [current|baseline]',
    );
  console.log(
    JSON.stringify(
      await request("/api/v1/admin/demo/runs", {
        method: "POST",
        body: JSON.stringify({ label, clockMode, source }),
      }),
      null,
      2,
    ),
  );
} else if (group === "demo" && action === "apply") {
  const [resource, inputPath] = arguments_;
  if (
    !resource ||
    !inputPath ||
    !["patients", "staff", "tasks", "assignments"].includes(resource)
  )
    throw new Error(
      "Usage: pfhctl demo apply patients|staff|tasks|assignments <input.json>",
    );
  const body = await readFile(inputPath, "utf8");
  console.log(
    JSON.stringify(
      await request(`/api/v1/admin/demo/${resource}`, {
        method: "POST",
        body,
      }),
      null,
      2,
    ),
  );
} else if (group === "demo" && action === "event") {
  const eventId = arguments_[0];
  if (!eventId) throw new Error("Usage: pfhctl demo event <event-id>");
  console.log(
    JSON.stringify(
      await request(
        `/api/v1/admin/demo/events/${encodeURIComponent(eventId)}`,
        {
          method: "POST",
          body: "{}",
        },
      ),
      null,
      2,
    ),
  );
} else if (group === "demo" && action === "reset-preview") {
  const runId = arguments_[0];
  if (!runId) throw new Error("Usage: pfhctl demo reset-preview <run-id>");
  console.log(
    JSON.stringify(
      await request(
        `/api/v1/admin/demo/runs/${encodeURIComponent(runId)}/reset-preview`,
      ),
      null,
      2,
    ),
  );
} else if (
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
else if (group === "model" && action === "test") {
  const result = await request("/api/v1/ai/model-test", {
    method: "POST",
    body: "{}",
  });
  console.log(JSON.stringify(result, null, 2));
  if (
    !result ||
    typeof result !== "object" ||
    !("ready" in result) ||
    result.ready !== true
  )
    process.exitCode = 1;
} else if (group === "asr" && action === "test") {
  const audioPath = process.env.PFH_ASR_TEST_AUDIO;
  if (!audioPath)
    throw new Error(
      "PFH_ASR_TEST_AUDIO muss auf eine eindeutig synthetische WAV/WebM-Testaufnahme zeigen.",
    );
  const audio = new Uint8Array(await readFile(audioPath));
  const mimeType = audioPath.toLowerCase().endsWith(".wav")
    ? "audio/wav"
    : "audio/webm";
  console.log(
    JSON.stringify(
      await new AsrGateway().transcribe(audio, mimeType, "synthetic-demo"),
      null,
      2,
    ),
  );
} else if (group === "tts" && action === "test") {
  console.log(
    JSON.stringify(
      await request("/api/v1/ai/tts-test", { method: "POST", body: "{}" }),
      null,
      2,
    ),
  );
} else if (group === "site" && action === "validate") {
  const paths =
    arguments_.length > 0
      ? arguments_
      : [defaultDirectorySitePackPath, "config/sites/packs/alpenblick-demo"];
  const validated = paths.map((path) => {
    const pack = loadRuntimeSitePack(path);
    const configuration = parseSiteConfiguration(pack.siteConfigurationInput);
    validateRuntimeSitePackBindings(
      pack,
      configuration,
      new Set(Object.keys(ROLE_ACTION_CEILINGS)),
    );
    return {
      path: pack.sourcePath,
      sourceFormat: pack.sourceFormat,
      packId: pack.packId,
      version: pack.version,
      status: pack.status,
      digest: pack.packDigest,
      site: configuration.displayName,
      instructions: Object.values(pack.instructions).map(
        ({ id, kind, sha256: hash }) => ({ id, kind, sha256: hash }),
      ),
      roleProfiles: Object.values(pack.roles).map(
        ({ id, label, capabilityRole }) => ({ id, label, capabilityRole }),
      ),
      providerInstances: Object.values(pack.providers).map(
        ({ instanceId, adapterType }) => ({ instanceId, adapterType }),
      ),
    };
  });
  console.log(JSON.stringify({ validated }, null, 2));
} else if (group === "backup" && action === "restore-test") {
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, ["scripts/ops-check.mjs"], {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} else {
  console.log(
    'Usage: pfhctl preflight | status | migrations status | provider list|test | clinical-projection manual-head|retry <job-id> <expected-error-code> | demo status|list|export [path]|import <path>|clone "label" [frozen|start-today] [current|baseline]|apply patients|staff|tasks|assignments <path>|event <id>|reset-preview <run-id> | fhir import|verify|validate | model list|test | asr test | tts test | site validate [pack-path ...] | backup restore-test',
  );
  if (group !== "help") process.exitCode = 2;
}
