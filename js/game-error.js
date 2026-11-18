// ═════════════════════════════════════════════════════════════════════════════
// When a game really breaks: a red bar across the top and an "isn't
// responding" box with what to do (Reload game / Report it / Keep waiting).
// The game page tells us (gameErrorHook in errors.js) only when an error is
// followed by the game stopping, it never starts, its graphics are lost, or
// its engine shows a fatal alert — not for the many harmless errors games log.
// Once per game opened; it goes away by itself if the game was closed.
// ═════════════════════════════════════════════════════════════════════════════
const GAME_FATAL_TEXT = {
    stopped: ["isn't responding", "The game stopped right after an error. Reloading it usually fixes this."],
    start: ["couldn't start", "The game hit an error while loading and never started. Reloading it may fix this; if it keeps happening, report it so it can be fixed."],
    graphics: ["lost its graphics", "The game's 3D graphics (WebGL) stopped working. This happens when the computer runs low on graphics memory. Reloading the game usually brings them back; closing other tabs helps."],
    crash: ["crashed", "The game's engine hit an error it couldn't recover from. Reloading it may fix this."]
};
let gameFatalShownFor = null;
function closeGameFatal() {
    document.querySelectorAll(".gfe-bar, .gfe-wrap").forEach(el => el.remove());
}
window.__gnmathGameFatal = function (ev) {
    try {
        const zone = typeof currentZone === "function" ? currentZone() : null;
        if (!zone || zoneViewer.style.display === "none") return;
        // Once per game page (a reload gets a new page, so it can show again)
        let win = null; try { win = zoneFrame.contentWindow; } catch {}
        if (!win || gameFatalShownFor === win) return;
        gameFatalShownFor = win;
        const [what, help] = GAME_FATAL_TEXT[ev.kind] || GAME_FATAL_TEXT.crash;
        const detail = String(ev.message || "").trim();
        closeGameFatal();
        // Red bar at the top
        const bar = document.createElement("div");
        bar.className = "gfe-bar";
        bar.setAttribute("role", "alert");
        bar.innerHTML = `${gnIcon("warning")}<span></span><button type="button" class="gfe-x" aria-label="Hide">×</button>`;
        bar.querySelector("span").textContent = `Error: ${zone.name} ${what}${detail ? ` (${detail.slice(0, 90)}${detail.length > 90 ? "…" : ""})` : ""}.`;
        bar.querySelector(".gfe-x").onclick = closeGameFatal;
        // The box
        const wrap = document.createElement("div");
        wrap.className = "gfe-wrap";
        wrap.innerHTML = `<div class="gfe-dlg" role="alertdialog" aria-modal="false" aria-labelledby="gfe-title">
            <div class="gfe-tt"></div>
            <div class="gfe-bd"><div class="gfe-ic">!</div><div><b id="gfe-title"></b><p class="gfe-help"></p>
                ${detail ? `<details class="gfe-more"><summary>What the game said</summary><code></code></details>` : ""}</div></div>
            <div class="gfe-bt"><button type="button" class="gfe-wait">Keep waiting</button><button type="button" class="gfe-report">Report it</button><button type="button" class="gfe-reload">Reload game</button></div>
        </div>`;
        wrap.querySelector(".gfe-tt").textContent = zone.name;
        wrap.querySelector("#gfe-title").textContent = `${zone.name} ${what}`;
        wrap.querySelector(".gfe-help").textContent = help;
        if (detail) wrap.querySelector(".gfe-more code").textContent = detail;
        wrap.querySelector(".gfe-wait").onclick = closeGameFatal;
        wrap.querySelector(".gfe-reload").onclick = () => { closeGameFatal(); openZone(zone); };
        wrap.querySelector(".gfe-report").onclick = () => {
            closeGameFatal();
            if (typeof openFeedback !== "function") { if (typeof reportCurrentZone === "function") reportCurrentZone(); return; }
            openFeedback("bug", { zone });
            // Filled in with what happened (they can change it)
            setTimeout(() => {
                const t = document.getElementById("fb-title"), d = document.getElementById("fb-details");
                if (t && !t.value) t.value = `${zone.name} ${what}`.slice(0, 80);
                if (d && !d.value) d.value = `The site showed "${zone.name} ${what}".${detail ? " The game said: " + detail : ""}`.slice(0, 1000);
            }, 50);
        };
        // Inside the game area, so it's there in fullscreen too
        const host = document.fullscreenElement && document.fullscreenElement.tagName !== "IFRAME" ? document.fullscreenElement : document.body;
        host.append(bar, wrap);
        try { if (document.fullscreenElement && document.fullscreenElement.tagName === "IFRAME") document.exitFullscreen(); } catch {}
        wrap.querySelector(".gfe-reload").focus({ preventScroll: true });
    } catch (e) { console.warn("Couldn't show the game error box", e); }
};
