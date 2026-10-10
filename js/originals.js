// ═════════════════════════════════════════════════════════════════════════════
// GN Originals: open-source browser games whose licenses allow sharing them.
// The games and their list (games.json) live in the SCHSwork/GN-originals repo,
// one folder per game with its license. They load through the same three
// sources as the main library (jsDelivr → GitHub → githack).
// Ids start at 100000 so they never collide with the main library.
// ═════════════════════════════════════════════════════════════════════════════
const ORIGINALS_REPO = { owner: "SCHSwork", repo: "GN-originals", ref: "main" };
const ORIGINALS_CACHE_KEY = "gnmath-cache-originals";
const ORIGINALS_ID_BASE = 100000;
const ORIGINALS_TAG = "originals";
const GH_URL_RE = /^gh:([\w.-]+)\/([\w.-]+)@([\w.-]+)\/([^\s?#]+)$/i;
function originalsUrl(path) {
    return `gh:${ORIGINALS_REPO.owner}/${ORIGINALS_REPO.repo}@${ORIGINALS_REPO.ref}/${String(path).replace(/^\/+/, "")}`;
}

function isOriginalZone(zoneOrId) {
    const id = zoneOrId && typeof zoneOrId === "object" ? zoneOrId.id : zoneOrId;
    const n = Number(id);
    return n >= ORIGINALS_ID_BASE && n < 200000; // 200000+ are partner games (partners.js)
}

function parseGhUrl(url) {
    const m = GH_URL_RE.exec(url || "");
    return m ? { owner: m[1], repo: m[2], ref: m[3], path: m[4] } : null;
}

function toOriginalZone(z) {
    return {
        ...z,
        url: originalsUrl(z.path),
        cover: z.cover ? originalsUrl(z.cover) : "",
        special: [...new Set([ORIGINALS_TAG, ...(Array.isArray(z.special) ? z.special : [])])]
    };
}
async function loadOriginals() {
    const { owner, repo, ref } = ORIGINALS_REPO;
    let list = null;
    try {
        // GitHub first for the list: jsDelivr can keep an old copy of a branch for
        // up to 12 hours, so newly added games would take that long to appear.
        const listUrls = mirrorUrls(owner, repo, ref, "games.json")
            .sort((a, b) => {
                const first = u => mirrorOf(u) === "github" && !mirrorDown.has("github");
                return first(b) - first(a);
            });
        list = await fetchFirst(listUrls.map(u => u + "?t=" + Math.floor(Date.now() / 600000)), {
            timeoutMs: 12000,
            validate: async res => {
                const j = await res.json();
                if (!Array.isArray(j)) throw new Error("bad GN Originals list");
                return j;
            }
        });
        try { localStorage.setItem(ORIGINALS_CACHE_KEY, JSON.stringify({ t: Date.now(), data: list })); } catch (e) {}
    } catch (err) {
        try { list = JSON.parse(localStorage.getItem(ORIGINALS_CACHE_KEY))?.data; } catch (e) {}
        if (!Array.isArray(list)) { console.warn("GN Originals list unavailable", err); return []; }
    }
    return list
        .filter(z => z && isOriginalZone(z.id) && z.name && typeof z.path === "string" && !/\.\./.test(z.path))
        .map(toOriginalZone);
}

// Put a <base> tag first in <head> so the game's own files (scripts, images,
// sounds) load from its repo instead of from this site.
function withBaseHref(html, base) {
    html = html.replace(/<base\b[^>]*>/gi, tag => {
        const href = (tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
        if (href) { try { base = new URL(href, base).href; } catch (e) {} }
        return "";
    });
    // Images from the game's own files may be drawn into canvas/WebGL, which
    // needs them loaded with CORS now that they're on another site.
    // Most of these games expect the browser's default white page behind them.
    const tag = `<base href="${base.replace(/"/g, "%22")}"><style>:where(html){background-color:#fff;color:#000}</style><script>(function(){var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");` +
        `if(d&&d.set)Object.defineProperty(HTMLImageElement.prototype,"src",{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){try{if(this.crossOrigin===null&&!/^(data|blob):/.test(v))this.crossOrigin="anonymous"}catch(e){}d.set.call(this,v)}})})();<\/script>`;
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, m => m + tag);
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, m => m + "<head>" + tag + "</head>");
    if (/<!doctype[^>]*>/i.test(html)) return html.replace(/<!doctype[^>]*>/i, m => m + tag);
    return tag + html;
}

async function fetchOriginalHtml(url) {
    const g = parseGhUrl(url);
    if (!g) throw new Error("Not a GN Originals address");
    const { text, from } = await fetchFirst(mirrorUrls(g.owner, g.repo, g.ref, g.path), {
        timeoutMs: 30000,
        validate: async res => ({ text: await res.text(), from: res.url })
    });
    const dir = g.path.includes("/") ? g.path.slice(0, g.path.lastIndexOf("/") + 1) : "";
    // GitHub serves scripts as plain text, which browsers refuse to run, so a
    // page that came from GitHub loads its files from githack instead.
    const host = mirrorOf(from) === "jsdelivr" ? "jsdelivr" : "githack";
    return withBaseHref(cleanGameHtml(text), MIRRORS[host](g.owner, g.repo, g.ref, dir));
}

// "GN Originals" row on the home page
function renderOriginalsShelf() {
    const wrap = document.getElementById("originalsWrapper");
    const shelf = document.getElementById("originalsZones");
    if (!wrap || !shelf || !Array.isArray(zones)) return;
    // Cards need library.js; if the list arrived first, draw the row once the page has loaded
    if (typeof isFavorite !== "function") { window.addEventListener("load", renderOriginalsShelf, { once: true }); return; }
    // The row shows the hand-picked games; the hundreds of tiny js13k games are under
    // their own "js13k" tag and in All games, so the row stays quick to scan.
    const list = zones.filter(z => isOriginalZone(z) && !isZoneDisabled(z.id) && !(z.special || []).includes("js13k"))
        .sort((a, b) => a.name.localeCompare(b.name));
    shelf.innerHTML = "";
    list.forEach(z => shelf.appendChild(createZoneCard(z)));
    wrap.hidden = list.length === 0;
    if (typeof setSectionTitle === "function") setSectionTitle(document.getElementById("originalsSummary"), "GN Originals", list.length);
    if (typeof enhanceShelf === "function") enhanceShelf(shelf);
    observeLazyZoneImages("#originalsZones img.lazy-zone-img");
}

function escapeHtmlText(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeLink(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; }
}

// Game info panel for an original: creator, license and source
function showOriginalInfo(zone) {
    const body = document.getElementById("popupBody");
    document.getElementById("popupTitle").textContent = `${zone.name} Info`;
    const g = parseGhUrl(zone.url) || {};
    const source = safeLink(zone.source) || (g.owner ? `https://github.com/${g.owner}/${g.repo}` : null);
    const authorLink = safeLink(zone.authorLink);
    const licenseLink = safeLink(zone.licenseUrl) || (zone.licenseFile && g.owner ? `https://github.com/${g.owner}/${g.repo}/blob/${g.ref}/${zone.licenseFile}` : source);
    const tags = (zone.special || []).filter(t => t !== ORIGINALS_TAG).map(toTitleCase).join(", ");
    const link = (href, text) => href ? `<a href="${escapeHtmlText(href)}" target="_blank" rel="noopener">${escapeHtmlText(text)}</a>` : escapeHtmlText(text);
    body.innerHTML = `
        <p>${escapeHtmlText(zone.description || "")}</p>
        <p>
        <b>Made by</b>: ${link(authorLink, zone.author || "Unknown")}<br>
        <b>License</b>: ${link(licenseLink, zone.license || "See source")}<br>
        ${source ? `<b>Source code</b>: ${link(source, source.replace(/^https:\/\//, ""))}<br>` : ""}
        ${tags ? `<b>Tags</b>: ${escapeHtmlText(tags)}<br>` : ""}
        ${zone.sourceCommit ? `<b>Version</b>: <code>${escapeHtmlText(String(zone.sourceCommit).slice(0, 7))}</code><br>` : ""}
        </p>
        <p style="color:var(--text-muted);font-size:13px;">This is a GN Original: an open-source game shared under its creator's license. All credit goes to its creator; GN 2.0 only loads it.</p>`;
}

// Some games have their own "play again" button that reloads the page; their
// copies call this instead so the game restarts inside the player.
window.gnRestartCurrentGame = function () {
    const id = typeof currentGameId !== "undefined" ? currentGameId : null;
    const zone = id && zones.find(z => String(z.id) === String(id));
    if (zone) openZone(zone);
};
