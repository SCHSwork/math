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
