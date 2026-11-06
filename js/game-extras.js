// ═════════════════════════════════════════════════════════════════════════════
// Small things for while you play:
//  • Save backups: a copy of one game's progress is kept in this browser every
//    time you close the game (the last 3 that differ), and right before "Clear
//    this game's data" or a restore. ⋯ More → Save backups lists them, and
//    lets you back up now, restore one, or save/load a backup file.
//  • Mute: 🔊 in the game's top bar (or Alt+M) silences the game without
//    closing it. It stays on for every game until you turn it off or reload.
//  • Copy link: ⋯ More → Copy link to this game. The link opens the site with
//    that game already open (?play=<id>, removed from the address bar after).
//  • Download sizes: how much each game downloads, measured by the nightly
//    game check (tools/check_games.mjs → config/game-sizes.json). Big games
//    show their size on the card, and Show → "Quick to load" lists the small ones.
// ═════════════════════════════════════════════════════════════════════════════

// ── Save backups ────────────────────────────────────────────────────────────
// Kept in their own database (gnmath-backups), which cloud saves skip so they
// don't grow. Backups only cover the saves the site has seen the game write
// (the same list "Clear this game's data" uses).
const BACKUP_DB = "gnmath-backups";
const BACKUP_KEEP = { auto: 3, manual: 5, before: 3 };
const BACKUP_MAX_CHARS = 25 * 1024 * 1024;   // a bigger save isn't backed up automatically
const backupBusy = new Set();

function backupDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(BACKUP_DB, 1);
        req.onupgradeneeded = () => {
            const os = req.result.createObjectStore("b", { keyPath: "k", autoIncrement: true });
            os.createIndex("game", "game");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function backupTx(mode, fn) {
    const db = await backupDb();
    try {
        const tx = db.transaction("b", mode);
        const out = await fn(tx.objectStore("b"));
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
        return out;
    } finally { db.close(); }
}
const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function listBackups(id) {
    const list = await backupTx("readonly", os => idbReq(os.index("game").getAll(String(id))));
    return list.sort((a, b) => b.at - a.at);
}
async function getBackup(k) { return backupTx("readonly", os => idbReq(os.get(k))); }
async function deleteBackup(k) { return backupTx("readwrite", os => { os.delete(k); }); }

// Opens a game's database without creating it (null if it doesn't exist)
function openExistingDb(name) {
    return new Promise(resolve => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onupgradeneeded = () => { try { req.transaction.abort(); } catch {} resolve(null); };
    });
}

// Everything one game saved: { ls: {key: value}, idb: [{ db, version, store, keyPath, autoIncrement, entries: [[keyId, value]] }] }
async function collectGameSave(id) {
    const g = loadGameData()[String(id)];
    const out = { ls: {}, idb: [] };
    if (!g) return out;
    for (const k of g.ls) { const v = localStorage.getItem(k); if (v !== null) out.ls[k] = v; }
    const pendingBlobs = [];
    for (const [dbName, stores] of Object.entries(g.idb)) {
        const db = await openExistingDb(dbName);
        if (!db) continue;
        try {
            const names = Object.keys(stores).filter(st => db.objectStoreNames.contains(st));
            if (!names.length) continue;
            const tx = db.transaction(names, "readonly");
            await Promise.all(names.map(async st => {
                const os = tx.objectStore(st);
                const part = { db: dbName, version: db.version, store: st, keyPath: os.keyPath, autoIncrement: os.autoIncrement, entries: [] };
                await Promise.all(stores[st].map(kid => idbReq(os.get(keyFromId(kid))).then(v => {
                    if (v !== undefined) part.entries.push([kid, encodeValue(v, pendingBlobs)]);
                }).catch(() => {})));
                if (part.entries.length) out.idb.push(part);
            }));
        } finally { db.close(); }
    }
    for (const { ph, blob } of pendingBlobs) ph.d = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
    return out;
}
function saveIsEmpty(s) { return !Object.keys(s.ls).length && !s.idb.length; }

// kind: "auto" (game closed), "manual" (Back up now), "before" (before clearing or restoring)
async function backupGameSave(id, kind = "auto", note = "") {
    const gid = String(id);
    if (backupBusy.has(gid) || !trackedItemCount(gid)) return null;
    backupBusy.add(gid);
    try {
        const data = await collectGameSave(gid);
        if (saveIsEmpty(data)) return null;
        const text = JSON.stringify(data);
        if (text.length > BACKUP_MAX_CHARS && kind === "auto") return null;
        const hash = await sha256Hex(text);
        const existing = await listBackups(gid);
        // Nothing changed since the newest backup: don't keep the same save twice
        if (kind === "auto" && existing[0] && existing[0].hash === hash) return existing[0];
        const zone = typeof zoneById === "function" ? zoneById(gid) : null;
        const rec = { game: gid, name: zone ? zone.name : "", at: Date.now(), kind, note, hash, size: text.length, data };
        await backupTx("readwrite", os => {
            os.add(rec);
            // Keep only the newest few of each kind
            existing.filter(b => b.kind === kind).slice(BACKUP_KEEP[kind] - 1).forEach(b => os.delete(b.k));
        });
        return rec;
    } catch (e) {
        console.warn("Save backup failed", e);
        return null;
    } finally { backupBusy.delete(gid); }
}

async function writeGameSave(id, data) {
    const gid = String(id);
    for (const [k, v] of Object.entries(data.ls || {})) localStorage.setItem(k, v);
    for (const part of data.idb || []) {
        let db = await openExistingDb(part.db);
        const makeStore = udb => {
            if (udb.objectStoreNames.contains(part.store)) return;
            const opts = { autoIncrement: !!part.autoIncrement };
            if (part.keyPath !== null && part.keyPath !== undefined) opts.keyPath = part.keyPath;
            udb.createObjectStore(part.store, opts);
        };
        if (!db || !db.objectStoreNames.contains(part.store)) {
            const version = db ? db.version + 1 : (part.version || 1);
            if (db) db.close();
            db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(part.db, version);
                req.onupgradeneeded = () => makeStore(req.result);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error("The game's storage is in use. Close other tabs with this site open and try again."));
            });
        }
        try {
            const tx = db.transaction(part.store, "readwrite");
            const os = tx.objectStore(part.store);
            const inline = os.keyPath !== null && os.keyPath !== undefined;
            for (const [kid, v] of part.entries) {
                if (inline) os.put(decodeValue(v)); else os.put(decodeValue(v), keyFromId(kid));
            }
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
        } finally { db.close(); }
    }
    // Remember what the game owns again, so clearing and backing up keep working
    const all = loadGameData();
    const g = all[gid] || (all[gid] = { ls: [], idb: {} });
    for (const k of Object.keys(data.ls || {})) if (!g.ls.includes(k)) g.ls.push(k);
    for (const part of data.idb || []) {
        const keys = ((g.idb[part.db] ||= {})[part.store] ||= []);
        for (const [kid] of part.entries) if (!keys.includes(kid)) keys.push(kid);
    }
    writeJson(GAME_DATA_KEY, all);
}

async function restoreGameSave(id, data) {
    const gid = String(id);
    const zone = zoneById(gid);
    const wasOpen = currentGameId === gid;
    if (wasOpen) closeZone();
    if (typeof flushPlaytime === "function") flushPlaytime();
    await new Promise(r => setTimeout(r, 300));   // let the closed game's last writes finish
    await backupGameSave(gid, "before", "before restoring").catch(() => {});
    backupBusy.add(gid);
    try {
        // Start from nothing so the game doesn't mix the old and the restored save
        await clearGameData(gid);
        await writeGameSave(gid, data);
    } finally { backupBusy.delete(gid); }
    notify(`Restored the save for "${zone ? zone.name : "this game"}".` + (typeof cloudUser !== "undefined" && cloudUser ? "\nYour cloud save will update automatically." : ""), { type: "success" });
    if (zone) openZone(zone);
}

// A backup every time a game is closed (or another game is opened in its place)
(function () {
    const later = id => { if (id) setTimeout(() => backupGameSave(id, "auto"), 1500); };
    const origClose = closeZone;
    closeZone = function () { const id = currentGameId; const r = origClose.apply(this, arguments); later(id); return r; };
    const origOpen = openZone;
    openZone = function (file) { const id = currentGameId; const r = origOpen.apply(this, arguments); if (id && (!file || String(file.id) !== id)) later(id); return r; };
})();

// ── Save backups panel ──────────────────────────────────────────────────────
function backupWhen(at) {
    const d = new Date(at), now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }) + ", " + time;
}
function backupKindLabel(b) {
    if (b.kind === "manual") return "Saved by you";
    if (b.kind === "before") return b.note === "before restoring" ? "Before a restore" : "Before clearing data";
    return "When you closed the game";
}
function sizeText(chars) {
    if (chars < 1024) return `${chars} B`;
    if (chars < 1024 * 1024) return `${Math.max(1, Math.round(chars / 1024))} KB`;
    return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}

async function openSaveBackups(zone = currentZone()) {
    if (!zone) return;
    if (typeof isPartnerZone === "function" && isPartnerZone(zone)) {
        notify("Partner games play from html5games.com or Playgama and save there, so their saves can't be backed up here.");
        return;
    }
    const gid = String(zone.id);
    document.getElementById("popupTitle").textContent = `Save backups: ${zone.name}`;
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
    body.innerHTML = "<p>Loading…</p>";
    let list = [];
    try { list = await listBackups(gid); }
    catch (e) { body.innerHTML = `<p>Backups can't be kept in this browser (its storage is turned off or full).</p>`; return; }
    const tracked = trackedItemCount(gid);
    body.innerHTML = "";
    const intro = document.createElement("p");
    intro.style.marginTop = "0";
    intro.textContent = "A copy of this game's progress is kept in this browser each time you close it (the last 3), and before its data is cleared or restored. Restoring puts the game back exactly how it was then.";
    const actions = document.createElement("div");
    actions.className = "backup-actions";
    const mk = (text, fn, cls = "settings-button") => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text; b.onclick = fn; return b; };
    actions.append(
        mk("💾 Back up now", async () => {
            if (!trackedItemCount(gid)) { notify(`No saved progress found for "${zone.name}" yet. Play it a bit first.`); return; }
            const rec = await backupGameSave(gid, "manual");
            notify(rec ? "Backed up this game's save." : "Couldn't make a backup right now.", { type: rec ? "success" : "error" });
            openSaveBackups(zone);
        }),
        mk("📂 Restore from a file…", () => restoreBackupFromFile(zone))
    );
    body.append(intro, actions);
    if (!list.length) {
        const p = document.createElement("p");
        p.className = "backup-empty";
        p.textContent = tracked ? "No backups yet. One is made the next time you close the game, or press Back up now."
            : "No backups yet. The site needs to see the game save first, so play it a bit and close it.";
        body.appendChild(p);
        return;
    }
    const ul = document.createElement("ul");
    ul.className = "backup-list";
    for (const b of list) {
        const li = document.createElement("li");
        const info = document.createElement("div");
        info.className = "backup-info";
        const when = document.createElement("b"); when.textContent = backupWhen(b.at);
        const what = document.createElement("span"); what.textContent = `${backupKindLabel(b)} · ${sizeText(b.size)}`;
        info.append(when, what);
        const btns = document.createElement("div");
        btns.className = "backup-buttons";
        btns.append(
            mk("Restore", async () => {
                if (!(await askConfirm(`"${zone.name}" will go back to how it was ${backupWhen(b.at).toLowerCase()}. Your current progress is backed up first, so you can undo this.`, { title: "Restore this backup?", confirmText: "Restore" }))) return;
                try { const full = await getBackup(b.k); await restoreGameSave(gid, full.data); }
                catch (e) { notify("Couldn't restore that backup: " + (e && e.message || e), { type: "error" }); }
            }),
            mk("⬇", () => downloadBackup(b), "settings-button backup-icon"),
            mk("🗑", async () => {
                if (!(await askConfirm("This backup will be deleted.", { title: "Delete backup?", confirmText: "Delete", danger: true }))) return;
                await deleteBackup(b.k); openSaveBackups(zone);
            }, "settings-button backup-icon")
        );
        btns.children[1].title = "Save as a file"; btns.children[1].setAttribute("aria-label", "Save as a file");
        btns.children[2].title = "Delete"; btns.children[2].setAttribute("aria-label", "Delete backup");
        li.append(info, btns);
        ul.appendChild(li);
    }
    body.appendChild(ul);
}

async function downloadBackup(b) {
    const full = b.data ? b : await getBackup(b.k);
    const file = { gnSaveBackup: 1, game: full.game, name: full.name, at: full.at, data: full.data };
    const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const safe = String(full.name || "game").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "game";
    a.download = `${safe} save ${new Date(full.at).toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function restoreBackupFromFile(zone) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        let file;
        try { file = JSON.parse(await f.text()); } catch { file = null; }
        if (!file || file.gnSaveBackup !== 1 || !file.data) { notify("That isn't a GN 2.0 save backup file.", { type: "error" }); return; }
        if (String(file.game) !== String(zone.id)) {
            notify(`That backup is for "${file.name || "another game"}", not "${zone.name}".`, { type: "error" });
            return;
        }
        if (!(await askConfirm(`"${zone.name}" will go back to the save in this file (${backupWhen(file.at).toLowerCase()}). Your current progress is backed up first.`, { title: "Restore from file?", confirmText: "Restore" }))) return;
        try { await restoreGameSave(zone.id, file.data); }
        catch (e) { notify("Couldn't restore that file: " + (e && e.message || e), { type: "error" }); }
    };
    input.click();
}

// ── Mute ────────────────────────────────────────────────────────────────────
// gameMuteHook runs inside every game page (added by cleanGameHtml). Sound
// engines send their sound to the speakers through "destination"; the hook
// sends it through one volume knob per engine instead, and turns that to 0.
// Music and video elements are muted directly.
function gameMuteHook() {
    var muted = false;
    try { muted = !!(window.parent && window.parent !== window && window.parent.__gnmathMuted && window.parent.__gnmathMuted()); } catch (e) {}
    var masters = [], media = [];
    try {
        var AN = window.AudioNode && AudioNode.prototype, ADN = window.AudioDestinationNode, OAC = window.OfflineAudioContext;
        if (AN && ADN && AN.connect) {
            var conn = AN.connect, disc = AN.disconnect;
            var masterFor = function (ctx) {
                if (ctx.__gnMaster) return ctx.__gnMaster;
                var m = ctx.createGain();
                m.__gnMaster = true;
                m.gain.value = muted ? 0 : 1;
                conn.call(m, ctx.destination);
                ctx.__gnMaster = m;
                masters.push(m);
                return m;
            };
            // Recorded sound (an offline engine) isn't played, so it's never redirected
            var live = function (dest) { return dest instanceof ADN && dest.context && !(OAC && dest.context instanceof OAC); };
            AN.connect = function (dest) {
                if (!this.__gnMaster && live(dest)) {
                    var args = Array.prototype.slice.call(arguments);
                    args[0] = masterFor(dest.context);
                    conn.apply(this, args);
                    return dest;
                }
                return conn.apply(this, arguments);
            };
            if (disc) AN.disconnect = function (dest) {
                if (!this.__gnMaster && live(dest) && dest.context.__gnMaster) {
                    var args = Array.prototype.slice.call(arguments);
                    args[0] = dest.context.__gnMaster;
                    try { return disc.apply(this, args); } catch (e) { return; }
                }
                return disc.apply(this, arguments);
            };
        }
    } catch (e) {}
    var muteEl = function (el) {
        if (muted) { if (!el.muted) { el.muted = true; el.__gnMuted = true; } }
        else if (el.__gnMuted) { el.muted = false; el.__gnMuted = false; }
    };
    try {
        var MP = window.HTMLMediaElement && HTMLMediaElement.prototype;
        if (MP && MP.play) {
            var play = MP.play;
            MP.play = function () {
                if (media.indexOf(this) < 0) { media.push(this); if (media.length > 300) media.shift(); }
                if (muted) muteEl(this);
                return play.apply(this, arguments);
            };
        }
    } catch (e) {}
    // Alt+M while playing (the game page has the keyboard, not the site)
    window.addEventListener("keydown", function (e) {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat || e.code !== "KeyM") return;
        try { if (window.parent.__gnmathToggleMute) { e.preventDefault(); e.stopPropagation(); window.parent.__gnmathToggleMute(); } } catch (err) {}
    }, true);
    window.__gnMuteInfo = function () { return { engines: masters.length, media: media.length, muted: muted }; };
    window.__gnSetMuted = function (m) {
        muted = !!m;
        masters.forEach(function (g) { try { g.gain.value = muted ? 0 : 1; } catch (e) {} });
        var els = [];
        try { els = Array.prototype.slice.call(document.querySelectorAll("audio,video")); } catch (e) {}
        els.concat(media).forEach(muteEl);
        // Same-site frames inside the game (some games are a page inside a page)
        try {
            Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
                try {
                    var w = f.contentWindow;
                    if (w.__gnSetMuted) w.__gnSetMuted(muted);
                    else Array.prototype.forEach.call(w.document.querySelectorAll("audio,video"), muteEl);
                } catch (e) {}
            });
        } catch (e) {}
    };
}

let gameMuted = false;
window.__gnmathMuted = () => gameMuted;
function updateMuteButton() {
    const b = document.getElementById("muteButton");
    if (!b) return;
    b.textContent = gameMuted ? "🔇" : "🔊";
    b.classList.toggle("on", gameMuted);
    b.setAttribute("aria-pressed", gameMuted ? "true" : "false");
    b.title = gameMuted ? "Sound is off. Turn it on (Alt+M)" : "Mute the game (Alt+M)";
    b.setAttribute("aria-label", gameMuted ? "Unmute" : "Mute");
}
function applyMuteToGame() {
    try { const w = zoneFrame && zoneFrame.contentWindow; if (w && w.__gnSetMuted) w.__gnSetMuted(gameMuted); } catch (e) {}
}
function toggleGameMute() {
    const zone = currentZone();
    if (zone && typeof isPartnerZone === "function" && isPartnerZone(zone)) {
        notify("Partner games play from another site, so they can't be muted from here. Right-click the tab and choose Mute site instead.");
        return;
    }
    gameMuted = !gameMuted;
    updateMuteButton();
    applyMuteToGame();
}
function handleMuteKey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat || e.code !== "KeyM") return;
    if (zoneViewer.style.display !== "flex") return;
    e.preventDefault();
    e.stopPropagation();
    toggleGameMute();
}
window.addEventListener("keydown", handleMuteKey, true);
window.__gnmathToggleMute = () => { if (zoneViewer.style.display === "flex") toggleGameMute(); };   // from inside the game (gameMuteHook)
document.addEventListener("DOMContentLoaded", updateMuteButton);
updateMuteButton();

// ── Copy link to a game ─────────────────────────────────────────────────────
function gameLink(zone) {
    const u = new URL(location.href);
    u.search = ""; u.hash = "";
    u.searchParams.set("play", zone.id);
    return u.toString();
}
async function copyGameLink(zone = currentZone()) {
    if (!zone) return;
    const link = gameLink(zone);
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {}
    if (!ok) {
        try {
            const ta = document.createElement("textarea");
            ta.value = link; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0;";
            document.body.appendChild(ta); ta.select();
            ok = document.execCommand("copy");
            ta.remove();
        } catch (e) {}
    }
    if (ok) notify(`Copied a link to ${zone.name}. Anyone who opens it goes straight to the game.`, { type: "success" });
    else notify(`Copy this link: ${link}`, { duration: 12000 });
}

// ── Download sizes ──────────────────────────────────────────────────────────
// config/game-sizes.json: { updated, kb: { "<id>": kilobytes } }, filled in by the
// nightly game check as it gets to each game (about a week for all of them).
let GAME_SIZES = {};
const QUICK_KB = 10 * 1024, SHOW_SIZE_KB = 5 * 1024;
fetch("config/game-sizes.json", { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
        if (!d || !d.kb) return;
        GAME_SIZES = d.kb;
        if (Array.isArray(zones) && zones.length) {
            if (typeof updateFilterCounts === "function") updateFilterCounts();
            scheduleFullRefresh();
        }
    })
    .catch(() => {});
// Kilobytes the game downloads, or null if it hasn't been measured yet
function gameSizeKb(zone) {
    if (!zone) return null;
    const kb = GAME_SIZES[String(zone.id)];
    if (typeof kb === "number") return kb;
    const sp = zone.special || [];
    if (sp.includes("js13k")) return 13;      // js13k entries are 13 KB at most
    if (sp.includes("wasm4")) return 64;      // WASM-4 carts are 64 KB at most
    return null;
}
function formatGameSize(kb) {
    if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
    const mb = kb / 1024;
    return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
// Shown on cards for big games only, so the small ones stay uncluttered
function gameSizeCardText(zone) {
    const kb = gameSizeKb(zone);
    return kb !== null && kb >= SHOW_SIZE_KB ? "⬇ " + formatGameSize(kb) : "";
}
function isQuickGame(zone) {
    const kb = gameSizeKb(zone);
    return kb !== null && kb < QUICK_KB;
}
