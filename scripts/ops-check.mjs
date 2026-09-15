import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../dist/src/server/app.js";

const app = buildApp(undefined, { demoMode: true });
const health = await app.inject({ method: "GET", url: "/health" });
const ready = await app.inject({ method: "GET", url: "/ready" });
if (health.statusCode !== 200 || ready.json().auditValid !== true)
  throw new Error("health/readiness check failed");
const snapshot = await app.inject({
  method: "GET",
  url: "/api/v1/snapshot",
  headers: { "x-demo-user": "u-it" },
});
const directory = await mkdtemp(join(tmpdir(), "pflegehelfer-restore-test-"));
const backupPath = join(directory, "synthetic-operational-backup.json");
await writeFile(backupPath, snapshot.body, { mode: 0o600 });
const restored = await readFile(backupPath, "utf8");
const before = createHash("sha256").update(snapshot.body).digest("hex");
const after = createHash("sha256").update(restored).digest("hex");
if (before !== after || JSON.parse(restored).currentUser.role !== "it")
  throw new Error("restore integrity check failed");
await app.close();
console.log(
  `ops-check: health/readiness valid; synthetic backup restore checksum ${after.slice(0, 12)} verified`,
);
