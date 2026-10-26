// ════════════════════════════════════════════════════════════════════════════
// Fit games to the screen.
// Many games are made for one fixed size (an 800×600 Flash game, a 960×600 Unity
// page, an 800×400 canvas). On a big screen they sat small in the top-left
// corner; on a phone or a short laptop screen their bottom or right side was
// cut off. gameFitHook runs inside every game page (added by cleanGameHtml),
// finds the game's main surface, and if it doesn't fit the window it scales it
// up or down to fit, keeps its shape, and centers it. Games that already fill
// the window (most of them) are left alone.
// Games where this causes trouble can be switched off from the game's ⋯ More
// menu ("Fit game to screen"); the choice is remembered per game.
// ════════════════════════════════════════════════════════════════════════════
function gameFitHook() {
    var mode = "auto";
    try { if (window.parent && window.parent !== window && window.parent.__gnmathFitMode) mode = window.parent.__gnmathFitMode(); } catch (e) {}
    if (mode === "off") return;
    // Flash games (Ruffle): draw black bars beside the game instead of showing the
    // game's off-stage area in its background color (white bars, half-drawn art).
    // Ruffle reads this when it starts; a page that sets its own options keeps them.
    try {
        var RP = window.RufflePlayer = window.RufflePlayer || {};
        var rcfg = Object.assign({ letterbox: "on" }, RP.config || {});
        Object.defineProperty(RP, "config", { configurable: true, enumerable: true,
            get: function () { return rcfg; }, set: function (v) { rcfg = Object.assign({ letterbox: "on" }, v || {}); } });
    } catch (e) {}
    var SURFACES = "canvas,embed,object,video,ruffle-player,ruffle-embed,ruffle-object";
    var cur = null;          // { el, box, ruffle, saved, savedEl, w, h, s }
    var stable = { el: null, w: 0, h: 0, n: 0 };
    var t0 = Date.now();
    var htmlSaved = null;
    var layers = [];         // other surfaces stacked exactly on the game (loading screens, UI canvases)

    function shown(el) {
        var cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
    }
    function pickMain() {
        var list = document.querySelectorAll(SURFACES), found = [];
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.tagName === "OBJECT" && el.querySelector("embed,ruffle-embed")) continue;
            var w = el.offsetWidth, h = el.offsetHeight;
            if (w < 200 || h < 150 || !shown(el)) continue;
            found.push({ el: el, a: w * h, r: el.getBoundingClientRect() });
        }
        if (!found.length) return null;
        found.sort(function (x, y) { return y.a - x.a; });
        var best = found[0];
        layers = [];
        // Another surface about as big: fine if it's a layer on top of the game
        // (a loading screen or UI canvas), not if it's beside it (split screens)
        for (var j = 1; j < found.length; j++) {
            var o = found[j];
            if (o.a < best.a * 0.6) break;
            var ix = Math.max(0, Math.min(best.r.right, o.r.right) - Math.max(best.r.left, o.r.left));
            var iy = Math.max(0, Math.min(best.r.bottom, o.r.bottom) - Math.max(best.r.top, o.r.top));
            if (ix * iy < Math.min(best.r.width * best.r.height, o.r.width * o.r.height) * 0.85) return null;
            layers.push(o.el);
        }
        return best.el;
    }
    // The element to move: the surface, or a wrapper just around it (so overlays
    // like "click to play" buttons and loading bars move with it)
    function boxFor(el) {
        var box = el, W = window.innerWidth, H = window.innerHeight;
        for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
            var pw = p.offsetWidth, ph = p.offsetHeight;
            if (pw >= W - 2 && ph >= H - 2) break;                       // a full-page wrapper
            if (pw < el.offsetWidth - 2 || pw > el.offsetWidth * 1.15 + 30) break;
            if (ph < el.offsetHeight - 2 || ph > el.offsetHeight * 1.3 + 40) break;
            if (getComputedStyle(p).display === "inline") break;
            box = p;
        }
        return box;
    }
    function textOutside(box) {
        try {
            var all = (document.body.innerText || "").replace(/\s+/g, " ").length;
            var inside = (box.innerText || "").replace(/\s+/g, " ").length;
            return all - inside;
        } catch (e) { return 0; }
    }
    function restore() {
        if (!cur) return;
        if (cur.saved === null) cur.box.removeAttribute("style"); else cur.box.setAttribute("style", cur.saved);
        if (cur.ruffle && cur.el !== cur.box) { if (cur.savedEl === null) cur.el.removeAttribute("style"); else cur.el.setAttribute("style", cur.savedEl); }
        (cur.layers || []).forEach(function (l) { if (l.saved === null) l.el.removeAttribute("style"); else l.el.setAttribute("style", l.saved); });
        if (htmlSaved) {
            document.documentElement.style.overflow = htmlSaved.ho; document.documentElement.style.background = htmlSaved.hb;
            if (document.body) document.body.style.overflow = htmlSaved.bo;
            htmlSaved = null;
        }
        cur = null;
    }
    function set(el, css) {
        for (var k in css) el.style.setProperty(k, css[k], "important");
    }
    function blackBackground(force) {
        if (htmlSaved) return;
        var de = document.documentElement, b = document.body;
        htmlSaved = { ho: de.style.overflow, hb: de.style.background, bo: b ? b.style.overflow : "" };
        de.style.overflow = "hidden";
        if (b) b.style.overflow = "hidden";
        var bg = b ? getComputedStyle(b).backgroundColor : "";
        var hbg = getComputedStyle(de).backgroundColor;
        var light = function (c) { var m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(c); return !m || (m[4] !== undefined && Number(m[4]) < 0.1) || (+m[1] + +m[2] + +m[3]) > 600; };
        if (force || (light(bg) && light(hbg))) { de.style.background = "#000"; if (b && light(bg)) b.style.background = "transparent"; }
    }
    // Game engines that read where you click from the game's on-screen size, so
    // they still click right when the game is drawn bigger or smaller. Games we
    // can't identify (often hand-written) may not, so those are only moved to the
    // center (and made smaller only if they don't fit at all).
    function knownEngine(el) {
        var w = window;
        try {
            if (w.createUnityInstance || w.UnityLoader || w.unityInstance || w.gameInstance) return true;          // Unity
            if (w.Module && (w.Module.canvas || w.Module.calledRun !== undefined)) return true;                     // Emscripten (Unity, Godot, C++ games)
            if (w.Engine && w.Engine.prototype && w.Engine.prototype.startGame) return true;                         // Godot
            if (w.Phaser || w.PIXI || w.pc || w.cc || w.BABYLON || w.PlayCanvas || w.Laya || w.createjs) return true;   // Phaser, PixiJS, PlayCanvas, Cocos, Babylon…
            if (w.cr_createRuntime || w.C3 || w.cr || w.c2_callFunction) return true;                              // Construct
            if (w.GameMaker_Init || w.g_pBuiltIn || w.GML_Init || (el.id === "canvas" && w.yyGetInt32)) return true;  // GameMaker
            if (w.MMFRuntime || el.id === "MMFCanvas") return true;                                                 // Clickteam Fusion
            if (w.Ruffle || w.RufflePlayer) return true;
            if (/unity|webgl-content|gameContainer/i.test((el.parentElement && el.parentElement.id) || "")) return true;
        } catch (e) {}
        return false;
    }
    function apply(el, box, w, h, s) {
        var ruffle = /^RUFFLE/.test(el.tagName);
        if (!cur || cur.box !== box) {
            restore();
            cur = { el: el, box: box, ruffle: ruffle, saved: box.getAttribute("style"), savedEl: el.getAttribute("style") };
        }
        cur.w = w; cur.h = h; cur.s = s; cur.ew = el.offsetWidth; cur.eh = el.offsetHeight;
        var place = { position: "fixed", left: "50%", top: "50%", margin: "0", "max-width": "none", "max-height": "none", "min-width": "0", "min-height": "0", "box-sizing": "border-box" };
        if (ruffle) {
            // Flash: make the player itself bigger, so it draws sharp at the new size
            place.width = Math.floor(w * s) + "px"; place.height = Math.floor(h * s) + "px";
            place.transform = "translate(-50%, -50%)";
            set(box === el ? el : box, place);
            if (box !== el) set(el, { width: "100%", height: "100%" });
            blackBackground(true);
        } else {
            if (s === 1 && cur.centerOnly) {
                // Just centered: whole pixels, no transform, so even games that
                // work out clicks the simple way keep working
                place.left = Math.round((window.innerWidth - w) / 2) + "px";
                place.top = Math.round((window.innerHeight - h) / 2) + "px";
                place.transform = "none";
            } else {
                place.transform = "translate(-50%, -50%) scale(" + s + ")";
                place["transform-origin"] = "50% 50%";
            }
            set(box, place);
            // A wrapper keeps its size when it stops being part of the page (not
            // !important, so the game can still resize it)
            if (box !== el) { box.style.width = w + "px"; box.style.height = h + "px"; }
            else {
                // Layers that sit on the game but aren't inside a shared wrapper move with it
                if (!cur.layers) cur.layers = layers.filter(function (l) { return !box.contains(l); }).map(function (l) { return { el: l, saved: l.getAttribute("style") }; });
                cur.layers.forEach(function (l) { set(l.el, place); });
            }
        }
        blackBackground();
    }
    function check() {
        if (!document.body) return;
        var el = pickMain();
        if (!el) { if (cur && !document.contains(cur.el)) restore(); return; }
        var W = window.innerWidth, H = window.innerHeight;
        if (W < 100 || H < 100) return;
        // Flash games: Ruffle shows the page behind the game's sides (often white or
        // grey bars, plus the page's 8px margin); make that black
        if (/^RUFFLE/.test(el.tagName) && !el.__gnBlack) {
            el.__gnBlack = true;
            el.style.setProperty("background", "#000", "important");
            if (el.offsetWidth >= W - 24 && el.offsetHeight >= H - 24 && document.body) { document.body.style.margin = "0"; document.documentElement.style.background = "#000"; document.body.style.background = "#000"; }
        }
        if (cur && cur.el === el) {
            // Already placed: just follow size changes of the game and the window
            var w = cur.ruffle ? cur.w : cur.box.offsetWidth, h = cur.ruffle ? cur.h : cur.box.offsetHeight;
            if (!cur.ruffle && (Math.abs(el.offsetWidth - cur.ew) > 2 || Math.abs(el.offsetHeight - cur.eh) > 2 || Math.abs(w - cur.w) > 2 || Math.abs(h - cur.h) > 2)) {
                // The game resized itself; if it now fills the window by itself, step back
                restore(); stable.n = 0; return;
            }
            var s = Math.min(W / w, H / h, 4);
            if (cur.centerOnly) s = Math.min(s, 1) > 0.995 ? 1 : Math.min(s, 1);
            if (Math.abs(s - cur.s) > 0.005 || cur.centerOnly) apply(el, cur.box, w, h, s);
            return;
        }
        // Wait until the game's size has settled (games resize while they load)
        if (stable.el !== el || Math.abs(stable.w - el.offsetWidth) > 2 || Math.abs(stable.h - el.offsetHeight) > 2) {
            stable = { el: el, w: el.offsetWidth, h: el.offsetHeight, n: 0 };
            return;
        }
        if (++stable.n < 2) return;
        var box = boxFor(el);
        var r = box.getBoundingClientRect();
        var bw = box.offsetWidth, bh = box.offsetHeight;
        if (!bw || !bh) return;
        var over = r.right > W + 4 || r.bottom > H + 4 || r.left < -4 || r.top < -4;
        var small = bw < W * 0.9 && bh < H * 0.9;
        var off = Math.abs(r.left - (W - r.right)) > Math.max(24, W * 0.06) || Math.abs(r.top - (H - r.bottom)) > Math.max(24, H * 0.06);
        if (!(over || small || off)) return;
        // Pages with lots of text around the game (instructions, articles) keep their layout
        if (!over && textOutside(box) > 600) return;
        var s = Math.min(W / bw, H / bh, 4);
        var centerOnly = !/^RUFFLE/.test(el.tagName) && !knownEngine(el);
        if (centerOnly) s = over ? Math.min(s, 1) : 1;
        apply(el, box, bw, bh, s);
        cur.centerOnly = centerOnly;
        if (centerOnly && s === 1) apply(el, box, bw, bh, 1);   // place it with whole pixels
    }
    var timer = null;
    function loop() {
        try { check(); } catch (e) {}
        var age = Date.now() - t0;
        if (age < 5 * 60 * 1000) timer = setTimeout(loop, age < 30000 ? 700 : 2500);
    }
    // Turning a phone or resizing the window: fit again right away
    window.addEventListener("resize", function () {
        if (stable.n < 1) stable.n = 1;
        try { check(); } catch (e) {}
        setTimeout(function () { try { check(); } catch (e) {} }, 400);
        setTimeout(function () { try { check(); } catch (e) {} }, 1200);
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loop); else loop();
}

// ── Site side: per-game on/off (⋯ More → Fit game to screen) ─────────────────
const FIT_OFF_KEY = "gnmath-fit-off";
function fitOffList() { try { return JSON.parse(localStorage.getItem(FIT_OFF_KEY) || "[]"); } catch { return []; } }
function isFitOff(id) { return fitOffList().includes(String(id)); }
function toggleFitForGame(id) {
    const list = fitOffList().filter(x => x !== String(id));
    if (!isFitOff(id)) list.push(String(id));
    try { localStorage.setItem(FIT_OFF_KEY, JSON.stringify(list.slice(-500))); } catch {}
}
window.__gnmathFitMode = function () {
    return typeof currentGameId !== "undefined" && currentGameId && isFitOff(currentGameId) ? "off" : "auto";
};
