// ═════════════════════════════════════════════════════════════════════════════
// Partner games: free games from html5games.com (made and hosted by Famobi) and
// from Playgama (uploaded there by their own developers). Both let any website
// embed their games for free; in return the games show the platform's own ads.
// So unlike every other game here, these:
//   • load straight from the platform's servers (play.famobi.com, playgama.com),
//   • can't have their ads removed, and the platform's ad partners may use cookies,
//   • are marked with an "AD" badge on their card and in the player,
//   • can be hidden with the "Partner games" switch above All games.
// GN 2.0 doesn't add ads and doesn't get paid for them.
// Ids start at 200000 so they never collide with the library or GN Originals.
// ═════════════════════════════════════════════════════════════════════════════
const PARTNER_ID_BASE = 200000;
const PARTNER_TAG = "partner";
// html5games.com's own link code, the one its "play" buttons use
const PARTNER_LINK_CODE = "A1000-10";
const PARTNER_LIST_URL = "config/partner-games.json";
const PARTNER_CACHE_KEY = "gnmath-cache-partners";
const PARTNER_THUMB_BASE = "https://img.cdn.famobi.com/portal/html5games/images/tmp/180/";
// Playgama: embed links and cover pictures (GN 2.0 has no Playgama account and earns nothing)
const PLAYGAMA_LIST_URL = "config/partner-games-playgama.json";
const PLAYGAMA_CACHE_KEY = "gnmath-cache-partners-playgama";
const PLAYGAMA_PLAY_BASE = "https://playgama.com/export/game/";
const PLAYGAMA_IMG_BASE = "https://static.playgama.com/p-img/pg/";
const PARTNER_PROVIDERS = {
    famobi:   { name: "html5games.com", maker: "Famobi", site: "https://html5games.com/", makerSite: "https://famobi.com/", host: "Famobi's servers" },
    playgama: { name: "Playgama", maker: "its developer, via Playgama", site: "https://playgama.com/", makerSite: "https://playgama.com/", host: "Playgama's servers" }
};
function partnerProvider(zone) { return PARTNER_PROVIDERS[zone && zone.provider] ? zone.provider : "famobi"; }

function isPartnerZone(zoneOrId) {
    const id = zoneOrId && typeof zoneOrId === "object" ? zoneOrId.id : zoneOrId;
    const n = Number(id);
    return n >= PARTNER_ID_BASE && n < PARTNER_ID_BASE + 100000;
}

function partnerPlayUrl(zone) {
    if (partnerProvider(zone) === "playgama") {
        const slug = String(zone.pkg || "");
        return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? PLAYGAMA_PLAY_BASE + slug : null;
    }
    const pkg = String(zone.pkg || "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg)) return null;
    return `https://play.famobi.com/${pkg}/${PARTNER_LINK_CODE}`;
}

function toPartnerZone(p) {
    if (p.provider === "playgama") {
        return {
            id: Number(p.id), name: p.name, pkg: p.slug, provider: "playgama",
            author: "Playgama developer", authorLink: "https://playgama.com/game/" + p.slug,
            url: "partner:playgama:" + p.slug,
            cover: /^[a-z_-]+\/[0-9a-f]+$/.test(p.img || "") ? `${PLAYGAMA_IMG_BASE}${p.slug}/${p.img}?width=320` : "",
            description: p.description || "",
            category: (p.genres || [])[0] || "",
            special: [PARTNER_TAG, "playgama", ...(p.genres || []).map(g => String(g).toLowerCase())],
            libraryDuplicate: !!p.libraryDuplicate
        };
    }
    return {
        id: Number(p.id),
        name: p.name,
        pkg: p.pkg,
        author: "Famobi",
        authorLink: "https://html5games.com/",
        provider: "famobi",
        url: "partner:" + p.pkg,
        cover: p.thumb && /^[\w.-]+\.(jpe?g|png|webp)$/i.test(p.thumb) ? PARTNER_THUMB_BASE + p.thumb : "",
        description: p.description || "",
        category: p.category || "",
        special: [PARTNER_TAG, ...(p.category ? [String(p.category).toLowerCase()] : [])],
        thumbGuessed: !!p.thumbGuessed,
        libraryDuplicate: !!p.libraryDuplicate
    };
}

async function loadPartnerList(url, cacheKey) {
    let list = null;
    try {
        const res = await fetch(url + "?t=" + Math.floor(Date.now() / 600000), { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        list = await res.json();
        if (!Array.isArray(list)) throw new Error("bad partner list");
        try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: list })); } catch (e) {}
    } catch (err) {
        try { list = JSON.parse(localStorage.getItem(cacheKey))?.data; } catch (e) {}
        if (!Array.isArray(list)) { console.warn("Partner games list unavailable", url, err); return []; }
    }
    return list;
}
async function loadPartners() {
    const [famobi, playgama] = await Promise.all([
        loadPartnerList(PARTNER_LIST_URL, PARTNER_CACHE_KEY),
        loadPartnerList(PLAYGAMA_LIST_URL, PLAYGAMA_CACHE_KEY)
    ]);
    const ok = v => /^[a-z0-9][a-z0-9-]*$/.test(String(v || ""));
    const zonesOut = [
        ...famobi.filter(p => p && isPartnerZone(p.id) && p.name && ok(p.pkg)).map(toPartnerZone),
        ...playgama.filter(p => p && p.provider === "playgama" && isPartnerZone(p.id) && p.name && ok(p.slug)).map(toPartnerZone)
    ];
    if (!getStoredHidePartner()) checkPartnerReachable(zonesOut);
    return zonesOut;
}

// Small "AD" badge used on cards, the player header and the info panel
function makeAdBadge(extraClass) {
    const b = document.createElement("div");
    b.className = "card-ad" + (extraClass ? " " + extraClass : "");
    b.textContent = "AD";
    b.title = "Partner game: it may show ads from the site it comes from (html5games.com or Playgama). GN 2.0 adds no ads.";
    b.setAttribute("aria-label", "May contain ads");
    return b;
}

// Partner games are pages on another site, so they get their own frame that
// points at Famobi instead of having the page written into it. The sandbox lets
// the game (and its ads) run and open new tabs, but never navigate GN 2.0 away.
function openPartnerFrame(zone) {
    const url = partnerPlayUrl(zone);
    if (!url) throw new Error("bad partner game address");
    if (zoneFrame && zoneFrame.parentNode) zoneFrame.parentNode.removeChild(zoneFrame);
    zoneFrame = document.createElement("iframe");
    zoneFrame.id = "zoneFrame";
    zoneFrame.dataset.partner = "1";
    zoneFrame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock allow-orientation-lock");
    zoneFrame.setAttribute("allow", "autoplay; fullscreen; gamepad; clipboard-write; screen-wake-lock");
    zoneFrame.setAttribute("allowfullscreen", "");
    zoneFrame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    zoneFrame.title = zone.name;
    zoneFrame.src = url;
    zoneViewer.appendChild(zoneFrame);
}

// The next normal game needs a plain frame again (its page is written into it)
function resetFrameAfterPartner() {
    if (!zoneFrame || !zoneFrame.dataset || !zoneFrame.dataset.partner) return;
    if (zoneFrame.parentNode) zoneFrame.parentNode.removeChild(zoneFrame);
    zoneFrame = document.createElement("iframe");
    zoneFrame.id = "zoneFrame";
    zoneViewer.appendChild(zoneFrame);
    if (typeof attachPanicKeyToFrame === "function") zoneFrame.addEventListener("load", attachPanicKeyToFrame);
}

function setPartnerNotice(zone) {
    const el = document.getElementById("zoneAdNotice");
    if (!el) return;
    el.hidden = !(zone && isPartnerZone(zone));
    if (!el.hidden) {
        const p = PARTNER_PROVIDERS[partnerProvider(zone)];
        const text = el.lastChild && el.lastChild.nodeType === 3 ? el.lastChild : el.appendChild(document.createTextNode(""));
        text.textContent = " May contain ads from " + p.name;
        el.title = `This partner game is loaded from ${p.name}. It may show their ads. GN 2.0 doesn't add ads or get paid for them.`;
    }
}

// Game info panel for a partner game
function showPartnerInfo(zone) {
    const body = document.getElementById("popupBody");
    document.getElementById("popupTitle").textContent = `${zone.name} Info`;
    const esc = typeof escapeHtmlText === "function" ? escapeHtmlText : s => String(s ?? "");
    const play = partnerPlayUrl(zone) || "";
    const p = PARTNER_PROVIDERS[partnerProvider(zone)];
    const isPg = partnerProvider(zone) === "playgama";
    body.innerHTML = `
        <p>${esc(zone.description || "")}</p>
        <p>
        <b>Made by</b>: ${isPg ? `its developer (<a href="${esc(zone.authorLink)}" target="_blank" rel="noopener">game page on Playgama</a>)` : `<a href="https://famobi.com/" target="_blank" rel="noopener">Famobi</a>`}<br>
        <b>From</b>: <a href="${p.site}" target="_blank" rel="noopener">${esc(p.name)}</a><br>
        ${zone.category ? `<b>Category</b>: ${esc(toTitleCase(zone.category))}<br>` : ""}
        <b>Plays from</b>: <code>${esc(play.replace(/^https:\/\//, ""))}</code>
        </p>
        <p class="partner-info-note"><span class="ad-badge" aria-hidden="true">AD</span>
        This is a <b>partner game</b>. ${esc(p.name)} lets websites share its games for free, and the games pay for themselves with ads.
        So this game loads from ${esc(p.host)} and <b>may show ads</b>, and ${esc(p.name)} and its ad partners may use cookies or similar tech
        (see the privacy policy on <a href="${p.makerSite}" target="_blank" rel="noopener">${esc(p.makerSite.replace(/^https:\/\/|\/$/g, ""))}</a>).
        GN 2.0 doesn't add ads, doesn't get paid for them and doesn't share anything about you with them.
        You can hide all partner games with the switch above All games.</p>`;
}

// ── Blocked networks ────────────────────────────────────────────────────────
// Many school filters block game sites like html5games.com or playgama.com. Then
// those partner games can't load at all (we may only link to them, not copy
// them), so the site checks once per platform whether it can be reached and
// hides that platform's games if not.
const blockedProviders = new Set(); // platforms that couldn't be reached from this network
let partnerBlockOverride = false;   // the visitor chose to show them anyway
function checkPartnerReachable(list) {
    for (const prov of Object.keys(PARTNER_PROVIDERS)) {
        const sample = (list || []).find(z => partnerProvider(z) === prov && z.cover && !z.thumbGuessed);
        if (!sample) continue;
        const img = new Image();
        let done = false;
        const finish = ok => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (ok || blockedProviders.has(prov)) return;
            blockedProviders.add(prov);
            if (typeof scheduleFullRefresh === "function") scheduleFullRefresh();
            else if (typeof refreshVisibleZones === "function") refreshVisibleZones();
            updatePartnerToggle();
        };
        const timer = setTimeout(() => finish(false), 10000);
        img.onload = () => finish(img.naturalWidth > 0);
        img.onerror = () => finish(false);
        img.src = sample.cover + (sample.cover.includes("?") ? "&" : "?") + "probe=" + Date.now();
    }
}
function partnerHiddenByBlock(zone) {
    if (partnerBlockOverride) return false;
    if (zone) return blockedProviders.has(partnerProvider(zone));
    return blockedProviders.size > 0;
}
// Used by the game list (filters.js): is this partner game hidden right now?
function isPartnerHidden(zone) { return getStoredHidePartner() || partnerHiddenByBlock(zone); }

// ── Partner games on/off ────────────────────────────────────────────────────
const HIDE_PARTNER_KEY = "gnmath-hide-partner-games";
function getStoredHidePartner() { try { return localStorage.getItem(HIDE_PARTNER_KEY) === "true"; } catch { return false; } }
function getHidePartner() { return getStoredHidePartner(); }
function updatePartnerToggle() {
    const btn = document.getElementById("partnerToggle");
    if (!btn) return;
    const shown = !getHidePartner();
    const all = typeof ZONES_ALL !== "undefined" && ZONES_ALL ? ZONES_ALL : [];
    const n = all.filter(isPartnerZone).length;
    const row = document.getElementById("partnerToggleRow");
    if (row) row.hidden = n === 0;
    btn.setAttribute("aria-checked", shown ? "true" : "false");
    btn.classList.toggle("on", shown);
    const blocked = shown ? [...blockedProviders].filter(() => !partnerBlockOverride) : [];
    const visible = all.filter(z => isPartnerZone(z) && !isPartnerHidden(z)).length;
    const names = blocked.map(p => PARTNER_PROVIDERS[p].name).join(" and ");
    document.getElementById("partnerToggleLabel").textContent = !shown
        ? `Partner games: hidden${n ? ` (${n.toLocaleString()})` : ""}`
        : blocked.length
            ? (visible ? `Partner games: ${visible.toLocaleString()} shown, ${names} seems blocked on this network` : `Partner games: hidden, ${names} seems blocked on this network`)
            : `Partner games: shown${n ? ` (${n.toLocaleString()})` : ""}`;
    btn.title = blocked.length ? "Show them anyway (the blocked ones probably won't load here)"
        : shown ? "Hide the partner games (they may have ads)" : "Show the partner games (they may have ads)";
    const srcOpt = document.querySelector('#sourceOptions option[value="partner"]');
    if (srcOpt) srcOpt.hidden = !shown || n === 0;
}
function togglePartnerGames() {
    if (!getStoredHidePartner() && partnerHiddenByBlock()) {
        partnerBlockOverride = true;
        try { localStorage.setItem(HIDE_PARTNER_KEY, "false"); } catch {}
        if (typeof refreshVisibleZones === "function") refreshVisibleZones();
        updatePartnerToggle();
        notify("All partner games are shown, but some of their sites look blocked on this network, so those probably won't load.", { type: "info" });
        return;
    }
    const hide = !getHidePartner();
    try { localStorage.setItem(HIDE_PARTNER_KEY, hide ? "true" : "false"); } catch {}
    const src = document.getElementById("sourceOptions");
    if (hide && src && src.value === "partner") src.value = "all";
    if (typeof refreshVisibleZones === "function") refreshVisibleZones();
    updatePartnerToggle();
    notify(hide ? "Partner games are hidden. Turn them back on above All games." : "Partner games are shown again. They may have ads.", { type: "success" });
}
document.addEventListener("DOMContentLoaded", updatePartnerToggle);
