// ═════════════════════════════════════════════════════════════════════════════
// Extra animations. Everything here is cheap (only moves or fades things, which
// the graphics chip does on its own) and is switched off by Settings → Reduce
// motion or the device's own "reduce motion" setting.
//   • dark/light mode spreads out in a circle from where you clicked
//   • theme colors cross-fade instead of snapping
//   • popups animate closed instead of vanishing
//   • home sections slide in as you scroll to them
// The rest (header icons, card shine, button presses, favorite pop, tab fades)
// is plain CSS in styles.css under "Motion".
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const reduced = () => document.body.classList.contains("reduced-motion")
        || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const canTransition = () => typeof document.startViewTransition === "function" && !reduced();

    // Remember where the last click was, for the dark-mode circle
    let lastX = innerWidth - 60, lastY = 40;
    addEventListener("pointerdown", e => { lastX = e.clientX; lastY = e.clientY; }, { capture: true, passive: true });

    // ── Dark / light mode: circular reveal ──────────────────────────────────
    if (typeof darkMode === "function") {
        const plainDarkMode = darkMode;
        window.darkMode = darkMode = function () {
            if (!canTransition()) { plainDarkMode(); return Promise.resolve(); }
            const r = Math.hypot(Math.max(lastX, innerWidth - lastX), Math.max(lastY, innerHeight - lastY));
            document.documentElement.classList.add("vt-reveal");
            const t = document.startViewTransition(() => plainDarkMode());
            t.ready.then(() => {
                document.documentElement.animate(
                    { clipPath: [`circle(0px at ${lastX}px ${lastY}px)`, `circle(${r}px at ${lastX}px ${lastY}px)`] },
                    { duration: 550, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" });
            }).catch(() => {});
            t.finished.finally(() => document.documentElement.classList.remove("vt-reveal"));
            return t.updateCallbackDone.catch(() => {});
        };
    }

    // ── Theme color: soft cross-fade ────────────────────────────────────────
    const wrapFade = name => {
        const plain = window[name];
        if (typeof plain !== "function") return;
        window[name] = function (...args) {
            // Only for clicks by the visitor (not when the page restores saved settings)
            const quiet = args[1] && args[1].persist === false;
            if (quiet || !canTransition() || !document.body.classList.length) return plain.apply(this, args);
            document.startViewTransition(() => plain.apply(this, args));
        };
    };
    wrapFade("setTheme");
    wrapFade("setCustomPrimaryColor");
    wrapFade("clearCustomPrimaryColor");

    // ── Popups: animate closed ──────────────────────────────────────────────
    const overlay = document.getElementById("popupOverlay");
    let closeTimer = null;
    if (overlay && typeof closePopup === "function") {
        const plainClose = closePopup;
        window.closePopup = closePopup = function () {
            if (reduced() || overlay.style.display === "none" || !overlay.style.display) { clearTimeout(closeTimer); overlay.classList.remove("closing"); return plainClose(); }
            overlay.classList.add("closing");
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                if (!overlay.classList.contains("closing")) return;
                overlay.classList.remove("closing");
                plainClose();
            }, 170);
        };
        // Something opened a popup again while the old one was closing (it fills in
        // a new title or body): keep it open.
        const popupBox = overlay.querySelector(".popup") || overlay;
        new MutationObserver(() => {
            if (!overlay.classList.contains("closing")) return;
            clearTimeout(closeTimer);
            overlay.classList.remove("closing");
        }).observe(popupBox, { childList: true, subtree: true, characterData: true });
    }

    // ── Home sections slide in as they come into view ───────────────────────
    if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver(entries => {
            for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in-view"); io.unobserve(e.target); }
        }, { rootMargin: "0px 0px -8% 0px" });
        const watch = () => document.querySelectorAll(".home-section:not(.in-view)").forEach(el => {
            // Already on screen when the page opens: no need to animate it
            if (el.getBoundingClientRect().top < innerHeight) el.classList.add("in-view");
            else { el.classList.add("reveal"); io.observe(el); }
        });
        // Wait until the game rows are drawn, so only sections that really start
        // below the screen get the slide-in
        const later = () => setTimeout(watch, 1500);
        if (document.readyState === "complete") later(); else addEventListener("load", later, { once: true });
    }
})();
