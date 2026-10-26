// ═════════════════════════════════════════════════════════════════════════════
// Per-game "More" menu + per-game data tracking.
// All games share this site's storage, so to clear ONE game's data the site
// records which storage keys each game writes (gameDataHook runs inside every
// game page) and later deletes only those.
// ═════════════════════════════════════════════════════════════════════════════
function gameDataHook() {
    var send = function (ev) {
        try { if (window.parent && window.parent !== window && window.parent.__gnmathTrackData) window.parent.__gnmathTrackData(ev); } catch (e) {}
    };
    try {
        var S = window.Storage && Storage.prototype;
        if (S) {
            var setItem = S.setItem;
            S.setItem = function (k) { if (this === window.localStorage) send({ t: "ls", key: String(k) }); return setItem.apply(this, arguments); };
        }
    } catch (e) {}
    try {
        var P = window.IDBObjectStore && IDBObjectStore.prototype;
        if (P) ["put", "add"].forEach(function (m) {
            var orig = P[m];
            P[m] = function () {
                var req = orig.apply(this, arguments);
                var db = this.transaction.db.name, store = this.name;
                req.addEventListener("success", function () { send({ t: "idb", db: db, store: store, key: req.result }); });
                return req;
            };
        });
        // Browser caches a game saves its downloaded files in (for "Re-download game files")
        var CS = window.CacheStorage && CacheStorage.prototype;
        if (CS && CS.open) {
            var open = CS.open;
            CS.open = function (name) { send({ t: "cache", name: String(name) }); return open.apply(this, arguments); };
        }
        var C = window.IDBCursor && IDBCursor.prototype;
        if (C && C.update) {
            var upd = C.update;
            C.update = function () {
                try { var src = this.source; var os = src.objectStore || src; send({ t: "idb", db: os.transaction.db.name, store: os.name, key: this.primaryKey }); } catch (e) {}
                return upd.apply(this, arguments);
            };
        }
    } catch (e) {}
}

const GAME_DATA_KEY = "gnmath-gamedata";
let currentGameId = null;
let gameDataCache = null, gameDataDirty = false;

function loadGameData() {
    if (!gameDataCache) gameDataCache = readJson(GAME_DATA_KEY, {}) || {};
    return gameDataCache;
}
function saveGameDataSoon() {
    if (gameDataDirty) return;
    gameDataDirty = true;
    setTimeout(() => { gameDataDirty = false; writeJson(GAME_DATA_KEY, loadGameData()); }, 2000);
}
function keyId(k) {
    if (typeof k === "string") return "s:" + k;
    if (typeof k === "number" && isFinite(k)) return "n:" + k;
    return null; // arrays/dates/binary keys aren't tracked
}
function keyFromId(id) { return id.startsWith("n:") ? Number(id.slice(2)) : id.slice(2); }

// Which browser caches each game uses (kept apart from the save data above)
const GAME_CACHES_KEY = "gnmath-gamecaches";
function gameCaches() { return readJson(GAME_CACHES_KEY, {}) || {}; }
window.__gnmathTrackData = function (ev) {
    if (!currentGameId) return;
    if (ev.t === "cache") {
        const all = gameCaches(), list = all[currentGameId] || (all[currentGameId] = []);
        if (!list.includes(ev.name) && list.length < 20) { list.push(ev.name); writeJson(GAME_CACHES_KEY, all); }
        return;
    }
    const all = loadGameData();
    const g = all[currentGameId] || (all[currentGameId] = { ls: [], idb: {} });
    if (ev.t === "ls") {
        if (ev.key.startsWith("gnmath-") || ev.key.startsWith("firebase:")) return;
        if (!g.ls.includes(ev.key)) { g.ls.push(ev.key); saveGameDataSoon(); }
    } else if (ev.t === "idb") {
        if (isCloudExcludedDb(ev.db)) return;
        const id = keyId(ev.key);
        if (!id) return;
        const stores = g.idb[ev.db] || (g.idb[ev.db] = {});
        const keys = stores[ev.store] || (stores[ev.store] = []);
        if (!keys.includes(id) && keys.length < 5000) { keys.push(id); saveGameDataSoon(); }
    }
};

function trackedItemCount(id) {
    const g = loadGameData()[String(id)];
    if (!g) return 0;
    let n = g.ls.length;
    for (const stores of Object.values(g.idb)) for (const keys of Object.values(stores)) n += keys.length;
    return n;
}

async function clearGameData(id) {
    const gid = String(id);
    const all = loadGameData();
    const g = all[gid];
    if (!g) return { removed: 0, skipped: 0 };
    // Anything another game also wrote is shared, so it's left alone
    const othersLs = new Set(), othersIdb = new Set();
    for (const [oid, og] of Object.entries(all)) {
        if (oid === gid) continue;
        og.ls.forEach(k => othersLs.add(k));
        for (const [db, stores] of Object.entries(og.idb)) for (const [st, keys] of Object.entries(stores)) keys.forEach(k => othersIdb.add(`${db}\u0000${st}\u0000${k}`));
    }
    let removed = 0, skipped = 0;
    for (const k of g.ls) {
        if (othersLs.has(k)) { skipped++; continue; }
        if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); removed++; }
    }
    for (const [dbName, stores] of Object.entries(g.idb)) {
        const exists = indexedDB.databases ? (await indexedDB.databases()).some(d => d.name === dbName) : true;
        if (!exists) continue;
        const db = await new Promise(resolve => {
            const req = indexedDB.open(dbName);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onupgradeneeded = () => { try { req.transaction.abort(); } catch {} resolve(null); };
        });
        if (!db) continue;
        try {
            const names = Object.keys(stores).filter(st => db.objectStoreNames.contains(st));
            if (!names.length) continue;
            const tx = db.transaction(names, "readwrite");
            for (const st of names) {
                const os = tx.objectStore(st);
                for (const kid of stores[st]) {
                    if (othersIdb.has(`${dbName}\u0000${st}\u0000${kid}`)) { skipped++; continue; }
                    os.delete(keyFromId(kid));
                    removed++;
                }
            }
            await new Promise(res => { tx.oncomplete = tx.onerror = tx.onabort = () => res(); });
        } finally {
            db.close();
        }
    }
    delete all[gid];
    writeJson(GAME_DATA_KEY, all);
    return { removed, skipped };
}

// ── The menu ────────────────────────────────────────────────────────────────
function currentZone() {
    const id = document.getElementById("zoneId")?.textContent;
    return id ? zoneById(id) : null;
}
function closeGameMenu() {
    document.getElementById("gameMenu")?.remove();
    document.getElementById("gameMenuButton")?.setAttribute("aria-expanded", "false");
}
function toggleGameMenu(ev) {
    ev?.stopPropagation();
    if (document.getElementById("gameMenu")) return closeGameMenu();
    const zone = currentZone();
    if (!zone) return;
    const btn = document.getElementById("gameMenuButton");
    btn.setAttribute("aria-expanded", "true");
    const menu = document.createElement("div");
    menu.id = "gameMenu";
    menu.setAttribute("role", "menu");
    const fav = isFavorite(zone.id);
    const tracked = trackedItemCount(zone.id);
    const items = [
        ["★", fav ? "Remove from favorites" : "Add to favorites", () => toggleFavorite(zone.id)],
        ["↻", "Restart game", () => openZone(zone)],
        ["ⓘ", "Game info", () => showZoneInfo()],
        "-",
        ["↗", "Open in new tab", () => aboutBlank()],
        ["⬇", "Download game file", () => downloadZone()],
        "-",
        ["⚠", "Report broken", () => reportCurrentZone()],
        ["📝", "Report a problem…", () => openFeedback("bug")],
        ["©", "Copyright takedown…", () => openTakedownForm(zone)],
        ...((gameCaches()[String(zone.id)] || []).length ? [["⟳", "Re-download game files", () => redownloadCurrentGame()]] : []),
        ["🗑", `Clear this game's data${tracked ? "" : "…"}`, () => clearCurrentGameData(), true]
    ];
    for (const it of items) {
        if (it === "-") { const hr = document.createElement("div"); hr.className = "gm-sep"; menu.appendChild(hr); continue; }
        const [icon, label, fn, danger] = it;
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        if (danger) b.className = "gm-danger";
        const i = document.createElement("span"); i.className = "gm-icon"; i.textContent = icon;
        const l = document.createElement("span"); l.textContent = label;
        b.append(i, l);
        b.onclick = (e) => { e.stopPropagation(); closeGameMenu(); fn(); };
        menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    menu.querySelector("button")?.focus();
}
document.addEventListener("click", e => { if (!e.target.closest?.("#gameMenu")) closeGameMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeGameMenu(); });
window.addEventListener("resize", closeGameMenu);
// Clicking into the game (an iframe) moves focus away from the page
window.addEventListener("blur", () => setTimeout(() => { if (document.activeElement && document.activeElement.tagName === "IFRAME") closeGameMenu(); }, 0));

// Deletes the game files a game saved in the browser (not its progress), so a
// broken or outdated download is fetched fresh. Caches another game also uses are kept.
async function redownloadCurrentGame() {
    const zone = currentZone();
    const id = zone ? String(zone.id) : String(currentGameId || "");
    if (!id) return;
    const all = gameCaches();
    const shared = new Set(Object.entries(all).filter(([g]) => g !== id).flatMap(([, l]) => l));
    const names = (all[id] || []).filter(n => !shared.has(n));
    if (!names.length) { notify("This game hasn't saved any game files in your browser."); return; }
    if (!(await askConfirm("The game's downloaded files will be deleted and downloaded again the next time it opens. Your progress isn't touched.", { title: "Re-download game files?", confirmText: "Re-download" }))) return;
    closeZone();
    let n = 0;
    for (const name of names) { try { if (await caches.delete(name)) n++; } catch (e) {} }
    notify(n ? "Deleted the saved game files. Downloading them again…" : "There were no saved game files left to delete. Opening the game again…", { type: "success" });
    if (zone) openZone(zone);
}

async function clearCurrentGameData() {
    const zone = currentZone();
    if (!zone) return;
    const n = trackedItemCount(zone.id);
    if (!n) {
        notify(`No saved data found for "${zone.name}". The site can only clear data saved after this feature was added, so play it a bit and try again.`);
        return;
    }
    if (!(await askConfirm(`All saved progress and settings for "${zone.name}" will be deleted. Other games aren't affected. You can only get it back from an older cloud save or export file.`, { title: "Clear this game's data?", confirmText: "Clear data", danger: true }))) return;
    // Close the game first so it can't re-save what we delete
    closeZone();
    flushPlaytime && flushPlaytime();
    const { removed, skipped } = await clearGameData(zone.id);
    notify(`Cleared ${removed} saved item${removed === 1 ? "" : "s"} for "${zone.name}".` +
        (skipped ? `\n${skipped} item${skipped === 1 ? " was" : "s were"} also used by another game and kept.` : "") +
        (typeof cloudUser !== "undefined" && cloudUser ? "\nYour cloud save will update automatically." : ""), { type: "success" });
    openZone(zone);
}
