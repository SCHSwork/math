// ═════════════════════════════════════════════════════════════════════════════
// Game loading bar. gameProgressHook() is injected into every game page (see
// cleanGameHtml) and reports the game's own downloads (fetch + XHR) back here,
// so the bar shows real progress, size and an ETA for big games.
// ═════════════════════════════════════════════════════════════════════════════
function gameProgressHook() {
    var report = function (ev) {
        try { if (window.parent && window.parent !== window && window.parent.__gnmathLoadProgress) window.parent.__gnmathLoadProgress(ev); } catch (e) {}
    };
    var seq = 0;
    var origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input) {
            // Files the page made itself (joined parts) were already counted
            var u = typeof input === "string" ? input : (input && input.url) || "";
            if (/^(blob|data):/i.test(u)) return origFetch.apply(this, arguments);
            var id = ++seq;
            report({ t: "start", id: id });
            return origFetch.apply(this, arguments).then(function (res) {
                try {
                    var total = Number(res.headers.get("content-length")) || 0;
                    report({ t: "progress", id: id, loaded: 0, total: total });
                    if (res.body && res.clone && !res.bodyUsed) {
                        var reader = res.clone().body.getReader();
                        var loaded = 0;
                        var pump = function () {
                            reader.read().then(function (r) {
                                if (r.done) { report({ t: "end", id: id, loaded: loaded, total: total }); return; }
                                loaded += r.value.byteLength;
                                report({ t: "progress", id: id, loaded: loaded, total: total });
                                pump();
                            }, function () { report({ t: "end", id: id, loaded: loaded, total: total }); });
                        };
                        pump();
                    } else {
                        report({ t: "end", id: id, loaded: total, total: total });
                    }
                } catch (e) { report({ t: "end", id: id }); }
                return res;
            }, function (err) { report({ t: "end", id: id }); throw err; });
        };
    }
    if (window.XMLHttpRequest) {
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function () {
            var id = ++seq;
            report({ t: "start", id: id });
            this.addEventListener("progress", function (e) {
                report({ t: "progress", id: id, loaded: e.loaded, total: e.lengthComputable ? e.total : 0 });
            });
            this.addEventListener("loadend", function (e) {
                report({ t: "end", id: id, loaded: e.loaded || 0, total: e.lengthComputable ? e.total : 0 });
            });
            return origSend.apply(this, arguments);
        };
    }
    // Every other file the page loads (scripts, images, sounds, styles): counted
    // when it finishes. fetch/XHR are already tracked above.
    try {
        new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (e) {
                if (e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest") return;
                report({ t: "file", bytes: e.encodedBodySize || e.transferSize || 0 });
            });
        }).observe({ type: "resource", buffered: true });
    } catch (e) {}
    // The page and everything it lists (not later downloads) has loaded
    if (document.readyState === "complete") report({ t: "pageload" });
    else window.addEventListener("load", function () { report({ t: "pageload" }); });
}

// ── Remembered size of each game ─────────────────────────────────────────────
// The first load can't know how big a game is (it keeps starting new
// downloads), so its finished size is saved and later loads show a real %.
const LOAD_SIZES_KEY = "gnmath-load-sizes";
function loadSizes() { try { return JSON.parse(localStorage.getItem(LOAD_SIZES_KEY) || "{}"); } catch { return {}; } }
function rememberLoadSize(id, bytes, ms) {
    if (!id || bytes < 50000) return;
    try {
        const all = loadSizes();
        delete all[id];
        all[id] = { b: Math.round(bytes), ms: Math.round(ms) };
        const keys = Object.keys(all);
        for (let i = 0; i < keys.length - 400; i++) delete all[keys[i]];
        localStorage.setItem(LOAD_SIZES_KEY, JSON.stringify(all));
    } catch {}
}

const SOURCE_NAMES = { jsdelivr: "jsDelivr", github: "GitHub", githack: "githack", fastly: "a jsDelivr backup", gcore: "a jsDelivr backup", testingcf: "a jsDelivr backup" };
const gameLoad = { phase: "idle", id: "", name: "", cover: "", reqs: new Map(), fileBytes: 0, files: 0, samples: [], started: 0, pageWritten: 0, pageLoaded: false,
    lastActivity: 0, lastBytesAt: 0, lastBytes: 0, known: 0, shownPct: 0, eta: 0, stage: "", timer: null, showTimer: null };

function gameLoadEl() {
    let el = document.getElementById("gameLoadBar");
    if (!el) {
        el = document.createElement("div");
        el.id = "gameLoadBar";
        el.setAttribute("role", "progressbar");
        el.setAttribute("aria-valuemin", "0");
        el.setAttribute("aria-valuemax", "100");
        el.innerHTML = `<img class="glb-cover" alt=""><div class="glb-main"><div class="glb-top"><span class="glb-text"></span><span class="glb-pct"></span></div>` +
            `<div class="glb-track"><div class="glb-fill"></div></div><div class="glb-stats"></div></div>`;
        document.body.appendChild(el);
    }
    return el;
}
function fmtMB(bytes) {
    const mb = bytes / 1048576;
    if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return mb >= 100 ? `${Math.round(mb)} MB` : mb >= 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(2)} MB`;
}
function fmtEta(sec) {
    if (!isFinite(sec) || sec <= 0) return "";
    if (sec < 3) return "a few seconds left";
    if (sec < 10) return `about ${Math.round(sec)}s left`;
    if (sec < 60) return `about ${Math.round(sec / 5) * 5}s left`;
    return `about ${Math.round(sec / 60)} min left`;
}

// Text and progress on the loading screen inside the game frame (before the
// game's own page replaces it)
function setFrameScreen(text, pct) {
    try {
        const doc = typeof zoneFrame !== "undefined" && zoneFrame && zoneFrame.contentDocument;
        const st = doc && doc.getElementById("gn-load-status");
        if (!st) return;
        st.textContent = text;
        const bar = doc.getElementById("gn-load-fill");
        if (bar) {
            bar.classList.toggle("ind", pct == null);
            if (pct != null) bar.style.width = pct + "%";
        }
    } catch {}
}

function setGameLoadView({ title, pct, stats }) {
    const el = gameLoadEl();
    el.querySelector(".glb-text").textContent = title;
    el.querySelector(".glb-pct").textContent = pct == null ? "" : pct + "%";
    const fill = el.querySelector(".glb-fill");
    fill.classList.toggle("glb-indeterminate", pct == null);
    if (pct != null) { fill.style.width = pct + "%"; el.setAttribute("aria-valuenow", pct); }
    else el.removeAttribute("aria-valuenow");
    el.setAttribute("aria-valuetext", [title, stats].filter(Boolean).join(", "));
    const st = el.querySelector(".glb-stats");
    st.textContent = stats || "";
    st.hidden = !stats;
}

function beginGameLoad(file) {
    endGameLoad(true);
    const saved = loadSizes()[String(file.id)];
    Object.assign(gameLoad, { phase: "page", id: String(file.id), name: file.name, reqs: new Map(), fileBytes: 0, files: 0, samples: [], started: Date.now(),
        pageWritten: 0, pageLoaded: false, lastActivity: Date.now(), lastBytesAt: Date.now(), lastBytes: 0,
        known: saved ? saved.b : 0, shownPct: 0, eta: 0, stage: "Finding the fastest source…" });
    const el = gameLoadEl();
    el.classList.remove("glb-done", "glb-show");
    const img = el.querySelector(".glb-cover");
    const cover = typeof coverSources === "function" ? (coverSources(file.cover)[0] || "") : "";
    img.hidden = !cover;
    if (cover) img.src = cover; else img.removeAttribute("src");
    gameLoad.timer = setInterval(renderGameLoad, 250);
    renderGameLoad();
}
// Which source the game page is coming from (called by the source loader)
function noteGameSource(name, index) {
    if (gameLoad.phase !== "page") return;
    const label = SOURCE_NAMES[name] || "another source";
    gameLoad.stage = index === 0 ? `Getting the game from ${label}…` : `That source is slow, also trying ${label}…`;
    renderGameLoad();
}
function markGamePageWritten() {
    if (gameLoad.phase !== "page") return;
    gameLoad.phase = "game";
    gameLoad.pageWritten = gameLoad.lastActivity = gameLoad.lastBytesAt = Date.now();
    // Show the bar over the game unless it finishes right away
    gameLoad.showTimer = setTimeout(() => { if (gameLoad.phase === "game") gameLoadEl().classList.add("glb-show"); }, 600);
}
function endGameLoad(immediate) {
    clearInterval(gameLoad.timer);
    clearTimeout(gameLoad.showTimer);
    const wasLoading = gameLoad.phase === "game";
    gameLoad.phase = "idle";
    const el = document.getElementById("gameLoadBar");
    if (!el) return;
    if (immediate) { el.classList.remove("glb-show", "glb-done"); return; }
    const secs = (Date.now() - gameLoad.started) / 1000;
    if (wasLoading) rememberLoadSize(gameLoad.id, totalLoaded(), Date.now() - gameLoad.started);
    el.classList.add("glb-done");
    setGameLoadView({ title: `${gameLoad.name} is ready`, pct: 100, stats: `Loaded in ${secs < 10 ? secs.toFixed(1) : Math.round(secs)}s` });
    el.querySelector(".glb-pct").textContent = "✓";
    setTimeout(() => { if (gameLoad.phase === "idle") el.classList.remove("glb-show"); }, 1400);
}

window.__gnmathLoadProgress = function (ev) {
    if (gameLoad.phase !== "page" && gameLoad.phase !== "game") return;
    const now = Date.now();
    gameLoad.lastActivity = now;
    if (ev.t === "pageload") { gameLoad.pageLoaded = true; return; }
    if (ev.t === "file") { gameLoad.files++; gameLoad.fileBytes += ev.bytes || 0; return; }
    let r = gameLoad.reqs.get(ev.id);
    if (!r) { r = { loaded: 0, total: 0, done: false, updated: now }; gameLoad.reqs.set(ev.id, r); }
    if (typeof ev.loaded === "number") r.loaded = Math.max(r.loaded, ev.loaded);
    if (ev.total) r.total = ev.total;
    r.updated = now;
    if (ev.t === "end") r.done = true;
};

function totalLoaded() {
    let n = gameLoad.fileBytes;
    for (const r of gameLoad.reqs.values()) n += r.loaded;
    return n;
}

function renderGameLoad() {
    if (gameLoad.phase === "idle") return;
    const now = Date.now();

    if (gameLoad.phase === "page") {
        const waited = (now - gameLoad.started) / 1000;
        setFrameScreen(waited > 12 ? `${gameLoad.stage.replace(/…$/, "")} — your network is slow, hang on…` : gameLoad.stage, null);
        return;
    }

    let loaded = gameLoad.fileBytes, sized = 0, sizedTotal = 0, unsized = false, inFlight = 0;
    for (const r of gameLoad.reqs.values()) {
        loaded += r.loaded;
        // A download that hasn't moved for 20s (e.g. a stream that never ends) stops counting
        const active = !r.done && now - r.updated < 20000;
        if (active) inFlight++;
        // Compressed downloads report a size smaller than what's read, so only trust
        // sizes that the loaded amount stays within
        if (r.total && r.loaded <= r.total) { sized += r.loaded; sizedTotal += r.total; }
        else if (active) unsized = true;
    }
    if (loaded > gameLoad.lastBytes) { gameLoad.lastBytes = loaded; gameLoad.lastBytesAt = now; }

    // Download speed over the last ~4 seconds
    gameLoad.samples.push([now, loaded]);
    while (gameLoad.samples.length > 2 && now - gameLoad.samples[0][0] > 4000) gameLoad.samples.shift();
    const [t0, b0] = gameLoad.samples[0];
    const speed = now - t0 > 500 ? (loaded - b0) / ((now - t0) / 1000) : 0;

    // Finished: the page has loaded and nothing has been downloading for a moment
    const quietFor = now - gameLoad.lastActivity;
    const nearKnown = gameLoad.known && loaded >= gameLoad.known * 0.9;
    if (inFlight === 0 && ((gameLoad.pageLoaded && quietFor > (nearKnown ? 600 : 1500)) || quietFor > 8000)) { endGameLoad(); return; }

    // Expected total: last time's size when known, else the sizes reported so far
    let total = 0;
    if (gameLoad.known) total = Math.max(gameLoad.known, loaded * 1.02);
    else if (sizedTotal && !unsized) total = loaded - sized + sizedTotal;

    let pct = null;
    if (total > 0) {
        // Never goes backwards, and stays below 100 until it's really done
        pct = Math.max(gameLoad.shownPct, Math.min(98, Math.floor(loaded / total * 100)));
        gameLoad.shownPct = pct;
    }

    const stalled = inFlight > 0 && now - gameLoad.lastBytesAt > 6000;
    let stats;
    if (loaded === 0) stats = "Starting up…";
    else if (stalled) stats = `${fmtMB(loaded)} so far · waiting on the network…`;
    else {
        const parts = [total ? `${fmtMB(loaded)} of ${fmtMB(total)}` : `${fmtMB(loaded)} so far`];
        if (speed > 20000) parts.push(`${fmtMB(speed)}/s`);
        if (total && speed > 20000) {
            const raw = (total - loaded) / speed;
            gameLoad.eta = gameLoad.eta ? gameLoad.eta * 0.7 + raw * 0.3 : raw;
            const e = fmtEta(gameLoad.eta);
            if (e) parts.push(e);
        } else if (!gameLoad.known && loaded > 2097152) parts.push("first time on this device, so the size isn't known yet");
        stats = parts.join(" · ");
    }
    setGameLoadView({ title: `Loading ${gameLoad.name}`, pct, stats });
}
