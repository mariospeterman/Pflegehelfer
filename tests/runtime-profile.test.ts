import { describe, expect, it } from "vitest";
import { runtimeProfileFromEnvironment } from "../src/server/runtime-profile.js";

describe("runtime profile isolation", () => {
  it("requires an explicit profile and rejects storage typos", () => {
    expect(() =>
      runtimeProfileFromEnvironment({
        PFH_DEMO_MODE: "true",
        PFH_STORAGE_MODE: "in-memory",
      }),
    ).toThrow();
    expect(() =>
      runtimeProfileFromEnvironment({
        PFH_RUNTIME_PROFILE: "memory-demo",
        PFH_DEMO_MODE: "true",
        PFH_STORAGE_MODE: "memory",
      }),
    ).toThrow();
  });
  it("keeps the memory demo explicit", () => {
    expect(
      runtimeProfileFromEnvironment({
        PFH_RUNTIME_PROFILE: "memory-demo",
        PFH_DEMO_MODE: "true",
        PFH_STORAGE_MODE: "in-memory",
      }),
    ).toMatchObject({
      profile: "memory-demo",
      storageMode: "in-memory",
      persistenceMode: "in-memory",
      providerMode: "in-process-simulator",
    });
  });

  it("never lets the integrated profile fall back to memory or an in-process provider", () => {
    expect(() =>
      runtimeProfileFromEnvironment({
        PFH_RUNTIME_PROFILE: "integrated-demo",
        PFH_DEMO_MODE: "true",
        PFH_STORAGE_MODE: "medplum",
        PFH_OPERATIONAL_DATABASE_URL: "postgresql://example.invalid/pfh",
      }),
    ).toThrow("independent PFH_PROVIDER_SIMULATOR_BASE_URL");
    expect(() =>
      runtimeProfileFromEnvironment({
        PFH_RUNTIME_PROFILE: "integrated-demo",
        PFH_DEMO_MODE: "true",
        PFH_STORAGE_MODE: "in-memory",
        PFH_OPERATIONAL_DATABASE_URL: "postgresql://example.invalid/pfh",
        PFH_PROVIDER_SIMULATOR_BASE_URL: "http://127.0.0.1:8787",
      }),
    ).toThrow("PFH_STORAGE_MODE=medplum");
  });

  it("keeps production incompatible with demo identity", () => {
    expect(() =>
      runtimeProfileFromEnvironment({
        PFH_RUNTIME_PROFILE: "production",
        PFH_DEMO_MODE: "true",
        PFH_STORAGE_MODE: "medplum",
        PFH_OPERATIONAL_DATABASE_URL: "postgresql://example.invalid/pfh",
      }),
    ).toThrow("PFH_DEMO_MODE=false");
  });
});
