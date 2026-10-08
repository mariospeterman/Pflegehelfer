const BUILD_ID =
  new URL(self.location.href).searchParams.get("build") ?? "unversioned";
const SHELL = `pflegehelfer-shell-${BUILD_ID}`;
const ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/logo-mark.svg",
  "/logo-horizontal.svg",
];
let shellAssets = new Set(ASSETS);

async function precacheShell() {
  const cache = await caches.open(SHELL);
  const manifestResponse = await fetch(`/sw-assets.json?build=${BUILD_ID}`, {
    cache: "no-store",
  });
  if (!manifestResponse.ok) throw new Error("shell manifest fetch failed");
  const manifest = await manifestResponse.json();
  if (!Array.isArray(manifest)) throw new Error("shell manifest invalid");
  const reviewed = manifest.filter(
    (path) =>
      typeof path === "string" &&
      (ASSETS.includes(path) ||
        /^\/assets\/[a-zA-Z0-9._-]+\.(?:css|js|woff2?|png|svg)$/.test(path)),
  );
  shellAssets = new Set([...ASSETS, ...reviewed]);
  await cache.addAll([...shellAssets]);
}

async function restoreShellAllowlist() {
  const cache = await caches.open(SHELL);
  const requests = await cache.keys();
  shellAssets = new Set([
    ...ASSETS,
    ...requests
      .map((request) => new URL(request.url).pathname)
      .filter(
        (path) =>
          ASSETS.includes(path) ||
          /^\/assets\/[a-zA-Z0-9._-]+\.(?:css|js|woff2?|png|svg)$/.test(path),
      ),
  ]);
}

let shellAllowlistReady = restoreShellAllowlist().catch(() => undefined);

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("pflegehelfer-shell-") && key !== SHELL,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => {
        shellAllowlistReady = restoreShellAllowlist();
        return shellAllowlistReady;
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const possibleShellAsset =
    url.origin === self.location.origin &&
    (ASSETS.includes(url.pathname) ||
      /^\/assets\/[a-zA-Z0-9._-]+\.(?:css|js|woff2?|png|svg)$/.test(
        url.pathname,
      ));
  if (event.request.method !== "GET" || !possibleShellAsset) return;
  event.respondWith(
    shellAllowlistReady.then(() => {
      if (!shellAssets.has(url.pathname)) return fetch(event.request);
      return fetch(event.request).catch(() =>
        caches
          .open(SHELL)
          .then((cache) => cache.match(event.request))
          .then((cached) => cached ?? Response.error()),
      );
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PFH_PURGE_SENSITIVE_CACHES") return;
  // The shell cache contains only the public build-manifest allowlist. Keep it
  // available across logout; delete only future, explicitly sensitive caches.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pflegehelfer-sensitive-"))
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
