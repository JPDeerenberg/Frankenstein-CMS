/* Frankenstein CMS service worker — network first, cached copy only as an offline fallback */
const CACHE = "frankenstein-cms-__CACHE_HASH__";
// prettier-ignore
const ASSETS = [
  /* __ASSETS__ */
];

// Only the CMS's own files are ever cached. A bouncer hosted on THIS origin
// (e.g. /bouncer.php) returns repository contents: those must never end up in
// Cache Storage, where they would outlive the logout and show up offline.
const ASSET_PATHS = new Set(
  ASSETS.map((a) => {
    const u = new URL(a, self.location.href);
    return u.origin + u.pathname;
  }),
);

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
  if (!ASSET_PATHS.has(url.origin + url.pathname)) return;
  if (url.searchParams.has("path") || url.searchParams.has("action")) return;

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
