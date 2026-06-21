const BUILD_ID = new URL(self.location.href).searchParams.get("v") || "dev";
const APP_CACHE = `nzfd-app-${BUILD_ID}`;
const DATA_CACHE = "nzfd-data-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/nzfd-wordmark.png", "/pwa-icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("nzfd-app-") && name !== APP_CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname === "/api/schedule" || url.pathname === "/api/radar") {
    event.respondWith(fetchData(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) caches.open(APP_CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }))
  );
});

async function fetchData(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    if (!cached) return new Response(JSON.stringify({ error: "Program není offline dostupný." }), { status: 503, headers: { "Content-Type": "application/json" } });

    const headers = new Headers(cached.headers);
    headers.set("x-nzfd-offline", "1");
    return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers });
  }
}
