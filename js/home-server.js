// ═════════════════════════════════════════════════════════════════════════════
// Home server: the owner's spare PC, reached at data.learnresearch.org through a
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
            ? { level: "ok", detail: "Online (backup game source and site copy)" }
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
