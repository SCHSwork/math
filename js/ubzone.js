// ═════════════════════════════════════════════════════════════════════════════
// UBZone games: games from the unblockedzone site (github.com/s0n-1m-cr1n3/sc13nc3)
// that GN 2.0 didn't already have. The list is config/ubzone-games.json.
// Every game file was scanned before it was listed, so they load from that
// exact checked version (the "ref" commit) and never from a newer one, the same
// way the main library is pinned after the Oct 11 malicious-script change.
// Left out on purpose: games with trackers, ads or hidden data calls, and games
// that load code from repos or sites that can change at any time.
// Ids start at 300000 so they never collide with the library, GN Originals or
// partner games.
// ═════════════════════════════════════════════════════════════════════════════
const UBZONE_LIST_URL = "config/ubzone-games.json";
const UBZONE_CACHE_KEY = "gnmath-cache-ubzone";
const UBZONE_ID_BASE = 300000;
const UBZONE_TAG = "ubzone";
const UBZONE_SITE = "https://github.com/s0n-1m-cr1n3/sc13nc3";
let ubzoneRef = null;   // the checked commit, from the list
// Read by the status light (status.js)
let ubzoneState = "loading";      // loading | live | cache | failed
let ubzoneFilesState = "unchecked"; // unchecked | checking | ok | down
let ubzoneGameCount = 0;
let ubzoneProbes = {};            // "owner/repo@commit" → a small file in it (from the list)

function isUbzoneZone(zoneOrId) {
    const id = zoneOrId && typeof zoneOrId === "object" ? zoneOrId.id : zoneOrId;
    const n = Number(id);
    return n >= UBZONE_ID_BASE && n < UBZONE_ID_BASE + 100000;
}

function isUbzoneGhUrl(url) {
    const g = typeof parseGhUrl === "function" && parseGhUrl(url);
    return !!g && (g.owner + "/" + g.repo).toLowerCase() === "s0n-1m-cr1n3/sc13nc3";
}

// Other repos some games load their files from, each pinned to the commit that
// was scanned (the list's "pins"). Links that already name an exact commit are
// left alone; they were scanned at that commit.
let ubzonePins = {};
// Tracker and ad tags some game pages carry. GN 2.0 has no trackers, so these
// are removed before the page runs. The games don't need them to play.
const UBZONE_TRACKER_HOSTS = "(?:www\\.)?googletagmanager\\.com|(?:www\\.)?google-analytics\\.com|pagead2\\.googlesyndication\\.com|static\\.cloudflareinsights\\.com|hb-bluewizard\\.s3\\.us-east-2\\.amazonaws\\.com";
const UBZONE_TRACKER_TAGS = new RegExp(`<(script|iframe)\\b[^>]*\\bsrc\\s*=\\s*["']https?://(?:${UBZONE_TRACKER_HOSTS})[^"']*["'][^>]*>\\s*</\\1>`, "gi");
const UBZONE_TRACKER_INLINE = /<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?(?:googletagmanager\.com\/gtm\.js|google-analytics\.com\/analytics\.js)(?:(?!<\/script>)[\s\S])*?<\/script>/gi;
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

// Point a UBZone game page at the checked versions of everything it loads, on the
// main jsDelivr address so the usual backups (fastly, gcore, githack) still work,
// and take out tracker tags.
function pinUbzoneRefs(html) {
    if (typeof html !== "string" || !ubzoneRef) return html;
    html = pinRepoLinks(html, "s0n-1m-cr1n3/sc13nc3", ubzoneRef);
    for (const [repo, sha] of Object.entries(ubzonePins)) html = pinRepoLinks(html, repo, sha);
    html = html.replace(/https?:\/\/(?:quantil|originfastly)\.jsdelivr\.net\//gi, "https://cdn.jsdelivr.net/");
    const cleaned = html.replace(UBZONE_TRACKER_TAGS, "").replace(UBZONE_TRACKER_INLINE, "");
    if (cleaned === html) return html;
    return /<head\b[^>]*>/i.test(cleaned) ? cleaned.replace(/<head\b[^>]*>/i, m => m + UBZONE_TRACKER_STUB) : UBZONE_TRACKER_STUB + cleaned;
}

function toUbzoneZone(g, repo, ref) {
    const ghUrl = path => `gh:${repo}@${ref}/${String(path).replace(/^\/+/, "")}`;
    return {
        id: Number(g.id),
        name: g.name,
        author: "unblockedzone",
        authorLink: UBZONE_SITE,
        // path: a page in the unblockedzone repo (plays in the normal player)
        // link: a Scratch project; play: a page of GN 2.0's own (play/<name>/) for games
        // that need a full tab. Both open in a new tab.
        url: g.path ? ghUrl(g.path) : g.play ? new URL(g.play, location.href).href : g.link,
        // A cover is a path in the unblockedzone repo, or "owner/repo@commit/path" in another checked repo
        cover: !g.cover ? "" : /@[0-9a-f]{40}\//.test(g.cover) ? "gh:" + g.cover : ghUrl(g.cover),
        special: [UBZONE_TAG, ...(g.link ? ["scratch"] : [])],
        newTab: !!(g.play || g.link),
        sources: Array.isArray(g.sources) ? g.sources.filter(s => typeof s === "string").slice(0, 8) : []
    };
}

async function loadUbzone() {
    let data = null;
    try {
        // One fixed URL + "no-cache": the browser only re-downloads it when it changed
        const res = await fetch(UBZONE_LIST_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error("UBZone list " + res.status);
        data = await res.json();
        try { localStorage.setItem(UBZONE_CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
        ubzoneState = "live";
    } catch (err) {
        try { data = JSON.parse(localStorage.getItem(UBZONE_CACHE_KEY))?.data; } catch (e) {}
        if (!data) { ubzoneState = "failed"; console.warn("UBZone list unavailable", err); return []; }
        ubzoneState = "cache";
    }
    // Only ever load the checked version: a full commit id, never a branch name
    if (!data || !/^[0-9a-f]{40}$/.test(data.ref || "") || !/^[\w.-]+\/[\w.-]+$/.test(data.repo || "") || !Array.isArray(data.games)) { ubzoneState = "failed"; return []; }
    ubzoneRef = data.ref;
    ubzonePins = {};
    for (const [repo, sha] of Object.entries(data.pins || {})) {
        if (/^[\w.-]+\/[\w.-]+$/.test(repo) && /^[0-9a-f]{40}$/.test(sha)) ubzonePins[repo] = sha;
    }
    const safePath = p => typeof p === "string" && /^[\w./-]+$/.test(p) && !p.includes("..");
    const safeLink = l => typeof l === "string" && /^https:\/\/scratch\.mit\.edu\/projects\/\d+\/fullscreen\/?$/.test(l);
    const safePlay = p => typeof p === "string" && /^play\/[\w-]+\/$/.test(p);
    ubzoneProbes = {};
    for (const [key, path] of Object.entries(data.probes || {})) {
        if (/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(key) && safePath(path)) ubzoneProbes[key] = path;
    }
    const out = data.games
        .filter(g => g && isUbzoneZone(g.id) && g.name && (safePath(g.path) || safeLink(g.link) || safePlay(g.play))
            && (!g.cover || safePath(g.cover) || /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}\/[\w./-]+$/.test(g.cover)))
        .map(g => toUbzoneZone(g, data.repo, data.ref));
    ubzoneGameCount = out.length;
    setTimeout(checkUbzoneFiles, 4000);
    return out;
}

// Status light: can this network reach the UBZone game files? One small file
// from the unblockedzone repo, through the same sources games use (jsDelivr,
// GitHub, githack, then the jsDelivr backups). The GN Status page checks every
// repo the games use; this is just a quick check from the player's network.
async function checkUbzoneFiles() {
    if (ubzoneFilesState === "checking" || typeof fetchFirst !== "function" || typeof mirrorUrls !== "function") return;
    const key = Object.keys(ubzoneProbes).find(k => k.toLowerCase().startsWith("s0n-1m-cr1n3/sc13nc3@")) || Object.keys(ubzoneProbes)[0];
    if (!key) return;
    const [repo, sha] = key.split("@");
    const [owner, name] = repo.split("/");
    ubzoneFilesState = "checking";
    try {
        await fetchFirst(mirrorUrls(owner, name, sha, ubzoneProbes[key]), { timeoutMs: 10000, track: false, cache: "no-store", validate: async res => { await res.arrayBuffer(); return true; } });
        ubzoneFilesState = "ok";
    } catch (e) {
        ubzoneFilesState = "down";
        setTimeout(checkUbzoneFiles, 5 * 60 * 1000);   // try again later
    }
    if (typeof updateSiteStatus === "function") updateSiteStatus();
}

// Where a UBZone game's files really live: its page on unblockedzone plus every
// repo it loads files from, each at the commit that was checked. Used by the
// info panel, the takedown form and the admins' takedown list, so rights
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
    if (!links.length) return `<a href="${UBZONE_SITE}" target="_blank" rel="noopener">${UBZONE_SITE.replace("https://", "")}</a>`;
    return `<ul class="ubzone-sources">${links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>${l.repoUrl ? ` · <a href="${esc(l.repoUrl)}/issues" target="_blank" rel="noopener noreferrer">issues</a>` : ""}</li>`).join("")}</ul>`;
}

// Game info panel for a UBZone game
function showUbzoneInfo(zone) {
    const body = document.getElementById("popupBody");
    document.getElementById("popupTitle").textContent = `${zone.name} Info`;
    const esc = typeof escapeHtmlText === "function" ? escapeHtmlText : s => String(s ?? "");
    const scratch = zone.url.startsWith("https://scratch.mit.edu/");
    const ownPage = zone.newTab && !scratch;
    body.innerHTML = `
        <p>
        <b>From</b>: <a href="${UBZONE_SITE}" target="_blank" rel="noopener">unblockedzone</a><br>
        ${scratch ? `<b>Plays on</b>: <a href="${esc(zone.url)}" target="_blank" rel="noopener">Scratch</a> (opens in a new tab)<br>` : ""}
        ${ownPage ? `<b>Plays in</b>: its own tab, because it needs browser features the normal player can't give it<br>` : ""}
        ${ubzoneRef && !zone.newTab ? `<b>Version</b>: <code>${esc(ubzoneRef.slice(0, 7))}</code> (checked October 17, 2026)<br>` : ""}
        </p>
        <p style="margin-bottom:0.25rem;"><b>Original files</b> (the version GN 2.0 loads):</p>
        ${ubzoneSourceListHtml(zone)}
        <p style="color:var(--text-muted);font-size:13px;">This game comes from the unblockedzone collection. Its files were checked for trackers, ads and hidden scripts before it was added, and it always loads that checked version. All credit goes to the game's creators. Own this game? <a href="#" onclick="openTakedownForm(zones.find(z => z.id === ${Number(zone.id)})); return false;">Send a takedown request</a>.</p>`;
}
