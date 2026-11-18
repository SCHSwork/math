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
// It flashes red twice at the start, slowly enough to stay under the safe
// limit for people sensitive to flashing lights (no more than 3 a second).
// pic: a picture link the admin added (Admin Panel → Sessions → Jumpscare
// pictures); one of the built-in faces if it's empty or doesn't load.
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
// Two more of our own, so it isn't the same one every time
const SCARE_FACES = [SCARE_FACE,
`<svg viewBox="0 0 200 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs><radialGradient id="gnsk2" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#b9c2b4"/><stop offset=".6" stop-color="#5d6658"/><stop offset="1" stop-color="#0d0f0c"/></radialGradient></defs>
  <path d="M100 2C58 2 34 40 34 92c0 40 8 76 22 108 12 28 28 58 44 58s32-30 44-58c14-32 22-68 22-108C166 40 142 2 100 2Z" fill="url(#gnsk2)"/>
  <ellipse cx="70" cy="104" rx="20" ry="30" fill="#000"/><ellipse cx="130" cy="104" rx="20" ry="30" fill="#000"/>
  <path d="M60 140c-2 14 0 30 6 40M140 140c2 14 0 30-6 40" stroke="#000" stroke-width="4" fill="none" opacity=".6"/>
  <ellipse cx="100" cy="206" rx="26" ry="44" fill="#000"/>
  <path d="M84 176c6-4 26-4 32 0M80 236c10 6 30 6 40 0" stroke="#3a0000" stroke-width="3" fill="none"/>
  <path d="M70 136l-4 26M130 136l4 26" stroke="#5a0000" stroke-width="3" stroke-linecap="round"/>
</svg>`,
`<svg viewBox="0 0 240 240" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs><radialGradient id="gnsk3" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#3a1a12"/><stop offset="1" stop-color="#000"/></radialGradient>
  <radialGradient id="gnse3" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff7b0"/><stop offset=".4" stop-color="#ffb000"/><stop offset="1" stop-color="#ff3000" stop-opacity="0"/></radialGradient></defs>
  <circle cx="120" cy="120" r="112" fill="url(#gnsk3)"/>
  ${[[78, 86, 15], [162, 86, 15], [104, 64, 9], [136, 64, 9], [120, 98, 11], [56, 112, 8], [184, 112, 8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * 1.8}" fill="url(#gnse3)"/><circle cx="${x}" cy="${y}" r="${r * .35}" fill="#000"/>`).join("")}
  <path d="M40 150c30 22 130 22 160 0-8 50-44 78-80 78s-72-28-80-78Z" fill="#050000"/>
  <path d="M42 152l10 26 9-22 10 30 10-28 10 32 9-30 10 32 10-32 9 30 10-32 10 28 10-30 9 22 10-26" fill="#d8ccb0"/>
</svg>`];
// The sound: a low drone that creeps up in the dark, then a distorted scream
// (several rough voices sliding down, a bandpassed hiss and a thump), pushed
// through a waveshaper and a compressor so it's as loud as it can be without
// crackling into nothing.
function scareSound(delayMs) {
    try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        const ctx = new C();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const t0 = ctx.currentTime, hit = t0 + delayMs / 1000, len = 1.6;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.2;
        comp.connect(ctx.destination);
        // Drone: two close low tones beating against each other
        const dg = ctx.createGain();
        dg.gain.setValueAtTime(0.0001, t0); dg.gain.exponentialRampToValueAtTime(0.22, hit - 0.05); dg.gain.setValueAtTime(0.0001, hit);
        dg.connect(comp);
        [55, 58.5].forEach(f => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; o.connect(lp); lp.connect(dg); o.start(t0); o.stop(hit + 0.05); });
        // Scream
        const shaper = ctx.createWaveShaper(), curve = new Float32Array(2048);
        for (let i = 0; i < curve.length; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 6); }
        shaper.curve = curve;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, hit); out.gain.exponentialRampToValueAtTime(1, hit + 0.015);
        out.gain.setValueAtTime(1, hit + len * 0.55); out.gain.exponentialRampToValueAtTime(0.0001, hit + len);
        shaper.connect(out); out.connect(comp);
        const k = 0.8 + Math.random() * 0.5;
        [[1100 * k, 300 * k, "sawtooth", 0.5], [1500 * k, 420 * k, "square", 0.3], [700 * k, 180, "sawtooth", 0.45], [2300 * k, 900 * k, "triangle", 0.25]].forEach(([a, z, type, v]) => {
            const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
            o.type = type; o.frequency.setValueAtTime(a, hit); o.frequency.exponentialRampToValueAtTime(z, hit + len);
            lfo.frequency.value = 30 + Math.random() * 25; lg.gain.value = a * 0.08; lfo.connect(lg); lg.connect(o.frequency);
            g.gain.value = v; o.connect(g); g.connect(shaper);
            o.start(hit); lfo.start(hit); o.stop(hit + len); lfo.stop(hit + len);
        });
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        n.buffer = buf; bp.type = "bandpass"; bp.frequency.value = 2500; bp.Q.value = 0.7; ng.gain.value = 0.7;
        n.connect(bp); bp.connect(ng); ng.connect(shaper); n.start(hit);
        // Thump
        const th = ctx.createOscillator(), tg = ctx.createGain();
        th.type = "sine"; th.frequency.setValueAtTime(120, hit); th.frequency.exponentialRampToValueAtTime(35, hit + 0.35);
        tg.gain.setValueAtTime(1, hit); tg.gain.exponentialRampToValueAtTime(0.0001, hit + 0.4);
        th.connect(tg); tg.connect(comp); th.start(hit); th.stop(hit + 0.45);
        setTimeout(() => ctx.close().catch(() => {}), delayMs + (len + 0.4) * 1000);
    } catch {}
}
// How it goes: the screen slowly goes dark with static and a drone (about a
// second, so they lean in), a dim face is barely there in the middle… then it
// cuts to the face filling the whole screen, warped and grainy with split
// colors, shaking hard, two red flashes and the scream. About 3 seconds.
const SCARE_BUILD_MS = 1100;
function gnJumpscare(pic) {
    const face = SCARE_FACES[Math.floor(Math.random() * SCARE_FACES.length)];
    const okPic = typeof pic === "string" && /^https:\/\/[^\s"'<>]+$/.test(pic) ? pic : "";
    const uid = "gs" + Math.random().toString(36).slice(2, 8);
    const build = doc => {
        const el = doc.createElement("div");
        el.className = "gn-scare";
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:hidden;cursor:none;pointer-events:auto;";
        // Each copy of the face gets its own gradient names (a hidden copy's
        // gradients would otherwise blank out the others)
        let copies = 0;
        const own = svg => { const suf = "_" + uid + (copies++); return svg.replace(/id="(gns[a-z0-9]*)"/g, `id="$1${suf}"`).replace(/url\(#(gns[a-z0-9]*)\)/g, `url(#$1${suf})`); };
        const artOf = () => okPic ? `<img alt="" referrerpolicy="no-referrer" src="${okPic.replace(/"/g, "&quot;")}" style="width:100%;height:100%;object-fit:cover;">` : own(face);
        const art = okPic ? `<img alt="" referrerpolicy="no-referrer" src="${okPic.replace(/"/g, "&quot;")}" style="width:100%;height:100%;object-fit:cover;">` : face;
        el.innerHTML = `<style>
#${uid}{position:absolute;inset:0;animation:${uid}dark ${SCARE_BUILD_MS}ms ease-in forwards;background:#000;}
@keyframes ${uid}dark{0%{opacity:0}100%{opacity:1}}
#${uid} .faint{position:absolute;left:50%;top:50%;width:22vmin;height:22vmin;transform:translate(-50%,-50%);opacity:0;filter:blur(1.5px) brightness(.5);animation:${uid}faint ${SCARE_BUILD_MS}ms ease-in forwards;}
@keyframes ${uid}faint{0%,45%{opacity:0}100%{opacity:.35}}
#${uid} .hit{position:absolute;inset:0;display:none;place-items:center;}
#${uid}.go .hit{display:grid;animation:${uid}shake .09s steps(2) infinite, ${uid}zoom 1.8s cubic-bezier(.1,1.4,.3,1) forwards;}
#${uid}.go .faint{display:none;}
@keyframes ${uid}zoom{0%{transform:scale(1.6)}7%{transform:scale(1.02)}100%{transform:scale(1.12)}}
@keyframes ${uid}shake{0%{translate:-14px 9px;rotate:-1.2deg}50%{translate:13px -11px;rotate:1.4deg}100%{translate:-9px -6px;rotate:-.6deg}}
#${uid} .layer{position:absolute;inset:0;display:grid;place-items:center;}
#${uid} .layer > *{width:100%;height:100%;}
#${uid} .layer > svg{width:auto;height:112vh;max-width:none;}
#${uid} .r{mix-blend-mode:screen;filter:url(#${uid}f) sepia(1) saturate(8) hue-rotate(-40deg);translate:-9px 0;opacity:.55;}
#${uid} .c{mix-blend-mode:screen;filter:url(#${uid}f) sepia(1) saturate(6) hue-rotate(140deg);translate:9px 0;opacity:.4;}
#${uid} .m{filter:url(#${uid}f) contrast(1.3) brightness(1.15);}
#${uid} .grain{position:absolute;inset:-50%;opacity:.28;mix-blend-mode:overlay;animation:${uid}grain .12s steps(3) infinite;}
@keyframes ${uid}grain{0%{transform:translate(0,0)}33%{transform:translate(-5%,3%)}66%{transform:translate(4%,-4%)}100%{transform:translate(-2%,5%)}}
#${uid} .static{position:absolute;inset:-50%;opacity:0;animation:${uid}grain .1s steps(3) infinite, ${uid}stat ${SCARE_BUILD_MS}ms linear forwards;}
@keyframes ${uid}stat{0%{opacity:0}70%{opacity:.18}100%{opacity:.3}}
#${uid}.go .static{display:none;}
#${uid} .vig{position:absolute;inset:0;background:radial-gradient(ellipse at center, transparent 50%, rgba(60,0,0,.6) 85%, #000 100%);pointer-events:none;}
#${uid} .red{position:absolute;inset:0;background:#e00000;opacity:0;mix-blend-mode:multiply;}
#${uid}.go .red{animation:${uid}red 1s linear forwards;}
@keyframes ${uid}red{0%,12%{opacity:.9}22%,42%{opacity:0}46%,56%{opacity:.75}66%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#${uid}.go .hit{animation:${uid}zoom 1.8s ease-out forwards;}}
</style>
<svg width="0" height="0" style="position:absolute"><defs>
 <filter id="${uid}f" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${Math.floor(Math.random() * 99)}" result="w"><animate attributeName="baseFrequency" values="0.012;0.02;0.009;0.016" dur="0.5s" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="w" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>
 <filter id="${uid}n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.2"/></filter>
</defs></svg>
<div id="${uid}">
  <svg class="static" width="200%" height="200%"><rect width="100%" height="100%" filter="url(#${uid}n)"/></svg>
  <div class="faint">${own(face)}</div>
  <div class="hit"><div class="layer m">${artOf()}</div><div class="layer r">${artOf()}</div><div class="layer c">${artOf()}</div></div>
  <svg class="grain" width="200%" height="200%"><rect width="100%" height="100%" filter="url(#${uid}n)"/></svg>
  <div class="vig"></div><div class="red"></div>
</div>`;
        doc.documentElement.appendChild(el);
        // Picture didn't load: a built-in face instead
        el.querySelectorAll(".hit img").forEach(img => { img.onerror = () => { const l = img.parentNode; if (l) l.innerHTML = own(face); }; });
        setTimeout(() => { const st = el.querySelector("#" + uid); if (st) st.classList.add("go"); }, SCARE_BUILD_MS);
        setTimeout(() => { el.style.transition = "opacity .35s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, SCARE_BUILD_MS + 1900);
        return el;
    };
    // Their game goes quiet for the build-up
    try { if (typeof zoneFrame !== "undefined" && zoneFrame && zoneFrame.contentWindow && zoneFrame.contentWindow.__gnSetMuted) { const w = zoneFrame.contentWindow; w.__gnSetMuted(true); setTimeout(() => { try { w.__gnSetMuted(!!(window.__gnmathMuted && window.__gnmathMuted())); } catch {} }, SCARE_BUILD_MS + 2200); } } catch {}
    try {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (fs && fs.tagName === "IFRAME" && fs.contentDocument) build(fs.contentDocument);
        else if (fs && fs !== document.documentElement) fs.appendChild(build(document));
        else build(document);
    } catch { build(document); }
    scareSound(SCARE_BUILD_MS);
}
