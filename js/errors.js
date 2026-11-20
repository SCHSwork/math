// ════════════════════════════════════════════════════════════════════════════
// Error reports. Things that go wrong for players (the site crashing, a game
// that won't load or crashes, a broken download, a failed cloud save) are
// reported automatically to Firestore (errorLogs/<signature>), where admins
// read them in Admin Panel → Errors.
//
// The same error from many players is ONE entry with a count, plus the details
// of the latest time it happened. Each browser sends at most a few reports a
// day, never the same one twice in a visit, and none when the site is near its
// daily Firebase limit. Reports made before Firebase is ready (or while
// offline) wait in this browser and are sent later.
// Loaded first, so it also catches errors while the rest of the site loads.
// ════════════════════════════════════════════════════════════════════════════
const ERROR_LOG = {
    perDay: 15,                       // most reports one browser sends a day
    queueKey: "gnmath-error-queue",   // waiting to be sent
    dayKey: "gnmath-error-day",       // { day, n }
    maxQueue: 10
};
const errorSentThisVisit = new Set();
const errorLoadedAt = Date.now();

// Short hash for grouping the same error together
function errorHash(s) {
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
        h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
}
// Same error, different details (numbers, ids, file versions, blob URLs) → same group
function errorShape(msg) {
    return String(msg || "")
        .replace(/blob:[^\s)"']+/g, "blob:…")
        .replace(/https?:\/\/[^\s)"']+/g, u => u.replace(/[?#].*$/, "").replace(/@[0-9a-f]{7,40}/g, "@…"))
        .replace(/\b[0-9a-f]{12,}\b/gi, "…")
        .replace(/\d+/g, "#")
        .slice(0, 200);
}
// The first line of a stack that points at real code (file without its ?v=…)
function errorTopFrame(stack) {
    const line = String(stack || "").split("\n").map(l => l.trim()).find(l => /(https?:|blob:|wasm:)/.test(l) && !/errors\.js/.test(l));
    if (!line) return "";
    return line.replace(/[?#][^:)\s]*/g, "").replace(/^at\s+/, "").slice(0, 160);
}
function errorBrowser() {
    const ua = navigator.userAgent || "";
    const b = (ua.match(/(Edg|OPR|SamsungBrowser|Firefox|CriOS|Chrome|Version)\/(\d+)/) || [])[0] || "?";
    const os = /CrOS/.test(ua) ? "ChromeOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "?";
    return `${b.replace("Version", "Safari")} · ${os}`;
}
function errorSiteVersion() {
    const s = document.querySelector('script[src*="js/app.js"]');
    return s ? (s.getAttribute("src").match(/v=([0-9a-f]+)/) || [])[1] || "" : "";
}
function errorDay() { return new Date().toISOString().slice(0, 10); }

// Noise that isn't ours to fix
function errorIsNoise(msg, stack) {
    const m = String(msg || "");
    if (!m) return true;
    if (/ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:|Non-Error promise rejection captured|^Script error\.?$/i.test(m) && !/game/.test(m)) return true;
    if (/(chrome|moz|safari)-extension:/.test(String(stack || ""))) return true;
    if (/Load failed|Failed to fetch|NetworkError when attempting|The network connection was lost|net::ERR_/i.test(m)) return true;  // offline / blocked; tracked elsewhere
    return false;
}

/**
 * Report something unexpected.
 *   source: "site" | "game" | "game-load" | "download" | "cloud-save" | …
 *   message: what happened (short)
 *   opts: { stack, gameId, gameName, detail, keep }  (keep: report even if it looks like noise)
 */
function reportError(source, message, opts = {}) {
    try {
        const msg = String(message || "").slice(0, 500);
        if (!opts.keep && errorIsNoise(msg, opts.stack)) return;
        const frame = errorTopFrame(opts.stack);
        const sig = errorHash(`${source}|${opts.gameId || ""}|${errorShape(msg)}|${errorShape(frame)}`);
        if (errorSentThisVisit.has(sig)) return;
        errorSentThisVisit.add(sig);
        const sample = {
            message: msg,
            stack: String(opts.stack || "").slice(0, 1500),
            detail: String(opts.detail || "").slice(0, 500),
            browser: errorBrowser(),
            ua: String(navigator.userAgent || "").slice(0, 300),
            screen: `${screen.width}x${screen.height}@${(window.devicePixelRatio || 1).toFixed(2)}`,
            memory: String(navigator.deviceMemory || ""),
            online: navigator.onLine !== false,
            version: errorSiteVersion(),
            secondsOnPage: Math.round((Date.now() - errorLoadedAt) / 1000),
            blockedSources: (typeof mirrorDown !== "undefined" ? [...mirrorDown] : []).join(",").slice(0, 120),
            user: (typeof cloudUser !== "undefined" && cloudUser && typeof currentUsername === "function") ? currentUsername().slice(0, 40) : "",
            at: new Date().toISOString()
        };
        const entry = {
            sig, source: String(source).slice(0, 20), message: msg.slice(0, 200),
            where: frame, gameId: String(opts.gameId || "").slice(0, 12), gameName: String(opts.gameName || "").slice(0, 80), sample
        };
        errorQueue(entry);
        errorFlushSoon();
    } catch (e) { /* never let error reporting break anything */ }
}

function errorReadQueue() { try { return JSON.parse(localStorage.getItem(ERROR_LOG.queueKey) || "[]"); } catch { return []; } }
function errorWriteQueue(q) { try { localStorage.setItem(ERROR_LOG.queueKey, JSON.stringify(q.slice(-ERROR_LOG.maxQueue))); } catch {} }
function errorQueue(entry) {
    const q = errorReadQueue();
    if (!q.some(e => e.sig === entry.sig)) q.push(entry);
    errorWriteQueue(q);
}
function errorSentToday() {
    try { const d = JSON.parse(localStorage.getItem(ERROR_LOG.dayKey) || "{}"); return d.day === errorDay() ? d.n || 0 : 0; } catch { return 0; }
}
function errorNoteSent() {
    try { localStorage.setItem(ERROR_LOG.dayKey, JSON.stringify({ day: errorDay(), n: errorSentToday() + 1 })); } catch {}
}

let errorFlushTimer = null, errorFlushing = false;
function errorFlushSoon(ms = 3000) {
    clearTimeout(errorFlushTimer);
    errorFlushTimer = setTimeout(errorFlush, ms);
}
// The GN 2.0 Server adds up the same error from many players and writes it to
// Firestore as one entry every 10 minutes, so most reports cost this browser
// no Firebase write at all. If the server can't be reached, reports go
// straight to Firestore like before.
async function errorFlushToServer() {
    let q = errorReadQueue();
    if (!q.length) return true;
    const room = ERROR_LOG.perDay - errorSentToday();
    if (room <= 0) { errorWriteQueue([]); return true; }
    q = q.slice(0, Math.min(room, 10));
    try {
        const base = typeof HOME_SERVER !== "undefined" ? HOME_SERVER : "https://data.learnresearch.org";
        const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(base + "/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q), signal: ctrl.signal, keepalive: true });
        clearTimeout(t);
        if (!res.ok) return false;
    } catch { return false; }
    const sent = new Set(q.map(e => e.sig));
    for (let i = 0; i < sent.size; i++) errorNoteSent();
    errorWriteQueue(errorReadQueue().filter(e => !sent.has(e.sig)));
    return !errorReadQueue().length;
}
async function errorFlush() {
    if (errorFlushing) return;
    errorFlushing = true;
    let viaServer = false;
    try { viaServer = await errorFlushToServer(); } catch {}
    errorFlushing = false;
    if (viaServer) return;
    // Firebase loads after the page; try again later if it isn't ready
    if (typeof cloudDb === "undefined" || !cloudDb || typeof firebase === "undefined") { errorFlushSoon(10000); return; }
    if (typeof fbPaused === "function" && fbPaused()) return;
    errorFlushing = true;
    try {
        let q = errorReadQueue();
        while (q.length) {
            if (errorSentToday() >= ERROR_LOG.perDay) { errorWriteQueue([]); break; }
            const e = q[0];
            const ref = cloudDb.collection("errorLogs").doc("e" + e.sig);
            const now = firebase.firestore.FieldValue.serverTimestamp();
            try {
                // Seen before: add one to its count (one write, no read)
                await ref.update({ count: firebase.firestore.FieldValue.increment(1), lastAt: now, last: e.sample, status: "open" });
            } catch (err) {
                if (err && err.code === "not-found") {
                    await ref.set({ sig: e.sig, source: e.source, message: e.message, where: e.where, gameId: e.gameId, gameName: e.gameName,
                        count: 1, firstAt: now, lastAt: now, last: e.sample, status: "open" });
                } else throw err;
            }
            if (typeof fbCount === "function") fbCount(0, 1);
            errorNoteSent();
            q = errorReadQueue().filter(x => x.sig !== e.sig);
            errorWriteQueue(q);
        }
    } catch (err) {
        // Offline or refused: keep the queue for next time (a bad entry is dropped)
        if (err && (err.code === "permission-denied" || err.code === "invalid-argument")) errorWriteQueue(errorReadQueue().slice(1));
        if (typeof noteFbError === "function") noteFbError(err);
    } finally {
        errorFlushing = false;
    }
}

// The site itself
window.addEventListener("error", e => {
    // Images and scripts that fail to load fire here too; those are handled where they load
    if (!(e instanceof ErrorEvent)) return;
    reportError("site", e.message, { stack: (e.error && e.error.stack) || `${e.filename}:${e.lineno}:${e.colno}` });
});
window.addEventListener("unhandledrejection", e => {
    const r = e.reason;
    reportError("site", r && r.message ? r.message : String(r), { stack: r && r.stack });
});
// Reports waiting from an earlier visit
window.addEventListener("load", () => { if (errorReadQueue().length) errorFlushSoon(8000); });

// ── Inside game pages ───────────────────────────────────────────────────────
// Runs in every game page (added by cleanGameHtml) and passes crashes up.
function gameErrorHook() {
    var sent = 0;
    // Everything the game prints (kept in the page, for ⋯ More → What the game said)
    var log = window.__gnLog = [], t0 = Date.now();
    var keep = function (level, args) {
        try {
            var text = Array.prototype.map.call(args, function (x) {
                if (x instanceof Error) return x.message;
                if (typeof x === "object") { try { return JSON.stringify(x).slice(0, 300); } catch (e) { return String(x); } }
                return String(x);
            }).join(" ").slice(0, 400);
            log.push({ t: Date.now() - t0, level: level, text: text });
            if (log.length > 300) log.splice(0, log.length - 300);
        } catch (e) {}
    };
    ["log", "info", "warn", "error"].forEach(function (k) {
        var orig = console[k];
        if (typeof orig !== "function") return;
        console[k] = function () { keep(k, arguments); return orig.apply(this, arguments); };
    });
    // ── Did the game actually break? (for the "isn't responding" box) ──────
    // Most game errors are harmless, so the box only shows when an error is
    // followed by the game stopping: it had been drawing frames and stopped
    // within 3 s of the error, or it never started drawing at all. Also when
    // the graphics are lost (and not restored), or the engine shows a fatal
    // alert(). Paused games (tab left, jumpscare) don't count.
    var frames = 0, lastFrame = 0, lastErr = null, fatalSent = false, startAt = Date.now();
    try {
        var rafOrig = window.requestAnimationFrame;
        if (rafOrig) window.requestAnimationFrame = function (cb) {
            return rafOrig.call(window, function (t) { frames++; lastFrame = Date.now(); return cb(t); });
        };
    } catch (e) {}
    var paused = function () { try { return !!(window.__gnPaused && window.__gnPaused()) || document.hidden; } catch (e) { return false; } };
    var fatal = function (kind, message) {
        if (fatalSent) return;
        fatalSent = true;
        try { if (window.parent && window.parent !== window && window.parent.__gnmathGameFatal) window.parent.__gnmathGameFatal({ kind: kind, message: String(message || "").slice(0, 300) }); } catch (e) {}
    };
    var checkAfterError = function () {
        setTimeout(function () {
            if (fatalSent || paused() || !lastErr) return;
            var now = Date.now();
            if (frames > 30 && now - lastFrame > 2500 && lastFrame < lastErr.at + 3000) fatal("stopped", lastErr.message);
        }, 3200);
        setTimeout(function () {
            if (fatalSent || paused() || !lastErr) return;
            // Only for engine games whose screen never got going (a canvas still
            // at its blank 300×150, or none): page games without a canvas
            // (Cookie Clicker…) don't draw frames and are fine
            var cs = Array.prototype.slice.call(document.querySelectorAll("canvas"));
            var blank = cs.every(function (c) { return c.width <= 300 && c.height <= 150; });
            var engine = !!(window.createUnityInstance || window.UnityLoader || window.unityFramework || window.Godot || window.Engine || window.Module || window.C3_RUNTIME || window.cr_getC2Runtime || window.RufflePlayer) ||
                Array.prototype.some.call(document.scripts, function (sc) { return /unity|godot|loader\.js|\.wasm|c3runtime|construct|ruffle|phaser|pixi/i.test(sc.src || ""); });
            if (frames < 3 && Date.now() - startAt > 9000 && blank && engine && !document.querySelector("video")) fatal("start", lastErr.message);
        }, Math.max(0, 9500 - (Date.now() - startAt)));
    };
    document.addEventListener("webglcontextlost", function (e) {
        var c = e.target;
        setTimeout(function () { try { if (c && c.isConnected && (c.getContext("webgl2") || c.getContext("webgl") || {}).isContextLost && (c.getContext("webgl2") || c.getContext("webgl")).isContextLost()) fatal("graphics", "The game's graphics (WebGL) stopped working."); } catch (err) {} }, 2500);
    }, true);
    window.__gnFatal = fatal;
    var up = function (kind, message, stack) {
        lastErr = { at: Date.now(), message: String(message || "") };
        checkAfterError();
        if (sent >= 5) return;
        sent++;
        try { if (window.parent && window.parent !== window && window.parent.__gnmathGameError) window.parent.__gnmathGameError({ kind: kind, message: String(message || "").slice(0, 500), stack: String(stack || "").slice(0, 1500) }); } catch (e) {}
    };
    window.addEventListener("error", function (e) {
        if (!(e instanceof ErrorEvent)) {
            // A file that didn't load (script, image)
            try { var el = e.target; if (el && (el.src || el.href)) keep("error", ["Couldn't load " + (el.src || el.href)]); } catch (err) {}
            return;
        }
        keep("error", [e.message + (e.filename ? " (" + e.filename + ":" + e.lineno + ")" : "")]);
        up("error", e.message, (e.error && e.error.stack) || (e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : ""));
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
        var r = e.reason;
        keep("error", ["Unhandled: " + (r && r.message ? r.message : String(r))]);
        up("rejection", r && r.message ? r.message : String(r), r && r.stack);
    });
    // Engines (Unity, Emscripten…) show fatal errors with alert()
    var origAlert = window.alert;
    window.alert = function (msg) {
        keep("alert", [msg]);
        if (/abort\(|error|exception|failed|out of memory|cannot|could not|unable/i.test(String(msg))) {
            up("alert", msg, "");
            // The site's own box instead of the browser's plain one
            if (window.parent && window.parent !== window && window.parent.__gnmathGameFatal && !fatalSent) { fatal("crash", msg); return; }
        }
        return origAlert.apply(this, arguments);
    };
}
// Games copied from Google Sites call window.parent.maeExportApis_() when they
// start (Google Sites' own hook). Here there's nothing to export; this keeps
// that from being an error in every one of those games (and in the error log).
if (typeof window.maeExportApis_ !== "function") window.maeExportApis_ = function () {};
window.__gnmathGameError = function (ev) {
    try {
        const z = typeof currentZone === "function" ? currentZone() : null;
        reportError("game", ev.message, { stack: ev.stack, gameId: z ? z.id : (typeof currentGameId !== "undefined" ? currentGameId : ""), gameName: z ? z.name : "", detail: ev.kind });
    } catch (e) {}
};
