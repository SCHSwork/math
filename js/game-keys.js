// ═════════════════════════════════════════════════════════════════════════════
// Keyboard for games
// A game only gets key presses while it has the keyboard focus. Things that
// used to leave the keyboard somewhere else:
//  - Opening a game from its card left the focus on the card behind the game,
//    so the first keys went to the site (Space or Enter opened the game again,
//    arrows scrolled the page) until you clicked inside the game.
//  - Clicking a button in the game's top bar (Random game, Mute, Like, Close…)
//    kept the focus on that button, so Space or Enter pressed it again: Space to
//    jump could start a different random game.
//  - Games that are a page inside a page, Flash games (Ruffle) and emulator
//    games (EmulatorJS) only listen on their own player, not the whole page.
//  - Leaving fullscreen put the keyboard back on the site.
// Emulator games also say "press A" for a console button. Which key that is
// (Z, by default) is shown once when the emulator starts, and in ⋯ More.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const viewerOpen = () => zoneViewer && zoneViewer.style.display === "flex";

    // Something of the site's own is using the keyboard (a box, a panel, a menu)
    function siteNeedsKeyboard() {
        const a = document.activeElement;
        if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
        if (document.querySelector(".dialog-overlay")) return true;
        const pop = document.getElementById("popupOverlay");
        if (pop && pop.style.display === "flex") return true;
        if (document.getElementById("gameMenu")) return true;
        return false;
    }

    // The thing in a game page that should get the keys: the biggest player
    // (a page inside the page, a Flash player, an emulator), if the game hasn't
    // put the focus anywhere itself.
    function focusInside(win, depth) {
        let doc;
        try { if (depth) win.focus(); } catch (e) {}
        try { doc = win.document; } catch (e) { return; }         // another site's page
        if (!doc || !doc.body) return;
        const a = doc.activeElement;
        if (a && a !== doc.body && a !== doc.documentElement) {
            if (a.tagName === "IFRAME" && depth < 3) { try { focusInside(a.contentWindow, depth + 1); } catch (e) {} }
            return;
        }
        const vw = win.innerWidth || 1, vh = win.innerHeight || 1;
        let best = null, bestArea = vw * vh * 0.3;                // must cover a good part of the page
        const list = doc.querySelectorAll("iframe, embed, object, ruffle-player, ruffle-object, ruffle-embed, [tabindex]");
        for (let i = 0; i < list.length && i < 200; i++) {
            const el = list[i];
            if (el.tabIndex < -1 || el.closest("[hidden]")) continue;
            const r = el.getBoundingClientRect();
            const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            if (area > bestArea) { best = el; bestArea = area; }
        }
        if (!best) return;
        try { best.focus({ preventScroll: true }); } catch (e) {}
        if (best.tagName === "IFRAME" && depth < 3) { try { focusInside(best.contentWindow, depth + 1); } catch (e) {} }
    }

    function focusGame() {
        if (!viewerOpen() || !zoneFrame || !zoneFrame.isConnected) return;
        try { zoneFrame.focus({ preventScroll: true }); } catch (e) {}
        try { zoneFrame.contentWindow.focus(); } catch (e) {}
        try { focusInside(zoneFrame.contentWindow, 0); } catch (e) {}
    }
    window.focusGame = focusGame;

    // The keyboard is "free" for the game: on the page itself, on the frame, or
    // still on the card/button that opened the game (behind the game screen)
    function keyboardIsFree() {
        if (siteNeedsKeyboard()) return false;
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement || a === zoneFrame) return true;
        return !zoneViewer.contains(a);
    }

    // After a game page is written (or loads), and a few times while it starts,
    // as long as the player hasn't moved the keyboard somewhere else
    let tries = [];
    function settleFocus() {
        tries.forEach(clearTimeout);
        const token = typeof zoneOpenToken === "number" ? zoneOpenToken : 0;
        const go = () => {
            if (typeof zoneOpenToken === "number" && zoneOpenToken !== token) return;
            if (keyboardIsFree()) focusGame();
        };
        go();
        tries = [300, 1000, 2500, 5000].map(ms => setTimeout(go, ms));
    }
    window.gnGameKeysAfterWrite = settleFocus;
    // After a ⋯ More item or Esc closes the menu (unless it opened a panel)
    window.gnGameKeysReturn = () => setTimeout(() => { if (viewerOpen() && keyboardIsFree()) focusGame(); }, 0);

    // A new frame for every game: hook its load
    const watchFrame = f => {
        if (!f || f.__gnKeys) return;
        f.__gnKeys = true;
        f.addEventListener("load", () => {
            if (f !== zoneFrame) return;
            settleFocus();
            watchFrameBlur(f);
            watchEmulator(f);
        });
    };
    new MutationObserver(() => watchFrame(zoneFrame)).observe(zoneViewer, { childList: true });
    watchFrame(zoneFrame);

    // Top-bar buttons clicked with the mouse hand the keyboard back to the game
    // (Tab + Enter still works the normal way: only real clicks do this)
    // (capture: some buttons redraw their icon when clicked, which takes the
    // clicked part off the page before the click gets here)
    zoneViewer.addEventListener("click", e => {
        if (!e.detail) return;                                     // Enter/Space on a focused button
        const btn = e.target.closest && e.target.closest(".zone-controls button, .zone-controls a");
        if (!btn) return;
        setTimeout(() => {
            if (!viewerOpen()) return;
            if (btn.getAttribute("aria-expanded") === "true") return;   // it opened a menu or panel
            if (siteNeedsKeyboard()) return;
            const a = document.activeElement;
            if (a === btn || a === document.body || !zoneViewer.contains(a) || a === zoneFrame) focusGame();
        }, 0);
    }, true);
    // Clicking the empty space around the game, too
    zoneViewer.addEventListener("mousedown", e => {
        if (e.target === zoneViewer) setTimeout(() => { if (keyboardIsFree()) focusGame(); }, 0);
    });

    // A key pressed while a game is open but the keyboard is on the page (not on
    // a box or a button): don't let the page scroll, and give the keyboard back
    window.addEventListener("keydown", e => {
        if (!viewerOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
        const a = document.activeElement;
        if (a && a !== document.body && a !== document.documentElement) return;
        if (siteNeedsKeyboard() || e.key === "Escape" || e.key === "Tab") return;
        if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(e.key)) e.preventDefault();
        focusGame();
    });

    // Fullscreen on or off: keys go to the game
    document.addEventListener("fullscreenchange", () => {
        if (!viewerOpen()) return;
        setTimeout(() => { if (!siteNeedsKeyboard()) focusGame(); }, 60);
    });

    // The "hide the tab preview" cover used to come on when you clicked into a
    // game (the site loses focus to the game). Only cover it when the whole
    // tab lost focus, whether from the site or from the game.
    function watchFrameBlur(f) {
        let w;
        try { w = f.contentWindow; w.document; } catch (e) { return; }
        if (!w || w.__gnBlurWatch) return;                          // the window outlives the pages written into it
        w.__gnBlurWatch = true;
        w.addEventListener("blur", () => {
            setTimeout(() => {
                if (typeof handlePreviewCloakTrigger === "function" && !document.hasFocus()) handlePreviewCloakTrigger("blur");
            }, 0);
        });
        w.addEventListener("focus", () => { if (typeof setTabPreviewCloak === "function") setTabPreviewCloak(false); });
    }

    // ── Emulator controls ──────────────────────────────────────────────────
    // EmulatorJS buttons (RetroPad numbers) and what each console calls them
    const PAD = {
        nes: [[8, "A"], [0, "B"], [3, "Start"], [2, "Select"]],
        gb:  [[8, "A"], [0, "B"], [3, "Start"], [2, "Select"]],
        gba: [[8, "A"], [0, "B"], [10, "L"], [11, "R"], [3, "Start"], [2, "Select"]],
        vb:  [[8, "A"], [0, "B"], [10, "L"], [11, "R"], [3, "Start"], [2, "Select"]],
        snes: [[8, "A"], [0, "B"], [9, "X"], [1, "Y"], [10, "L"], [11, "R"], [3, "Start"], [2, "Select"]],
        nds: [[8, "A"], [0, "B"], [9, "X"], [1, "Y"], [10, "L"], [11, "R"], [3, "Start"], [2, "Select"]],
        psx: [[0, "✕"], [8, "○"], [1, "□"], [9, "△"], [10, "L1"], [11, "R1"], [12, "L2"], [13, "R2"], [3, "Start"], [2, "Select"]],
        segaMD: [[1, "A"], [0, "B"], [8, "C"], [3, "Start"]],
        n64: [[0, "A"], [1, "B"], [12, "Z"], [10, "L"], [11, "R"], [3, "Start"]],
        def: [[8, "A"], [0, "B"], [9, "X"], [1, "Y"], [10, "L"], [11, "R"], [3, "Start"], [2, "Select"]]
    };
    const ARROWS = { "up arrow": "↑", "down arrow": "↓", "left arrow": "←", "right arrow": "→" };

    function keyName(emu, code) {
        if (code === undefined || code === null || code === "" || code === -1) return "";
        let n = typeof code === "number" ? (emu.keyMap && emu.keyMap[code]) : String(code);
        if (!n) return "";
        n = String(n).toLowerCase();
        if (ARROWS[n]) return ARROWS[n];
        if (n.length === 1) return n.toUpperCase();
        return n.replace(/\b\w/g, c => c.toUpperCase());
    }

    // [[console button, key], …] for player 1, or null if this isn't EmulatorJS
    function emulatorKeys(win) {
        let emu;
        try { emu = win.EJS_emulator; } catch (e) { return null; }
        if (!emu || !emu.controls || !emu.controls[0]) return null;
        let scheme = "";
        try { scheme = String(emu.getControlScheme ? emu.getControlScheme() : (emu.getCore ? emu.getCore(true) : "")); } catch (e) {}
        const pad = PAD[scheme] || PAD[{ gbc: "gb", sega: "segaMD", segaGG: "gb", segaMS: "gb" }[scheme]] || PAD.def;
        const c = emu.controls[0];
        const out = [];
        const dpad = [4, 5, 6, 7].map(i => keyName(emu, c[i] && c[i].value));
        if (dpad.join("") === "↑↓←→") out.push(["D-pad", "Arrow keys"]);
        else if (dpad.some(Boolean)) out.push(["D-pad", dpad.join(" ")]);
        for (const [id, label] of pad) {
            const k = keyName(emu, c[id] && c[id].value);
            if (k) out.push([label, k]);
        }
        return out.length ? out : null;
    }

    function showEmulatorKeys(keys, quiet) {
        if (!keys) {
            if (!quiet) notify("This game doesn't use the emulator, so its keys are the ones the game says.");
            return;
        }
        const list = keys.map(([b, k]) => `${b} = ${k}`).join(" · ");
        notify(`Controls: ${list}. To change them, use the 🎮 button in the emulator's bottom bar.`, { type: "info", duration: quiet ? 12000 : 15000 });
    }

    function currentGameWindow() {
        try { return viewerOpen() && zoneFrame ? zoneFrame.contentWindow : null; } catch (e) { return null; }
    }
    window.currentEmulatorKeys = () => { const w = currentGameWindow(); return w ? emulatorKeys(w) : null; };
    window.showGameControls = () => showEmulatorKeys(window.currentEmulatorKeys(), false);

    // Show the keys once, when an emulator game actually starts
    function watchEmulator(f) {
        let w, doc;
        try { w = f.contentWindow; doc = w.document; } catch (e) { return; }
        // The loading screen and the game are written into the same window, one
        // after the other: watch each page once
        if (!w || !doc || doc.__gnEmuWatch) return;
        doc.__gnEmuWatch = true;
        let n = 0;
        const t = setInterval(() => {
            let same = false;
            try { same = w.document === doc; } catch (e) {}
            if (++n > 600 || !same || f !== zoneFrame || !viewerOpen()) { clearInterval(t); return; }   // up to 10 minutes
            let emu;
            try { emu = w.EJS_emulator; } catch (e) { clearInterval(t); return; }
            if (!emu) { if (n > 20 && !hasEmulatorPage(w)) clearInterval(t); return; }
            if (!emu.started) return;
            clearInterval(t);
            showEmulatorKeys(emulatorKeys(w), true);
            // EmulatorJS only listens on its own player
            setTimeout(() => { if (keyboardIsFree() || isOnFrame()) focusGame(); }, 200);
        }, 1000);
    }
    function isOnFrame() { return document.activeElement === zoneFrame; }
    function hasEmulatorPage(w) {
        try { return !!(w.EJS_player || w.EJS_core || w.document.querySelector("script[src*='loader.js']")); } catch (e) { return false; }
    }
})();
