// ═════════════════════════════════════════════════════════════════════════════
// Site notices and dialogs (replace the browser's alert / confirm / prompt).
//   notify(message, { type: "info" | "success" | "error", duration })
//   await askConfirm(message, { title, confirmText, cancelText, danger })  → true / false
//   await askChoice(message, { title, choices: [{ value, label, primary, danger }] }) → value or null
// Loaded before the other scripts so everything can use them.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    function region() {
        let r = document.getElementById("toastRegion");
        if (!r) {
            r = document.createElement("div");
            r.id = "toastRegion";
            r.setAttribute("role", "status");
            r.setAttribute("aria-live", "polite");
            document.body.appendChild(r);
        }
        return r;
    }

    window.notify = function (message, opts) {
        opts = opts || {};
        const type = opts.type || (/\b(couldn't|can't|failed|error|not available|isn't|doesn't)\b/i.test(message) ? "error" : "info");
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        if (type === "error") toast.setAttribute("role", "alert");
        const text = document.createElement("div");
        text.className = "toast-text";
        text.textContent = String(message);
        const close = document.createElement("button");
        close.type = "button";
        close.className = "toast-close";
        close.setAttribute("aria-label", "Dismiss");
        close.textContent = "×";
        toast.append(text, close);
        const r = region();
        r.appendChild(toast);
        while (r.children.length > 4) r.firstElementChild.remove();
        const ms = opts.duration || Math.min(9000, 3500 + String(message).length * 35);
        let timer;
        const remove = () => {
            clearTimeout(timer);
            toast.classList.add("toast-leaving");
            setTimeout(() => toast.remove(), 200);
        };
        const start = () => { timer = setTimeout(remove, ms); };
        close.onclick = remove;
        toast.addEventListener("mouseenter", () => clearTimeout(timer));
        toast.addEventListener("mouseleave", start);
        start();
        return remove;
    };

    let openDialog = null;
    function dialog({ title, message, buttons, dismissValue }) {
        return new Promise(resolve => {
            if (openDialog) openDialog(dismissValue);
            const previouslyFocused = document.activeElement;
            const overlay = document.createElement("div");
            overlay.className = "dialog-overlay";
            const box = document.createElement("div");
            box.className = "dialog";
            box.setAttribute("role", "alertdialog");
            box.setAttribute("aria-modal", "true");
            const id = "dlg" + Math.random().toString(36).slice(2, 8);
            if (title) {
                const h = document.createElement("h3");
                h.id = id + "-t";
                h.textContent = title;
                box.appendChild(h);
                box.setAttribute("aria-labelledby", h.id);
            }
            const p = document.createElement("p");
            p.id = id + "-d";
            p.textContent = message;
            box.setAttribute("aria-describedby", p.id);
            box.appendChild(p);
            const row = document.createElement("div");
            row.className = "dialog-actions";
            const btnEls = buttons.map(b => {
                const el = document.createElement("button");
                el.type = "button";
                el.textContent = b.label;
                el.className = "dialog-btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "");
                el.onclick = () => finish(b.value);
                row.appendChild(el);
                return el;
            });
            box.appendChild(row);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            function onKey(e) {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(dismissValue); }
                else if (e.key === "Tab") {
                    // keep focus inside the dialog
                    const first = btnEls[0], last = btnEls[btnEls.length - 1];
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
            }
            document.addEventListener("keydown", onKey, true);
            overlay.addEventListener("mousedown", e => { if (e.target === overlay) finish(dismissValue); });
            function finish(value) {
                document.removeEventListener("keydown", onKey, true);
                overlay.remove();
                openDialog = null;
                try { previouslyFocused && previouslyFocused.focus && previouslyFocused.focus(); } catch (e) {}
                resolve(value);
            }
            openDialog = finish;
            // Dangerous actions start on Cancel so a stray Enter can't delete anything
            const focusEl = btnEls.find((b, i) => buttons[i].primary && !buttons[i].danger) || btnEls[0];
            setTimeout(() => focusEl.focus(), 0);
        });
    }

    window.askConfirm = function (message, opts) {
        opts = opts || {};
        return dialog({
            title: opts.title || "",
            message,
            dismissValue: false,
            buttons: [
                { value: false, label: opts.cancelText || "Cancel" },
                { value: true, label: opts.confirmText || "OK", primary: true, danger: !!opts.danger }
            ]
        });
    };

    window.askChoice = function (message, opts) {
        opts = opts || {};
        return dialog({ title: opts.title || "", message, dismissValue: null, buttons: opts.choices || [] });
    };
})();

// ── Accessibility helpers ──────────────────────────────────────────────────
(function () {
    // Give unlabeled form controls in pop-up panels a name from the text next to them
    function labelControls(root) {
        root.querySelectorAll("input:not([type=hidden]), select, textarea").forEach(el => {
            if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label") ||
                (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`))) return;
            let text = "";
            const row = el.closest(".settings-inline");
            if (row) text = (row.querySelector("label, span")?.textContent || "").trim();
            for (let prev = el.previousElementSibling; !text && prev; prev = prev.previousElementSibling) {
                if (prev.tagName === "BR") continue;
                if (/^(LABEL|SPAN|DIV|P|H4|H5)$/.test(prev.tagName)) text = prev.textContent.trim();
                break;
            }
            if (!text && el.placeholder) text = el.placeholder;
            if (text) el.setAttribute("aria-label", text.replace(/\s+/g, " ").slice(0, 80));
        });
    }

    function setup() {
        const overlay = document.getElementById("popupOverlay");
        const body = document.getElementById("popupBody");
        if (!overlay || !body) return;
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "popupTitle");
        new MutationObserver(() => labelControls(body)).observe(body, { childList: true, subtree: true });
        // Move focus into the panel when it opens, and back when it closes
        let returnTo = null, wasOpen = false;
        new MutationObserver(() => {
            const open = overlay.style.display === "flex";
            if (open && !wasOpen) {
                returnTo = document.activeElement;
                setTimeout(() => {
                    const first = body.querySelector("input:not([type=hidden]), select, textarea, button, a[href], summary");
                    (first || overlay).focus({ preventScroll: true });
                }, 0);
            } else if (!open && wasOpen && returnTo && document.contains(returnTo)) {
                try { returnTo.focus({ preventScroll: true }); } catch (e) {}
            }
            wasOpen = open;
        }).observe(overlay, { attributes: true, attributeFilter: ["style"] });
        if (!overlay.hasAttribute("tabindex")) overlay.setAttribute("tabindex", "-1");
        const closeBtn = overlay.querySelector(".close-button, .popup-close, [onclick*='closePopup']");
        if (closeBtn && !closeBtn.getAttribute("aria-label")) closeBtn.setAttribute("aria-label", "Close");
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();

    // Esc closes the open panel or menu (site dialogs handle their own Esc first)
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape" || document.querySelector(".dialog-overlay")) return;
        const overlay = document.getElementById("popupOverlay");
        if (overlay && overlay.style.display === "flex" && typeof closePopup === "function") closePopup();
    });
})();

// ── Keep browsers from auto-filling the saved username into search boxes ────
// Chrome's password manager ignores autocomplete="off" and drops the saved
// username into a search box, on reload and after signing in. Search boxes
// marked data-no-autofill:
//  - stay read-only (password managers skip those) until you really click,
//    tap or type in them. The site focusing the box by itself ("Focus search
//    on load") doesn't unlock it; that was what let Chrome fill it.
//  - remember the last text you typed (or the site set). Text that shows up
//    without you typing it is put back to that, whenever it happens.
(function () {
    const guarded = el => !!(el && el.matches && el.matches("input[data-no-autofill]"));
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const lastAct = new WeakMap();   // box → time of your last key, paste, click…
    const keep = new WeakMap();      // box → text you (or the site) put there
    const recent = el => Date.now() - (lastAct.get(el) || 0) < 1500;
    function adopt(el) {
        if (!guarded(el) || el.__gnGuarded) return;
        el.__gnGuarded = true;
        keep.set(el, "");
        // The site's own code setting the text is fine; browsers autofill
        // without going through this, so their text gets reverted
        Object.defineProperty(el, "value", { configurable: true, enumerable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); keep.set(this, desc.get.call(this)); } });
        if (document.activeElement !== el) el.readOnly = true;
        else if (!recent(el)) el.readOnly = true;
    }
    function revert(el) {
        const want = keep.get(el) || "";
        if (desc.get.call(el) === want) return false;
        desc.set.call(el, want);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    const act = e => {
        const el = e.type === "keydown" ? document.activeElement : e.target;
        if (!guarded(el)) return;
        adopt(el);
        lastAct.set(el, Date.now());
        if (el.readOnly && (e.type !== "keydown" || !["Tab", "Shift", "Escape"].includes(e.key))) el.readOnly = false;
    };
    ["pointerdown", "touchstart", "keydown", "paste", "drop", "cut", "compositionstart"].forEach(t => document.addEventListener(t, act, true));
    // Runs before the box's own handlers, so an autofilled name never triggers a search
    window.addEventListener("input", e => {
        const el = e.target;
        if (!guarded(el)) return;
        adopt(el);
        if (e.isTrusted && recent(el)) { keep.set(el, desc.get.call(el)); return; }   // you typed it
        if (!e.isTrusted) return;                                                     // the site's own event
        if (desc.get.call(el) !== (keep.get(el) || "")) { e.stopImmediatePropagation(); revert(el); }
    }, true);
    // Some fills fire no event at all: check now and then
    setInterval(() => {
        document.querySelectorAll("input[data-no-autofill]").forEach(el => {
            adopt(el);
            if (!recent(el)) revert(el);
        });
    }, 700);
    function setup() { document.querySelectorAll("input[data-no-autofill]").forEach(adopt); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
    // Search boxes added later (game finder, admin search) get the same treatment
    window.protectFromAutofill = el => { if (el) { el.setAttribute("data-no-autofill", ""); adopt(el); } };
})();

// ── "/" jumps to the search box (like YouTube and GitHub) ────────────────────
document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const viewer = document.getElementById("zoneViewer");
    if (viewer && viewer.style.display === "flex") return;          // a game is open
    if (document.querySelector(".dialog-overlay") || document.getElementById("popupOverlay")?.style.display === "flex") return;
    const box = document.getElementById("searchBar");
    if (!box) return;
    e.preventDefault();
    box.readOnly = false;
    box.focus();
    box.select();
});

// ── Scroll button: jumps to the bottom of the page; near the bottom it turns
// into "back to top". Hidden when the page is too short to scroll.
(function () {
    function setup() {
        const btn = document.createElement("button");
        btn.id = "scrollJump";
        btn.type = "button";
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        document.body.appendChild(btn);
        const smooth = () => document.body.classList.contains("reduced-motion") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth";
        const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
        function update() {
            const scrollable = document.documentElement.scrollHeight > window.innerHeight * 1.5;
            btn.hidden = !scrollable;
            const up = atBottom();
            btn.classList.toggle("up", up);
            const label = up ? "Back to top" : "Scroll to the bottom";
            btn.setAttribute("aria-label", label); btn.title = label;
        }
        // Long distances jump instantly; a smooth scroll over thousands of cards takes ages
        const behaviorFor = top => Math.abs(top - window.scrollY) > window.innerHeight * 3 ? "auto" : smooth();
        // All games keeps adding cards for a few seconds after the page loads, so after
        // jumping down, keep following the bottom until it settles (or the person scrolls).
        let followUntil = 0, followCap = 0, lastHeight = 0;
        const stopFollowing = () => { followUntil = 0; };
        ["wheel", "touchstart", "keydown", "mousedown"].forEach(ev => window.addEventListener(ev, e => { if (e.target !== btn && !btn.contains(e.target)) stopFollowing(); }, { passive: true }));
        btn.addEventListener("click", () => {
            // do what the button shows, even if more cards arrived since it last updated
            if (btn.classList.contains("up")) { stopFollowing(); window.scrollTo({ top: 0, behavior: behaviorFor(0) }); return; }
            // All games only builds cards as you scroll; build the rest so the bottom is the real bottom
            if (typeof window.renderAllZones === "function") window.renderAllZones();
            const bottom = document.documentElement.scrollHeight;
            window.scrollTo({ top: bottom, behavior: behaviorFor(bottom) });
            // keep following while the page is still growing: 2s after the last growth, 20s at most
            followCap = Date.now() + 20000; followUntil = Date.now() + 2000; lastHeight = bottom;
        });
        const follow = () => {
            if (!followUntil) return;
            const now = Date.now(), h = document.documentElement.scrollHeight;
            if (h !== lastHeight) { lastHeight = h; followUntil = Math.min(followCap, now + 2000); }
            if (now > followUntil) { followUntil = 0; return; }
            if (!atBottom()) window.scrollTo({ top: h, behavior: "auto" });
        };
        // growth stops firing scroll events, so check on a timer while following
        setInterval(() => { if (followUntil) schedule(); }, 250);
        let pending = false;
        const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; follow(); update(); }); } };
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        // the page grows as game lists load
        if (typeof ResizeObserver !== "undefined") new ResizeObserver(schedule).observe(document.body);
        update();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
})();

// Tab bars with more tabs than fit scroll sideways; fade the side with more
(function () {
    function update(bar) {
        const max = bar.scrollWidth - bar.clientWidth;
        bar.classList.toggle("fade-start", max > 2 && bar.scrollLeft > 2);
        bar.classList.toggle("fade-end", max > 2 && bar.scrollLeft < max - 2);
    }
    const all = () => document.querySelectorAll(".admin-tabs").forEach(update);
    document.addEventListener("scroll", e => { if (e.target.classList && e.target.classList.contains("admin-tabs")) update(e.target); }, true);
    window.addEventListener("resize", all);
    function watch() {
        const body = document.getElementById("popupBody");
        if (!body) return;
        let queued = false;
        new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; all(); }); } }).observe(body, { childList: true, subtree: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();

// ═════════════════════════════════════════════════════════════════════════════
// Offline backups of the game lists (gnBackup.put / gnBackup.get / gnBackup.remove)
//
// The site keeps the last game lists that loaded, to show something when a
// source is down. They used to be saved in localStorage, which only holds about
// 5 MB per site and is shared with settings and game data: the lists alone
// took 1 MB or more. They now go in Cache Storage (its own, much larger space).
//   • put() skips the write when the list hasn't changed since last time.
//   • get() also reads an old localStorage copy, so nothing is lost moving over.
//   • Where Cache Storage isn't available, localStorage is used as before.
// Saved values look the same as before: { t: savedAt, data }.
// ═════════════════════════════════════════════════════════════════════════════
window.gnBackup = (function () {
    const CACHE = "gn-backups";   // sw.js leaves this one alone when it cleans up
    const hasCaches = () => { try { return typeof caches !== "undefined" && window.isSecureContext; } catch { return false; } };
    const url = key => new URL("__backup/" + encodeURIComponent(key), location.href).href;
    const sigKey = key => key + "-sig";
    function quickSig(text) {
        let h = 0;
        for (let i = 0; i < text.length; i += 7) h = (h * 31 + text.charCodeAt(i)) | 0;
        return text.length + ":" + (h >>> 0).toString(36);
    }
    function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
    function lsRemove(key) { try { localStorage.removeItem(key); } catch {} }

    async function put(key, data) {
        let text;
        try { text = JSON.stringify(data); } catch { return; }
        const sig = quickSig(text);
        let oldSig = null;
        try { oldSig = localStorage.getItem(sigKey(key)); } catch {}
        const body = JSON.stringify({ t: Date.now(), data });
        if (hasCaches()) {
            try {
                const c = await caches.open(CACHE);
                // Same list as last time and still saved: nothing to do
                if (oldSig === sig && await c.match(url(key))) { lsRemove(key); return; }
                await c.put(url(key), new Response(body, { headers: { "Content-Type": "application/json" } }));
                lsRemove(key);   // the old localStorage copy, if any
                try { localStorage.setItem(sigKey(key), sig); } catch {}
                return;
            } catch (e) { /* fall back to localStorage */ }
        }
        try { localStorage.setItem(key, body); localStorage.setItem(sigKey(key), sig); } catch {}
    }
    async function get(key) {
        if (hasCaches()) {
            try {
                const c = await caches.open(CACHE);
                const res = await c.match(url(key));
                if (res) {
                    const v = await res.json();
                    if (v && v.data !== undefined) return v;
                }
            } catch (e) {}
        }
        const v = lsGet(key);
        return v && v.data !== undefined ? v : null;
    }
    async function remove(key) {
        lsRemove(key); lsRemove(sigKey(key));
        if (hasCaches()) { try { await (await caches.open(CACHE)).delete(url(key)); } catch {} }
    }
    return { put, get, remove };
})();
