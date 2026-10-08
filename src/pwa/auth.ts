function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

const accessChannel =
  typeof window === "undefined" || typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("pflegehelfer:access");
const localAccessEvent = "pflegehelfer:access-revoked";

export function publishAccessRevoked(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(localAccessEvent));
  accessChannel?.postMessage({ type: "access-revoked" });
}

export function subscribeAccessRevoked(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handle = (event: MessageEvent<unknown>) => {
    if (
      event.data &&
      typeof event.data === "object" &&
      (event.data as { type?: unknown }).type === "access-revoked"
    )
      listener();
  };
  window.addEventListener(localAccessEvent, listener);
  accessChannel?.addEventListener("message", handle);
  return () => {
    window.removeEventListener(localAccessEvent, listener);
    accessChannel?.removeEventListener("message", handle);
  };
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return requireAuthenticatedResponse(await fetch(input, init));
}

/** Double-submit token for the OIDC/BFF profile; absent in memory demo mode. */
export function requestIntegrityHeaders(method?: string): HeadersInit {
  if (!method || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()))
    return {};
  const csrf = cookieValue("pfh_csrf");
  return csrf ? { "x-csrf-token": csrf } : {};
}

export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(
    `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

export function requireAuthenticatedResponse(response: Response): Response {
  if (response.status === 401) {
    publishAccessRevoked();
    redirectToLogin();
  }
  return response;
}

export function hasBffSession(): boolean {
  return cookieValue("pfh_csrf") !== null;
}
