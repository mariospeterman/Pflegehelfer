import { z } from "zod";

export const runtimeProfileSchema = z.enum([
  "memory-demo",
  "integrated-demo",
  "production",
]);

export type RuntimeProfile = z.infer<typeof runtimeProfileSchema>;

export interface RuntimeProfileConfiguration {
  profile: RuntimeProfile;
  demoMode: boolean;
  storageMode: "in-memory" | "medplum";
  persistenceMode: "in-memory" | "postgresql";
  providerMode: "in-process-simulator" | "external-simulator" | "production";
}

/**
 * Resolve one explicit runtime profile and fail closed on mixed or typoed
 * configuration. Every supported package/Compose entrypoint names a profile.
 */
export function runtimeProfileFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeProfileConfiguration {
  const profile = runtimeProfileSchema.parse(env.PFH_RUNTIME_PROFILE);
  const demoMode = env.PFH_DEMO_MODE === "true";
  const storageMode = z
    .enum(["in-memory", "medplum"])
    .parse(env.PFH_STORAGE_MODE);
  const hasPostgres = Boolean(env.PFH_OPERATIONAL_DATABASE_URL);
  const hasExternalSimulator = Boolean(env.PFH_PROVIDER_SIMULATOR_BASE_URL);
  const hasSimulatorToken = Boolean(
    env.PFH_PROVIDER_SIMULATOR_TOKEN &&
    env.PFH_PROVIDER_SIMULATOR_TOKEN.length >= 32,
  );

  if (profile === "memory-demo") {
    if (!demoMode || storageMode !== "in-memory")
      throw new Error(
        "memory-demo requires PFH_DEMO_MODE=true and PFH_STORAGE_MODE=in-memory.",
      );
    return {
      profile,
      demoMode,
      storageMode,
      persistenceMode: "in-memory",
      providerMode: "in-process-simulator",
    };
  }
  if (profile === "integrated-demo") {
    if (!demoMode || storageMode !== "medplum" || !hasPostgres)
      throw new Error(
        "integrated-demo requires PFH_DEMO_MODE=true, PFH_STORAGE_MODE=medplum and PFH_OPERATIONAL_DATABASE_URL.",
      );
    if (!hasExternalSimulator || !hasSimulatorToken)
      throw new Error(
        "integrated-demo requires the independent PFH_PROVIDER_SIMULATOR_BASE_URL and a 32-character PFH_PROVIDER_SIMULATOR_TOKEN; no in-memory fallback is allowed.",
      );
    return {
      profile,
      demoMode,
      storageMode,
      persistenceMode: "postgresql",
      providerMode: "external-simulator",
    };
  }
  if (demoMode || storageMode !== "medplum" || !hasPostgres)
    throw new Error(
      "production requires PFH_DEMO_MODE=false, PFH_STORAGE_MODE=medplum and PFH_OPERATIONAL_DATABASE_URL.",
    );
  return {
    profile,
    demoMode,
    storageMode,
    persistenceMode: "postgresql",
    providerMode: "production",
  };
}
