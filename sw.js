const CACHE = "workout-v12";
const VER = "12";
const ASSETS = [
  { url: "./index.html?v=12", keys: ["./", "./index.html", "./index.html?v=12"] },
  { url: "./styles.css?v=12", keys: ["./styles.css", "./styles.css?v=12"] },
  { url: "./app.js?v=12", keys: ["./app.js", "./app.js?v=12"] },
  { url: "./run-math.js?v=12", keys: ["./run-math.js", "./run-math.js?v=12"] },
  { url: "./vendor/leaflet/leaflet.css?v=12", keys: ["./vendor/leaflet/leaflet.css", "./vendor/leaflet/leaflet.css?v=12"] },
  { url: "./vendor/leaflet/leaflet.js?v=12", keys: ["./vendor/leaflet/leaflet.js", "./vendor/leaflet/leaflet.js?v=12"] },
  { url: "./manifest.json?v=12", keys: ["./manifest.json", "./manifest.json?v=12"] },
  { url: "./icons/icon-192.png", keys: ["./icons/icon-192.png"] },
  { url: "./icons/icon-512.png", keys: ["./icons/icon-512.png"] },
  { url: "./icons/icon-512-maskable.png", keys: ["./icons/icon-512-maskable.png"] },
  { url: "./icons/apple-touch-icon.png", keys: ["./icons/apple-touch-icon.png"] },
  { url: "./icons/favicon.png", keys: ["./icons/favicon.png"] },
  { url: "./vendor/leaflet/images/marker-icon.png", keys: ["./vendor/leaflet/images/marker-icon.png"] },
  { url: "./vendor/leaflet/images/marker-icon-2x.png", keys: ["./vendor/leaflet/images/marker-icon-2x.png"] },
  { url: "./vendor/leaflet/images/marker-shadow.png", keys: ["./vendor/leaflet/images/marker-shadow.png"] },
  { url: "./vendor/leaflet/images/layers.png", keys: ["./vendor/leaflet/images/layers.png"] },
  { url: "./vendor/leaflet/images/layers-2x.png", keys: ["./vendor/leaflet/images/layers-2x.png"] }
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const asset of ASSETS) {
      const res = await fetch(asset.url, { cache: "reload" });
      if (!res.ok) throw new Error("Failed to cache " + asset.url);
      const buf = await res.arrayBuffer();
      const headers = new Headers(res.headers);
      for (const key of asset.keys) {
        await cache.put(key, new Response(buf.slice(0), {
          status: res.status,
          statusText: res.statusText,
          headers
        }));
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith("/sw.js")) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
