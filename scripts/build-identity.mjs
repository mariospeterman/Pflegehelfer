import { execFileSync, spawnSync } from "node:child_process";

const SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

function normalizedSha(value) {
  const candidate = value?.trim();
  return candidate && SHA_PATTERN.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

export function resolveBuildIdentity(environment = process.env) {
  const environmentSha =
    normalizedSha(environment.PFH_BUILD_SHA) ??
    normalizedSha(environment.GITHUB_SHA);
  let sourceSha = environmentSha;
  let source = environmentSha ? "environment" : "git";
  let dirty = false;

  if (!sourceSha) {
    try {
      sourceSha = normalizedSha(
        execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
      dirty =
        spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).stdout.trim().length > 0;
    } catch {
      sourceSha = null;
      source = "unavailable";
    }
  }

  const buildId = sourceSha
    ? `pfh-${sourceSha.slice(0, 12)}${dirty ? ".dirty" : ""}`
    : "pfh-unavailable";
  return { sourceSha, buildId, source, dirty };
}
