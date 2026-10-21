/* Frankenstein CMS service worker — network first, cached copy only as an offline fallback */
const CACHE = "frankenstein-cms-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/api.js",
  "./js/utils.js",
  "./js/doc.js",
  "./js/blocks.js",
  "./js/pwa.js",
  "./vendor/quill.min.js",
  "./vendor/quill.core.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./js/ui.js",
  "./js/editor.js",
  "./js/auth.js",
  "./js/files.js",
  "./js/seo.js",
  "./js/igor.js",
  "./demo_page.html",
];

self.addEventListener("install", (event) => {
  // cache each asset on its own so one missing file cannot abort the rest
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(ASSETS.map((asset) => cache.add(asset).catch(() => {}))),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin CMS assets; never intercept GitHub API / bouncer calls
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
