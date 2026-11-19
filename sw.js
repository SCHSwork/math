// GN 2.0 service worker
// - The site page, and its own files without a version: network first so
//   updates show right away, saved copy when offline.
// - The site's own files with a version (?v=…, stamped by tools/stamp_versions.py):
//   that exact URL never changes, so the saved copy is used without asking the
//   network. A new version is a new URL, so updates still show right away.
// - Game cover images (the site's small copies and the originals): served from a
//   local cache for faster repeat visits. The small copies are versioned too, so
//   they're never fetched again once saved.
// - Everything else (games, accounts, saves) is not touched.
const VERSION = "gn2-v2";
const PAGE_CACHE = `${VERSION}-page`;
const COVER_CACHE = `${VERSION}-covers`;
const MAX_COVERS = 2000;
const COVER_HOSTS = ["cdn.jsdelivr.net", "raw.githubusercontent.com", "rawcdn.githack.com"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      // gn-backups holds the offline copies of the game lists (gnBackup in js/ui.js)
      if (!key.startsWith(VERSION) && key !== "gn-backups") await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function isCover(url) {
  // The site's own small copies (covers-small/), or an original from a mirror
  if (url.origin === self.location.origin) return /\/covers-small\/[0-9a-f]+\.webp$/.test(url.pathname);
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

  // The site's own versioned files: saved copy first. Older versions of the
  // same file are dropped when a new one is saved.
  if (url.origin === self.location.origin && url.searchParams.has("v") && /\.(css|js|png|json|webp)$/.test(url.pathname) &&
      !url.pathname.endsWith("/sw.js") && !isCover(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          await cache.put(req, fresh.clone());
          for (const k of await cache.keys()) {
            const u = new URL(k.url);
            if (u.pathname === url.pathname && u.search !== url.search) cache.delete(k);
          }
        }
        return fresh;
      } catch (err) {
        const old = await cache.match(req, { ignoreSearch: true });
        if (old) return old;
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
      // A small copy's URL has its version in it, so a saved one never needs checking
      if (cached && url.origin === self.location.origin && url.searchParams.has("v")) return cached;
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
