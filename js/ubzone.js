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
        url: g.path ? ghUrl(g.path) : g.link,
        cover: g.cover ? ghUrl(g.cover) : "",
        special: [UBZONE_TAG, ...(g.link ? ["scratch"] : [])]
    };
}

async function loadUbzone() {
    let data = null;
    try {
        const res = await fetch(UBZONE_LIST_URL + "?t=" + Math.floor(Date.now() / 600000), { cache: "no-cache" });
        if (!res.ok) throw new Error("UBZone list " + res.status);
        data = await res.json();
        try { localStorage.setItem(UBZONE_CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
    } catch (err) {
        try { data = JSON.parse(localStorage.getItem(UBZONE_CACHE_KEY))?.data; } catch (e) {}
        if (!data) { console.warn("UBZone list unavailable", err); return []; }
    }
    // Only ever load the checked version: a full commit id, never a branch name
    if (!data || !/^[0-9a-f]{40}$/.test(data.ref || "") || !/^[\w.-]+\/[\w.-]+$/.test(data.repo || "") || !Array.isArray(data.games)) return [];
    ubzoneRef = data.ref;
    ubzonePins = {};
    for (const [repo, sha] of Object.entries(data.pins || {})) {
        if (/^[\w.-]+\/[\w.-]+$/.test(repo) && /^[0-9a-f]{40}$/.test(sha)) ubzonePins[repo] = sha;
    }
    const safePath = p => typeof p === "string" && /^[\w./-]+$/.test(p) && !p.includes("..");
    const safeLink = l => typeof l === "string" && /^https:\/\/scratch\.mit\.edu\/projects\/\d+\/fullscreen\/?$/.test(l);
    return data.games
        .filter(g => g && isUbzoneZone(g.id) && g.name && (safePath(g.path) || safeLink(g.link)) && (!g.cover || safePath(g.cover)))
        .map(g => toUbzoneZone(g, data.repo, data.ref));
}

// Game info panel for a UBZone game
function showUbzoneInfo(zone) {
    const body = document.getElementById("popupBody");
    document.getElementById("popupTitle").textContent = `${zone.name} Info`;
    const esc = typeof escapeHtmlText === "function" ? escapeHtmlText : s => String(s ?? "");
    const scratch = zone.url.startsWith("https://scratch.mit.edu/");
    body.innerHTML = `
        <p>
        <b>From</b>: <a href="${UBZONE_SITE}" target="_blank" rel="noopener">unblockedzone</a><br>
        ${scratch ? `<b>Plays on</b>: <a href="${esc(zone.url)}" target="_blank" rel="noopener">Scratch</a> (opens in a new tab)<br>` : ""}
        ${ubzoneRef && !scratch ? `<b>Version</b>: <code>${esc(ubzoneRef.slice(0, 7))}</code> (checked October 17, 2026)<br>` : ""}
        </p>
        <p style="color:var(--text-muted);font-size:13px;">This game comes from the unblockedzone collection. Its files were checked for trackers, ads and hidden scripts before it was added, and it always loads that checked version. All credit goes to the game's creators.</p>`;
}
