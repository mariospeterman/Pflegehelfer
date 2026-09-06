import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "artifacts",
  "test-results",
]);
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const content = await readFile(path, "utf8").catch(() => "");
      const checks = [
        [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
        [
          /(?:password|client_secret|api_key)\s*[:=]\s*["'][^"']{8,}["']/i,
          "hard-coded credential",
        ],
        [/\bsk-[A-Za-z0-9_-]{20,}\b/, "API token"],
      ];
      for (const [pattern, label] of checks)
        if (pattern.test(content))
          findings.push(`${relative(root, path)}: ${label}`);
    }
  }
}

await walk(root);
const server = await readFile(join(root, "src/server/app.ts"), "utf8");
for (const header of [
  "Content-Security-Policy",
  "Cache-Control",
  "Permissions-Policy",
  "X-Content-Type-Options",
]) {
  if (!server.includes(header))
    findings.push(`missing security header: ${header}`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "security-check: no embedded secrets detected; required response headers present",
  );
