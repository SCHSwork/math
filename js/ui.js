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
// Chrome's password manager sometimes ignores autocomplete="off" and drops the
// signed-in username into the first text box on the page. Search boxes marked
// data-no-autofill start read-only (password managers skip read-only fields)
// until you click, tap or tab into them, and any text that appears without you
// typing it is cleared straight away.
(function () {
    const typed = new WeakSet();
    const guarded = el => el && el.matches && el.matches("input[data-no-autofill]");
    const unlock = e => { if (guarded(e.target)) e.target.readOnly = false; };
    const markTyped = e => { if (guarded(e.target)) typed.add(e.target); };
    ["pointerdown", "focusin", "touchstart"].forEach(t => document.addEventListener(t, unlock, true));
    ["keydown", "paste", "drop", "compositionstart", "cut"].forEach(t => document.addEventListener(t, markTyped, true));
    const isAutofilled = el => { try { return el.matches(":autofill") || el.matches(":-webkit-autofill"); } catch { return false; } };
    function scrub(el) {
        if (!el.value || typed.has(el)) return false;
        el.value = "";
        return true;
    }
    // Runs before the box's own handlers, so a filled-in name never triggers a search
    window.addEventListener("input", e => {
        const el = e.target;
        if (!guarded(el) || typed.has(el)) return;
        if (el.value && (isAutofilled(el) || !e.isTrusted || !e.inputType)) {
            el.value = "";
            e.stopImmediatePropagation();
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }, true);
    function setup() {
        const boxes = document.querySelectorAll("input[data-no-autofill]");
        boxes.forEach(el => { if (document.activeElement !== el) el.readOnly = true; });
        // Catch values that appear without any event during the first seconds
        [50, 300, 1000, 2500, 5000].forEach(ms => setTimeout(() => {
            // Nothing on this site fills these boxes by itself, so any text that's
            // there before you've typed came from the browser.
            document.querySelectorAll("input[data-no-autofill]").forEach(el => {
                if (scrub(el)) el.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }, ms));
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
    // Search boxes added later (game finder, admin search) get the same treatment
    window.protectFromAutofill = el => { if (el) { el.setAttribute("data-no-autofill", ""); if (document.activeElement !== el) el.readOnly = true; } };
})();
