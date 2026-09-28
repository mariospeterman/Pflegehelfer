import { isIP } from "node:net";

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
    return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
}

/**
 * Fail-closed policy for endpoints described as local. Literal loopback/RFC1918
 * HTTP endpoints are accepted. Named or TLS endpoints require their exact
 * origin in PFH_LOCAL_AI_ALLOWED_ORIGINS after deployment-level DNS/TLS review.
 */
export function validateLocalAiEndpoint(
  raw: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (!raw) return null;
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("LOCAL_AI_ENDPOINT_INVALID");
  const hostname = url.hostname.toLowerCase();
  const ipHostname = hostname.replace(/^\[|\]$/g, "");
  const literalPrivate =
    hostname === "localhost" ||
    (isIP(ipHostname) === 4 && isPrivateIpv4(ipHostname)) ||
    (isIP(ipHostname) === 6 && isPrivateIpv6(ipHostname));
  if (literalPrivate && url.protocol === "http:") return raw;
  const allowed = new Set(
    (env.PFH_LOCAL_AI_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowed.has(url.origin))
    throw new Error("LOCAL_AI_ENDPOINT_NOT_ALLOWED");
  return raw;
}
