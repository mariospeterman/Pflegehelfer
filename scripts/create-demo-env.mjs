import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, writeFile } from "node:fs/promises";

const target = new URL("../.env.demo", import.meta.url);

try {
  await access(target, constants.F_OK);
  console.log("demo env: existing .env.demo retained");
  process.exit(0);
} catch {
  // Create a new local-only configuration below.
}

const secret = () => randomBytes(32).toString("base64url");
const content = [
  "# Generated local synthetic-demo credentials. Never commit or reuse.",
  `MEDPLUM_DEMO_POSTGRES_PASSWORD=${secret()}`,
  `MEDPLUM_DEMO_REDIS_PASSWORD=${secret()}`,
  "MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL=admin@pflegehelfer.demo.invalid",
  `MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD=${secret()}`,
  `MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_ID=${randomUUID()}`,
  `MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_SECRET=${secret()}`,
  "PFH_FHIR_BASE_URL=http://127.0.0.1:8103/",
  "MEDPLUM_APP_BASE_URL=http://127.0.0.1:3001/",
  "PFH_AI_MODE=local-openai",
  "PFH_LLM_BASE_URL=http://127.0.0.1:11434/v1",
  "PFH_LLM_MODEL=llama3:latest",
  "PFH_LLM_TIMEOUT_MS=10000",
  "PFH_LLM_DATA_CLASSIFICATION=synthetic-only",
  "PFH_DEEP_LLM_MODE=local-openai",
  "PFH_DEEP_LLM_BASE_URL=http://127.0.0.1:11434/v1",
  "PFH_DEEP_LLM_MODEL=llama3:latest",
  "PFH_DEEP_LLM_TIMEOUT_MS=15000",
  "PFH_ASR_MODE=browser-demo",
  "",
].join("\n");

await writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log("demo env: generated .env.demo with mode 0600");
