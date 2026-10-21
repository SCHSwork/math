// ═════════════════════════════════════════════════════════════════════════════
// Scene themes (Outer space, Andromeda, Black hole, Snowfall, Code rain and more).
// Adds one background layer behind the whole site; what it looks like is all in
// styles.css under "Scene themes". The animations only move or fade layers, so
// the graphics chip does the work, and they stop while a game is open, when the
// tab is hidden, and with Reduce motion.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const scene = document.createElement("div");
    scene.id = "scene";
    scene.setAttribute("aria-hidden", "true");
    // Layers each scene can use: two star fields, three art layers, a shooting star
    scene.innerHTML = '<i class="s-stars s1"></i><i class="s-stars s2"></i><i class="s-art a1"></i><i class="s-art a2"></i><i class="s-art a3"></i><i class="s-art a4"></i><i class="s-art a5"></i><i class="s-shoot"></i><i class="s-shoot sh2"></i><i class="s-bubbles"></i><i class="s-fall f1"></i><i class="s-fall f2"></i>';
    const add = () => document.body.prepend(scene);
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
    // Pause everything while the tab isn't visible
    document.addEventListener("visibilitychange", () => scene.classList.toggle("paused", document.hidden));
})();

// ── "Your own picture": any picture or GIF as the background ────────────────
// Paste a link (nothing is downloaded, which matters on school computers that
// block downloads) or pick a file. Saved only on this device (and in your cloud
// save if you're signed in). Links stay links; files are shrunk to fit.
const CUSTOM_BG_KEY = "gnmath-custom-bg", CUSTOM_BG_DIM_KEY = "gnmath-custom-bg-dim";
function getCustomBg() { try { return localStorage.getItem(CUSTOM_BG_KEY) || ""; } catch { return ""; } }
function getCustomBgDim() { try { const v = Number(localStorage.getItem(CUSTOM_BG_DIM_KEY)); return Number.isFinite(v) && localStorage.getItem(CUSTOM_BG_DIM_KEY) !== null ? Math.min(85, Math.max(0, v)) : 40; } catch { return 40; } }
function safeBgUrl(src) {
    if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(src)) return src;
    try { const u = new URL(src); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; }
}
function applyCustomBackground() {
    const scene = document.getElementById("scene");
    const preview = document.getElementById("custom-bg-preview");
    const src = safeBgUrl(getCustomBg());
    const css = src ? `url("${src.replace(/["\\\n\r]/g, c => encodeURIComponent(c))}")` : "";
    if (scene) {
        const pic = scene.querySelector(".a1");
        if (document.body.classList.contains("theme-custom") && css) pic.style.backgroundImage = css;
        else pic.style.removeProperty("background-image");
        scene.style.setProperty("--custom-dim", String(getCustomBgDim() / 100));
    }
    if (preview) {
        preview.style.backgroundImage = css;
        preview.classList.toggle("empty", !css);
        preview.title = css ? "Use this picture" : "No picture yet";
        preview.onclick = () => { if (css) setTheme("custom"); };
    }
}
function saveCustomBg(src) {
    try { localStorage.setItem(CUSTOM_BG_KEY, src); }
    catch { notify("That picture is too big to save on this device. Try a smaller one, or paste a link instead.", { type: "error" }); return false; }
    setTheme("custom");
    applyCustomBackground();
    notify("Background set! Use “Darken” if the text is hard to read.", { type: "success" });
    return true;
}
// Check the link really is a picture before using it
function setCustomBackgroundFromInput() {
    const input = document.getElementById("custom-bg-url");
    const src = safeBgUrl((input?.value || "").trim());
    if (!src) { notify("Paste a full link that starts with https://", { type: "error" }); return; }
    const img = new Image();
    img.onload = () => saveCustomBg(src);
    img.onerror = () => notify("Couldn't load a picture from that link. It may not be a direct picture link (try right-click → Copy image address), or the site may be blocked here.", { type: "error", duration: 8000 });
    img.src = src;
}
function setCustomBackgroundFromFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
        const data = String(reader.result || "");
        // Small GIFs stay as they are so they keep moving
        if (/^data:image\/gif/.test(data) && data.length < 2.5e6) return saveCustomBg(data);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            // (toDataURL is switched off site-wide, so encode with toBlob)
            const encode = q => c.toBlob(blob => {
                if (!blob) { notify("That file couldn't be opened as a picture.", { type: "error" }); return; }
                if (blob.size > 1.3e6 && q > 0.35) return encode(q - 0.15);
                const fr = new FileReader();
                fr.onload = () => saveCustomBg(String(fr.result || ""));
                fr.readAsDataURL(blob);
            }, "image/jpeg", q);
            encode(0.85);
        };
        img.onerror = () => notify("That file couldn't be opened as a picture.", { type: "error" });
        img.src = data;
    };
    reader.readAsDataURL(file);
}
function clearCustomBackground() {
    try { localStorage.removeItem(CUSTOM_BG_KEY); } catch {}
    if (document.body.classList.contains("theme-custom")) setTheme("red");
    applyCustomBackground();
}
function setCustomBgDim(v) {
    try { localStorage.setItem(CUSTOM_BG_DIM_KEY, String(v)); } catch {}
    applyCustomBackground();
}
// Re-apply whenever the theme changes (and once Settings draws its preview)
const watchBody = () => new MutationObserver(applyCustomBackground).observe(document.body, { attributes: true, attributeFilter: ["class"] });
if (document.body) watchBody(); else document.addEventListener("DOMContentLoaded", watchBody);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyCustomBackground); else applyCustomBackground();

// ── Looping animations at a lower frame rate ────────────────────────────────
// Scenes and the moving backgrounds of some site styles cover the whole screen.
// Redrawing them 60 times a second keeps the graphics chip busy, which makes the
// whole browser (other tabs too) choppy on school laptops. These loops are slow,
// so moving them in small steps 15 times a second (30 for falling snow, rain,
// shooting stars and anything quick) looks the same and costs a fraction as much.
// With Lighter effects on, looping animations are paused instead.
// One-off animations (cards appearing, buttons pressing) are never touched.
(function () {
    const FAST = ".s-fall, .s-shoot, .s-bubbles, .zone-item";
    const pausedByUs = new WeakSet();
    const isLoop = a => {
        if (typeof CSSAnimation === "undefined" || !(a instanceof CSSAnimation) || !a.effect || !a.effect.target) return false;
        const t = a.effect.getComputedTiming();
        return t.iterations === Infinity && t.duration && isFinite(t.duration);
    };
    function update() {
        if (typeof document.getAnimations !== "function") return;
        const lite = document.body.classList.contains("lite-fx");
        for (const a of document.getAnimations()) {
            if (!isLoop(a)) continue;
            if (lite) {
                if (a.playState === "running") { a.pause(); pausedByUs.add(a); }
                continue;
            }
            if (pausedByUs.has(a)) { pausedByUs.delete(a); a.play(); }
            if (a.gnStepped) continue;
            a.gnStepped = true;
            const t = a.effect.target, dur = a.effect.getComputedTiming().duration;
            // 30 is a multiple of 15, so both rates tick on the same frames
            const fps = (t.matches && t.matches(FAST)) || dur < 2500 ? 30 : 15;
            try { a.effect.updateTiming({ easing: `steps(${Math.max(2, Math.round(dur / 1000 * fps))})` }); } catch {}
        }
    }
    let queued = false;
    const queue = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; update(); });
    };
    window.gnUpdateLoops = queue;
    // every CSS animation announces itself when it starts (new theme, hover effects...)
    document.addEventListener("animationstart", queue, true);
    if (document.body) queue(); else document.addEventListener("DOMContentLoaded", queue);
})();

// ── Lighter effects ─────────────────────────────────────────────────────────
// Pauses moving backgrounds and other endless animations (the scene, the
// aquarium's fish, a style's bubbles or blinking lights). Auto turns it on by
// itself when this device seems to struggle: after the page settles it watches
// how smoothly the screen updates for two seconds, twice, and only acts if both
// checks were clearly choppy. Devices with very little memory or very few
// processor cores start with it on. The person can always choose On or Off.
const LITE_KEY = "gnmath-lite-fx", LITE_DETECTED_KEY = "gnmath-lite-fx-detected";
function getLiteFxMode() {
    let v = "auto";
    try { v = localStorage.getItem(LITE_KEY) || "auto"; } catch {}
    return ["auto", "on", "off"].includes(v) ? v : "auto";
}
function liteFxDetected() { try { return localStorage.getItem(LITE_DETECTED_KEY) === "1"; } catch { return false; } }
function weakHardware() {
    const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
    return (typeof mem === "number" && mem > 0 && mem <= 2) || (typeof cores === "number" && cores > 0 && cores <= 2);
}
function liteFxActive() {
    const mode = getLiteFxMode();
    return mode === "on" || (mode === "auto" && (liteFxDetected() || weakHardware()));
}
function applyLiteFx() {
    if (!document.body) return;
    const on = liteFxActive();
    const changed = document.body.classList.contains("lite-fx") !== on;
    document.body.classList.toggle("lite-fx", on);
    if (!changed) return;
    if (window.gnUpdateLoops) window.gnUpdateLoops();
    if (window.stAquaFx) window.stAquaFx();
    if (window.stPopupFx) window.stPopupFx();
}
function setLiteFxMode(mode) {
    try { localStorage.setItem(LITE_KEY, mode); } catch {}
    applyLiteFx();
    if (typeof openSettingsPanel === "function" && document.getElementById("settings-search")) openSettingsPanel();
}
function liteFxNote() {
    const mode = getLiteFxMode();
    if (mode === "on") return "On: moving backgrounds and endless animations are paused";
    if (mode === "off") return "Off: full effects";
    return liteFxActive() ? "Auto: on, because this device seemed to struggle" : "Auto: turns on by itself if this device seems to struggle";
}
if (document.body) applyLiteFx(); else document.addEventListener("DOMContentLoaded", applyLiteFx);

(function autoDetect() {
    // Turned on because of the hardware: say so once, so a still background isn't a mystery
    if (getLiteFxMode() === "auto" && !liteFxDetected() && weakHardware()) {
        let noted = false;
        try { noted = localStorage.getItem("gnmath-lite-fx-hw-noted") === "1"; localStorage.setItem("gnmath-lite-fx-hw-noted", "1"); } catch {}
        if (!noted) setTimeout(() => { if (typeof notify === "function") notify("GN 2.0 turned on Lighter effects because this device is on the lighter side: moving backgrounds and endless animations are paused. You can change this in Settings → Look → Lighter effects."); }, 4000);
    }
    if (getLiteFxMode() !== "auto" || liteFxActive()) return;
    // Watch frames for 2s; choppy = slow on average or many long stalls
    const sample = () => new Promise(resolve => {
        const times = [];
        let start = 0;
        const tick = now => {
            if (!start) start = now;
            times.push(now);
            if (now - start < 2000) requestAnimationFrame(tick); else resolve(times);
        };
        requestAnimationFrame(tick);
    });
    const choppy = times => {
        if (times.length < 2) return false;
        const span = times[times.length - 1] - times[0];
        let stalls = 0;
        for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > 50) stalls++;
        const fps = (times.length - 1) / (span / 1000);
        // Chrome's Energy Saver runs at a steady 30 a second; that's fine and isn't counted
        return fps < 24 || stalls / (times.length - 1) > 0.15;
    };
    // Only judge while someone is looking at the page and nothing else (a game, a hidden tab) is in the way
    const ready = () => !document.hidden && document.hasFocus() && !(typeof zoneViewer !== "undefined" && zoneViewer && zoneViewer.style.display === "flex");
    const wait = ms => new Promise(r => setTimeout(r, ms));
    async function check() {
        for (let tries = 0; tries < 20; tries++) {
            await wait(tries ? 5000 : 6000);
            if (getLiteFxMode() !== "auto" || liteFxActive()) return;
            if (!ready()) continue;
            if (!choppy(await sample())) return;          // smooth: nothing to do
            await wait(8000);
            if (!ready()) continue;
            if (!choppy(await sample())) return;          // a one-off hiccup
            try { localStorage.setItem(LITE_DETECTED_KEY, "1"); } catch {}
            applyLiteFx();
            if (typeof notify === "function") notify("This device seemed to be struggling, so GN 2.0 paused the moving backgrounds and other endless animations. You can change this in Settings → Look → Lighter effects.");
            return;
        }
    }
    if (document.readyState === "complete") check(); else addEventListener("load", check, { once: true });
})();
