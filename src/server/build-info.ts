import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const shaSchema = z.string().regex(/^[0-9a-f]{40,64}$/i);
const identitySchema = z
  .object({
    surface: z.enum(["api", "pwa"]),
    sourceSha: shaSchema.nullable(),
    buildId: z
      .string()
      .regex(/^pfh-(?:[0-9a-f]{12}(?:\.dirty)?|unavailable)$/i),
    source: z.enum(["environment", "git", "unavailable"]),
    dirty: z.boolean(),
  })
  .strict();

export type RuntimeBuildIdentity = z.infer<typeof identitySchema>;

function environmentIdentity(
  surface: "api" | "pwa",
): RuntimeBuildIdentity | null {
  const candidate = process.env.PFH_BUILD_SHA ?? process.env.GITHUB_SHA;
  const parsed = shaSchema.safeParse(candidate?.trim());
  if (!parsed.success) return null;
  const sourceSha = parsed.data.toLowerCase();
  return {
    surface,
    sourceSha,
    buildId: `pfh-${sourceSha.slice(0, 12)}`,
    source: "environment",
    dirty: false,
  };
}

function artifactIdentity(
  surface: "api" | "pwa",
  path: string,
): RuntimeBuildIdentity | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = identitySchema.safeParse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return parsed.success && parsed.data.surface === surface
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function gitIdentity(surface: "api" | "pwa"): RuntimeBuildIdentity | null {
  try {
    const parsed = shaSchema.safeParse(
      execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
    if (!parsed.success) return null;
    const sourceSha = parsed.data.toLowerCase();
    const dirty =
      spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).stdout.trim().length > 0;
    return {
      surface,
      sourceSha,
      buildId: `pfh-${sourceSha.slice(0, 12)}${dirty ? ".dirty" : ""}`,
      source: "git",
      dirty,
    };
  } catch {
    return null;
  }
}

function unavailableIdentity(surface: "api" | "pwa"): RuntimeBuildIdentity {
  return {
    surface,
    sourceSha: null,
    buildId: "pfh-unavailable",
    source: "unavailable",
    dirty: false,
  };
}

const compiledRuntime = fileURLToPath(import.meta.url).endsWith(".js");

export function runtimeBuildInfo(): {
  api: RuntimeBuildIdentity;
  pwa: RuntimeBuildIdentity;
  matchingSource: boolean | null;
} {
  const api =
    environmentIdentity("api") ??
    (compiledRuntime
      ? artifactIdentity(
          "api",
          resolve(process.cwd(), "dist/api-build-info.json"),
        )
      : gitIdentity("api")) ??
    unavailableIdentity("api");
  const pwa =
    artifactIdentity(
      "pwa",
      resolve(process.cwd(), "dist/pwa/build-info.json"),
    ) ?? unavailableIdentity("pwa");
  return {
    api,
    pwa,
    matchingSource:
      api.sourceSha && pwa.sourceSha
        ? api.sourceSha === pwa.sourceSha && api.buildId === pwa.buildId
        : null,
  };
}
