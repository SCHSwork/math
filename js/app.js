const container = document.getElementById('container');
const zoneViewer = document.getElementById('zoneViewer');
let zoneFrame = document.getElementById('zoneFrame');
const searchBar = document.getElementById('searchBar');
const sortOptions = document.getElementById('sortOptions');
const filterOptions = document.getElementById('filterOptions');
// https://www.jsdelivr.com/tools/purge
const zonesurls = [
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json",
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json",
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@master/zones.json",
    "https://cdn.jsdelivr.net/gh/freebuisness/assets/zones.json"
];
let zonesURL = zonesurls[Math.floor(Math.random() * zonesurls.length)];
const coverURL = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";
const htmlURL = "https://cdn.jsdelivr.net/gh/freebuisness/html@main";
const htmlURLFallbacks = [
    "https://cdn.jsdelivr.net/gh/freebuisness/html@latest",
    "https://cdn.jsdelivr.net/gh/freebuisness/html",
    "https://raw.githubusercontent.com/freebuisness/html/main"
];
// ── Redundancy: every game-library file can come from three places ─────────
// jsDelivr (fast CDN) → GitHub directly → githack (another CDN). A source that
// fails, times out, or gets redirected (e.g. to a school filter's block page)
// is skipped for the rest of the session.
const MIRRORS = {
    jsdelivr: (o, r, ref, p) => `https://cdn.jsdelivr.net/gh/${o}/${r}@${ref === "HEAD" ? "latest" : ref}/${p}`,
    github:   (o, r, ref, p) => `https://raw.githubusercontent.com/${o}/${r}/${ref === "latest" ? "HEAD" : ref}/${p}`,
    githack:  (o, r, ref, p) => `https://rawcdn.githack.com/${o}/${r}/${ref === "latest" ? "HEAD" : ref}/${p}`
};
const MIRROR_HOSTS = { "cdn.jsdelivr.net": "jsdelivr", "raw.githubusercontent.com": "github", "rawcdn.githack.com": "githack" };
const mirrorDown = new Set((() => { try { return JSON.parse(sessionStorage.getItem("gnmath-mirror-down") || "[]"); } catch { return []; } })());
function markMirror(name, ok) {
    if (!name) return;
    const before = mirrorDown.has(name);
    if (ok) mirrorDown.delete(name); else mirrorDown.add(name);
    if (before !== mirrorDown.has(name)) {
        try { sessionStorage.setItem("gnmath-mirror-down", JSON.stringify([...mirrorDown])); } catch {}
        console.info(`Game source ${name} is ${ok ? "back up" : "unavailable"}`);
    }
}
function mirrorUrls(owner, repo, ref, path) {
    const order = ["jsdelivr", "github", "githack"];
    order.sort((a, b) => mirrorDown.has(a) - mirrorDown.has(b)); // working sources first
    return order.map(k => MIRRORS[k](owner, repo, ref, path));
}
function mirrorOf(url) { try { return MIRROR_HOSTS[new URL(url).hostname]; } catch { return null; } }
// Try each URL until one returns a usable response
async function fetchFirst(urls, { timeoutMs = 15000, validate, track = true } = {}) {
    let lastError = new Error("No sources");
    for (const url of urls) {
        const name = mirrorOf(url);
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        try {
            const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
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
    img.crossOrigin = "anonymous";
    img.dataset.fallbacks = JSON.stringify(list.slice(1));
    img.onerror = () => {
        let rest = [];
        try { rest = JSON.parse(img.dataset.fallbacks || "[]"); } catch {}
        markMirror(mirrorOf(img.currentSrc || img.src), false);
        if (!rest.length) { img.onerror = null; return; }
        img.dataset.fallbacks = JSON.stringify(rest.slice(1));
        img.src = rest[0];
    };
    if (lazy) img.dataset.src = list[0]; else img.src = list[0];
}
// The game list: newest copy from any source, or the last one that loaded
const ZONES_CACHE_KEY = "gnmath-cache-zones";
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
        return data;
    } catch (err) {
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(ZONES_CACHE_KEY)); } catch {}
        if (cached && Array.isArray(cached.data)) {
            showSourceNotice(`Couldn't reach the game library, so this is the list saved on ${new Date(cached.t).toLocaleDateString()}. Some games may not load until it's back.`);
            return cached.data;
        }
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
        zones = json.filter(z => {
            const name = (z.name || "").trim();
            return !/^\[!\]/.test(name) && !/comment|discord/i.test(name) && !/discord\.(gg|com)/i.test(z.url || "");
        });
        // Add the GN Originals (open-source games) after the main library. An original
        // marked "libraryDuplicate" in games.json is the same game as one the library
        // already has (checked by hand, not by name), so it's only shown if the library is down.
        const originals = await originalsPromise;
        const libraryIds = new Set(zones.map(z => String(z.id)));
        zones = zones.concat(originals.filter(z => !libraryIds.has(String(z.id)) && !z.libraryDuplicate));
        // Show games right away using cached play counts, then refresh them
        const popularityFresh = loadCachedPopularity();
        sortZones();
        if (!popularityFresh) refreshPopularity().then(() => { featuredContainer.innerHTML = ""; sortZones(); });
        try {
        const search = new URLSearchParams(window.location.search);
        const id = search.get('id');
        const embed = window.location.hash.includes("embed");
        if (id) {
            const zone = zones.find(zone => zone.id + '' == id + '');
            if (zone) {
                if (embed) {
                    if (zone.url.startsWith("http")) {
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
        const originals = await originalsPromise;
        if (originals.length) {
            zones = originals;
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

function createZoneCard(file) {
    const zoneItem = document.createElement("div");
    zoneItem.className = "zone-item";
    zoneItem.onclick = () => openZone(file);

    const img = document.createElement("img");
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
    if (badges.childElementCount) zoneItem.appendChild(badges);

    // Your play time + community rating
    const metaParts = [];
    const played = getPlaytime(file.id);
    if (played >= 60) metaParts.push("⏱ " + formatPlaytime(played));
    const votes = stats.up + stats.down;
    if (votes >= MIN_VOTES_TO_SHOW) metaParts.push(`👍 ${Math.round(stats.up / votes * 100)}%`);
    if (getShowPlayCount()) {
        const plays = (popularityData['year']?.[file.id]) ?? 0;
        if (plays > 0) metaParts.push(`${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(plays)} plays`);
    }
    if (metaParts.length) {
        const meta = document.createElement("div");
        meta.className = "card-meta";
        metaParts.forEach(t => { const span = document.createElement("span"); span.textContent = t; meta.appendChild(span); });
        zoneItem.appendChild(meta);
    }

    return zoneItem;
}

function observeLazyZoneImages(selector) {
    const lazyImages = document.querySelectorAll(selector);
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !zoneViewer.hidden) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove("lazy-zone-img");
                observer.unobserve(img);
            }
        });
    }, {
        rootMargin: "100px", 
        threshold: 0.1
    });

    lazyImages.forEach(img => {
        imageObserver.observe(img);
    });
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
    featuredContainer.innerHTML = "";
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
function displayZones(zones) {
    container.innerHTML = "";
    const visibleZones = zones.filter(file => !isZoneDisabled(file.id));
    visibleZones.forEach(file => {
        container.appendChild(createZoneCard(file));
    });
    if (container.innerHTML === "") {
        container.textContent = "No games found.";
    } else {
        setSectionTitle(document.getElementById("allSummary"), "All games", visibleZones.length);
    }

    observeLazyZoneImages('img.lazy-zone-img');
}

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
const AD_HOST_PATTERN = "(^|\\.)(googletagmanager\\.com|google-analytics\\.com|analytics\\.google\\.com|r9x\\.in|googlesyndication\\.com|doubleclick\\.net|adnxs\\.com|adsterra\\.com|highperformanceformat\\.com|effectivegatecpm\\.com|profitableratecpm\\.com|propellerads\\.com|popads\\.net|a-ads\\.com)$";

function isObfuscatedAdScript(code) {
    if (/r9x\.in/i.test(code)) return true;
    // javascript-obfuscator output: huge runs of parseInt(0x..) arithmetic plus
    // its anti-debug/self-defend markers. Real game code here never looks like this.
    const hexCalls = (code.match(/parseInt\(0x/g) || []).length;
    const markers = /\(\(\(\.\+\)\+\)\+\)\+\$|randomUUID|new TextDecoder|\.constructor\("return this"\)/.test(code);
    return hexCalls >= 25 && markers;
}

function cleanGameHtml(html) {
    if (typeof html !== "string") return html;
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
        `})();<\/script><style>#sidebarad1,#sidebarad2{display:none!important}</style>` +
        (typeof gameProgressHook === "function" ? `<script>(${gameProgressHook.toString()})();<\/script>` : "") +
        (typeof gameDataHook === "function" ? `<script>(${gameDataHook.toString()})();<\/script>` : "");
    if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, m => m + guard);
    else if (/<!doctype[^>]*>/i.test(out)) out = out.replace(/<!doctype[^>]*>/i, m => m + guard);
    else out = guard + out;
    if (removed) console.info(`Removed ${removed} ad/tracker script(s) from game`);
    return out;
}

async function fetchWithFallback(rawUrl) {
    // GN Originals: "gh:owner/repo@sha/path"
    if (typeof parseGhUrl === "function" && parseGhUrl(rawUrl)) return rewriteForMirrors(await fetchOriginalHtml(rawUrl));
    // Game pages: try every source (jsDelivr, GitHub, githack), working ones first
    const suffix = rawUrl.replace("{HTML_URL}", "").replace("{COVER_URL}", "").replace(/^\//, "");
    const isHtml = rawUrl.includes("{HTML_URL}");
    const candidates = isHtml
        ? [...mirrorUrls("freebuisness", "html", "main", suffix), `${htmlURLFallbacks[0]}/${suffix}`]
        : [rawUrl.replace("{COVER_URL}", coverURL).replace("{HTML_URL}", htmlURL)];
    const html = await fetchFirst(candidates, { timeoutMs: 30000, validate: res => res.text() });
    return rewriteForMirrors(cleanGameHtml(html));
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
        notify("This game has been turned off by the site owner.");
        return;
    }

    if (file.url.startsWith("http")) {
        window.open(file.url, "_blank");
    } else {
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
        if (zoneFrame.contentDocument !== null) {
            zoneFrame.contentDocument.open();
            zoneFrame.contentDocument.write(gameLoadingScreenHtml(file));
            zoneFrame.contentDocument.close();
        }
        fetchWithFallback(file.url).then(html => {
            if (zoneFrame.contentDocument === null) {
                zoneFrame = document.createElement("iframe");
                zoneFrame.id = "zoneFrame";
                zoneViewer.appendChild(zoneFrame);
            }
            markGamePageWritten();
            zoneFrame.contentDocument.open();
            zoneFrame.contentDocument.write(html);
            zoneFrame.contentDocument.close();
        }).catch(error => {
            endGameLoad(true);
            closeZone();
            notify(`Couldn't load ${file.name} from any of the game sources. Check your internet connection, or try again in a few minutes.`, { type: "error" });
        });
    }
}

function aboutBlank() {
    const newWindow = window.open("about:blank", "_blank");
    let zone = zones.find(zone => zone.id + '' === document.getElementById('zoneId').textContent);
    fetchWithFallback(zone.url).then(html => {
        if (newWindow) {
            newWindow.document.open();
            newWindow.document.write(html);
            newWindow.document.close();
        }
    }).catch(() => notify("Couldn't open the game in a new tab. Try again in a few minutes.", { type: "error" }));
}

function closeZone() {
    stopPlaytime();
    if (typeof closeGameMenu === "function") closeGameMenu();
    if (typeof currentGameId !== "undefined") currentGameId = null;
    if (typeof endGameLoad === "function") endGameLoad(true);
    zoneViewer.hidden = false;
    zoneViewer.style.display = "none";
    if (zoneFrame && zoneFrame.parentNode === zoneViewer) zoneViewer.removeChild(zoneFrame);
    clearZoneIdFromUrl();
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

function isZoneDisabled(zoneId) {
    return getDisabledZoneIds().has(String(zoneId));
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
    localStorage.setItem(OWNER_STORAGE_KEYS.siteMode, safeMode);
    applyOwnerSiteMode();
    githubAutoSync();
}

function applyOwnerSiteMode() {
    const existingOverlay = document.getElementById("owner-site-overlay");
    const mode = getOwnerSiteMode();

    if (mode === "open") {
        if (existingOverlay) {
            existingOverlay.remove();
        }
        return;
    }

    const overlay = existingOverlay || document.createElement("div");
    overlay.id = "owner-site-overlay";
    overlay.innerHTML = "";
    overlay.className = mode === "shutdown" ? "shutdown-mode" : "";

    const message = document.createElement("div");

    if (mode === "shutdown") {
        message.className = "owner-site-message shutdown-message";

        const badge = document.createElement("div");
        badge.className = "shutdown-badge";
        badge.textContent = "Service Unavailable";
        message.appendChild(badge);

        const icon = document.createElement("span");
        icon.className = "shutdown-icon";
        icon.textContent = "⛔";
        message.appendChild(icon);

        const title = document.createElement("h1");
        title.textContent = "Site Shutdown";
        message.appendChild(title);

        const description = document.createElement("p");
        description.textContent = "This website has been shut down by the owner. It is not available at this time.";
        message.appendChild(description);

        const divider = document.createElement("hr");
        divider.className = "shutdown-divider";
        message.appendChild(divider);

        const unlockButton = document.createElement("button");
        unlockButton.className = "shutdown-unlock";
        unlockButton.type = "button";
        unlockButton.textContent = "owner access";
        unlockButton.onclick = () => requestOwnerAccess(() => setOwnerSiteMode("open"));
        message.appendChild(unlockButton);

    } else {
        message.className = "owner-site-message";

        const title = document.createElement("h1");
        title.textContent = "Website Locked";
        message.appendChild(title);

        const description = document.createElement("p");
        description.textContent = "The owner has temporarily locked this website.";
        message.appendChild(description);

        const unlockButton = document.createElement("button");
        unlockButton.className = "settings-button";
        unlockButton.type = "button";
        unlockButton.textContent = "Owner Unlock";
        unlockButton.onclick = () => requestOwnerAccess(() => setOwnerSiteMode("open"));
        message.appendChild(unlockButton);
    }

    overlay.appendChild(message);
    if (!existingOverlay) {
        document.body.appendChild(overlay);
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
            <option value="shutdown" ${mode === "shutdown" ? "selected" : ""}>🔴 Shut down — show shutdown screen</option>
        </select>
    </div>

    <div class="settings-section">
        <h4>New Visitor Defaults</h4>
        <p style="margin:0 0 0.75rem;font-size:13px;color:var(--text-muted);">Applied only when a visitor has not chosen their own setting. Existing preferences are never overwritten.</p>
        <label style="display:block;margin-bottom:0.35rem;">Color mode</label>
        <select id="owner-default-mode" class="settings-select"><option value="dark" ${visitorDefaults.mode === "dark" ? "selected" : ""}>Dark</option><option value="light" ${visitorDefaults.mode === "light" ? "selected" : ""}>Light</option></select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Theme</label>
        <select id="owner-default-theme" class="settings-select">${AVAILABLE_THEMES.map(theme => `<option value="${theme}" ${visitorDefaults.theme === theme ? "selected" : ""}>${theme[0].toUpperCase() + theme.slice(1)}</option>`).join("")}</select>
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
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Shown as a coloured bar below the header for all visitors.</p>
        <div class="settings-inline" style="margin-bottom:0.5rem;">
            <label>Show banner</label>
            <input id="owner-announcement-enabled" type="checkbox" ${announcement.enabled ? "checked" : ""} onchange="saveAnnouncementFromPanel()">
        </div>
        <input type="text" id="owner-announcement-text" placeholder="Announcement message…"
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
        <h4>Trusted Reporters</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">One broken report from a trusted account flags the game for everyone right away, instead of waiting for ${BROKEN_FLAG_THRESHOLD} reports.</p>
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
    return {
        text: localStorage.getItem(OWNER_STORAGE_KEYS.announcement) || "",
        enabled: localStorage.getItem(OWNER_STORAGE_KEYS.announcementEnabled) === "true"
    };
}

function setAnnouncement(text, enabled) {
    localStorage.setItem(OWNER_STORAGE_KEYS.announcement, text);
    localStorage.setItem(OWNER_STORAGE_KEYS.announcementEnabled, enabled ? "true" : "false");
    applyAnnouncement();
    githubAutoSync();
}

function saveAnnouncementFromPanel() {
    const text    = document.getElementById('owner-announcement-text')?.value ?? "";
    const enabled = document.getElementById('owner-announcement-enabled')?.checked ?? false;
    setAnnouncement(text, enabled);
}

function applyAnnouncement() {
    const existing = document.getElementById("owner-announcement-bar");
    const { text, enabled } = getAnnouncement();

    if (!enabled || !text.trim()) {
        if (existing) existing.remove();
        return;
    }

    const bar = existing || document.createElement("div");
    bar.id = "owner-announcement-bar";
    // Use a real color value — CSS variables don't work in element.style
    const primary = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#fc2651';
    const primaryHover = getComputedStyle(document.body).getPropertyValue('--primary-hover').trim() || '#e91e47';
    bar.style.cssText = `
        background: linear-gradient(135deg, ${primary} 0%, ${primaryHover} 100%);
        color: #fff;
        text-align: center;
        padding: 0.6rem 2.5rem;
        font-size: 14px;
        font-weight: 600;
        position: relative;
        z-index: 99;
        letter-spacing: 0.01em;
    `;
    bar.textContent = text;

    if (!existing) {
        const header = document.querySelector("header");
        header.insertAdjacentElement("afterend", bar);
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

const AVAILABLE_THEMES = ["red", "orange", "blue", "green", "purple", "pink", "cyan"];
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
    footerLinks: "gnmath-owner-footer-links"
};
const OWNER_STORAGE_KEYS = {
    siteMode: "gnmath-owner-site-mode",
    disabledZones: "gnmath-owner-disabled-zones",
    brokenReports: "gnmath-broken-zone-reports",
    announcement: "gnmath-owner-announcement",
    announcementEnabled: "gnmath-owner-announcement-enabled",
    githubPat: "gnmath-owner-github-pat"
};
const OWNER_SITE_MODES = ["open", "locked", "shutdown"];
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
            enabled: getAnnouncement().enabled
        },
        motd: {
            text:    getMotd().text,
            enabled: getMotd().enabled
        },
        footerLinks: getFooterLinks() || [],
        visitorDefaults: getOwnerVisitorDefaults(),
        trustedReporters: getTrustedReporters(),
        updatedAt: new Date().toISOString()
    };
}

/** Apply a settings object that was loaded from GitHub */
function applyOwnerSettingsObject(settings, { rerender = false } = {}) {
    if (!settings || typeof settings !== "object") return;

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
        const ok = await githubSyncPush();
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
async function githubSyncPush() {
    const pat = getGithubPat();
    if (!pat) return false;

    const content = btoa(unescape(encodeURIComponent(
        JSON.stringify(buildOwnerSettingsObject(), null, 2)
    )));

    // Fetch current SHA (needed for updates)
    let sha;
    try {
        const res = await fetch(GITHUB_SYNC_URL, {
            headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github+json" }
        });
        if (res.ok) {
            const json = await res.json();
            sha = json.sha;
        }
    } catch (_) {}

    const body = { message: "chore: update owner-settings", content };
    if (sha) body.sha = sha;

    const putRes = await fetch(GITHUB_SYNC_URL, {
        method:  "PUT",
        headers: {
            Authorization: `token ${pat}`,
            Accept:        "application/vnd.github+json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    return putRes.ok;
}

/** Pull settings from the public CDN (works for all visitors, no token). */
async function githubSyncPull({ rerender = false } = {}) {
    try {
        let settings;
        const pat = getGithubPat();
        if (pat) {
            // Owner device: authenticated API is always fresh and has a high rate limit.
            const res = await fetch(GITHUB_SYNC_URL + "?t=" + Date.now(), {
                headers: { Accept: "application/vnd.github+json", Authorization: `token ${pat}` }
            });
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
            try {
                settings = await fetchFirst(
                    [GITHUB_SYNC_CDN + "?t=" + Date.now(), MIRRORS.githack(owner, repo, "HEAD", GITHUB_SYNC_FILE), MIRRORS.jsdelivr(owner, repo, "main", GITHUB_SYNC_FILE)],
                    { timeoutMs: 10000, validate: r => r.json(), track: false });
            } catch { return; } // keep the last settings this browser already has
        }
        applyOwnerSettingsObject(settings, { rerender });
    } catch (_) {}
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
    if (ownerUnlockedThisTab()) return onSuccess();
    const saved = getGithubPat();
    if (saved) {
        const check = await verifyOwnerToken(saved);
        if (check.ok) {
            try { sessionStorage.setItem("gnmath-owner-unlocked", "1"); } catch {}
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
    document.body.classList.toggle("dark-mode");
    const mode = document.body.classList.contains("dark-mode") ? "dark" : "light";
    localStorage.setItem("gnmath-mode", mode);
}

function setTheme(themeName, { persist = true } = {}) {
    const safeTheme = AVAILABLE_THEMES.includes(themeName) ? themeName : "red";
    document.body.classList.remove(...AVAILABLE_THEMES.map(theme => `theme-${theme}`));
    document.body.classList.add(`theme-${safeTheme}`);
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

    popupBody.innerHTML = `
    <div class="settings-section">
        <h4>My Stats</h4>
        <button class="settings-button" onclick="openStatsPanel()">📊 View My Stats</button>
    </div>

    <div class="settings-section">
        <h4>Appearance</h4>
        <button class="settings-button" onclick="darkMode()">Toggle Dark/Light Mode</button>
        <br><br>
        <div style="font-weight:700;margin-bottom:0.5rem;">Theme Color</div>
        <div class="theme-options" style="grid-template-columns:repeat(4,1fr);">
            <button class="theme-button" data-theme-option="red"    onclick="setTheme('red')">Red</button>
            <button class="theme-button" data-theme-option="orange" onclick="setTheme('orange')">Orange</button>
            <button class="theme-button" data-theme-option="blue"   onclick="setTheme('blue')">Blue</button>
            <button class="theme-button" data-theme-option="green"  onclick="setTheme('green')">Green</button>
            <button class="theme-button" data-theme-option="purple" onclick="setTheme('purple')">Purple</button>
            <button class="theme-button" data-theme-option="pink"   onclick="setTheme('pink')">Pink</button>
            <button class="theme-button" data-theme-option="cyan"   onclick="setTheme('cyan')">Cyan</button>
        </div>
        <br>
        <label for="custom-theme-color" style="display:block;margin-bottom:0.4rem;">Custom primary color</label>
        <div class="settings-inline">
            <input id="custom-theme-color" type="color" value="${customPrimaryColor}" onchange="setCustomPrimaryColor(this.value)">
            <button class="theme-button" type="button" onclick="clearCustomPrimaryColor()">Clear Custom</button>
        </div>
        <br>
        <label style="display:block;margin-bottom:0.4rem;">Font size</label>
        <select class="settings-select" onchange="setFontSize(this.value)">
            <option value="small"  ${fontSize === 'small'  ? 'selected' : ''}>Small</option>
            <option value="medium" ${fontSize === 'medium' ? 'selected' : ''}>Medium (default)</option>
            <option value="large"  ${fontSize === 'large'  ? 'selected' : ''}>Large</option>
        </select>
        <br><br>
        <div class="settings-inline">
            <label>Compact header</label>
            <input type="checkbox" ${compactMode ? 'checked' : ''} onchange="setCompactMode(this.checked)">
        </div>
        <br>
        <div class="settings-inline">
            <label>Reduce motion effects</label>
            <input id="reduced-motion-enabled" type="checkbox" ${reducedMotion ? 'checked' : ''} onchange="setReducedMotionEnabled(this.checked)">
        </div>
    </div>

    <div class="settings-section">
        <h4>Game Grid</h4>
        <label style="display:block;margin-bottom:0.4rem;">Card size</label>
        <select class="settings-select" onchange="setCardSize(this.value)">
            <option value="small"  ${cardSize === 'small'  ? 'selected' : ''}>Small</option>
            <option value="medium" ${cardSize === 'medium' ? 'selected' : ''}>Medium (default)</option>
            <option value="large"  ${cardSize === 'large'  ? 'selected' : ''}>Large</option>
            <option value="list"   ${cardSize === 'list'   ? 'selected' : ''}>List view</option>
        </select>
        <br><br>
        <label style="display:block;margin-bottom:0.4rem;">Default sort</label>
        <select class="settings-select" onchange="setDefaultSort(this.value)">
            <option value="name"          ${defaultSort === 'name'          ? 'selected' : ''}>Name</option>
            <option value="id"            ${defaultSort === 'id'            ? 'selected' : ''}>ID (Date added)</option>
            <option value="popular"       ${defaultSort === 'popular'       ? 'selected' : ''}>Most popular</option>
            <option value="trendingDay"   ${defaultSort === 'trendingDay'   ? 'selected' : ''}>Trending today</option>
            <option value="trendingWeek"  ${defaultSort === 'trendingWeek'  ? 'selected' : ''}>Trending this week</option>
            <option value="trendingMonth" ${defaultSort === 'trendingMonth' ? 'selected' : ''}>Trending this month</option>
        </select>
        <br><br>
        <div class="settings-inline">
            <label>Hide Featured section</label>
            <input type="checkbox" ${hideFeatured ? 'checked' : ''} onchange="setHideFeatured(this.checked)">
        </div>
        <br>
        <div class="settings-inline">
            <label>Show play count on cards</label>
            <input type="checkbox" ${showPlayCount ? 'checked' : ''} onchange="setShowPlayCount(this.checked)">
        </div>
    </div>

    <div class="settings-section">
        <h4>Privacy Cloak</h4>
        <div class="settings-inline">
            <label>Hide page in tab previews</label>
            <input id="preview-cloak-enabled" type="checkbox" ${previewCloakEnabled ? 'checked' : ''} onchange="setPreviewCloakEnabled(this.checked)">
        </div>
        <br>
        <label style="display:block;margin-bottom:0.4rem;">Cloak sensitivity</label>
        <select id="preview-cloak-sensitivity" class="settings-select" onchange="setPreviewCloakSensitivity(this.value)">
            <option value="low"    ${previewCloakSensitivity === 'low'    ? 'selected' : ''}>Low (hidden tabs only)</option>
            <option value="lowMed" ${previewCloakSensitivity === 'lowMed' ? 'selected' : ''}>Low-Med (hidden + blur)</option>
            <option value="medium" ${previewCloakSensitivity === 'medium' ? 'selected' : ''}>Medium (recommended)</option>
            <option value="high"   ${previewCloakSensitivity === 'high'   ? 'selected' : ''}>High (aggressive)</option>
        </select>
        <br>
        <button class="settings-button" onclick="tabCloak()">Tab Cloak Settings</button>
    </div>

    <div class="settings-section">
        <h4>Panic Button</h4>
        <label for="panic-url-input" style="display:block;margin-bottom:0.4rem;">Panic redirect website</label>
        <input id="panic-url-input" type="text" placeholder="${PANIC_DEFAULT_URL}" onchange="setPanicUrl(this.value); this.value = getPanicUrl();">
        <br><br>
        <div class="settings-inline">
            <label>Panic key enabled</label>
            <input type="checkbox" ${getPanicKeyEnabled() ? 'checked' : ''} onchange="setPanicKeyEnabled(this.checked)">
        </div>
        <br>
        <div class="settings-inline">
            <label>Panic key: <b id="panic-key-label"></b></label>
            <button class="settings-button" id="panic-key-change" onclick="listenForPanicKey()">Change key</button>
        </div>
    </div>

    <div class="settings-section">
        <h4>Behavior</h4>
        <div class="settings-inline">
            <label>Warn before leaving page</label>
            <input id="warn-before-unload" type="checkbox" ${warnBeforeUnload ? 'checked' : ''} onchange="setWarnBeforeUnloadEnabled(this.checked)">
        </div>
        <br>
        <div class="settings-inline">
            <label>Autofocus search bar on load</label>
            <input type="checkbox" ${autofocusSearch ? 'checked' : ''} onchange="setAutofocusSearch(this.checked)">
        </div>
    </div>

    <div class="settings-section">
        <h4>Quick Actions</h4>
        <button class="settings-button" onclick="listZones()">Refresh Zones</button>
        <br><br>
        <button class="settings-button" onclick="showOwnerPanel()">Owner Panel</button>
        <br><br>
        <button class="settings-button" onclick="resetAppearanceSettings()">Reset All Appearance Settings</button>
    </div>
    `;
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
        <p><b>Effective October 7, 2026</b></p>
        <p>This policy explains what GN 2.0 collects, why, and what you can do about it. The short version: you can play without an account, accounts use a username only (no email or real name), there are no ads or trackers, and we don't sell or share your information.</p>

        <h3>What we collect</h3>
        <p><b>If you just play (no account):</b> nothing is sent to us. Your settings, favorites, recently played games, play time and game progress are saved only in your own browser on your own device.</p>
        <p><b>If you create an account:</b></p>
        <ul>
            <li><b>Username and password.</b> These are handled by Google Firebase Authentication. Your password is stored by Google in protected (hashed) form; the site owner can never see it. Firebase also records when the account was created and last signed in, and may log IP addresses to protect against abuse.</li>
            <li><b>Cloud saves.</b> A copy of the game progress and site settings stored in your browser for this site (including your favorites, recently played list and play time), so you can continue on another device. It is stored in Google Cloud Firestore and locked so only your signed-in account can read or change it. It never includes passwords or access tokens.</li>
            <li><b>Ratings and broken-game reports.</b> When you rate a game or report it as broken, we store your vote or the time of your report together with your account's random ID (not your username). These are combined into the public totals shown on game cards, and the stored entries can be read by anyone, but they don't reveal your username.</li>
        </ul>
        <p>We do <b>not</b> ask for your email, real name, age, location, contacts, or any other personal details. Please don't put your real name or personal information in your username.</p>

        <h3>No ads or tracking</h3>
        <p>GN 2.0 doesn't use advertising, analytics or tracking tools. Many game files come with ad code or Google Analytics added by whoever uploaded them; the site removes known ad and tracking code from each game before it runs and blocks it from loading.</p>

        <h3>Children</h3>
        <p>This site is not directed at children under 13, and we do not knowingly collect personal information from them. If you are under 13, you can still play, but please don't create an account. If we learn an account belongs to someone under 13, we will delete it.</p>

        <h3>How we use it</h3>
        <p>Only to run the features you use: signing in, keeping your progress in sync between devices, and showing game ratings and broken-game warnings. We never use it for advertising or profiling, and we never sell or rent it.</p>

        <h3>Third-party services</h3>
        <p>Like any website, these services receive basic technical information (such as your IP address and browser type) when your browser connects to them:</p>
        <ul>
            <li><b>Google Firebase</b> &mdash; accounts, cloud saves, ratings and reports.</li>
            <li><b>GitHub</b> &mdash; serves the site and its settings.</li>
            <li><b>jsDelivr</b> and other content networks &mdash; deliver the game files and images, and provide the public play counts.</li>
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
        <p><b>Effective October 7, 2026</b></p>
        <p>By using GN 2.0 you agree to these terms. If you don't agree, please don't use the site.</p>

        <h3>Games and content</h3>
        <p>The games listed here are made by and belong to their respective creators and owners. This site does not create them. Most game files are loaded from third-party sources; games in the <b>GN Originals</b> row are open-source games shared under their creators' licenses, with each game's license and credit kept with it and shown in its Info panel. We don't claim ownership of any game, and we aren't responsible for third-party content. If you own a game and want it removed from this site, see the <a href="#" onclick="loadDMCA(); return false;">DMCA</a> page.</p>

        <h3>Using the site</h3>
        <ul>
            <li>You are responsible for following the rules of any school, workplace, or network you use the site on.</li>
            <li>Don't attempt to break, overload, or get unauthorized access to the site or other people's accounts or saves.</li>
            <li>Don't use offensive or impersonating usernames. We may remove accounts that break these terms.</li>
            <li>You're responsible for keeping your password safe. Lost passwords can't be recovered.</li>
        </ul>

        <h3>No warranty</h3>
        <p>The site and all games are provided "as is" and "as available," without warranties of any kind. Games may stop working, be removed, or lose progress at any time, and cloud saves may be lost. Keep your own backups (Export Data) of anything important.</p>

        <h3>Limitation of liability</h3>
        <p>To the fullest extent allowed by law, the site owner is not liable for any damages or losses from using, or not being able to use, the site, its games, or its accounts and saves.</p>

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
                GN 2.0 doesn't host any game files. They're loaded from the gn-math game library,
                which is run by its own owner. If you own or developed a game shown here
                and would like it removed, please do the following:
            </p>
            <ol>
                <li>
                    Email me at 
                    <a href="mailto:gn.math.business@gmail.com">gn.math.business@gmail.com</a> 
                    with the subject starting with <code>!DMCA</code>.
                </li>
            </ol>
            <p>
                If you are going to do an email, please show proof you own the game before I have to ask.
            </p>
            <p>
                <b>GN Originals</b> are open-source games copied, with their licenses, into
                <a href="https://github.com/SCHSwork/GN-originals" target="_blank" rel="noopener">github.com/SCHSwork/GN-originals</a>.
                To have one of those removed or its credit corrected, open an issue on that repository.
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
githubSyncPull().finally(() => {
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
