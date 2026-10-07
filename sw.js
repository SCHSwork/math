// GN 2.0 service worker
// - The site page and its own files (css/, js/, icons): network first so updates show
//   right away, saved copy when offline.
// - Game cover images: served from a local cache for faster repeat visits.
// - Everything else (games, accounts, saves) is not touched.
const VERSION = "gn2-v2";
const PAGE_CACHE = `${VERSION}-page`;
const COVER_CACHE = `${VERSION}-covers`;
const MAX_COVERS = 600;
const COVER_HOSTS = ["cdn.jsdelivr.net", "raw.githubusercontent.com", "rawcdn.githack.com"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith(VERSION)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function isCover(url) {
  return COVER_HOSTS.includes(url.hostname) && /\/covers[@/]/.test(url.pathname) && /\.(png|jpe?g|webp|gif)$/i.test(url.pathname);
}

async function trimCovers() {
  const cache = await caches.open(COVER_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_COVERS; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The site itself
  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(PAGE_CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // The site's own files (styles, scripts, icons, manifest)
  if (url.origin === self.location.origin && /\.(css|js|png|json)$/.test(url.pathname) && !url.pathname.endsWith("/sw.js")) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(PAGE_CACHE)).put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(req) || await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Cover images: cached copy first, refreshed in the background
  if (isCover(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(COVER_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        // Only keep readable (CORS) responses; opaque ones waste storage
        if (res.ok && (res.type === "cors" || res.type === "basic")) {
          cache.put(req, res.clone()).then(trimCovers);
        }
        return res;
      });
      if (cached) { network.catch(() => {}); return cached; }
      return network;
    })());
  }
});
