/* Frankenstein CMS service worker — caches the CMS shell for offline open */
const CACHE = "frankenstein-cms-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/config.js",
  "./js/utils.js",
  "./js/ui.js",
  "./js/editor.js",
  "./js/auth.js",
  "./js/files.js",
  "./js/seo.js",
  "./js/igor.js",
  "./demo_page.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin CMS assets; never intercept GitHub API
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  // Use Network First, falling back to Cache for critical assets
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
