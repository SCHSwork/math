const container = document.getElementById('container');
const zoneViewer = document.getElementById('zoneViewer');
let zoneFrame = document.getElementById('zoneFrame');
const searchBar = document.getElementById('searchBar');
const sortOptions = document.getElementById('sortOptions');
const filterOptions = document.getElementById('filterOptions');

// ── Speed helpers for the game grid ─────────────────────────────────────────
// Building ~2,000 cards used to re-read and re-parse favorites, play time and
// hidden games from localStorage several times per card (10,000+ parses per
// redraw). While cards are being built, each of those is read once and reused.
let cardCache = null;
function withCardCache(fn) {
    if (cardCache) return fn();
    cardCache = {};
    try { return fn(); } finally { cardCache = null; }
}
function cardCached(key, read) {
    if (!cardCache) return read();
    if (!(key in cardCache)) cardCache[key] = read();
    return cardCache[key];
}
const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

// Ratings, play counts and the partner-games check all finish at different times
// in the first few seconds. Each one used to redraw every card, so slow
// computers froze 3-5 times in a row, often right as a game was starting.
// Now they share one redraw, and nothing is redrawn while a game is open.
let refreshTimer = null, refreshWaitingForGame = false;
function scheduleFullRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        if (zoneViewer.style.display === "flex") { refreshWaitingForGame = true; return; }
        refreshWaitingForGame = false;
        if (typeof refreshVisibleZones === "function" && typeof ZONES_ALL !== "undefined" && ZONES_ALL) refreshVisibleZones();
        else { featuredContainer.innerHTML = ""; sortZones(); }
    }, 400);
}
// https://www.jsdelivr.com/tools/purge
const zonesurls = [
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json",
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json",
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@master/zones.json",
    "https://cdn.jsdelivr.net/gh/freebuisness/assets/zones.json"
];
let zonesURL = zonesurls[Math.floor(Math.random() * zonesurls.length)];
const coverURL = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";
// The game library is pinned to a checked version. On Oct 11, 2026 every game
// file in the library's newest version had a malicious ad script added
// (commit ee1a41a), so games load from the last clean version instead.
// Before moving this to a newer version, check it doesn't contain that script.
const LIBRARY_REF = "48c0631289237dd2e9e202fde532edfae4ed2acf";
const htmlURL = `https://cdn.jsdelivr.net/gh/freebuisness/html@${LIBRARY_REF}`;
// The game files that exist in that clean version (config/library-pinned.json).
// Games the library adds later aren't in it, so they're hidden instead of failing.
const pinnedFilesPromise = fetch("config/library-pinned.json")
    .then(r => r.ok ? r.json() : null)
    .then(j => j && j.ref === LIBRARY_REF && Array.isArray(j.files) ? new Set(j.files) : null)
    .catch(() => null);
// Library games added after the clean version that were checked and cleaned by
// hand ("washed"): the bad script removed and their game files locked to a
// checked commit. They load from this site's washed/ folder instead
// (config/library-washed.json, made with tools/wash_library_games.py).
const washedGamesPromise = fetch("config/library-washed.json")
    .then(r => r.ok ? r.json() : null)
    .then(j => (j && j.games && typeof j.games === "object") ? j.games : {})
    .catch(() => ({}));
// Games the library added after the clean version. They're hidden, and admins
// and the owner are told about them so each one can be checked (admin.js).
let newLibraryGames = [];
function pinnedFileForId(files, id) {
    const re = new RegExp("^" + String(id).replace(/\D/g, "") + "(?:[-.]|$)");
    const fix = n => Number((n.match(/-fix(\d*)/) || [0, -1])[1] || (/-fix/.test(n) ? 1 : 0));
    const list = [...files].filter(n => re.test(n) && String(id).replace(/\D/g, "")).sort((a, b) => fix(b) - fix(a));
    return list[0] || null;
}
const htmlURLFallbacks = [
    `https://raw.githubusercontent.com/freebuisness/html/${LIBRARY_REF}`
];
// ── Redundancy: every game-library file can come from three places ─────────
// jsDelivr (fast CDN) → GitHub directly → githack (another CDN). A source that
// fails, times out, or gets redirected (e.g. to a school filter's block page)
// is skipped for the rest of the session.
const MIRRORS = {
    jsdelivr: (o, r, ref, p) => `https://cdn.jsdelivr.net/gh/${o}/${r}@${ref === "HEAD" ? "latest" : ref}/${p}`,
    github:   (o, r, ref, p) => `https://raw.githubusercontent.com/${o}/${r}/${ref === "latest" ? "HEAD" : ref}/${p}`,
    githack:  (o, r, ref, p) => `https://rawcdn.githack.com/${o}/${r}/${ref === "latest" ? "HEAD" : ref}/${p}`,
    // Backup addresses for jsDelivr itself, run on other networks (Fastly, G-Core,
    // Cloudflare). A school filter that blocks cdn.jsdelivr.net often misses these.
    fastly:   (o, r, ref, p) => `https://fastly.jsdelivr.net/gh/${o}/${r}@${ref === "HEAD" ? "latest" : ref}/${p}`,
    gcore:    (o, r, ref, p) => `https://gcore.jsdelivr.net/gh/${o}/${r}@${ref === "HEAD" ? "latest" : ref}/${p}`,
    testingcf:(o, r, ref, p) => `https://testingcf.jsdelivr.net/gh/${o}/${r}@${ref === "HEAD" ? "latest" : ref}/${p}`
};
const PRIMARY_MIRRORS = ["jsdelivr", "github", "githack"];
const BACKUP_MIRRORS = ["fastly", "gcore", "testingcf"];
const MIRROR_HOSTS = { "cdn.jsdelivr.net": "jsdelivr", "raw.githubusercontent.com": "github", "rawcdn.githack.com": "githack",
    "fastly.jsdelivr.net": "fastly", "gcore.jsdelivr.net": "gcore", "testingcf.jsdelivr.net": "testingcf" };
// Sources that failed recently, remembered across visits for a few hours so a
// school filter that blocks one isn't waited on again every time the site opens.
const MIRROR_DOWN_KEY = "gnmath-mirror-down-at", MIRROR_DOWN_MS = 6 * 3600000;
const mirrorDownAt = (() => {
    try {
        const all = JSON.parse(localStorage.getItem(MIRROR_DOWN_KEY) || "{}"), now = Date.now(), out = {};
        for (const [k, t] of Object.entries(all)) if (MIRRORS[k] && now - t < MIRROR_DOWN_MS) out[k] = t;
        return out;
    } catch { return {}; }
})();
const mirrorDown = new Set(Object.keys(mirrorDownAt));
function markMirror(name, ok) {
    if (!name) return;
    const before = mirrorDown.has(name);
    if (ok) { mirrorDown.delete(name); delete mirrorDownAt[name]; }
    else { mirrorDown.add(name); mirrorDownAt[name] = Date.now(); }
    if (before !== mirrorDown.has(name)) {
        try { localStorage.setItem(MIRROR_DOWN_KEY, JSON.stringify(mirrorDownAt)); } catch {}
        console.info(`Game source ${name} is ${ok ? "back up" : "unavailable"}`);
    }
}
// A picture that won't load may just be missing (a 404), not a source that's
// down, so instead of marking the source down, check it with a tiny file.
// Also used to re-check sources marked down earlier, so one short blip
// doesn't count as "down" for the rest of the visit.
const mirrorProbeAt = {};
async function probeMirror(name) {
    if (!MIRRORS[name]) return null;
    mirrorProbeAt[name] = Date.now();
    const url = MIRRORS[name]("SCHSwork", "math", "main", "config/library-pinned.json") + "?probe=" + Date.now();
    try {
        await fetchFirst([url], { timeoutMs: 8000, track: false, validate: async r => { await r.json(); return true; } });
        markMirror(name, true);
        return true;
    } catch (err) {
        if (!/^HTTP 404/.test(err.message)) markMirror(name, false);
        return false;
    }
}
function suspectMirror(name) {
    if (!name || Date.now() - (mirrorProbeAt[name] || 0) < 60000) return;
    probeMirror(name);
}
function mirrorUrls(owner, repo, ref, path) {
    // The three main sources first, then the jsDelivr backups; working ones first
    const order = [...PRIMARY_MIRRORS, ...BACKUP_MIRRORS];
    order.sort((a, b) => mirrorDown.has(a) - mirrorDown.has(b));
    return order.map(k => MIRRORS[k](owner, repo, ref, path));
}
function mirrorOf(url) { try { return MIRROR_HOSTS[new URL(url).hostname]; } catch { return null; } }
// Try each URL until one returns a usable response. With `stagger`, the next
// source also starts if the current one hasn't answered within that many ms
// (or right away if it fails), and the first good answer wins. That way a
// source a filter silently blocks costs a couple of seconds, not the timeout.
function fetchFirst(urls, opts = {}) {
    return opts.stagger && urls.length > 1 ? fetchFirstStaggered(urls, opts) : fetchFirstInOrder(urls, opts);
}
function fetchFirstStaggered(urls, { timeoutMs = 15000, validate, track = true, cache, stagger, onTry }) {
    return new Promise((resolve, reject) => {
        let next = 0, running = 0, done = false, lastError = new Error("No sources"), staggerTimer = null;
        const ctrls = [], waiting = new Set();  // names of sources still loading
        const launch = () => {
            clearTimeout(staggerTimer);
            if (done || next >= urls.length) return;
            const url = urls[next++], name = mirrorOf(url);
            if (onTry) try { onTry(name, next - 1); } catch {}
            const ctrl = new AbortController();
            ctrls.push(ctrl);
            if (name) waiting.add(name);
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            running++;
            staggerTimer = setTimeout(launch, stagger);
            (async () => {
                try {
                    const res = await fetch(url, cache ? { signal: ctrl.signal, cache } : { signal: ctrl.signal });
                    if (res.redirected && new URL(res.url).hostname !== new URL(url).hostname) throw Object.assign(new Error("redirected"), { down: true });
                    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { down: res.status >= 500 || res.status === 403 });
                    const out = validate ? await validate(res) : res;
                    if (done) return;
                    done = true;
                    clearTimeout(staggerTimer);
                    ctrls.forEach(c => { if (c !== ctrl) c.abort(); });
                    if (track) {
                        // Sources that started earlier and still hadn't answered: skip them next time
                        for (const w of waiting) if (w !== name && urls.findIndex(u => mirrorOf(u) === w) < urls.indexOf(url)) markMirror(w, false);
                        markMirror(name, true);
                    }
                    resolve(out);
                } catch (err) {
                    if (done) return;  // stopped because another source won
                    if (track && err.down !== false && !/^HTTP 404/.test(err.message)) markMirror(name, false);
                    lastError = err;
                    launch();          // failed: try the next source now
                } finally {
                    clearTimeout(timer);
                    if (name && !done) waiting.delete(name);
                    running--;
                    if (!done && running === 0 && next >= urls.length) { clearTimeout(staggerTimer); reject(lastError); }
                }
            })();
        };
        launch();
    });
}
async function fetchFirstInOrder(urls, { timeoutMs = 15000, validate, track = true, cache } = {}) {
    let lastError = new Error("No sources");
    for (const url of urls) {
        const name = mirrorOf(url);
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        try {
            const opts = {};
            if (ctrl) opts.signal = ctrl.signal;
            if (cache) opts.cache = cache;
            const res = await fetch(url, opts);
            // Redirected to some other site = blocked by a filter
            if (res.redirected && new URL(res.url).hostname !== new URL(url).hostname) throw Object.assign(new Error("redirected"), { down: true });
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { down: res.status >= 500 || res.status === 403 });
            const out = validate ? await validate(res) : res;
            if (track) markMirror(name, true);
            return out;
        } catch (err) {
            // Network errors, timeouts, filter redirects and bad data count against the source
            if (track && err.down !== false && !/^HTTP 404/.test(err.message)) markMirror(name, false);
            lastError = err;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    throw lastError;
}
// When jsDelivr is unreachable, point the jsDelivr links inside a game at backups
function rewriteForMirrors(html) {
    if (!mirrorDown.has("jsdelivr") || typeof html !== "string") return html;
    // A working jsDelivr backup address takes the exact same links (including npm)
    const alt = BACKUP_MIRRORS.find(m => !mirrorDown.has(m));
    if (alt) return html.replace(/https?:\/\/cdn\.jsdelivr\.net\//g, `https://${alt}.jsdelivr.net/`);
    return html
        .replace(/https?:\/\/cdn\.jsdelivr\.net\/gh\/([^\/@\s"'`<>]+)\/([^\/@\s"'`<>]+)(?:@([^\/\s"'`<>]+))?\//g,
            (m, o, r, ref) => `https://rawcdn.githack.com/${o}/${r}/${!ref || ref === "latest" ? "HEAD" : ref}/`)
        .replace(/https?:\/\/cdn\.jsdelivr\.net\/npm\//g, "https://unpkg.com/");
}
// Cover image URL from the best working source, with the rest kept as fallbacks
function coverSources(cover) {
    if (!cover) return [];
    const gh = typeof parseGhUrl === "function" && parseGhUrl(cover);
    if (gh) return mirrorUrls(gh.owner, gh.repo, gh.ref, gh.path);
    if (!cover.includes("{COVER_URL}")) return [cover.replace("{HTML_URL}", htmlURL)];
    const path = cover.replace("{COVER_URL}/", "").replace("{COVER_URL}", "");
    return mirrorUrls("freebuisness", "covers", "main", path);
}
function setCoverImage(img, cover, lazy) {
    const list = coverSources(cover);
    if (!list.length) return;
    // Partner game covers come from Famobi, which doesn't allow CORS image loads
    if (!/^https:\/\/(img\.cdn\.famobi\.com|static\.playgama\.com)\//.test(list[0])) img.crossOrigin = "anonymous";
    img.dataset.fallbacks = JSON.stringify(list.slice(1));
    img.onerror = () => {
        let rest = [];
        try { rest = JSON.parse(img.dataset.fallbacks || "[]"); } catch {}
        suspectMirror(mirrorOf(img.currentSrc || img.src));
        if (!rest.length) {
            img.onerror = null;
            if (img.dataset.placeholder) img.src = img.dataset.placeholder;
            return;
        }
        img.dataset.fallbacks = JSON.stringify(rest.slice(1));
        img.src = rest[0];
    };
    if (lazy) img.dataset.src = list[0]; else img.src = list[0];
}
// Simple picture with the game's name, for covers that couldn't be loaded
function coverPlaceholder(name) {
    const esc = String(name || "").replace(/[&<>"']/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#1f2937"/><text x="150" y="150" fill="#e5e7eb" font-family="sans-serif" font-size="26" font-weight="700" text-anchor="middle" dominant-baseline="middle">${esc.length > 18 ? esc.slice(0, 17) + "…" : esc}</text></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
// The game list: newest copy from any source, or the last one that loaded
const ZONES_CACHE_KEY = "gnmath-cache-zones";
let libraryListState = "loading"; // live | cache | failed (read by the status indicator)
async function loadZoneList(sha) {
    const urls = [];
    if (sha) urls.push(`https://cdn.jsdelivr.net/gh/freebuisness/assets@${sha}/zones.json`);
    for (const u of mirrorUrls("freebuisness", "assets", "main", "zones.json")) urls.push(u + "?t=" + Date.now());
    try {
        const data = await fetchFirst(urls, {
            timeoutMs: 12000,
            validate: async res => {
                const j = await res.json();
                if (!Array.isArray(j) || j.length === 0) throw new Error("bad game list");
                return j;
            }
        });
        try { localStorage.setItem(ZONES_CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch {}
        libraryListState = "live";
        return data;
    } catch (err) {
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(ZONES_CACHE_KEY)); } catch {}
        if (cached && Array.isArray(cached.data)) {
            libraryListState = "cache";
            showSourceNotice(`Couldn't reach the game library, so this is the list saved on ${new Date(cached.t).toLocaleDateString()}. Some games may not load until it's back.`);
            return cached.data;
        }
        libraryListState = "failed";
        throw err;
    }
}
function showSourceNotice(text) {
    let el = document.getElementById("sourceNotice");
    if (!el) {
        el = document.createElement("div");
        el.id = "sourceNotice";
        el.setAttribute("role", "status");
        el.style.cssText = "margin:0 0 1.5rem;padding:0.75rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);font-size:14px;";
        const main = document.querySelector("main");
        if (main) main.prepend(el);
    }
    el.textContent = text;
}

let zones = [];
let popularityData = {};
const featuredContainer = document.getElementById('featuredZones');
function toTitleCase(str) {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  );
}
// Names for the library's own tags in the "Type" filter
const TYPE_LABELS = { port: "Ports", flash: "Flash", emulator: "Emulator", fnf: "FNF mods", nds: "Nintendo DS", dos: "DOS", tools: "Tools", psx: "PlayStation", gba: "Game Boy Advance", nes: "NES", n64: "Nintendo 64" };
async function listZones() {
    const originalsPromise = typeof loadOriginals === "function" ? loadOriginals() : Promise.resolve([]);
    const partnersPromise = typeof loadPartners === "function" ? loadPartners().catch(() => []) : Promise.resolve([]);
    const ubzonePromise = typeof loadUbzone === "function" ? loadUbzone().catch(() => []) : Promise.resolve([]);
    try {
      // Look up the latest commit SHA so jsDelivr serves a fresh zones.json.
      // sha.txt on raw.githubusercontent.com has no per-IP rate limit, so try it
      // first; the GitHub API allows only 60 calls/hour per IP (a whole school
      // network shares one IP), so it is only a fallback.
      let sha;
      try {
        const shaRes = await fetch("https://raw.githubusercontent.com/freebuisness/xml/refs/heads/main/sha.txt?t="+Date.now());
        if (shaRes.ok) sha = (await shaRes.text()).trim();
      } catch (error) {}
      if (!sha) {
        try {
          const apiRes = await fetch("https://api.github.com/repos/freebuisness/assets/commits?per_page=1");
          if (apiRes.ok) sha = (await apiRes.json())[0]?.sha;
        } catch (error) {}
      }
      if (!(sha && /^[0-9a-f]{7,40}$/i.test(sha))) sha = null;
        const json = await loadZoneList(sha);
        // Drop upstream promo tiles: "[!] ..." entries (Discord, comments, etc.),
        // anything named comments, and anything linking to Discord.
        const pinnedFiles = await pinnedFilesPromise;
        const washedGames = await washedGamesPromise;
        zones = json.filter(z => {
            const name = (z.name || "").trim();
            if (/^\[!\]/.test(name) || /comment|discord/i.test(name) || /discord\.(gg|com)/i.test(z.url || "")) return false;
            // Library games must have a file in the clean pinned version. If the newest
            // list renamed a game's file (e.g. 320-fix2.html → 320-fix3.html), use that
            // game's file from the clean version; games added after it are hidden.
            const file = String(z.url || "").match(/^\{HTML_URL\}\/?(.+)$/);
            if (!pinnedFiles || !file || pinnedFiles.has(file[1])) return true;
            // Washed copy of this exact file: use it
            const w = washedGames[String(z.id)];
            if (w && w.file === file[1] && /^washed\/[\w.-]+\.html$/.test(w.path || "")) { z.url = "washed:" + w.path; z.washed = true; return true; }
            const alt = pinnedFileForId(pinnedFiles, z.id);
            if (alt) { z.url = "{HTML_URL}/" + alt; return true; }
            newLibraryGames.push({ id: z.id, name, file: file[1], author: z.author || "" });
            return false;
        });
        // Extra washed games that aren't in the library's list (e.g. Drive Mad, from
        // another collection), added like library games
        for (const [id, w] of Object.entries(washedGames)) {
            if (!w || !w.extra || zones.some(z => String(z.id) === id)) continue;
            // A washed page in washed/, or a page used straight from a repo, locked to a commit
            const url = /^washed\/[\w.-]+\.html$/.test(w.path || "") ? "washed:" + w.path
                : /^gh:[\w.-]+\/[\w.-]+@[0-9a-f]{40}\/[^\s?#]+$/.test(w.url || "") ? w.url : "";
            if (!url) continue;
            zones.push({ id: Number(id), name: String(w.name || "").slice(0, 80), author: String(w.author || ""), authorLink: /^https:\/\//.test(w.source || "") ? w.source : "",
                cover: w.cover || "", url, description: w.description || "", washed: true });
        }
        if (typeof notifyNewLibraryGames === "function") notifyNewLibraryGames();
        // Add the GN Originals (open-source games) after the main library. An original
        // marked "libraryDuplicate" in games.json is the same game as one the library
        // already has (checked by hand, not by name), so it's only shown if the library is down.
        const originals = await originalsPromise;
        const libraryIds = new Set(zones.map(z => String(z.id)));
        zones = zones.concat(originals.filter(z => !libraryIds.has(String(z.id)) && !z.libraryDuplicate));
        // Partner games (html5games.com, may have ads) go last; ones the library or
        // GN Originals already have are marked "libraryDuplicate" in their list.
        const partners = await partnersPromise;
        zones = zones.concat(partners.filter(z => !libraryIds.has(String(z.id)) && !z.libraryDuplicate));
        // UBZone games (checked games from the unblockedzone site that weren't here yet)
        zones = zones.concat((await ubzonePromise).filter(z => !libraryIds.has(String(z.id))));
        if (typeof applyJamPreference === "function") zones = applyJamPreference(zones);
        // Show games right away using cached play counts, then refresh them
        const popularityFresh = loadCachedPopularity();
        sortZones();
        // New play counts only change the page when sorting by them or showing them
        if (!popularityFresh) refreshPopularity().then(() => {
            if (/^(popular|trending)/.test(sortOptions.value) || getShowPlayCount()) scheduleFullRefresh();
        });
        try {
        const search = new URLSearchParams(window.location.search);
        const id = search.get('id');
        const embed = window.location.hash.includes("embed");
        if (id) {
            const zone = zones.find(zone => zone.id + '' == id + '');
            if (zone) {
                if (embed) {
                    if (typeof isPartnerZone === "function" && isPartnerZone(zone)) {
                        window.location.replace(partnerPlayUrl(zone));
                    } else if (zone.url.startsWith("http")) {
                        window.open(zone.url, "_blank");
                    } else {
                        fetchWithFallback(zone.url).then(html => {
                            document.documentElement.innerHTML = html;
                            document.documentElement.querySelectorAll('script').forEach(oldScript => {
                                const newScript = document.createElement('script');
                                if (oldScript.src) {
                                    newScript.src = oldScript.src;
                                } else {
                                    newScript.textContent = oldScript.textContent;
                                }
                                document.body.appendChild(newScript);
                            });
                        }).catch(() => notify("Couldn't load that game. Try again in a few minutes.", { type: "error" }));
                    }
                }
            }
        }
        if (!embed) clearZoneIdFromUrl();
        } catch(error){}
        let alltags = [];
        for (const obj of json) {
            if (Array.isArray(obj.special)) {
                alltags.push(...obj.special);
            }
        }

        alltags = [...new Set(alltags)].filter(t => t !== "originals" && t !== "js13k");
        let filteroption = document.getElementById("filterOptions");
        if (filteroption && filteroption.children.length > 1) {
            while (filteroption.children.length > 1) {
                filteroption.removeChild(filteroption.lastElementChild);
            }
        }
        for (const tag of alltags) {
            const opt = document.createElement("option");
            opt.value = tag;
            opt.textContent = TYPE_LABELS[tag] || toTitleCase(tag);
            filteroption.appendChild(opt);
        }
    } catch (error) {
        console.error(error);
        // The main library is down, but the GN Originals may still work
        const originals = (await originalsPromise).concat(await partnersPromise, await ubzonePromise);
        if (originals.length) {
            zones = typeof applyJamPreference === "function" ? applyJamPreference(originals) : originals;
            sortZones();
            showSourceNotice("Couldn't reach the main game library right now, so only GN Originals are showing. Refresh in a few minutes to try again.");
            return;
        }
        container.textContent = "Couldn't reach the game library from any source. Check your internet connection and refresh the page in a few minutes.";
    }
}
// Play counts come from jsDelivr's download stats for the game library.
// Game files are named like "70.html", "33-ff.html" or "253-update2.html";
// every file for the same game number is added together. Stats are paged
// (100 files per page), so all pages are read, and the result is cached.
const POPULARITY_CACHE_KEY = "gnmath-cache-popularity";
const POPULARITY_CACHE_MS = 3 * 60 * 60 * 1000;
function loadCachedPopularity() {
    try {
        const c = JSON.parse(localStorage.getItem(POPULARITY_CACHE_KEY));
        if (c && c.data) {
            for (const [period, map] of Object.entries(c.data)) popularityData[period] = map;
            return Date.now() - c.t < POPULARITY_CACHE_MS;
        }
    } catch {}
    return false;
}
async function fetchPopularity(duration) {
    const map = {};
    const url = p => `https://data.jsdelivr.com/v1/stats/packages/gh/freebuisness/html@main/files?period=${duration}&limit=100&page=${p}`;
    let page = 1, done = false, ok = false;
    while (!done && page <= 20) {
        const batch = [page, page + 1, page + 2, page + 3];
        const results = await Promise.all(batch.map(p => fetch(url(p)).then(r => (r.ok ? r.json() : null)).catch(() => null)));
        for (const data of results) {
            if (!Array.isArray(data) || data.length === 0) { done = true; break; }
            ok = true;
            for (const file of data) {
                const m = typeof file.name === "string" && file.name.match(/^\/(\d+)(?:[-_.][^/]*)?\.html$/);
                if (!m) continue;
                map[m[1]] = (map[m[1]] || 0) + (file.hits?.total ?? 0);
            }
            if (data.length < 100) { done = true; break; }
        }
        page += batch.length;
    }
    if (ok) popularityData[duration] = map;
    else if (!popularityData[duration]) popularityData[duration] = {};
    return ok;
}
async function refreshPopularity() {
    const results = await Promise.all(["year", "month", "week", "day"].map(fetchPopularity));
    tagCardRarity();   // cards drawn before the play counts arrived
    if (results.some(Boolean)) {
        try { localStorage.setItem(POPULARITY_CACHE_KEY, JSON.stringify({ t: Date.now(), data: popularityData })); } catch {}
    }
}


function sortZones() {
    const sortBy = sortOptions.value;
    if (sortBy === 'name') {
        zones.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'id') {
        zones.sort((a, b) => a.id - b.id);
    } else if (sortBy === 'popular') {
        zones.sort((a, b) => ((popularityData['year']?.[b.id]) ?? 0) - ((popularityData['year']?.[a.id]) ?? 0));
    } else if (sortBy === 'trendingMonth') {
        zones.sort((a, b) => ((popularityData['month']?.[b.id]) ?? 0) - ((popularityData['month']?.[a.id]) ?? 0));
    } else if (sortBy === 'trendingWeek') {
        zones.sort((a, b) => ((popularityData['week']?.[b.id]) ?? 0) - ((popularityData['week']?.[a.id]) ?? 0));
    } else if (sortBy === 'trendingDay') {
        zones.sort((a, b) => ((popularityData['day']?.[b.id]) ?? 0) - ((popularityData['day']?.[a.id]) ?? 0));
    } else if (sortBy === 'newest') {
        // GN Originals sit after the library here; they're always in their own row
        const addedKey = z => (typeof isOriginalZone === "function" && isOriginalZone(z)) ? -2 : Number(z.id);
        zones.sort((a, b) => addedKey(b) - addedKey(a));
    } else if (sortBy === 'topRated') {
        zones.sort((a, b) => ratingScore(b.id) - ratingScore(a.id) || a.name.localeCompare(b.name));
    } else if (sortBy === 'myPlaytime') {
        zones.sort((a, b) => getPlaytime(b.id) - getPlaytime(a.id) || a.name.localeCompare(b.name));
    }
    zones.sort((a, b) => (a.id === -1 ? -1 : b.id === -1 ? 1 : 0));
    if (featuredContainer.innerHTML === "") {
        const featured = zones.filter(z => z.featured);
        displayFeaturedZones(featured);
    }
    applyFilters();
    renderPersonalRows();
    if (typeof updateFilterCounts === "function") updateFilterCounts();
}

// Rarity from real play counts (this year), used by the Trading cards style:
// top 2% of played games are legendary, next 8% epic, next 20% rare, the rest common.
let rarityCache = null, raritySource = null;
function zoneRarity(id) {
    const plays = popularityData["year"];
    if (!plays) return "common";
    if (raritySource !== plays) {
        raritySource = plays;
        const counts = Object.values(plays).filter(n => n > 0).sort((a, b) => b - a);
        const at = f => counts[Math.max(0, Math.floor(counts.length * f) - 1)] ?? Infinity;
        rarityCache = counts.length ? { legendary: at(.02), epic: at(.10), rare: at(.30) } : null;
    }
    const n = plays[id] || 0;
    if (!rarityCache || n <= 0) return "common";
    return n >= rarityCache.legendary ? "legendary" : n >= rarityCache.epic ? "epic" : n >= rarityCache.rare ? "rare" : "common";
}
function tagCardRarity() {
    document.querySelectorAll(".zone-item[data-id]").forEach(c => { c.dataset.rarity = zoneRarity(c.dataset.id); });
}

function createZoneCard(file) {
    const zoneItem = document.createElement("div");
    zoneItem.className = "zone-item";
    zoneItem.dataset.id = file.id;
    zoneItem.dataset.rarity = zoneRarity(file.id);
    // short vending-machine code (row letter + number) for the Vending machine style
    { const n = Math.abs(parseInt(file.id, 10) || 0); zoneItem.dataset.slot = "ABCDEFGH"[n % 8] + (10 + (Math.floor(n / 8) % 90)); }
    zoneItem.onclick = () => openZone(file);
    // Mouse resting on a card: start loading that game so it opens faster
    let hoverTimer = null;
    zoneItem.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") hoverTimer = setTimeout(() => prefetchZone(file), 150); });
    zoneItem.addEventListener("pointerleave", () => clearTimeout(hoverTimer));

    const img = document.createElement("img");
    if (typeof isPartnerZone === "function" && isPartnerZone(file)) img.dataset.placeholder = coverPlaceholder(file.name);
    setCoverImage(img, file.cover, true);
    img.alt = file.name;
    img.loading = "lazy";
    img.className = "lazy-zone-img";
    zoneItem.appendChild(img);

    const button = document.createElement("button");
    button.textContent = file.name;
    button.onclick = (event) => {
        event.stopPropagation();
        openZone(file);
    };
    zoneItem.appendChild(button);

    // Favorite star
    const fav = document.createElement("button");
    fav.className = "card-fav" + (isFavorite(file.id) ? " on" : "");
    fav.textContent = isFavorite(file.id) ? "★" : "☆";
    fav.title = isFavorite(file.id) ? "Remove from favorites" : "Add to favorites";
    fav.setAttribute("aria-label", fav.title);
    fav.onclick = (event) => { event.stopPropagation(); toggleFavorite(file.id); };
    zoneItem.prepend(fav);

    // Badges: NEW for recently added games, warning for games many people reported broken
    const stats = getZoneStats(file.id);
    const badges = document.createElement("div");
    badges.className = "card-badges";
    if (isNewZone(file.id)) {
        const nb = document.createElement("div");
        nb.className = "card-new";
        nb.textContent = "NEW";
        nb.title = "Recently added";
        badges.appendChild(nb);
    }
    if (isFlaggedBroken(stats)) {
        const flag = document.createElement("div");
        flag.className = "card-flag";
        if (stats.reports >= BROKEN_FLAG_THRESHOLD) {
            flag.textContent = `⚠ ${stats.reports} broken reports`;
            flag.title = `${stats.reports} people reported this game as broken in the last ${BROKEN_REPORT_DAYS} days. It may not load.`;
        } else {
            flag.textContent = "⚠ Reported broken";
            flag.title = "A site moderator reported this game as broken. It may not load.";
        }
        badges.appendChild(flag);
    }
    // Partner games (html5games.com) may show their publisher's ads, so say so up front
    if (typeof isPartnerZone === "function" && isPartnerZone(file)) {
        zoneItem.classList.add("is-partner");
        badges.classList.add("has-ad");
        badges.prepend(makeAdBadge());
    }
    if (badges.childElementCount) zoneItem.appendChild(badges);

    // Your play time + community rating
    const metaParts = [];
    const played = getPlaytime(file.id);
    if (played >= 60) metaParts.push("⏱ " + formatPlaytime(played));
    const votes = stats.up + stats.down;
    if (votes >= MIN_VOTES_TO_SHOW) metaParts.push(`👍 ${Math.round(stats.up / votes * 100)}%`);
    if (cardCached("showPlays", getShowPlayCount)) {
        const plays = (popularityData['year']?.[file.id]) ?? 0;
        if (plays > 0) metaParts.push(`${compactNumber.format(plays)} plays`);
    }
    if (metaParts.length) {
        const meta = document.createElement("div");
        meta.className = "card-meta";
        metaParts.forEach(t => { const span = document.createElement("span"); span.textContent = t; meta.appendChild(span); });
        zoneItem.appendChild(meta);
    }

    return zoneItem;
}

// One shared watcher for every card picture. Each redraw used to make a new one
// and never stop the old ones, so they piled up and kept every old card in memory.
let lazyImageObserver = null;
function getLazyImageObserver() {
    if (!lazyImageObserver) {
        lazyImageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !zoneViewer.hidden) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.remove("lazy-zone-img");
                    observer.unobserve(img);
                }
            });
        }, { rootMargin: "100px", threshold: 0.1 });
    }
    return lazyImageObserver;
}
function observeLazyImages(imgs) {
    const observer = getLazyImageObserver();
    imgs.forEach(img => observer.observe(img));
}
function observeLazyZoneImages(selector) {
    observeLazyImages(document.querySelectorAll(selector));
}
// Empty a card area, letting go of the pictures it was watching
function clearCards(el) {
    if (!el) return;
    if (lazyImageObserver) el.querySelectorAll("img.lazy-zone-img").forEach(img => lazyImageObserver.unobserve(img));
    el.innerHTML = "";
}

function setSectionTitle(el, title, count) {
    if (!el) return;
    el.textContent = title;
    if (typeof count === "number") {
        const c = document.createElement("span");
        c.className = "section-count";
        c.textContent = count;
        el.appendChild(c);
    }
}

function displayFeaturedZones(featuredZones) {
    clearCards(featuredContainer);
    const visibleFeaturedZones = featuredZones.filter(file => !isZoneDisabled(file.id));
    visibleFeaturedZones.forEach(file => {
        featuredContainer.appendChild(createZoneCard(file));
    });
    if (featuredContainer.innerHTML === "") {
        featuredContainer.textContent = "No featured games right now.";
    } else {
        setSectionTitle(document.getElementById("allZonesSummary"), "Featured", visibleFeaturedZones.length);
    }

    observeLazyZoneImages('#featuredZones img.lazy-zone-img');
    if (typeof renderOriginalsShelf === "function") renderOriginalsShelf();
}
// All games is drawn in pieces: the first screenful right away, then more only as
// you scroll toward the end of the list. Keeping the page small (instead of all
// ~2,000 cards at once) makes hovering, scrolling and animated styles much
// smoother on slow computers. renderAllZones() builds the rest at once, for the
// scroll-to-bottom button and the browser's find (Ctrl+F). A newer draw cancels an older one.
const FIRST_CARD_BATCH = 48;
const MORE_CARD_BATCH = 40;
let zonesDrawId = 0;
let zonesRest = null;          // the cards not built yet: { list, next, add }
let zonesSentinel = null, zonesSentinelObserver = null;
function zonesSentinelEl() {
    if (zonesSentinel) return zonesSentinel;
    zonesSentinel = document.createElement("div");
    zonesSentinel.id = "zonesMore";
    zonesSentinel.setAttribute("aria-hidden", "true");
    container.after(zonesSentinel);
    if ("IntersectionObserver" in window) {
        // start building the next batch well before you reach the end
        zonesSentinelObserver = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) renderMoreZones();
        }, { rootMargin: "0px 0px 1600px 0px" });
        zonesSentinelObserver.observe(zonesSentinel);
    }
    return zonesSentinel;
}
function renderMoreZones(count = MORE_CARD_BATCH) {
    const rest = zonesRest;
    if (!rest || rest.next >= rest.list.length) return;
    rest.add(count);
    if (rest.next >= rest.list.length) { zonesRest = null; zonesSentinelEl().hidden = true; }
    else {
        // still on screen after this batch (tall window or a fast scroll): keep going
        requestAnimationFrame(() => {
            if (zonesRest !== rest || !zonesSentinel) return;
            const r = zonesSentinel.getBoundingClientRect();
            if (r.top < innerHeight + 1600 && r.bottom > -1600) renderMoreZones();
        });
    }
}
function renderAllZones() { if (zonesRest) renderMoreZones(Infinity); }
window.renderAllZones = renderAllZones;
function displayZones(zones) {
    const drawId = ++zonesDrawId;
    zonesRest = null;
    clearCards(container);
    const sentinel = zonesSentinelEl();
    sentinel.hidden = true;
    const visibleZones = zones.filter(file => !isZoneDisabled(file.id));
    if (!visibleZones.length) {
        container.textContent = "No games found.";
        return;
    }
    setSectionTitle(document.getElementById("allSummary"), "All games", visibleZones.length);

    const rest = { list: visibleZones, next: 0 };
    rest.add = count => withCardCache(() => {
        if (drawId !== zonesDrawId) return;
        const frag = document.createDocumentFragment();
        const imgs = [];
        const stop = Math.min(visibleZones.length, rest.next + count);
        while (rest.next < stop) {
            const card = createZoneCard(visibleZones[rest.next++]);
            const img = card.querySelector("img.lazy-zone-img");
            if (img) imgs.push(img);
            frag.appendChild(card);
        }
        container.appendChild(frag);
        observeLazyImages(imgs);
    });
    rest.add(FIRST_CARD_BATCH);
    if (rest.next < visibleZones.length) {
        zonesRest = rest;
        sentinel.hidden = false;
        // if the first batch doesn't fill the window, the observer fires right away
        if (!zonesSentinelObserver) renderAllZones();
    }
}
// The browser's find (Ctrl+F / Cmd+F) can only find games that are on the page
document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "f" || e.key === "F")) renderAllZones();
}, true);

// ── Search ──────────────────────────────────────────────────────────────────
// Search and the tag filter work together. Matching ignores case, accents and
// punctuation, and tolerates small typos ("geomtry dash", "minecarft").
function normText(t) {
    return String(t ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ").trim();
}
// Levenshtein distance, giving up early once it exceeds max
function editDistanceWithin(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            // swapped neighbours count as one typo ("geomtery" -> "geometry")
            if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur.push(v);
            rowMin = Math.min(rowMin, v);
        }
        if (rowMin > max) return max + 1;
        prev2 = prev;
        prev = cur;
    }
    return prev[b.length];
}
function tokenScore(token, words, extraWords) {
    let best = 0;
    const allowed = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
    for (const w of words) {
        if (w === token) return 12;
        if (w.startsWith(token)) best = Math.max(best, 10);
        else if (token.length >= 2 && w.includes(token)) best = Math.max(best, 7);
        else if (allowed) {
            if (editDistanceWithin(token, w, allowed) <= allowed) best = Math.max(best, 6);
            else if (w.length > token.length && editDistanceWithin(token, w.slice(0, token.length), allowed) <= allowed) best = Math.max(best, 5);
        }
    }
    if (!best) for (const w of extraWords) {
        if (w === token || (token.length >= 3 && w.startsWith(token))) best = Math.max(best, 4);
    }
    return best;
}
function searchScore(zone, query, tokens) {
    const name = normText(String(zone.name ?? "").replace(/['’]/g, ""));
    const words = name.split(" ");
    const initials = words.map(w => w[0] || "").join("");
    const extra = normText([zone.author, ...(zone.special || [])].join(" ")).split(" ").filter(Boolean);
    let score = 0;
    if (name === query) score += 100;
    else if (name.startsWith(query)) score += 60;
    else if (name.includes(query)) score += 40;
    else if (name.replace(/ /g, "").includes(query.replace(/ /g, ""))) score += 35;
    let tokenTotal = 0;
    for (const t of tokens) {
        let ts = tokenScore(t, words, extra);
        // Abbreviations: "fnaf" -> Five Nights At Freddys, "botw", "gta"
        if (!ts && t.length >= 2 && /[a-z]/.test(t) && initials.startsWith(t)) ts = 8;
        if (!ts && score < 35) return 0;   // every word you typed has to match something
        tokenTotal += ts;
    }
    return score + tokenTotal;
}
function applyFilters() {
    if (!Array.isArray(zones)) return;
    const query = normText(searchBar.value);
    const tag = typeof filterOptions !== "undefined" ? filterOptions.value : "none";
    let list = zones;
    if (tag && tag !== "none") list = list.filter(zone => zone.special?.includes(tag));
    const extra = typeof gameMatchesExtraFilters === "function" && typeof extraFiltersActive === "function" && extraFiltersActive();
    if (extra) list = list.filter(gameMatchesExtraFilters);
    if (query) {
        const tokens = query.split(" ");
        list = list.map(zone => [zone, searchScore(zone, query, tokens)])
            .filter(([, sc]) => sc > 0)
            .sort((a, b) => b[1] - a[1])          // stable: equal scores keep the chosen sort order
            .map(([zone]) => zone);
    }
    if (query || (tag && tag !== "none") || extra) {
        document.getElementById("featuredZonesWrapper").removeAttribute("open");
        document.getElementById("originalsWrapper")?.removeAttribute("open");
    }
    displayZones(list);
    const summary = document.getElementById("allSummary");
    if (query && summary) setSectionTitle(summary, `Results for "${searchBar.value.trim()}"`, list.filter(z => !isZoneDisabled(z.id)).length);
    if (!query && extra && summary) setSectionTitle(summary, "Filtered games", list.filter(z => !isZoneDisabled(z.id)).length);
    if (query && !list.length) container.textContent = `No games match "${searchBar.value.trim()}".`;
    else if (!list.length && (extra || (tag && tag !== "none"))) container.textContent = "No games match these filters. Try Reset in the Sort & filter menu.";
    if (typeof updateFilterDot === "function") updateFilterDot();
}
// Kept for the existing oninput/onchange handlers
function filterZones2() { applyFilters(); }
function filterZones() { applyFilters(); }

// ── Ad removal for game files ───────────────────────────────────────────────
// The upstream game files carry a scrambled ad loader (cdn.r9x.in) that pops up
// a fake "Download" ad pushing a browser-hijacker extension, plus an anti-adblock
// trap that wipes the page if its ad box is removed. We strip the loader before
// the game runs (so the trap never starts) and block known ad hosts as a backup.
const AD_HOST_PATTERN = "(^|\\.)(googletagmanager\\.com|google-analytics\\.com|analytics\\.google\\.com|r9x\\.in|googlesyndication\\.com|doubleclick\\.net|adnxs\\.com|adsterra\\.com|highperformanceformat\\.com|effectivegatecpm\\.com|profitableratecpm\\.com|propellerads\\.com|popads\\.net|a-ads\\.com|mc\\.yandex\\.ru|yandex\\.ru|yandex\\.net|igroutka\\.ru|id\\.net|playtomic\\.com|stats\\.unity3d\\.com|cloud\\.unity3d\\.com|unblockedgamesroblox\\.weebly\\.com|gamemonetize\\.com|gamedistribution\\.com|cpmstar\\.com|adinplay\\.com|api\\.adinplay\\.com|imasdk\\.googleapis\\.com|poki\\.io|poki-gdn\\.com|crazygames\\.com|improvedigital\\.com|prebid\\.org|clarity\\.ms|hotjar\\.com|statcounter\\.com|histats\\.com|cloudflareinsights\\.com)$";

function isObfuscatedAdScript(code) {
    if (/r9x\.in/i.test(code)) return true;
    // javascript-obfuscator output: huge runs of parseInt(0x..) arithmetic plus
    // its anti-debug/self-defend markers. Real game code here never looks like this.
    const hexCalls = (code.match(/parseInt\(0x/g) || []).length;
    const markers = /\(\(\(\.\+\)\+\)\+\)\+\$|randomUUID|new TextDecoder|\.constructor\("return this"\)/.test(code);
    return hexCalls >= 25 && markers;
}

// Markers of the malicious script found in the game library on Oct 11, 2026.
// A game file containing them is never run.
const BAD_GAME_MARKERS = [/data-r=["']c7a94e["']/i, /xa0f20fba9693cbb2c66516f1/, /__gnGameAd/];
function isKnownBadGame(html) { return typeof html === "string" && BAD_GAME_MARKERS.some(re => re.test(html)); }
// Some Unity games are split into parts (Build.data.part1, .part2…) that the
// page downloads and joins with mergeFiles(). A few pages (e.g. SpiderDoll)
// join them and then ignore the result, telling Unity to load "Build.data",
// which doesn't exist, so the game never starts. Point Unity at the joined
// files instead.
// ── Split-file guard (runs inside game pages) ───────────────────────────────
// Big games come in pieces (Build.data.part1, .part2…) that they download, join
// and often save in the browser. A piece cut off mid-download used to make a
// broken joined file, and games that saved it failed on every load after.
// config/part-sizes.json (tools/build_part_sizes.py) has every piece's size;
// the pieces for one page are passed in as SIZES. This re-downloads short
// pieces, and stops a short joined file from being saved or used.
function partGuardHook(SIZES, BIG) {
    BIG = BIG || {};
    var ALIASES = ["latest", "HEAD", "main", "master"];
    function where(url) {
        var u; try { u = new URL(url, document.baseURI); } catch (e) { return null; }
        var m = null, h = u.hostname;
        if (/(^|\.)jsdelivr\.net$/.test(h)) m = u.pathname.match(/^\/gh\/([^\/]+)\/([^\/@]+)(?:@([^\/]+))?\/(.*)$/);
        else if (/githubusercontent\.com$|githack\.com$/.test(h)) m = u.pathname.match(/^\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.*)$/);
        if (!m) return null;
        var path; try { path = decodeURIComponent(m[4]); } catch (e) { path = m[4]; }
        return { repo: m[1] + "/" + m[2], ref: m[3] || "latest", path: path };
    }
    // Locked to an exact commit: the file can never change, so a wrong size is always a bad download
    function locked(url) { var w = where(url); return !!(w && /^[0-9a-f]{40}$/i.test(w.ref)); }
    function sizeOf(url) {
        var w = where(url); if (!w) return null;
        var refs = [w.ref].concat(ALIASES.indexOf(w.ref) >= 0 ? ALIASES : []);
        for (var i = 0; i < refs.length; i++) {
            var list = SIZES[w.repo + "@" + refs[i]];
            if (list && list[w.path] != null) return list[w.path];
        }
        return null;
    }
    // Joined files: "Build/X.data" = all of its pieces added up
    var joined = {};
    for (var k in SIZES) for (var p in SIZES[k]) {
        var base = p.replace(/\.part\d+$/, "");
        joined[base] = (joined[base] || 0) + SIZES[k][p];
    }
    function joinedSize(key) {
        var s = typeof key === "string" ? key : (key && key.url) || String(key);
        s = s.split("?")[0]; try { s = decodeURIComponent(s); } catch (e) {}
        var name = s.split("/").pop(), found = null;
        for (var b in joined) {
            if (b === s || b.split("/").pop() === name) {
                if (found !== null && found !== joined[b]) return null;  // same name, different sizes: can't tell
                found = joined[b];
            }
        }
        return found;
    }
    var note = function (m) { try { console.warn("[GN 2.0] " + m); } catch (e) {} };

    // Files over jsDelivr's 20 MB limit (it won't serve them): get them from GitHub,
    // or githack (which also serves scripts with the right type)
    function bigAlt(url, forScript) {
        var w = where(url);
        if (!w || !/jsdelivr\.net$/.test(new URL(url, document.baseURI).hostname)) return null;
        var refs = [w.ref].concat(ALIASES.indexOf(w.ref) >= 0 ? ALIASES : []), hit = false;
        for (var i = 0; i < refs.length && !hit; i++) { var l = BIG[w.repo + "@" + refs[i]]; if (l && l.indexOf(w.path) >= 0) hit = true; }
        if (!hit) return null;
        var ref = ALIASES.indexOf(w.ref) >= 0 ? "HEAD" : w.ref, path = w.path.split("/").map(encodeURIComponent).join("/");
        var githubDown = false; try { githubDown = !!(window.parent.mirrorDown && window.parent.mirrorDown.has("github")); } catch (e) {}
        return forScript || githubDown ? "https://rawcdn.githack.com/" + w.repo + "/" + ref + "/" + path
                                       : "https://raw.githubusercontent.com/" + w.repo + "/" + ref + "/" + path;
    }
    try {
        var xo = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, url) {
            var alt = bigAlt(String(url));
            if (alt) { arguments[1] = alt; note("Big file from GitHub: " + String(url).split("/").pop()); }
            return xo.apply(this, arguments);
        };
        var SD = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
        if (SD && SD.set) Object.defineProperty(HTMLScriptElement.prototype, "src", { configurable: true, enumerable: SD.enumerable, get: SD.get,
            set: function (v) { var alt = bigAlt(String(v), true); SD.set.call(this, alt || v); } });
        var sa = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (n, v) {
            if (this instanceof HTMLScriptElement && /^src$/i.test(n)) { var alt = bigAlt(String(v), true); if (alt) v = alt; }
            return sa.call(this, n, v);
        };
    } catch (e) {}

    var origFetch = window.fetch;
    if (origFetch) window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || String(input);
        var alt = bigAlt(url);
        if (alt) {
            note("Big file from GitHub: " + url.split("/").pop());
            arguments[0] = typeof input === "string" || !(input instanceof Request) ? alt : new Request(alt, input);
            input = arguments[0]; url = alt;
        }
        var method = (init && init.method) || (input && input.method) || "GET";
        if (!/\.part\d+(\?|#|$)/.test(url) || String(method).toUpperCase() !== "GET") return origFetch.apply(this, arguments);
        var want = sizeOf(url), fixed = locked(url), self = this, first = arguments, seen = {};
        var tryOnce = function (n) {
            var args = n === 1 ? first : [url, Object.assign({}, init || {}, { cache: "reload" })];
            return origFetch.apply(self, args).then(function (res) {
                if (!res.ok) return res;
                var cl = Number(res.headers.get("content-length")) || 0;
                return res.arrayBuffer().then(function (buf) {
                    var got = buf.byteLength;
                    var expect = want != null ? want : (cl && got < cl ? cl : null);
                    // Right size or no size known. A file on a branch (e.g. @main) may really
                    // have changed since the size list was made: the same size twice means that.
                    if (expect == null || got === expect || (seen[got] && !fixed)) {
                        return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
                    }
                    seen[got] = true;
                    note(url + " arrived incomplete (" + got + " of " + expect + " bytes)" + (n < 4 ? ", downloading it again" : ""));
                    if (n >= 4) {
                        try { window.parent.__gnmathGameError({ kind: "download", message: "Piece kept arriving incomplete after 4 tries", stack: url + " (" + got + " of " + expect + " bytes)" }); } catch (e) {}
                        throw new TypeError("Incomplete download: " + url);
                    }
                    return new Promise(function (r) { setTimeout(r, 800 * n); }).then(function () { return tryOnce(n + 1); });
                });
            });
        };
        return tryOnce(1);
    };

    var isShort = function (key, res) {
        var want = joinedSize(key);
        if (want == null || !res) return Promise.resolve(false);
        // Only "too small" counts: a game may save a bigger, unpacked version
        return res.clone().blob().then(function (b) { return b.size < want; }, function () { return false; });
    };
    try {
        var CP = window.Cache && Cache.prototype;
        if (CP) {
            var put = CP.put, match = CP.match;
            CP.put = function (key, res) {
                var self = this, args = arguments;
                return isShort(key, res).then(function (short) {
                    if (short) { note("Not saving " + key + ": it's incomplete"); return undefined; }
                    return put.apply(self, args);
                });
            };
            CP.match = function (key) {
                var self = this;
                return match.apply(this, arguments).then(function (res) {
                    return isShort(key, res).then(function (short) {
                        if (!short) return res;
                        note("Saved copy of " + key + " is incomplete; downloading it again");
                        try { self.delete(key); } catch (e) {}
                        return undefined;
                    });
                });
            };
        }
        var SP = window.CacheStorage && CacheStorage.prototype;
        if (SP && SP.match) {
            var smatch = SP.match;
            SP.match = function (key) {
                return smatch.apply(this, arguments).then(function (res) {
                    return isShort(key, res).then(function (short) { return short ? undefined : res; });
                });
            };
        }
    } catch (e) {}
}

// Sizes of split game files (config/part-sizes.json), loaded when the first game opens
let gamePartSizes = null, gameBigFiles = {}, partSizesPromise = null;
function loadPartSizes() {
    if (!partSizesPromise) partSizesPromise = fetch("config/part-sizes.json")
        .then(r => r.ok ? r.json() : null)
        .then(j => { gamePartSizes = (j && j.repos) || {}; gameBigFiles = (j && j.big) || {}; })
        .catch(() => { gamePartSizes = {}; });
    return partSizesPromise;
}
// The pieces one game page can load: repos (and folders) it links to
function partSizesForPage(html) {
    if (!gamePartSizes) return null;
    const split = /\.part\d|getParts|mergeFiles/i.test(html);
    const rxs = [
        /https?:\/\/(?:cdn|fastly|gcore|testingcf)\.jsdelivr\.net\/gh\/([\w.-]+)\/([\w.-]+)(?:@([\w./-]+?))?\/([^"'\s)<>`]*)/g,
        /https?:\/\/(?:raw\.githubusercontent\.com|rawcdn\.githack\.com|raw\.githack\.com)\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/([^"'\s)<>`]*)/g
    ];
    const dirs = new Map();  // "repo@ref" → folders used
    for (const rx of rxs) for (const m of html.matchAll(rx)) {
        const key = `${m[1]}/${m[2]}@${m[3] || "latest"}`;
        const dir = m[4].includes("/") ? m[4].slice(0, m[4].lastIndexOf("/") + 1) : "";
        if (!dirs.has(key)) dirs.set(key, new Set());
        dirs.get(key).add(dir);
    }
    const out = {}, big = {};
    for (const [key, set] of dirs) {
        const [repo, ref] = key.split("@");
        const refs = [ref, ...(["latest", "HEAD", "main", "master"].includes(ref) ? ["latest", "HEAD", "main", "master"] : [])];
        const bigKey = refs.map(r => `${repo}@${r}`).find(k => gameBigFiles[k]);
        if (bigKey) big[`${repo}@${ref}`] = gameBigFiles[bigKey];
        const listKey = split && refs.map(r => `${repo}@${r}`).find(k => gamePartSizes[k]);
        if (!listKey) continue;
        // Use the specific folders; a link at the repo's top level (e.g. a shared script) doesn't count
        const folders = [...set].filter(Boolean);
        const pick = {};
        for (const [path, size] of Object.entries(gamePartSizes[listKey])) {
            if (!folders.length || folders.some(f => path.startsWith(f))) pick[path] = size;
        }
        if (Object.keys(pick).length) out[`${repo}@${ref}`] = pick;
    }
    return Object.keys(out).length || Object.keys(big).length ? { sizes: out, big } : null;
}
// <script src> written in the game page itself: point big ones at githack
function rewriteBigScripts(html, big) {
    if (!big || !Object.keys(big).length) return html;
    const base = (html.match(/<base\s[^>]*href=["']([^"']+)/i) || [])[1] || "";
    return html.replace(/(<script\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (all, a, src, b) => {
        let u; try { u = new URL(src, base || undefined); } catch { return all; }
        const m = u.hostname.endsWith("jsdelivr.net") && u.pathname.match(/^\/gh\/([^/]+)\/([^/@]+)(?:@([^/]+))?\/(.*)$/);
        if (!m) return all;
        const ref = m[3] || "latest", path = decodeURIComponent(m[4]);
        const list = big[`${m[1]}/${m[2]}@${ref}`];
        if (!list || !list.includes(path)) return all;
        return a + `https://rawcdn.githack.com/${m[1]}/${m[2]}/${["latest", "main", "master"].includes(ref) ? "HEAD" : ref}/${m[4]}` + b;
    });
}

function fixMergedUnityParts(html) {
    const re = /Promise\.all\(\[\s*(?:window\.)?mergeFiles\((?:window\.)?getParts\(\s*"([^"]+)"\s*,\s*\d+\s*,\s*\d+\s*\)\)\s*,\s*(?:window\.)?mergeFiles\((?:window\.)?getParts\(\s*"([^"]+)"\s*,\s*\d+\s*,\s*\d+\s*\)\)\s*,?\s*\]\)\s*\.then\(\s*\(\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*\)\s*=>\s*\{/;
    const m = html.match(re);
    if (!m) return html;
    const [whole, file0, file1] = m;
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let fixed = html.replace(whole, whole.replace(/\(\s*\[\s*\w+\s*,\s*\w+\s*\]\s*\)/, "([__gnMerged0, __gnMerged1])"));
    let changed = 0;
    [[file0, "__gnMerged0"], [file1, "__gnMerged1"]].forEach(([file, v]) => {
        fixed = fixed.replace(new RegExp(`((?:dataUrl|codeUrl|frameworkUrl)\\s*:\\s*)(["'])(?:[^"']*\\/)?${esc(file.replace(/^.*\//, ""))}\\2`, "g"), (all, key) => { changed++; return key + v; });
    });
    if (!changed) return html;
    console.info("Pointed Unity at the joined game files");
    return fixed;
}

function cleanGameHtml(html) {
    if (typeof html !== "string") return html;
    if (isKnownBadGame(html)) { const e = new Error("This game file contains a known malicious script"); e.blocked = true; throw e; }
    // Some library files contain the whole page twice, one after the other. The
    // game then starts twice on the same canvas and crashes (Unity: "null function"),
    // so keep only the first copy.
    const firstEnd = html.search(/<\/html\s*>/i);
    if (firstEnd !== -1 && /<html\b/i.test(html.slice(firstEnd))) {
        html = html.slice(0, firstEnd) + "</html>";
        console.info("Removed a duplicated copy of the game page");
    }
    html = fixMergedUnityParts(html);
    let removed = 0;
    let out = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs, code) => {
        const src = (attrs.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
        if (src && new RegExp(AD_HOST_PATTERN, "i").test((() => { try { return new URL(src, "https://x/").hostname; } catch { return ""; } })())) {
            removed++; return "";
        }
        if (!src && isObfuscatedAdScript(code)) { removed++; return ""; }
        // Inline Google Analytics setup: window.dataLayer / gtag('config', 'G-…')
        if (!src && code.length < 3000 && /gtag\(\s*['"](config|js)['"]|googletagmanager|google-analytics/.test(code)) { removed++; return ""; }
        return whole;
    });
    // Empty side-banner ad slots
    out = out.replace(/<div id="sidebarad[12]">\s*<div class="sidebar-close"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "");
    // Backup: if any ad script survives, stop it from loading anything from ad hosts.
    const guard = `<script>window.dataLayer=[];window.gtag=function(){};window.ga=function(){};(function(){var bad=new RegExp(${JSON.stringify(AD_HOST_PATTERN)},"i");` +
        `function blocked(u){try{return bad.test(new URL(u,location.href).hostname)}catch(e){return false}}` +
        `[window.HTMLScriptElement,window.HTMLIFrameElement].forEach(function(C){if(!C)return;var d=Object.getOwnPropertyDescriptor(C.prototype,"src");` +
        `if(!d||!d.set)return;Object.defineProperty(C.prototype,"src",{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){if(blocked(v))return;d.set.call(this,v)}})});` +
        `var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(/^src$/i.test(n)&&(this instanceof HTMLScriptElement||this instanceof HTMLIFrameElement)&&blocked(v))return;return sa.apply(this,arguments)};` +
        `try{var of=window.fetch;if(of)window.fetch=function(u){try{if(blocked(typeof u==="string"?u:u&&u.url))return Promise.resolve(new Response("",{status:204}))}catch(e){}return of.apply(this,arguments)};` +
        `var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){if(blocked(u)){arguments[1]="data:,";}return xo.apply(this,arguments)};` +
        `if(navigator.sendBeacon){var sb=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u){return blocked(u)?true:sb.apply(null,arguments)}}` +
        `var ID=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");if(ID&&ID.set)Object.defineProperty(HTMLImageElement.prototype,"src",{configurable:true,enumerable:ID.enumerable,get:ID.get,set:function(v){if(blocked(v))return;ID.set.call(this,v)}});` +
        `var WS=window.WebSocket;if(WS){window.WebSocket=function(u,p){if(blocked(u))throw new DOMException("Blocked","SecurityError");return p===undefined?new WS(u):new WS(u,p)};window.WebSocket.prototype=WS.prototype;["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(k){window.WebSocket[k]=WS[k]})}}catch(e){}` +
        `})();<\/script><style>#sidebarad1,#sidebarad2{display:none!important}</style>` +
        // Game files load from other sites, so their stylesheets can't be read from
        // here. Some game plugins (e.g. Newgrounds.io in Unity games) read every
        // stylesheet when they start and crash on that; give them an empty list.
        `<script>(function(){try{var P=CSSStyleSheet.prototype;["cssRules","rules"].forEach(function(k){var d=Object.getOwnPropertyDescriptor(P,k);` +
        `if(!d||!d.get)return;Object.defineProperty(P,k,{configurable:true,enumerable:d.enumerable,get:function(){try{return d.get.call(this)}catch(e){return []}}})})}catch(e){}})();<\/script>` +
        (typeof gameProgressHook === "function" ? `<script>(${gameProgressHook.toString()})();<\/script>` : "") +
        (typeof gameDataHook === "function" ? `<script>(${gameDataHook.toString()})();<\/script>` : "") +
        (typeof gameErrorHook === "function" ? `<script>(${gameErrorHook.toString()})();<\/script>` : "") +
        // Last, so it wraps the loading bar's fetch hook and sees what the game sees
        ((g => g ? `<script>(${partGuardHook.toString()})(${JSON.stringify(g.sizes).replace(/</g, "\\u003c")}, ${JSON.stringify(g.big).replace(/</g, "\\u003c")});<\/script>` : "")(partSizesForPage(html)));
    out = rewriteBigScripts(out, (partSizesForPage(html) || {}).big);
    if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, m => m + guard);
    else if (/<!doctype[^>]*>/i.test(out)) out = out.replace(/<!doctype[^>]*>/i, m => m + guard);
    else out = guard + out;
    if (removed) console.info(`Removed ${removed} ad/tracker script(s) from game`);
    return out;
}

async function fetchWithFallback(rawUrl, onTry) {
    // Sizes of split game files, for the split-file guard (don't wait long for them)
    if (!gamePartSizes) await Promise.race([loadPartSizes(), new Promise(r => setTimeout(r, 3000))]);
    // Washed library games: from this site first, then its GitHub mirrors
    if (rawUrl.startsWith("washed:")) {
        const path = rawUrl.slice(7);
        const urls = [new URL(path, location.href).href, ...mirrorUrls("SCHSwork", "math", "main", path)];
        // "no-cache": always ask whether the page changed (cheap when it hasn't), so a
        // fixed game reaches players right away instead of after the 10-minute cache
        const html = await fetchFirst(urls, { timeoutMs: 30000, stagger: 2500, onTry, cache: "no-cache", validate: res => res.text() });
        return rewriteForMirrors(cleanGameHtml(html));
    }
    // GN Originals: "gh:owner/repo@sha/path"
    if (typeof parseGhUrl === "function" && parseGhUrl(rawUrl)) {
        let html = await fetchOriginalHtml(rawUrl, onTry);
        // UBZone games: keep their own links on the checked version (ubzone.js)
        if (typeof isUbzoneGhUrl === "function" && isUbzoneGhUrl(rawUrl)) html = pinUbzoneRefs(html);
        return rewriteForMirrors(html);
    }
    // Game pages: try every source (jsDelivr, GitHub, githack), working ones first
    const suffix = rawUrl.replace("{HTML_URL}", "").replace("{COVER_URL}", "").replace(/^\//, "");
    const isHtml = rawUrl.includes("{HTML_URL}");
    const candidates = isHtml
        ? mirrorUrls("freebuisness", "html", LIBRARY_REF, suffix)
        : [rawUrl.replace("{COVER_URL}", coverURL).replace("{HTML_URL}", htmlURL)];
    const html = await fetchFirst(candidates, { timeoutMs: 30000, stagger: 2500, onTry, validate: res => res.text() });
    return rewriteForMirrors(cleanGameHtml(html));
}

// Game pages started early (card hover). Kept briefly, at most a few.
const zonePrefetch = new Map();
function prefetchZone(file) {
    if (!file || !file.url || file.url.startsWith("http") || isZoneDisabled(file.id)) return;
    if (typeof isPartnerZone === "function" && isPartnerZone(file)) return;
    if (zonePrefetch.has(file.url)) return;
    const p = fetchWithFallback(file.url);
    p.catch(() => zonePrefetch.delete(file.url));
    zonePrefetch.set(file.url, p);
    setTimeout(() => zonePrefetch.delete(file.url), 120000);
    while (zonePrefetch.size > 4) zonePrefetch.delete(zonePrefetch.keys().next().value);
}
function loadZoneHtml(url) {
    const p = zonePrefetch.get(url);
    zonePrefetch.delete(url);
    const onTry = typeof noteGameSource === "function" ? noteGameSource : null;
    return p ? p.catch(() => fetchWithFallback(url, onTry)) : fetchWithFallback(url, onTry);
}

function openRandomZone() {
    // Skip external links and owner-disabled games
    // If a game is open, don't pick that same game again
    const currentId = zoneViewer.style.display === "flex" ? document.getElementById('zoneId').textContent : null;
    const playable = zones.filter(zone => zone.url && !zone.url.startsWith("http") && !isZoneDisabled(zone.id) && zone.id + '' !== currentId);
    if (playable.length === 0) {
        notify("Games are still loading. Try again in a second.");
        return;
    }
    openZone(playable[Math.floor(Math.random() * playable.length)]);
}

function openZone(file) {
    if (isZoneDisabled(file.id)) {
        notify(takedownRemovedIds.has(String(file.id)) ? "This game was removed after a request from its owner." : "This game has been turned off by the site owner.");
        return;
    }

    if (file.url.startsWith("http")) {
        window.open(file.url, "_blank");
    } else if (typeof isPartnerZone === "function" && isPartnerZone(file)) {
        // Partner game (html5games.com): plays from Famobi's own site and may show their ads
        document.getElementById('zoneName').textContent = file.name;
        document.getElementById('zoneId').textContent = file.id;
        document.getElementById('zoneAuthor').textContent = "by " + file.author;
        document.getElementById('zoneAuthor').href = file.authorLink;
        setPartnerNotice(file);
        zoneViewer.style.display = "flex";
        zoneViewer.hidden = false;
        addRecentZone(file.id);
        startPlaytime(file.id);
        currentGameId = String(file.id);
        updateRatingBar(file.id);
        if (typeof endGameLoad === "function") endGameLoad(true);
        zoneOpenToken++;
        try { openPartnerFrame(file); }
        catch (error) {
            closeZone();
            notify(`Couldn't open ${file.name}.`, { type: "error" });
        }
    } else {
        if (typeof setPartnerNotice === "function") setPartnerNotice(null);
        if (typeof resetFrameAfterPartner === "function") resetFrameAfterPartner();
        // Show viewer immediately with a loading indicator
        document.getElementById('zoneName').textContent = file.name;
        document.getElementById('zoneId').textContent = file.id;
        document.getElementById('zoneAuthor').textContent = "by " + file.author;
        if (file.authorLink) {
            document.getElementById('zoneAuthor').href = file.authorLink;
        } else {
            document.getElementById('zoneAuthor').removeAttribute('href');
        }
        zoneViewer.style.display = "flex";
        zoneViewer.hidden = false;
        addRecentZone(file.id);
        startPlaytime(file.id);
        currentGameId = String(file.id);
        updateRatingBar(file.id);
        beginGameLoad(file);
        // Every game gets a brand-new frame. Writing a game into the frame the last
        // game used keeps that game's variables around, which breaks the next one
        // (e.g. "Identifier 'GODOT_CONFIG' has already been declared").
        replaceZoneFrame();
        const token = ++zoneOpenToken;
        zoneFrame.contentDocument.open();
        zoneFrame.contentDocument.write(gameLoadingScreenHtml(file));
        zoneFrame.contentDocument.close();
        loadZoneHtml(file.url).then(html => {
            if (token !== zoneOpenToken) return; // another game was opened meanwhile
            if (zoneFrame.contentDocument === null) replaceZoneFrame();
            markGamePageWritten();
            zoneFrame.contentDocument.open();
            zoneFrame.contentDocument.write(html);
            zoneFrame.contentDocument.close();
        }).catch(error => {
            endGameLoad(true);
            closeZone();
            if (error && error.blocked) notify(`${file.name} was blocked to keep you safe. Its game files were found to contain malicious code (added to the outside game library on October 11), so it can't be played right now.`, { type: "error", duration: 9000 });
            else notify(`Couldn't load ${file.name} from any of the game sources. Check your internet connection, or try again in a few minutes.`, { type: "error" });
            // Every source failed while online: worth a look (a game file may be missing)
            if (typeof reportError === "function" && navigator.onLine !== false && !(error && error.blocked)) {
                reportError("game-load", "Couldn't load the game from any source: " + ((error && error.message) || error), {
                    keep: true, stack: error && error.stack, gameId: file.id, gameName: file.name, detail: String(file.url || "").slice(0, 200) });
            }
        });
    }
}

let zoneOpenToken = 0;
function replaceZoneFrame() {
    if (zoneFrame && zoneFrame.parentNode) zoneFrame.parentNode.removeChild(zoneFrame);
    zoneFrame = document.createElement("iframe");
    zoneFrame.id = "zoneFrame";
    zoneViewer.appendChild(zoneFrame);
    if (typeof attachPanicKeyToFrame === "function") zoneFrame.addEventListener("load", attachPanicKeyToFrame);
}

function aboutBlank() {
    const newWindow = window.open("about:blank", "_blank");
    let zone = zones.find(zone => zone.id + '' === document.getElementById('zoneId').textContent);
    if (zone && typeof isPartnerZone === "function" && isPartnerZone(zone)) {
        if (newWindow) newWindow.location.href = partnerPlayUrl(zone);
        return;
    }
    fetchWithFallback(zone.url).then(html => {
        if (newWindow) {
            newWindow.document.open();
            newWindow.document.write(html);
            newWindow.document.close();
        }
    }).catch(() => notify("Couldn't open the game in a new tab. Try again in a few minutes.", { type: "error" }));
}

function closeZone() {
    zoneOpenToken++;
    stopPlaytime();
    if (typeof closeGameMenu === "function") closeGameMenu();
    if (typeof currentGameId !== "undefined") currentGameId = null;
    if (typeof endGameLoad === "function") endGameLoad(true);
    zoneViewer.hidden = false;
    zoneViewer.style.display = "none";
    if (zoneFrame && zoneFrame.parentNode === zoneViewer) zoneViewer.removeChild(zoneFrame);
    clearZoneIdFromUrl();
    // Catch up on a redraw that was held back while the game was open
    if (refreshWaitingForGame) scheduleFullRefresh();
}

// Old links/history entries may still carry ?id=… — strip it so the address bar
// (and Chrome's autocomplete) doesn't keep reopening that game.
function clearZoneIdFromUrl() {
    try {
        const url = new URL(window.location);
        if (!url.searchParams.has('id')) return;
        url.searchParams.delete('id');
        history.replaceState(null, '', url.toString());
    } catch (error) {}
}

function downloadZone() {
    let zone = zones.find(zone => zone.id + '' === document.getElementById('zoneId').textContent);
    if (zone && typeof isPartnerZone === "function" && isPartnerZone(zone)) {
        notify("Partner games play from html5games.com or Playgama, so they can't be downloaded.");
        return;
    }
    fetchWithFallback(zone.url).then(text => {
        const blob = new Blob([text], {
            type: "text/plain;charset=utf-8"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zone.name + ".html";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

function fullscreenZone() {
    if (zoneFrame.requestFullscreen) {
        zoneFrame.requestFullscreen();
    } else if (zoneFrame.mozRequestFullScreen) {
        zoneFrame.mozRequestFullScreen();
    } else if (zoneFrame.webkitRequestFullscreen) {
        zoneFrame.webkitRequestFullscreen();
    } else if (zoneFrame.msRequestFullscreen) {
        zoneFrame.msRequestFullscreen();
    }
}

function sanitizeData(obj, maxStringLen = 1000, maxArrayLen = 10000) {
    if (typeof obj === 'string') {
      return obj.length > maxStringLen ? obj.slice(0, maxStringLen) + '...[truncated]' : obj;
    }
    
    if (obj instanceof Uint8Array) {
      if (obj.length > maxArrayLen) {
        return `[Uint8Array too large (${obj.length} bytes), truncated]`;
      }
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeData(item, maxStringLen, maxArrayLen));
    }
    
    if (obj && typeof obj === 'object') {
      const newObj = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          newObj[key] = sanitizeData(obj[key], maxStringLen, maxArrayLen);
        }
      }
      return newObj;
    }
    
    return obj;
  }

// Owner keys (GitHub token, owner password, site mode, etc.) must never be
// exported to, or imported from, a save file.
function isProtectedStorageKey(key) {
    return key.startsWith("gnmath-owner-");
}

async function saveData() {
    // Same format as cloud saves: keeps binary game data, keys and indexes intact.
    try {
        const bundle = await collectCloudBundle();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([JSON.stringify({ gnmathExport: 2, exportedAt: new Date().toISOString(), bundle })], {
            type: "application/octet-stream"
        }));
        link.download = `gn-math-save-${new Date().toISOString().slice(0, 10)}.data`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        console.error(e);
        notify("Couldn't export your data: " + (e.message || e), { type: "error" });
    }
  }

  async function loadData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        let data;
        try { data = JSON.parse(e.target.result); } catch { notify("That isn't a valid save file.", { type: "error" }); return; }
        if (data && data.gnmathExport === 2 && data.bundle) {
            if (!(await askConfirm("Your game progress and settings on this device will be replaced with the ones in this file.", { title: "Import this save?", confirmText: "Import" }))) return;
            try {
                if (zoneViewer.style.display === "flex") closeZone();
                await applyCloudBundle(data.bundle);
                window.removeEventListener("beforeunload", gnmathBeforeUnloadHandler);
                location.reload();
            } catch (err) {
                notify("Couldn't import that file: " + (err.message || err), { type: "error" });
            }
            return;
        }
        if (data.cookies) {
            data.cookies.split(';').forEach(cookie => {
              document.cookie = cookie.trim();
            });
          }
        
          if (data.localStorage) {
            for (const key in data.localStorage) {
              if (isProtectedStorageKey(key)) continue; // a save file can't change owner settings or the token
              localStorage.setItem(key, data.localStorage[key]);
            }
          }
        
          if (data.sessionStorage) {
            for (const key in data.sessionStorage) {
              sessionStorage.setItem(key, data.sessionStorage[key]);
            }
          }
        
          if (data.indexedDB) {
            for (const dbName in data.indexedDB) {
              const stores = data.indexedDB[dbName];
              await new Promise((resolve, reject) => {
                const request = indexedDB.open(dbName, 1);
                request.onupgradeneeded = e => {
                  const db = e.target.result;
                  for (const storeName in stores) {
                    if (!db.objectStoreNames.contains(storeName)) {
                      db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                    }
                  }
                };
                request.onsuccess = e => {
                  const db = e.target.result;
                  const transaction = db.transaction(Object.keys(stores), 'readwrite');
                  transaction.onerror = () => reject(transaction.error);
                  let pendingStores = Object.keys(stores).length;
        
                  for (const storeName in stores) {
                    const objectStore = transaction.objectStore(storeName);
                    objectStore.clear().onsuccess = () => {
                      for (const item of stores[storeName]) {
                        objectStore.put(item);
                      }
                      pendingStores--;
                      if (pendingStores === 0) resolve();
                    };
                  }
                };
                request.onerror = () => reject(request.error);
              });
            }
          }
        
          if (data.caches) {
            for (const cacheName in data.caches) {
              const cache = await caches.open(cacheName);
              await cache.keys().then(keys => Promise.all(keys.map(k => cache.delete(k)))); // clear existing
        
              for (const entry of data.caches[cacheName]) {
                let responseBody;
                if (entry.contentType.includes('application/json')) {
                  responseBody = JSON.stringify(entry.body);
                } else if (entry.contentType.includes('text') || entry.contentType.includes('javascript')) {
                  responseBody = entry.body;
                } else {
                  const binaryStr = atob(entry.body);
                  const len = binaryStr.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                  }
                  responseBody = bytes.buffer;
                }
                const headers = new Headers({ 'content-type': entry.contentType });
                const response = new Response(responseBody, { headers });
                await cache.put(entry.url, response);
              }
            }
          }
        notify("Save file imported.", { type: "success" });
    };
    reader.readAsText(file);
  }


function getJsonStorage(key, fallback) {
    try {
        const storedValue = localStorage.getItem(key);
        return storedValue ? JSON.parse(storedValue) : fallback;
    } catch (error) {
        return fallback;
    }
}

function setJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function getDisabledZoneIds() {
    return new Set(getJsonStorage(OWNER_STORAGE_KEYS.disabledZones, []));
}

function setDisabledZoneIds(disabledIds) {
    setJsonStorage(OWNER_STORAGE_KEYS.disabledZones, Array.from(disabledIds));
}

// Games removed after a copyright takedown (takedown.js keeps this up to date)
let takedownRemovedIds = (() => { try { return new Set((JSON.parse(localStorage.getItem("gnmath-takedown-removed") || "{}").ids || []).map(String)); } catch { return new Set(); } })();

function isZoneDisabled(zoneId) {
    return takedownRemovedIds.has(String(zoneId)) || cardCached("disabled", getDisabledZoneIds).has(String(zoneId));
}

function setZoneDisabled(zoneId, isDisabled) {
    const disabledIds = getDisabledZoneIds();
    if (isDisabled) {
        disabledIds.add(String(zoneId));
    } else {
        disabledIds.delete(String(zoneId));
    }
    setDisabledZoneIds(disabledIds);
    featuredContainer.innerHTML = "";
    sortZones();
    githubAutoSync();
}

function getBrokenReports() {
    return getJsonStorage(OWNER_STORAGE_KEYS.brokenReports, {});
}

function setBrokenReports(reports) {
    setJsonStorage(OWNER_STORAGE_KEYS.brokenReports, reports);
}

function buildBrokenReportsFile() {
    const reports = getBrokenReports();
    const games = Object.values(reports).sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name));
    return {
        totalReports: games.reduce((total, game) => total + game.reports, 0),
        games,
        updatedAt: new Date().toISOString()
    };
}

function downloadJsonFile(fileName, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function saveBrokenReportsFile() {
    downloadJsonFile("broken-reports.json", buildBrokenReportsFile());
}

function reportBrokenZone(file) {
    const zoneId = String(file.id);
    const reports = getBrokenReports();
    const currentReport = reports[zoneId] || {
        id: zoneId,
        name: file.name,
        url: file.url,
        reports: 0,
        firstReportedAt: new Date().toISOString()
    };

    currentReport.name = file.name;
    currentReport.url = file.url;
    currentReport.reports += 1;
    currentReport.lastReportedAt = new Date().toISOString();
    reports[zoneId] = currentReport;
    setBrokenReports(reports);
}

function reportCurrentZone() {
    const zone = zones.find(zone => zone.id + '' === document.getElementById('zoneId').textContent);
    if (!zone) {
        notify("No game is open.");
        return;
    }
    reportBrokenZone(zone);       // owner's local tally (owner panel)
    reportBrokenShared(zone);     // shared count that flags cards for everyone
}

function getOwnerSiteMode() {
    const mode = localStorage.getItem(OWNER_STORAGE_KEYS.siteMode) || "open";
    return OWNER_SITE_MODES.includes(mode) ? mode : "open";
}

function setOwnerSiteMode(mode) {
    const safeMode = OWNER_SITE_MODES.includes(mode) ? mode : "open";
    const changed = safeMode !== getOwnerSiteMode();
    localStorage.setItem(OWNER_STORAGE_KEYS.siteMode, safeMode);
    if (changed || siteModeSync.phase === "failed") {
        siteModeSync = { mode: safeMode, phase: getGithubPat() ? "saving" : "local", at: Date.now(), pushedAt: 0 };
        clearTimeout(siteModeVerifyTimer);
    }
    applyOwnerSiteMode();
    githubAutoSync();
}

// ── Owner's view while the site is closed ──────────────────────────────────
// The owner isn't locked out by their own change: instead of the full screen
// they get a bar saying what visitors see and whether the change has reached
// them yet (saving → saved to GitHub → visitors are getting it).
let siteModeSync = { mode: null, phase: "", at: 0, pushedAt: 0 };
let siteModeVerifyTimer = null;
let siteModePreview = false;
const SITE_MODE_NAMES = { open: "open", locked: "locked", maintenance: "in maintenance", shutdown: "shut down" };
function ownerBypassesLock() { return typeof ownerUnlockedThisTab === "function" && ownerUnlockedThisTab(); }

// Called after each save: did the change go through?
function noteSiteModeSaved(ok) {
    if (!siteModeSync.mode || siteModeSync.phase !== "saving") return;
    if (!ok) { siteModeSync.phase = "failed"; renderOwnerModeBar(); return; }
    siteModeSync.phase = "saved";
    siteModeSync.savedAt = Date.now();
    siteModeSync.pushedAt = Date.parse(_lastPushedAt || "") || Date.now();
    renderOwnerModeBar();
    verifySiteModeLive();
}
// Watch the public copy visitors read until it shows the new mode
async function verifySiteModeLive() {
    clearTimeout(siteModeVerifyTimer);
    const want = siteModeSync;
    if (want.phase !== "saved") return;
    try {
        const res = await fetch(GITHUB_SYNC_CDN + "?v=" + Date.now(), { cache: "no-store" });
        if (res.ok) {
            const pub = await res.json();
            const pubAt = Date.parse(pub.updatedAt || "") || 0;
            if (want === siteModeSync && pub.siteMode === want.mode && pubAt >= want.pushedAt - 1000) {
                siteModeSync.phase = "live";
                siteModeSync.liveAt = Date.now();
                renderOwnerModeBar();
                return;
            }
        }
    } catch {}
    if (want !== siteModeSync) return;
    if (Date.now() - want.savedAt > 15 * 60000) { siteModeSync.phase = "slow"; renderOwnerModeBar(); return; }
    renderOwnerModeBar();
    siteModeVerifyTimer = setTimeout(verifySiteModeLive, 15000);
}
function siteModeSyncText() {
    const t = ms => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const sy = siteModeSync, mode = getOwnerSiteMode();
    if (sy.mode !== mode) return { icon: "", text: "" };
    switch (sy.phase) {
        case "saving": return { icon: "⏳", cls: "wait", text: "Saving to GitHub…" };
        case "failed": return { icon: "✗", cls: "bad", text: "Didn't save. Check your token in the Owner Panel, then pick the mode again." };
        case "saved": {
            const secs = Math.round((Date.now() - sy.savedAt) / 1000);
            return { icon: "⏳", cls: "wait", text: `Saved at ${t(sy.savedAt)}. Waiting for visitors to get it (usually 1–5 min)… ${secs >= 60 ? Math.floor(secs / 60) + " min " : ""}${secs % 60}s` };
        }
        case "live": return { icon: "✓", cls: "ok", text: `Live: visitors are getting this since ${t(sy.liveAt)}. Pages already open switch within about a minute.` };
        case "slow": return { icon: "!", cls: "bad", text: "Saved, but GitHub still shows the old setting after 15 minutes. Try picking the mode again." };
        case "local": return { icon: "!", cls: "bad", text: "Only changed on this device: no GitHub token is saved, so visitors won't see it." };
        default: return { icon: "", text: "" };
    }
}
function renderOwnerModeBar() {
    const mode = getOwnerSiteMode();
    let bar = document.getElementById("owner-mode-bar");
    const sync = siteModeSyncText();
    const panelLine = document.getElementById("owner-mode-sync");
    if (panelLine) {
        panelLine.textContent = sync.text ? `${sync.icon} ${sync.text}` : "";
        panelLine.className = "owner-mode-sync " + (sync.cls || "");
    }
    // Show the bar while closed, and briefly after reopening until it's live
    const showOpen = mode === "open" && sync.text && !(siteModeSync.phase === "live" && Date.now() - siteModeSync.liveAt > 20000);
    const show = ownerBypassesLock() && !siteModePreview && (mode !== "open" || showOpen);
    document.documentElement.classList.toggle("owner-mode-bar-on", !!show);
    if (!show) { bar?.remove(); return; }
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "owner-mode-bar";
        bar.setAttribute("role", "status");
        bar.innerHTML = `<div class="omb-main"><b class="omb-title"></b><span class="omb-sync"></span></div>
            <div class="omb-actions"><button type="button" class="omb-preview">Preview screen</button><button type="button" class="omb-open">Reopen site</button><button type="button" class="omb-panel">Owner Panel</button></div>`;
        bar.querySelector(".omb-preview").onclick = () => { siteModePreview = true; applyOwnerSiteMode(); };
        bar.querySelector(".omb-open").onclick = () => setOwnerSiteMode("open");
        bar.querySelector(".omb-panel").onclick = () => showOwnerPanel();
        document.body.appendChild(bar);
    }
    bar.dataset.mode = mode;
    bar.querySelector(".omb-title").textContent = mode === "open"
        ? "Site reopened"
        : `Site is ${SITE_MODE_NAMES[mode]} for visitors. You can still use it because you're the owner.`;
    const syncEl = bar.querySelector(".omb-sync");
    syncEl.textContent = sync.text ? `${sync.icon} ${sync.text}` : "";
    syncEl.className = "omb-sync " + (sync.cls || "");
    bar.querySelector(".omb-preview").hidden = mode === "open";
    bar.querySelector(".omb-open").hidden = mode === "open";
}
setInterval(() => { if (siteModeSync.phase === "saved" || siteModeSync.phase === "live") renderOwnerModeBar(); }, 1000);

// Optional note from the owner shown on the lock and shutdown screens
function escapeOwnerHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Owner-set status for the corner indicator: {level: auto|ok|degraded|down|maintenance, text}
const STATUS_LEVELS = ["auto", "ok", "degraded", "down", "maintenance"];
function getStatusOverride() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.statusOverride) || "null"); } catch {}
    return { level: v && STATUS_LEVELS.includes(v.level) ? v.level : "auto", text: v && typeof v.text === "string" ? v.text.slice(0, 80) : "" };
}
function setStatusOverride(o, { sync = true } = {}) {
    const safe = { level: STATUS_LEVELS.includes(o?.level) ? o.level : "auto", text: String(o?.text || "").slice(0, 80) };
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.statusOverride, JSON.stringify(safe));
    if (typeof updateSiteStatus === "function") updateSiteStatus();
    if (sync) githubAutoSync();
}
function saveStatusOverrideFromPanel() {
    setStatusOverride({ level: document.getElementById("owner-status-level")?.value, text: document.getElementById("owner-status-text")?.value });
    notify("Status saved.", { type: "success" });
}
function getOwnerSiteMessage() {
    try { return localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.siteMessage) || ""; } catch { return ""; }
}
// When the owner expects the site back (ISO time, or "" for not set)
function getSiteBackAt() {
    let v = "";
    try { v = localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.siteBackAt) || ""; } catch {}
    return v && !isNaN(Date.parse(v)) ? v : "";
}
function siteBackAtText() {
    const iso = getSiteBackAt();
    if (!iso) return "";
    const t = new Date(iso), mins = Math.round((t - Date.now()) / 60000);
    const sameDay = t.toDateString() === new Date().toDateString();
    const when = (sameDay ? "" : t.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ", ") + t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (mins <= 0) return `Expected back around ${when}. Should be any minute now.`;
    const left = mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.floor(mins / 60)} h ${mins % 60 ? (mins % 60) + " min" : ""}`.trim() : `${Math.round(mins / 1440)} days`;
    return `Expected back around ${when} (in ${left})`;
}
// The datetime-local box works in local time; store it as a real time
function toLocalInputValue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function saveSiteMessageFromPanel() {
    const text = (document.getElementById("owner-site-message")?.value || "").slice(0, 400);
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteMessage, text);
    const back = document.getElementById("owner-site-back-at")?.value || "";
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteBackAt, back && !isNaN(Date.parse(back)) ? new Date(back).toISOString() : "");
    applyOwnerSiteMode();
    githubAutoSync();
    notify("Saved. It shows on the lock, maintenance and shutdown screens.", { type: "success" });
}

const SITE_MODE_SCREENS = {
    locked: {
        badge: "Temporarily locked",
        title: "We'll be right back",
        text: "The owner has locked GN 2.0 for a little while. Your saves, favorites and settings are safe on this device.",
        icon: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none"/>'
    },
    maintenance: {
        badge: "Scheduled maintenance",
        title: "Down for maintenance",
        text: "GN 2.0 is getting some updates and fixes. It'll be back soon, and your saves, favorites and settings are safe on this device.",
        icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7V20h3.3l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.3-.5-.5-2.3 2.3-2.7z"/>'
    },
    shutdown: {
        badge: "Service unavailable",
        title: "GN 2.0 is offline",
        text: "The owner has shut this website down. It isn't available right now.",
        icon: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'
    }
};
let siteModeRecheckTimer = null;
let siteModeLastCheck = 0;

function updateSiteModeCheckedText() {
    const eta = document.getElementById("site-mode-eta");
    if (eta) eta.textContent = siteBackAtText();
    const el = document.getElementById("site-mode-checked");
    if (!el || !siteModeLastCheck) return;
    const secs = Math.round((Date.now() - siteModeLastCheck) / 1000);
    el.textContent = secs < 10 ? "Checked just now" : secs < 60 ? `Checked ${secs}s ago` : `Checked ${Math.round(secs / 60)} min ago`;
}
// While the site is locked, look for the owner reopening it so nobody has to reload
async function recheckSiteMode(manual) {
    const btn = document.getElementById("site-mode-check");
    if (btn) { btn.disabled = true; btn.classList.add("checking"); }
    try { await githubSyncPull(); } catch {}
    siteModeLastCheck = Date.now();
    if (btn) { btn.disabled = false; btn.classList.remove("checking"); }
    updateSiteModeCheckedText();
    if (manual && getOwnerSiteMode() !== "open") notify("Still closed. It'll open by itself as soon as the owner reopens it.");
}

// Ask the open game to save, the way it would if the tab were being closed,
// then close it and upload the save to the player's account.
let kickSaving = null;
function flushGameFrame(timeoutMs = 3000) {
    return new Promise(resolve => {
        let win = null;
        try { win = (typeof zoneFrame !== "undefined" && zoneFrame && zoneFrame.contentWindow) || null; } catch {}
        if (!win) return resolve();
        let pending = 0, done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        try {
            // Most web games save on these (tab hidden, page closing)
            for (const type of ["blur", "pagehide", "beforeunload"]) {
                try { win.dispatchEvent(new Event(type)); } catch {}
            }
            try { win.document.dispatchEvent(new Event("visibilitychange")); } catch {}
            // Unity and other Emscripten games keep saves in memory until they sync them
            const fsList = [win.FS, win.Module && win.Module.FS, win.unityInstance && win.unityInstance.Module && win.unityInstance.Module.FS, win.gameInstance && win.gameInstance.Module && win.gameInstance.Module.FS];
            for (const fs of new Set(fsList.filter(f => f && typeof f.syncfs === "function"))) {
                pending++;
                try { fs.syncfs(false, () => { if (--pending <= 0) setTimeout(finish, 300); }); } catch { pending--; }
            }
        } catch {}
        // Give saves that use the browser database a moment to finish writing
        setTimeout(finish, pending ? timeoutMs : 1200);
    });
}
function saveGameBeforeKick(overlay) {
    if (kickSaving) return kickSaving;
    const line = overlay && overlay.querySelector(".site-mode-live");
    const setLine = (text, cls) => { if (line) { line.innerHTML = `<span class="site-mode-pulse" aria-hidden="true"></span><span></span>`; line.lastChild.textContent = text; line.className = "site-mode-live" + (cls ? " " + cls : ""); } };
    const signedIn = typeof cloudUser !== "undefined" && cloudUser && typeof uploadCloudSave === "function";
    setLine(signedIn ? "Saving your game to your account…" : "Saving your game on this device…", "saving");
    kickSaving = (async () => {
        await flushGameFrame();
        try { if (zoneViewer.style.display === "flex") closeZone(); } catch {}
        if (!signedIn) { setLine("✓ Your game was saved on this device. This page opens by itself when the site is back.", "saved"); return true; }
        // closeZone already started an upload; wait for it, then make sure the latest is up
        const until = Date.now() + 20000;
        while (typeof cloudBusy !== "undefined" && cloudBusy && Date.now() < until) await new Promise(r => setTimeout(r, 250));
        let ok = false;
        try { ok = await uploadCloudSave(); } catch {}
        setLine(ok ? "✓ Your game was saved to your account. This page opens by itself when the site is back."
                   : "Your game is saved on this device. It couldn't be saved to your account right now; it will be next time you play.", ok ? "saved" : "");
        return ok;
    })().finally(() => { kickSaving = null; });
    return kickSaving;
}

function applyOwnerSiteMode() {
    const existingOverlay = document.getElementById("owner-site-overlay");
    const mode = getOwnerSiteMode();
    if (mode === "open") siteModePreview = false;
    renderOwnerModeBar();

    if (mode === "open" || (ownerBypassesLock() && !siteModePreview)) {
        clearInterval(siteModeRecheckTimer);
        siteModeRecheckTimer = null;
        document.documentElement.classList.remove("site-mode-closed");
        if (existingOverlay) {
            existingOverlay.classList.add("site-overlay-leaving");
            setTimeout(() => existingOverlay.remove(), 300);
            if (siteModeLastCheck && mode === "open" && !ownerBypassesLock()) notify("GN 2.0 is open again!", { type: "success" });
        }
        return;
    }

    const note = getOwnerSiteMessage().trim();
    const backAt = mode === "shutdown" ? "" : getSiteBackAt();
    const key = mode + "|" + note + "|" + backAt + "|" + siteModePreview;
    if (existingOverlay && existingOverlay.dataset.key === key && !existingOverlay.classList.contains("site-overlay-leaving")) return;
    if (existingOverlay) existingOverlay.remove();

    const screen = SITE_MODE_SCREENS[mode];
    const overlay = document.createElement("div");
    overlay.id = "owner-site-overlay";
    overlay.className = "site-mode-" + mode + (mode === "shutdown" ? " shutdown-mode" : "");
    const etaText = backAt ? siteBackAtText() : "";
    overlay.dataset.key = key;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "site-mode-title");
    overlay.innerHTML = `
        <div class="site-mode-bg" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="owner-site-message site-mode-card">
            <div class="site-mode-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${screen.icon}</svg>
            </div>
            <div class="site-mode-badge"><span class="site-mode-dot"></span>${screen.badge}</div>
            <h1 id="site-mode-title">${screen.title}</h1>
            <p class="site-mode-text">${screen.text}</p>
            ${note ? `<blockquote class="site-mode-note"><span class="site-mode-note-label">Message from the owner</span><span class="site-mode-note-text"></span></blockquote>` : ""}
            ${etaText ? `<div class="site-mode-eta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span id="site-mode-eta">${escapeOwnerHtml(etaText)}</span></div>` : ""}
            <div class="site-mode-live">
                <span class="site-mode-pulse" aria-hidden="true"></span>
                <span>This page opens by itself when the site is back.</span>
            </div>
            <div class="site-mode-actions">
                <button type="button" id="site-mode-check" class="site-mode-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>
                    Check now
                </button>
                <span id="site-mode-checked" class="site-mode-checked"></span>
            </div>
            ${siteModePreview
                ? `<button type="button" class="site-mode-preview-close">Close preview (this is what visitors see)</button>`
                : `<button type="button" class="site-mode-owner">Owner access</button>`}
        </div>`;
    if (note) overlay.querySelector(".site-mode-note-text").textContent = note;
    overlay.querySelector("#site-mode-check").onclick = () => recheckSiteMode(true);
    // Owner access lets the owner in (with the owner bar) without reopening the site for everyone
    const ownerBtn = overlay.querySelector(".site-mode-owner");
    if (ownerBtn) ownerBtn.onclick = () => requestOwnerAccess(() => { applyOwnerSiteMode(); notify("You're in. The site is still closed for visitors; use Reopen site in the bar at the top to open it.", { type: "success" }); });
    const closePrev = overlay.querySelector(".site-mode-preview-close");
    if (closePrev) closePrev.onclick = () => { siteModePreview = false; applyOwnerSiteMode(); };
    document.body.appendChild(overlay);
    document.documentElement.classList.add("site-mode-closed");
    // Someone in the middle of a game: save it (to their account if signed in)
    // before closing it, so being locked out doesn't lose progress.
    if (!siteModePreview && typeof zoneViewer !== "undefined" && zoneViewer && zoneViewer.style.display === "flex") {
        saveGameBeforeKick(overlay);
    }

    if (!siteModeRecheckTimer) {
        siteModeRecheckTimer = setInterval(() => {
            updateSiteModeCheckedText();
            if (!document.hidden && syncCheckDue()) {
                setSyncPace({ last: Date.now() });
                _nextSyncDelay = syncCheckDelay();
                recheckSiteMode(false);
            }
        }, 10000);
    }
}

function showOwnerPanel() {
    requestOwnerAccess(renderOwnerPanel);
}

function renderOwnerPanel() {
    document.getElementById('popupTitle').textContent = "Owner Panel";
    const popupBody = document.getElementById('popupBody');
    const mode         = getOwnerSiteMode();
    const reportsFile  = buildBrokenReportsFile();
    const announcement = getAnnouncement();
    const motd         = getMotd();
    const disabledCount = getDisabledZoneIds().size;
    const storedPat    = getGithubPat();
    const maskedPat    = storedPat ? storedPat.slice(0, 10) + "•".repeat(12) + storedPat.slice(-4) : "";
    const footerLinks  = getFooterLinks() || [];
    const visitorDefaults = getOwnerVisitorDefaults();
    const footerLinksJson = JSON.stringify(footerLinks, null, 2).replace(/"/g, '&quot;');

    popupBody.innerHTML = `
    <div class="settings-section">
        <h4>☁️ GitHub Sync</h4>
        <p style="margin:0 0 0.75rem;color:var(--text-muted);font-size:13px;">
            Settings load from GitHub on every page load for all visitors.
            Only the owner can push changes using their token.
        </p>
        <p style="margin:0 0 0.75rem;font-size:13px;">Unlocked with your GitHub token (<code>${maskedPat}</code>).
            <a href="#" onclick="ownerForgetToken(); return false;">Remove token from this browser</a></p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button id="owner-sync-btn" class="settings-button" type="button" style="flex:1;" onclick="ownerSyncSave()">Save &amp; Sync to GitHub</button>
            <button class="settings-button" type="button" style="flex:1;" onclick="ownerSyncPullManual()">Pull from GitHub</button>
        </div>
        <p id="owner-sync-status" style="margin:0.5rem 0 0;font-size:12px;color:var(--text-muted);min-height:1.2em;"></p>
    </div>

    <div class="settings-section">
        <h4>Website Status</h4>
        <label style="display:block;margin-bottom:0.4rem;">Site mode</label>
        <select id="owner-site-mode" class="settings-select" onchange="setOwnerSiteMode(this.value)">
            <option value="open"     ${mode === "open"     ? "selected" : ""}>🟢 Open — everyone can access</option>
            <option value="locked"   ${mode === "locked"   ? "selected" : ""}>🔒 Locked — show lock screen</option>
            <option value="maintenance" ${mode === "maintenance" ? "selected" : ""}>🛠️ Maintenance — show maintenance screen</option>
            <option value="shutdown" ${mode === "shutdown" ? "selected" : ""}>🔴 Shut down — show shutdown screen</option>
        </select>
        <p id="owner-mode-sync" class="owner-mode-sync"></p>
        <label style="display:block;margin:0.85rem 0 0.4rem;">Message on the lock / maintenance / shutdown screen (optional)</label>
        <textarea id="owner-site-message" rows="2" maxlength="400" placeholder="e.g. Back after lunch, or: Moving to a new address, details on Discord"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;resize:vertical;margin-bottom:0.5rem;font-family:inherit;">${escapeOwnerHtml(getOwnerSiteMessage())}</textarea>
        <label style="display:block;margin:0.35rem 0 0.4rem;">Expected back (optional, shown on lock and maintenance screens)</label>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">
            <input type="datetime-local" id="owner-site-back-at" value="${toLocalInputValue(getSiteBackAt())}"
                style="flex:1;min-width:0;padding:0.55rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;font-family:inherit;color-scheme:dark light;">
            <button class="settings-button" type="button" style="width:auto;padding:0 0.9rem;" onclick="document.getElementById('owner-site-back-at').value=''">Clear</button>
        </div>
        <button class="settings-button" type="button" onclick="saveSiteMessageFromPanel()">Save Message &amp; Time</button>
        <p style="margin:0.5rem 0 0;font-size:12px;color:var(--text-muted);">Visitors' screens check every minute and open by themselves when you switch back to Open (GitHub can take a few minutes to pass the change on).</p>
    </div>

    <div class="settings-section">
        <h4>Status Indicator</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">The little status light in the bottom-left corner checks the site by itself. Set a status here to tell everyone something it can't detect.</p>
        <label style="display:block;margin-bottom:0.4rem;">Status</label>
        <select id="owner-status-level" class="settings-select">
            ${[["auto","Automatic (checks the site by itself)"],["ok","🟢 All good"],["degraded","🟡 Some problems"],["down","🔴 Major outage"],["maintenance","🔵 Maintenance"]].map(([v,l]) => `<option value="${v}" ${getStatusOverride().level === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <input type="text" id="owner-status-text" maxlength="80" placeholder="Short text, e.g. Some games are slow today"
            value="${escapeOwnerHtml(getStatusOverride().text)}"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin:0.5rem 0;">
        <button class="settings-button" type="button" onclick="saveStatusOverrideFromPanel()">Apply Status</button>
    </div>

    <div class="settings-section">
        <h4>New Visitor Defaults</h4>
        <p style="margin:0 0 0.75rem;font-size:13px;color:var(--text-muted);">Applied only when a visitor has not chosen their own setting. Existing preferences are never overwritten.</p>
        <label style="display:block;margin-bottom:0.35rem;">Color mode</label>
        <select id="owner-default-mode" class="settings-select"><option value="dark" ${visitorDefaults.mode === "dark" ? "selected" : ""}>Dark</option><option value="light" ${visitorDefaults.mode === "light" ? "selected" : ""}>Light</option></select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Theme</label>
        <select id="owner-default-theme" class="settings-select">${AVAILABLE_THEMES.filter(t => t !== "custom").map(theme => `<option value="${theme}" ${visitorDefaults.theme === theme ? "selected" : ""}>${themeLabel(theme)}${SCENE_THEMES[theme] ? " (scene)" : ""}</option>`).join("")}</select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Font size</label>
        <select id="owner-default-font-size" class="settings-select">${["small", "medium", "large"].map(size => `<option value="${size}" ${visitorDefaults.fontSize === size ? "selected" : ""}>${size[0].toUpperCase() + size.slice(1)}</option>`).join("")}</select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Card size</label>
        <select id="owner-default-card-size" class="settings-select">${["small", "medium", "large", "list"].map(size => `<option value="${size}" ${visitorDefaults.cardSize === size ? "selected" : ""}>${size[0].toUpperCase() + size.slice(1)}</option>`).join("")}</select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Default sort</label>
        <select id="owner-default-sort" class="settings-select">${[["name","Name"],["id","Date added"],["popular","Most popular"],["trendingDay","Trending today"],["trendingWeek","Trending this week"],["trendingMonth","Trending this month"]].map(([value,label]) => `<option value="${value}" ${visitorDefaults.defaultSort === value ? "selected" : ""}>${label}</option>`).join("")}</select>
        <br><br><div class="settings-inline"><label>Compact header</label><input id="owner-default-compact" type="checkbox" ${visitorDefaults.compactMode ? "checked" : ""}></div>
        <div class="settings-inline"><label>Hide Featured section</label><input id="owner-default-hide-featured" type="checkbox" ${visitorDefaults.hideFeatured ? "checked" : ""}></div>
        <div class="settings-inline"><label>Autofocus search</label><input id="owner-default-autofocus" type="checkbox" ${visitorDefaults.autofocusSearch ? "checked" : ""}></div>
        <div class="settings-inline"><label>Show play count</label><input id="owner-default-play-count" type="checkbox" ${visitorDefaults.showPlayCount ? "checked" : ""}></div>
        <div class="settings-inline"><label>Warn before leaving</label><input id="owner-default-warn" type="checkbox" ${visitorDefaults.warnBeforeUnload ? "checked" : ""}></div>
        <div class="settings-inline"><label>Reduce motion</label><input id="owner-default-reduced-motion" type="checkbox" ${visitorDefaults.reducedMotion ? "checked" : ""}></div>
        <button class="settings-button" type="button" style="margin-top:0.75rem;" onclick="saveOwnerVisitorDefaults()">Save New Visitor Defaults</button>
    </div>

    <div class="settings-section">
        <h4>Announcement Banner</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Shown as a bar below the header for all visitors. Visitors can close it; a new or changed message shows again.</p>
        <div class="settings-inline" style="margin-bottom:0.5rem;">
            <label>Show banner</label>
            <input id="owner-announcement-enabled" type="checkbox" ${announcement.enabled ? "checked" : ""} onchange="saveAnnouncementFromPanel()">
        </div>
        <label style="display:block;margin-bottom:0.4rem;">Style</label>
        <select id="owner-announcement-type" class="settings-select" style="margin-bottom:0.5rem;">
            ${[["info","Announcement (theme color)"],["success","Good news (green)"],["warning","Heads up (yellow)"],["urgent","Important (red)"]].map(([v,l]) => `<option value="${v}" ${announcement.type === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <input type="text" id="owner-announcement-text" placeholder="Announcement message… (links become clickable)"
            value="${announcement.text.replace(/"/g, '&quot;')}"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;">
        <button class="settings-button" type="button" onclick="saveAnnouncementFromPanel()">Apply Banner</button>
    </div>

    <div class="settings-section">
        <h4>Message of the Day (MOTD)</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Shown once per day as a popup when a visitor opens the site.</p>
        <div class="settings-inline" style="margin-bottom:0.5rem;">
            <label>Enable MOTD</label>
            <input id="owner-motd-enabled" type="checkbox" ${motd.enabled ? "checked" : ""} onchange="saveMotdFromPanel()">
        </div>
        <textarea id="owner-motd-text" rows="3" placeholder="Today's message…"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;resize:vertical;margin-bottom:0.5rem;font-family:inherit;">${motd.text.replace(/</g,'&lt;')}</textarea>
        <button class="settings-button" type="button" onclick="saveMotdFromPanel()">Apply MOTD</button>
        <button class="settings-button" type="button" style="margin-top:0.4rem;" onclick="resetMotdLastSeen()">Reset "seen" (re-show today)</button>
    </div>

    <div class="settings-section">
        <h4>Custom Footer Links</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Add extra links to the footer. One per line as <code>Label | https://url</code></p>
        <textarea id="owner-footer-links-text" rows="4" placeholder="My Site | https://example.com"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:13px;resize:vertical;margin-bottom:0.5rem;font-family:monospace;">${footerLinks.map(l => l.label + ' | ' + l.url).join('\n')}</textarea>
        <button class="settings-button" type="button" onclick="saveFooterLinksFromPanel()">Apply Footer Links</button>
        <button class="settings-button" type="button" style="margin-top:0.4rem;" onclick="clearFooterLinks()">Clear All</button>
    </div>

    <div class="settings-section">
        <h4>Game Submissions</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Games players sent in with "Submit a game". To add an approved one, put it in SCHSwork/GN-originals (see its README), then mark it added.</p>
        <div id="owner-submissions" class="owner-panel-list"></div>
        <button class="settings-button" type="button" style="margin-top:0.5rem;" onclick="renderOwnerSubmissions()">Refresh</button>
    </div>

    <div class="settings-section">
        <h4>Trusted Reporters</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">One broken report from a trusted account flags the game for everyone right away, instead of waiting for ${BROKEN_FLAG_THRESHOLD} reports. To make <i>other</i> accounts trusted reporters or game admins, use the <a href="#" onclick="openAdminPanel(); return false;">Admin Panel</a>.</p>
        <div id="owner-trusted-list" class="owner-panel-list"></div>
        <div id="owner-trusted-add" style="margin-top:0.5rem;"></div>
    </div>

    <div class="settings-section">
        <h4>Broken Reports</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Games people reported as broken, most reported first. Reports older than ${BROKEN_REPORT_DAYS} days don't count toward the card warning. Disabling hides a game for everyone.</p>
        <div id="owner-reports-list" class="owner-panel-list"><p style="margin:0.25rem;color:var(--text-muted);">Loading reports…</p></div>
        <button class="settings-button" type="button" style="margin-top:0.5rem;" onclick="renderOwnerReports(true)">Refresh</button>
    </div>

    <div class="settings-section">
        <h4>Disable Games <span style="font-weight:400;font-size:13px;color:var(--text-muted);">(${disabledCount} disabled)</span></h4>
        <p style="margin:0 0 0.5rem;font-size:13px;">Checked games are hidden from all visitors.</p>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="exportDisabledZones()">Export</button>
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="document.getElementById('owner-import-disabled').click()">Import</button>
            <input type="file" id="owner-import-disabled" accept=".json" style="display:none;" onchange="importDisabledZones(event)">
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="enableAllZones()">Enable All</button>
        </div>
        <div id="owner-game-list" class="owner-panel-list"></div>
    </div>

    <div class="settings-section">
        <h4>Zone Cache</h4>
        <button class="settings-button" type="button" onclick="forceRefreshZones()">Force Refresh Zones</button>
    </div>

    <div class="settings-section">
        <h4>Danger Zone</h4>
        <button class="settings-button" type="button"
            style="background:linear-gradient(135deg,#ef4444,#dc2626);"
            onclick="ownerResetAll()">Reset All Owner Data</button>
    </div>
    `;

    const ownerGameList = document.getElementById("owner-game-list");
    const disabledIds = getDisabledZoneIds();
    zones.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(zone => {
        const row = document.createElement("label");
        row.className = "owner-game-toggle";

        const name = document.createElement("span");
        name.className = "owner-game-name";
        name.textContent = `${zone.name} (#${zone.id})`;
        row.appendChild(name);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = disabledIds.has(String(zone.id));
        checkbox.onchange = () => setZoneDisabled(zone.id, checkbox.checked);
        row.appendChild(checkbox);

        ownerGameList.appendChild(row);
    });

    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
    renderOwnerReports(true);
    renderOwnerTrusted();
    if (typeof renderOwnerSubmissions === "function") renderOwnerSubmissions();
    renderOwnerModeBar();
}

function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
}

function renderOwnerTrusted() {
    const list = document.getElementById("owner-trusted-list");
    const add = document.getElementById("owner-trusted-add");
    if (!list || !add) return;
    const trusted = getTrustedReporters();
    list.innerHTML = "";
    if (!trusted.length) {
        const p = document.createElement("p");
        p.style.cssText = "margin:0.25rem;color:var(--text-muted);font-size:13px;";
        p.textContent = "No trusted accounts yet.";
        list.appendChild(p);
    }
    trusted.forEach(t => {
        const row = document.createElement("div");
        row.className = "owner-game-row";
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.4rem 0.25rem;";
        const name = document.createElement("span");
        name.textContent = t.name || t.uid;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-button";
        btn.style.width = "auto";
        btn.textContent = "Remove";
        btn.onclick = () => { setTrustedReporters(getTrustedReporters().filter(x => x.uid !== t.uid)); githubAutoSync(); renderOwnerTrusted(); if (typeof refreshCards === "function") refreshCards(); };
        row.append(name, btn);
        list.appendChild(row);
    });
    add.innerHTML = "";
    const me = typeof cloudUser !== "undefined" && cloudUser ? cloudUser : null;
    if (!me) {
        add.innerHTML = `<p style="margin:0;font-size:13px;color:var(--text-muted);">Sign in to an account on this browser to add it here.</p>`;
    } else if (!trusted.some(x => x.uid === me.uid)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-button";
        btn.textContent = `Make my account (${currentUsername()}) a trusted reporter`;
        btn.onclick = () => {
            setTrustedReporters([...getTrustedReporters(), { uid: me.uid, name: currentUsername() }]);
            githubAutoSync();
            renderOwnerTrusted();
            if (typeof refreshCards === "function") refreshCards();
            notify(`${currentUsername()} is now a trusted reporter. It's saved to GitHub, so it applies for everyone.`, { type: "success" });
        };
        add.appendChild(btn);
    }
}

async function renderOwnerReports(refresh) {
    const list = document.getElementById("owner-reports-list");
    if (!list) return;
    if (typeof cloudDb === "undefined" || !cloudDb) {
        list.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);">Reports need accounts to be switched on.</p>`;
        return;
    }
    if (refresh) await loadGameStats({ force: true });
    const box = document.getElementById("owner-reports-list");
    if (!box) return;
    const rows = Object.entries(gameStats)
        .map(([id, st]) => {
            const times = Object.values(st.r || {});
            return { id, st, total: times.length, recent: st.reports, last: times.length ? Math.max(...times) : 0 };
        })
        .filter(x => x.total > 0)
        .sort((a, b) => b.recent - a.recent || b.total - a.total || b.last - a.last);
    box.innerHTML = "";
    if (!rows.length) {
        box.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);">No broken reports. 🎉</p>`;
        return;
    }
    for (const x of rows) {
        const zone = zoneById(x.id);
        const row = document.createElement("div");
        row.className = "owner-game-toggle";
        const info = document.createElement("span");
        info.className = "owner-game-name";
        const title = document.createElement("b");
        title.textContent = zone ? `${zone.name} (#${x.id})` : `Game #${x.id}`;
        const detail = document.createElement("div");
        detail.style.cssText = "font-size:12px;color:var(--text-muted);";
        const votes = x.st.up + x.st.down;
        detail.textContent = `${x.recent} in last ${BROKEN_REPORT_DAYS} days · ${x.total} total · last ${timeAgo(x.last)}` +
            (votes ? ` · 👍 ${Math.round(x.st.up / votes * 100)}% of ${votes}` : "") +
            (isFlaggedBroken(x.st) ? " · ⚠ flagged" : "");
        info.append(title, detail);
        row.appendChild(info);
        const disabled = isZoneDisabled(x.id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-button";
        btn.style.cssText = "flex:0 0 auto;width:84px;min-width:0;padding:0.45rem 0;font-size:13px;white-space:nowrap;" + (disabled ? "background:var(--surface-hover);" : "");
        btn.textContent = disabled ? "Enable" : "Disable";
        btn.onclick = () => {
            setZoneDisabled(x.id, !disabled);
            const cb = [...document.querySelectorAll("#owner-game-list .owner-game-toggle")]
                .find(l => l.textContent.includes(`(#${x.id})`))?.querySelector("input");
            if (cb) cb.checked = !disabled;
            renderOwnerReports(false);
        };
        row.appendChild(btn);
        box.appendChild(row);
    }
}

async function clearBrokenReports() {
    if (!(await askConfirm('This only clears the reports saved in this browser.', { title: 'Clear all broken-game reports?', confirmText: 'Clear', danger: true }))) {
        return;
    }
    setBrokenReports({});
    renderOwnerPanel();
}

function saveOwnerVisitorDefaults() {
    const value = id => document.getElementById(id);
    setOwnerVisitorDefaults({
        mode: value("owner-default-mode").value, theme: value("owner-default-theme").value,
        cardSize: value("owner-default-card-size").value, fontSize: value("owner-default-font-size").value, defaultSort: value("owner-default-sort").value,
        compactMode: value("owner-default-compact").checked, hideFeatured: value("owner-default-hide-featured").checked,
        autofocusSearch: value("owner-default-autofocus").checked, showPlayCount: value("owner-default-play-count").checked,
        warnBeforeUnload: value("owner-default-warn").checked, reducedMotion: value("owner-default-reduced-motion").checked
    });
    notify("New-visitor defaults saved. People who already chose their own settings keep them.", { type: "success" });
}

// ── Announcement banner ──────────────────────────────────────────────────────

function getAnnouncement() {
    const type = localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.announcementType);
    return {
        text: localStorage.getItem(OWNER_STORAGE_KEYS.announcement) || "",
        enabled: localStorage.getItem(OWNER_STORAGE_KEYS.announcementEnabled) === "true",
        type: ANNOUNCEMENT_TYPES.includes(type) ? type : "info"
    };
}

function setAnnouncement(text, enabled, type) {
    localStorage.setItem(OWNER_STORAGE_KEYS.announcement, text);
    localStorage.setItem(OWNER_STORAGE_KEYS.announcementEnabled, enabled ? "true" : "false");
    if (type) localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.announcementType, ANNOUNCEMENT_TYPES.includes(type) ? type : "info");
    applyAnnouncement();
    githubAutoSync();
}

function saveAnnouncementFromPanel() {
    const text    = document.getElementById('owner-announcement-text')?.value ?? "";
    const enabled = document.getElementById('owner-announcement-enabled')?.checked ?? false;
    const type    = document.getElementById('owner-announcement-type')?.value || "info";
    setAnnouncement(text, enabled, type);
}

// Short fingerprint of a banner, so closing it hides only that message:
// a new or changed announcement shows up again.
function announcementKey({ text, type }) {
    let h = 0;
    const s = type + "|" + text;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
}

const ANNOUNCEMENT_ICONS = {
    info:    '<path d="M12 8h.01M11 12h1v4h1"/><circle cx="12" cy="12" r="9"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
    warning: '<path d="M12 4 2.8 19.5h18.4L12 4z"/><path d="M12 10v4M12 17h.01"/>',
    urgent:  '<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'
};
const ANNOUNCEMENT_LABELS = { info: "Announcement", success: "Good news", warning: "Heads up", urgent: "Important" };

// Writes the text with any web links made clickable (no HTML from the message is used)
function appendLinkedText(el, text) {
    const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,!?)]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement("a");
        a.href = m[0]; a.target = "_blank"; a.rel = "noopener"; a.textContent = m[0].replace(/^https?:\/\//, "");
        el.appendChild(a);
        last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

function applyAnnouncement() {
    const existing = document.getElementById("owner-announcement-bar");
    const ann = getAnnouncement();
    const { text, enabled, type } = ann;
    const key = announcementKey(ann);
    let dismissed = null;
    try { dismissed = localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.announcementDismissed); } catch {}

    if (!enabled || !text.trim() || dismissed === key) {
        if (existing) existing.remove();
        return;
    }
    if (existing && existing.dataset.key === key) return;

    const bar = existing || document.createElement("div");
    bar.id = "owner-announcement-bar";
    bar.className = "announce-" + type;
    bar.dataset.key = key;
    bar.setAttribute("role", type === "urgent" || type === "warning" ? "alert" : "status");
    bar.innerHTML = `
        <div class="announce-inner">
            <span class="announce-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ANNOUNCEMENT_ICONS[type]}</svg></span>
            <span class="announce-label"></span>
            <span class="announce-text"></span>
        </div>
        <button type="button" class="announce-close" aria-label="Hide this announcement" title="Hide this announcement">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>`;
    bar.querySelector(".announce-label").textContent = ANNOUNCEMENT_LABELS[type];
    appendLinkedText(bar.querySelector(".announce-text"), text.trim());
    bar.querySelector(".announce-close").onclick = () => {
        try { localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.announcementDismissed, key); } catch {}
        bar.classList.add("announce-leaving");
        setTimeout(() => bar.remove(), 220);
    };

    if (!existing) {
        const header = document.querySelector("header");
        if (header) header.insertAdjacentElement("afterend", bar);
        else document.body.prepend(bar);
    }
}

// ── Disabled zones export / import ──────────────────────────────────────────

function exportDisabledZones() {
    const disabledIds = Array.from(getDisabledZoneIds());
    downloadJsonFile("disabled-zones.json", { disabledZoneIds: disabledIds, exportedAt: new Date().toISOString() });
}

function importDisabledZones(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data.disabledZoneIds)) throw new Error("Invalid format");
            setDisabledZoneIds(new Set(data.disabledZoneIds.map(String)));
            notify(`Imported ${data.disabledZoneIds.length} disabled game(s).`, { type: "success" });
            renderOwnerPanel();
        } catch (err) {
            notify("Couldn't import that file: " + err.message, { type: "error" });
        }
    };
    reader.readAsText(file);
}

async function enableAllZones() {
    if (!(await askConfirm('Every game you disabled will be visible to everyone again.', { title: 'Turn all games back on?', confirmText: 'Turn on all' }))) return;
    setDisabledZoneIds(new Set());
    githubAutoSync();
    renderOwnerPanel();
}

// ── Force zone cache refresh ─────────────────────────────────────────────────

async function forceRefreshZones() {
    featuredContainer.innerHTML = "";
    container.innerHTML = "Refreshing…";
    _allStatsCache = null;
    popularityData = {};
    await listZones();
    notify("Game list refreshed.", { type: "success" });
    renderOwnerPanel();
}

// ── Reset all owner data ─────────────────────────────────────────────────────

async function ownerResetAll() {
    if (!(await askConfirm('This clears site mode, disabled games, broken reports, the announcement, the message of the day and footer links.', { title: 'Reset all owner data?', confirmText: 'Reset everything', danger: true }))) return;
    localStorage.removeItem(OWNER_STORAGE_KEYS.siteMode);
    localStorage.removeItem(OWNER_STORAGE_KEYS.disabledZones);
    localStorage.removeItem(OWNER_STORAGE_KEYS.brokenReports);
    localStorage.removeItem(OWNER_STORAGE_KEYS.announcement);
    localStorage.removeItem(OWNER_STORAGE_KEYS.announcementEnabled);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.visitorDefaults);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motd);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motdEnabled);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motdLastSeen);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.footerLinks);
    applyOwnerSiteMode();
    applyAnnouncement();
    applyFooterLinks();
    featuredContainer.innerHTML = "";
    sortZones();
    notify("All owner data was reset.", { type: "success" });
    renderOwnerPanel();
}

const COLOR_THEMES = ["red", "orange", "blue", "green", "purple", "pink", "cyan"];
// Scene themes have their own animated background (scenes.js) and are always dark
const SCENE_THEMES = {
    space: "Outer space", starry: "Starry night", andromeda: "Andromeda", blackhole: "Black hole", saturn: "Saturn", nebula: "Nebula",
    clouds: "Sunny sky", autumn: "Autumn leaves", sakura: "Cherry blossom", snow: "Snowfall", aurora: "Aurora", storm: "Thunderstorm", ocean: "Deep sea",
    confetti: "Confetti", waves: "Wavy", pastel: "Pastel dream", prism: "Prism", honeycomb: "Honeycomb", gameicons: "Game icons",
    arcade: "Retro arcade", synthwave: "Retro sunset", neoncity: "Neon city", coderain: "Code rain", lava: "Lava", halloween: "Halloween",
    aura: "Spirit aura", custom: "Your own picture"
};
// How the scene picker groups them, and which scenes are bright (dark text on light panels)
const SCENE_GROUPS = { "🚀 Space": ["space", "starry", "andromeda", "blackhole", "saturn", "nebula"],
    "🌦️ Sky & weather": ["clouds", "autumn", "sakura", "snow", "aurora", "storm", "ocean"],
    "🎨 Patterns": ["confetti", "waves", "pastel", "prism", "honeycomb", "gameicons"],
    "🎉 Fun": ["aura", "arcade", "synthwave", "neoncity", "coderain", "lava", "halloween"] };
const LIGHT_SCENES = new Set(["clouds", "autumn", "pastel", "confetti", "waves"]);
const AVAILABLE_THEMES = [...COLOR_THEMES, ...Object.keys(SCENE_THEMES)];
function themeLabel(t) { return SCENE_THEMES[t] || (t[0].toUpperCase() + t.slice(1)); }
const TAB_CLOAK_STORAGE_KEYS = {
    title: "gnmath-tab-cloak-title",
    icon: "gnmath-tab-cloak-icon",
    initialized: "gnmath-tab-cloak-initialized"
};
const PREVIEW_CLOAK_STORAGE_KEYS = {
    enabled: "gnmath-preview-cloak-enabled",
    sensitivity: "gnmath-preview-cloak-sensitivity"
};
const APP_SETTINGS_STORAGE_KEYS = {
    warnBeforeUnload: "gnmath-warn-before-unload",
    reducedMotion: "gnmath-reduced-motion",
    customPrimaryColor: "gnmath-custom-primary-color",
    cardSize: "gnmath-card-size",
    fontSize: "gnmath-font-size",
    defaultSort: "gnmath-default-sort",
    hideFeatured: "gnmath-hide-featured",
    compactMode: "gnmath-compact-mode",
    autofocusSearch: "gnmath-autofocus-search",
    showPlayCount: "gnmath-show-play-count",
    panicUrl: "gnmath-panic-url",
    panicKey: "gnmath-panic-key",
    panicKeyEnabled: "gnmath-panic-key-enabled"
};
const OWNER_EXTRA_STORAGE_KEYS = {
    visitorDefaults: "gnmath-owner-visitor-defaults",
    motd: "gnmath-owner-motd",
    motdEnabled: "gnmath-owner-motd-enabled",
    motdLastSeen: "gnmath-owner-motd-lastseen",
    footerLinks: "gnmath-owner-footer-links",
    announcementType: "gnmath-owner-announcement-type",
    announcementDismissed: "gnmath-announcement-dismissed",
    siteMessage: "gnmath-owner-site-message",
    siteBackAt: "gnmath-owner-site-back-at",
    statusOverride: "gnmath-owner-status-override"
};
const ANNOUNCEMENT_TYPES = ["info", "success", "warning", "urgent"];
const OWNER_STORAGE_KEYS = {
    siteMode: "gnmath-owner-site-mode",
    disabledZones: "gnmath-owner-disabled-zones",
    brokenReports: "gnmath-broken-zone-reports",
    announcement: "gnmath-owner-announcement",
    announcementEnabled: "gnmath-owner-announcement-enabled",
    githubPat: "gnmath-owner-github-pat"
};
const OWNER_SITE_MODES = ["open", "locked", "maintenance", "shutdown"];
const VISITOR_DEFAULTS = {
    mode: "dark", theme: "red", cardSize: "medium", fontSize: "medium", defaultSort: "name",
    compactMode: false, hideFeatured: false, autofocusSearch: true, showPlayCount: false,
    warnBeforeUnload: true, reducedMotion: false
};

function getOwnerVisitorDefaults() {
    const stored = getJsonStorage(OWNER_EXTRA_STORAGE_KEYS.visitorDefaults, {});
    return { ...VISITOR_DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
}

function setOwnerVisitorDefaults(defaults, { sync = true } = {}) {
    const safe = {
        mode: defaults.mode === "light" ? "light" : "dark",
        theme: AVAILABLE_THEMES.includes(defaults.theme) ? defaults.theme : "red",
        cardSize: ["small", "medium", "large", "list"].includes(defaults.cardSize) ? defaults.cardSize : "medium",
        fontSize: ["small", "medium", "large"].includes(defaults.fontSize) ? defaults.fontSize : "medium",
        defaultSort: ["name", "id", "popular", "trendingDay", "trendingWeek", "trendingMonth"].includes(defaults.defaultSort) ? defaults.defaultSort : "name",
        compactMode: Boolean(defaults.compactMode), hideFeatured: Boolean(defaults.hideFeatured),
        autofocusSearch: Boolean(defaults.autofocusSearch), showPlayCount: Boolean(defaults.showPlayCount),
        warnBeforeUnload: Boolean(defaults.warnBeforeUnload), reducedMotion: Boolean(defaults.reducedMotion)
    };
    setJsonStorage(OWNER_EXTRA_STORAGE_KEYS.visitorDefaults, safe);
    if (sync) githubAutoSync();
}

function getVisitorSetting(storageKey, defaultKey) {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? getOwnerVisitorDefaults()[defaultKey] : saved;
}

// ── GitHub Sync ──────────────────────────────────────────────────────────────
const GITHUB_SYNC_REPO  = "SCHSwork/math";
const GITHUB_SYNC_FILE  = "config/owner-settings.json";
const GITHUB_SYNC_URL   = `https://api.github.com/repos/${GITHUB_SYNC_REPO}/contents/${GITHUB_SYNC_FILE}`;
// Public CDN URL — readable by ALL visitors (no token needed)
const GITHUB_SYNC_CDN   = `https://raw.githubusercontent.com/${GITHUB_SYNC_REPO}/main/${GITHUB_SYNC_FILE}`;

// ── Site owner account ───────────────────────────────────────────────────────
// The owner's account ID lives in config/firestore.rules (what Firebase
// enforces) and in owner-settings.json (so the site can show it). When the
// owner's GitHub token is saved on a browser that's signed in, the site writes
// that account into both by itself. The rules still have to be published in
// the Firebase console, since a GitHub token can't change Firebase.
const OWNER_UID_KEY = "gnmath-owner-uid";
const OWNER_UID_RE = /^[A-Za-z0-9]{10,128}$/;
const RULES_FILE_URL = `https://api.github.com/repos/${GITHUB_SYNC_REPO}/contents/config/firestore.rules`;
function getSiteOwnerUid() { try { return localStorage.getItem(OWNER_UID_KEY) || ""; } catch { return ""; } }
let _claimingOwner = false;
async function claimOwnerAccount() {
    const pat = getGithubPat();
    if (_claimingOwner || !pat || typeof cloudUser === "undefined" || !cloudUser) return;
    const uid = cloudUser.uid;
    if (!OWNER_UID_RE.test(uid)) return;
    _claimingOwner = true;
    try {
        const headers = { Authorization: `token ${pat}`, Accept: "application/vnd.github+json" };
        const res = await fetch(RULES_FILE_URL + "?t=" + Date.now(), { headers, cache: "no-store" });
        if (!res.ok) return;
        const file = await res.json();
        const rules = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
        const m = rules.match(/function ownerUid\(\) \{ return '([^']*)'; \} \/\/ OWNER_UID/);
        if (!m) return;
        if (m[1] === uid) {
            if (getSiteOwnerUid() !== uid) { localStorage.setItem(OWNER_UID_KEY, uid); githubAutoSync(); }
            return;
        }
        if (m[1] && !(await askConfirm(`Another account is set as the site owner. Make this account (${currentUsername()}) the owner instead?`, { title: "Change site owner?", confirmText: "Make owner" }))) return;
        const updated = rules.replace(m[0], `function ownerUid() { return '${uid}'; } // OWNER_UID`);
        const bytes = new TextEncoder().encode(updated);
        let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
        const put = await fetch(RULES_FILE_URL, {
            method: "PUT",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ message: `Set site owner to ${currentUsername().slice(0, 40)}`, content: btoa(bin), sha: file.sha }),
            cache: "no-store"
        });
        if (!put.ok) { notify("Couldn't set this account as the site owner on GitHub.", { type: "error" }); return; }
        localStorage.setItem(OWNER_UID_KEY, uid);
        githubAutoSync();
        if (typeof refreshAccountButtonAdmin === "function") refreshAccountButtonAdmin();
        notify(`${currentUsername()} is now the site owner. The updated rules publish to Firebase by themselves in a minute or two.`, { type: "success", duration: 15000 });
    } catch (e) {
        console.error(e);
    } finally {
        _claimingOwner = false;
    }
}

function getGithubPat() {
    return localStorage.getItem(OWNER_STORAGE_KEYS.githubPat) || "";
}
function setGithubPat(pat) {
    localStorage.setItem(OWNER_STORAGE_KEYS.githubPat, pat.trim());
}

/** Collect all current owner settings into one object */
function buildOwnerSettingsObject() {
    return {
        siteMode:      getOwnerSiteMode(),
        disabledZones: Array.from(getDisabledZoneIds()),
        announcement: {
            text:    getAnnouncement().text,
            enabled: getAnnouncement().enabled,
            type:    getAnnouncement().type
        },
        siteMessage: getOwnerSiteMessage(),
        siteBackAt: getSiteBackAt(),
        statusOverride: getStatusOverride(),
        motd: {
            text:    getMotd().text,
            enabled: getMotd().enabled
        },
        footerLinks: getFooterLinks() || [],
        visitorDefaults: getOwnerVisitorDefaults(),
        trustedReporters: getTrustedReporters(),
        ownerUid: getSiteOwnerUid(),
        updatedAt: new Date().toISOString()
    };
}

// updatedAt of the newest settings this browser has applied. Backup mirrors can
// serve an old copy, and that must never undo a newer lock or reopen.
const OWNER_SETTINGS_AT_KEY = "gnmath-owner-settings-at";
function getAppliedSettingsAt() {
    try { return Date.parse(localStorage.getItem(OWNER_SETTINGS_AT_KEY) || "") || 0; } catch { return 0; }
}
function setAppliedSettingsAt(iso) {
    try { if (!isNaN(Date.parse(iso))) localStorage.setItem(OWNER_SETTINGS_AT_KEY, iso); } catch {}
}

/** Apply a settings object that was loaded from GitHub */
function applyOwnerSettingsObject(settings, { rerender = false } = {}) {
    if (!settings || typeof settings !== "object") return;
    const at = Date.parse(settings.updatedAt || "");
    if (at && at <= getAppliedSettingsAt()) return;  // nothing newer than what we already have
    if (at) setAppliedSettingsAt(settings.updatedAt);

    if (typeof settings.siteBackAt === "string") {
        localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteBackAt, isNaN(Date.parse(settings.siteBackAt)) ? "" : settings.siteBackAt);
    }
    if (typeof settings.siteMessage === "string") {
        localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteMessage, settings.siteMessage.slice(0, 400));
    }
    if (settings.statusOverride && typeof settings.statusOverride === "object") {
        setStatusOverride(settings.statusOverride, { sync: false });
    }
    if (typeof settings.siteMode === "string") {
        localStorage.setItem(OWNER_STORAGE_KEYS.siteMode, settings.siteMode);
        applyOwnerSiteMode();
    }
    if (Array.isArray(settings.disabledZones)) {
        setDisabledZoneIds(new Set(settings.disabledZones.map(String)));
        if (rerender) { featuredContainer.innerHTML = ""; sortZones(); }
    }
    if (settings.announcement && typeof settings.announcement === "object") {
        localStorage.setItem(OWNER_STORAGE_KEYS.announcement, settings.announcement.text ?? "");
        localStorage.setItem(OWNER_STORAGE_KEYS.announcementEnabled, settings.announcement.enabled ? "true" : "false");
        localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.announcementType, ANNOUNCEMENT_TYPES.includes(settings.announcement.type) ? settings.announcement.type : "info");
        applyAnnouncement();
    }
    if (settings.motd && typeof settings.motd === "object") {
        localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motd, settings.motd.text ?? "");
        localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motdEnabled, settings.motd.enabled ? "true" : "false");
    }
    if (settings.visitorDefaults && typeof settings.visitorDefaults === "object") {
        setOwnerVisitorDefaults(settings.visitorDefaults, { sync: false });
        applySavedSettings();
    }
    if (Array.isArray(settings.trustedReporters)) {
        setTrustedReporters(settings.trustedReporters
            .filter(x => x && typeof x.uid === "string" && /^[A-Za-z0-9_.@-]{6,128}$/.test(x.uid))
            .map(x => ({ uid: x.uid, name: String(x.name || "").slice(0, 40) })));
        if (rerender && typeof refreshCards === "function") refreshCards();
    }
    if (typeof settings.ownerUid === "string" && (!settings.ownerUid || OWNER_UID_RE.test(settings.ownerUid))) {
        try { localStorage.setItem(OWNER_UID_KEY, settings.ownerUid); } catch {}
        if (typeof refreshAccountButtonAdmin === "function") refreshAccountButtonAdmin();
    }
    if (Array.isArray(settings.footerLinks)) {
        localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.footerLinks, JSON.stringify(settings.footerLinks));
        applyFooterLinks();
    }
}

/** Debounced auto-sync — waits 1.5 s after the last change before pushing */
let _autoSyncTimer = null;
function githubAutoSync() {
    if (!getGithubPat()) return;          // no token stored → skip silently
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(async () => {
        _autoSyncTimer = null;
        const ok = await githubSyncPush();
        noteSiteModeSaved(ok);
        const status = document.getElementById("owner-sync-status");
        if (status) {
            status.textContent = ok
                ? "✓ Auto-saved to GitHub — " + new Date().toLocaleTimeString()
                : "✗ Auto-save failed – check your token";
            status.style.color = ok ? "var(--success)" : "#ef4444";
        }
    }, 1500);
}

/** Push current settings to GitHub. Returns true on success. */
// Pushes run one at a time: two at once would both use the same file SHA and
// the second would be rejected, losing that change (e.g. locked → shutdown).
let _syncPushChain = Promise.resolve();
let _lastPushedAt = "";
let _syncPushing = 0;
function githubSyncPush() {
    _syncPushing++;
    const run = _syncPushChain.then(githubSyncPushOnce, githubSyncPushOnce);
    _syncPushChain = run.catch(() => {});
    return run.finally(() => { _syncPushing--; });
}
async function githubSyncPushOnce() {
    const pat = getGithubPat();
    if (!pat) return false;

    const settings = buildOwnerSettingsObject();
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(settings, null, 2))));
    const headers = { Authorization: `token ${pat}`, Accept: "application/vnd.github+json" };

    for (let attempt = 0; attempt < 3; attempt++) {
        // Current SHA (needed for updates). no-store: the browser would otherwise
        // reuse a cached reply for up to a minute and the save would be rejected.
        let sha;
        try {
            const res = await fetch(GITHUB_SYNC_URL + "?t=" + Date.now(), { headers, cache: "no-store" });
            if (res.ok) sha = (await res.json()).sha;
        } catch (_) {}

        const body = { message: "chore: update owner-settings", content };
        if (sha) body.sha = sha;

        const putRes = await fetch(GITHUB_SYNC_URL, {
            method: "PUT",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            cache: "no-store"
        });
        if (putRes.ok) { setAppliedSettingsAt(settings.updatedAt); _lastPushedAt = settings.updatedAt; return true; }
        // 409/422 = SHA was out of date; fetch it again and retry
        if (putRes.status !== 409 && putRes.status !== 422) return false;
    }
    return false;
}

/** Pull settings from the public CDN (works for all visitors, no token). */
async function githubSyncPull({ rerender = false } = {}) {
    // Don't let a pull undo a change the owner just made that isn't saved yet
    if (_autoSyncTimer || _syncPushing) return;
    try {
        let settings;
        const pat = getGithubPat();
        if (pat) {
            // Owner device: authenticated API is always fresh and has a high rate limit.
            const res = await fetch(GITHUB_SYNC_URL + "?t=" + Date.now(), {
                headers: { Accept: "application/vnd.github+json", Authorization: `token ${pat}` },
                cache: "no-store"
            });
            noteSyncResponse(res);
            if (res.ok) {
                const json = await res.json();
                settings = JSON.parse(decodeURIComponent(escape(atob(json.content.replace(/\n/g, "")))));
            }
        }
        if (!settings) {
            // Visitors: raw.githubusercontent.com has no 60/hour per-IP limit, which
            // the unauthenticated API would hit fast on a shared school network.
            // It can cache for a few minutes, so lock/shutdown changes may take
            // up to ~5 minutes to reach everyone.
            const [owner, repo] = GITHUB_SYNC_REPO.split("/");
            const urls = [GITHUB_SYNC_CDN + "?t=" + Date.now(), MIRRORS.githack(owner, repo, "HEAD", GITHUB_SYNC_FILE), MIRRORS.jsdelivr(owner, repo, "main", GITHUB_SYNC_FILE)];
            for (const [i, url] of urls.entries()) {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 10000);
                try {
                    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
                    if (i === 0) noteSyncResponse(res);
                    if (res.ok) { settings = await res.json(); break; }
                } catch (_) {
                    if (i === 0) noteSyncResult("failed");
                } finally { clearTimeout(timer); }
            }
            if (!settings) return; // keep the last settings this browser already has
        }
        if (_autoSyncTimer || _syncPushing) return;
        applyOwnerSettingsObject(settings, { rerender });
    } catch (_) {}
}

// ── Adaptive check speed ────────────────────────────────────────────────────
// How often open pages look for owner changes. It slows down by itself when
// GitHub says "too many requests" (or is close to it), when a lot of people are
// online (a whole school often shares one network address, and the limit is per
// address), and speeds back up once things are fine. Shared by all tabs in this
// browser, so several open tabs don't each make their own checks.
const SYNC_PACE_KEY = "gnmath-sync-pace";
const SYNC_BASE_MS = 60000, SYNC_MAX_MS = 15 * 60000;
function getSyncPace() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(SYNC_PACE_KEY) || "null"); } catch {}
    return {
        slow: Math.min(16, Math.max(1, Number(p?.slow) || 1)), pauseUntil: Number(p?.pauseUntil) || 0,
        last: Number(p?.last) || 0, okAt: Number(p?.okAt) || 0,
        why: ["limited", "near", "network"].includes(p?.why) ? p.why : ""   // why it's slowed down
    };
}
function setSyncPace(changes) {
    try { localStorage.setItem(SYNC_PACE_KEY, JSON.stringify({ ...getSyncPace(), ...changes })); } catch {}
}
function noteSyncResult(kind, pauseUntil = 0) {
    const { slow, why } = getSyncPace();
    if (kind === "ok") {                                                         // ease back up
        const next = Math.max(1, slow / 1.5);
        setSyncPace({ slow: next, okAt: Date.now(), why: next > 1 ? why : "" });
    }
    else if (kind === "limited") setSyncPace({ slow: Math.min(16, slow * 2), pauseUntil: Math.max(pauseUntil, Date.now() + SYNC_BASE_MS * 2), why: "limited" });
    else setSyncPace({ slow: Math.min(4, slow * 1.5), why: why === "limited" ? why : "network" }); // network trouble: back off a little
}
// Reads GitHub's rate-limit headers when the browser is allowed to see them
function noteSyncResponse(res) {
    const h = name => res.headers.get(name);
    const retryAfter = Number(h("retry-after")) || 0;
    const remaining = Number(h("x-ratelimit-remaining")), limit = Number(h("x-ratelimit-limit"));
    const reset = Number(h("x-ratelimit-reset")) * 1000 || 0;
    if (res.status === 429 || (res.status === 403 && (remaining === 0 || retryAfter))) {
        noteSyncResult("limited", retryAfter ? Date.now() + retryAfter * 1000 : reset);
    } else if (res.ok && limit > 0 && remaining / limit < 0.2) {
        // Getting close: slow down in step with how little is left
        setSyncPace({ slow: Math.min(16, Math.max(getSyncPace().slow, 2 * limit / Math.max(1, remaining) / 5)), okAt: Date.now(), why: "near" });
    } else if (res.ok) noteSyncResult("ok");
    else if (res.status >= 500) noteSyncResult("failed");
}
// Time to wait before the next check, with a little randomness so tabs on the
// same network don't all ask at the same second
function syncCrowdFactor() {
    const online = window.gnActiveUsers?.count || 0;
    return Math.min(4, Math.max(1, online / 150));          // 300 online = every 2 min, 600+ = every 4 min
}
function syncNominalDelay() {
    return Math.min(SYNC_MAX_MS, SYNC_BASE_MS * syncCrowdFactor() * getSyncPace().slow);
}
function syncCheckDelay() {
    return syncNominalDelay() * (0.8 + Math.random() * 0.4);
}
// One line for the status light: how fast owner changes reach this page right now
function syncPaceSummary() {
    const pace = getSyncPace();
    const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m === 1 ? "1 min" : m + " min"; };
    const ago = pace.okAt ? ` Last checked ${Date.now() - pace.okAt < 60000 ? "just now" : mins(Date.now() - pace.okAt) + " ago"}.` : "";
    if (Date.now() < pace.pauseUntil) {
        return { level: "info", detail: `Paused for about ${mins(pace.pauseUntil - Date.now())}: GitHub asked for fewer requests from this network. Lock and reopen changes may arrive late.${ago}` };
    }
    const every = `every ${mins(syncNominalDelay())}`;
    const reasons = [];
    if (pace.slow > 1.05 && pace.why === "limited") reasons.push("GitHub recently hit its request limit");
    if (pace.slow > 1.05 && pace.why === "near") reasons.push("close to GitHub's request limit");
    if (pace.slow > 1.05 && pace.why === "network") reasons.push("trouble reaching GitHub");
    if (syncCrowdFactor() > 1.05) reasons.push("lots of people online");
    if (!reasons.length) return { level: "ok", detail: `Checking for owner changes ${every}.${ago}` };
    return { level: "info", detail: `Slowed to ${every} (${reasons.join(", ")}) to stay under GitHub's limits.${ago}` };
}
let _nextSyncDelay = SYNC_BASE_MS;
function syncCheckDue() {
    const pace = getSyncPace();
    if (Date.now() < pace.pauseUntil) return false;
    return Date.now() - pace.last >= _nextSyncDelay;
}
async function adaptiveSyncPull() {
    setSyncPace({ last: Date.now() });
    _nextSyncDelay = syncCheckDelay();
    await githubSyncPull();
}

// Visitors already on the site pick up lock / maintenance / shutdown (and other
// owner changes) without reloading. While closed, the lock screen checks on its own.
function startOwnerSettingsWatch() {
    setSyncPace({ last: Date.now() });
    _nextSyncDelay = syncCheckDelay();
    const check = () => {
        if (document.hidden || getOwnerSiteMode() !== "open" || !syncCheckDue()) return;
        adaptiveSyncPull();
    };
    setInterval(check, 15000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    // Another tab in this browser got new settings: show them here too
    window.addEventListener("storage", e => {
        if (e.key === OWNER_STORAGE_KEYS.siteMode || e.key === OWNER_EXTRA_STORAGE_KEYS.siteMessage || e.key === OWNER_EXTRA_STORAGE_KEYS.siteBackAt) applyOwnerSiteMode();
        if (e.key === OWNER_EXTRA_STORAGE_KEYS.statusOverride && typeof updateSiteStatus === "function") updateSiteStatus();
    });
}

/** Save settings then immediately push to GitHub. Shows status in panel. */
async function ownerSyncSave() {
    const btn    = document.getElementById("owner-sync-btn");
    const status = document.getElementById("owner-sync-status");
    if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
    if (status) status.textContent = "";
    try {
        const ok = await githubSyncPush();
        if (btn)    { btn.textContent = "Save & Sync to GitHub"; btn.disabled = false; }
        if (status) {
            status.textContent = ok
                ? "✓ Saved to GitHub — all devices will pick this up on next load."
                : "✗ Save failed. Check your token has repo write access.";
            status.style.color = ok ? "var(--success)" : "#ef4444";
        }
    } catch(e) {
        if (btn)    { btn.textContent = "Save & Sync to GitHub"; btn.disabled = false; }
        if (status) { status.textContent = "✗ Error: " + e.message; status.style.color = "#ef4444"; }
    }
}

/** (Legacy) Save a PAT typed into an input — the unlock dialog handles this now. */
function ownerSavePat() {
    const input = document.getElementById("owner-pat-input");
    if (!input) return;
    const val = input.value.trim();
    // If it's the masked display value, do nothing
    if (val.includes("•")) return;
    setGithubPat(val);
    const status = document.getElementById("owner-sync-status");
    if (status) {
        status.textContent = val ? "✓ Token saved locally." : "Token cleared.";
        status.style.color = "var(--success)";
    }
}

/** Manual pull — fetch latest settings from GitHub and apply. */
async function ownerSyncPullManual() {
    const status = document.getElementById("owner-sync-status");
    if (status) { status.textContent = "Pulling…"; status.style.color = "var(--text-muted)"; }
    try {
        await githubSyncPull({ rerender: true });
        renderOwnerPanel();
        const s = document.getElementById("owner-sync-status");
        if (s) { s.textContent = "✓ Pulled latest settings from GitHub."; s.style.color = "var(--success)"; }
    } catch(e) {
        if (status) { status.textContent = "✗ Pull failed: " + e.message; status.style.color = "#ef4444"; }
    }
}
const TAB_CLOAK_PRESETS = {
    canvas: {
        label: "Canvas",
        title: "Dashboard",
        icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico"
    },
    googleClassroom: {
        label: "Google Classroom",
        title: "Classes",
        icon: "https://ssl.gstatic.com/classroom/favicon.png"
    },
    googleDrive: {
        label: "Google Drive",
        title: "My Drive - Google Drive",
        icon: "https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_32dp.png"
    }
};

function applySavedSettings() {
    const savedMode = getVisitorSetting("gnmath-mode", "mode");
    if (savedMode === "light") {
        document.body.classList.remove("dark-mode");
    } else {
        document.body.classList.add("dark-mode");
    }

    const savedTheme = getVisitorSetting("gnmath-theme", "theme");
    setTheme(savedTheme, { persist: false });
    applyStoredCustomPrimaryColor();
    initializeDefaultTabCloak();
    applyStoredTabCloak();
    applyBehaviorSettings();
    applyOwnerSiteMode();
    applyAnnouncement();
    setupTabPreviewCloak();
    initializeDefaultTabCloak();
    applyStoredTabCloak();
    applyCardSize();
    applyFontSize();
    applyCompactMode();
    applyHideFeatured();
    applyDefaultSort();
    applyFooterLinks();
}

// ── Card size ────────────────────────────────────────────────────────────────
function getCardSize() { return getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.cardSize, "cardSize"); }
function setCardSize(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.cardSize, val);
    applyCardSize();
}
function applyCardSize() {
    document.body.classList.remove("cards-small", "cards-large", "cards-list");
    const v = getCardSize();
    if (v !== "medium") document.body.classList.add(`cards-${v}`);
}

// ── Font size ────────────────────────────────────────────────────────────────
function getFontSize() { return getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.fontSize, "fontSize"); }
function setFontSize(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.fontSize, val);
    applyFontSize();
}
function applyFontSize() {
    document.body.classList.remove("font-small", "font-large");
    const v = getFontSize();
    if (v !== "medium") document.body.classList.add(`font-${v}`);
}

// ── Compact mode ─────────────────────────────────────────────────────────────
function getCompactMode() { return getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.compactMode, "compactMode") === true || getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.compactMode, "compactMode") === "true"; }
function setCompactMode(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.compactMode, val ? "true" : "false");
    applyCompactMode();
}
function applyCompactMode() {
    document.body.classList.toggle("compact-mode", getCompactMode());
}

// ── Hide featured ─────────────────────────────────────────────────────────────
function getHideFeatured() { return getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.hideFeatured, "hideFeatured") === true || getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.hideFeatured, "hideFeatured") === "true"; }
function setHideFeatured(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.hideFeatured, val ? "true" : "false");
    applyHideFeatured();
}
function applyHideFeatured() {
    const wrapper = document.getElementById("featuredZonesWrapper");
    if (wrapper) wrapper.style.display = getHideFeatured() ? "none" : "";
}

// ── Default sort ──────────────────────────────────────────────────────────────
function getDefaultSort() { return getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.defaultSort, "defaultSort"); }
function setDefaultSort(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.defaultSort, val);
}
function applyDefaultSort() {
    const s = getDefaultSort();
    const el = document.getElementById("sortOptions");
    if (el && el.value !== s) { el.value = s; sortZones(); }
}

// ── Autofocus search ──────────────────────────────────────────────────────────
function getAutofocusSearch() { const value = getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.autofocusSearch, "autofocusSearch"); return value === true || value === "true"; }
function setAutofocusSearch(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.autofocusSearch, val ? "true" : "false");
}

// ── Show play count on cards ──────────────────────────────────────────────────
function getShowPlayCount() { const value = getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.showPlayCount, "showPlayCount"); return value === true || value === "true"; }
function setShowPlayCount(val) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.showPlayCount, val ? "true" : "false");
    featuredContainer.innerHTML = "";
    sortZones();
}

// ── MOTD (owner, synced) ──────────────────────────────────────────────────────
function getMotd() {
    return {
        text: localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.motd) || "",
        enabled: localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.motdEnabled) === "true"
    };
}
function setMotd(text, enabled) {
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motd, text);
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motdEnabled, enabled ? "true" : "false");
    githubAutoSync();
}
function maybeShowMotd() {
    const { text, enabled } = getMotd();
    if (!enabled || !text.trim()) return;
    const last = localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.motdLastSeen) || "";
    const today = new Date().toDateString();
    if (last === today) return;
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motdLastSeen, today);
    // show as a popup
    document.getElementById('popupTitle').textContent = "📢 Notice";
    const popupBody = document.getElementById('popupBody');
    popupBody.innerHTML = `<p style="white-space:pre-wrap;">${text.replace(/</g,'&lt;')}</p>
        <button class="settings-button" onclick="closePopup()">Got it</button>`;
    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
}

// ── Owner password change ─────────────────────────────────────────────────────
// Owner access = a GitHub token from an account that can edit the site's repo.
// The token is checked with GitHub and kept only in this browser.
async function verifyOwnerToken(token) {
    const t = (token || "").trim();
    if (!t) return { ok: false, error: "Paste your GitHub token." };
    let res;
    try {
        res = await fetch(`https://api.github.com/repos/${GITHUB_SYNC_REPO}`, {
            headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
            cache: "no-store"
        });
    } catch (e) {
        return { ok: false, error: "Couldn't reach GitHub. Check your connection." };
    }
    if (res.status === 401) return { ok: false, error: "That token isn't valid or has expired." };
    if (!res.ok) return { ok: false, error: `That token can't access ${GITHUB_SYNC_REPO}.` };
    const repo = await res.json().catch(() => ({}));
    if (!repo.permissions || !repo.permissions.push) {
        return { ok: false, error: `That token's account isn't allowed to edit ${GITHUB_SYNC_REPO}.` };
    }
    return { ok: true };
}

function ownerUnlockedThisTab() {
    try { return !!getGithubPat() && sessionStorage.getItem("gnmath-owner-unlocked") === "1"; } catch { return false; }
}

// Runs onSuccess once the owner is verified; asks for the token if needed.
async function requestOwnerAccess(onSuccess) {
    if (ownerUnlockedThisTab()) { claimOwnerAccount(); return onSuccess(); }
    const saved = getGithubPat();
    if (saved) {
        const check = await verifyOwnerToken(saved);
        if (check.ok) {
            try { sessionStorage.setItem("gnmath-owner-unlocked", "1"); } catch {}
            claimOwnerAccount();
            return onSuccess();
        }
    }
    showOwnerTokenDialog(onSuccess, saved ? "Your saved token stopped working. Paste a new one." : "");
}

function showOwnerTokenDialog(onSuccess, notice) {
    document.getElementById("owner-token-dialog")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "owner-token-dialog";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2000001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:16px;";
    wrap.innerHTML = `
        <div style="width:100%;max-width:420px;background:var(--surface,#1e293b);color:var(--text,#f1f5f9);border-radius:16px;padding:1.5rem;box-shadow:0 20px 40px rgba(0,0,0,0.5);font-family:inherit;">
            <h3 style="margin:0 0 0.5rem;">Owner access</h3>
            <p style="margin:0 0 1rem;font-size:14px;color:var(--text-muted,#94a3b8);">Paste your GitHub token for <b></b>. It's checked with GitHub and saved only in this browser.</p>
            <input type="password" id="owner-token-input" placeholder="github_pat_…" autocomplete="off" spellcheck="false"
                style="width:100%;box-sizing:border-box;padding:0.7rem 0.8rem;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg-secondary,#0f172a);color:inherit;font-family:monospace;font-size:13px;">
            <p id="owner-token-msg" style="margin:0.6rem 0 0;font-size:13px;color:#ef4444;min-height:1.2em;"></p>
            <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.75rem;">
                <button type="button" id="owner-token-cancel" class="settings-button" style="background:var(--surface-hover,#334155);">Cancel</button>
                <button type="button" id="owner-token-ok" class="settings-button">Unlock</button>
            </div>
        </div>`;
    wrap.querySelector("b").textContent = GITHUB_SYNC_REPO;
    document.body.appendChild(wrap);
    const input = wrap.querySelector("#owner-token-input");
    const msg = wrap.querySelector("#owner-token-msg");
    const okBtn = wrap.querySelector("#owner-token-ok");
    msg.textContent = notice || "";
    const submit = async () => {
        okBtn.disabled = true;
        msg.style.color = "var(--text-muted,#94a3b8)";
        msg.textContent = "Checking with GitHub…";
        const token = input.value.trim();
        const check = await verifyOwnerToken(token);
        okBtn.disabled = false;
        if (!check.ok) { msg.style.color = "#ef4444"; msg.textContent = check.error; return; }
        setGithubPat(token);
        try { sessionStorage.setItem("gnmath-owner-unlocked", "1"); } catch {}
        wrap.remove();
        claimOwnerAccount();
        onSuccess();
    };
    okBtn.onclick = submit;
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); if (e.key === "Escape") wrap.remove(); });
    wrap.querySelector("#owner-token-cancel").onclick = () => wrap.remove();
    setTimeout(() => input.focus(), 0);
}

async function ownerForgetToken() {
    if (!(await askConfirm("You'll need to paste it again to open the Owner Panel on this browser.", { title: "Remove GitHub token?", confirmText: "Remove", danger: true }))) return;
    setGithubPat("");
    try { sessionStorage.removeItem("gnmath-owner-unlocked"); } catch {}
    closePopup();
}

// ── MOTD panel helpers ────────────────────────────────────────────────────────
function saveMotdFromPanel() {
    const text    = document.getElementById("owner-motd-text")?.value ?? "";
    const enabled = document.getElementById("owner-motd-enabled")?.checked ?? false;
    setMotd(text, enabled);
}
function resetMotdLastSeen() {
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motdLastSeen);
    notify("The message of the day will show again on the next visit.", { type: "success" });
}

// ── Footer links panel helpers ────────────────────────────────────────────────
function saveFooterLinksFromPanel() {
    const raw = document.getElementById("owner-footer-links-text")?.value ?? "";
    const links = raw.split("\n")
        .map(line => line.trim())
        .filter(line => line.includes("|"))
        .map(line => {
            const idx = line.indexOf("|");
            return { label: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
        })
        .filter(({ label, url }) => label && url);
    setFooterLinks(links);
    notify(`Saved ${links.length} footer link(s).`, { type: "success" });
}
async function clearFooterLinks() {
    if (!(await askConfirm('Your custom footer links will be removed for everyone.', { title: 'Remove all footer links?', confirmText: 'Remove', danger: true }))) return;
    setFooterLinks([]);
    renderOwnerPanel();
}

// ── Custom footer links (owner, synced) ───────────────────────────────────────
function getFooterLinks() {
    try {
        const stored = localStorage.getItem(OWNER_EXTRA_STORAGE_KEYS.footerLinks);
        return stored ? JSON.parse(stored) : null;
    } catch { return null; }
}
function setFooterLinks(links) {
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.footerLinks, JSON.stringify(links));
    applyFooterLinks();
    githubAutoSync();
}
function applyFooterLinks() {
    const links = getFooterLinks();
    if (!links || !Array.isArray(links)) return;
    const footer = document.querySelector('.footer-links');
    if (!footer) return;
    // keep the built-in links, append custom ones (avoid duplicates by data attr)
    footer.querySelectorAll('[data-owner-link]').forEach(el => el.remove());
    links.forEach(({ label, url }) => {
        if (!label || !url) return;
        const a = document.createElement('a');
        a.href = url;
        a.textContent = label;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.dataset.ownerLink = '1';
        footer.appendChild(a);
    });
}

function darkMode() {
    // Flip the saved choice; a scene theme keeps its own look until you leave it
    const wasDark = getVisitorSetting("gnmath-mode", "mode") !== "light";
    localStorage.setItem("gnmath-mode", wasDark ? "light" : "dark");
    applyModeForTheme();
    const theme = getVisitorSetting("gnmath-theme", "theme");
    if (SCENE_THEMES[theme] && typeof notify === "function") notify(`Saved: ${wasDark ? "light" : "dark"} mode. Scenes keep their own look, so you'll see it when you switch to a color theme.`);
}
// Scenes set their own brightness (bright scenes light, the rest dark);
// color themes follow the visitor's dark/light choice.
function applyModeForTheme(theme = getVisitorSetting("gnmath-theme", "theme")) {
    const dark = SCENE_THEMES[theme] ? !LIGHT_SCENES.has(theme) : getVisitorSetting("gnmath-mode", "mode") !== "light";
    document.body.classList.toggle("dark-mode", dark);
}

// The page scrollbar is drawn for <html>, which can't see the theme colors set
// on <body>, so copy them up whenever the theme, custom color or mode changes.
function syncScrollbarColors() {
    if (!document.body) return;
    const cs = getComputedStyle(document.body);
    const root = document.documentElement.style;
    root.setProperty("--sb-primary", cs.getPropertyValue("--primary").trim() || "#fc2651");
    root.setProperty("--sb-bg", cs.getPropertyValue("--bg").trim() || cs.backgroundColor);
}
if (typeof MutationObserver !== "undefined") {
    const startSbSync = () => {
        syncScrollbarColors();
        new MutationObserver(syncScrollbarColors).observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    };
    if (document.body) startSbSync(); else document.addEventListener("DOMContentLoaded", startSbSync);
}

function setTheme(themeName, { persist = true } = {}) {
    const safeTheme = AVAILABLE_THEMES.includes(themeName) ? themeName : "red";
    document.body.classList.remove(...AVAILABLE_THEMES.map(theme => `theme-${theme}`));
    document.body.classList.add(`theme-${safeTheme}`);
    document.body.classList.toggle("scene-theme", !!SCENE_THEMES[safeTheme]);
    document.body.classList.toggle("scene-light", LIGHT_SCENES.has(safeTheme));
    applyModeForTheme(safeTheme);
    if (persist) localStorage.setItem("gnmath-theme", safeTheme);
    if (persist) clearCustomPrimaryColor();
    updateThemeButtons();
}

function updateThemeButtons() {
    const activeTheme = getVisitorSetting("gnmath-theme", "theme");
    const buttons = document.querySelectorAll("[data-theme-option]");
    buttons.forEach(button => {
        const isActive = button.dataset.themeOption === activeTheme;
        button.classList.toggle("active", isActive);
    });
}

function clampColor(value) {
    return Math.max(0, Math.min(255, value));
}

function adjustHexColor(hexColor, adjustment) {
    const normalizedHex = (hexColor || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
        return "#fc2651";
    }

    const r = clampColor(parseInt(normalizedHex.slice(0, 2), 16) + adjustment);
    const g = clampColor(parseInt(normalizedHex.slice(2, 4), 16) + adjustment);
    const b = clampColor(parseInt(normalizedHex.slice(4, 6), 16) + adjustment);

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgb(hexColor) {
    const normalizedHex = (hexColor || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
        return { r: 252, g: 38, b: 81 };
    }

    return {
        r: parseInt(normalizedHex.slice(0, 2), 16),
        g: parseInt(normalizedHex.slice(2, 4), 16),
        b: parseInt(normalizedHex.slice(4, 6), 16)
    };
}

function getCustomPrimaryColor() {
    return localStorage.getItem(APP_SETTINGS_STORAGE_KEYS.customPrimaryColor);
}

function clearCustomPrimaryColorStyles() {
    const style = document.body.style;
    style.removeProperty("--primary");
    style.removeProperty("--primary-hover");
    style.removeProperty("--primary-light");
    style.removeProperty("--primary-lighter");
    style.removeProperty("--shadow-glow");
    style.removeProperty("--gradient-primary");
}

function applyCustomPrimaryColor(hexColor) {
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(hexColor || "") ? hexColor : "#fc2651";
    const hoverColor = adjustHexColor(safeColor, -20);
    const rgb = hexToRgb(safeColor);
    const style = document.body.style;

    style.setProperty("--primary", safeColor);
    style.setProperty("--primary-hover", hoverColor);
    style.setProperty("--primary-light", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
    style.setProperty("--primary-lighter", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
    style.setProperty("--shadow-glow", `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
    style.setProperty("--gradient-primary", `linear-gradient(135deg, ${safeColor} 0%, ${hoverColor} 100%)`);
}

function setCustomPrimaryColor(hexColor) {
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(hexColor || "") ? hexColor : "#fc2651";
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.customPrimaryColor, safeColor);
    applyCustomPrimaryColor(safeColor);
}

function clearCustomPrimaryColor() {
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.customPrimaryColor);
    clearCustomPrimaryColorStyles();
}

function applyStoredCustomPrimaryColor() {
    const customColor = getCustomPrimaryColor();
    clearCustomPrimaryColorStyles();
    if (customColor) {
        applyCustomPrimaryColor(customColor);
    }
}

function initializeDefaultTabCloak() {
    if (localStorage.getItem(TAB_CLOAK_STORAGE_KEYS.initialized)) {
        return;
    }

    localStorage.setItem(TAB_CLOAK_STORAGE_KEYS.title, TAB_CLOAK_PRESETS.canvas.title);
    localStorage.setItem(TAB_CLOAK_STORAGE_KEYS.icon, TAB_CLOAK_PRESETS.canvas.icon);
    localStorage.setItem(TAB_CLOAK_STORAGE_KEYS.initialized, "true");
}

function getStoredTabCloak() {
    return {
        title: localStorage.getItem(TAB_CLOAK_STORAGE_KEYS.title) || "GN 2.0",
        icon: localStorage.getItem(TAB_CLOAK_STORAGE_KEYS.icon) || window.GN_ICON_URL
    };
}

function applyStoredTabCloak() {
    const storedCloak = getStoredTabCloak();
    cloakName(storedCloak.title, { persist: false });
    cloakIcon(storedCloak.icon, { persist: false });
}

function getWarnBeforeUnloadEnabled() {
    const value = getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.warnBeforeUnload, "warnBeforeUnload");
    return value === true || value === "true";
}

function setWarnBeforeUnloadEnabled(isEnabled) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.warnBeforeUnload, isEnabled ? "true" : "false");
    updateBeforeUnloadProtection();
}

function updateBeforeUnloadProtection() {
    window.removeEventListener("beforeunload", gnmathBeforeUnloadHandler);
    if (getWarnBeforeUnloadEnabled()) {
        window.addEventListener("beforeunload", gnmathBeforeUnloadHandler);
    }
}

function getReducedMotionEnabled() {
    const value = getVisitorSetting(APP_SETTINGS_STORAGE_KEYS.reducedMotion, "reducedMotion");
    return value === true || value === "true";
}

function setReducedMotionEnabled(isEnabled) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.reducedMotion, isEnabled ? "true" : "false");
    document.body.classList.toggle("reduced-motion", isEnabled);
}

function applyBehaviorSettings() {
    updateBeforeUnloadProtection();
    document.body.classList.toggle("reduced-motion", getReducedMotionEnabled());
}

function getPreviewCloakEnabled() {
    return localStorage.getItem(PREVIEW_CLOAK_STORAGE_KEYS.enabled) === "true";
}

function setPreviewCloakEnabled(isEnabled) {
    localStorage.setItem(PREVIEW_CLOAK_STORAGE_KEYS.enabled, isEnabled ? "true" : "false");
    if (!isEnabled) {
        setTabPreviewCloak(false);
    }
}

function getPreviewCloakSensitivity() {
    const sensitivity = localStorage.getItem(PREVIEW_CLOAK_STORAGE_KEYS.sensitivity) || "medium";
    if (!["low", "lowMed", "medium", "high"].includes(sensitivity)) {
        return "medium";
    }
    return sensitivity;
}

function setPreviewCloakSensitivity(sensitivity) {
    const safeSensitivity = ["low", "lowMed", "medium", "high"].includes(sensitivity) ? sensitivity : "medium";
    localStorage.setItem(PREVIEW_CLOAK_STORAGE_KEYS.sensitivity, safeSensitivity);
}

function ensureTabPreviewOverlay() {
    let overlay = document.getElementById("tab-preview-cloak-overlay");
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = "tab-preview-cloak-overlay";
    document.body.appendChild(overlay);
    return overlay;
}

function setTabPreviewCloak(enabled) {
    const overlay = ensureTabPreviewOverlay();
    const shouldShow = enabled && getPreviewCloakEnabled();
    overlay.style.display = shouldShow ? "block" : "none";
}

function handlePreviewCloakTrigger(reason) {
    if (!getPreviewCloakEnabled()) {
        setTabPreviewCloak(false);
        return;
    }

    const sensitivity = getPreviewCloakSensitivity();

    if (document.hidden) {
        setTabPreviewCloak(true);
        return;
    }

    if (reason === "blur" && ["lowMed", "medium", "high"].includes(sensitivity)) {
        setTabPreviewCloak(true);
        return;
    }

    if (reason === "mouseleave" && ["medium", "high"].includes(sensitivity)) {
        setTabPreviewCloak(true);
        return;
    }

    if (reason === "windowmouseout" && sensitivity === "high") {
        setTabPreviewCloak(true);
    }
}

function setupTabPreviewCloak() {
    ensureTabPreviewOverlay();

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            setTabPreviewCloak(true);
        } else {
            setTabPreviewCloak(false);
        }
    });

    document.addEventListener("mouseleave", () => handlePreviewCloakTrigger("mouseleave"));
    document.addEventListener("mouseenter", () => {
        if (!document.hidden && document.hasFocus()) {
            setTabPreviewCloak(false);
        }
    });

    window.addEventListener("mouseout", event => {
        if (!event.relatedTarget && !event.toElement) {
            handlePreviewCloakTrigger("windowmouseout");
        }
    });
    window.addEventListener("blur", () => handlePreviewCloakTrigger("blur"));
    window.addEventListener("focus", () => setTabPreviewCloak(false));

}

function cloakIcon(url, { persist = true } = {}) {
    let iconUrl = (url + "").trim();
    if (!iconUrl || iconUrl === "favicon.png" || (/\/favicon-64\.png$/.test(iconUrl) && !iconUrl.includes("/assets/icons/"))) iconUrl = window.GN_ICON_URL;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
        link = document.createElement("link");
    }
    link.rel = "icon";
    link.href = iconUrl;
    document.head.appendChild(link);

    if (persist) {
        localStorage.setItem(TAB_CLOAK_STORAGE_KEYS.icon, iconUrl === window.GN_ICON_URL ? "" : iconUrl);
    }
}

function cloakName(title, { persist = true } = {}) {
    const nextTitle = (title + "").trim().length === 0 ? "GN 2.0" : (title + "").trim();
    document.title = nextTitle;

    if (persist) {
        localStorage.setItem(TAB_CLOAK_STORAGE_KEYS.title, nextTitle);
    }
}

function applyTabCloakPreset(presetKey) {
    const preset = TAB_CLOAK_PRESETS[presetKey];
    if (!preset) {
        return;
    }

    cloakName(preset.title);
    cloakIcon(preset.icon);

    const titleInput = document.getElementById('tab-cloak-title-input');
    const iconInput = document.getElementById('tab-cloak-icon-input');
    if (titleInput) titleInput.value = preset.title;
    if (iconInput) iconInput.value = preset.icon;
}

function resetTabCloak() {
    cloakName("GN 2.0");
    cloakIcon(window.GN_ICON_URL);

    const titleInput = document.getElementById('tab-cloak-title-input');
    const iconInput = document.getElementById('tab-cloak-icon-input');
    if (titleInput) titleInput.value = "";
    if (iconInput) iconInput.value = "";
}

function resetAppearanceSettings() {
    localStorage.removeItem("gnmath-mode");
    localStorage.removeItem("gnmath-theme");
    localStorage.removeItem(TAB_CLOAK_STORAGE_KEYS.title);
    localStorage.removeItem(TAB_CLOAK_STORAGE_KEYS.icon);
    localStorage.removeItem(TAB_CLOAK_STORAGE_KEYS.initialized);
    localStorage.removeItem(PREVIEW_CLOAK_STORAGE_KEYS.enabled);
    localStorage.removeItem(PREVIEW_CLOAK_STORAGE_KEYS.sensitivity);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.warnBeforeUnload);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.reducedMotion);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.customPrimaryColor);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.cardSize);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.fontSize);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.defaultSort);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.hideFeatured);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.compactMode);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.autofocusSearch);
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.showPlayCount);
    clearCustomPrimaryColorStyles();
    location.reload();
}

// ── Panic button ─────────────────────────────────────────────────────────────
const PANIC_DEFAULT_URL = "https://instructure.washk12.org";
const PANIC_DEFAULT_KEY = "`";
let panicKeyListening = false;

function getPanicUrl() {
    return localStorage.getItem(APP_SETTINGS_STORAGE_KEYS.panicUrl) || PANIC_DEFAULT_URL;
}
function setPanicUrl(raw) {
    let url = (raw || "").trim();
    if (!url) { localStorage.removeItem(APP_SETTINGS_STORAGE_KEYS.panicUrl); return; }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
        localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.panicUrl, parsed.href);
    } catch {
        notify("That doesn't look like a website address.", { type: "error" });
    }
}
function getPanicKey() {
    return localStorage.getItem(APP_SETTINGS_STORAGE_KEYS.panicKey) || PANIC_DEFAULT_KEY;
}
function getPanicKeyEnabled() {
    return localStorage.getItem(APP_SETTINGS_STORAGE_KEYS.panicKeyEnabled) !== "false";
}
function setPanicKeyEnabled(isEnabled) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.panicKeyEnabled, isEnabled ? "true" : "false");
}
function panicKeyName(key) {
    if (key === " ") return "Space";
    if (key === "`") return "` (backtick)";
    return key.length === 1 ? key.toUpperCase() : key;
}
function listenForPanicKey() {
    panicKeyListening = true;
    const label = document.getElementById('panic-key-label');
    if (label) label.textContent = "press any key…";
}

function panicRedirect() {
    // Drop the "are you sure you want to leave?" prompt so it can't block the escape.
    window.removeEventListener("beforeunload", gnmathBeforeUnloadHandler);
    try { zoneFrame.src = "about:blank"; } catch (_) {}
    // replace() so the Back button doesn't come back here
    window.location.replace(getPanicUrl());
}

function handlePanicKeydown(event) {
    if (panicKeyListening) {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        event.preventDefault();
        panicKeyListening = false;
        const key = event.key === "Escape" ? PANIC_DEFAULT_KEY : event.key;
        localStorage.setItem(APP_SETTINGS_STORAGE_KEYS.panicKey, key);
        const label = document.getElementById('panic-key-label');
        if (label) label.textContent = panicKeyName(key);
        return;
    }
    if (!getPanicKeyEnabled() || event.repeat) return;
    // Don't fire while typing in a text box (search bar, settings, etc.)
    const target = event.target;
    if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    if (event.key.toLowerCase() === getPanicKey().toLowerCase()) {
        event.preventDefault();
        panicRedirect();
    }
}
window.addEventListener("keydown", handlePanicKeydown, true);

// Games run inside the zone iframe, which swallows key presses, so listen there too.
function attachPanicKeyToFrame() {
    try {
        const doc = zoneFrame && zoneFrame.contentDocument;
        if (doc && !doc.__gnmathPanicAttached) {
            doc.__gnmathPanicAttached = true;
            doc.addEventListener("keydown", handlePanicKeydown, true);
        }
    } catch (_) {} // cross-origin game page: can't attach, the button still works
}
zoneFrame.addEventListener("load", attachPanicKeyToFrame);
setInterval(attachPanicKeyToFrame, 1000);

function tabCloak() {
    closePopup();
    document.getElementById('popupTitle').textContent = "Tab Cloak";
    const popupBody = document.getElementById('popupBody');
    const storedCloak = getStoredTabCloak();

    popupBody.innerHTML = `
        <p style="margin-top: 0;">Tab cloak is set to <b>Canvas</b> by default on first load. You can customize it below.</p>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
            <button class="settings-button" onclick="applyTabCloakPreset('canvas')">Canvas</button>
            <button class="settings-button" onclick="applyTabCloakPreset('googleClassroom')">Classroom</button>
            <button class="settings-button" onclick="applyTabCloakPreset('googleDrive')">Drive</button>
            <button class="settings-button" onclick="resetTabCloak()">Reset</button>
        </div>
        <label for="tab-cloak-title-input" style="font-weight: bold;">Set Tab Title:</label><br>
        <input type="text" id="tab-cloak-title-input" placeholder="Enter new tab name..." oninput="cloakName(this.value)">
        <br><br>
        <label for="tab-cloak-icon-input" style="font-weight: bold;">Set Tab Icon:</label><br>
        <input type="text" id="tab-cloak-icon-input" placeholder="Enter new tab icon URL..." oninput='cloakIcon(this.value)'>
    `;
    document.getElementById('tab-cloak-title-input').value = storedCloak.title;
    document.getElementById('tab-cloak-icon-input').value = storedCloak.icon;
    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
}

const settings = document.getElementById('settings');
settings.addEventListener('click', () => openSettingsPanel());

function openSettingsPanel() {
    document.getElementById('popupTitle').textContent = "Settings";
    const popupBody = document.getElementById('popupBody');
    const previewCloakEnabled    = getPreviewCloakEnabled();
    const previewCloakSensitivity = getPreviewCloakSensitivity();
    const warnBeforeUnload       = getWarnBeforeUnloadEnabled();
    const reducedMotion          = getReducedMotionEnabled();
    const customPrimaryColor     = getCustomPrimaryColor() || "#fc2651";
    const cardSize               = getCardSize();
    const fontSize               = getFontSize();
    const defaultSort            = getDefaultSort();
    const hideFeatured           = getHideFeatured();
    const compactMode            = getCompactMode();
    const autofocusSearch        = getAutofocusSearch();
    const showPlayCount          = getShowPlayCount();

    const row = (label, hint, control) => `
        <div class="set-row"><div class="set-text"><span class="set-label">${label}</span>${hint ? `<small>${hint}</small>` : ""}</div><div class="set-control">${control}</div></div>`;
    const toggle = (checked, onchange, id = "") => `<label class="set-switch"><input type="checkbox" ${id ? `id="${id}"` : ""} ${checked ? "checked" : ""} onchange="${onchange}"><span></span></label>`;
    const select = (value, onchange, options, id = "") => `<select ${id ? `id="${id}"` : ""} class="settings-select set-select" onchange="${onchange}">${options.map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const isDark = document.body.classList.contains("dark-mode");
    const signedIn = typeof cloudUser !== "undefined" && cloudUser;
    const staff = (typeof isSiteMod === "function" && isSiteMod()) || !!getGithubPat();
    const tab = (() => { try { return localStorage.getItem("gnmath-settings-tab") || "look"; } catch { return "look"; } })();

    popupBody.innerHTML = `
    <input type="search" id="settings-search" class="set-search" placeholder="Search settings…" aria-label="Search settings" data-lpignore="true" data-1p-ignore data-form-type="other">
    <div class="admin-tabs set-tabs" role="tablist">
        <button type="button" role="tab" data-tab="look">🎨 Look</button>
        <button type="button" role="tab" data-tab="games">🎮 Games</button>
        <button type="button" role="tab" data-tab="privacy">🛡️ Privacy</button>
        <button type="button" role="tab" data-tab="more">⋯ More</button>
    </div>
    <p id="settings-noresults" class="set-empty" hidden>No settings match that.</p>

    <div class="set-pane" data-pane="look">
        <div class="settings-section">
            <h4>Site style</h4>
            <div class="set-row set-col"><div class="set-text"><span class="set-label">How the whole site looks</span><small>Changes fonts, buttons, cards and the header. Scenes and your own background work with Default and Glass.</small></div>
                <div class="skin-picks">${typeof siteSkinPickerHtml === "function" ? siteSkinPickerHtml() : ""}</div>
            </div>
        </div>
        <div class="settings-section">
            <h4>Colors</h4>
            ${row("Dark mode", "", `<button class="theme-button set-mini" onclick="Promise.resolve(darkMode()).then(openSettingsPanel)">${isDark ? "🌙 On" : "☀️ Off"}</button>`)}
            <div class="set-row set-col"><div class="set-text"><span class="set-label">Theme color</span></div>
                <div class="theme-options set-themes">
                    ${COLOR_THEMES.map(t => `<button class="theme-button" data-theme-option="${t}" onclick="setTheme('${t}')">${themeLabel(t)}</button>`).join("")}
                </div>
            </div>
            <p class="set-note scenes-off-note">Scenes and your own background only show with the Default and Glass styles, so they're hidden for this style.</p>
            <div class="set-row set-col needs-scenes"><div class="set-text"><span class="set-label">Scenes</span><small>Animated backgrounds with their own colors. ☀️ scenes are bright, the rest are dark.</small></div>
                ${Object.entries(SCENE_GROUPS).map(([group, list]) => `<div class="scene-group">${group}</div>
                <div class="scene-picks">
                    ${list.map(t => `<button class="theme-button scene-pick scene-prev-${t}" data-theme-option="${t}" onclick="setTheme('${t}')"><span>${LIGHT_SCENES.has(t) ? "☀️ " : ""}${themeLabel(t)}</span></button>`).join("")}
                </div>`).join("")}
            </div>
            <div class="set-row set-col needs-scenes"><div class="set-text"><span class="set-label">Your own background</span><small>Paste a link to any picture or GIF (no download needed), or pick one from your device. Only you see it.</small></div>
                <div class="custom-bg">
                    <div class="custom-bg-preview" id="custom-bg-preview" data-theme-option="custom"></div>
                    <div class="custom-bg-controls">
                        <div class="custom-bg-line"><input id="custom-bg-url" type="url" class="set-input" placeholder="https://… link to a picture or GIF" data-lpignore="true" data-form-type="other"><button class="theme-button set-mini" type="button" onclick="setCustomBackgroundFromInput()">Use</button></div>
                        <div class="custom-bg-line"><button class="theme-button set-mini" type="button" onclick="document.getElementById('custom-bg-file').click()">📁 From my device</button><button class="theme-button set-mini" type="button" onclick="clearCustomBackground()">Remove</button><input id="custom-bg-file" type="file" accept="image/*" hidden onchange="setCustomBackgroundFromFile(this.files[0]); this.value=''"></div>
                        <label class="custom-bg-dim">Darken <input id="custom-bg-dim" type="range" min="0" max="85" step="5" value="${typeof getCustomBgDim === "function" ? getCustomBgDim() : 40}" oninput="setCustomBgDim(this.value)"></label>
                    </div>
                </div>
            </div>
            ${row("Custom color", "Pick any color for buttons and highlights", `<input id="custom-theme-color" type="color" value="${customPrimaryColor}" onchange="setCustomPrimaryColor(this.value)"><button class="theme-button set-mini" type="button" onclick="clearCustomPrimaryColor()">Clear</button>`)}
        </div>
        <div class="settings-section">
            <h4>Layout</h4>
            ${row("Text size", "", select(fontSize, "setFontSize(this.value)", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]]))}
            ${row("Game card size", "", select(cardSize, "setCardSize(this.value)", [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["list", "List"]]))}
            ${row("Compact header", "A slimmer top bar", toggle(compactMode, "setCompactMode(this.checked)"))}
            ${row("Reduce motion", "Fewer animations", toggle(reducedMotion, "setReducedMotionEnabled(this.checked)", "reduced-motion-enabled"))}
            ${typeof getLiteFxMode === "function" ? row("Lighter effects", liteFxNote(), select(getLiteFxMode(), "setLiteFxMode(this.value)", [["auto", "Auto"], ["on", "On"], ["off", "Off"]])) : ""}
            ${row("Site status light", "The little light in the bottom-left corner", toggle(typeof getShowSiteStatus !== "function" || getShowSiteStatus(), "setShowSiteStatus(this.checked)"))}
        </div>
        <button class="settings-button set-secondary" onclick="resetAppearanceSettings()">Reset look to default</button>
    </div>

    <div class="set-pane" data-pane="games">
        <div class="settings-section">
            <h4>Game list</h4>
            ${row("Sort games by", "", select(defaultSort, "setDefaultSort(this.value)", [["name", "Name"], ["id", "Date added"], ["popular", "Most popular"], ["trendingDay", "Trending today"], ["trendingWeek", "Trending this week"], ["trendingMonth", "Trending this month"]]))}
            ${row("Hide Featured row", "", toggle(hideFeatured, "setHideFeatured(this.checked)"))}
            ${row("Show play counts", "How many times each game was played, on its card", toggle(showPlayCount, "setShowPlayCount(this.checked)"))}
            ${row("Focus search on load", "Start typing to search right away", toggle(autofocusSearch, "setAutofocusSearch(this.checked)"))}
        </div>
        <div class="settings-section">
            <h4>Your games</h4>
            ${row("My stats", "Play time, favorites and most played", `<button class="theme-button set-mini" onclick="openStatsPanel()">📊 Open</button>`)}
            ${row("Reload the game list", "If games are missing or look out of date", `<button class="theme-button set-mini" onclick="listZones(); notify('Reloading games…')">↻ Reload</button>`)}
        </div>
    </div>

    <div class="set-pane" data-pane="privacy">
        <div class="settings-section">
            <h4>Panic button</h4>
            <div class="set-row set-col"><div class="set-text"><span class="set-label">Panic website</span><small>Where the panic button or key takes you</small></div>
                <input id="panic-url-input" type="text" class="set-input" placeholder="${PANIC_DEFAULT_URL}" onchange="setPanicUrl(this.value); this.value = getPanicUrl();"></div>
            ${row("Use a panic key", "Press it anywhere to leave instantly", toggle(getPanicKeyEnabled(), "setPanicKeyEnabled(this.checked)"))}
            ${row(`Panic key: <b id="panic-key-label"></b>`, "", `<button class="theme-button set-mini" id="panic-key-change" onclick="listenForPanicKey()">Change</button>`)}
        </div>
        <div class="settings-section">
            <h4>Cloaking</h4>
            ${row("Hide page in tab previews", "Covers the page when you switch tabs", toggle(previewCloakEnabled, "setPreviewCloakEnabled(this.checked)", "preview-cloak-enabled"))}
            ${row("How strongly", "", select(previewCloakSensitivity, "setPreviewCloakSensitivity(this.value)", [["low", "Low"], ["lowMed", "Low-medium"], ["medium", "Medium (recommended)"], ["high", "High"]], "preview-cloak-sensitivity"))}
            ${row("Tab name & icon", "Make the tab look like another site", `<button class="theme-button set-mini" onclick="tabCloak()">Set up</button>`)}
            ${row("Warn before leaving", "Asks before the tab closes, so you don't lose a game", toggle(warnBeforeUnload, "setWarnBeforeUnloadEnabled(this.checked)", "warn-before-unload"))}
        </div>
    </div>

    <div class="set-pane" data-pane="more">
        <div class="settings-section">
            <h4>Help make GN 2.0 better</h4>
            <div class="set-grid">
                <button class="settings-button" onclick="openFeedback('bug')">⚠️ Report a problem</button>
                <button class="settings-button" onclick="openFeedback('feature')">💡 Suggest a feature</button>
                <button class="settings-button" onclick="openIdeasBoard()">🗳️ Ideas board</button>
                <button class="settings-button" onclick="openSubmitGame()">🎮 Submit a game</button>
            </div>
            ${signedIn ? "" : `<p class="set-note">These need a free account so you can see replies.</p>`}
        </div>
        <div class="settings-section">
            <h4>Your data</h4>
            <div class="set-grid">
                <button class="settings-button set-secondary" onclick="saveData()">⬇️ Export data</button>
                <button class="settings-button set-secondary" onclick="document.getElementById('importData').click()">⬆️ Import data</button>
            </div>
        </div>
        <details class="settings-section set-staff" ${staff ? "open" : ""}>
            <summary><h4>Staff</h4></summary>
            <div class="set-grid">
                <button class="settings-button set-secondary" onclick="openAdminPanel()">Admin Panel</button>
                <button class="settings-button set-secondary" onclick="showOwnerPanel()">Owner Panel</button>
            </div>
        </details>
    </div>
    `;
    // Tabs (the last one used opens next time) and search across every tab
    const panes = [...popupBody.querySelectorAll(".set-pane")];
    const tabs = [...popupBody.querySelectorAll(".set-tabs button")];
    const showTab = name => {
        if (!panes.some(p => p.dataset.pane === name)) name = "look";
        tabs.forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false"));
        panes.forEach(p => { p.hidden = p.dataset.pane !== name; });
        try { localStorage.setItem("gnmath-settings-tab", name); } catch {}
    };
    tabs.forEach(b => b.onclick = () => { const q = document.getElementById("settings-search"); if (q.value) { q.value = ""; filterSettings(""); } showTab(b.dataset.tab); });
    showTab(tab);
    if (typeof applyCustomBackground === "function") applyCustomBackground();
    const filterSettings = q => {
        q = q.trim().toLowerCase();
        const noRes = document.getElementById("settings-noresults");
        popupBody.querySelector(".set-tabs").hidden = !!q;
        if (!q) { popupBody.querySelectorAll(".set-row, .settings-section, .set-grid > button, .set-pane > .settings-button").forEach(el => el.hidden = false); noRes.hidden = true; showTab((() => { try { return localStorage.getItem("gnmath-settings-tab") || "look"; } catch { return "look"; } })()); return; }
        let any = false;
        panes.forEach(p => {
            p.hidden = false;
            p.querySelectorAll(".set-row, .set-grid > button, :scope > .settings-button").forEach(el => { const hit = el.textContent.toLowerCase().includes(q); el.hidden = !hit; any = any || hit; });
            p.querySelectorAll(".settings-section").forEach(sec => { sec.hidden = ![...sec.querySelectorAll(".set-row, .set-grid > button")].some(el => !el.hidden); });
        });
        noRes.hidden = any;
    };
    document.getElementById("settings-search").addEventListener("input", e => filterSettings(e.target.value));
    popupBody.contentEditable = false;
    const panicUrlInput = document.getElementById('panic-url-input');
    if (panicUrlInput) panicUrlInput.value = getPanicUrl();
    const panicKeyLabel = document.getElementById('panic-key-label');
    if (panicKeyLabel) panicKeyLabel.textContent = panicKeyName(getPanicKey());
    document.getElementById('popupOverlay').style.display = "flex";
    updateThemeButtons();
}



function legalPopup(title, html) {
    document.getElementById('popupTitle').textContent = title;
    const popupBody = document.getElementById('popupBody');
    popupBody.innerHTML = `<div class="legal-doc" style="max-height: 60vh; overflow-y: auto; line-height: 1.55;">${html}</div>`;
    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
}

function loadPrivacy() {
    legalPopup("Privacy Policy", `
        <p><b>Effective October 12, 2026</b></p>
        <p>This policy explains what GN 2.0 collects, why, and what you can do about it. The short version: you can play without an account, accounts use a username only (no email or real name), GN 2.0 adds no ads or trackers, and we don't sell or share your information. The one exception is <b>partner games</b> (marked <span class="ad-badge">AD</span>), which come from html5games.com and may show that site's ads; see below.</p>

        <h3>What we collect</h3>
        <p><b>If you just play (no account):</b> nothing is sent to us. Your settings, favorites, recently played games, play time and game progress are saved only in your own browser on your own device.</p>
        <p><b>If you create an account:</b></p>
        <ul>
            <li><b>Username and password.</b> These are handled by Google Firebase Authentication. Your password is stored by Google in protected (hashed) form; the site owner can never see it. Firebase also records when the account was created and last signed in, and may log IP addresses to protect against abuse.</li>
            <li><b>Cloud saves.</b> A copy of the game progress and site settings stored in your browser for this site (including your favorites, recently played list and play time), so you can continue on another device. It is stored in Google Cloud Firestore and locked so only your signed-in account can read or change it. It never includes passwords or access tokens.</li>
            <li><b>Ratings and broken-game reports.</b> When you rate a game or report it as broken, we store your vote or the time of your report together with your account's random ID (not your username). These are combined into the public totals shown on game cards, and the stored entries can be read by anyone, but they don't reveal your username.</li>
            <li><b>Account profile.</b> Each account keeps a small profile with its username, the date it was created and when it last visited, so site admins can find accounts to manage them, for example to suspend one that's abusing ratings or reports. Only admins and you can see it. Admins can't see your password or your cloud save.</li>
            <li><b>Reports and feature ideas.</b> If you use "Report a problem" or "Suggest a feature", we store what you type (summary, details, the game it's about) with your username and account ID, and, if you leave the box ticked, your browser type and screen size. Only you and the site's mods can read a report. Ideas the mods approve are shown with your username on the ideas board, where signed-in players can vote. You can withdraw anything that hasn't been reviewed yet, and deleting your account removes all of yours.</li>
            <li><b>Game submissions.</b> If you use "Submit a game", we store what you type in the form (game name, link, creator, license, genre and description) with your username and account ID, so the site owner can review it and you can see its status. Only you and the site admins can read it. You can withdraw a pending submission, and deleting your account removes all of yours. Please don't include personal information in a submission.</li>
        </ul>
        <p>We do <b>not</b> ask for your email, real name, age, location, contacts, or any other personal details. Please don't put your real name or personal information in your username.</p>

        <h3>No ads or tracking from GN 2.0</h3>
        <p>GN 2.0 doesn't use advertising, analytics or tracking tools, and doesn't earn money from ads. Many game files come with ad code or Google Analytics added by whoever uploaded them; for every game in the main library and GN Originals, the site removes known ad and tracking code before it runs and blocks it from loading.</p>

        <h3>Partner games (may contain ads)</h3>
        <p>Some games are <b>partner games</b> from <a href="https://html5games.com/" target="_blank" rel="noopener">html5games.com</a> (made and hosted by <a href="https://famobi.com/" target="_blank" rel="noopener">Famobi</a>) or from <a href="https://playgama.com/" target="_blank" rel="noopener">Playgama</a> (uploaded there by their own developers and hosted by Playgama). Both let websites share their games for free on the condition that the games keep their own ads. GN 2.0 has no account with either and earns nothing from them. Partner games are always labelled with an <span class="ad-badge">AD</span> badge on their card and a "May contain ads" notice above the game, and you can hide all of them with the <b>Partner games</b> switch above All games. When you open a partner game:</p>
        <ul>
            <li>It loads directly from that platform's servers (play.famobi.com or playgama.com) in a separate, sandboxed frame. The cover pictures for these games also load from them (img.cdn.famobi.com, static.playgama.com), so their servers receive basic technical information such as your IP address and browser type when the covers are shown.</li>
            <li>The game <b>may show ads</b>, and Famobi or Playgama and their advertising partners may use cookies or similar technologies, collect device information and show personalized ads, under <b>their</b> privacy policies (linked on famobi.com and playgama.com), not this one. Their consent and ad settings apply inside the game.</li>
            <li>GN 2.0 only lists Playgama games that have no in-game purchases.</li>
            <li>GN 2.0 doesn't choose, see or get paid for those ads, and doesn't send Famobi or Playgama your username, account, cloud save or any other information about you. Ads inside a partner game can't be removed by this site.</li>
            <li>The sandbox lets the game open links in a new tab but stops it from navigating GN 2.0 away. If you see an ad that seems inappropriate, close the game and use the Report button.</li>
        </ul>
        <p>Your play time, favorites and ratings for partner games are stored the same way as for every other game (see above).</p>

        <h3>Children</h3>
        <p>This site is not directed at children under 13, and we do not knowingly collect personal information from them. If you are under 13, you can still play, but please don't create an account. If we learn an account belongs to someone under 13, we will delete it.</p>

        <h3>How we use it</h3>
        <p>Only to run the features you use: signing in, keeping your progress in sync between devices, and showing game ratings and broken-game warnings. We never use it for advertising or profiling, we never sell or rent it, and we don't share it with Famobi or any advertiser.</p>

        <h3>Third-party services</h3>
        <p>Like any website, these services receive basic technical information (such as your IP address and browser type) when your browser connects to them:</p>
        <ul>
            <li><b>Google Firebase</b> &mdash; accounts, cloud saves, ratings and reports.</li>
            <li><b>GitHub</b> &mdash; serves the site and its settings.</li>
            <li><b>jsDelivr</b> and other content networks &mdash; deliver the game files and images, and provide the public play counts.</li>
            <li><b>Famobi / html5games.com</b> and <b>Playgama</b> &mdash; host the partner games and their cover pictures, and the ads inside those games (only when partner games are shown or opened).</li>
        </ul>
        <p>Games are made and hosted by third parties. We remove the ad and tracking code we know about, but we can't guarantee every third-party file. Each of these services has its own privacy policy.</p>

        <h3>Keeping and deleting your data</h3>
        <p>Your cloud save is kept until you delete your account; each new save replaces the previous one. Broken-game reports stop counting after ${BROKEN_REPORT_DAYS} days. You can delete your account at any time from <b>Account &rarr; Delete account</b>; this removes your account, your cloud save, and your ratings and reports. Data saved only in your browser stays on your device until you clear your browser data. Accounts that are inactive for a long time may be deleted.</p>

        <h3>Security</h3>
        <p>Cloud saves can only be read or changed by the account that owns them, and connections are encrypted. No system is perfectly secure, so use a password you don't use anywhere else. There is no password reset, so keep your password safe.</p>

        <h3>Changes</h3>
        <p>We may update this policy. The effective date at the top shows when it last changed. Continuing to use the site after a change means you accept the updated policy.</p>
    `);
}

function loadTerms() {
    legalPopup("Terms of Use", `
        <p><b>Effective October 17, 2026</b></p>
        <p>By using GN 2.0 you agree to these terms. If you don't agree, please don't use the site.</p>

        <h3>Games and content</h3>
        <p>The games listed here are made by and belong to their respective creators and owners. This site does not create them. Most game files are loaded from third-party sources; games in the <b>GN Originals</b> row are open-source games shared under their creators' licenses, with each game's license and credit kept with it and shown in its Info panel. Games marked <span class="ad-badge">AD</span> are <b>partner games</b> from html5games.com (Famobi) or Playgama: they are linked, not copied, load from those platforms' servers under their own terms, and may show their ads, which GN 2.0 doesn't control or profit from. We don't claim ownership of any game.</p>

        <h3>No affiliation</h3>
        <p>Game titles, characters, pictures, logos and trademarks belong to their owners. GN 2.0 isn't affiliated with, sponsored by or endorsed by any game's creator, publisher or platform, and using a name here doesn't suggest that it is.</p>

        <h3>Third-party content</h3>
        <p>Library, partner and community games come from outside sources that GN 2.0 doesn't run. We remove the ad and tracking code we know about, but we don't control what's inside third-party games and can't promise they're accurate, appropriate, safe or free of errors. Links to other sites are provided for convenience; we aren't responsible for their content or practices. If something looks wrong, use <a href="#" onclick="openFeedback('bug'); return false;">Report a problem</a>.</p>

        <h3>Copyright and takedowns</h3>
        <p>We respect creators' rights. If you own a game listed here and didn't allow it, send a <a href="#" onclick="openTakedownForm(); return false;">takedown request</a>. It goes straight to the site's admins, who review it and remove the game for everyone once ownership is confirmed. See the <a href="#" onclick="loadDMCA(); return false;">DMCA</a> page for details.</p>

        <h3>Using the site</h3>
        <ul>
            <li>You are responsible for following the rules of any school, workplace, or network you use the site on.</li>
            <li>Don't attempt to break, overload, or get unauthorized access to the site or other people's accounts or saves.</li>
            <li>Don't use offensive or impersonating usernames. We may remove accounts that break these terms.</li>
            <li>You're responsible for keeping your password safe. Lost passwords can't be recovered.</li>
        </ul>

        <h3>Provided "as is"</h3>
        <p>The site and all games are provided "as is" and "as available," without warranties of any kind, express or implied. We don't promise that any game will work, stay available, or keep its progress. Games may stop working or be removed at any time, and cloud saves may be lost. Keep your own backups (Export Data) of anything important.</p>

        <h3>Limitation of liability</h3>
        <p>To the fullest extent allowed by law, the site owner and admins are not liable for any damages or losses from using, or not being able to use, the site, its games, or its accounts and saves, including lost progress or problems caused by third-party games or sites.</p>

        <h3>Changes</h3>
        <p>We may change these terms or the site at any time. Continuing to use the site means you accept the current terms. See also the <a href="#" onclick="loadPrivacy(); return false;">Privacy Policy</a>.</p>
    `);
}

function loadDMCA() {
    document.getElementById('popupTitle').textContent = "DMCA";
    const popupBody = document.getElementById('popupBody');
    popupBody.innerHTML = `
        <div class="dmca-content">
            <p>
                GN 2.0 respects the rights of game creators. If you own or developed a game shown here
                and didn't allow it, you can ask for it to be taken down.
            </p>
            <p><button type="button" class="settings-button" onclick="openTakedownForm()">Send a takedown request</button></p>
            <p>
                Requests go straight to the site's admins. You don't need an account. Please include
                a link to your original game and a way for us to confirm you own it (for example, an email
                from the domain on the official site, or the store page that lists you as the publisher).
                Once it's confirmed, the game is removed for every visitor, usually within minutes of review.
            </p>
            <p>
                You can also email <a href="mailto:gn.math.business@gmail.com?subject=!DMCA">gn.math.business@gmail.com</a>
                with the subject starting with <code>!DMCA</code>.
            </p>
            <p>
                <b>GN Originals</b> are open-source games copied, with their licenses, into
                <a href="https://github.com/SCHSwork/GN-originals" target="_blank" rel="noopener">github.com/SCHSwork/GN-originals</a>.
                To have one of those removed or its credit corrected, use the takedown request or open an issue on that repository.
            </p>
            <p>
                <b>Partner games</b> (marked AD) aren't copied here at all; they're linked from html5games.com or Playgama and
                play from their servers. To have one removed from this list, use the takedown request.
            </p>
            <p>
                <b>UBZone games</b> come from the unblockedzone collection
                (<a href="https://github.com/s0n-1m-cr1n3/sc13nc3" target="_blank" rel="noopener">github.com/s0n-1m-cr1n3/sc13nc3</a>)
                and the GitHub repos it uses. GN 2.0 doesn't host their files; it loads them from those repos.
                Use the takedown request to have one removed from GN 2.0. The form, and each game's Info panel,
                lists the exact repos its files come from, so you can contact them or send
                <a href="https://github.com/contact/dmca" target="_blank" rel="noopener noreferrer">GitHub a DMCA notice</a> to have the files themselves taken down.
            </p>
            <p style="font-size:13px;color:var(--text-muted);">
                Game names, pictures and trademarks belong to their owners. GN 2.0 isn't affiliated with or endorsed by them.
                See the <a href="#" onclick="loadTerms(); return false;">Terms</a>.
            </p>
        </div>
    `;
    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
}

let _allStatsCache = null;

async function getAllStats() {
  if (_allStatsCache) {
    return _allStatsCache;
  }

  const BASE_URL =
    "https://data.jsdelivr.com/v1/stats/packages/gh/freebuisness/html@main/files";
  const PERIOD = "year";
  const PAGE_BATCH = 5;

  let page = 1;
  let done = false;
  const combinedMap = Object.create(null);

  while (!done) {
    const pages = Array.from({ length: PAGE_BATCH }, (_, i) => page + i);

    const responses = await Promise.all(
      pages.map(p =>
        fetch(`${BASE_URL}?period=${PERIOD}&page=${p}&limit=100`)
          .then(r => (r.ok ? r.json() : []))
      )
    );

    for (const data of responses) {
      if (!Array.isArray(data) || data.length === 0) {
        done = true;
        break;
      }

      for (const item of data) {
        if (!item?.name) continue;

        const match = item.name.match(/^\/(\d+)([.-])/);
        if (!match) continue;

        const id = match[1];

        if (!combinedMap[id]) {
          combinedMap[id] = {
            hits: 0,
            bandwidth: 0
          };
        }

        combinedMap[id].hits += item.hits?.total ?? 0;
        combinedMap[id].bandwidth += item.bandwidth?.total ?? 0;
      }
    }

    page += PAGE_BATCH;
  }

  _allStatsCache = combinedMap;
  return combinedMap;
}

async function getStats(id) {
  id = String(id);
  const allStats = await getAllStats();

  return allStats[id]?.hits ?? 0;
}

function showZoneInfo() {
    let id = Number(document.getElementById('zoneId').textContent);
    document.getElementById('popupTitle').textContent = "Info";
    const popupBody = document.getElementById('popupBody');
    popupBody.innerHTML = `<p>Loading...</p>`
    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
    const original = typeof isOriginalZone === "function" && isOriginalZone(id) ? zones.find(z => Number(z.id) === id) : null;
    if (original) { showOriginalInfo(original); return; }
    const partner = typeof isPartnerZone === "function" && isPartnerZone(id) ? zones.find(z => Number(z.id) === id) : null;
    if (partner) { showPartnerInfo(partner); return; }
    const ubz = typeof isUbzoneZone === "function" && isUbzoneZone(id) ? zones.find(z => Number(z.id) === id) : null;
    if (ubz) { showUbzoneInfo(ubz); return; }
    fetch(`https://api.github.com/repos/freebuisness/html/commits?path=${id}.html`).then(res => res.json()).then(async json => {
        let stats = await getStats (id);
        idjson = zones.filter(a=>a.id===id)[0]
        document.getElementById('popupTitle').textContent = `${idjson.name} Info`;
        const date = new Date(json.at(-1).commit.author.date);
        let formatteddate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
}).format(date);
        popupBody.innerHTML = `
        <p>
        <b>Id</b>: ${id}<br>
        <b>Name</b>: ${idjson.name}<br>
        ${idjson.author?`<b>Game Author</b>: ${idjson.author}<br>`:""}
        ${idjson.authorLink?`<b>Game Author Link</b>: <a style="color:#FFFF00;" href=${idjson.authorLink}>${idjson.authorLink}</a><br>`:""}
        ${idjson.special?`<b>Tags</b>: ${idjson.special}<br>`:""}
        <b>Added By</b>: ${json.at(-1).commit.author.name}<br>
        <b>Date Added</b>: ${formatteddate}<br>
        <b>Times Played (Globally)</b>: ${Number(stats).toLocaleString("en-US")}
        </p>`;
    })
}

function closePopup() {
    document.getElementById('popupOverlay').style.display = "none";
}
applySavedSettings();
// Pull owner settings from GitHub FIRST, then render zones so disabled list is correct
// If GitHub recently said "too many requests", use the saved settings for now
(Date.now() < getSyncPace().pauseUntil ? Promise.resolve() : githubSyncPull()).finally(() => {
    startOwnerSettingsWatch();
    listZones();
    // After zones + settings are loaded, show MOTD and autofocus search if enabled
    if (getAutofocusSearch()) {
        setTimeout(() => document.getElementById('searchBar')?.focus(), 300);
    }
    setTimeout(maybeShowMotd, 800);
});

HTMLCanvasElement.prototype.toDataURL = function (...args) {
    return "";
};
