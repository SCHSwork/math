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

// ── Jumpscare (just for fun; Admin Panel → Sessions) ────────────────────────
// A face of our own (drawn here, no characters from anything) lunges at the
// screen with a scream made on the spot by the browser, for about 1.5 s.
// No flashing (it's safe for people sensitive to flashing lights), and the
// sound is kept to a sensible volume.
const SCARE_FACE = `<svg viewBox="0 0 200 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs><radialGradient id="gnsk" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#d9d3c2"/><stop offset=".55" stop-color="#8a8370"/><stop offset="1" stop-color="#141210"/></radialGradient>
  <radialGradient id="gnse" cx="50%" cy="55%" r="55%"><stop offset="0" stop-color="#000"/><stop offset=".8" stop-color="#000"/><stop offset="1" stop-color="#2b0a06"/></radialGradient>
  <radialGradient id="gnsp" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff2c0"/><stop offset=".35" stop-color="#ff3b1f"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/></radialGradient></defs>
  <path d="M100 4C42 4 14 54 16 110c2 50 22 88 42 112 15 18 28 34 42 34s27-16 42-34c20-24 40-62 42-112 2-56-26-106-84-106Z" fill="url(#gnsk)"/>
  <path d="M30 104c4-26 24-40 46-32 10 4 12 30 2 48-11 20-38 22-46 4-3-6-3-13-2-20ZM170 104c-4-26-24-40-46-32-10 4-12 30-2 48 11 20 38 22 46 4 3-6 3-13 2-20Z" fill="url(#gnse)"/>
  <circle cx="58" cy="104" r="9" fill="url(#gnsp)"/><circle cx="142" cy="104" r="9" fill="url(#gnsp)"/>
  <circle cx="58" cy="104" r="2.4" fill="#fff"/><circle cx="142" cy="104" r="2.4" fill="#fff"/>
  <path d="M94 136l6-20 6 20-6 5Z" fill="#0b0a08"/>
  <path d="M44 158c16 6 36 9 56 9s40-3 56-9c-2 52-26 90-56 90s-54-38-56-90Z" fill="#0a0000"/>
  <path d="M46 160l6 20 6-18 6 22 6-20 6 24 6-22 6 24 6-24 6 22 6-24 6 22 6-20 6 18 6-20 6 18 4-16Z" fill="#e6dfc8"/>
  <path d="M56 236l6-22 6 18 6-24 6 22 6-26 6 24 6-24 6 22 6-24 6 18 6-20 6 22 4-14c-8 14-24 24-38 24s-30-10-36-16Z" fill="#cfc7ae"/>
  <path d="M78 30l8 18-6 14 10 12M136 40l-6 16 8 10-4 14M24 150l14 6 4 14" fill="none" stroke="#2a251c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
</svg>`;
function scareSound() {
    try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        const ctx = new C();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const t = ctx.currentTime, len = 1.3;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
        out.gain.exponentialRampToValueAtTime(0.0001, t + len);
        out.connect(ctx.destination);
        // A screech: two rough tones sliding down, plus hiss
        [[880, 260, "sawtooth"], [1240, 410, "square"]].forEach(([a, z, type]) => {
            const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
            o.type = type; o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(z, t + len);
            lfo.frequency.value = 38; lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency);
            g.gain.value = 0.35; o.connect(g); g.connect(out);
            o.start(t); lfo.start(t); o.stop(t + len); lfo.stop(t + len);
        });
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        n.buffer = buf; bp.type = "bandpass"; bp.frequency.value = 2200; bp.Q.value = 0.8; ng.gain.value = 0.5;
        n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t);
        setTimeout(() => ctx.close().catch(() => {}), (len + 0.3) * 1000);
    } catch {}
}
function gnJumpscare() {
    const build = doc => {
        const el = doc.createElement("div");
        el.className = "gn-scare";
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#000;display:grid;place-items:center;overflow:hidden;cursor:none;";
        el.innerHTML = `<style>@keyframes gnScareIn{0%{transform:scale(.25)}12%{transform:scale(1.18)}20%{transform:scale(1.05) translate(-6px,4px)}28%{transform:scale(1.1) translate(6px,-4px)}36%{transform:scale(1.07) translate(-4px,-3px)}44%,100%{transform:scale(1.1)}}</style>` +
            `<div style="width:min(92vw,92vh);height:min(92vw,92vh);animation:gnScareIn 1.4s cubic-bezier(.2,1.6,.4,1) forwards;">${SCARE_FACE}</div>`;
        doc.documentElement.appendChild(el);
        setTimeout(() => { el.style.transition = "opacity .25s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 1500);
    };
    try {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (fs && fs.tagName === "IFRAME" && fs.contentDocument) build(fs.contentDocument);
        else if (fs && fs !== document.documentElement) { build(document); fs.appendChild(document.querySelector(".gn-scare:last-of-type")); }
        else build(document);
    } catch { build(document); }
    scareSound();
}
