// ═════════════════════════════════════════════════════════════════════════════
// Site styles ("skins"): change how the whole site looks, not just its colors:
// fonts, corners, borders, buttons, cards and the header. The look itself is in
// styles.css under "Site styles". Saved on this device. Default keeps the
// normal look (with any color theme or scene).
// ═════════════════════════════════════════════════════════════════════════════
const SITE_SKINS = {
    default:  { label: "Default",        note: "The normal look" },
    glass:    { label: "Glass",          note: "Frosted see-through panels" },
    terminal: { label: "Hacker terminal", note: "Green text on black, like a computer terminal" },
    desktop:  { label: "Retro desktop",  note: "Gray 90s computer windows and buttons" },
    bold:     { label: "Bold",           note: "Thick black outlines and bright blocks" },
    paper:    { label: "Notebook",       note: "Lined paper, sticky notes and photos" },
    pixel:    { label: "Pixel",          note: "Chunky 8-bit game style" },
    comic:    { label: "Comic book",     note: "Halftone dots and speech bubbles" },
    chalk:    { label: "Chalkboard",     note: "Chalk writing on a green classroom board" },
    blueprint:{ label: "Blueprint",      note: "White lines on blue drafting paper" },
    aero:     { label: "Frutiger Aero",  note: "Blue sky, green hills, bubbles and glossy glass" },
    neon:     { label: "Neon sign",      note: "Glowing tubes on a dark brick wall" },
    lcd:      { label: "Handheld",       note: "A 4-shade green handheld game screen" },
    dock:     { label: "Dock",           note: "Dark desktop with a dock of buttons and a clock along the bottom" }
};
const SKIN_KEY = "gnmath-site-skin";
function getSiteSkin() {
    let v = "default";
    try { v = localStorage.getItem(SKIN_KEY) || "default"; } catch {}
    return SITE_SKINS[v] ? v : "default";
}
function applySiteSkin(skin = getSiteSkin()) {
    const b = document.body;
    if (!b) return;
    Object.keys(SITE_SKINS).forEach(k => b.classList.remove("st-" + k));
    if (skin !== "default") b.classList.add("st-" + skin);
    document.querySelectorAll("[data-skin]").forEach(el => el.classList.toggle("active", el.dataset.skin === skin));
    if (skin === "dock") buildDock();
}

// ── Dock style: section buttons along the bottom. Each one presses the site's own
// button for that feature, so everything (sign-in, random options...) works the same.
function buildDock() {
    if (document.getElementById("gnDock")) return;
    const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const press = id => () => { const b = document.getElementById(id); if (b) b.click(); };
    const items = [
        { key: "games", label: "Games", d: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01"/>',
          act: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
        { key: "search", label: "Search", d: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
          act: () => { window.scrollTo({ top: 0, behavior: "smooth" }); const s = document.getElementById("searchBar"); if (s) { s.readOnly = false; s.focus(); } } },
        { key: "yours", label: "Your games", d: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
          act: () => { const y = document.getElementById("yourGames"); if (y && !y.hidden) y.scrollIntoView({ behavior: "smooth", block: "start" }); else if (typeof notify === "function") notify("Games you play or star show up here."); } },
        { key: "random", label: "Random", d: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2"/><circle cx="15.5" cy="15.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/>', act: press("randomGame") },
        { key: "finder", label: "Find a game", d: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>', act: press("finderButton") },
        { key: "account", label: "Account", d: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>', act: press("accountButton") },
        { key: "settings", label: "Settings", d: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', act: press("settings") }
    ];
    const dock = document.createElement("nav");
    dock.id = "gnDock";
    dock.setAttribute("aria-label", "Sections");
    dock.innerHTML = `<button type="button" class="dock-home" title="Back to the top" aria-label="Back to the top">gn</button><span class="dock-sep" aria-hidden="true"></span>
        <div class="dock-items">${items.map(it => `<button type="button" class="dock-item${it.key === "games" ? " active" : ""}" data-dock="${it.key}">${icon(it.d)}<span>${it.label}</span></button>`).join("")}</div>
        <div class="dock-clock" aria-hidden="true"><b></b><span></span></div>`;
    document.body.appendChild(dock);
    dock.querySelector(".dock-home").onclick = items[0].act;
    items.forEach(it => { dock.querySelector(`[data-dock="${it.key}"]`).onclick = it.act; });
    // Account only when the site's own account button is shown (accounts can be off)
    const syncAccount = () => {
        const a = document.getElementById("accountButton");
        dock.querySelector('[data-dock="account"]').hidden = !a || a.style.display === "none";
    };
    syncAccount();
    const ab = document.getElementById("accountButton");
    if (ab && typeof MutationObserver !== "undefined") new MutationObserver(syncAccount).observe(ab, { attributes: true, attributeFilter: ["style", "hidden"] });
    // Clock: the person's own time and date
    const clock = dock.querySelector(".dock-clock");
    const tick = () => {
        if (!document.body.classList.contains("st-dock") || document.hidden) return;
        const now = new Date();
        clock.querySelector("b").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        clock.querySelector("span").textContent = now.toLocaleDateString();
    };
    tick();
    setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
}

function setSiteSkin(skin) {
    if (!SITE_SKINS[skin]) skin = "default";
    try { localStorage.setItem(SKIN_KEY, skin); } catch {}
    const run = () => applySiteSkin(skin);
    const reduced = document.body.classList.contains("reduced-motion") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (typeof document.startViewTransition === "function" && !reduced) document.startViewTransition(run); else run();
    if (typeof syncScrollbarColors === "function") setTimeout(syncScrollbarColors, 400);
}
// Settings → Look: the style picker
function siteSkinPickerHtml() {
    const cur = getSiteSkin();
    return Object.entries(SITE_SKINS).map(([k, s]) =>
        `<button type="button" class="skin-pick skin-prev-${k}${k === cur ? " active" : ""}" data-skin="${k}" onclick="setSiteSkin('${k}')" title="${s.note}"><span class="skin-art" aria-hidden="true"><i></i><i></i><i></i></span><b>${s.label}</b></button>`).join("");
}
if (document.body) applySiteSkin(); else document.addEventListener("DOMContentLoaded", () => applySiteSkin());
