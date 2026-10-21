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
    dock:     { label: "Dock",           note: "Dark desktop with a dock of buttons and a clock along the bottom" },
    hud:      { label: "Sci-fi HUD",     note: "A spaceship console with glowing cyan panels" },
    candy:    { label: "Candy",          note: "Pastel sprinkles and squishy jelly buttons" },
    quest:    { label: "Fantasy quest",  note: "Parchment cards in gold frames on a stone wall" },
    web99:    { label: "Web 1999",       note: "An old-school starry homepage with a rainbow logo" },
    sheet:    { label: "Spreadsheet",    note: "Looks like a work spreadsheet" },
    minimal:  { label: "Minimalist",     note: "Clean and spacious, just covers and names (uses your color theme and light/dark mode)" },
    semiflat: { label: "Semi-Flat",      note: "Friendly flat colors and soft shadows (uses your color theme and light/dark mode)" },
    neu:      { label: "Neumorphism",    note: "Soft buttons and cards that look pressed out of the page" },
    cyber:    { label: "Cyberpunk",      note: "Hazard yellow, hot pink and cyan with angled cuts" },
    cards:    { label: "Trading cards",  note: "Games as collectible cards; the frame shows how often it's played (common to legendary)" },
    vhs:      { label: "VHS shelf",      note: "Games as tapes on wooden shelves; point at one to slide it out" },
    denim:    { label: "Patches on denim", note: "Games as stitched-on patches on a jeans background" },
    aqua:     { label: "Aquarium",       note: "Fish, jellyfish and light rays swim behind glass cards that bob in the water" },
    arcade:   { label: "Arcade",         note: "Every game is a glowing arcade cabinet with a CRT screen and joystick" },
    popup:    { label: "Pop-up book",    note: "An open storybook; games fold up off the page as you scroll to them" },
    vend:     { label: "Vending machine", note: "Games on coils behind glass, each with a slot number and a price" },
    museum:   { label: "Art museum",     note: "Games hang in frames under spotlights, with a placard" },
    receipt:  { label: "Receipt",        note: "The page is a long store receipt and games are line items" },
    metro:    { label: "Subway map",     note: "Games are stations along colored train lines" }
};
const SKIN_KEY = "gnmath-site-skin";
const SKINS_WITH_SCENES = new Set(["default", "glass"]);
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
    // Only Default and Glass draw scenes; settings hides the scene pickers for the rest
    b.classList.toggle("skin-no-scenes", !SKINS_WITH_SCENES.has(skin));
    document.querySelectorAll("[data-skin]").forEach(el => el.classList.toggle("active", el.dataset.skin === skin));
    if (skin === "dock") buildDock();
    if (window.stAquaFx) window.stAquaFx();
    placeStatusLight();
}
// The Dock style shows the status light inside the dock, by the clock; other styles keep it in its corner
function placeStatusLight() {
    const light = document.getElementById("siteStatus");
    if (!light) return;
    const dock = document.getElementById("gnDock");
    const inDock = document.body.classList.contains("st-dock") && dock;
    if (inDock && light.parentElement !== dock) dock.insertBefore(light, dock.querySelector(".dock-clock"));
    else if (!inDock && light.parentElement !== document.body) document.body.appendChild(light);
}
// the status light is created by status.js, possibly after this runs
setInterval(placeStatusLight, 1500);

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
    placeStatusLight();
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

// Trading cards: the holo foil and a slight tilt follow the pointer (no tilt with reduced motion)
(function () {
    let last = null;
    const reset = c => { if (c) { c.style.removeProperty("--rx"); c.style.removeProperty("--ry"); c.style.removeProperty("--mx"); c.style.removeProperty("--my"); } };
    document.addEventListener("pointermove", e => {
        if (!document.body.classList.contains("st-cards")) return;
        const card = e.target.closest && e.target.closest(".zone-item");
        if (card !== last) { reset(last); last = card; }
        if (!card) return;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
        card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
        const still = document.body.classList.contains("reduced-motion") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
        if (!still) { card.style.setProperty("--rx", ((x - .5) * 14).toFixed(1) + "deg"); card.style.setProperty("--ry", ((.5 - y) * 14).toFixed(1) + "deg"); }
    }, { passive: true });
    document.addEventListener("pointerleave", () => { reset(last); last = null; });
})();

// Aquarium: fish, jellyfish, light rays, bubbles and seaweed drawn on a canvas behind the page.
// Runs only while the Aquarium style is on, stops while a game is open or the tab is hidden,
// and draws one still frame with reduced motion.
(function () {
    let cv = null, cx = null, raf = 0, W = 0, H = 0, last = 0, fish = [], jellies = [], bubbles = [], weeds = [];
    const on = () => document.body.classList.contains("st-aqua");
    const still = () => document.body.classList.contains("reduced-motion") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const gameOpen = () => { const v = document.getElementById("zoneViewer"); return !!v && getComputedStyle(v).display !== "none"; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const PALETTES = [["#ff8a3d", "#ffb36b", true], ["#4fc3f7", "#0277bd"], ["#ffe14d", "#f9a825"], ["#f472b6", "#be185d"], ["#7ef0d0", "#14a38b"], ["#a78bfa", "#6d28d9"], ["#ff8a3d", "#ffb36b", true]];
    function newFish(anywhere) {
        const depth = rnd(.35, 1), dir = Math.random() < .5 ? 1 : -1, size = 10 + depth * 26, p = PALETTES[Math.floor(Math.random() * PALETTES.length)];
        return { x: anywhere ? rnd(0, W) : (dir > 0 ? -60 : W + 60), y: rnd(H * .12, H * .88), dir, size, depth, speed: (18 + size * 1.6) * rnd(.7, 1.2),
            c1: p[0], c2: p[1], stripes: !!p[2], phase: rnd(0, 6.28), wob: rnd(.4, 1.2) };
    }
    function seed() {
        const n = Math.round(Math.max(6, Math.min(16, W / 95)));
        fish = Array.from({ length: n }, () => newFish(true)).sort((a, b) => a.depth - b.depth);
        jellies = Array.from({ length: W < 700 ? 1 : 3 }, (_, i) => ({ x: rnd(W * .1, W * .9), y: rnd(H * .2, H * .9), r: rnd(16, 30), phase: rnd(0, 6.28), hue: [320, 280, 195][i % 3] }));
        bubbles = Array.from({ length: Math.round(W / 40) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.5, 4.5), v: rnd(20, 55), ph: rnd(0, 6.28) }));
        weeds = Array.from({ length: Math.round(W / 70) }, (_, i) => ({ x: (i + rnd(.1, .9)) * 70, h: rnd(60, 170), w: rnd(5, 9), ph: rnd(0, 6.28), c: Math.random() < .5 ? "#1f8a52" : "#2fa866" }));
    }
    function resize() {
        if (!cv) return;
        W = innerWidth; H = innerHeight; cv.width = W; cv.height = H; seed();
        if (!raf) draw(performance.now() / 1000);
    }
    function drawFish(f, t) {
        const s = f.size, sw = Math.sin(t * 9 * f.wob + f.phase);
        cx.save();
        cx.translate(f.x, f.y + Math.sin(t * 1.3 + f.phase) * 6);
        cx.scale(f.dir, 1);
        cx.globalAlpha = .35 + f.depth * .65;
        // tail
        cx.fillStyle = f.c2;
        cx.beginPath(); cx.moveTo(-s * .8, 0); cx.lineTo(-s * 1.45, -s * .5 + sw * s * .15); cx.lineTo(-s * 1.3, sw * s * .1); cx.lineTo(-s * 1.45, s * .5 + sw * s * .15); cx.closePath(); cx.fill();
        // top fin
        cx.beginPath(); cx.moveTo(-s * .3, -s * .42); cx.quadraticCurveTo(s * .05, -s * .9, s * .35, -s * .38); cx.closePath(); cx.fill();
        // body
        const g = cx.createLinearGradient(0, -s * .5, 0, s * .5); g.addColorStop(0, f.c1); g.addColorStop(1, f.c2);
        cx.fillStyle = g; cx.beginPath(); cx.ellipse(0, 0, s, s * .52, 0, 0, Math.PI * 2); cx.fill();
        if (f.stripes) {
            cx.save(); cx.clip(); cx.fillStyle = "rgba(255,255,255,.92)";
            cx.fillRect(s * .25, -s, s * .22, s * 2); cx.fillRect(-s * .4, -s, s * .2, s * 2);
            cx.restore();
        }
        // belly shine and eye
        cx.fillStyle = "rgba(255,255,255,.25)"; cx.beginPath(); cx.ellipse(s * .1, -s * .2, s * .55, s * .14, 0, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(s * .58, -s * .1, s * .13, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#0b1b2b"; cx.beginPath(); cx.arc(s * .62, -s * .1, s * .07, 0, Math.PI * 2); cx.fill();
        cx.restore();
    }
    function drawJelly(j, t) {
        const pulse = (Math.sin(t * 1.6 + j.phase) + 1) / 2, r = j.r * (1 + pulse * .12), y = j.y;
        cx.save(); cx.translate(j.x, y);
        const g = cx.createRadialGradient(0, -r * .2, r * .1, 0, 0, r * 1.2);
        g.addColorStop(0, `hsla(${j.hue},100%,85%,.75)`); g.addColorStop(1, `hsla(${j.hue},100%,65%,.08)`);
        cx.shadowColor = `hsla(${j.hue},100%,70%,.8)`; cx.shadowBlur = 18;
        cx.fillStyle = g; cx.beginPath(); cx.ellipse(0, 0, r, r * (.75 - pulse * .1), 0, Math.PI, 0); cx.quadraticCurveTo(r * .5, r * .18, 0, r * .12); cx.quadraticCurveTo(-r * .5, r * .18, -r, 0); cx.fill();
        cx.shadowBlur = 0; cx.strokeStyle = `hsla(${j.hue},100%,80%,.45)`; cx.lineWidth = 1.5;
        for (let k = -2; k <= 2; k++) {
            cx.beginPath(); cx.moveTo(k * r * .3, r * .1);
            for (let s = 1; s <= 6; s++) cx.lineTo(k * r * .3 + Math.sin(t * 2 + s * .8 + k + j.phase) * 4, r * .1 + s * r * .28);
            cx.stroke();
        }
        cx.restore();
    }
    function draw(t) {
        cx.clearRect(0, 0, W, H);
        // light rays from the surface
        cx.save(); cx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 6; i++) {
            const x = W * (i + .5) / 6 + Math.sin(t * .25 + i * 1.7) * 40, lean = Math.sin(t * .2 + i) * 60 + 80, w = 40 + (i % 3) * 30;
            const g = cx.createLinearGradient(0, 0, 0, H * .85); g.addColorStop(0, "rgba(190,245,255,.13)"); g.addColorStop(1, "rgba(190,245,255,0)");
            cx.fillStyle = g; cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x + w, 0); cx.lineTo(x + w * 2.6 + lean, H * .85); cx.lineTo(x + lean, H * .85); cx.closePath(); cx.fill();
        }
        cx.restore();
        // seaweed swaying along the bottom
        weeds.forEach(w => {
            cx.strokeStyle = w.c; cx.lineWidth = w.w; cx.lineCap = "round";
            cx.beginPath(); cx.moveTo(w.x, H + 4);
            const sway = Math.sin(t * .9 + w.ph) * 18;
            cx.bezierCurveTo(w.x - 14 + sway * .3, H - w.h * .35, w.x + 14 + sway * .7, H - w.h * .7, w.x + sway, H - w.h);
            cx.stroke();
        });
        jellies.forEach(j => drawJelly(j, t));
        fish.forEach(f => drawFish(f, t));
        // bubbles
        bubbles.forEach(b => {
            const x = b.x + Math.sin(t * 2 + b.ph) * 4;
            cx.strokeStyle = "rgba(220,250,255,.55)"; cx.lineWidth = 1; cx.beginPath(); cx.arc(x, b.y, b.r, 0, Math.PI * 2); cx.stroke();
            cx.fillStyle = "rgba(255,255,255,.6)"; cx.beginPath(); cx.arc(x - b.r * .35, b.y - b.r * .35, b.r * .3, 0, Math.PI * 2); cx.fill();
        });
    }
    function step(dt, t) {
        fish.forEach((f, i) => {
            f.x += f.dir * f.speed * dt * (.5 + f.depth * .5);
            if (f.x < -90 || f.x > W + 90) fish[i] = newFish(false);
        });
        fish.sort((a, b) => a.depth - b.depth);
        jellies.forEach(j => { j.y -= (Math.sin(t * 1.6 + j.phase) + 1.1) * 6 * dt; if (j.y < -60) { j.y = H + 60; j.x = rnd(W * .1, W * .9); } });
        bubbles.forEach(b => { b.y -= b.v * dt; if (b.y < -10) { b.y = H + 10; b.x = rnd(0, W); } });
    }
    function frame(ms) {
        raf = 0;
        if (!on() || !cv) return;
        const t = ms / 1000, dt = Math.min(.05, last ? t - last : 0); last = t;
        if (document.hidden || gameOpen()) { last = 0; setTimeout(() => { if (!raf) raf = requestAnimationFrame(frame); }, 600); return; }
        step(dt, t); draw(t);
        if (!still()) raf = requestAnimationFrame(frame);
    }
    window.stAquaFx = function () {
        if (!on()) { if (raf) cancelAnimationFrame(raf); raf = 0; return; }
        if (!cv) {
            cv = document.createElement("canvas"); cv.id = "stFx"; cv.setAttribute("aria-hidden", "true");
            document.body.prepend(cv); cx = cv.getContext("2d"); addEventListener("resize", resize); resize();
        }
        if (still()) { draw(performance.now() / 1000); return; }
        if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) window.stAquaFx(); });
    window.stAquaFx();
})();
