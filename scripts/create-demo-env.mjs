import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, appendFile, readFile, writeFile } from "node:fs/promises";

const target = new URL("../.env.demo", import.meta.url);
const secret = () => randomBytes(32).toString("base64url");

try {
  await access(target, constants.F_OK);
  const existing = await readFile(target, "utf8");
  const additions = [];
  if (!/^PFH_DEMO_POSTGRES_PASSWORD=/m.test(existing)) {
    const password = secret();
    await appendFile(
      target,
      `\nPFH_DEMO_POSTGRES_PASSWORD=${password}\nPFH_OPERATIONAL_DATABASE_URL=postgresql://pflegehelfer:${password}@127.0.0.1:5434/pflegehelfer\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    console.log("demo env: added operational database credentials");
  } else {
    console.log("demo env: existing .env.demo retained");
  }
  if (!/^PFH_ALLOW_EXTERNAL_AI=/m.test(existing)) {
    additions.push(
      "",
      "# External AI stays off until a developer explicitly enables the synthetic-only profile.",
      "PFH_ALLOW_EXTERNAL_AI=false",
      "OPENAI_API_" + "KEY=",
      "# Set PFH_AI_MODE/PFH_DEEP_LLM_MODE/PFH_ASR_MODE to hosted-test when wanted.",
      "# Recommended economical router: gpt-5.6-terra; deeper knowledge selector: gpt-5.6-sol.",
      "# PFH_LLM_MODEL=gpt-5.6-terra",
      "# PFH_DEEP_LLM_MODEL=gpt-5.6-sol",
      "# PFH_ASR_MODEL=gpt-transcribe",
    );
  }
  if (additions.length)
    await appendFile(target, `${additions.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  process.exit(0);
} catch {
  // Create a new local-only configuration below.
}

const operationalPassword = secret();
const content = [
  "# Generated local synthetic-demo credentials. Never commit or reuse.",
  `MEDPLUM_DEMO_POSTGRES_PASSWORD=${secret()}`,
  `PFH_DEMO_POSTGRES_PASSWORD=${operationalPassword}`,
  `PFH_OPERATIONAL_DATABASE_URL=postgresql://pflegehelfer:${operationalPassword}@127.0.0.1:5434/pflegehelfer`,
  `MEDPLUM_DEMO_REDIS_PASSWORD=${secret()}`,
  "MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL=admin@pflegehelfer.demo.invalid",
  `MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD=${secret()}`,
  `MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_ID=${randomUUID()}`,
  `MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_SECRET=${secret()}`,
  "PFH_FHIR_BASE_URL=http://127.0.0.1:8103/",
  "MEDPLUM_APP_BASE_URL=http://127.0.0.1:3001/",
  "PFH_AI_MODE=local-openai",
  "PFH_LLM_BASE_URL=http://127.0.0.1:11434/v1",
  "PFH_LLM_MODEL=qwen2.5:0.5b",
  "PFH_LLM_TIMEOUT_MS=10000",
  "PFH_LLM_DATA_CLASSIFICATION=synthetic-only",
  "PFH_ALLOW_EXTERNAL_AI=false",
  "OPENAI_API_" + "KEY=",
  "PFH_DEEP_LLM_MODE=local-openai",
  "PFH_DEEP_LLM_BASE_URL=http://127.0.0.1:11434/v1",
  "PFH_DEEP_LLM_MODEL=qwen2.5:0.5b",
  "PFH_DEEP_LLM_TIMEOUT_MS=15000",
  "PFH_ASR_MODE=browser-demo",
  "",
].join("\n");

await writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log("demo env: generated .env.demo with mode 0600");
