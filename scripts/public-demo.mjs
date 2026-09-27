import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveBuildIdentity } from "./build-identity.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = resolve(ROOT, ".data/public-demo.json");
const LOCAL_API = "http://127.0.0.1:3000";
const LOCAL_PWA = "http://127.0.0.1:5173";
const INSPECTOR_PORTS = [4040, 4041, 4042, 4043, 4044, 4045];
const REQUEST_TIMEOUT_MS = 8_000;
const START_TIMEOUT_MS = 12 * 60_000;

function normalizeDomain(value) {
  const candidate = value?.trim();
  if (!candidate) return null;
  const hostname = candidate.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (
    hostname.includes("/") ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      hostname,
    )
  ) {
    throw new Error(
      "PFH_NGROK_DOMAIN must be a hostname such as assigned-name.ngrok-free.app",
    );
  }
  return hostname.toLowerCase();
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "ngrok-skip-browser-warning": "pflegehelfer-owner-test",
        ...(options.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function isAvailable(url) {
  try {
    return (await request(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(label, probe, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(
    `${label} was not ready within ${Math.round(timeoutMs / 1000)} seconds${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

async function discoverTunnel() {
  for (const port of INSPECTOR_PORTS) {
    try {
      const response = await request(`http://127.0.0.1:${port}/api/tunnels`);
      if (!response.ok) continue;
      const body = await response.json();
      const tunnel = body.tunnels?.find(
        (candidate) =>
          candidate.proto === "https" &&
          /(?:localhost|127\.0\.0\.1):5173\/?$/.test(
            candidate.config?.addr ?? "",
          ),
      );
      if (tunnel?.public_url) {
        return {
          url: tunnel.public_url.replace(/\/$/, ""),
          inspectorPort: port,
        };
      }
    } catch {
      // Try the next local inspector port. Nothing sensitive leaves localhost.
    }
  }
  return null;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function writeManifest(tunnel, stableDomainConfigured) {
  const build = resolveBuildIdentity();
  const manifest = {
    schemaVersion: 1,
    url: tunnel.url,
    inspectorPort: tunnel.inspectorPort,
    stableDomainConfigured,
    startedAt: new Date().toISOString(),
    sourceSha: build.sourceSha,
    buildId: build.buildId,
    dirty: build.dirty,
    runtimeProfile: "integrated-demo",
  };
  await mkdir(resolve(ROOT, ".data"), { recursive: true, mode: 0o700 });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(MANIFEST_PATH, 0o600);
  return manifest;
}

function spawnService(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: options.pipe ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  child.pfhLabel = label;
  if (options.pipe) {
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }
  return child;
}

async function resolvePublicUrl() {
  const live = await discoverTunnel();
  if (live) return live;
  const manifest = await readManifest();
  return manifest?.url ? { url: manifest.url, inspectorPort: null } : null;
}

async function checkPublicDemo() {
  const tunnel = await resolvePublicUrl();
  if (!tunnel) {
    throw new Error(
      "No Pflegehelfer ngrok URL found. Run `pnpm demo:public` first.",
    );
  }

  const rootResponse = await request(`${tunnel.url}/`);
  const rootText = await rootResponse.text();
  const readyResponse = await request(`${tunnel.url}/ready`);
  const buildResponse = await request(`${tunnel.url}/api/v1/build-info`);
  const statusResponse = await request(`${tunnel.url}/api/v1/status`, {
    headers: { "x-demo-user": "u-it" },
  });
  if (
    !rootResponse.ok ||
    !rootText.toLowerCase().includes("pflegehelfer") ||
    !readyResponse.ok ||
    !buildResponse.ok ||
    !statusResponse.ok
  ) {
    throw new Error(
      `Public check failed (PWA ${rootResponse.status}, ready ${readyResponse.status}, build ${buildResponse.status}, status ${statusResponse.status}).`,
    );
  }

  const build = await buildResponse.json();
  const status = await statusResponse.json();
  if (
    build.matchingSource !== true ||
    build.api?.dirty === true ||
    build.pwa?.dirty === true
  ) {
    throw new Error(
      "Public API/PWA build identity is stale or dirty. Commit the intended source, rebuild/restart API and PWA, then check again.",
    );
  }
  const report = {
    checkedAt: new Date().toISOString(),
    url: tunnel.url,
    pwa: "ready",
    api: status.api,
    build,
    stores: status.stores,
    model: status.ai?.model,
    asr: status.ai?.asr,
    tts: status.ai?.tts,
    providers: status.providers,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function startPublicDemo() {
  const domain = normalizeDomain(process.env.PFH_NGROK_DOMAIN);
  const infra = spawnSync("pnpm", ["dev:infra"], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (infra.status !== 0)
    throw new Error("Synthetic infrastructure failed to start.");

  const children = [];
  if (!(await isAvailable(`${LOCAL_API}/health`))) {
    children.push(spawnService("API", "pnpm", ["dev:api"]));
  }
  if (!(await isAvailable(`${LOCAL_PWA}/`))) {
    children.push(spawnService("PWA", "pnpm", ["dev:pwa"]));
  }

  await waitFor("API", () => isAvailable(`${LOCAL_API}/ready`));
  await waitFor("PWA", () => isAvailable(`${LOCAL_PWA}/`));

  let tunnel = await discoverTunnel();
  if (tunnel && domain && new URL(tunnel.url).hostname !== domain) {
    throw new Error(
      `ngrok already exposes ${tunnel.url}. Stop that tunnel before starting the configured hostname ${domain}.`,
    );
  }
  if (!tunnel) {
    const args = ["http", "5173", "--log=stdout", "--log-format=json"];
    if (domain) args.push(`--url=https://${domain}`);
    children.push(spawnService("ngrok", "ngrok", args, { pipe: true }));
    tunnel = await waitFor("ngrok tunnel", discoverTunnel, 60_000);
  }

  await waitFor(
    "public Pflegehelfer",
    async () => {
      try {
        const response = await request(`${tunnel.url}/ready`);
        return response.ok;
      } catch {
        return false;
      }
    },
    60_000,
  );

  const manifest = await writeManifest(tunnel, Boolean(domain));
  console.log(`\nPflegehelfer public demo: ${manifest.url}`);
  console.log(
    domain
      ? `Stable hostname configured: ${domain}`
      : "Temporary ngrok hostname: it changes when the tunnel is recreated. Set PFH_NGROK_DOMAIN to your assigned hostname for a stable URL.",
  );
  await checkPublicDemo();

  if (children.length === 0) return;
  console.log(
    "\nPress Ctrl-C to stop only the processes started by this command.",
  );
  await new Promise((resolvePromise, rejectPromise) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      for (const child of [...children].reverse()) child.kill("SIGTERM");
      resolvePromise();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    for (const child of children) {
      child.once("error", rejectPromise);
      child.once("exit", (code, signal) => {
        if (!stopping) {
          stopping = true;
          for (const peer of children) if (peer !== child) peer.kill("SIGTERM");
          rejectPromise(
            new Error(
              `${child.pfhLabel} exited (${signal ?? code ?? "unknown"}).`,
            ),
          );
        }
      });
    }
  });
}

async function main() {
  const command = process.argv[2] ?? "start";
  if (command === "start") return startPublicDemo();
  if (command === "check") return checkPublicDemo();
  if (command === "url") {
    const tunnel = await resolvePublicUrl();
    if (!tunnel) throw new Error("No Pflegehelfer ngrok URL found.");
    console.log(tunnel.url);
    return;
  }
  throw new Error("Usage: public-demo.mjs [start|check|url]");
}

try {
  await main();
} catch (error) {
  console.error(
    `public demo: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
