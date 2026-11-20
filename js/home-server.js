// ═════════════════════════════════════════════════════════════════════════════
// Home server: Lincoln's spare PC, reached at data.learnresearch.org through a
// Cloudflare tunnel. The site never needs it; it's a backup that:
//   - is the last-resort source for game files and game lists (the "home"
//     mirror in app.js, same address shape as jsDelivr: /gh/owner/repo@ref/path)
//   - counts plays on this site (/api/play)
//   - keeps a full copy of the site at its own address, in case this one is
//     taken down
// Home upload is only ~20 Mbps, so other sources are always tried first.
// ═════════════════════════════════════════════════════════════════════════════
const HOME_VISITOR_KEY = "gnmath-home-visitor";
let homeServerState = { level: "info", detail: "Checking…" };

async function checkHomeServer() {
    try {
        const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(HOME_SERVER + "/health?t=" + Date.now(), { signal: ctrl.signal, cache: "no-store" }).finally(() => clearTimeout(t));
        const j = res.ok ? await res.json() : null;
        homeServerState = j && j.ok
            ? { level: "ok", detail: "Online (cloud saves, play counts and backup game source)" }
            : { level: "info", detail: "Not answering right now. The site works fine without it." };
    } catch {
        homeServerState = { level: "info", detail: "Can't reach it from this network. The site works fine without it." };
    }
    if (typeof updateSiteStatus === "function") updateSiteStatus();
}
// Never makes the status light worse: the site doesn't depend on it
function homeServerCheck() { return homeServerState; }

// A random id per browser (not tied to an account), so the server can ignore
// one person opening the same game over and over. Players at school share an
// IP address, so the address alone can't tell them apart.
function homeVisitorId() {
    try {
        let v = localStorage.getItem(HOME_VISITOR_KEY);
        if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(HOME_VISITOR_KEY, v); }
        return v;
    } catch { return ""; }
}
// sendBeacon with plain text is a "simple" request: no CORS preflight, and it
// still goes out if the page closes right after
function sendHomePlay(id) {
    try {
        const body = new Blob([JSON.stringify({ id: String(id), v: homeVisitorId() })], { type: "text/plain" });
        if (navigator.sendBeacon) navigator.sendBeacon(HOME_SERVER + "/api/play", body);
        else fetch(HOME_SERVER + "/api/play", { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
    } catch {}
}

checkHomeServer();
setInterval(checkHomeServer, 5 * 60 * 1000);

// ── Games that won't load for real players ──────────────────────────────────
// When a game crashes or never starts (game-error.js), the site tells the GN
// 2.0 Server. If 3+ different people hit it within a day and it fails for a
// big share of its plays, the server flags it, and its card shows
// "Not loading for many". Lost graphics aren't sent: that's the computer
// running low on memory, not the game.
const AUTO_BROKEN_KEY = "gnmath-auto-broken";
let autoBroken = (() => { try { return JSON.parse(localStorage.getItem(AUTO_BROKEN_KEY) || "null") || { at: 0, ids: {} }; } catch { return { at: 0, ids: {} }; } })();
function reportGameTrouble(id, kind, msg) {
    if (kind === "graphics" || !id) return;
    try {
        const body = new Blob([JSON.stringify({ id: String(id), kind: String(kind || "crash"), msg: String(msg || "").slice(0, 200), v: homeVisitorId() })], { type: "text/plain" });
        if (navigator.sendBeacon) navigator.sendBeacon(HOME_SERVER + "/api/game-report", body);
        else fetch(HOME_SERVER + "/api/game-report", { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
    } catch {}
}
function autoBrokenInfo(id) { return autoBroken.ids[String(id)] || null; }
function autoBrokenBadge(id) {
    const g = autoBrokenInfo(id);
    if (!g) return null;
    const el = document.createElement("div");
    el.className = "card-flag card-autoflag";
    el.innerHTML = `${typeof gnIcon === "function" ? gnIcon("warning") : "⚠"} Not loading for many`;
    el.title = `${g.people} players couldn't get this game to load in the last day. It may not work right now.`;
    return el;
}
function applyAutoBrokenFlags() {
    document.querySelectorAll(".zone-item[data-id]").forEach(card => {
        const old = card.querySelector(".card-autoflag");
        const has = !!autoBrokenInfo(card.dataset.id);
        if (!has) { if (old) old.remove(); return; }
        if (old || card.querySelector(".card-flag")) return;   // already flagged by reports
        let box = card.querySelector(".card-badges");
        if (!box) { box = document.createElement("div"); box.className = "card-badges"; card.appendChild(box); }
        const b = autoBrokenBadge(card.dataset.id);
        if (b) box.appendChild(b);
    });
}
async function loadGameHealth() {
    try {
        const res = await fetch(HOME_SERVER + "/api/game-health");
        if (!res.ok) return;
        const j = await res.json();
        autoBroken = { at: Date.now(), ids: Object.fromEntries((j.flagged || []).map(g => [String(g.id), { people: g.people, rate: g.rate }])) };
        try { localStorage.setItem(AUTO_BROKEN_KEY, JSON.stringify(autoBroken)); } catch {}
        applyAutoBrokenFlags();
    } catch {}
}
setTimeout(loadGameHealth, 6000);
setInterval(() => { if (!document.hidden) loadGameHealth(); }, 10 * 60 * 1000);

// ── Is Cloudflare caching the server's game files? ─────────────────────────
// With a Cloudflare cache rule for data.learnresearch.org/gh/*, Cloudflare
// keeps each game file after the first download, so the PC's upload speed no
// longer matters. A small file is asked for twice: if Cloudflare says it was
// cached (or stored it), the server is promoted to the second game source
// (promoteHomeMirror in app.js). Remembered for 6 hours.
const HOME_CACHED_KEY = "gnmath-home-cached";
async function checkHomeCached() {
    try {
        const saved = JSON.parse(localStorage.getItem(HOME_CACHED_KEY) || "null");
        if (saved && Date.now() - saved.at < 6 * 3600000) { window.gnHomeCached = saved.on; if (saved.on && typeof promoteHomeMirror === "function") promoteHomeMirror(); return; }
    } catch {}
    let on = false;
    try {
        const url = HOME_SERVER + "/gh/SCHSwork/math@main/manifest.json";
        for (let i = 0; i < 2 && !on; i++) {
            const res = await fetch(url, { cache: "no-store" });
            const st = (res.headers.get("cf-cache-status") || "").toUpperCase();
            on = res.ok && /^(HIT|MISS|EXPIRED|REVALIDATED|UPDATING|STALE)$/.test(st);
        }
    } catch {}
    window.gnHomeCached = on;
    try { localStorage.setItem(HOME_CACHED_KEY, JSON.stringify({ at: Date.now(), on })); } catch {}
    if (on && typeof promoteHomeMirror === "function") promoteHomeMirror();
}
setTimeout(checkHomeCached, 8000);
