// ═════════════════════════════════════════════════════════════════════════════
// "Find screen" (Admin Panel → Sessions): to tell which computer in the room is
// which session (same Chromebooks, same network), an admin can light up that
// session's screen. For 30 seconds it gets a thick glowing border in a color
// and a big "Screen 47", which the admin also sees next to the session, so
// they can walk around and spot it. The game keeps working underneath.
//
// The admin writes identify/<session id> { c: color, n: number, until, by, at };
// realtime.js listens to this session's doc and calls gnShowIdentify().
// ═════════════════════════════════════════════════════════════════════════════
const IDENTIFY_COLORS = {
    red: ["Red", "#ef4444"], orange: ["Orange", "#f97316"], yellow: ["Yellow", "#facc15"], green: ["Green", "#22c55e"],
    cyan: ["Light blue", "#22d3ee"], blue: ["Blue", "#3b82f6"], purple: ["Purple", "#a855f7"], pink: ["Pink", "#ec4899"]
};
const IDENTIFY_MS = 30000;

let identifyTimer = null;
function gnHideIdentify() {
    clearTimeout(identifyTimer);
    document.querySelectorAll(".gn-identify").forEach(el => el.remove());
    try {
        const f = typeof zoneFrame !== "undefined" && zoneFrame && zoneFrame.contentDocument;
        if (f) f.querySelectorAll(".gn-identify").forEach(el => el.remove());
    } catch {}
}
function gnShowIdentify({ c, n, until }) {
    const col = IDENTIFY_COLORS[c];
    const left = Math.min(IDENTIFY_MS + 5000, (until || 0) - Date.now());
    if (!col || !(n >= 1 && n <= 99) || left <= 0) return;
    gnHideIdentify();
    const [name, hex] = col;
    const dark = c === "yellow" || c === "cyan";
    const build = doc => {
        const el = doc.createElement("div");
        el.className = "gn-identify";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        // Inline styles: this may go inside a game page, where the site's CSS isn't
        el.style.cssText = `position:fixed;inset:0;z-index:2147483646;pointer-events:none;box-shadow:inset 0 0 0 14px ${hex}, inset 0 0 60px 18px ${hex}88;` +
            `animation:gnIdPulse 1s ease-in-out infinite;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;`;
        el.innerHTML = `<style>@keyframes gnIdPulse{50%{opacity:.55}}@media (prefers-reduced-motion:reduce){.gn-identify{animation:none!important}}</style>` +
            `<div style="position:absolute;left:50%;top:28px;transform:translateX(-50%);display:flex;align-items:center;gap:16px;padding:14px 26px 14px 18px;border-radius:20px;` +
            `background:${hex};color:${dark ? "#111" : "#fff"};box-shadow:0 12px 40px rgba(0,0,0,.45);white-space:nowrap;">` +
            `<span style="font-size:64px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums;">${n}</span>` +
            `<span style="display:flex;flex-direction:column;gap:2px;"><b style="font-size:22px;">${name} screen ${n}</b>` +
            `<span style="font-size:14px;opacity:.85;">A mod is finding this computer. Nothing's wrong.</span></span></div>`;
        return el;
    };
    document.body.appendChild(build(document));
    // A game in fullscreen covers the page, so it goes inside the game too
    try {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (fs && fs.tagName === "IFRAME" && fs.contentDocument) fs.contentDocument.documentElement.appendChild(build(fs.contentDocument));
        else if (fs && fs !== document.documentElement) fs.appendChild(build(document));
    } catch {}
    identifyTimer = setTimeout(gnHideIdentify, left);
}
