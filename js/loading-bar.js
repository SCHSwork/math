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
        window.fetch = function () {
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
}

const gameLoad = { phase: "idle", name: "", reqs: new Map(), samples: [], started: 0, pageWritten: 0, lastEnd: 0, everStarted: false, timer: null, showTimer: null };

function gameLoadEl() {
    let el = document.getElementById("gameLoadBar");
    if (!el) {
        el = document.createElement("div");
        el.id = "gameLoadBar";
        el.setAttribute("role", "progressbar");
        el.innerHTML = `<div class="glb-text"></div><div class="glb-stats"></div><div class="glb-track"><div class="glb-fill"></div></div>`;
        document.body.appendChild(el);
    }
    return el;
}
function fmtMB(bytes) {
    const mb = bytes / 1048576;
    return mb >= 100 ? `${Math.round(mb)} MB` : mb >= 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(2)} MB`;
}
function fmtEta(sec) {
    if (!isFinite(sec) || sec <= 0) return "";
    if (sec < 60) return `about ${Math.max(1, Math.round(sec))}s left`;
    return `about ${Math.round(sec / 60)} min left`;
}

function setGameLoadText(title, stats) {
    const el = gameLoadEl();
    el.querySelector(".glb-text").textContent = title;
    const st = el.querySelector(".glb-stats");
    st.textContent = stats || "";
    st.style.display = stats ? "" : "none";
}

function beginGameLoad(file) {
    endGameLoad(true);
    Object.assign(gameLoad, { phase: "page", name: file.name, reqs: new Map(), samples: [], started: Date.now(), pageWritten: 0, lastEnd: 0, everStarted: false });
    const el = gameLoadEl();
    el.classList.remove("glb-done");
    // Don't flash the bar for games that open instantly
    gameLoad.showTimer = setTimeout(() => { if (gameLoad.phase !== "idle") el.classList.add("glb-show"); }, 700);
    gameLoad.timer = setInterval(renderGameLoad, 400);
    renderGameLoad();
}
function markGamePageWritten() {
    if (gameLoad.phase !== "page") return;
    gameLoad.phase = "game";
    gameLoad.pageWritten = Date.now();
}
function endGameLoad(immediate) {
    clearInterval(gameLoad.timer);
    clearTimeout(gameLoad.showTimer);
    gameLoad.phase = "idle";
    const el = document.getElementById("gameLoadBar");
    if (!el) return;
    if (immediate) { el.classList.remove("glb-show", "glb-done"); return; }
    el.classList.add("glb-done");
    el.querySelector(".glb-fill").style.width = "100%";
    el.querySelector(".glb-fill").classList.remove("glb-indeterminate");
    setGameLoadText(`${gameLoad.name} is ready!`, "");
    setTimeout(() => el.classList.remove("glb-show"), 900);
}

window.__gnmathLoadProgress = function (ev) {
    if (gameLoad.phase !== "page" && gameLoad.phase !== "game") return;
    const now = Date.now();
    let r = gameLoad.reqs.get(ev.id);
    if (!r) { r = { loaded: 0, total: 0, done: false, updated: now }; gameLoad.reqs.set(ev.id, r); }
    if (ev.t === "start") gameLoad.everStarted = true;
    if (typeof ev.loaded === "number") r.loaded = Math.max(r.loaded, ev.loaded);
    if (ev.total) r.total = ev.total;
    r.updated = now;
    if (ev.t === "end") { r.done = true; gameLoad.lastEnd = now; }
};

function renderGameLoad() {
    if (gameLoad.phase === "idle") return;
    const el = gameLoadEl();
    const text = el.querySelector(".glb-text");
    const fill = el.querySelector(".glb-fill");
    const now = Date.now();

    if (gameLoad.phase === "page") {
        setGameLoadText(`Opening ${gameLoad.name}…`, "");
        fill.classList.add("glb-indeterminate");
        return;
    }

    let loaded = 0, total = 0, allKnown = true, inFlight = 0;
    for (const r of gameLoad.reqs.values()) {
        loaded += r.loaded;
        if (r.total) total += Math.max(r.total, r.loaded); else if (r.loaded > 0 || !r.done) allKnown = false;
        // A request that hasn't moved for 15s (e.g. a stream that never ends) stops counting
        if (!r.done && now - r.updated < 15000) inFlight++;
    }

    // Download speed from the last ~4 seconds
    gameLoad.samples.push([now, loaded]);
    while (gameLoad.samples.length > 2 && now - gameLoad.samples[0][0] > 4000) gameLoad.samples.shift();
    const [t0, b0] = gameLoad.samples[0];
    const speed = now > t0 ? (loaded - b0) / ((now - t0) / 1000) : 0;

    // Finished: nothing downloading for a moment
    const idleSince = Math.max(gameLoad.pageWritten, gameLoad.lastEnd);
    const idleNeeded = gameLoad.everStarted ? 1500 : 5000;
    if (inFlight === 0 && now - idleSince > idleNeeded) { endGameLoad(); return; }

    if (!gameLoad.everStarted || loaded === 0) {
        setGameLoadText(`Starting ${gameLoad.name}…`, "");
        fill.classList.add("glb-indeterminate");
        return;
    }
    if (allKnown && total > 0) {
        const pct = Math.min(99, Math.floor(loaded / total * 100));
        const eta = speed > 0 ? fmtEta((total - loaded) / speed) : "";
        fill.classList.remove("glb-indeterminate");
        fill.style.width = pct + "%";
        el.setAttribute("aria-valuenow", pct);
        setGameLoadText(`Loading ${gameLoad.name}`, `${pct}% · ${fmtMB(loaded)} of ${fmtMB(total)}${eta ? " · " + eta : ""}`);
    } else {
        fill.classList.add("glb-indeterminate");
        el.removeAttribute("aria-valuenow");
        setGameLoadText(`Loading ${gameLoad.name}`, `${fmtMB(loaded)} downloaded${speed > 0 ? ` · ${fmtMB(speed)}/s` : ""}`);
    }
}
