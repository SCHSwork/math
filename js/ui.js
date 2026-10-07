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
