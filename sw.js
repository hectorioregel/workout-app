const CACHE = "workout-v13";
const VER = "13";
const ASSETS = [
  { url: "./index.html?v=13", keys: ["./", "./index.html", "./index.html?v=13"] },
  { url: "./styles.css?v=13", keys: ["./styles.css", "./styles.css?v=13"] },
  { url: "./app.js?v=13", keys: ["./app.js", "./app.js?v=13"] },
  { url: "./manifest.json?v=13", keys: ["./manifest.json", "./manifest.json?v=13"] },
  { url: "./icons/icon-192.png", keys: ["./icons/icon-192.png"] },
  { url: "./icons/icon-512.png", keys: ["./icons/icon-512.png"] },
  { url: "./icons/icon-512-maskable.png", keys: ["./icons/icon-512-maskable.png"] },
  { url: "./icons/apple-touch-icon.png", keys: ["./icons/apple-touch-icon.png"] },
  { url: "./icons/favicon.png", keys: ["./icons/favicon.png"] }
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
