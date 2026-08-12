const CACHE_NAME = "feichai-xiuxian-v4-20260812-pulse";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/action-choices.js",
  "./src/adjudicator.js",
  "./src/day-cycle.js",
  "./src/game-data.js",
  "./src/game-engine.js",
  "./src/llm.js",
  "./src/rng.js",
  "./assets/portraits/shen-yan.jpg",
  "./assets/portraits/player-female.jpg",
  "./assets/portraits/lu-qinghe.jpg",
  "./assets/portraits/han-zhao.jpg",
  "./assets/portraits/zhou-steward.jpg",
  "./assets/portraits/xu-tang.jpg",
  "./assets/portraits/mo-qi.jpg",
  "./assets/portraits/wen-he.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
