import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("production deployment guards", () => {
  it("renders the explicit runtime profile and current AI mode contract", () => {
    const values = read("deploy/helm/pflegehelfer/values.yaml");
    const deployment = read(
      "deploy/helm/pflegehelfer/templates/deployment.yaml",
    );
    expect(values).toContain("runtimeProfile: production");
    expect(values).toContain("aiMode: disabled");
    expect(values).not.toContain("aiEnabled:");
    expect(deployment).toContain("name: PFH_RUNTIME_PROFILE");
    expect(deployment).toContain("name: PFH_AI_MODE");
    expect(deployment).not.toContain("PFH_AI_ENABLED");
  });

  it("fails Helm rendering when process-local state would be replicated", () => {
    const deployment = read(
      "deploy/helm/pflegehelfer/templates/deployment.yaml",
    );
    expect(deployment).toContain("gt (int .Values.replicaCount) 1");
    expect(deployment).toContain('fail "replicaCount above 1 is unsafe');
  });

  it("binds one reusable container image to a validated source identity", () => {
    const dockerfile = read("Dockerfile");
    const compose = read("compose.yaml");
    const workflow = read(".github/workflows/ci.yml");
    expect(dockerfile).toContain("ARG PFH_BUILD_SHA");
    expect(dockerfile).toContain("node scripts/validate-build-sha.mjs");
    expect(compose).toContain("PFH_BUILD_SHA: ${PFH_BUILD_SHA:-}");
    expect(compose).toContain("image: ${PFH_IMAGE:-pflegehelfer:local}");
    expect(workflow).toContain('--build-arg "PFH_BUILD_SHA=$PFH_BUILD_SHA"');
    expect(workflow).toContain('--tag "$PFH_IMAGE"');
    expect(workflow.match(/docker build /g)).toHaveLength(1);
    expect(workflow).not.toContain("up -d --build");
    expect(workflow).toContain("info.matchingSource !== true");
  });

  it("keeps real-stack Playwright detached from the protected showcase", () => {
    const configuration = read("playwright.real-stack.config.ts");
    const workflow = read(".github/workflows/ci.yml");
    expect(configuration).toContain("assertIsolatedE2eEnvironment");
    expect(configuration).not.toContain("webServer:");
    expect(configuration).not.toContain("reuseExistingServer");
    expect(configuration).toContain('serviceWorkers: "block"');
    expect(configuration).toContain('serviceWorkers: "allow"');
    expect(workflow).toContain('project="pfh-e2e-${nonce}"');
    expect(workflow).toContain("pnpm e2e:guard");
    expect(workflow).toContain("PFH_STORAGE_MODE: medplum");
    expect(workflow).toContain(
      "MEDPLUM_APP_BASE_URL=http://127.0.0.1:$PFH_MEDPLUM_APP_HOST_PORT/",
    );
  });
});

describe("service worker safety", () => {
  it("uses a build-bound cache and never caches readiness", () => {
    const registration = read("src/pwa/main.tsx");
    const worker = read("src/pwa/public/sw.js");
    expect(registration).toContain("/sw.js?build=");
    expect(worker).toContain('searchParams.get("build")');
    expect(worker).toContain("possibleShellAsset");
    expect(worker).toContain("shellAssets.has(url.pathname)");
    expect(worker).toContain('key.startsWith("pflegehelfer-shell-")');
    expect(worker).not.toContain("cache.put(event.request");
    expect(worker).not.toContain('caches.match("/")');
  });
});
