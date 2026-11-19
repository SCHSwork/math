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
// screen with a scream made on the spot by the browser. It flashes red once
// and inverted once, well under the safe limit for people sensitive to
// flashing lights (no more than 3 a second).
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
// The sound, all made by the browser on the spot (no recordings):
//  • the error "ding" when the fake error box shows up
//  • the hit: a deep boom, a horror-movie "stinger" (a clashing chord of
//    rough tones), and a scream — a voice-like tone shaped by the formants of
//    an "AAAH" (800 / 1150 / 2900 Hz), jumping up in pitch with a wild
//    vibrato, two of them slightly out of tune, plus a metallic shriek on top
//  • all of it pushed through distortion and a limiter, so it's as loud as
//    the speakers go without turning to mush. About 2 seconds.
//  • a short shriek with the last inverted flash
function scareSound(delayMs, dingMs = -1, subMs = -1) {
    try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        const ctx = new C();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const t0 = ctx.currentTime, hit = t0 + delayMs / 1000, len = 2.1;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -10; limiter.knee.value = 4; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.15;
        const master = ctx.createGain(); master.gain.value = 1.4;
        master.connect(limiter); limiter.connect(ctx.destination);
        const env = (g, at, peak, hold, end) => {
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
            g.gain.setValueAtTime(peak, at + hold); g.gain.exponentialRampToValueAtTime(0.0001, at + end);
        };
        const noiseBuf = secs => { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
        const shaper = amt => { const s = ctx.createWaveShaper(), c = new Float32Array(4096); for (let i = 0; i < c.length; i++) { const x = i / 2048 - 1; c[i] = Math.tanh(x * amt); } s.curve = c; s.oversample = "4x"; return s; };
        // Error ding
        if (dingMs >= 0) {
            const td = t0 + dingMs / 1000;
            [[880, 0], [660, 0.12]].forEach(([f, off]) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = "sine"; o.frequency.value = f; env(g, td + off, 0.16, 0.02, 0.35);
                o.connect(g); g.connect(ctx.destination); o.start(td + off); o.stop(td + off + 0.4);
            });
        }
        // Last flash: a short, harsh shriek
        if (subMs >= 0) {
            const ts = t0 + subMs / 1000, d = shaper(6), g = ctx.createGain();
            env(g, ts, 0.7, 0.08, 0.3); d.connect(g); g.connect(master);
            [1870, 1990, 2650].forEach(f => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, ts); o.frequency.exponentialRampToValueAtTime(f * 0.7, ts + 0.3); o.connect(d); o.start(ts); o.stop(ts + 0.32); });
        }
        // Boom
        {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.setValueAtTime(95, hit); o.frequency.exponentialRampToValueAtTime(28, hit + 0.9);
            env(g, hit, 1.2, 0.05, 1.1); o.connect(g); g.connect(master); o.start(hit); o.stop(hit + 1.2);
            const n = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
            n.buffer = noiseBuf(0.5); lp.type = "lowpass"; lp.frequency.value = 400; env(ng, hit, 0.9, 0.02, 0.45);
            n.connect(lp); lp.connect(ng); ng.connect(master); n.start(hit);
        }
        // Stinger: a clashing chord (half-steps rubbing) with fast tremolo
        {
            const dist = shaper(3), bus = ctx.createGain(), bp = ctx.createBiquadFilter();
            bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.5;
            env(bus, hit, 0.35, 0.5, 1.9); dist.connect(bp); bp.connect(bus); bus.connect(master);
            const trem = ctx.createOscillator(), tg = ctx.createGain(); trem.frequency.value = 13; tg.gain.value = 0.4; trem.connect(tg); tg.connect(bus.gain); trem.start(hit); trem.stop(hit + len);
            [277.2, 293.7, 392, 415.3, 554.4, 587.3].forEach((f, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = i % 2 ? "square" : "sawtooth"; o.frequency.setValueAtTime(f, hit); o.frequency.linearRampToValueAtTime(f * 0.94, hit + len);
                g.gain.value = 0.16; o.connect(g); g.connect(dist); o.start(hit); o.stop(hit + len);
            });
        }
        // Scream: rough voice through "AAAH" formants, pitch jumping up with wild vibrato
        {
            const formants = [[800, 6, 1], [1150, 7, 0.7], [2900, 9, 0.45], [3400, 10, 0.3]];
            const voiceBus = ctx.createGain(), dist = shaper(5);
            env(voiceBus, hit + 0.02, 1, len * 0.55, len);
            voiceBus.connect(dist); dist.connect(master);
            const k = 0.85 + Math.random() * 0.35;   // a different voice each time
            [0, 7].forEach(cents => {
                const src = ctx.createOscillator(); src.type = "sawtooth";
                const f = (x) => x * k * Math.pow(2, cents / 1200);
                src.frequency.setValueAtTime(f(320), hit); src.frequency.exponentialRampToValueAtTime(f(980), hit + 0.12);
                src.frequency.exponentialRampToValueAtTime(f(820), hit + 0.9); src.frequency.exponentialRampToValueAtTime(f(520), hit + len);
                const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 7.5 + Math.random() * 2; vg.gain.value = f(60); vib.connect(vg); vg.connect(src.frequency);
                const jit = ctx.createBufferSource(), jg = ctx.createGain(), jl = ctx.createBiquadFilter();   // a ragged, unsteady throat
                jit.buffer = noiseBuf(len); jl.type = "lowpass"; jl.frequency.value = 40; jg.gain.value = f(120); jit.connect(jl); jl.connect(jg); jg.connect(src.frequency);
                formants.forEach(([ff, q, amp]) => {
                    const bp = ctx.createBiquadFilter(), g = ctx.createGain();
                    bp.type = "bandpass"; bp.frequency.value = ff * (0.95 + Math.random() * 0.1); bp.Q.value = q; g.gain.value = amp * 2.2;
                    src.connect(bp); bp.connect(g); g.connect(voiceBus);
                });
                // breath in the scream
                const br = ctx.createBufferSource(), bb = ctx.createBiquadFilter(), bg = ctx.createGain();
                br.buffer = noiseBuf(len); bb.type = "bandpass"; bb.frequency.value = 1800; bb.Q.value = 0.8; bg.gain.value = 0.35;
                br.connect(bb); bb.connect(bg); bg.connect(voiceBus);
                [src, vib, jit, br].forEach(n => { n.start(hit); n.stop(hit + len); });
            });
            // Metallic shriek on top
            const sh = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), sg = ctx.createGain();
            sh.type = "sine"; sh.frequency.setValueAtTime(3100 * k, hit); sh.frequency.exponentialRampToValueAtTime(2300 * k, hit + len);
            mod.frequency.value = 437; mg.gain.value = 1800; mod.connect(mg); mg.connect(sh.frequency);
            env(sg, hit, 0.18, 0.4, 1.4); sh.connect(sg); sg.connect(master);
            [sh, mod].forEach(n => { n.start(hit); n.stop(hit + len); });
        }
        setTimeout(() => ctx.close().catch(() => {}), Math.max(delayMs + (len + 0.5) * 1000, subMs + 800));
    } catch (e) { console.warn("Jumpscare sound failed", e); }
}
// Pictures to use (Admin Panel → Sessions picks one at random, or yours):
// public-domain paintings on Wikimedia Commons, linked rather than copied.
// pos: which part of the picture to fill the screen with.
const SCARE_BANK = [
    ["Goya, Saturn Devouring His Son (1819–23)", "Francisco_de_Goya,_Saturno_devorando_a_su_hijo_(1819-1823).jpg", "50% 18%"],
    ["Goya, Two Old Men Eating Soup (1819–23)", "Viejos_comiendo_sopa.jpg", "35% 40%"],
    ["Fuseli, The Nightmare (1781)", "John_Henry_Fuseli_-_The_Nightmare.JPG", "38% 30%"],
    ["Böcklin, Self-Portrait with Death Playing the Fiddle (1872)", "Arnold_Boecklin-fiedelnder_Tod.jpg", "78% 22%"]
].map(([title, file, pos]) => ({ title, pos, url: "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file) + "?width=1400" }));
function scarePos(url) { const b = SCARE_BANK.find(x => x.url === url); return b ? b.pos : "50% 35%"; }

// How it goes: their game freezes (it's paused, so it really stops), then a
// red error bar blinks at the top and a "not responding" box pops up with a
// ding, so they lean in to read it… and somewhere in the middle of reading,
// with no warning at all (no black screen, no sound first, a different moment
// every time), a face is suddenly right there, filling the screen (no zoom, it just appears),
// too close, and stays there frozen (it only twitches, like a broken film),
// with one red flash and the scream.
// Cut to black, and when they think it's over, it flashes once more,
// inverted. After that the game carries on.
const SCARE_FREEZE_MS = 800, SCARE_BOX_MS = 1500;
// The hit comes at a random moment while they're reading the box (no warning)
function gnJumpscare(pic) {
    const SCARE_HIT_MS = SCARE_BOX_MS + 1400 + Math.floor(Math.random() * 2600),
        SCARE_CUT_MS = SCARE_HIT_MS + 1700, SCARE_SUB_MS = SCARE_CUT_MS + 550, SCARE_END_MS = SCARE_SUB_MS + 350;
    const face = SCARE_FACES[Math.floor(Math.random() * SCARE_FACES.length)];
    const okPic = typeof pic === "string" && /^https:\/\/[^\s"'<>]+$/.test(pic) ? pic : "";
    const uid = "gs" + Math.random().toString(36).slice(2, 8);
    let gameName = "";
    try { if (getComputedStyle(zoneViewer).display !== "none") gameName = (document.getElementById("zoneName").textContent || "").trim(); } catch {}
    const appName = gameName || "This page";
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    // Start loading the picture now, during the fake crash
    let picReady = false;
    if (okPic) { const pre = new Image(); pre.referrerPolicy = "no-referrer"; pre.onload = () => { picReady = true; }; pre.src = okPic; }
    // Freeze the game for real
    let gw = null;
    try { if (typeof zoneFrame !== "undefined" && zoneFrame && !zoneFrame.__retiring) gw = zoneFrame.contentWindow; } catch {}
    try { if (gw && gw.__gnPause) gw.__gnPause(true); } catch {}
    try { if (gw && gw.__gnSetMuted) gw.__gnSetMuted(true); } catch {}
    const build = doc => {
        const el = doc.createElement("div");
        el.className = "gn-scare";
        el.setAttribute("aria-hidden", "true");
        el.style.cssText = "position:fixed;inset:0;z-index:2147483647;overflow:hidden;pointer-events:auto;font-family:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;";
        let copies = 0;
        const own = svg => { const suf = "_" + uid + (copies++); return svg.replace(/id="(gns[a-z0-9]*)"/g, `id="$1${suf}"`).replace(/url\(#(gns[a-z0-9]*)\)/g, `url(#$1${suf})`); };
        const artOf = () => okPic ? `<img alt="" referrerpolicy="no-referrer" src="${esc(okPic)}" style="width:100%;height:100%;object-fit:cover;object-position:${scarePos(okPic)};">` : own(face);
        const code = "0x" + (0x887A0000 + Math.floor(Math.random() * 16)).toString(16).toUpperCase();
        el.innerHTML = `<style>
#${uid}{position:absolute;inset:0;}
#${uid} .bar{position:absolute;left:0;right:0;top:0;display:none;align-items:center;gap:12px;padding:12px 18px;background:#b00020;color:#fff;font-size:15px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.4);}
#${uid}.err .bar{display:flex;animation:${uid}blink .5s steps(1) infinite;}
@keyframes ${uid}blink{0%{background:#b00020}50%{background:#5c0011}}
#${uid} .dim{position:absolute;inset:0;background:rgba(0,0,0,0);transition:background .4s;}
#${uid}.box .dim{background:rgba(0,0,0,.35);}
#${uid} .dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);width:min(440px,90vw);display:none;background:#f3f3f3;color:#1b1b1b;border:1px solid #9a9a9a;box-shadow:0 18px 60px rgba(0,0,0,.5);border-radius:8px;overflow:hidden;cursor:default;}
#${uid}.box .dlg{display:block;animation:${uid}pop .14s ease-out forwards;}
@keyframes ${uid}pop{to{transform:translate(-50%,-50%) scale(1)}}
#${uid} .dlg .tt{padding:9px 14px;font-size:12px;background:#fff;border-bottom:1px solid #ddd;color:#444;}
#${uid} .dlg .bd{display:flex;gap:14px;padding:18px 18px 8px;font-size:14px;line-height:1.45;}
#${uid} .dlg .ic{flex:none;width:34px;height:34px;border-radius:50%;background:#c42b1c;color:#fff;display:grid;place-items:center;font-weight:800;font-size:20px;}
#${uid} .dlg .bt{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px 16px;}
#${uid} .dlg button{font:inherit;font-size:13px;padding:6px 18px;border-radius:4px;border:1px solid #8a8a8a;background:#fdfdfd;color:#111;cursor:default;}
#${uid} .dlg button.p{background:#0067c0;border-color:#0067c0;color:#fff;}
#${uid} .spin{display:inline-block;width:12px;height:12px;border:2px solid #999;border-top-color:transparent;border-radius:50%;animation:${uid}sp 1s linear infinite;vertical-align:-2px;margin-right:6px;}
@keyframes ${uid}sp{to{transform:rotate(360deg)}}
#${uid} .black{position:absolute;inset:0;background:#000;display:none;}
#${uid}.go .black, #${uid}.cut .black, #${uid}.sub .black{display:block;}
#${uid}.go .bar, #${uid}.go .dlg, #${uid}.cut .bar, #${uid}.cut .dlg, #${uid}.sub .bar, #${uid}.sub .dlg{display:none;}
#${uid} .hit{position:absolute;inset:0;display:none;place-items:center;overflow:hidden;cursor:none;}
#${uid}.go .hit, #${uid}.sub .hit{display:grid;}
#${uid} .mv{position:absolute;inset:0;display:grid;place-items:center;transform:scale(.14);}
#${uid}.go .mv{opacity:1;filter:contrast(1.35) brightness(1.08) saturate(.85);transform:scale(1.32);animation:${uid}lunge .1s steps(1) forwards, ${uid}twitch 1.1s steps(1) .3s infinite;}
@keyframes ${uid}lunge{0%{transform:scale(1.5)}50%{transform:scale(1.32)}}
@keyframes ${uid}twitch{0%{transform:scale(1.32)}27%{transform:scale(1.36) translate(6px,-4px) rotate(.6deg)}29%{transform:scale(1.32)}58%{transform:scale(1.33) translate(-5px,3px) rotate(-.5deg)}60%{transform:scale(1.32)}86%{transform:scale(1.4) translate(0,6px)}88%{transform:scale(1.32)}}
#${uid}.sub .mv{opacity:1;animation:none;transform:scale(1.45);filter:invert(1) contrast(1.8) brightness(1.1);}
#${uid} .layer{position:absolute;inset:0;display:grid;place-items:center;}
#${uid} .layer > *{width:100%;height:100%;}
#${uid} .layer > svg{width:auto;height:112vh;max-width:none;}
#${uid} .r, #${uid} .c{mix-blend-mode:screen;opacity:0;}
#${uid} .r{filter:sepia(1) saturate(8) hue-rotate(-40deg);--dx:-26px;}
#${uid} .c{filter:sepia(1) saturate(6) hue-rotate(140deg);--dx:26px;}
#${uid}.go .r, #${uid}.go .c{animation:${uid}spl .35s steps(1) forwards;}
@keyframes ${uid}spl{0%,30%{opacity:.75;translate:var(--dx) 0}31%,100%{opacity:.12;translate:calc(var(--dx) / 6) 0}}
#${uid} .grain{position:absolute;inset:-50%;opacity:.28;mix-blend-mode:overlay;display:none;animation:${uid}grain .12s steps(3) infinite;}
#${uid}.go .grain{display:block;}
@keyframes ${uid}grain{0%{transform:translate(0,0)}33%{transform:translate(-5%,3%)}66%{transform:translate(4%,-4%)}100%{transform:translate(-2%,5%)}}
#${uid} .vig{position:absolute;inset:0;display:none;background:radial-gradient(ellipse at center, transparent 50%, rgba(60,0,0,.6) 85%, #000 100%);}
#${uid}.go .vig{display:block;}
#${uid} .red{position:absolute;inset:0;background:#e00000;opacity:0;mix-blend-mode:multiply;}
#${uid}.go .red{animation:${uid}red 1s linear forwards;}
@keyframes ${uid}red{0%,9%{opacity:.85}24%,100%{opacity:0}}
#${uid}.cut .grain, #${uid}.cut .vig, #${uid}.cut .red{display:none;}
</style>
<svg width="0" height="0" style="position:absolute"><defs>
 <filter id="${uid}f" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${Math.floor(Math.random() * 99)}" result="w"><animate attributeName="baseFrequency" values="0.012;0.02;0.009;0.016" dur="0.5s" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="w" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>
 <filter id="${uid}n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.2"/></filter>
</defs></svg>
<div id="${uid}">
  <div class="dim"></div>
  <div class="bar"><span style="font-size:20px;line-height:1">&#9888;</span><span>Error: ${esc(appName)} stopped responding (WebGL context lost, ${code}). Unsaved progress may be lost.</span></div>
  <div class="dlg"><div class="tt">${esc(appName)}</div>
    <div class="bd"><div class="ic">!</div><div><b>${esc(appName)} isn't responding</b><br>You can wait for it to respond or reload it. Reloading may lose unsaved progress.<br><span style="color:#555;font-size:12.5px"><span class="spin"></span>Waiting for the game…</span></div></div>
    <div class="bt"><button type="button">Wait</button><button type="button" class="p">Reload</button></div></div>
  <div class="black"></div>
  <div class="hit"><div class="mv"><div class="layer m">${artOf()}</div><div class="layer r">${artOf()}</div><div class="layer c">${artOf()}</div></div></div>
  <svg class="grain" width="200%" height="200%"><rect width="100%" height="100%" filter="url(#${uid}n)"/></svg>
  <div class="vig"></div><div class="red"></div>
</div>`;
        doc.documentElement.appendChild(el);
        el.querySelectorAll(".hit img").forEach(img => { img.onerror = () => { const l = img.parentNode; if (l) l.innerHTML = own(face); }; });
        const st = el.querySelector("#" + uid);
        setTimeout(() => st.classList.add("err"), SCARE_FREEZE_MS);
        setTimeout(() => st.classList.add("box"), SCARE_BOX_MS);
        setTimeout(() => {
            // The picture didn't load in time: a built-in face instead
            if (okPic && !picReady) el.querySelectorAll(".hit .layer").forEach(l => { l.innerHTML = own(face); });
            st.classList.add("go");
        }, SCARE_HIT_MS);
        setTimeout(() => { st.classList.remove("go"); st.classList.add("cut"); }, SCARE_CUT_MS);
        setTimeout(() => { st.classList.remove("cut"); st.classList.add("sub"); }, SCARE_SUB_MS);
        setTimeout(() => { st.classList.remove("sub"); st.classList.add("cut"); }, SCARE_SUB_MS + 90);
        setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 350); }, SCARE_END_MS);
        return el;
    };
    try {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (fs && fs.tagName === "IFRAME" && fs.contentDocument) build(fs.contentDocument);
        else if (fs && fs !== document.documentElement) fs.appendChild(build(document));
        else build(document);
    } catch { build(document); }
    scareSound(SCARE_HIT_MS, SCARE_BOX_MS, SCARE_SUB_MS);
    // The game carries on afterwards
    setTimeout(() => {
        try { if (gw && gw.__gnPause) gw.__gnPause(false); } catch {}
        try { if (gw && gw.__gnSetMuted) gw.__gnSetMuted(!!(window.__gnmathMuted && window.__gnmathMuted())); } catch {}
    }, SCARE_END_MS + 300);
}
