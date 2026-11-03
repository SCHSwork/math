// ═════════════════════════════════════════════════════════════════════════════
// Home page tabs. Top 10, Featured, New, Recent, Favorites and GN Originals
// used to be stacked rows; now they share one spot and you pick one with the
// tabs (the choice is remembered). The rows still fill themselves exactly as
// before; this only decides which one is showing. Game of the Day sits at the
// end of the tab bar as a small chip. While searching or filtering, the whole
// block steps aside so the results come first.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const KEY = "gnmath-home-tab";
    const box = document.getElementById("homeTabs");
    if (!box) return;
    const bar = box.querySelector(".ht-tabs");
    const $ = id => document.getElementById(id);
    const shelfCount = id => { const el = $(id); return el ? el.querySelectorAll(".zone-item").length : 0; };
    const TABS = [
        { id: "spooky", label: "Spooky", icon: "🎃", panel: "spookyWrapper", ok: () => !!$("spookyWrapper") && !$("spookyWrapper").hidden },
        { id: "top10", label: "Top 10", icon: "🔥", panel: "top10Wrapper", ok: () => !$("top10Wrapper").hidden },
        { id: "featured", label: "Featured", icon: "⭐", panel: "featuredZonesWrapper", ok: () => shelfCount("featuredZones") > 0 },
        { id: "new", label: "New", icon: "🆕", panel: "newGamesWrapper", ok: () => !$("newGamesWrapper").hidden, count: () => (($("newGamesSummary") || {}).querySelector?.(".section-count") || {}).textContent || "" },
        { id: "recent", label: "Recent", icon: "🕘", panel: "yourGames", ok: () => shelfCount("recentZones") > 0, your: "recent" },
        { id: "favorites", label: "Favorites", icon: "♥", panel: "yourGames", ok: () => shelfCount("favoriteZones") > 0, your: "favorites", count: () => String(shelfCount("favoriteZones") || "") },
        { id: "originals", label: "GN Originals", icon: "🏠", panel: "originalsWrapper", ok: () => !$("originalsWrapper").hidden }
    ];
    let current = null;
    try { current = localStorage.getItem(KEY); } catch {}
    let picked = !!current;   // until someone picks a tab, show the first one there is…
    const settleAt = Date.now() + 4000;   // …but stop switching once the page has settled
    let applying = false;

    function available() {
        return TABS.filter(t => { try { return $(t.panel) && t.ok(); } catch { return false; } });
    }
    function render() {
        if (applying) return;
        applying = true;
        try {
            const tabs = available();
            if ((!picked && Date.now() < settleAt) || !tabs.find(t => t.id === current)) current = (tabs[0] || {}).id || null;
            // Tab buttons
            const sig = tabs.map(t => t.id + ":" + (t.count ? t.count() : "")).join(",") + "|" + current;
            if (bar.dataset.sig !== sig) {
                bar.dataset.sig = sig;
                bar.innerHTML = "";
                for (const t of tabs) {
                    const b = document.createElement("button");
                    b.type = "button";
                    b.className = "ht-tab";
                    b.setAttribute("role", "tab");
                    b.setAttribute("aria-selected", t.id === current ? "true" : "false");
                    b.dataset.tab = t.id;
                    const i = document.createElement("span"); i.className = "ht-icon"; i.textContent = t.icon; i.setAttribute("aria-hidden", "true");
                    const l = document.createElement("span"); l.textContent = t.label;
                    b.append(i, l);
                    const n = t.count ? t.count() : "";
                    if (n) { const c = document.createElement("span"); c.className = "ht-count"; c.textContent = n; b.appendChild(c); }
                    b.onclick = () => select(t.id, true);
                    bar.appendChild(b);
                }
            }
            // Panels: only the chosen one shows
            const active = TABS.find(t => t.id === current);
            for (const t of TABS) {
                const el = $(t.panel);
                if (!el) continue;
                const on = active && t.panel === active.panel;
                el.classList.toggle("ht-off", !on);
                if (on && el.tagName === "DETAILS" && !el.open) el.open = true;
            }
            if (active && active.your && typeof yourGamesTab !== "undefined" && yourGamesTab !== active.your && typeof setYourGamesTab === "function") {
                setYourGamesTab(active.your);
            }
            box.classList.toggle("ht-empty", !tabs.length);
        } finally {
            applying = false;
        }
    }
    function select(id, byUser) {
        current = id;
        if (byUser) { picked = true; try { localStorage.setItem(KEY, id); } catch {} }
        bar.dataset.sig = "";
        render();
        if (byUser) {
            const el = bar.querySelector(`[data-tab="${id}"]`);
            el && el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        }
    }
    // Arrow keys move between tabs
    bar.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const tabs = [...bar.querySelectorAll(".ht-tab")];
        const i = tabs.findIndex(b => b.dataset.tab === current);
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        if (next) { select(next.dataset.tab, true); next.focus(); }
    });
    // Re-check whenever a row fills, empties, shows or hides itself
    let timer = null;
    const soon = () => { if (applying) return; clearTimeout(timer); timer = setTimeout(render, 60); };
    const mo = new MutationObserver(soon);
    ["top10Wrapper", "featuredZonesWrapper", "newGamesWrapper", "originalsWrapper", "yourGames", "spookyWrapper"].forEach(id => { const el = $(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ["hidden"] }); });
    ["featuredZones", "recentZones", "favoriteZones", "newGamesSummary"].forEach(id => { const el = $(id); if (el) mo.observe(el, { childList: true, characterData: true, subtree: id === "newGamesSummary" }); });
    window.renderHomeTabs = render;
    render();
})();
