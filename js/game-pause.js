// ═════════════════════════════════════════════════════════════════════════════
// Pause when you leave the tab: the open game stops when the tab is hidden
// (another tab, another window, the Chromebook closed), and when you come back
// a 3-second countdown plays before it carries on. Settings → Games turns it off.
//
// gamePauseHook runs inside every game page (added by cleanGameHtml in app.js).
// It holds the game's animation frames, stops its clock (performance.now and
// the frame times stand still while paused, so the game doesn't jump ahead),
// and suspends its sound and videos. Partner games are on other sites, so they
// can't be paused from here.
// ═════════════════════════════════════════════════════════════════════════════
function gamePauseHook() {
    var paused = false, pausedAt = 0, lost = 0, held = [], ctxs = [], stoppedCtx = [], stoppedMedia = [];
    try {
        var perf = window.performance, realNow = perf && perf.now ? perf.now.bind(perf) : null;
        if (realNow) perf.now = function () { return (paused ? pausedAt : realNow()) - lost; };
        var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
        if (raf) {
            var nextId = 1e9;
            window.requestAnimationFrame = function (cb) {
                if (paused) { var id = ++nextId; held.push([id, cb]); return id; }
                return raf.call(window, function (t) { cb(t - lost); });
            };
            window.cancelAnimationFrame = function (id) {
                for (var i = 0; i < held.length; i++) if (held[i][0] === id) { held.splice(i, 1); return; }
                return caf.call(window, id);
            };
        }
        // Remember every sound engine the game makes, to stop and restart it
        ["AudioContext", "webkitAudioContext"].forEach(function (n) {
            var C = window[n];
            if (typeof C !== "function" || C.__gnTracked) return;
            var W = function () { var c = new (Function.prototype.bind.apply(C, [null].concat([].slice.call(arguments))))(); ctxs.push(c); return c; };
            W.prototype = C.prototype; W.__gnTracked = true;
            try { Object.setPrototypeOf(W, C); } catch (e) {}
            window[n] = W;
        });
    } catch (e) {}
    window.__gnPaused = function () { return paused; };
    window.__gnPause = function (p) {
        p = !!p;
        if (p === paused) return;
        if (p) {
            pausedAt = realNow ? realNow() : 0;
            paused = true;
            ctxs.forEach(function (c) { try { if (c.state === "running") { c.suspend(); stoppedCtx.push(c); } } catch (e) {} });
            try {
                Array.prototype.forEach.call(document.querySelectorAll("audio,video"), function (m) {
                    if (!m.paused) { try { m.pause(); stoppedMedia.push(m); } catch (e) {} }
                });
            } catch (e) {}
        } else {
            if (realNow) lost += realNow() - pausedAt;
            paused = false;
            stoppedCtx.splice(0).forEach(function (c) { try { c.resume(); } catch (e) {} });
            stoppedMedia.splice(0).forEach(function (m) { try { var r = m.play(); if (r && r.catch) r.catch(function () {}); } catch (e) {} });
            var run = held.splice(0);
            if (run.length && raf) raf.call(window, function (t) { run.forEach(function (h) { try { h[1](t - lost); } catch (e) { setTimeout(function () { throw e; }); } }); });
        }
        // Same-site frames inside the game (some games are a page inside a page)
        try {
            Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
                try { if (f.contentWindow.__gnPause) f.contentWindow.__gnPause(p); } catch (e) {}
            });
        } catch (e) {}
    };
}

const AUTO_PAUSE_KEY = "gnmath-auto-pause";
function getAutoPauseEnabled() {
    try { return localStorage.getItem(AUTO_PAUSE_KEY) !== "off"; } catch { return true; }
}
function setAutoPauseEnabled(on) {
    try { localStorage.setItem(AUTO_PAUSE_KEY, on ? "on" : "off"); } catch {}
    if (!on) resumeGameNow();
}

let tabPausedWin = null, pauseCountdown = null;
function openGameWindow() {
    try {
        if (zoneViewer.style.display !== "flex" || !zoneFrame || zoneFrame.__retiring || (zoneFrame.dataset && zoneFrame.dataset.partner)) return null;
        const w = zoneFrame.contentWindow;
        return w && typeof w.__gnPause === "function" ? w : null;
    } catch { return null; }
}
function resumeGameNow() {
    if (pauseCountdown) { pauseCountdown.stop(); pauseCountdown = null; }
    try { if (tabPausedWin) tabPausedWin.__gnPause(false); } catch {}
    tabPausedWin = null;
}

// The countdown goes inside the game page, so it shows in fullscreen too
// (falls back to the game area if the page can't be reached)
function showPauseCountdown(win, done) {
    let doc = null;
    try { doc = win.document; } catch {}
    const host = doc && doc.documentElement ? doc : document;
    const el = host.createElement("div");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "assertive");
    el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;" +
        "background:rgba(8,10,16,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);color:#fff;" +
        "font:600 16px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;cursor:default;user-select:none;";
    el.innerHTML = `<div data-n style="font-size:clamp(72px,16vmin,160px);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 4px 24px rgba(0,0,0,.45);">3</div>` +
        `<div style="opacity:.85;">Paused while you were away. Get ready…</div>`;
    const target = host === document ? zoneViewer : doc.documentElement;
    target.appendChild(el);
    const num = el.querySelector("[data-n]");
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pop = () => {
        if (reduced || !num.animate) return;
        try { num.animate([{ transform: "scale(1.35)", opacity: 0.2 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,1.4,.4,1)" }); } catch {}
    };
    let n = 3, timer = null;
    pop();
    const tick = () => {
        n--;
        if (n <= 0) { stop(); done(); return; }
        num.textContent = String(n);
        pop();
        timer = setTimeout(tick, 1000);
    };
    // Real timers from this page: the game page's clock is the one standing still
    timer = setTimeout(tick, 1000);
    function stop() { clearTimeout(timer); try { el.remove(); } catch {} }
    return { stop };
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        // Left during the countdown: stay paused, count again when back
        if (pauseCountdown) { pauseCountdown.stop(); pauseCountdown = null; }
        if (tabPausedWin || !getAutoPauseEnabled()) return;
        const w = openGameWindow();
        if (!w) return;
        try { if (w.__gnPaused && w.__gnPaused()) return; w.__gnPause(true); tabPausedWin = w; } catch {}
        return;
    }
    if (!tabPausedWin) return;
    const w = tabPausedWin;
    if (openGameWindow() !== w) { resumeGameNow(); return; }   // the game was closed or changed meanwhile
    pauseCountdown = showPauseCountdown(w, () => {
        pauseCountdown = null;
        resumeGameNow();
        try { zoneFrame.focus(); w.focus(); } catch {}
    });
});
