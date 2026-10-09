// ═════════════════════════════════════════════════════════════════════════════
// Library features: favorites, recently played, play time, loading screen,
// "/" search shortcut, and shared ratings + broken-report flags.
// Favorites, recents and play time live in localStorage, so cloud saves and
// Export Data carry them to other devices automatically.
// ═════════════════════════════════════════════════════════════════════════════
const LIB_KEYS = {
    favorites: "gnmath-favorites",
    recent: "gnmath-recent",
    playtime: "gnmath-playtime",
    statsCache: "gnmath-cache-stats"   // gnmath-cache-* is never uploaded in saves
};
const RECENT_MAX = 12;
const BROKEN_FLAG_THRESHOLD = 3;   // distinct people...
const BROKEN_REPORT_DAYS = 14;     // ...within this many days
const MIN_VOTES_TO_SHOW = 3;
const STATS_SHARDS = 16;
const STATS_CACHE_MS = 10 * 60 * 1000;

function readJson(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v === null || v === undefined ? fallback : v;
    } catch { return fallback; }
}
function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn(e); }
}
function zoneById(id) { return zones.find(z => String(z.id) === String(id)); }

// ── "NEW" badges: the most recently added games (highest IDs) ───────────────
const NEW_GAME_COUNT = 12;
let newZoneIds = null, newZoneSource = null;
function isNewZone(id) {
    if (newZoneSource !== zones || !newZoneIds) {
        newZoneSource = zones;
        newZoneIds = new Set(zones.map(z => Number(z.id)).filter(n => n >= 0 && n < 100000)   // not GN Originals (own row)
            .sort((a, b) => b - a).slice(0, NEW_GAME_COUNT).map(String));
    }
    return newZoneIds.has(String(id));
}

// ── Game of the Day ─────────────────────────────────────────────────────────
// Picked from the date, so everyone sees the same game on the same day.
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function gameOfTheDay() {
    const pool = zones.filter(z => z.url && !z.url.startsWith("http") && Number(z.id) >= 0 && !isZoneDisabled(z.id))
        .sort((a, b) => Number(a.id) - Number(b.id));
    if (!pool.length) return null;
    const start = hashString("gn2-gotd-" + todayKey()) % pool.length;
    // Skip games that are currently flagged as broken
    for (let i = 0; i < pool.length; i++) {
        const z = pool[(start + i) % pool.length];
        if (!isFlaggedBroken(z.id)) return z;
    }
    return pool[start];
}
function renderGameOfTheDay() {
    const box = document.getElementById("gotd");
    if (!box) return;
    let hiddenFor = "";
    try { hiddenFor = localStorage.getItem("gnmath-gotd-hidden") || ""; } catch {}
    const z = hiddenFor === todayKey() ? null : gameOfTheDay();
    if (!z) { box.hidden = true; box.innerHTML = ""; return; }
    const st = getZoneStats(z.id);
    const votes = st.up + st.down;
    const meta = [];
    if (z.author) meta.push("By " + z.author);
    if (votes >= MIN_VOTES_TO_SHOW) meta.push(`👍 ${Math.round(st.up / votes * 100)}%`);
    const mine = getPlaytime(z.id);
    meta.push(mine >= 60 ? `You've played ${formatPlaytime(mine)}` : "New to you");
    const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    box.innerHTML = "";
    const img = document.createElement("img");
    img.alt = "";
    setCoverImage(img, z.cover || "", false);
    img.onclick = () => openZone(z);
    const info = document.createElement("div");
    info.style.minWidth = "0";
    const label = document.createElement("div"); label.className = "gotd-label"; label.textContent = `Today's pick, ${date}`;
    const h = document.createElement("h2"); h.textContent = z.name;
    const m = document.createElement("div"); m.className = "gotd-meta"; m.textContent = meta.join(" · ");
    const play = document.createElement("button"); play.className = "settings-button gotd-play"; play.textContent = "Play"; play.onclick = () => openZone(z);
    info.append(label, h, m);
    const close = document.createElement("button");
    close.className = "gotd-close"; close.title = "Hide until tomorrow"; close.setAttribute("aria-label", "Hide until tomorrow"); close.textContent = "×";
    close.onclick = () => { try { localStorage.setItem("gnmath-gotd-hidden", todayKey()); } catch {} renderGameOfTheDay(); };
    box.append(img, info, play, close);
    box.hidden = false;
}
// Roll over to the next day's game if the page stays open past midnight
setInterval(() => { const box = document.getElementById("gotd"); if (box && box.dataset.day !== todayKey()) { box.dataset.day = todayKey(); if (Array.isArray(zones) && zones.length) renderGameOfTheDay(); } }, 60000);

// ── Changelog (read from CHANGELOG.md in the repo) ──────────────────────────
async function loadChangelog() {
    legalPopup("Changelog", `<p style="color:var(--text-muted);">Loading…</p>`);
    const body = document.querySelector("#popupBody .legal-doc");
    try {
        const [owner, repo] = GITHUB_SYNC_REPO.split("/");
        const md = await fetchFirst([`https://raw.githubusercontent.com/${GITHUB_SYNC_REPO}/main/CHANGELOG.md?t=${Date.now()}`,
            MIRRORS.githack(owner, repo, "HEAD", "CHANGELOG.md"), MIRRORS.jsdelivr(owner, repo, "main", "CHANGELOG.md")],
            { timeoutMs: 10000, validate: r => r.text(), track: false });
        body.innerHTML = `<div class="changelog-doc">${renderSimpleMarkdown(md)}</div>`;
    } catch (e) {
        body.innerHTML = `<p>Couldn't load the changelog right now. You can read it on <a href="https://github.com/${GITHUB_SYNC_REPO}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">GitHub</a>.</p>`;
    }
}
// Just enough Markdown for the changelog: headings, bullet lists, **bold**, `code`, <kbd>
function renderSimpleMarkdown(md) {
    const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = t => esc(t)
        .replace(/&lt;kbd&gt;(.*?)&lt;\/kbd&gt;/g, "<kbd>$1</kbd>")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    let html = "", inList = false;
    for (const raw of md.split(/\r?\n/)) {
        const line = raw.trimEnd();
        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
        if (inList) { html += "</ul>"; inList = false; }
        const hd = line.match(/^(#{1,3})\s+(.*)$/);
        if (hd) { if (hd[1].length === 1) continue; html += `<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`; continue; }
        if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
    if (inList) html += "</ul>";
    return html;
}

// ── Shelf arrows (scrolling rows without a scrollbar) ──────────────────────
function enhanceShelf(shelf) {
    if (!shelf || shelf.dataset.enhanced) return;
    shelf.dataset.enhanced = "1";
    const wrap = document.createElement("div");
    wrap.className = "shelf-wrap";
    shelf.parentNode.insertBefore(wrap, shelf);
    wrap.appendChild(shelf);
    const chevron = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    const make = (dir) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `shelf-arrow ${dir}`;
        b.setAttribute("aria-label", dir === "prev" ? "Scroll left" : "Scroll right");
        b.innerHTML = chevron(dir === "prev" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6");
        b.onclick = () => {
            const step = Math.max(200, shelf.clientWidth * 0.85);
            const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !document.body.classList.contains("reduced-motion");
            shelf.scrollBy({ left: dir === "prev" ? -step : step, behavior: smooth ? "smooth" : "auto" });
        };
        wrap.appendChild(b);
        return b;
    };
    const prev = make("prev"), next = make("next");
    // Keyboard: Tab to the row, then ← → scroll it
    shelf.tabIndex = 0;
    const section = shelf.closest("details, section");
    const label = section?.querySelector(".section-title")?.childNodes[0]?.textContent?.trim();
    shelf.setAttribute("role", "region");
    shelf.setAttribute("aria-label", (label || "Games") + (shelf.id === "favoriteZones" ? " (favorites)" : shelf.id === "recentZones" ? " (recent)" : "") + ", use the arrow keys to scroll");
    const update = () => {
        const max = shelf.scrollWidth - shelf.clientWidth;
        const atStart = shelf.scrollLeft <= 4, atEnd = shelf.scrollLeft >= max - 4;
        prev.hidden = atStart;
        next.hidden = atEnd || max <= 4;
        wrap.classList.toggle("more-left", !atStart);
        wrap.classList.toggle("more-right", !atEnd && max > 4);
        wrap.hidden = shelf.hidden;
    };
    shelf.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(update).observe(shelf);
    new MutationObserver(update).observe(shelf, { childList: true, attributes: true, attributeFilter: ["hidden"] });
    window.addEventListener("resize", update);
    update();
    shelf._updateArrows = update;
}
document.querySelectorAll(".shelf").forEach(enhanceShelf);

// ── Sort & filter menu ──────────────────────────────────────────────────────
function toggleFilterMenu(ev) {
    ev?.stopPropagation();
    const menu = document.getElementById("filterMenu");
    const btn = document.getElementById("filterButton");
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) document.getElementById("sortOptions").focus();
}
function closeFilterMenu() {
    const menu = document.getElementById("filterMenu");
    if (menu && !menu.hidden) {
        menu.hidden = true;
        document.getElementById("filterButton").setAttribute("aria-expanded", "false");
    }
}
function updateFilterDot() {
    const dot = document.querySelector("#filterButton .filter-dot");
    if (!dot) return;
    const changed = (sortOptions.value !== getDefaultSort()) || (filterOptions.value && filterOptions.value !== "none");
    dot.hidden = !changed;
    document.getElementById("filterButton").title = changed ? "Sort & filter (changed)" : "Sort & filter";
}
function resetFilters() {
    sortOptions.value = getDefaultSort();
    filterOptions.value = "none";
    featuredContainer.innerHTML = "";
    sortZones();
    updateFilterDot();
}
document.addEventListener("click", e => { if (!e.target.closest?.("#filterMenu, #filterButton")) closeFilterMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeFilterMenu(); });
document.getElementById("sortOptions")?.addEventListener("change", updateFilterDot);
document.getElementById("filterOptions")?.addEventListener("change", updateFilterDot);

// ── Favorites ───────────────────────────────────────────────────────────────
function getFavorites() { const f = readJson(LIB_KEYS.favorites, []); return Array.isArray(f) ? f.map(String) : []; }
function isFavorite(id) { return getFavorites().includes(String(id)); }
function toggleFavorite(id) {
    const favs = getFavorites();
    const key = String(id);
    const i = favs.indexOf(key);
    if (i === -1) favs.unshift(key); else favs.splice(i, 1);
    writeJson(LIB_KEYS.favorites, favs);
    refreshCards();
}

// ── Recently played ─────────────────────────────────────────────────────────
function getRecent() { const r = readJson(LIB_KEYS.recent, []); return Array.isArray(r) ? r.map(String) : []; }
function addRecentZone(id) {
    const key = String(id);
    const list = [key, ...getRecent().filter(x => x !== key)].slice(0, RECENT_MAX);
    writeJson(LIB_KEYS.recent, list);
}

// ── Rows above Featured ─────────────────────────────────────────────────────
function fillShelf(gridId, ids) {
    const grid = document.getElementById(gridId);
    const items = ids.map(zoneById).filter(z => z && !isZoneDisabled(z.id));
    grid.innerHTML = "";
    items.forEach(z => grid.appendChild(createZoneCard(z)));
    observeLazyZoneImages(`#${gridId} img.lazy-zone-img`);
    return items.length;
}
let yourGamesTab = null;
function setYourGamesTab(tab) {
    yourGamesTab = tab;
    try { localStorage.setItem("gnmath-your-games-tab", tab); } catch {}
    renderPersonalRows();
}
function renderPersonalRows() {
    if (!Array.isArray(zones) || !zones.length) return;
    renderGameOfTheDay();
    const section = document.getElementById("yourGames");
    if (!section) return;
    const nRecent = fillShelf("recentZones", getRecent());
    const nFav = fillShelf("favoriteZones", getFavorites());
    if (!yourGamesTab) { try { yourGamesTab = localStorage.getItem("gnmath-your-games-tab"); } catch {} }
    if (yourGamesTab !== "favorites" && yourGamesTab !== "recent") yourGamesTab = nRecent ? "recent" : "favorites";
    section.hidden = nRecent + nFav === 0;
    const showFav = yourGamesTab === "favorites";
    document.getElementById("recentZones").hidden = showFav || !nRecent;
    document.getElementById("favoriteZones").hidden = !showFav || !nFav;
    const empty = document.getElementById("yourGamesEmpty");
    empty.hidden = showFav ? nFav > 0 : nRecent > 0;
    empty.textContent = showFav ? "Tap ☆ on any game to add it here." : "Games you play will show up here.";
    section.querySelectorAll(".seg button").forEach(b => {
        const on = b.dataset.tab === yourGamesTab;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.textContent = b.dataset.tab === "recent" ? "Recent" : `Favorites${nFav ? " " + nFav : ""}`;
    });
}
// Redraw every card section (after a favorite, a vote or new stats)
function refreshCards() {
    if (!Array.isArray(zones) || !zones.length) return;
    featuredContainer.innerHTML = "";
    displayFeaturedZones(zones.filter(z => z.featured));
    applyFilters();
    renderPersonalRows();
}

// ── Play time ───────────────────────────────────────────────────────────────
let playSession = null;
function getPlaytimeMap() { const m = readJson(LIB_KEYS.playtime, {}); return m && typeof m === "object" ? m : {}; }
function getPlaytime(id) { return Number(getPlaytimeMap()[String(id)]) || 0; }
function formatPlaytime(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
function flushPlaytime() {
    if (!playSession || playSession.pending < 1) return;
    const map = getPlaytimeMap();
    map[playSession.id] = (Number(map[playSession.id]) || 0) + Math.round(playSession.pending);
    playSession.pending = 0;
    writeJson(LIB_KEYS.playtime, map);
}
function startPlaytime(id) {
    stopPlaytime();
    let last = Date.now();
    playSession = { id: String(id), pending: 0, timer: null };
    playSession.timer = setInterval(() => {
        const now = Date.now();
        // Only count time while the tab is visible (playing, not just left open)
        if (document.visibilityState === "visible") playSession.pending += Math.min(now - last, 10000) / 1000;
        last = now;
        if (playSession.pending >= 30) flushPlaytime();
    }, 5000);
}
function stopPlaytime() {
    if (!playSession) return;
    clearInterval(playSession.timer);
    flushPlaytime();
    playSession = null;
}
window.addEventListener("pagehide", () => flushPlaytime());

// ── My Stats ────────────────────────────────────────────────────────────────
function openStatsPanel() {
    const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const played = Object.entries(getPlaytimeMap())
        .map(([id, sec]) => ({ id, sec: Number(sec) || 0, zone: zoneById(id) }))
        .filter(x => x.sec > 0 && x.zone)
        .sort((a, b) => b.sec - a.sec);
    const total = played.reduce((n, x) => n + x.sec, 0);
    const tried = new Set([...played.filter(x => x.sec >= 60).map(x => x.id), ...getRecent().filter(id => zoneById(id))]);
    const library = zones.filter(z => !isZoneDisabled(z.id) && z.url && !z.url.startsWith("http")).length;
    const pct = library ? Math.round(tried.size / library * 100) : 0;
    const favs = getFavorites().filter(id => zoneById(id)).length;
    let votes = 0, reports = 0;
    const uid = typeof cloudUser !== "undefined" && cloudUser ? cloudUser.uid : null;
    if (uid) for (const st of Object.values(gameStats)) {
        if (st.v && uid in st.v) votes++;
        if (st.r && uid in st.r) reports++;
    }
    const top = played.slice(0, 5);
    const max = top.length ? top[0].sec : 1;
    const lastId = getRecent()[0];
    const last = lastId ? zoneById(lastId) : null;
    const tile = (big, label) => `<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:0.75rem;text-align:center;">
        <div style="font-size:22px;font-weight:800;">${big}</div><div style="font-size:12px;color:var(--text-muted);">${label}</div></div>`;

    document.getElementById("popupTitle").textContent = "My Stats";
    const body = document.getElementById("popupBody");
    body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:0.6rem;margin-bottom:1rem;">
            ${tile(total >= 60 ? formatPlaytime(total) : "0m", "total play time")}
            ${tile(tried.size, "games tried")}
            ${tile(pct + "%", `of ${library} games explored`)}
            ${tile(favs, "favorites")}
        </div>
        <h4 style="margin:0 0 0.5rem;">Most played</h4>
        ${top.length ? top.map((x, i) => `
            <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.45rem;cursor:pointer;" onclick="closePopup(); openZone(zoneById('${esc(x.id)}'))" title="Play">
                <span style="width:1.2rem;color:var(--text-muted);font-weight:700;">${i + 1}</span>
                <span style="flex:0 0 38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${esc(x.zone.name)}</span>
                <span style="flex:1;height:8px;border-radius:99px;background:var(--bg-secondary);overflow:hidden;">
                    <span style="display:block;height:100%;width:${Math.max(4, Math.round(x.sec / max * 100))}%;background:var(--primary);border-radius:99px;"></span></span>
                <span style="flex:0 0 4.5rem;text-align:right;font-size:13px;color:var(--text-muted);">${formatPlaytime(x.sec)}</span>
            </div>`).join("") : `<p style="color:var(--text-muted);">Play a game for a minute and it'll show up here.</p>`}
        <p style="font-size:13px;color:var(--text-muted);margin:1rem 0 0;">
            ${last ? `Last played: <b>${esc(last.name)}</b>. ` : ""}
            ${uid ? `You've rated ${votes} game${votes === 1 ? "" : "s"} and reported ${reports}.` : "Sign in to keep these stats on every computer."}
        </p>
        <button class="settings-button" style="margin-top:1rem;background:var(--surface-hover);" onclick="resetMyStats()">Reset my stats</button>`;
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
}
async function resetMyStats() {
    if (!(await askConfirm("Your play time and recently played list will be cleared. Favorites and game progress are kept.", { title: "Reset your stats?", confirmText: "Reset", danger: true }))) return;
    try { localStorage.removeItem(LIB_KEYS.playtime); localStorage.removeItem(LIB_KEYS.recent); } catch {}
    refreshCards();
    openStatsPanel();
}

// ── Loading screen ──────────────────────────────────────────────────────────
function gameLoadingScreenHtml(file) {
    const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const cover = coverSources(file.cover)[0] || "";
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif}
        body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;padding:16px;box-sizing:border-box}
        img{width:160px;height:160px;object-fit:cover;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
        h1{font-size:22px;margin:0}
        .bar{width:220px;height:6px;border-radius:99px;background:#1e293b;overflow:hidden}
        .bar span{display:block;width:40%;height:100%;border-radius:99px;background:#fc2651;animation:slide 1.1s ease-in-out infinite}
        @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
        p{margin:0;color:#94a3b8;font-size:14px}
    </style></head><body>
        ${cover ? `<img src="${esc(cover)}" alt="">` : ""}
        <h1>${esc(file.name)}</h1>
        <div class="bar"><span></span></div>
        <p>Loading game…</p>
    </body></html>`;
}

// ── Keyboard shortcuts panel ("?") ──────────────────────────────────────────
function showShortcuts() {
    const panic = typeof getPanicKey === "function" ? panicKeyName(getPanicKey()) : "`";
    const panicOn = typeof getPanicKeyEnabled !== "function" || getPanicKeyEnabled();
    const rows = [
        ["/", "Jump to the search box"],
        [panic, panicOn ? "Panic: leave instantly for your safe website (works during games too)" : "Panic key (turned off in Settings)"],
        ["?", "Show this list"],
        ["Esc", "Close a panel, menu or dialog"],
        ["Tab", "Move between buttons and links; Enter or Space presses them"],
        ["← →", "Scroll a row of games (Tab to the row first)"]
    ];
    document.getElementById("popupTitle").textContent = "Keyboard shortcuts";
    const body = document.getElementById("popupBody");
    body.innerHTML = "";
    const table = document.createElement("table");
    table.className = "shortcuts";
    for (const [key, what] of rows) {
        const tr = table.insertRow();
        const k = tr.insertCell(); const kbd = document.createElement("kbd"); kbd.textContent = key; k.appendChild(kbd);
        tr.insertCell().textContent = what;
    }
    const note = document.createElement("p");
    note.style.cssText = "margin:1rem 0 0;font-size:13px;color:var(--text-muted);";
    note.textContent = "Shortcuts don't work while you're typing in a box. You can change the panic key in Settings.";
    body.append(table, note);
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
}
window.addEventListener("keydown", e => {
    if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
    if (zoneViewer.style.display === "flex") return;
    e.preventDefault();
    showShortcuts();
});

// ── "/" jumps to search ─────────────────────────────────────────────────────
window.addEventListener("keydown", e => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
    if (zoneViewer.style.display === "flex") return; // a game is open
    e.preventDefault();
    searchBar.focus();
    searchBar.select();
});

// ── Shared ratings + broken reports (Firestore: gameStats/s0 … s15) ─────────
// Each shard doc holds { "z<id>": { v: { <uid>: 1 | -1 }, r: { <uid>: timestamp } } }.
// Rules only let a signed-in user change their own entry.
let gameStats = {};   // { "<id>": { up, down, reports, v: {uid: ±1}, r: {uid: ms} } }
function shardFor(id) { const n = Number(id) || 0; return "s" + (((n % STATS_SHARDS) + STATS_SHARDS) % STATS_SHARDS); }
function getZoneStats(id) { return gameStats[String(id)] || { up: 0, down: 0, reports: 0, v: {}, r: {} }; }

// ── Trusted reporters ───────────────────────────────────────────────────────
// Accounts the owner trusts (set in the owner panel, saved in owner-settings.json).
// One recent "broken" report from a trusted account flags the game right away.
// Safe because the database rules only let an account write reports under its own id.
const TRUSTED_REPORTERS_KEY = "gnmath-owner-trusted-reporters";
function getTrustedReporters() {
    try {
        const list = JSON.parse(localStorage.getItem(TRUSTED_REPORTERS_KEY) || "[]");
        return Array.isArray(list) ? list.filter(x => x && typeof x.uid === "string" && x.uid) : [];
    } catch { return []; }
}
function setTrustedReporters(list) {
    try { localStorage.setItem(TRUSTED_REPORTERS_KEY, JSON.stringify(list)); } catch {}
}
function isTrustedReporter(uid) { return !!uid && getTrustedReporters().some(x => x.uid === uid); }
function hasTrustedReport(stats) {
    const cutoff = Date.now() - BROKEN_REPORT_DAYS * 86400000;
    return Object.entries(stats.r || {}).some(([uid, ms]) => ms >= cutoff && isTrustedReporter(uid));
}
function isFlaggedBroken(statsOrId) {
    const s = typeof statsOrId === "object" && statsOrId ? statsOrId : getZoneStats(statsOrId);
    return s.reports >= BROKEN_FLAG_THRESHOLD || hasTrustedReport(s);
}
function ratingScore(id) {
    const s = getZoneStats(id);
    return (s.up + 1) / (s.up + s.down + 2); // smoothed % liked, so 1 vote doesn't beat 50
}
function summarizeStats(raw) {
    const out = {};
    const cutoff = Date.now() - BROKEN_REPORT_DAYS * 86400000;
    for (const [zk, entry] of Object.entries(raw)) {
        const id = zk.slice(1);
        const v = entry.v || {}, r = entry.r || {};
        const values = Object.values(v);
        out[id] = {
            up: values.filter(x => x === 1).length,
            down: values.filter(x => x === -1).length,
            reports: Object.values(r).filter(ms => ms >= cutoff).length,
            v, r
        };
    }
    return out;
}
async function loadGameStats({ force = false } = {}) {
    const cached = readJson(LIB_KEYS.statsCache, null);
    if (cached && cached.raw) gameStats = summarizeStats(cached.raw);
    if (!force && cached && Date.now() - cached.t < STATS_CACHE_MS) return;
    if (typeof cloudDb === "undefined" || !cloudDb) return;
    try {
        const snap = await cloudDb.collection("gameStats").get();
        const raw = {};
        snap.docs.forEach(doc => {
            const data = doc.data() || {};
            for (const [zk, entry] of Object.entries(data)) {
                if (!/^z-?\d+$/.test(zk) || !entry || typeof entry !== "object") continue;
                const dest = raw[zk] || (raw[zk] = { v: {}, r: {} });
                for (const [uid, val] of Object.entries(entry.v || {})) if (val === 1 || val === -1) dest.v[uid] = val;
                for (const [uid, ts] of Object.entries(entry.r || {})) {
                    const ms = ts && typeof ts.toMillis === "function" ? ts.toMillis() : Number(ts) || 0;
                    dest.r[uid] = Math.max(dest.r[uid] || 0, ms);
                }
            }
        });
        writeJson(LIB_KEYS.statsCache, { t: Date.now(), raw });
        gameStats = summarizeStats(raw);
        refreshCards();
        const open = document.getElementById("zoneId")?.textContent;
        if (open && zoneViewer.style.display === "flex") updateRatingBar(open);
    } catch (e) {
        console.warn("Couldn't load ratings/reports", e);
    }
}
function updateRatingBar(id) {
    const s = getZoneStats(id);
    const uid = cloudUser && cloudUser.uid;
    const mine = uid ? s.v[uid] : undefined;
    const up = document.getElementById("rateUp"), down = document.getElementById("rateDown");
    if (!up || !down) return;
    document.getElementById("rateUpCount").textContent = s.up || "";
    document.getElementById("rateDownCount").textContent = s.down || "";
    up.classList.toggle("voted", mine === 1);
    down.classList.toggle("voted", mine === -1);
}
function statsErrorText(e) {
    const code = (e && e.code) || "";
    if (code.includes("permission-denied") || /insufficient permissions/i.test((e && e.message) || ""))
        return "this feature isn't switched on yet (the site owner needs to update the database rules).";
    return (e && e.message) || String(e);
}
function needAccountFor(what) {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) { notify(`${what} isn't available on this site.`); return true; }
    if (!cloudUser) {
        notify(`Sign in or create a free account to use ${what.toLowerCase()}, so each person only counts once.`);
        openAccountPanel();
        return true;
    }
    return false;
}
async function writeGameStat(id, field, value, { remove = false } = {}) {
    const zk = "z" + String(id);
    const uid = cloudUser.uid;
    const stored = remove ? firebase.firestore.FieldValue.delete()
        : field === "r" ? firebase.firestore.FieldValue.serverTimestamp() : value;
    await cloudDb.collection("gameStats").doc(shardFor(id)).set({
        [zk]: { [field]: { [uid]: stored } },
        last: { z: zk, u: uid }
    }, { merge: true });
    // Update our local copy right away so the UI reacts instantly
    const cached = readJson(LIB_KEYS.statsCache, { t: 0, raw: {} });
    const entry = cached.raw[zk] || (cached.raw[zk] = { v: {}, r: {} });
    if (field === "v") { if (remove) delete entry.v[uid]; else entry.v[uid] = value; }
    if (field === "r") entry.r[uid] = Date.now();
    writeJson(LIB_KEYS.statsCache, cached);
    gameStats = summarizeStats(cached.raw);
}
async function rateCurrentZone(value) {
    const id = document.getElementById("zoneId").textContent;
    if (!id || needAccountFor("Rating games")) return;
    const current = getZoneStats(id).v[cloudUser.uid];
    try {
        // Clicking your current vote again removes it
        await writeGameStat(id, "v", value, { remove: current === value });
        updateRatingBar(id);
        refreshCards();
    } catch (e) {
        console.error(e);
        notify("Couldn't save your rating: " + statsErrorText(e), { type: "error" });
    }
}
async function reportBrokenShared(zone) {
    if (needAccountFor("Reporting broken games")) return;
    const trusted = isTrustedReporter(cloudUser && cloudUser.uid);
    const how = trusted
        ? `You're a trusted reporter, so your report flags this game for everyone right away. Report it again later to take the flag back off.`
        : `When ${BROKEN_FLAG_THRESHOLD} or more people report a game within ${BROKEN_REPORT_DAYS} days, it gets a warning flag for everyone.`;
    if (!(await askConfirm(how, { title: `Report "${zone.name}" as broken?`, confirmText: "Report" }))) return;
    try {
        await writeGameStat(zone.id, "r", true);
        refreshCards();
        notify(`Thanks, "${zone.name}" was reported. It has ${getZoneStats(zone.id).reports} report(s) in the last ${BROKEN_REPORT_DAYS} days.`, { type: "success" });
    } catch (e) {
        console.error(e);
        notify("Couldn't send the report: " + statsErrorText(e), { type: "error" });
    }
}

// Remove every rating and report this account made (used by Delete account).
// The rules allow one game per write, so this writes once per game touched.
async function removeMyGameStats(uid) {
    const snap = await cloudDb.collection("gameStats").get();
    const del = firebase.firestore.FieldValue.delete();
    for (const doc of snap.docs) {
        const data = doc.data() || {};
        for (const [zk, entry] of Object.entries(data)) {
            if (!/^z-?\d+$/.test(zk) || !entry || typeof entry !== "object") continue;
            const mine = (entry.v && uid in entry.v) || (entry.r && uid in entry.r);
            if (!mine) continue;
            await doc.ref.set({ [zk]: { v: { [uid]: del }, r: { [uid]: del } }, last: { z: zk, u: uid } }, { merge: true });
        }
    }
    try { localStorage.removeItem(LIB_KEYS.statsCache); } catch {}
}

// Load cached stats immediately, then fresh ones once Firebase is ready
gameStats = summarizeStats((readJson(LIB_KEYS.statsCache, {}) || {}).raw || {});
(function waitForDb(tries) {
    if (typeof cloudDb !== "undefined" && cloudDb) return loadGameStats();
    if (tries > 0) setTimeout(() => waitForDb(tries - 1), 500);
})(40);
setInterval(() => { if (!document.hidden) loadGameStats(); }, STATS_CACHE_MS);
