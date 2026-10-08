import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([
  ".git",
  // Generated, git-ignored local runtime secrets are expected to contain
  // credentials. The tracked .env.example remains in scope.
  ".env.demo",
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
      // psql's :'name' form is an escaped runtime variable, not a literal.
      // Normalize it before scanning assignments so secure role bootstrap SQL
      // does not need to interpolate a credential into tracked source.
      const credentialScanContent = content.replace(
        /:'[A-Za-z_][A-Za-z0-9_]*'/g,
        ":__runtime_parameter__",
      );
      const checks = [
        [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
        [
          /(?:password|client_secret|api_key)\s*[:=]\s*["'][^"']{8,}["']/i,
          "hard-coded credential",
        ],
        [/\bsk-[A-Za-z0-9_-]{20,}\b/, "API token"],
      ];
      for (const [pattern, label] of checks)
        if (
          pattern.test(
            label === "hard-coded credential" ? credentialScanContent : content,
          )
        )
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
