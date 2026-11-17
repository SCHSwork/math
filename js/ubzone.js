// ═════════════════════════════════════════════════════════════════════════════
// Checked collections: games from other unblocked-game sites that GN 2.0 didn't
// already have, loaded straight from those sites' GitHub repos.
//   UBZone games   config/ubzone-games.json    ids 300000+  (github.com/s0n-1m-cr1n3/sc13nc3)
//   Selenite games config/selenite-games.json  ids 400000+  (github.com/selenite-cc/selenite-old)
//   55GMS games    config/55gms-games.json     ids 500000+  (github.com/55gms/assets)
//   BCHS games     config/bchs-games.json      ids 600000+  (github.com/tw31122007/BCHS-Unblocked-Games)
//   Radon games    config/radon-games.json     ids 700000+  (github.com/Radon-Games/Radon-Games-Assets)
// Every game file was scanned before it was listed, so each collection loads
// from that exact checked version (its "ref" commit) and never from a newer
// one, the same way the main library is pinned after the Oct 11
// malicious-script change.
// Left out on purpose: games with ad networks the site can't switch off,
// trackers or hidden data calls the site can't remove, and games that load
// code from repos or sites that can change at any time.
// UBZone's ids keep their old names below (ubzoneState…) for the status light.
// ═════════════════════════════════════════════════════════════════════════════
const MIRROR_COLLECTIONS = [
    {
        key: "ubzone", list: "config/ubzone-games.json", base: 300000, label: "unblockedzone", source: "UBZone games",
        site: "https://github.com/s0n-1m-cr1n3/sc13nc3", checked: "October 17, 2026", clean: false
    },
    {
        // Selenite's current repo was taken off GitHub; selenite-old is its last GitHub copy
        key: "selenite", list: "config/selenite-games.json", base: 400000, label: "Selenite", source: "Selenite games",
        site: "https://github.com/selenite-cc/selenite-old", checked: "November 17, 2026", clean: true
    },
    {
        key: "55gms", list: "config/55gms-games.json", base: 500000, label: "55GMS", source: "55GMS games",
        site: "https://github.com/55gms/55gms", checked: "November 17, 2026", clean: true
    },
    {
        // Mostly Flash games, listed as .swf files (mirrorSwfPage makes their page)
        key: "bchs", list: "config/bchs-games.json", base: 600000, label: "BCHS Unblocked Games", source: "BCHS games",
        site: "https://github.com/tw31122007/BCHS-Unblocked-Games", checked: "November 17, 2026", clean: true
    },
    {
        key: "radon", list: "config/radon-games.json", base: 700000, label: "Radon Games", source: "Radon games",
        site: "https://github.com/Radon-Games/Radon-Games-Assets", checked: "November 17, 2026", clean: true
    }
];
const UBZONE_ID_BASE = 300000;
const UBZONE_TAG = "ubzone";
const UBZONE_SITE = MIRROR_COLLECTIONS[0].site;
// Per collection: { state, filesState, count, ref, repo, pins, probes }
const mirrorState = {};
MIRROR_COLLECTIONS.forEach(c => { mirrorState[c.key] = { state: "loading", filesState: "unchecked", count: 0, ref: null, repo: null, pins: {}, probes: {}, roots: [], drop: [] }; });
// Read by the status light (status.js): the UBZone collection
let ubzoneRef = null;
let ubzoneState = "loading";      // loading | live | cache | failed
let ubzoneFilesState = "unchecked"; // unchecked | checking | ok | down
let ubzoneGameCount = 0;
let ubzoneProbes = {};
let ubzonePins = {};

function mirrorCollectionOf(zoneOrId) {
    const id = Number(zoneOrId && typeof zoneOrId === "object" ? zoneOrId.id : zoneOrId);
    return MIRROR_COLLECTIONS.find(c => id >= c.base && id < c.base + 100000) || null;
}
// Any checked-collection game (the takedown form, Info panel and filters use it)
function isUbzoneZone(zoneOrId) { return !!mirrorCollectionOf(zoneOrId); }

function mirrorCollectionOfUrl(url) {
    const g = typeof parseGhUrl === "function" && parseGhUrl(url);
    if (!g) return null;
    const repo = (g.owner + "/" + g.repo).toLowerCase();
    return MIRROR_COLLECTIONS.find(c => (mirrorState[c.key].repo || "").toLowerCase() === repo) || null;
}
function isUbzoneGhUrl(url) { return !!mirrorCollectionOfUrl(url); }
// Collections whose pages also go through the site's ad and tracker cleaner
function mirrorNeedsClean(url) { const c = mirrorCollectionOfUrl(url); return !!(c && c.clean); }

// Tracker and ad tags some game pages carry. GN 2.0 has no trackers, so these
// are removed before the page runs. The games don't need them to play.
const UBZONE_TRACKER_HOSTS = "(?:www\\.)?googletagmanager\\.com|(?:www\\.)?google-analytics\\.com|pagead2\\.googlesyndication\\.com|static\\.cloudflareinsights\\.com|hb-bluewizard\\.s3\\.us-east-2\\.amazonaws\\.com|arc\\.io|(?:[\\w-]+\\.)?poki-cdn\\.com|a\\.poki\\.com|(?:[\\w-]+\\.)?gameanalytics\\.com";
const UBZONE_TRACKER_TAGS = new RegExp(`<(script|iframe)\\b[^>]*\\bsrc\\s*=\\s*["']?(?:https?:)?//(?:${UBZONE_TRACKER_HOSTS})[^"'\\s>]*["']?[^>]*>\\s*</\\1>`, "gi");
const UBZONE_TRACKER_INLINE = /<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?(?:googletagmanager\.com\/gtm\.js|google-analytics\.com\/analytics\.js)(?:(?!<\/script>)[\s\S])*?<\/script>/gi;
// Game-portal ad SDK files some Selenite/55GMS games bring along (Poki,
// CrazyGames, GameDistribution). They're removed; the site's stand-in SDK
// (portalSdkStub in app.js) answers the games' calls instead, with no ads.
const MIRROR_SDK_TAGS = /<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*(?:poki-sdk[\w.-]*\.js|game-cdn\.poki\.com\/scripts\/[^"'\s>]*|crazygames-sdk[\w.-]*\.js|sdk\.crazygames\.com\/[^"'\s>]*|html5\.api\.gamedistribution\.com\/[^"'\s>]*|GameAnalytics\.js|analytics_ubg[\w.-]*\.js)["']?[^>]*>\s*<\/script\s*>/gi;
// Pages that hide themselves unless they're the whole tab ("antiClickjack")
const MIRROR_FRAME_BUSTER = /<style id=["']antiClickjack["'][^>]*>[\s\S]*?<\/style>|<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?antiClickjack(?:(?!<\/script>)[\s\S])*?<\/script>/gi;
// Leftover gtag()/ga() calls in the games then just do nothing
const UBZONE_TRACKER_STUB = "<script>window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){};window.ga=window.ga||function(){};</script>";

function pinRepoLinks(html, repo, sha) {
    const [o, r] = repo.split("/").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return html
        // jsDelivr: gh/owner/repo/…, gh/owner/repo@main/…, @latest, @13 … (but not @<commit>)
        .replace(new RegExp(`(https?://[a-z0-9-]*\\.?jsdelivr\\.net/gh/${o}/${r})(?:@(?![0-9a-f]{40}/)[^/\\s"'\`<>]+)?/`, "gi"), `https://cdn.jsdelivr.net/gh/${repo}@${sha}/`)
        // GitHub / githack: owner/repo/<branch>/…
        .replace(new RegExp(`https?://(?:raw\\.githubusercontent\\.com|rawcdn\\.githack\\.com|raw\\.githack\\.com)/${o}/${r}/(?![0-9a-f]{40}/)[^/\\s"'\`<>]+/`, "gi"), `https://cdn.jsdelivr.net/gh/${repo}@${sha}/`);
}

// Point a game page at the checked versions of everything it loads, on the main
// jsDelivr address so the usual backups (fastly, gcore, githack) still work,
// and take out tracker tags. rawUrl says which collection the page is from.
function pinUbzoneRefs(html, rawUrl) {
    if (typeof html !== "string") return html;
    const c = (rawUrl && mirrorCollectionOfUrl(rawUrl)) || MIRROR_COLLECTIONS[0];
    const st = mirrorState[c.key];
    if (!st.ref || !st.repo) return html;
    html = pinRepoLinks(html, st.repo, st.ref);
    for (const [repo, sha] of Object.entries(st.pins)) html = pinRepoLinks(html, repo, sha);
    html = html.replace(/https?:\/\/(?:quantil|originfastly)\.jsdelivr\.net\//gi, "https://cdn.jsdelivr.net/");
    // Site files the pages load from "/…" on their own site: point the checked
    // ones at their copy in a checked repo ("roots"), take out the rest of the
    // listed ones ("drop": the sites' own trackers, ads and tab cloaks)
    if (st.drop.length || st.roots.length) html = html.replace(/<(script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](\/[^\/"'][^"']*)["'][^>]*>(?:\s*<\/script\s*>)?/gi, (tag, kind, url) => {
        const path = url.split(/[?#]/)[0];
        if (st.drop.includes(path)) return "";
        const r = st.roots.find(([from]) => from.endsWith("/") ? path.startsWith(from) : path === from);
        if (!r) return tag;
        const to = r[0].endsWith("/") ? r[1] + path.slice(r[0].length) : r[1];
        return tag.replace(url, `https://cdn.jsdelivr.net/gh/${to}`);
    });
    // …and folder roots named in the page's own code (EJS_pathtodata = "/emulatorjs/data/")
    for (const [from, to] of st.roots) {
        if (!from.endsWith("/")) continue;
        const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        html = html.replace(new RegExp(`(["'])${esc}([\\w./-]*)\\1`, "g"), (m, q, rest) => `${q}https://cdn.jsdelivr.net/gh/${to}${rest}${q}`);
    }
    let cleaned = html.replace(UBZONE_TRACKER_TAGS, "").replace(UBZONE_TRACKER_INLINE, "");
    if (c.clean) cleaned = cleaned.replace(MIRROR_SDK_TAGS, "").replace(MIRROR_FRAME_BUSTER, "");
    if (cleaned === html) return html;
    return /<head\b[^>]*>/i.test(cleaned) ? cleaned.replace(/<head\b[^>]*>/i, m => m + UBZONE_TRACKER_STUB) : UBZONE_TRACKER_STUB + cleaned;
}

// Flash games listed as a .swf file (BCHS): the page that plays them is made
// here, with the site's own copy of Ruffle. Links the game tries to open
// ("more games", ad clicks) are blocked.
function mirrorSwfPage(rawUrl) {
    const g = typeof parseGhUrl === "function" && parseGhUrl(rawUrl);
    if (!g || !/\.swf$/i.test(g.path)) return null;
    const swf = `https://cdn.jsdelivr.net/gh/${g.owner}/${g.repo}@${g.ref}/${g.path.split("/").map(encodeURIComponent).join("/")}`;
    const base = swf.slice(0, swf.lastIndexOf("/") + 1);
    const ruffle = new URL("vendor/ruffle/ruffle.js", location.href).href;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}#game,#game>*{width:100%;height:100%}</style></head>` +
        `<body><div id="game"></div><script src="${ruffle}"><\/script><script>(function(){` +
        `window.RufflePlayer=window.RufflePlayer||{};window.RufflePlayer.config={autoplay:"on",unmuteOverlay:"hidden",splashScreen:false,openUrlMode:"deny",allowScriptAccess:false};` +
        `var start=function(){var p=window.RufflePlayer.newest().createPlayer();document.getElementById("game").appendChild(p);p.load({url:${JSON.stringify(swf)},base:${JSON.stringify(base)}});};` +
        `if(document.readyState==="complete")start();else window.addEventListener("load",start);})();<\/script></body></html>`;
}

function toUbzoneZone(g, c, repo, ref) {
    const ghUrl = path => `gh:${repo}@${ref}/${String(path).replace(/^\/+/, "")}`;
    return {
        id: Number(g.id),
        name: g.name,
        // "by" is the game's maker when the collection's list names one
        author: c.key === "ubzone" ? "unblockedzone" : (typeof g.by === "string" && g.by.trim() ? g.by.trim().slice(0, 80) : c.label),
        authorLink: c.site,
        // path: a page in the collection's repo (plays in the normal player)
        // link: a Scratch project; play: a page of GN 2.0's own (play/<name>/) for games
        // that need a full tab. Both open in a new tab.
        url: g.path ? ghUrl(g.path) : g.play ? new URL(g.play, location.href).href : g.link,
        // A cover is a path in the collection's repo, or "owner/repo@commit/path" in another checked repo
        cover: !g.cover ? "" : /@[0-9a-f]{40}\//.test(g.cover) ? "gh:" + g.cover : ghUrl(g.cover),
        special: [c.key === "ubzone" ? UBZONE_TAG : c.key, ...(g.link ? ["scratch"] : [])],
        newTab: !!(g.play || g.link),
        sources: Array.isArray(g.sources) ? g.sources.filter(s => typeof s === "string").slice(0, 8)
            : g.path ? [`${repo}@${ref}/${String(g.path).replace(/\/[^/]*$/, "")}`] : []
    };
}

async function loadMirrorCollection(c) {
    const st = mirrorState[c.key];
    const cacheKey = "gnmath-cache-" + c.key;
    let data = null;
    try {
        // One fixed URL + "no-cache": the browser only re-downloads it when it changed
        const res = await fetch(c.list, { cache: "no-cache" });
        if (!res.ok) throw new Error(c.source + " list " + res.status);
        data = await res.json();
        gnBackup.put(cacheKey, data);
        st.state = "live";
    } catch (err) {
        try { data = (await gnBackup.get(cacheKey))?.data; } catch (e) {}
        if (!data) { st.state = "failed"; console.warn(c.source + " list unavailable", err); return []; }
        st.state = "cache";
    }
    // Only ever load the checked version: a full commit id, never a branch name
    if (!data || !/^[0-9a-f]{40}$/.test(data.ref || "") || !/^[\w.-]+\/[\w.-]+$/.test(data.repo || "") || !Array.isArray(data.games)) { st.state = "failed"; return []; }
    st.ref = data.ref;
    st.repo = data.repo;
    st.pins = {};
    for (const [repo, sha] of Object.entries(data.pins || {})) {
        if (/^[\w.-]+\/[\w.-]+$/.test(repo) && /^[0-9a-f]{40}$/.test(sha)) st.pins[repo] = sha;
    }
    const safePath = p => typeof p === "string" && /^[\w./-]+$/.test(p) && !p.includes("..");
    const safeLink = l => typeof l === "string" && /^https:\/\/scratch\.mit\.edu\/projects\/\d+\/fullscreen\/?$/.test(l);
    const safePlay = p => typeof p === "string" && /^play\/[\w-]+\/$/.test(p);
    // "roots": { "/site/path" or "/site/folder/": "owner/repo@commit/path" }; "drop": ["/site/path", …]
    st.roots = Object.entries(data.roots || {}).filter(([from, to]) => /^\/[\w.\/-]+$/.test(from) && !from.includes("..")
        && typeof to === "string" && /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}\/[\w.\/-]*$/.test(to) && from.endsWith("/") === to.endsWith("/"));
    st.drop = (Array.isArray(data.drop) ? data.drop : []).filter(p => typeof p === "string" && /^\/[\w.\/-]+$/.test(p));
    st.probes = {};
    for (const [key, path] of Object.entries(data.probes || {})) {
        if (/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(key) && safePath(path)) st.probes[key] = path;
    }
    const inRange = g => { const n = Number(g.id); return n >= c.base && n < c.base + 100000; };
    const out = data.games
        .filter(g => g && inRange(g) && g.name && (safePath(g.path) || safeLink(g.link) || safePlay(g.play))
            && (!g.cover || safePath(g.cover) || /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}\/[\w./-]+$/.test(g.cover)))
        .map(g => toUbzoneZone(g, c, data.repo, data.ref));
    st.count = out.length;
    if (c.key === "ubzone") {
        ubzoneRef = st.ref; ubzonePins = st.pins; ubzoneProbes = st.probes; ubzoneGameCount = st.count;
    }
    setTimeout(() => checkMirrorFiles(c), 4000);
    return out;
}

async function loadUbzone() {
    const lists = await Promise.all(MIRROR_COLLECTIONS.map(c => loadMirrorCollection(c).catch(() => [])));
    ubzoneState = mirrorState.ubzone.state;
    return lists.flat();
}

// Status light: can this network reach a collection's game files? One small
// file from its repo, through the same sources games use (jsDelivr, GitHub,
// githack, then the jsDelivr backups). The GN Status page checks every repo the
// games use; this is just a quick check from the player's network.
async function checkMirrorFiles(c) {
    const st = mirrorState[c.key];
    if (st.filesState === "checking" || typeof fetchFirst !== "function" || typeof mirrorUrls !== "function") return;
    const own = (st.repo || "").toLowerCase() + "@";
    const key = Object.keys(st.probes).find(k => k.toLowerCase().startsWith(own)) || Object.keys(st.probes)[0];
    if (!key) return;
    const [repo, sha] = key.split("@");
    const [owner, name] = repo.split("/");
    st.filesState = "checking";
    if (c.key === "ubzone") ubzoneFilesState = "checking";
    try {
        await fetchFirst(mirrorUrls(owner, name, sha, st.probes[key]), { timeoutMs: 10000, track: false, cache: "no-store", validate: async res => { await res.arrayBuffer(); return true; } });
        st.filesState = "ok";
    } catch (e) {
        st.filesState = "down";
        setTimeout(() => checkMirrorFiles(c), 5 * 60 * 1000);   // try again later
    }
    if (c.key === "ubzone") ubzoneFilesState = st.filesState;
    if (typeof updateSiteStatus === "function") updateSiteStatus();
}
function checkUbzoneFiles() { return checkMirrorFiles(MIRROR_COLLECTIONS[0]); }

// Where a game's files really live: its page in the collection's repo plus
// every repo it loads files from, each at the commit that was checked. Used by
// the info panel, the takedown form and the admins' takedown list, so rights
// holders can also go to the original repos.
function ubzoneSourceLinks(zone) {
    const out = [];
    for (const s of (zone && zone.sources) || []) {
        if (/^https:\/\/scratch\.mit\.edu\/projects\/\d+\/?$/.test(s)) { out.push({ url: s, label: "Scratch project " + s.match(/\d+/)[0] }); continue; }
        const m = /^([\w.-]+)\/([\w.-]+)@([0-9a-f]{40})(?:\/([\w.\/-]*))?$/.exec(s);
        if (!m) continue;
        const [, owner, repo, sha, path] = m;
        out.push({
            url: `https://github.com/${owner}/${repo}/tree/${sha}${path ? "/" + path : ""}`,
            label: `${owner}/${repo}${path ? "/" + path : ""}`,
            repoUrl: `https://github.com/${owner}/${repo}`
        });
    }
    return out;
}
// The same links as HTML (escaped), for popups
function ubzoneSourceListHtml(zone) {
    const esc = typeof escapeHtmlText === "function" ? escapeHtmlText : s => String(s ?? "");
    const links = ubzoneSourceLinks(zone);
    const c = mirrorCollectionOf(zone) || MIRROR_COLLECTIONS[0];
    if (!links.length) return `<a href="${c.site}" target="_blank" rel="noopener">${c.site.replace("https://", "")}</a>`;
    return `<ul class="ubzone-sources">${links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>${l.repoUrl ? ` · <a href="${esc(l.repoUrl)}/issues" target="_blank" rel="noopener noreferrer">issues</a>` : ""}</li>`).join("")}</ul>`;
}
// "the unblockedzone collection", "the Selenite collection"…
function mirrorCollectionName(zone) { return `the ${(mirrorCollectionOf(zone) || MIRROR_COLLECTIONS[0]).label} collection`; }

// Game info panel for a checked-collection game
function showUbzoneInfo(zone) {
    const body = document.getElementById("popupBody");
    document.getElementById("popupTitle").textContent = `${zone.name} Info`;
    const esc = typeof escapeHtmlText === "function" ? escapeHtmlText : s => String(s ?? "");
    const c = mirrorCollectionOf(zone) || MIRROR_COLLECTIONS[0];
    const ref = mirrorState[c.key].ref;
    const scratch = zone.url.startsWith("https://scratch.mit.edu/");
    const ownPage = zone.newTab && !scratch;
    const madeBy = c.key !== "ubzone" && zone.author && zone.author !== c.label;
    body.innerHTML = `
        <p>
        ${madeBy ? `<b>Made by</b>: ${esc(zone.author)}<br>` : ""}
        <b>From</b>: <a href="${c.site}" target="_blank" rel="noopener">${esc(c.label)}</a><br>
        ${scratch ? `<b>Plays on</b>: <a href="${esc(zone.url)}" target="_blank" rel="noopener">Scratch</a> (opens in a new tab)<br>` : ""}
        ${ownPage ? `<b>Plays in</b>: its own tab, because it needs browser features the normal player can't give it<br>` : ""}
        ${ref && !zone.newTab ? `<b>Version</b>: <code>${esc(ref.slice(0, 7))}</code> (checked ${esc(c.checked)})<br>` : ""}
        </p>
        <p style="margin-bottom:0.25rem;"><b>Original files</b> (the version GN 2.0 loads):</p>
        ${ubzoneSourceListHtml(zone)}
        <p style="color:var(--text-muted);font-size:13px;">This game comes from ${esc(mirrorCollectionName(zone))}. Its files were checked for trackers, ads and hidden scripts before it was added, and it always loads that checked version${c.clean ? "; any ad or tracking code it carries is switched off before it runs" : ""}. All credit goes to the game's creators. Own this game? <a href="#" onclick="openTakedownForm(zones.find(z => z.id === ${Number(zone.id)})); return false;">Send a takedown request</a>.</p>`;
}
