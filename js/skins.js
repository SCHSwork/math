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
    aero:     { label: "Aero",           note: "Glossy 2000s sky and bubble buttons" },
    neon:     { label: "Neon sign",      note: "Glowing tubes on a dark brick wall" },
    lcd:      { label: "Handheld",       note: "A 4-shade green handheld game screen" }
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
