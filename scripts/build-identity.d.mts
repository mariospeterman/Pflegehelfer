export interface BuildIdentity {
  sourceSha: string | null;
  buildId: string;
  source: "environment" | "git" | "unavailable";
  dirty: boolean;
}

export function resolveBuildIdentity(
  environment?: NodeJS.ProcessEnv,
): BuildIdentity;
