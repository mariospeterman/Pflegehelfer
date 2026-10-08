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

async function precacheShell() {
  const cache = await caches.open(SHELL);
  const shellResponse = await fetch("/", { cache: "reload" });
  if (!shellResponse.ok) throw new Error("shell fetch failed");
  const html = await shellResponse.clone().text();
  const discovered = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => `${url.pathname}${url.search}`);
  await cache.put("/", shellResponse);
  await cache.addAll([...new Set([...ASSETS.slice(1), ...discovered])]);
}

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
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const explicitShellAsset =
    url.origin === self.location.origin &&
    (ASSETS.includes(url.pathname) ||
      /^\/assets\/[a-zA-Z0-9._-]+\.(?:css|js|woff2?|png|svg)$/.test(
        url.pathname,
      ));
  if (event.request.method !== "GET" || !explicitShellAsset) return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(SHELL).then((cache) => cache.match(event.request)),
    ),
  );
});
