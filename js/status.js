// ═════════════════════════════════════════════════════════════════════════════
// Site status light in the bottom-left corner. It checks the parts of the site
// it can see from this browser (game sources, game lists, accounts, partner
// sites, the internet connection) and sums them up as one colored light.
// Clicking it lists each part. The owner can set a status by hand in the
// Owner Panel (synced to everyone) for things it can't detect.
// ═════════════════════════════════════════════════════════════════════════════
const SHOW_STATUS_KEY = "gnmath-show-site-status";
const STATUS_RANK = { ok: 0, info: 0, loading: 0, maintenance: 1, degraded: 2, down: 3 };
const STATUS_HEADLINES = {
    ok: "All systems normal",
    loading: "Checking…",
    maintenance: "Maintenance",
    degraded: "Running with some issues",
    down: "Major outage"
};
const MIRROR_NAMES = { jsdelivr: "jsDelivr", github: "GitHub", githack: "githack" };

function getShowSiteStatus() { try { return localStorage.getItem(SHOW_STATUS_KEY) !== "false"; } catch { return true; } }
function setShowSiteStatus(on) {
    try { localStorage.setItem(SHOW_STATUS_KEY, on ? "true" : "false"); } catch {}
    updateSiteStatus();
}

// One row per part of the site: { name, level, detail }
function collectStatusChecks() {
    const checks = [];
    const online = navigator.onLine !== false;
    checks.push(online
        ? { name: "Your connection", level: "ok", detail: "Online" }
        : { name: "Your connection", level: "down", detail: "You're offline. Games you've opened before may still work." });

    // Main game library: three sources plus the saved game list
    const down = typeof mirrorDown !== "undefined" ? [...mirrorDown] : [];
    const listState = typeof libraryListState !== "undefined" ? libraryListState : "live";
    let lib;
    if (listState === "failed") lib = { level: "down", detail: "Can't reach any game source from this network." };
    else if (down.length >= 3) lib = { level: "degraded", detail: "All 3 game sources are having trouble, so some games or covers may not load." };
    else if (listState === "cache") lib = { level: "degraded", detail: "Using the game list saved on this device. Some games may not load." };
    else if (down.length) lib = { level: "degraded", detail: `Running on backup sources (${down.map(m => MIRROR_NAMES[m] || m).join(", ")} unreachable).` };
    else if (listState === "loading") lib = { level: "loading", detail: "Loading the game list…" };
    else lib = { level: "ok", detail: "All 3 game sources working" };
    checks.push({ name: "Game library", ...lib });

    const og = typeof originalsState !== "undefined" ? originalsState : "live";
    checks.push({
        name: "GN Originals",
        level: og === "failed" ? "degraded" : og === "cache" ? "degraded" : og === "loading" ? "loading" : "ok",
        detail: og === "failed" ? "Couldn't load the GN Originals list." : og === "cache" ? "Using the list saved on this device." : og === "loading" ? "Loading…" : "Working"
    });

    // Accounts and cloud saves (Firebase)
    const cloudFail = typeof cloudStatus === "string" && /couldn't load/i.test(cloudStatus);
    const cloudOk = typeof cloudDb !== "undefined" && cloudDb;
    checks.push({
        name: "Accounts & cloud saves",
        level: cloudFail ? "degraded" : cloudOk ? "ok" : "loading",
        detail: cloudFail ? "Couldn't connect. Games still work and save on this device." : cloudOk ? "Working" : "Connecting…"
    });

    // Partner sites are often blocked by school filters, which is expected, so
    // this row never turns the light yellow.
    if (typeof blockedProviders !== "undefined" && typeof PARTNER_PROVIDERS !== "undefined") {
        const blocked = [...blockedProviders].map(p => PARTNER_PROVIDERS[p]?.name || p);
        checks.push({
            name: "Partner games",
            level: blocked.length ? "info" : "ok",
            detail: blocked.length ? `${blocked.join(" and ")} blocked on this network, so those games are hidden.` : "Available"
        });
    }

    if (typeof syncPaceSummary === "function") checks.push({ name: "Live updates", ...syncPaceSummary() });
    if (typeof fbPaceSummary === "function" && typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG) {
        checks.push({ name: "Database use", ...fbPaceSummary() });
    }

    checks.push({ name: "Game protection", level: "ok", detail: "Library locked to the checked, clean version" });
    return checks;
}

// Sources marked down earlier get re-checked (at most once a minute each), so
// the light matches what's actually reachable right now.
function recheckDownMirrors() {
    if (typeof mirrorDown === "undefined" || typeof suspectMirror !== "function") return;
    for (const name of [...mirrorDown]) suspectMirror(name);
}

function computeSiteStatus() {
    const checks = collectStatusChecks();
    const override = typeof getStatusOverride === "function" ? getStatusOverride() : { level: "auto", text: "" };
    let level = "ok";
    for (const c of checks) if (STATUS_RANK[c.level] > STATUS_RANK[level]) level = c.level;
    const stillLoading = checks.some(c => c.level === "loading");
    if (level === "ok" && stillLoading) level = "loading";
    let headline = STATUS_HEADLINES[level];
    if (!navigator.onLine) headline = "You're offline";
    const auto = { level, headline };
    if (override.level !== "auto") {
        level = override.level;
        headline = override.text.trim() || STATUS_HEADLINES[level];
    } else if (override.text.trim()) {
        headline = override.text.trim();
    }
    return { level, headline, checks, auto, override };
}

function ensureStatusPill() {
    let pill = document.getElementById("siteStatus");
    if (pill) return pill;
    pill = document.createElement("div");
    pill.id = "siteStatus";
    pill.innerHTML = `
        <button type="button" class="status-pill" aria-expanded="false" aria-controls="statusPanel">
            <span class="status-dot" aria-hidden="true"></span>
            <span class="status-text"></span>
            <span class="status-online" hidden></span>
        </button>
        <div class="status-panel" id="statusPanel" role="dialog" aria-label="Site status" hidden>
            <div class="status-panel-head">
                <span class="status-dot" aria-hidden="true"></span>
                <div><div class="status-panel-title"></div><div class="status-panel-sub"></div></div>
                <button type="button" class="status-panel-close" aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </div>
            <ul class="status-list"></ul>
            <div class="status-panel-foot">
                <span class="status-checked"></span>
                <button type="button" class="status-hide">Hide this light</button>
            </div>
        </div>`;
    document.body.appendChild(pill);
    const btn = pill.querySelector(".status-pill");
    const panel = pill.querySelector(".status-panel");
    const setOpen = open => {
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        pill.classList.toggle("open", open);
        if (open) { updateSiteStatus(); if (typeof refreshActiveUsers === "function") refreshActiveUsers(); }
    };
    btn.onclick = () => setOpen(panel.hidden);
    pill.querySelector(".status-panel-close").onclick = () => setOpen(false);
    pill.querySelector(".status-hide").onclick = () => {
        setOpen(false);
        setShowSiteStatus(false);
        if (typeof notify === "function") notify("Status light hidden. Turn it back on in Settings.");
    };
    document.addEventListener("click", e => { if (!panel.hidden && !pill.contains(e.target)) setOpen(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) setOpen(false); });
    return pill;
}

let statusLastRender = 0;
function updateSiteStatus() {
    const pill = ensureStatusPill();
    const playing = typeof zoneViewer !== "undefined" && zoneViewer && zoneViewer.style.display === "flex";
    const closed = !!document.getElementById("owner-site-overlay");
    pill.hidden = !getShowSiteStatus() || playing || closed;
    if (pill.hidden) return;
    // Sit just above the fixed footer
    const footer = document.querySelector("footer");
    const fh = footer && getComputedStyle(footer).position === "fixed" ? footer.offsetHeight : 0;
    pill.style.bottom = (fh + 12) + "px";

    recheckDownMirrors();
    const s = computeSiteStatus();
    pill.dataset.level = s.level;
    const au = window.gnActiveUsers || {};
    const online = typeof au.count === "number" ? au.count : null;
    pill.querySelector(".status-text").textContent = s.headline;
    const oc = pill.querySelector(".status-online");
    oc.hidden = online === null;
    if (online !== null) oc.textContent = online.toLocaleString() + " online";
    pill.querySelector(".status-pill").title = "Site status: " + s.headline + " (click for details)";
    statusLastRender = Date.now();

    const panel = pill.querySelector(".status-panel");
    if (panel.hidden) return;
    panel.querySelector(".status-panel-title").textContent = s.headline;
    panel.querySelector(".status-panel-sub").textContent = s.override.level !== "auto"
        ? "Status set by the owner"
        : "How GN 2.0 is working on this network";
    const list = panel.querySelector(".status-list");
    list.innerHTML = "";
    if (online !== null) {
        const li = document.createElement("li");
        li.className = "status-people";
        const mins = Math.round((Date.now() - au.at) / 60000);
        li.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.2c2.4.2 4 1.8 4.5 4.3"/></svg>
            <div><b></b><span></span></div>`;
        li.querySelector("b").textContent = `${online.toLocaleString()} ${online === 1 ? "person" : "people"} online now`;
        li.querySelector("div span").textContent = "On GN 2.0 in the last 5 minutes" + (mins >= 1 ? ` · counted ${mins} min ago` : "");
        list.appendChild(li);
    }
    if (s.override.level !== "auto" || s.override.text.trim()) {
        const li = document.createElement("li");
        li.className = "status-row status-owner-note";
        li.dataset.level = s.override.level === "auto" ? "info" : s.override.level;
        li.innerHTML = `<span class="status-row-dot"></span><div><b>Note from the owner</b><span></span></div>`;
        li.querySelector("div span").textContent = s.override.text.trim() || STATUS_HEADLINES[s.override.level];
        list.appendChild(li);
    }
    for (const c of s.checks) {
        const li = document.createElement("li");
        li.className = "status-row";
        li.dataset.level = c.level;
        li.innerHTML = `<span class="status-row-dot"></span><div><b></b><span></span></div>`;
        li.querySelector("b").textContent = c.name;
        li.querySelector("div span").textContent = c.detail;
        list.appendChild(li);
    }
    panel.querySelector(".status-checked").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

window.addEventListener("online", updateSiteStatus);
window.addEventListener("offline", updateSiteStatus);
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateSiteStatus(); });
setInterval(() => { if (!document.hidden) updateSiteStatus(); }, 4000);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", updateSiteStatus);
else updateSiteStatus();
