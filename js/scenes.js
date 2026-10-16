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
