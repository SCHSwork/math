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
// One-off animations (cards appearing, buttons pressing) stay smooth.
(function () {
    const FAST = ".s-fall, .s-shoot, .s-bubbles, .zone-item";
    function slowDown() {
        if (typeof document.getAnimations !== "function") return;
        for (const a of document.getAnimations()) {
            if (a.gnStepped || typeof CSSAnimation === "undefined" || !(a instanceof CSSAnimation) || !a.effect) continue;
            a.gnStepped = true;
            const t = a.effect.target, timing = a.effect.getComputedTiming();
            if (!t || timing.iterations !== Infinity || !timing.duration || !isFinite(timing.duration)) continue;
            // 30 is a multiple of 15, so both rates tick on the same frames
            const fps = (t.matches && t.matches(FAST)) || timing.duration < 2500 ? 30 : 15;
            try { a.effect.updateTiming({ easing: `steps(${Math.max(2, Math.round(timing.duration / 1000 * fps))})` }); } catch {}
        }
    }
    let queued = false;
    const queue = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; slowDown(); });
    };
    // every CSS animation announces itself when it starts (new theme, hover effects...)
    document.addEventListener("animationstart", queue, true);
    if (document.body) queue(); else document.addEventListener("DOMContentLoaded", queue);
})();
