const SHELL = "pflegehelfer-shell-v2";
const ASSETS = ["/", "/manifest.webmanifest", "/icon.svg"];

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
          keys.filter((key) => key !== SHELL).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/health" ||
    event.request.method !== "GET"
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached ?? caches.match("/")),
      ),
  );
});
