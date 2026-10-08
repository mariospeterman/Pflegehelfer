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
