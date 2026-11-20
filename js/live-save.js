// ═════════════════════════════════════════════════════════════════════════════
// Live Save: while a signed-in player plays, their progress is saved to the
// GN 2.0 Server every 20 seconds (only when something changed), so closing the
// tab or the Chromebook loses at most a few seconds. The server turns the
// newest Live Save into a normal cloud save in Firebase when the player goes
// offline (and every 30 minutes during long sessions). The full cloud save
// still runs every 10 minutes as a safety net (accounts.js), so nothing Live
// Save misses is lost.
//
// Kept light for slow school Chromebooks:
//   • It only does anything when a game (or the site) actually wrote save data:
//     writes to localStorage and IndexedDB are noticed as they happen.
//   • Only the databases that changed are read again; the rest, and big game
//     files that didn't change, are reused from memory (splitMemo in accounts.js).
//   • It waits for an idle moment, and never runs while a game is loading.
//   • If a Live Save makes the page stutter (300 ms of its own long tasks) twice,
//     Live Save turns itself off on that computer for a day and the normal
//     cloud save goes back to every 2 minutes.
// If the GN 2.0 Server can't be reached, Live Save waits and the normal cloud
// save (Firebase) carries on as before.
// ═════════════════════════════════════════════════════════════════════════════
const LIVE_SAVE = {
    everyMs: 20000,
    jankMs: 300,                          // long-task time during one Live Save that counts as "slow"
    slowKey: "gnmath-live-save-slow",     // when this computer was found too slow
    hashKey: "gnmath-live-hash"
};
let liveDirty = { ls: true, dbs: new Set(["*"]) };
const liveDbCache = new Map();            // database name -> what was read last time
const liveState = { hash: "", savedAt: 0, okAt: 0, busy: false, have: new Set(), slowHits: 0, ticks: 0 };

function liveSlowDevice() {
    try { return Date.now() - Number(localStorage.getItem(LIVE_SAVE.slowKey) || 0) < 86400000; } catch { return false; }
}
// Working right now: signed in, the server answering, recent success
function liveSaveActive() {
    return !!(typeof cloudUser !== "undefined" && cloudUser && typeof HOME_SERVER !== "undefined"
        && !liveSlowDevice() && Date.now() >= (typeof homeSavesDownUntil !== "undefined" ? homeSavesDownUntil : 0)
        && liveState.okAt && Date.now() - liveState.okAt < 3 * 60000);
}
// The server made this browser's Live Save the cloud save (player went offline
// or a long session): it's this browser's own progress, so carry on from it
// instead of treating it as "another device saved".
function liveAdopt(meta) {
    try {
        const me = typeof window.gnSessionId === "function" ? window.gnSessionId() : "";
        if (!meta || !meta.liveSid || !me || meta.liveSid !== me || !meta.gen) return false;
        if (localStorage.getItem(CLOUD.keys.syncedGen) === meta.gen) return false;
        localStorage.setItem(CLOUD.keys.syncedGen, meta.gen);
        if (meta.hash) localStorage.setItem(CLOUD.keys.syncedHash, meta.hash);
        return true;
    } catch { return false; }
}

// ── Noticing writes ─────────────────────────────────────────────────────────
function liveWatchWindow(w) {
    try {
        if (!w || w.__gnLiveWatch) return;
        w.__gnLiveWatch = true;
        if (w !== window) liveDirty.dbs.add("*");     // a new game page: read everything once
        const S = w.Storage && w.Storage.prototype;
        if (S) for (const m of ["setItem", "removeItem", "clear"]) {
            const o = S[m];
            if (typeof o !== "function") continue;
            S[m] = function (key) {
                try { if (this === w.localStorage && (m === "clear" || !isCloudExcludedStorageKey(String(key)))) liveDirty.ls = true; } catch {}
                return o.apply(this, arguments);
            };
        }
        const P = w.IDBObjectStore && w.IDBObjectStore.prototype;
        if (P) for (const m of ["put", "add", "delete", "clear"]) {
            const o = P[m];
            if (typeof o !== "function") continue;
            P[m] = function () {
                try { liveDirty.dbs.add(this.transaction.db.name); } catch { liveDirty.dbs.add("*"); }
                return o.apply(this, arguments);
            };
        }
        const F = w.IDBFactory && w.IDBFactory.prototype;
        if (F && typeof F.deleteDatabase === "function") {
            const od = F.deleteDatabase;
            F.deleteDatabase = function (name) { liveDirty.dbs.add(String(name)); return od.apply(this, arguments); };
        }
    } catch {}
}
liveWatchWindow(window);
// Each game runs in its own frame (a new page every time a game opens)
setInterval(() => {
    try { if (typeof zoneFrame !== "undefined" && zoneFrame && zoneFrame.contentWindow) liveWatchWindow(zoneFrame.contentWindow); } catch {}
}, 500);

// ── Saving ──────────────────────────────────────────────────────────────────
const liveIdle = () => new Promise(r => {
    if (document.hidden || !window.requestIdleCallback) return setTimeout(r, 0);
    requestIdleCallback(() => r(), { timeout: 3000 });
});
async function liveCollect(dirty) {
    const bundle = { v: 1, localStorage: {}, cookies: document.cookie, indexedDB: [] };
    for (const key of Object.keys(localStorage).sort()) {
        if (!isCloudExcludedStorageKey(key)) bundle.localStorage[key] = localStorage.getItem(key);
    }
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    const seen = new Set();
    for (const info of dbs) {
        if (!info.name || isCloudExcludedDb(info.name)) continue;
        seen.add(info.name);
        let d = liveDbCache.get(info.name);
        if (!d || dirty.dbs.has("*") || dirty.dbs.has(info.name) || d.version !== info.version) {
            try { d = await readIndexedDb(info.name, info.version); liveDbCache.set(info.name, d); }
            catch { continue; }
            await liveIdle();
        }
        bundle.indexedDB.push(d);
    }
    for (const name of [...liveDbCache.keys()]) if (!seen.has(name)) liveDbCache.delete(name);
    bundle.indexedDB.sort((a, b) => a.name < b.name ? -1 : 1);
    return bundle;
}
async function liveSaveNow(reason) {
    if (typeof cloudUser === "undefined" || !cloudUser || liveState.busy || cloudBusy || liveSlowDevice()) return false;
    if (typeof HOME_SERVER === "undefined" || Date.now() < homeSavesDownUntil) return false;
    if (typeof gameLoad !== "undefined" && gameLoad.phase !== "idle" && reason !== "hidden") return false;   // a game is loading
    // Every third time, ask the open game to write what it keeps in memory (Unity)
    if (reason !== "hidden" && ++liveState.ticks % 3 === 0 && typeof syncOpenGameFiles === "function") {
        try { await syncOpenGameFiles(1000); } catch {}
    }
    if (!liveDirty.ls && !liveDirty.dbs.size) { liveState.okAt = Date.now(); return true; }
    liveState.busy = true;
    const dirty = liveDirty;
    liveDirty = { ls: false, dbs: new Set() };
    let jank = 0, obs = null;
    try {
        if (reason !== "hidden") await liveIdle();
        try {
            // Only the site's own long tasks count, not the game's (it runs in a frame)
            obs = new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.name === "self") jank += e.duration; });
            obs.observe({ type: "longtask", buffered: false });
        } catch { obs = null; }
        const started = performance.now();
        const bundle = await liveCollect(dirty);
        const { packed, blobs, total } = await prepareCloudSave(bundle);
        if (packed.length > CLOUD.maxChars) return false;
        const hash = (await sha256Hex(packed)).slice(0, 40);
        if (obs) obs.disconnect();
        const slow = obs ? jank > LIVE_SAVE.jankMs : performance.now() - started > 2500;
        if (slow && ++liveState.slowHits >= 2) {
            try { localStorage.setItem(LIVE_SAVE.slowKey, String(Date.now())); } catch {}
            setCloudStatus("Live Save is off on this computer (saving made it stutter), so it cloud saves every 2 minutes instead.");
            return false;
        }
        if (!slow) liveState.slowHits = 0;
        if (hash === liveState.hash) { liveState.okAt = Date.now(); return true; }
        // New game data goes to the server once (it's stored by its contents)
        for (const b of blobs) {
            if (liveState.have.has(b.id)) continue;
            const p = blobPackCache.get(b.id);
            if (!p) throw new Error("game data changed");
            for (let j = 0; j < b.n; j++) {
                const res = await homeSaveFetch("blobs/" + encodeURIComponent(`${b.id}_${j}`), { method: "PUT", body: p.slice(j * CLOUD.chunkChars, (j + 1) * CLOUD.chunkChars), headers: { "Content-Type": "text/plain" } });
                if (!res.ok) throw new Error("server said " + res.status);
            }
            liveState.have.add(b.id);
        }
        const body = JSON.stringify({ main: packed, blobs: blobs.map(b => ({ id: b.id, n: b.n })), hash, sum: progressSummary(), size: total,
            sid: typeof window.gnSessionId === "function" ? window.gnSessionId() : "", at: Date.now() });
        const res = await homeSaveFetch("live", { method: "PUT", body, headers: { "Content-Type": "text/plain" } });
        if (!res.ok) throw new Error("server said " + res.status);
        liveState.hash = hash;
        liveState.savedAt = liveState.okAt = Date.now();
        try { localStorage.setItem(LIVE_SAVE.hashKey, hash); } catch {}
        setCloudStatus("Live Save — saved " + new Date().toLocaleTimeString());
        if (typeof renderSaveChip === "function") renderSaveChip();
        return true;
    } catch (e) {
        // Try again next time, reading everything
        liveDirty.ls = true; liveDirty.dbs.add("*");
        console.info("Live Save didn't go through:", e.message || e);
        return false;
    } finally {
        if (obs) try { obs.disconnect(); } catch {}
        liveState.busy = false;
    }
}
setInterval(() => { if (!document.hidden) liveSaveNow("tick"); }, LIVE_SAVE.everyMs);
// Keep the game bar's "Live saved 12s ago" ticking
setInterval(() => { if (!document.hidden && typeof renderSaveChip === "function" && liveSaveActive()) renderSaveChip(); }, 5000);
// Signing in: what the server already has doesn't need sending again
window.addEventListener("load", () => setTimeout(() => {
    try { liveState.hash = localStorage.getItem(LIVE_SAVE.hashKey) || ""; } catch {}
}, 0));
