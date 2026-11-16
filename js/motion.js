// ═════════════════════════════════════════════════════════════════════════════
// Extra animations. Everything here is cheap (only moves or fades things, which
// the graphics chip does on its own) and is switched off by Settings → Reduce
// motion or the device's own "reduce motion" setting.
//   • dark/light mode spreads out in a circle from where you clicked
//   • theme colors cross-fade instead of snapping
//   • popups animate closed instead of vanishing
//   • home sections slide in as you scroll to them
//   • opening a game grows it out of its card; closing shrinks it back in
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

    // ── Opening / closing a game ────────────────────────────────────────────
    // Open: the card you clicked grows to fill the screen, then the game fades in
    // over it. Close: the game shrinks back into its card (or drops away if the
    // card isn't on screen). Only transform/opacity are animated, so it stays
    // smooth even while the game is busy loading.
    const viewer = document.getElementById("zoneViewer");
    let pressedCard = null, pressedAt = 0;
    addEventListener("pointerdown", e => {
        const card = e.target && e.target.closest && e.target.closest(".zone-item");
        if (card) { pressedCard = card; pressedAt = performance.now(); }
    }, { capture: true, passive: true });

    const onScreen = r => r.width > 20 && r.height > 20 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const toRect = r => `translate(${r.left}px, ${r.top}px) scale(${r.width / innerWidth}, ${r.height / innerHeight})`;
    const cardFor = id => {
        if (pressedCard && pressedCard.isConnected && pressedCard.dataset.id === String(id)
            && performance.now() - pressedAt < 1500 && onScreen(pressedCard.getBoundingClientRect())) return pressedCard;
        for (const c of document.querySelectorAll(`.zone-item[data-id="${CSS.escape(String(id))}"]`)) {
            if (onScreen(c.getBoundingClientRect())) return c;
        }
        return null;
    };
    const clearFx = () => document.querySelectorAll(".zv-expand, .zv-ghost").forEach(g => g.remove());

    if (viewer && typeof openZone === "function") {
        const plainOpenZone = openZone;
        window.openZone = openZone = function (file, ...rest) {
            const wasOpen = viewer.style.display === "flex";
            const card = !wasOpen && !reduced() && file && !String(file.url || "").startsWith("http") ? cardFor(file.id) : null;
            clearFx();
            viewer.classList.toggle("zv-from-card", !!card);
            const result = plainOpenZone.call(this, file, ...rest);
            if (card && viewer.style.display === "flex") {
                const r = card.getBoundingClientRect();
                const fx = document.createElement("div");
                fx.className = "zv-expand";
                fx.setAttribute("aria-hidden", "true");
                const img = card.querySelector("img");
                if (img && img.currentSrc && img.complete && img.naturalWidth) {
                    const pic = new Image();
                    pic.src = img.currentSrc;
                    pic.alt = "";
                    fx.appendChild(pic);
                    pic.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: 420, easing: "ease-out", fill: "forwards" });
                }
                document.body.appendChild(fx);
                fx.animate([{ transform: toRect(r) }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" });
                setTimeout(() => fx.remove(), 520);
            }
            return result;
        };
    }

    if (viewer && typeof closeZone === "function") {
        const plainCloseZone = closeZone;
        window.closeZone = closeZone = function (...args) {
            const wasOpen = viewer.style.display === "flex";
            const header = wasOpen && !reduced() ? viewer.querySelector(".zone-header") : null;
            const idEl = document.getElementById("zoneId");
            const id = idEl ? idEl.textContent : "";
            const result = plainCloseZone.apply(this, args);
            clearFx();
            if (header) {
                const ghost = document.createElement("div");
                ghost.className = "zv-ghost";
                ghost.setAttribute("aria-hidden", "true");
                const copy = header.cloneNode(true);
                copy.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
                copy.removeAttribute("id");
                ghost.appendChild(copy);
                const card = id ? cardFor(id) : null;
                document.body.appendChild(ghost);
                const done = () => ghost.remove();
                if (card) {
                    ghost.classList.add("zv-to-card");
                    ghost.animate([{ transform: "none", opacity: 1 }, { opacity: 1, offset: 0.6 }, { transform: toRect(card.getBoundingClientRect()), opacity: 0 }],
                        { duration: 320, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }).finished.then(done, done);
                } else {
                    ghost.addEventListener("animationend", done, { once: true });
                }
                setTimeout(done, 600);
            }
            return result;
        };
        // Opened another game right away: drop any leftover close animation
        new MutationObserver(() => { if (viewer.style.display === "flex") document.querySelectorAll(".zv-ghost").forEach(g => g.remove()); })
            .observe(viewer, { attributes: true, attributeFilter: ["style"] });
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
