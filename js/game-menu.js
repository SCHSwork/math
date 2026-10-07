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

window.__gnmathTrackData = function (ev) {
    if (!currentGameId) return;
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
