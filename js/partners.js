// ═════════════════════════════════════════════════════════════════════════════
// Partner games: free games from html5games.com (made and hosted by Famobi).
// html5games.com lets any website link its games for free; in return the games
// show Famobi's own ads. So unlike every other game here, these:
//   • load straight from Famobi's servers (play.famobi.com), not from GitHub,
//   • can't have their ads removed, and Famobi's ad partners may use cookies,
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

function isPartnerZone(zoneOrId) {
    const id = zoneOrId && typeof zoneOrId === "object" ? zoneOrId.id : zoneOrId;
    const n = Number(id);
    return n >= PARTNER_ID_BASE && n < PARTNER_ID_BASE + 100000;
}

function partnerPlayUrl(zone) {
    const pkg = String(zone.pkg || "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg)) return null;
    return `https://play.famobi.com/${pkg}/${PARTNER_LINK_CODE}`;
}

function toPartnerZone(p) {
    return {
        id: Number(p.id),
        name: p.name,
        pkg: p.pkg,
        author: "Famobi",
        authorLink: "https://html5games.com/",
        url: "partner:" + p.pkg,
        cover: p.thumb && /^[\w.-]+\.(jpe?g|png|webp)$/i.test(p.thumb) ? PARTNER_THUMB_BASE + p.thumb : "",
        description: p.description || "",
        category: p.category || "",
        special: [PARTNER_TAG, ...(p.category ? [String(p.category).toLowerCase()] : [])],
        thumbGuessed: !!p.thumbGuessed,
        libraryDuplicate: !!p.libraryDuplicate
    };
}

async function loadPartners() {
    let list = null;
    try {
        const res = await fetch(PARTNER_LIST_URL + "?t=" + Math.floor(Date.now() / 600000), { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        list = await res.json();
        if (!Array.isArray(list)) throw new Error("bad partner list");
        try { localStorage.setItem(PARTNER_CACHE_KEY, JSON.stringify({ t: Date.now(), data: list })); } catch (e) {}
    } catch (err) {
        try { list = JSON.parse(localStorage.getItem(PARTNER_CACHE_KEY))?.data; } catch (e) {}
        if (!Array.isArray(list)) { console.warn("Partner games list unavailable", err); return []; }
    }
    const zonesOut = list
        .filter(p => p && isPartnerZone(p.id) && p.name && /^[a-z0-9][a-z0-9-]*$/.test(String(p.pkg || "")))
        .map(toPartnerZone);
    if (!getStoredHidePartner()) checkPartnerReachable(zonesOut);
    return zonesOut;
}

// Small "AD" badge used on cards, the player header and the info panel
function makeAdBadge(extraClass) {
    const b = document.createElement("div");
    b.className = "card-ad" + (extraClass ? " " + extraClass : "");
    b.textContent = "AD";
    b.title = "Partner game from html5games.com: it may show ads from its publisher. GN 2.0 adds no ads.";
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
    zoneFrame.setAttribute("allow", "autoplay; fullscreen; gamepad");
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
    if (el) el.hidden = !(zone && isPartnerZone(zone));
}

// Game info panel for a partner game
function showPartnerInfo(zone) {
    const body = document.getElementById("popupBody");
    document.getElementById("popupTitle").textContent = `${zone.name} Info`;
    const esc = typeof escapeHtmlText === "function" ? escapeHtmlText : s => String(s ?? "");
    const play = partnerPlayUrl(zone) || "";
    body.innerHTML = `
        <p>${esc(zone.description || "")}</p>
        <p>
        <b>Made by</b>: <a href="https://famobi.com/" target="_blank" rel="noopener">Famobi</a><br>
        <b>From</b>: <a href="https://html5games.com/" target="_blank" rel="noopener">html5games.com</a><br>
        ${zone.category ? `<b>Category</b>: ${esc(toTitleCase(zone.category))}<br>` : ""}
        <b>Plays from</b>: <code>${esc(play.replace(/^https:\/\//, ""))}</code>
        </p>
        <p class="partner-info-note"><span class="ad-badge" aria-hidden="true">AD</span>
        This is a <b>partner game</b>. html5games.com lets websites share its games for free, and the games pay for themselves with ads.
        So this game loads from Famobi's servers and <b>may show ads</b>, and Famobi and its ad partners may use cookies or similar tech
        (their privacy policy is linked at the bottom of <a href="https://famobi.com/" target="_blank" rel="noopener">famobi.com</a>).
        GN 2.0 doesn't add ads, doesn't get paid for them and doesn't share anything about you with Famobi.
        You can hide all partner games with the switch above All games.</p>`;
}

// ── Blocked networks ────────────────────────────────────────────────────────
// Many school filters block game sites like html5games.com/famobi.com. Then the
// partner games can't load at all (we may only link to them, not copy them), so
// the site checks once whether Famobi can be reached and hides them if not.
let partnerBlocked = false;        // Famobi couldn't be reached from this network
let partnerBlockOverride = false;  // the visitor chose to show them anyway
function checkPartnerReachable(list) {
    const sample = (list || []).find(z => z.cover && !z.thumbGuessed);
    if (!sample) return;
    const img = new Image();
    let done = false;
    const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok || partnerBlocked) return;
        partnerBlocked = true;
        if (typeof refreshVisibleZones === "function") refreshVisibleZones();
        updatePartnerToggle();
    };
    const timer = setTimeout(() => finish(false), 10000);
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    img.src = sample.cover + (sample.cover.includes("?") ? "&" : "?") + "probe=" + Date.now();
}
function partnerHiddenByBlock() { return partnerBlocked && !partnerBlockOverride; }

// ── Partner games on/off ────────────────────────────────────────────────────
const HIDE_PARTNER_KEY = "gnmath-hide-partner-games";
function getStoredHidePartner() { try { return localStorage.getItem(HIDE_PARTNER_KEY) === "true"; } catch { return false; } }
function getHidePartner() { return partnerHiddenByBlock() || getStoredHidePartner(); }
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
    const blocked = partnerHiddenByBlock();
    document.getElementById("partnerToggleLabel").textContent = blocked
        ? "Partner games: hidden, html5games.com seems blocked on this network"
        : `Partner games: ${shown ? "shown" : "hidden"}${n ? ` (${n.toLocaleString()})` : ""}`;
    btn.title = blocked ? "Show them anyway (they probably won't load here)"
        : shown ? "Hide the partner games (they may have ads)" : "Show the partner games (they may have ads)";
    const srcOpt = document.querySelector('#sourceOptions option[value="partner"]');
    if (srcOpt) srcOpt.hidden = !shown || n === 0;
}
function togglePartnerGames() {
    if (partnerHiddenByBlock()) {
        partnerBlockOverride = true;
        try { localStorage.setItem(HIDE_PARTNER_KEY, "false"); } catch {}
        if (typeof refreshVisibleZones === "function") refreshVisibleZones();
        updatePartnerToggle();
        notify("Partner games are shown, but html5games.com looks blocked on this network, so they probably won't load.", { type: "info" });
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
