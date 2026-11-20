// ═════════════════════════════════════════════════════════════════════════════
// Accounts + cloud game saves (Firebase)
//
// SETUP: paste your Firebase web config below (Firebase console → Project
// settings → Your apps → Web app → "firebaseConfig"). This config is meant to
// be public; security comes from the Firestore rules, not from hiding it.
// While it is null, accounts are switched off and the Account button is hidden.
// ═════════════════════════════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCVUtHKcMZCs7aaCcO_Gp8fmy41MZnjqcs",
    authDomain: "gn-math-dfd85.firebaseapp.com",
    projectId: "gn-math-dfd85",
    storageBucket: "gn-math-dfd85.firebasestorage.app",
    messagingSenderId: "368830661410",
    appId: "1:368830661410:web:8bc99077ea4a0502349b7b"
};
/* Example:
const FIREBASE_CONFIG = {
    apiKey: "...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "...",
    appId: "..."
};
*/

const CLOUD = {
    sdkVersion: "10.12.2",
    usernameDomain: "gnmath.local",          // usernames become fake emails: name@gnmath.local
    autosaveMs: 2 * 60 * 1000,               // autosave every 2 minutes while signed in
    chunkChars: 500000,                      // Firestore docs max out at ~1 MB; smaller parts get through slow connections
    blobMin: 64 * 1024,                      // game data entries bigger than this are stored once, by content (see splitBlobs)
    maxChars: 18000000,                      // ~18 MB compressed cap per save
    fbCopyMs: 30 * 60 * 1000,                // saves are copied to Firebase at most every 30 minutes (see savePart)
    keys: {
        syncedGen: "gnmath-cloud-synced-gen",
        syncedHash: "gnmath-cloud-synced-hash",
        pendingUndo: "gnmath-cloud-pending-undo"
    }
};
let cloudAuth = null, cloudDb = null, cloudUser = null;
let cloudBusy = false, cloudStatus = "", cloudAutosaveTimer = null;

// ── What goes into a save ────────────────────────────────────────────────────
function isCloudExcludedStorageKey(key) {
    return isProtectedStorageKey(key) || key.startsWith("gnmath-cloud-") || key.startsWith("gnmath-cache-") || key.startsWith("firebase:");
}
function isCloudExcludedDb(name) {
    // Firebase's own login/cache databases, Unity's download cache (game files, not progress),
    // and the site's own save backups (game-extras.js), which would only make cloud saves bigger
    // Also emulators' downloaded cores, ROMs and BIOS files (EmulatorJS keeps saves in its own "states" database, which stays)
    return /^firebase|^firestore\//i.test(name) || name === "UnityCache" || name === "gnmath-backups" || /^EmulatorJS-(core|cores|roms|bios)$/i.test(name);
}
// A save bigger than the cloud can hold used to not save at all. Now the
// biggest pieces of game data are left out (they stay on this device) until
// the rest fits: single entries, biggest first, so a game's huge downloaded
// files go before anyone's small save files (Unity games all share one
// "/idbfs" database, so leaving out whole databases would lose every Unity save).
async function packCloudBundle(bundle) {
    let json = JSON.stringify(bundle), packed = await gzipToB64(json);
    if (packed.length <= CLOUD.maxChars) return { packed, left: [] };
    const ratio = packed.length / json.length;
    const all = [];
    bundle.indexedDB.forEach((db, di) => db.stores.forEach((st, si) => st.entries.forEach((e, ei) => all.push({ di, si, ei, n: JSON.stringify(e).length }))));
    all.sort((a, b) => b.n - a.n);
    const drop = new Set(), key = x => `${x.di}/${x.si}/${x.ei}`;
    let raw = json.length, k = 0;
    for (let tries = 0; tries < 6 && packed.length > CLOUD.maxChars && k < all.length; tries++) {
        do { raw -= all[k].n; drop.add(key(all[k])); k++; } while (k < all.length && raw * ratio > CLOUD.maxChars * 0.85);
        const slim = { ...bundle, indexedDB: bundle.indexedDB.map((db, di) => ({ ...db, stores: db.stores.map((st, si) => ({ ...st, entries: st.entries.filter((e, ei) => !drop.has(`${di}/${si}/${ei}`)) })) })) };
        json = JSON.stringify(slim);
        packed = await gzipToB64(json);
    }
    // What was left out, by database
    const by = new Map();
    for (const x of all.slice(0, k)) {
        const name = bundle.indexedDB[x.di].name, cur = by.get(name) || { name, files: 0, bytes: 0 };
        cur.files++; cur.bytes += x.n * ratio; by.set(name, cur);
    }
    const left = [...by.values()].map(b => ({ name: b.name, files: b.files, mb: Math.max(0.1, Math.round(b.bytes / 1e5) / 10) }));
    return { packed, left };
}

// ── Big game data, stored once ──────────────────────────────────────────────
// A save used to be one big package, sent again whole every time anything
// changed: a Cookie Clicker autosave re-sent 12 MB of other games' downloaded
// files every 2 minutes, which stalled on slow connections. Now every game
// data entry bigger than blobMin is stored on its own, named by its contents
// (saves/<uid>/blobs/<id>_<part>), and the package only points at it
// ({ __ref: id, n: parts }). An entry that's already in the cloud is never
// sent again, and a save that's cut off carries on where it stopped next time,
// since the parts it already sent are remembered (blobsDone).
// Packages with pointers are v: 2, so an older copy of the site refuses them
// instead of writing pointers into a game's files.
const blobPackCache = new Map();   // id -> packed text, while it waits to be sent
function blobsDoneKey() { return "gnmath-cloud-blobs-" + (cloudUser ? cloudUser.uid : ""); }
function blobsDone() { try { return new Set(JSON.parse(localStorage.getItem(blobsDoneKey()) || "[]")); } catch { return new Set(); } }
function markBlobPartDone(name) {
    try {
        const list = [...blobsDone()].filter(x => x !== name);
        list.push(name);
        localStorage.setItem(blobsDoneKey(), JSON.stringify(list.slice(-3000)));
    } catch {}
}
function blobsOf(save) { return Array.isArray(save && save.blobs) ? save.blobs.filter(b => b && b.id) : []; }
// Live Save (live-save.js) reuses unchanged databases between saves, so the
// same entry objects come back: remember what each one was split into, so a
// big entry isn't turned into text and fingerprinted again every time.
const splitMemo = new WeakMap();
async function splitBlobs(bundle) {
    const blobs = new Map();
    const indexedDB = [];
    for (const db of bundle.indexedDB || []) {
        const stores = [];
        for (const st of db.stores) {
            const entries = [];
            for (const e of st.entries) {
                const memo = e && typeof e === "object" ? splitMemo.get(e) : null;
                if (memo && memo.small) { entries.push(e); continue; }
                if (memo && blobPackCache.has(memo.id)) {
                    if (!blobs.has(memo.id)) blobs.set(memo.id, { id: memo.id, n: memo.n, size: memo.size, db: db.name });
                    entries.push({ __ref: memo.id, n: memo.n });
                    continue;
                }
                const j = JSON.stringify(e);
                if (j.length < CLOUD.blobMin) { if (e && typeof e === "object") splitMemo.set(e, { small: true }); entries.push(e); continue; }
                const id = (await sha256Hex(j)).slice(0, 32);
                let b = blobs.get(id);
                if (!b) {
                    let packed = blobPackCache.get(id);
                    if (!packed) { packed = await gzipToB64(j); blobPackCache.set(id, packed); }
                    b = { id, n: Math.max(1, Math.ceil(packed.length / CLOUD.chunkChars)), size: packed.length, db: db.name };
                    blobs.set(id, b);
                }
                if (e && typeof e === "object") splitMemo.set(e, { id: b.id, n: b.n, size: b.size });
                entries.push({ __ref: b.id, n: b.n });
            }
            stores.push({ ...st, entries });
        }
        indexedDB.push({ ...db, stores });
    }
    return { main: { ...bundle, v: 2, indexedDB }, blobs: [...blobs.values()] };
}
// Splits off the big entries and leaves out the biggest if the whole save is
// over the cloud's limit (they stay on this device)
async function prepareCloudSave(bundle) {
    const { main, blobs } = await splitBlobs(bundle);
    const { packed, left } = await packCloudBundle(main);
    let total = packed.length + blobs.reduce((n, b) => n + b.size, 0);
    const out = new Set(), by = new Map();
    for (const b of blobs.slice().sort((x, y) => y.size - x.size)) {
        if (total <= CLOUD.maxChars) break;
        out.add(b.id); total -= b.size;
        const cur = by.get(b.db) || { name: b.db, files: 0, bytes: 0 };
        cur.files++; cur.bytes += b.size; by.set(b.db, cur);
    }
    if (!out.size) return { packed, left, blobs, total };
    // Pack again without the left-out pointers
    main.indexedDB.forEach(db => db.stores.forEach(st => { st.entries = st.entries.filter(e => !(e && e.__ref && out.has(e.__ref))); }));
    const again = await packCloudBundle(main);
    const more = [...by.values()].map(b => ({ name: b.name, files: b.files, mb: Math.max(0.1, Math.round(b.bytes / 1e5) / 10) }));
    return { packed: again.packed, left: [...again.left, ...more], blobs: blobs.filter(b => !out.has(b.id)), total };
}
// Sends the big entries the cloud doesn't have yet. have: ids already in a
// save there. onPart(done, todo) for the progress bar.
// fbHave: when copying to Firebase this time, the ids Firebase already has.
// Returns { sent, fbOk } (fbOk: every part is in Firebase too).
async function uploadBlobs(blobs, have, onPart, fbHave = null) {
    const done = blobsDone();
    const parts = [], check = [];
    for (const b of blobs) {
        if (have.has(b.id)) continue;
        for (let j = 0; j < b.n; j++) (done.has(`${b.id}_${j}`) ? check : parts).push([b, j]);
    }
    // Parts sent before (a save that was cut off) but not in any save yet:
    // make sure they're still there, since another device may have cleaned them up
    for (let i = 0; i < check.length; i += 20) {
        const snaps = await cloudStep(Promise.all(check.slice(i, i + 20).map(([b, j]) => savePart("blobs", `${b.id}_${j}`).exists())), 60000, "Checking game data");
        snaps.forEach((snap, k) => { if (!snap.exists) parts.push(check[i + k]); });
    }
    // Copying to Firebase: parts the server already has but Firebase doesn't
    const toSend = new Set(parts.map(([b, j]) => `${b.id}_${j}`));
    const fbOnly = [];
    if (fbHave) for (const b of blobs) {
        if (fbHave.has(b.id)) continue;
        for (let j = 0; j < b.n; j++) if (!toSend.has(`${b.id}_${j}`)) fbOnly.push([b, j]);
    }
    let fbOk = true;
    const total = parts.length + fbOnly.length;
    for (let i = 0; i < fbOnly.length; i++) {
        const [b, j] = fbOnly[i];
        if (onPart) onPart(parts.length + i, total);
        const packed = blobPackCache.get(b.id);
        if (!packed) { fbOk = false; continue; }
        if (!(await cloudStep(savePart("blobs", `${b.id}_${j}`).setFb({ d: packed.slice(j * CLOUD.chunkChars, (j + 1) * CLOUD.chunkChars) }), 60000, `Backing up game data (part ${i + 1} of ${fbOnly.length})`))) fbOk = false;
    }
    for (let i = 0; i < parts.length; i++) {
        const [b, j] = parts[i];
        if (onPart) onPart(i, total);
        let packed = blobPackCache.get(b.id);
        if (!packed) throw new Error("game data changed while saving, try again");
        const name = `${b.id}_${j}`;
        const inFb = await cloudStep(savePart("blobs", name).set({ d: packed.slice(j * CLOUD.chunkChars, (j + 1) * CLOUD.chunkChars) }, { fb: !!fbHave }), 60000, `Uploading game data (part ${i + 1} of ${parts.length})`);
        if (!inFb) fbOk = false;
        markBlobPartDone(name);
    }
    return { sent: total, fbOk };
}
// Big entries no save points at anymore
function dropBlobs(dropped, keep) {
    const keepIds = new Set(keep.flatMap(s => blobsOf(s).map(b => b.id)));
    const gone = new Set();
    for (const b of dropped.flatMap(blobsOf)) {
        if (keepIds.has(b.id) || gone.has(b.id)) continue;
        gone.add(b.id);
        for (let j = 0; j < (b.n || 1); j++) savePart("blobs", `${b.id}_${j}`).delete().catch(() => {});
    }
    if (gone.size) {
        try { localStorage.setItem(blobsDoneKey(), JSON.stringify([...blobsDone()].filter(x => !gone.has(x.replace(/_\d+$/, ""))))); } catch {}
    }
}
// Puts the big entries back into a downloaded v2 package
async function joinBlobs(bundle) {
    if (!bundle || bundle.v !== 2) return bundle;
    const want = new Map();
    for (const db of bundle.indexedDB || []) for (const st of db.stores) for (const e of st.entries) if (e && e.__ref) want.set(e.__ref, e.n || 1);
    const got = new Map();
    const ids = [...want.keys()];
    for (let i = 0; i < ids.length; i += 4) {
        await Promise.all(ids.slice(i, i + 4).map(async id => {
            const n = want.get(id);
            const parts = await cloudStep(Promise.all(Array.from({ length: n }, (_, j) => savePart("blobs", `${id}_${j}`).get())), 90000, "Downloading game data");
            if (parts.some(p => !p.exists)) throw new Error("cloud save is missing some game data, try again" + homeSavesNote());
            const packed = parts.map(p => p.data().d).join("");
            got.set(id, JSON.parse(await b64ToText(packed)));
            blobPackCache.set(id, packed);
        }));
    }
    const done = blobsDone();
    for (const [id, n] of want) for (let j = 0; j < n; j++) done.add(`${id}_${j}`);
    try { localStorage.setItem(blobsDoneKey(), JSON.stringify([...done].slice(-3000))); } catch {}
    return {
        ...bundle, v: 1,
        indexedDB: bundle.indexedDB.map(db => ({ ...db, stores: db.stores.map(st => ({ ...st, entries: st.entries.map(e => e && e.__ref ? got.get(e.__ref) : e) })) }))
    };
}

// ── Value encoding (IndexedDB can hold binary data that JSON can't) ──────────
function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function encodeValue(v, pendingBlobs) {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof ArrayBuffer) return { __t: "ab", d: bytesToB64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) {
        return { __t: "ta", c: v.constructor.name, d: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (v instanceof Date) return { __t: "date", d: v.toISOString() };
    if (v instanceof Blob) {
        const ph = { __t: "blob", type: v.type, d: "" };
        pendingBlobs.push({ ph, blob: v });
        return ph;
    }
    if (v instanceof Map) return { __t: "map", d: [...v].map(([k, x]) => [encodeValue(k, pendingBlobs), encodeValue(x, pendingBlobs)]) };
    if (v instanceof Set) return { __t: "set", d: [...v].map(x => encodeValue(x, pendingBlobs)) };
    if (Array.isArray(v)) return v.map(x => encodeValue(x, pendingBlobs));
    const o = {};
    for (const k of Object.keys(v)) o[k] = encodeValue(v[k], pendingBlobs);
    return Object.prototype.hasOwnProperty.call(v, "__t") ? { __t: "obj", d: o } : o;
}
function decodeValue(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(decodeValue);
    switch (v.__t) {
        case "ab":   return b64ToBytes(v.d).buffer;
        case "ta": {
            const bytes = b64ToBytes(v.d);
            const Ctor = globalThis[v.c];
            if (typeof Ctor !== "function" || !Ctor.BYTES_PER_ELEMENT) return bytes;
            if (Ctor === DataView) return new DataView(bytes.buffer);
            return new Ctor(bytes.buffer, 0, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
        }
        case "date": return new Date(v.d);
        case "blob": return new Blob([b64ToBytes(v.d)], { type: v.type });
        case "map":  return new Map(v.d.map(([k, x]) => [decodeValue(k), decodeValue(x)]));
        case "set":  return new Set(v.d.map(decodeValue));
        case "obj":  { const o = {}; for (const k of Object.keys(v.d)) o[k] = decodeValue(v.d[k]); return o; }
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = decodeValue(v[k]);
    return o;
}

// ── Collect / restore everything the games stored ───────────────────────────
function idbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function readIndexedDb(name, version) {
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error("db vanished")); };
    });
    try {
        const pendingBlobs = [];
        const out = { name, version: db.version, stores: [] };
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length) {
            const tx = db.transaction(storeNames, "readonly");
            await Promise.all(storeNames.map(storeName => new Promise((resolve, reject) => {
                const store = tx.objectStore(storeName);
                const info = {
                    name: storeName,
                    keyPath: store.keyPath,
                    autoIncrement: store.autoIncrement,
                    indexes: Array.from(store.indexNames).map(n => {
                        const idx = store.index(n);
                        return { name: n, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry };
                    }),
                    entries: []
                };
                out.stores.push(info);
                const cur = store.openCursor();
                cur.onsuccess = () => {
                    const c = cur.result;
                    if (!c) return resolve();
                    info.entries.push([encodeValue(c.primaryKey, pendingBlobs), encodeValue(c.value, pendingBlobs)]);
                    c.continue();
                };
                cur.onerror = () => reject(cur.error);
            })));
        }
        for (const { ph, blob } of pendingBlobs) ph.d = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
        return out;
    } finally {
        db.close();
    }
}
async function collectCloudBundle() {
    const bundle = { v: 1, localStorage: {}, cookies: document.cookie, indexedDB: [] };
    for (const key of Object.keys(localStorage).sort()) {
        if (!isCloudExcludedStorageKey(key)) bundle.localStorage[key] = localStorage.getItem(key);
    }
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    for (const info of dbs) {
        if (!info.name || isCloudExcludedDb(info.name)) continue;
        try { bundle.indexedDB.push(await readIndexedDb(info.name, info.version)); }
        catch (e) { console.warn("Cloud save: skipped database", info.name, e); }
    }
    bundle.indexedDB.sort((a, b) => a.name < b.name ? -1 : 1);
    return bundle;
}
async function writeIndexedDb(dbData) {
    await new Promise(resolve => {
        const del = indexedDB.deleteDatabase(dbData.name);
        del.onsuccess = del.onerror = del.onblocked = () => resolve();
    });
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbData.name, dbData.version || 1);
        req.onupgradeneeded = () => {
            const udb = req.result;
            for (const s of dbData.stores) {
                const opts = { autoIncrement: !!s.autoIncrement };
                if (s.keyPath !== null && s.keyPath !== undefined) opts.keyPath = s.keyPath;
                const store = udb.createObjectStore(s.name, opts);
                for (const ix of s.indexes || []) {
                    store.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    try {
        if (!dbData.stores.length) return;
        const tx = db.transaction(dbData.stores.map(s => s.name), "readwrite");
        for (const s of dbData.stores) {
            const store = tx.objectStore(s.name);
            const inline = s.keyPath !== null && s.keyPath !== undefined;
            for (const [k, v] of s.entries) {
                if (inline) store.put(decodeValue(v));
                else store.put(decodeValue(v), decodeValue(k));
            }
        }
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}
async function applyCloudBundle(bundle) {
    if (!bundle || bundle.v !== 1) throw new Error("Unknown save format");
    for (const key of Object.keys(bundle.localStorage || {})) {
        if (!isCloudExcludedStorageKey(key)) localStorage.setItem(key, bundle.localStorage[key]);
    }
    (bundle.cookies || "").split(";").map(c => c.trim()).filter(Boolean)
        .forEach(c => { document.cookie = c + "; path=/; max-age=31536000"; });
    for (const dbData of bundle.indexedDB || []) {
        if (isCloudExcludedDb(dbData.name)) continue;
        try { await writeIndexedDb(dbData); }
        catch (e) { console.warn("Cloud load: couldn't restore database", dbData.name, e); }
    }
}

// ── Compression + hashing ───────────────────────────────────────────────────
async function gzipToB64(text) {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === "undefined") return "r" + bytesToB64(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return "g" + bytesToB64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function b64ToText(packed) {
    const bytes = b64ToBytes(packed.slice(1));
    if (packed[0] === "r") return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
}
async function sha256Hex(text) {
    if (!(window.crypto && crypto.subtle)) {
        // Non-HTTPS pages have no crypto.subtle; a simple 53-bit hash is enough to spot changes.
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return "f" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + "_" + text.length;
    }
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Counts this browser's Firestore reads and writes toward the site's daily
// Firebase limit (firebase-pace.js). Reads count one per document returned
// (at least one per query), writes one per set/update/delete/add.
function countFirestoreUse() {
    const fs = firebase.firestore;
    if (typeof fbCount !== "function" || !fs) return;
    const wrap = (proto, name, cost) => {
        const orig = proto && proto[name];
        if (typeof orig !== "function" || orig.gnCounted) return;
        const counted = function () {
            const out = orig.apply(this, arguments);
            if (out && typeof out.then === "function") {
                out.then(res => { const [r, w] = cost(res); fbCount(r, w); noteFbOk(); }, e => noteFbError(e));
            }
            return out;
        };
        counted.gnCounted = true;
        proto[name] = counted;
    };
    wrap(fs.DocumentReference && fs.DocumentReference.prototype, "get", () => [1, 0]);
    for (const m of ["set", "update", "delete"]) wrap(fs.DocumentReference && fs.DocumentReference.prototype, m, () => [0, 1]);
    wrap(fs.Query && fs.Query.prototype, "get", snap => [Math.max(1, (snap && snap.size) || 0), 0]);
    wrap(fs.CollectionReference && fs.CollectionReference.prototype, "add", () => [0, 1]);
}

// ── Firestore: saves/{uid} holds meta, saves/{uid}/chunks/{gen}_{i} hold data ─
// When a save replaces the cloud save (from another device, "Keep this device's"
// or Save now), the replaced one is kept for a week (meta.kept), so it can be
// brought back from Account → Earlier cloud saves. Autosaves from the same
// device just update the cloud save and aren't kept.
// sum is a small summary (level, play time) to compare saves without loading them.

// Level and total play time on this device
function progressSummary() {
    let level = 0, playSec = 0;
    try { if (typeof achSummary === "function") level = achSummary().level || 0; } catch {}
    try { if (typeof getPlaytimeMap === "function") playSec = Object.values(getPlaytimeMap()).reduce((n, v) => n + (Number(v) || 0), 0); } catch {}
    try { if (typeof achBonus === "function") playSec += achBonus().sec; } catch {}
    return { level, playSec: Math.round(playSec) };
}
function describeProgress(sum) {
    if (!sum) return "unknown progress";
    const h = sum.playSec / 3600;
    const time = sum.playSec < 60 ? "no play time" : h >= 1 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} h played` : `${Math.round(sum.playSec / 60)} min played`;
    return `level ${sum.level || 1}, ${time}`;
}
// True when a would clearly lose progress compared with b
const KEEP_REPLACED_MS = 7 * 86400000, KEEP_REPLACED_MAX = 6;
// Saves kept from earlier replaces (older sites stored one as meta.prev)
function keptSaves(meta) {
    const list = Array.isArray(meta && meta.kept) ? meta.kept.slice() : [];
    const p = meta && meta.prev;
    if (p && p.gen && !list.some(k => k.gen === p.gen)) list.push({ gen: p.gen, chunkCount: p.chunkCount || 0, sum: p.sum || null, at: p.at && p.at.toMillis ? p.at.toMillis() : Date.now(), until: Date.now() + KEEP_REPLACED_MS });
    return list.filter(k => k && k.gen).sort((a, b) => (b.at || 0) - (a.at || 0));
}
function progressIsLess(a, b) {
    if (!a || !b) return false;
    return (a.level || 0) < (b.level || 0) || (a.playSec || 0) + 600 < (b.playSec || 0) * 0.8;
}
function saveDocRef() { return cloudDb.collection("saves").doc(cloudUser.uid); }
// ── Where save data lives ───────────────────────────────────────────────────
// The record of which save is newest (saves/{uid}) is in Firebase. The save
// data itself (the chunks and blobs parts, up to ~18 MB per player) goes to the
// GN 2.0 Server (js/home-server.js, which checks the player's Firebase sign-in).
// Every 30 minutes a save is also copied to Firebase, and the record notes
// that copy (fbCopy). So:
//   - server down: saves go to Firebase instead, and a save that's only on the
//     server loads from the Firebase copy (at most ~30 minutes older)
//   - Firebase down or out of its daily limit: the server still has every save
// Reading tries the server first (that keeps Firebase's usage low), then Firebase.
const HOME_SAVES_RETRY_MS = 5 * 60 * 1000;
const HOME_SLOW_MS = 8000;   // a save part taking longer than this from the server: ask Firebase too
let homeSavesDownUntil = 0;
let homeSaveRefused = "";   // why the server last turned a save piece down (save details)
function homeSavesDown(why) { homeSavesDownUntil = Date.now() + HOME_SAVES_RETRY_MS; if (why) homeSaveRefused = why; }
async function homeSaveFetch(path, opts = {}) {
    if (typeof HOME_SERVER === "undefined" || !cloudUser || Date.now() < homeSavesDownUntil) throw new Error("home server not in use");
    const token = await cloudUser.getIdToken();
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 45000);
    try {
        const res = await fetch(`${HOME_SERVER}/api/saves/${encodeURIComponent(cloudUser.uid)}/${path}`, {
            ...opts, cache: "no-store", signal: ctrl.signal, headers: { ...(opts.headers || {}), Authorization: "Bearer " + token }
        });
        if (res.status >= 500) { homeSavesDown(`the server had an error (${res.status})`); throw new Error("home server error " + res.status); }
        return res;
    } catch (e) {
        if (e.name === "AbortError" || e instanceof TypeError) homeSavesDown(e.name === "AbortError" ? "it took over 45 seconds to answer" : "the connection failed");
        throw e;
    } finally { clearTimeout(t); }
}
// Same shape as a Firestore doc (get/set/delete), so the save code didn't change
function savePart(kind, name) {
    const fb = () => saveDocRef().collection(kind).doc(name);
    const path = kind + "/" + encodeURIComponent(name);
    return {
        // Server first. If it hasn't answered within HOME_SLOW_MS, Firebase is
        // asked too and whichever has the part first wins; if the server says
        // no or is down, Firebase answers.
        async get() {
            const server = (async () => {
                const res = await homeSaveFetch(path);
                if (!res.ok) throw new Error("not on the server");
                const d = await res.text();
                return { exists: true, data: () => ({ d }) };
            })();
            const first = await Promise.race([
                server.then(v => ({ v }), e => ({ e })),
                new Promise(r => setTimeout(() => r({ slow: true }), HOME_SLOW_MS))
            ]);
            if (first.v) return first.v;
            const fromFb = fb().get();
            if (first.e) return fromFb;
            try { return await Promise.any([server, fromFb.then(snap => snap.exists ? snap : Promise.reject(new Error("not in Firebase")))]); }
            catch { return fromFb; }
        },
        // Only whether it's there (no download), for parts sent by a save that was cut off
        async exists() {
            try { if ((await homeSaveFetch(path, { method: "HEAD" })).ok) return { exists: true }; } catch {}
            return fb().get();
        },
        // Resolves true if Firebase has it too. fb: also copy it to Firebase now.
        async set(v, { fb: copy = false } = {}) {
            let serverOk = false;
            try {
                const res = await homeSaveFetch(path, { method: "PUT", body: v.d, headers: { "Content-Type": "text/plain" } });
                serverOk = res.ok;
                // Not signed in there / not set up: stop trying for a while.
                // Anything else (e.g. full): just this piece goes to Firebase.
                if (!res.ok) { homeSaveRefused = `the server said ${res.status}`; if ([401, 403, 404, 405].includes(res.status)) homeSavesDown(); }
            } catch {}
            if (!serverOk) { await fb().set(v); return true; }   // then Firebase has to work
            if (!copy) return false;
            // The server has it: give Firebase up to 30 s, but a Firebase problem
            // (e.g. its daily limit) doesn't fail the save
            return Promise.race([
                fb().set(v).then(() => true, e => { console.warn("Save part not copied to Firebase", e); return false; }),
                new Promise(r => setTimeout(() => r(false), 30000))
            ]);
        },
        // Firebase only: copying a part the server already has
        setFb(v) { return fb().set(v).then(() => true, () => false); },
        delete() {
            return Promise.allSettled([homeSaveFetch(path, { method: "DELETE" }), fb().delete()]);
        }
    };
}
function homeSavesNote() { return Date.now() < homeSavesDownUntil ? " (the GN 2.0 Server may be down right now)" : ""; }
async function fetchCloudMeta() {
    const snap = await saveDocRef().get();
    return snap.exists ? snap.data() : null;
}
// ── Making autosave dependable ───────────────────────────────────────────────
// • A save asked for while another is running isn't dropped: it runs right
//   after (closing a game during an autosave used to skip that save).
// • A save that fails (Wi-Fi drops, Firebase hiccups) is tried again after
//   20 s, then 40 s, 80 s… (5 min at most), and as soon as the internet is back.
// • Autosave asks the open game to write what it keeps in memory first (Unity).
// • Saves when the tab is hidden too (switching tabs, closing the Chromebook).
let cloudQueue = null, cloudRetryTimer = null, cloudRetryDelay = 0, cloudFailRetryable = false;
let cloudConflictWarned = "";
let cloudConflictNoted = "";
function uploadCloudSave(opts = {}) {
    if (!cloudUser) return Promise.resolve(false);
    if (cloudBusy) {
        if (!cloudQueue) {
            let resolve;
            const promise = new Promise(r => { resolve = r; });
            cloudQueue = { opts: { ...opts }, promise, resolve };
        } else {
            cloudQueue.opts.force = !!(cloudQueue.opts.force || opts.force);
            cloudQueue.opts.background = !!(cloudQueue.opts.background && opts.background);
        }
        return cloudQueue.promise;
    }
    return runCloudUpload(opts);
}
async function runCloudUpload(opts) {
    let ok = false;
    try { ok = await uploadCloudSaveNow(opts); }
    finally {
        const q = cloudQueue;
        cloudQueue = null;
        if (q) runCloudUpload(q.opts).then(q.resolve, () => q.resolve(false));
    }
    clearTimeout(cloudRetryTimer); cloudRetryTimer = null;
    if (ok) cloudRetryDelay = 0;
    else if (cloudFailRetryable && cloudUser) {
        cloudRetryDelay = Math.min(cloudRetryDelay ? cloudRetryDelay * 2 : 20000, 5 * 60000);
        cloudRetryTimer = setTimeout(() => { cloudRetryTimer = null; cloudSaveState.retryAt = 0; uploadCloudSave({ background: true }); }, cloudRetryDelay);
        cloudSaveState.retryAt = Date.now() + cloudRetryDelay;
    }
    return ok;
}
async function cloudAutosaveTick() {
    if (!cloudUser) return;
    // Live Save is working: it saves to the GN 2.0 Server as you play, so the
    // full cloud save only needs to run every 10 minutes (and it catches
    // anything Live Save missed)
    if (typeof liveSaveActive === "function" && liveSaveActive() && Date.now() - (window.gnFullSaveAt || 0) < 10 * 60000) {
        liveSaveNow(document.hidden ? "hidden" : "autosave");
        return true;
    }
    try { if (typeof syncOpenGameFiles === "function") await syncOpenGameFiles(); } catch {}
    const ok = await uploadCloudSave({ background: true });
    if (ok) window.gnFullSaveAt = Date.now();
    return ok;
}
function startCloudAutosave() {
    clearInterval(cloudAutosaveTimer);
    cloudSaveState.nextAt = Date.now() + CLOUD.autosaveMs;
    cloudAutosaveTimer = setInterval(() => { cloudSaveState.nextAt = Date.now() + CLOUD.autosaveMs; if (!document.hidden) cloudAutosaveTick(); }, CLOUD.autosaveMs);
}
let cloudHiddenSaveAt = 0;
document.addEventListener("visibilitychange", () => {
    if (!document.hidden || !cloudUser || !cloudAutosaveTimer) return;
    if (Date.now() - cloudHiddenSaveAt < 20000) return;
    cloudHiddenSaveAt = Date.now();
    cloudAutosaveTick();
});
window.addEventListener("online", () => {
    if (cloudUser && cloudAutosaveTimer && (cloudRetryTimer || cloudFailRetryable)) {
        clearTimeout(cloudRetryTimer); cloudRetryTimer = null;
        setTimeout(() => uploadCloudSave({ background: true }), 3000);
    }
});
// Firebase waits forever for a reply when the connection drops (school Wi-Fi),
// which left "Saving…" stuck. Each step gives up after a while instead, and the
// save is tried again like any other failure.
// What went wrong, in words: Firebase's own message, or what its code means
function cloudErrorText(e) {
    const code = String((e && e.code) || "").replace(/^firestore\//, "");
    const msg = String((e && e.message) || (e && typeof e !== "object" ? e : "") || "").trim();
    const known = {
        "permission-denied": "Your account isn't allowed to save right now. Signing out and back in usually fixes it.",
        "unauthenticated": "You're signed out of the cloud. Sign in again to save.",
        "unavailable": "Couldn't reach the cloud (no connection).",
        "deadline-exceeded": "The cloud took too long to answer (slow or no connection)."
    };
    const said = known[code] || msg || "Something went wrong.";
    return code && !said.includes(code) ? `${said} (${code})` : said;
}
function cloudStep(promise, ms, what) {
    let t;
    return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`${what} took too long (slow or no connection).`), { code: "deadline-exceeded" })), ms); })])
        .finally(() => clearTimeout(t));
}
async function uploadCloudSaveNow({ force = false, background = false } = {}) {
    if (!cloudUser || cloudBusy) return false;
    cloudBusy = true;
    cloudFailRetryable = false;
    try {
        const json = JSON.stringify(await collectCloudBundle());
        const hash = await sha256Hex(json);
        const sum = progressSummary();
        // Nothing changed since the last sync: skip the Firebase read entirely
        if (!force && hash === localStorage.getItem(CLOUD.keys.syncedHash) && localStorage.getItem(CLOUD.keys.syncedGen)) {
            noteSaveState("ok", { sum }); setCloudStatus("Up to date — " + new Date().toLocaleTimeString());
            return true;
        }
        if (!force && typeof fbPaused === "function" && fbPaused()) {
            noteSaveState("paused"); setCloudStatus("Cloud saves are paused: the site reached its daily Firebase limit. Your progress is safe on this device.");
            return false;
        }
        if (background && typeof fbBackgroundPaused === "function" && fbBackgroundPaused()) {
            noteSaveState("paused"); setCloudStatus("Autosave is paused because the site's daily Firebase limit is almost used up. Save from the Account menu, or it saves when you close a game.");
            return false;
        }
        noteSaveState("saving", { step: "Checking your account", startedAt: Date.now(), part: 0, parts: 0 }); setCloudStatus("Saving…");
        const meta = await cloudStep(fetchCloudMeta(), 30000, "Checking your account");
        clearTimeout(cloudSyncRetryTimer); cloudSyncRetryDelay = 0;
        if (typeof liveAdopt === "function") liveAdopt(meta);
        const localGen = localStorage.getItem(CLOUD.keys.syncedGen);
        if (meta && meta.gen !== localGen && !force) {
            // Someone saved from another device since this device last synced.
            noteSaveState("conflict"); setCloudStatus("Another device saved newer progress — open Account to choose which to keep.");
            // Sort it out the same way as on sign-in (cloudSyncOnSignIn): load the
            // cloud save without asking unless this device has more progress. Not
            // in the middle of a game, since loading reloads the page: closing the
            // game saves again and lands back here.
            if (cloudConflictWarned !== meta.gen) {
                const inGame = typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex";
                if (!inGame) {
                    cloudConflictWarned = meta.gen;
                    setTimeout(cloudSyncOnSignIn, 0);   // after cloudBusy is cleared below
                } else if (cloudConflictNoted !== meta.gen) {
                    cloudConflictNoted = meta.gen;
                    notify("Your account was saved from another device. When you close this game, the site switches to that progress (or asks, if this device has more).", { duration: 12000 });
                }
            }
            return false;
        }
        if (meta && meta.hash === hash) {
            localStorage.setItem(CLOUD.keys.syncedHash, hash);
            noteSaveState("ok", { size: meta.size || 0, sum }); setCloudStatus("Up to date — " + new Date().toLocaleTimeString());
            return true;
        }
        noteSaveState("saving", { step: "Packing your progress" });
        const { packed, left, blobs, total } = await prepareCloudSave(JSON.parse(json));
        if (packed.length > CLOUD.maxChars) {
            noteSaveState("error", { error: `The save is too big for the cloud (${(packed.length / 1e6).toFixed(1)} MB, the limit is ${(CLOUD.maxChars / 1e6).toFixed(0)} MB) even without game data. Your progress is safe on this device.` });
            setCloudStatus(`Save is too big for the cloud (${(packed.length / 1e6).toFixed(1)} MB).`);
            return false;
        }
        cloudSaveState.left = left;
        // Game data the cloud already has (in this save or one kept from before) isn't sent again
        const have = new Set([meta, ...keptSaves(meta)].flatMap(blobsOf).map(b => b.id));
        const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const chunkCount = Math.max(1, Math.ceil(packed.length / CLOUD.chunkChars));
        // Copy to Firebase too if the last copy is 30+ minutes old (or the
        // server is down right now, so everything has to go there anyway)
        const oldFbCopy = meta && meta.fbCopy && meta.fbCopy.gen ? meta.fbCopy : null;
        const copyNow = !oldFbCopy || Date.now() - (oldFbCopy.at || 0) >= CLOUD.fbCopyMs || Date.now() < homeSavesDownUntil;
        const fbHave = copyNow ? new Set(blobsOf(oldFbCopy).map(b => b.id)) : null;
        const up = await uploadBlobs(blobs, have, (i, n) => {
            noteSaveState("saving", { step: `Uploading game data (part ${i + 1} of ${n})`, part: i, parts: n + chunkCount, size: total });
        }, fbHave);
        const blobParts = up.sent;
        let fbOk = up.fbOk;
        for (let i = 0; i < chunkCount; i++) {
            noteSaveState("saving", { step: `Uploading part ${i + 1} of ${chunkCount}`, part: blobParts + i, parts: blobParts + chunkCount, size: total });
            const inFb = await cloudStep(savePart("chunks", `${gen}_${i}`).set({ d: packed.slice(i * CLOUD.chunkChars, (i + 1) * CLOUD.chunkChars) }, { fb: copyNow }), 60000, `Uploading part ${i + 1} of ${chunkCount}`);
            if (!inFb) fbOk = false;
        }
        noteSaveState("saving", { step: "Finishing up", part: 1, parts: 1 });
        // Replacing the cloud save keeps the old one for a week; expired ones are deleted
        const replacing = !!(meta && meta.gen && (force || meta.gen !== localGen));
        const now = Date.now();
        let kept = keptSaves(meta);
        if (replacing) kept.unshift({ gen: meta.gen, chunkCount: meta.chunkCount || 0, sum: meta.sum || null, at: meta.updatedAt && meta.updatedAt.toMillis ? meta.updatedAt.toMillis() : now, until: now + KEEP_REPLACED_MS, ...(blobsOf(meta).length ? { blobs: blobsOf(meta) } : {}) });
        const drop = kept.filter((k, i) => k.until < now || i >= KEEP_REPLACED_MAX);
        kept = kept.filter(k => !drop.includes(k));
        if (meta && meta.gen && !replacing) drop.push(meta);   // an autosave over this device's own save
        const blobList = blobs.map(b => ({ id: b.id, n: b.n }));
        // The Firebase copy: this save if it was fully copied, else the last one
        const fbCopy = copyNow && fbOk ? { gen, chunkCount, hash, sum, blobs: blobList, at: now } : oldFbCopy;
        if (oldFbCopy && fbCopy !== oldFbCopy) drop.push(oldFbCopy);
        await cloudStep(saveDocRef().set({
            gen, chunkCount, hash, sum, blobs: blobList,
            ...(fbCopy ? { fbCopy } : {}),
            size: total,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            kept
        }), 30000, "Finishing up");
        localStorage.setItem(CLOUD.keys.syncedGen, gen);
        localStorage.setItem(CLOUD.keys.syncedHash, hash);
        for (const old of drop) {
            if (old.gen === gen || kept.some(k => k.gen === old.gen) || (fbCopy && old.gen === fbCopy.gen)) continue;
            for (let i = 0; i < (old.chunkCount || 0); i++) savePart("chunks", `${old.gen}_${i}`).delete().catch(() => {});
        }
        dropBlobs(drop, [{ blobs: blobList }, ...kept, ...(fbCopy ? [fbCopy] : [])]);
        noteSaveState("ok", { size: total, sum, left });
        setCloudStatus("Saved to cloud — " + new Date().toLocaleTimeString() + (left.length ? `. Left out (too big, kept on this device): ${left.map(l => `${l.files} item${l.files === 1 ? "" : "s"} from ${l.name} (${l.mb} MB)`).join(", ")}` : ""));
        return true;
    } catch (e) {
        console.error("Cloud save failed", e);
        // Not the daily-limit pause, and not just being offline
        if (typeof reportError === "function" && !(typeof noteFbError === "function" && /resource-exhausted|quota/i.test(String(e && (e.code || e.message)))) && navigator.onLine !== false && e && e.code !== "unavailable") {
            reportError("cloud-save", (e && e.message) || String(e), { stack: e && e.stack, detail: e && e.code });
        }
        if (typeof noteFbError === "function" && noteFbError(e)) {
            noteSaveState("paused"); setCloudStatus("Cloud saves are paused: the site reached its daily Firebase limit. Your progress is safe on this device.");
        } else {
            // Signed out or not allowed won't fix itself; anything else gets tried again
            cloudFailRetryable = !/permission-denied|unauthenticated/.test(String(e && e.code));
            noteSaveState(cloudFailRetryable ? "retry" : "error", { error: cloudErrorText(e) }); setCloudStatus("Cloud save failed: " + (e.message || e) + (cloudFailRetryable ? " Trying again soon; your progress is safe on this device." : ""));
        }
        return false;
    } finally {
        cloudBusy = false;
    }
}
// Before a cloud save replaces this device's progress, keep a copy of this
// device's in the cloud for a week too (if it has real progress), so it can
// be brought back from Earlier cloud saves.
// Best effort: gives up after 45 s so a slow connection can't hold up loading
function keepDeviceCopy() {
    return cloudStep(keepDeviceCopyNow(), 45000, "Keeping a copy of this device's progress").catch(e => console.warn(e));
}
async function keepDeviceCopyNow() {
    const sum = progressSummary();
    if ((sum.level || 0) <= 1 && (sum.playSec || 0) < 600) return;
    try {
        const { packed, blobs } = await prepareCloudSave(await collectCloudBundle());
        if (packed.length > CLOUD.maxChars) return;
        let meta = await fetchCloudMeta();
        if (!meta) return;
        await uploadBlobs(blobs, new Set([meta, ...keptSaves(meta)].flatMap(blobsOf).map(b => b.id)));
        const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + "d";
        const chunkCount = Math.max(1, Math.ceil(packed.length / CLOUD.chunkChars));
        for (let i = 0; i < chunkCount; i++) await savePart("chunks", `${gen}_${i}`).set({ d: packed.slice(i * CLOUD.chunkChars, (i + 1) * CLOUD.chunkChars) });
        meta = await fetchCloudMeta();
        if (!meta) return;
        const kept = [{ gen, chunkCount, sum, at: Date.now(), until: Date.now() + KEEP_REPLACED_MS, device: true, blobs: blobs.map(b => ({ id: b.id, n: b.n })) }, ...keptSaves(meta)].slice(0, KEEP_REPLACED_MAX);
        await saveDocRef().set({ kept }, { merge: true });
    } catch (e) { console.warn("Couldn't keep a copy of this device's progress", e); }
}
async function downloadCloudSave({ previous = "" } = {}) {
    if (!cloudUser || cloudBusy) return false;
    cloudBusy = true;
    try {
        setCloudStatus("Loading cloud save…");
        await keepDeviceCopy();
        let meta = await cloudStep(fetchCloudMeta(), 30000, "Checking your account");
        if (!meta) { setCloudStatus("No cloud save yet."); return false; }
        if (previous) {
            const k = keptSaves(meta).find(x => x.gen === previous);
            if (!k) { setCloudStatus("That earlier cloud save isn't there anymore."); return false; }
            meta = k;
        }
        const load = async m => {
            const parts = await cloudStep(Promise.all(
                Array.from({ length: m.chunkCount }, (_, i) => savePart("chunks", `${m.gen}_${i}`).get())
            ), 90000, "Downloading your cloud save");
            if (parts.some(p => !p.exists)) throw new Error("cloud save is incomplete, try again" + homeSavesNote());
            return joinBlobs(JSON.parse(await b64ToText(parts.map(p => p.data().d).join(""))));
        };
        let bundle, usedBackup = false;
        try { bundle = await load(meta); }
        catch (e) {
            // The newest save is only on the GN 2.0 Server and it's down: load the
            // Firebase copy instead (up to ~30 minutes older)
            const backup = !previous && meta.fbCopy && meta.fbCopy.gen && meta.fbCopy.gen !== meta.gen ? meta.fbCopy : null;
            if (!backup) throw e;
            bundle = await load(backup);
            usedBackup = true;
            const mins = Math.max(1, Math.round((Date.now() - (backup.at || Date.now())) / 60000));
            try { sessionStorage.setItem("gnmath-cloud-backup-note", `The GN 2.0 Server is down, so your save from ${mins} minute${mins === 1 ? "" : "s"} earlier was loaded. Your newest save is kept in Account → Earlier cloud saves.`); } catch {}
        }
        if (typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex") closeZone();
        await applyCloudBundle(bundle);
        if (previous || usedBackup) {
            // Going back (or loaded the older Firebase copy): the next save from this
            // device becomes the cloud save, and the one it replaces is kept for a week
            localStorage.removeItem(CLOUD.keys.syncedHash);
            localStorage.setItem(CLOUD.keys.pendingUndo, "1");
        } else {
            localStorage.setItem(CLOUD.keys.syncedGen, meta.gen);
            localStorage.setItem(CLOUD.keys.syncedHash, meta.hash);
        }
        window.removeEventListener("beforeunload", gnmathBeforeUnloadHandler);
        location.reload(); // games read their saves on startup
        return true;
    } catch (e) {
        console.error("Cloud load failed", e);
        setCloudStatus("Cloud load failed: " + (e.message || e));
        return false;
    } finally {
        cloudBusy = false;
    }
}

// Runs right after sign-in (or on page load when already signed in)
async function cloudSyncOnSignIn() {
    try {
        const meta = await cloudStep(fetchCloudMeta(), 30000, "Checking your account");
        clearTimeout(cloudSyncRetryTimer); cloudSyncRetryDelay = 0;
        if (typeof liveAdopt === "function") liveAdopt(meta);
        const localGen = localStorage.getItem(CLOUD.keys.syncedGen);
        // Progress the owner gave back to this account (tools/recover_save.mjs)
        if (meta && meta.grant && typeof applyGrant === "function") { try { applyGrant(meta.grant); } catch (e) { console.warn(e); } }
        if (!meta) { await uploadCloudSave({ force: true }); return; }
        if (localStorage.getItem(CLOUD.keys.pendingUndo)) {
            // Just went back to the earlier cloud save: make it the cloud save again
            localStorage.removeItem(CLOUD.keys.pendingUndo);
            await uploadCloudSave({ force: true });
            return;
        }
        if (meta.gen === localGen) { await uploadCloudSave(); return; }
        const when = meta.updatedAt && meta.updatedAt.toDate ? meta.updatedAt.toDate().toLocaleString() : "earlier";
        const here = progressSummary(), cloud = meta.sum || null;
        const deviceLess = progressIsLess(here, cloud), cloudLess = progressIsLess(cloud, here);
        // Load the cloud save without asking, unless this device clearly has more
        // progress. This device's progress is kept for a week first (keepDeviceCopy),
        // so it can still be brought back from Account → Earlier cloud saves.
        if (!cloudLess) {
            if (!(await downloadCloudSave())) cloudSyncRetry(new Error("Couldn't load your cloud save (slow or no connection)."));
            return;
        }
        const choice = await askChoice(
            `Your account has progress saved on ${when}` + (cloud ? ` (${describeProgress(cloud)})` : "") +
            `, and this device has its own (${describeProgress(here)}). Which do you want to keep? The other one is replaced.` +
            (deviceLess ? "\n\nThis device has less progress than your cloud save." : cloudLess ? "\n\nYour cloud save has less progress than this device." : ""), {
                title: "Pick which progress to keep",
                choices: [
                    { value: "device", label: "Keep this device's" },
                    { value: "cloud", label: "Load my cloud save", primary: true }
                ]
            });
        if (choice === "cloud") { if (!(await downloadCloudSave())) cloudSyncRetry(new Error("Couldn't load your cloud save (slow or no connection).")); }
        else if (choice === "device") {
            if (!(await askConfirm(`Your cloud save` + (cloud ? ` (${describeProgress(cloud)})` : "") + ` will be replaced with this device's progress (${describeProgress(here)}).` +
                (deviceLess ? " This device has LESS progress, so you'd lose some." : "") +
                " The replaced cloud save is kept for 7 days: Account → Earlier cloud saves brings it back.",
                { title: deviceLess ? "Replace your better cloud save?" : "Replace your cloud save?", confirmText: "Replace it", danger: true }))) {
                noteSaveState("conflict"); setCloudStatus("Not synced yet. Open Account to choose which progress to keep.");
                return;
            }
            await uploadCloudSave({ force: true });
        }
        else { noteSaveState("conflict"); setCloudStatus("Not synced yet. Open Account to choose which progress to keep."); }
    } catch (e) {
        console.error(e);
        cloudSyncRetry(e);
    }
}
// Checking the account on sign-in failed (slow or no connection): try again
// in 30 s, then less often, instead of waiting for the next page load
let cloudSyncRetryTimer = null, cloudSyncRetryDelay = 0;
function cloudSyncRetry(e) {
    clearTimeout(cloudSyncRetryTimer);
    if (!cloudUser) return;
    cloudSyncRetryDelay = Math.min(cloudSyncRetryDelay ? cloudSyncRetryDelay * 2 : 30000, 5 * 60000);
    noteSaveState("retry", { error: cloudErrorText(e), retryAt: Date.now() + cloudSyncRetryDelay });
    setCloudStatus("Couldn't reach the cloud: " + (e.message || e));
    cloudSyncRetryTimer = setTimeout(() => { cloudSyncRetryTimer = null; cloudSaveState.retryAt = 0; if (cloudUser) cloudSyncOnSignIn(); }, cloudSyncRetryDelay);
}

// ── Accounts ────────────────────────────────────────────────────────────────
function normalizeUsername(raw) { return (raw || "").trim().toLowerCase(); }
function usernameToEmail(u) { return `${u}@${CLOUD.usernameDomain}`; }
// Accounts made before emails sign in as <username>@gnmath.local. Accounts
// with a real email keep their username in displayName (claimed in usernames/).
function isLegacyAccount(user = cloudUser) { return !!(user && user.email && user.email.endsWith("@" + CLOUD.usernameDomain)); }
function currentUsername() {
    if (!cloudUser || !cloudUser.email) return "";
    if (isLegacyAccount()) return cloudUser.email.split("@")[0];
    const n = normalizeUsername(cloudUser.displayName || "");
    return USERNAME_RE.test(n) ? n : "";
}
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
// The account's username is kept in its display name. Linking Google (and
// sometimes signing in with it) replaces that with the Google name ("Lincoln
// Paxton"), which made the site treat the account as having no username: its
// profile stopped updating and it showed as offline. This puts it back, from
// this browser's memory of the account or its profile, checked against the
// username claim (usernames/<name>).
const USERNAME_MEMO = uid => "gnmath-username-" + uid;
function rememberUsername(user = cloudUser) {
    try { const u = user && currentUsernameOf(user); if (u) localStorage.setItem(USERNAME_MEMO(user.uid), u); } catch {}
}
function currentUsernameOf(user) {
    if (!user || !user.email) return "";
    if (isLegacyAccount(user)) return user.email.split("@")[0];
    const n = normalizeUsername(user.displayName || "");
    return USERNAME_RE.test(n) ? n : "";
}
async function repairUsername(user) {
    if (!user || isLegacyAccount(user) || currentUsernameOf(user)) return false;
    const tries = [];
    try { const m = localStorage.getItem(USERNAME_MEMO(user.uid)); if (m) tries.push(m); } catch {}
    try { const p = await cloudDb.collection("profiles").doc(user.uid).get(); if (p.exists && p.data().username) tries.push(p.data().username); } catch {}
    for (const name of [...new Set(tries.map(normalizeUsername))]) {
        if (!USERNAME_RE.test(name)) continue;
        try {
            const d = await cloudDb.collection("usernames").doc(name).get();
            if (d.exists && d.data().uid === user.uid) {
                await user.updateProfile({ displayName: name });
                return true;
            }
        } catch (e) { console.warn("Couldn't check username", name, e); }
    }
    return false;
}
// Signing in with a username, for accounts that sign in with an email: the
// username's claim (usernames/<name>, which anyone can read) holds the sign-in
// email locked with the account's password (PBKDF2 → AES-GCM). Only the right
// password unlocks it, so the email isn't public, and a wrong password can't
// tell anyone what the email is. Written whenever the account signs in with
// its email and password, or changes its password.
const LOGIN_SEAL_ITER = 200000;
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function loginKey(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function sealLoginEmail(email, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await loginKey(password, salt, LOGIN_SEAL_ITER);
    const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(email)));
    return { s: b64(salt), v: b64(iv), c: b64(c), n: LOGIN_SEAL_ITER };
}
async function openLoginEmail(le, password) {
    try {
        if (!le || typeof le.c !== "string" || !(le.n >= 10000 && le.n <= 2000000)) return "";
        const key = await loginKey(password, unb64(le.s), le.n);
        const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(le.v) }, key, unb64(le.c));
        const email = new TextDecoder().decode(out);
        return EMAIL_RE.test(email) ? email : "";
    } catch { return ""; }
}
async function sealLoginForUsername(password) {
    try {
        const user = cloudAuth.currentUser;
        if (!user || isLegacyAccount(user) || !password || !(window.crypto && crypto.subtle)) return;
        let name = currentUsernameOf(user);
        // Right after signing in, a username replaced by Google's name may still be being put back
        if (!name) { await new Promise(r => setTimeout(r, 4000)); name = currentUsernameOf(cloudAuth.currentUser || user); }
        if (!name) return;
        const ref = cloudDb.collection("usernames").doc(name);
        const d = await ref.get();
        if (!d.exists || d.data().uid !== user.uid) return;
        // Already unlocks with this password to this email: nothing to write
        if (d.data().le && await openLoginEmail(d.data().le, password) === user.email) return;
        await ref.update({ e: true, le: await sealLoginEmail(user.email, password) });
    } catch (e) { console.warn("Couldn't set up username sign-in", e); }
}
// Username → sign-in email for accounts that have signed in on this browser,
// so the username works in the sign-in box too (kept only on this device)
const KNOWN_LOGINS_KEY = "gnmath-known-logins";
function knownLoginEmail(username) {
    try { return (JSON.parse(localStorage.getItem(KNOWN_LOGINS_KEY) || "{}") || {})[username] || ""; } catch { return ""; }
}
function rememberLogin(user = cloudUser) {
    try {
        const u = currentUsernameOf(user);
        if (!u || !user.email || isLegacyAccount(user)) return;
        const m = JSON.parse(localStorage.getItem(KNOWN_LOGINS_KEY) || "{}") || {};
        if (m[u] === user.email) return;
        m[u] = user.email;
        localStorage.setItem(KNOWN_LOGINS_KEY, JSON.stringify(m));
    } catch {}
}
// A new account whose email isn't verified yet can't use cloud features
function accountNeedsVerify(user = cloudUser) { return !!(user && !isLegacyAccount(user) && !user.emailVerified); }
// Signed in with Google for the first time: needs to pick a username
function accountNeedsUsername(user = cloudUser) { return !!(user && !isLegacyAccount(user) && !currentUsernameOf(user)); }
function hasPassword(user = cloudUser) { return !!(user && user.providerData.some(p => p.providerId === "password")); }
function hasGoogle(user = cloudUser) { return !!(user && user.providerData.some(p => p.providerId === "google.com")); }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function friendlyAuthError(e) {
    const code = (e && e.code) || "";
    if (code.includes("email-already-in-use")) return "An account already uses that email.";
    if (code.includes("invalid-email")) return "That email doesn't look right.";
    if (code.includes("requires-recent-login")) return "Sign out and back in, then try again.";
    if (code.includes("operation-not-allowed") || code.includes("unauthorized-domain")) return "Google sign-in isn't turned on for this site yet.";
    if (code.includes("internal-error") || code.includes("web-storage-unsupported")) return "Google sign-in couldn't open here. Your network or browser may block it; your normal sign-in still works.";
    if (code.includes("popup-blocked")) return "Your browser blocked the Google window. Allow pop-ups for this site and try again.";
    if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "The Google window was closed before signing in.";
    if (code.includes("account-exists-with-different-credential")) return "An account already uses that Google email. Sign in with your email and password, then link Google from Account.";
    if (code.includes("credential-already-in-use")) return "That Google account is already used by another GN 2.0 account.";
    if (code.includes("provider-already-linked")) return "Google is already linked to this account.";
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Wrong username, email or password.";
    if (code.includes("weak-password")) return "Password needs at least 6 characters.";
    if (code.includes("too-many-requests")) return "Too many tries. Wait a bit and try again.";
    if (code.includes("network")) return "Couldn't connect. Check your internet.";
    return (e && e.message) || "Something went wrong.";
}
async function cloudSignIn(create) {
    const msg = document.getElementById("acct-msg");
    const say = t => { if (msg) msg.textContent = t; };
    const p = document.getElementById("acct-password")?.value || "";
    if (create) {
        // New accounts: username + a real email, verified before the account can be used
        const u = normalizeUsername(document.getElementById("acct-username")?.value);
        const email = (document.getElementById("acct-email")?.value || "").trim();
        if (!/^[a-z0-9_]{3,20}$/.test(u)) return say("Username: 3–20 letters, numbers, or _");
        if (!EMAIL_RE.test(email) || email.toLowerCase().endsWith("@" + CLOUD.usernameDomain)) return say("Enter a real email address.");
        if (p.length < 6) return say("Password needs at least 6 characters.");
        if (p !== (document.getElementById("acct-password2")?.value || "")) return say("Passwords don't match.");
        say("Creating account…");
        try {
            const taken = await cloudDb.collection("usernames").doc(u).get();
            if (taken.exists) return say("That username is taken.");
        } catch (e) { /* checked again when it's claimed */ }
        let user = null;
        try {
            user = (await cloudAuth.createUserWithEmailAndPassword(email, p)).user;
            // Claim the username (fails if someone has it), then name the account
            await cloudDb.collection("usernames").doc(u).set({ uid: user.uid, e: true });
            await user.updateProfile({ displayName: u });
            await user.sendEmailVerification();
            if (typeof syncMyProfileAndRoles === "function") syncMyProfileAndRoles(user);
            openAccountPanel();
        } catch (e) {
            if (user && !user.displayName) {
                // Couldn't claim the username: undo the account so the email can be used again
                try { await user.delete(); } catch {}
                return say(/permission/i.test(e.code || e.message || "") ? "That username is taken." : friendlyAuthError(e));
            }
            say(friendlyAuthError(e));
        }
        return;
    }
    // Sign in with a username (accounts from before emails) or an email
    const id = (document.getElementById("acct-username")?.value || "").trim();
    if (p.length < 6) return say("Enter your password.");
    say("Signing in…");
    try {
        if (id.includes("@")) {
            if (!EMAIL_RE.test(id)) return say("That email doesn't look right.");
            await cloudAuth.signInWithEmailAndPassword(id, p);
            sealLoginForUsername(p);
            return;
        }
        const u = normalizeUsername(id);
        if (!/^[a-z0-9_]{3,20}$/.test(u)) return say("Enter your username or email.");
        try {
            await cloudAuth.signInWithEmailAndPassword(usernameToEmail(u), p);
        } catch (e) {
            // An account with an email that has signed in on this browser before
            const known = knownLoginEmail(u);
            if (known) {
                try { await cloudAuth.signInWithEmailAndPassword(known, p); sealLoginForUsername(p); return; }
                catch (e2) { return say(friendlyAuthError(e2)); }
            }
            // Accounts with an email: their sign-in email, locked with their password
            let doc = null;
            try { const d = await cloudDb.collection("usernames").doc(u).get(); doc = d.exists ? d.data() : null; } catch {}
            if (doc && doc.le) {
                const email = await openLoginEmail(doc.le, p);
                if (!email) return say("Wrong username, email or password.");
                try { await cloudAuth.signInWithEmailAndPassword(email, p); return; }
                catch (e3) { return say(friendlyAuthError(e3)); }
            }
            say(doc && doc.e === true ? "This account signs in with its email address (or Google). Sign in with your email once, and your username works everywhere after that." : friendlyAuthError(e));
        }
    } catch (e) {
        say(friendlyAuthError(e));
    }
}
// "Forgot password?": Firebase emails a reset link (accounts with an email only)
async function cloudForgotPassword() {
    const msg = document.getElementById("acct-msg");
    const say = t => { if (msg) msg.textContent = t; };
    const email = (document.getElementById("acct-username")?.value || "").trim();
    if (!EMAIL_RE.test(email)) { document.getElementById("acct-username")?.focus(); return say("Type your account's email in the box above, then click Forgot password again."); }
    try {
        await cloudAuth.sendPasswordResetEmail(email);
    } catch (e) {
        if (!/user-not-found|invalid-email/.test(e.code || "")) return say(friendlyAuthError(e));
    }
    say("");
    notify(`If an account uses ${email}, a reset link is on its way. Check your inbox (and spam).`, { type: "success", duration: 9000 });
}
// New account: resend the verification email, or check whether it's verified
async function cloudResendVerify() {
    if (!cloudUser) return;
    try { await cloudUser.sendEmailVerification(); notify(`Sent another link to ${cloudUser.email}.`, { type: "success" }); }
    catch (e) { notify(friendlyAuthError(e), { type: "error" }); }
}
async function cloudCheckVerified() {
    if (!cloudUser) return;
    try {
        await cloudUser.reload();
        if (cloudUser.emailVerified) {
            await cloudUser.getIdToken(true);
            notify("Email verified. Your account is ready!", { type: "success" });
            location.reload();
        } else notify("Not verified yet. Click the link in the email we sent, then try again.", { type: "error" });
    } catch (e) { notify(friendlyAuthError(e), { type: "error" }); }
}
// Accounts with an email: switch to a different one. Firebase emails a link to
// the new address; the email only changes once it's clicked (the old address
// also gets a note with a way to undo it).
async function cloudChangeEmail() {
    const email = (document.getElementById("acct-new-email")?.value || "").trim();
    const pw = document.getElementById("acct-new-email-pw")?.value || "";
    const msg = document.getElementById("acct-chemail-msg");
    const say = t => { if (msg) msg.textContent = t; };
    if (!cloudUser || isLegacyAccount() || !hasPassword()) return;
    if (!EMAIL_RE.test(email) || email.toLowerCase().endsWith("@" + CLOUD.usernameDomain)) return say("Enter a real email address.");
    if (email.toLowerCase() === (cloudUser.email || "").toLowerCase()) return say("That's already your email.");
    if (!pw) return say("Enter your password.");
    say("Sending…");
    try {
        await cloudUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(cloudUser.email, pw));
        await cloudUser.verifyBeforeUpdateEmail(email);
        say("");
        notify(`Check ${email} for a link. Your email changes when you click it; until then, keep signing in with ${cloudUser.email}.`, { type: "success", duration: 12000 });
    } catch (e) {
        say(friendlyAuthError(e));
    }
}
// Accounts from before emails: add one (for password resets). Firebase emails
// a link; once it's clicked, the account signs in with that email.
async function cloudAddEmail() {
    const email = (document.getElementById("acct-add-email")?.value || "").trim();
    const pw = document.getElementById("acct-add-email-pw")?.value || "";
    const msg = document.getElementById("acct-email-msg");
    const say = t => { if (msg) msg.textContent = t; };
    if (!cloudUser || !isLegacyAccount()) return;
    if (!EMAIL_RE.test(email) || email.toLowerCase().endsWith("@" + CLOUD.usernameDomain)) return say("Enter a real email address.");
    if (!pw) return say("Enter your password.");
    const u = currentUsername();
    say("Sending…");
    try {
        await cloudUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(cloudUser.email, pw));
        // Keep the username once the sign-in email changes
        const ref = cloudDb.collection("usernames").doc(u);
        const cur = await ref.get();
        if (cur.exists && cur.data().uid !== cloudUser.uid) return say("Something's wrong with your username. Ask an admin.");
        await ref.set({ uid: cloudUser.uid, e: true });
        await cloudUser.updateProfile({ displayName: u });
        await cloudUser.verifyBeforeUpdateEmail(email);
        try { localStorage.setItem("gnmath-email-nudge-" + cloudUser.uid, "done"); } catch {}
        say("");
        notify(`Check ${email} for a link. After you click it, sign in with your email instead of your username.`, { type: "success", duration: 12000 });
    } catch (e) {
        say(friendlyAuthError(e));
    }
}

// ── Google ───────────────────────────────────────────────────────────────────
// "Sign in with Google": signs in to the account that's linked to that Google
// account, or makes a new one (it then picks a username). Signed-in accounts
// can link Google so either way gets them in. Needs Google turned on in the
// Firebase console (Authentication → Sign-in method) and the site's address in
// its authorized domains; school Google accounts may also be blocked by the
// school. When it doesn't work, it just says so.
function googleProvider() {
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
}
async function cloudGoogleSignIn() {
    const msg = document.getElementById("acct-msg");
    const say = t => { if (msg) msg.textContent = t; };
    if (!cloudAuth) return;
    say("Opening Google…");
    try {
        await cloudAuth.signInWithPopup(googleProvider());
        say("");
        setTimeout(() => openAccountPanel(), 300);
    } catch (e) {
        console.warn("Google sign-in failed", e);
        say(friendlyAuthError(e));
    }
}
async function cloudLinkGoogle() {
    if (!cloudUser) return;
    try {
        const keep = currentUsername();
        await cloudUser.linkWithPopup(googleProvider());
        // Linking gives the account the Google name; keep the username
        if (keep && normalizeUsername(cloudUser.displayName || "") !== keep) await cloudUser.updateProfile({ displayName: keep });
        notify("Google is linked. You can sign in with Google from now on.", { type: "success" });
        openAccountPanel();
    } catch (e) {
        console.warn("Linking Google failed", e);
        notify(friendlyAuthError(e), { type: "error", duration: 9000 });
    }
}
async function cloudUnlinkGoogle() {
    if (!cloudUser || !hasPassword()) return;
    if (!(await askConfirm("You'll sign in with your username or email and password only.", { title: "Unlink Google?", confirmText: "Unlink" }))) return;
    try { await cloudUser.unlink("google.com"); notify("Google unlinked.", { type: "success" }); openAccountPanel(); }
    catch (e) { notify(friendlyAuthError(e), { type: "error" }); }
}
// First Google sign-in: claim a username for the new account
async function cloudPickUsername() {
    const u = normalizeUsername(document.getElementById("acct-pick-username")?.value);
    const msg = document.getElementById("acct-msg");
    const say = t => { if (msg) msg.textContent = t; };
    if (!cloudUser) return;
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return say("Username: 3–20 letters, numbers, or _");
    say("Saving…");
    try {
        const ref = cloudDb.collection("usernames").doc(u);
        if ((await ref.get()).exists) return say("That username is taken.");
        await ref.set({ uid: cloudUser.uid, e: true });
        await cloudUser.updateProfile({ displayName: u });
        location.reload();
    } catch (e) {
        say(/permission/i.test(e.code || e.message || "") ? "That username is taken." : friendlyAuthError(e));
    }
}
const GOOGLE_BUTTON = (label) => `<button class="settings-button acct-google" onclick="cloudGoogleSignIn()"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 48 48" style="vertical-align:-3px;margin-right:6px"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>${label}</button>`;

// Saving first can take a few seconds, so the button says so and extra clicks
// are ignored. If the save is very slow, sign out anyway after 10 seconds
// (progress stays on this device either way).
let cloudSigningOut = false;
async function cloudSignOut() {
    if (cloudSigningOut) return;
    if (!(await askConfirm("Your progress will be saved to the cloud first.", { title: "Sign out?", confirmText: "Sign out" }))) return;
    cloudSigningOut = true;
    const btn = document.getElementById("acct-signout");
    if (btn) { btn.disabled = true; btn.textContent = "Saving, then signing out…"; }
    try {
        // Wait for an autosave that's already running, then save
        for (let i = 0; i < 20 && cloudBusy; i++) await new Promise(r => setTimeout(r, 250));
        await Promise.race([uploadCloudSave(), new Promise(r => setTimeout(r, 10000))]);
        await cloudAuth.signOut();
    } catch (e) {
        console.error(e);
        notify("Couldn't sign out: " + (e.message || e), { type: "error" });
        if (btn) { btn.disabled = false; btn.textContent = "Sign out"; }
    } finally {
        cloudSigningOut = false;
    }
}

async function cloudChangePassword() {
    const msg = document.getElementById("acct-pw-msg");
    const say = (t, ok) => { if (msg) { msg.textContent = t; msg.style.color = ok ? "var(--success)" : "#ef4444"; } };
    const oldPw = document.getElementById("acct-old-password")?.value || "";
    const pw1 = document.getElementById("acct-new-password")?.value || "";
    const pw2 = document.getElementById("acct-new-password2")?.value || "";
    if (!cloudUser) return say("Sign in first.");
    if (!oldPw) return say("Enter your current password.");
    if (pw1.length < 6) return say("The new password needs at least 6 characters.");
    if (pw1 !== pw2) return say("The new passwords don't match.");
    if (pw1 === oldPw) return say("The new password is the same as the current one.");
    say("Changing password…", true);
    try {
        // Firebase requires a fresh sign-in before changing a password
        await cloudUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(cloudUser.email, oldPw));
        await cloudUser.updatePassword(pw1);
        sealLoginForUsername(pw1);
        ["acct-old-password", "acct-new-password", "acct-new-password2"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        say("Password changed.", true);
        notify("Your password was changed. Use the new one next time you sign in.", { type: "success" });
    } catch (e) {
        console.error("Change password failed", e);
        const code = (e && e.code) || "";
        say(code.includes("invalid-credential") || code.includes("wrong-password") ? "Your current password is wrong." : friendlyAuthError(e));
    }
}

async function cloudDeleteAccount() {
    const pw = document.getElementById("acct-delete-password")?.value || "";
    if (!cloudUser) return;
    if (!pw && hasPassword()) { setCloudStatus("Enter your password to delete your account."); return; }
    if (!(await askConfirm(`This permanently deletes "${currentUsername()}", its cloud save, its ratings and reports, and its game submissions. It can't be undone.`, { title: "Delete account?", confirmText: "Delete account", danger: true }))) return;
    try {
        setCloudStatus("Deleting…");
        clearInterval(cloudAutosaveTimer); cloudAutosaveTimer = null;
        clearTimeout(cloudRetryTimer); cloudRetryTimer = null;
        // Firebase requires a fresh sign-in before deleting an account.
        if (hasPassword()) await cloudUser.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(cloudUser.email, pw));
        else await cloudUser.reauthenticateWithPopup(googleProvider());
        cloudBusy = true;
        homeSavesDownUntil = 0;
        await homeSaveFetch("", { method: "DELETE" }).catch(() => {});   // everything on the home server
        const chunks = await saveDocRef().collection("chunks").get();
        await Promise.all(chunks.docs.map(d => d.ref.delete()));
        const blobDocs = await saveDocRef().collection("blobs").get().catch(() => ({ docs: [] }));
        await Promise.all(blobDocs.docs.map(d => d.ref.delete()));
        if (typeof removeMyGameStats === "function") await removeMyGameStats(cloudUser.uid);
        try { await cloudDb.collection("profiles").doc(cloudUser.uid).delete(); } catch (e) {}
        try {
            const nameRef = cloudDb.collection("usernames").doc(currentUsername() || "-");
            const nd = await nameRef.get();
            if (nd.exists && nd.data().uid === cloudUser.uid) await nameRef.delete();
        } catch (e) {}
        try {
            const subs = await cloudDb.collection("submissions").where("uid", "==", cloudUser.uid).get();
            await Promise.all(subs.docs.map(d => d.ref.delete()));
        } catch (e) { console.warn("Couldn't remove game submissions", e); }
        await saveDocRef().delete();
        await cloudUser.delete();
        localStorage.removeItem(CLOUD.keys.syncedGen);
        localStorage.removeItem(CLOUD.keys.syncedHash);
        cloudStatus = "";
        notify("Your account and cloud save were deleted.", { type: "success" });
    } catch (e) {
        console.error("Delete account failed", e);
        setCloudStatus("Couldn't delete: " + friendlyAuthError(e));
        if (cloudUser) startCloudAutosave();
    } finally {
        cloudBusy = false;
    }
}

// Both say what each side has, and warn when the one being replaced has more progress
async function cloudSums() {
    let cloud = null;
    try { const meta = await fetchCloudMeta(); cloud = meta && meta.sum || null; } catch {}
    return { here: progressSummary(), cloud };
}
async function confirmUploadCloudSave() {
    const { here, cloud } = await cloudSums();
    const less = progressIsLess(here, cloud);
    const msg = `This device's progress (${describeProgress(here)}) will replace your cloud save` + (cloud ? ` (${describeProgress(cloud)})` : "") + "." +
        (less ? " This device has LESS progress than your cloud save!" : "") + " The replaced cloud save is kept for 7 days (Account → Earlier cloud saves).";
    if (await askConfirm(msg, { title: less ? "Replace your better cloud save?" : "Save to cloud?", confirmText: less ? "Replace it" : "Save now", danger: less })) uploadCloudSave({ force: true });
}
async function confirmDownloadCloudSave() {
    const { here, cloud } = await cloudSums();
    const less = progressIsLess(cloud, here);
    const msg = "Your cloud save" + (cloud ? ` (${describeProgress(cloud)})` : "") + ` will replace this device's game progress (${describeProgress(here)}).` +
        (less ? " Your cloud save has LESS progress than this device!" : "") + " This device's progress is kept in the cloud for 7 days (Account → Earlier cloud saves).";
    if (await askConfirm(msg, { title: less ? "Replace your better progress?" : "Load cloud save?", confirmText: "Load cloud save", danger: less })) downloadCloudSave();
}
// Lists the cloud saves kept from the last week, to go back to one
async function openEarlierCloudSaves() {
    let meta = null;
    try { meta = await fetchCloudMeta(); } catch (e) { notify("Couldn't reach the cloud: " + (e.message || e), { type: "error" }); return; }
    const list = meta ? keptSaves(meta).filter(k => !k.until || k.until > Date.now()) : [];
    document.getElementById("popupTitle").textContent = "Earlier cloud saves";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    const day = ms => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    body.innerHTML = `<p style="margin-top:0;">When your cloud save gets replaced (by another device, "Keep this device's" or Save now), the old one is kept here for 7 days. So is a device's own progress when a cloud save is loaded over it.</p>` +
        (meta && meta.sum ? `<p style="color:var(--text-muted);font-size:14px;">Your cloud save now: ${escapeHtml(describeProgress(meta.sum))}</p>` : "") +
        (list.length ? `<ul class="backup-list">${list.map(k => `<li><div class="backup-info"><b>${k.device ? "This device's progress from" : "Saved"} ${escapeHtml(day(k.at))}</b><span>${escapeHtml(describeProgress(k.sum))} · kept until ${escapeHtml(day(k.until))}</span></div>
            <div class="backup-buttons"><button class="settings-button" type="button" onclick="confirmLoadEarlierCloudSave('${escapeHtml(k.gen)}')">Go back to this</button></div></li>`).join("")}</ul>`
            : `<p class="backup-empty">No earlier cloud saves from the last 7 days.</p>`) +
        `<h3 style="margin:1.25rem 0 .25rem;font-size:16px;">Save Rewind</h3>
        <p style="margin-top:0;color:var(--text-muted);font-size:14px;">While Live Save is on, your progress from every hour of the last 2 days is kept too. If a game breaks or wipes its save, go back to an hour before it happened.</p>
        <div id="rewindList"><p class="backup-empty">Loading…</p></div>` +
        `<button class="settings-button" type="button" style="margin-top:1rem;background:var(--surface-hover);" onclick="openAccountPanel()">Back</button>`;
    document.getElementById("popupOverlay").style.display = "flex";
    loadRewindList();
}
// ── Save Rewind (hourly snapshots of Live Save, kept 48 h on the GN 2.0 Server) ─
async function loadRewindList() {
    const el = document.getElementById("rewindList");
    if (!el) return;
    let list = null;
    try {
        homeSavesDownUntil = 0;   // worth asking even if a save part was turned down a moment ago
        const res = await homeSaveFetch("rewind");
        if (res.ok) list = await res.json();
    } catch {}
    if (!document.getElementById("rewindList")) return;
    if (!list) { el.innerHTML = `<p class="backup-empty">Your hourly saves are on the GN 2.0 Server, which can't be reached right now. Try again later.</p>`; return; }
    if (!list.length) { el.innerHTML = `<p class="backup-empty">No hourly saves yet. They start once Live Save has been on for a while.</p>`; return; }
    const when = ms => {
        const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
        const y = new Date(Date.now() - 86400000).toDateString() === d.toDateString();
        return (today ? "Today" : y ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    };
    el.innerHTML = `<ul class="backup-list">${list.map(x => `<li><div class="backup-info"><b>${escapeHtml(when(x.at))}</b><span>${escapeHtml(x.sum ? describeProgress(x.sum) : "")}</span></div>
        <div class="backup-buttons"><button class="settings-button" type="button" onclick="confirmRewind(${Number(x.at)})">Go back to this</button></div></li>`).join("")}</ul>`;
}
async function confirmRewind(at) {
    const t = new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    if (!(await askConfirm(`Your progress goes back to how it was at ${t}. Your progress right now is kept for 7 days in Earlier cloud saves, so you can change your mind.`,
        { title: "Go back to this save?", confirmText: "Go back" }))) return;
    rewindTo(at);
}
async function rewindTo(at) {
    if (!cloudUser || cloudBusy) return;
    cloudBusy = true;
    try {
        setCloudStatus("Going back to your save from " + new Date(at).toLocaleTimeString() + "…");
        await keepDeviceCopy();
        const res = await cloudStep(homeSaveFetch("rewind/" + Number(at)), 90000, "Downloading that save");
        if (!res.ok) throw new Error(res.status === 404 ? "that hourly save isn't there anymore" : "the server said " + res.status);
        const snap = await res.json();
        const bundle = await joinBlobs(JSON.parse(await b64ToText(snap.main)));
        if (typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex") closeZone();
        await applyCloudBundle(bundle);
        // The next save from this device becomes the cloud save (the one it replaces is kept a week)
        localStorage.removeItem(CLOUD.keys.syncedHash);
        localStorage.setItem(CLOUD.keys.pendingUndo, "1");
        try { localStorage.removeItem("gnmath-live-hash"); } catch {}
        window.removeEventListener("beforeunload", gnmathBeforeUnloadHandler);
        location.reload();
    } catch (e) {
        setCloudStatus("Couldn't go back: " + (e.message || e));
        notify("Couldn't go back to that save: " + (e.message || e), { type: "error" });
    } finally {
        cloudBusy = false;
    }
}
async function confirmLoadEarlierCloudSave(gen) {
    let meta = null;
    try { meta = await fetchCloudMeta(); } catch {}
    const k = meta && keptSaves(meta).find(x => x.gen === gen);
    if (!k) { notify("That earlier cloud save isn't there anymore."); return; }
    if (!(await askConfirm(`This device and your cloud save go back to the save from ${new Date(k.at).toLocaleString()} (${describeProgress(k.sum)}). ` +
        `What's saved now` + (meta.sum ? ` (${describeProgress(meta.sum)})` : "") + " is kept for 7 days too, so you can change your mind.",
        { title: "Go back to this save?", confirmText: "Go back" }))) return;
    downloadCloudSave({ previous: gen });
}

// ── "Saved 2 min ago" in the game's top bar ─────────────────────────────────
// Signed-in players see whether their game is reaching their account: saving,
// when it last saved, or what's stopping it. Clicking it opens Account.
const SAVE_INFO_KEY = "gnmath-cloud-last";   // { at, size, sum } of the last save that reached the cloud
let cloudSaveState = (() => {
    let last = {};
    try { last = JSON.parse(localStorage.getItem(SAVE_INFO_KEY) || "{}") || {}; } catch {}
    return { phase: "", okAt: 0, lastAt: last.at || 0, size: last.size || 0, sum: last.sum || null, step: "", part: 0, parts: 0, startedAt: 0, stepAt: 0, error: "", retryAt: 0, nextAt: 0 };
})();
function noteSaveState(phase, extra = {}) {
    const s = cloudSaveState;
    s.seq = (s.seq || 0) + 1;
    if (phase !== "saving") { s.step = ""; s.part = 0; s.parts = 0; }
    if (phase !== s.phase || extra.step) s.stepAt = Date.now();
    s.phase = phase;
    Object.assign(s, extra);
    if (phase === "ok") {
        s.okAt = s.lastAt = Date.now(); s.error = ""; s.retryAt = 0;
        try { localStorage.setItem(SAVE_INFO_KEY, JSON.stringify({ at: s.lastAt, size: s.size, sum: s.sum })); } catch {}
    }
    renderSaveChip();
    renderCloseSaveToast();
}
const agoText = ms => { const m = Math.floor(ms / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min " : ""}ago` : `${Math.floor(m / 1440)} days ago`; };
const inText = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? `${sec} s` : `${Math.ceil(sec / 60)} min`; };
function saveChipInfo() {
    const s = cloudSaveState;
    // Live Save working (live-save.js): a rocket and "Live saved 12s ago",
    // unless a full save is going up or something needs attention
    if (!["saving", "retry", "error", "conflict"].includes(s.phase) && typeof liveSaveActive === "function" && liveSaveActive()) {
        const at = liveState.savedAt, sec = Math.round((Date.now() - at) / 1000);
        return { cls: "ok live" + (at && sec < 4 ? " fresh" : ""), icon: "liveSave", text: at && sec < 300 ? "Live saved " + (sec < 10 ? "just now" : sec < 60 ? `${sec}s ago` : `${Math.floor(sec / 60)} min ago`) : "Live Save on" };
    }
    switch (s.phase) {
        case "saving": {
            const slow = Date.now() - s.stepAt > 20000;
            const pct = s.parts ? ` ${Math.round(s.part / s.parts * 100)}%` : "";
            return { cls: "busy", text: (slow ? "Still saving…" : "Saving…") + pct };
        }
        case "ok": return { cls: "ok", text: "Saved " + agoText(Date.now() - s.okAt) };
        case "retry": return { cls: "warn", text: s.retryAt ? `Not saved: retry in ${inText(s.retryAt - Date.now())}` : "Not saved yet" };
        case "conflict": return { cls: "warn", text: "Not saving" };
        case "paused": return { cls: "", text: "Saved on this device" };
        case "error": return { cls: "warn", text: "Not saved" };
    }
    return null;
}
function renderSaveChip() {
    const el = document.getElementById("saveChip");
    if (!el) return;
    const info = cloudUser && !accountNeedsVerify() && !accountNeedsUsername() ? saveChipInfo() : null;
    el.hidden = !info;
    if (!info) { closeSaveDetails(); return; }
    el.className = "save-chip " + info.cls;
    el.title = "Save details";
    el.setAttribute("aria-label", info.text + ". Show save details");
    el.innerHTML = gnIcon(info.icon || (info.cls === "warn" ? "warning" : info.cls === "busy" ? "cloud" : "check")) + "<span></span>";
    el.lastChild.textContent = info.text;
    renderSaveDetails();
}
// ── After closing a game: its save, in the bottom-right corner ──────────────
// The game bar (and its save chip) is gone once a game is closed, so this
// shows the closed game's save going up: waiting for the game to write its
// save, each step of the upload, then "Saved" (fades after a few seconds) or
// what went wrong and when it tries again.
let closeToast = null;   // { name, seq, hideTimer, done }
function showCloseSaveToast(name) {
    if (!cloudUser || accountNeedsVerify() || accountNeedsUsername()) return;
    let el = document.getElementById("closeSaveToast");
    if (!el) {
        el = document.createElement("div");
        el.id = "closeSaveToast";
        el.className = "close-save";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        el.innerHTML = `<div class="cs-icon"></div><div class="cs-main"><b class="cs-title"></b><span class="cs-line"></span><span class="sd-bar cs-bar" hidden><i></i></span></div>
            <button type="button" class="cs-act" hidden onclick="closeToastAction()"></button>
            <button type="button" class="cs-x" aria-label="Hide" onclick="hideCloseSaveToast()">×</button>`;
    }
    // In the same corner stack as the site's other messages, so they don't overlap
    let region = document.getElementById("toastRegion");
    if (!region) {
        region = document.createElement("div");
        region.id = "toastRegion";
        region.setAttribute("role", "status");
        region.setAttribute("aria-live", "polite");
        document.body.appendChild(region);
    }
    if (el.parentNode !== region) region.appendChild(el);
    if (closeToast) clearTimeout(closeToast.hideTimer);
    closeToast = { name: name || "your game", seq: cloudSaveState.seq || 0, hideTimer: null, done: false, waiting: true };
    el.classList.remove("cs-hide");
    requestAnimationFrame(() => el.classList.add("show"));
    renderCloseSaveToast();
}
function hideCloseSaveToast() {
    const el = document.getElementById("closeSaveToast");
    if (closeToast) clearTimeout(closeToast.hideTimer);
    closeToast = null;
    if (el) { el.classList.remove("show"); setTimeout(() => { if (!closeToast) { const reg = el.parentNode; el.remove(); if (reg && reg.id === "toastRegion") reg.style.bottom = ""; } }, 400); }
}
function closeToastAction() {
    const ph = cloudSaveState.phase;
    if (ph === "conflict") { hideCloseSaveToast(); openAccountPanel(); return; }
    if (closeToast) { closeToast.done = false; closeToast.seq = cloudSaveState.seq; clearTimeout(closeToast.hideTimer); }
    uploadCloudSave();
}
function renderCloseSaveToast() {
    const el = document.getElementById("closeSaveToast");
    if (!el || !closeToast) return;
    const s = cloudSaveState, t = closeToast;
    const fresh = (s.seq || 0) > t.seq;   // something happened since the game was closed
    let icon = "cloud", cls = "busy", title = `Saving ${t.name}`, line = "Waiting for the game to finish saving…", act = "", bar = null;
    if (fresh) {
        t.waiting = false;
        const mb = n => n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
        switch (s.phase) {
            case "saving":
                line = (Date.now() - s.stepAt > 20000 ? "Still going (slow connection): " : "") + (s.step || "Getting ready") + "…";
                if (s.parts) bar = s.part / s.parts;
                break;
            case "ok":
                icon = "check"; cls = "ok"; title = `${t.name} saved`;
                line = "Saved to your account" + (s.size ? ` · ${mb(s.size)}` : "") + ".";
                break;
            case "retry":
                icon = "warning"; cls = "warn"; title = `${t.name} isn't saved to your account yet`;
                line = (s.retryAt ? `Trying again in ${inText(s.retryAt - Date.now())}. ` : "It'll try again soon. ") + "Your progress is safe on this device.";
                act = "Try now";
                break;
            case "conflict":
                icon = "warning"; cls = "warn"; title = "Not saved to your account";
                line = "Another device saved to your account. Pick which progress to keep.";
                act = "Choose";
                break;
            case "paused":
                icon = "check"; cls = ""; title = `${t.name} saved on this device`;
                line = "Cloud saves are paused for today (the site's daily limit).";
                break;
            case "error":
                icon = "warning"; cls = "warn"; title = "Couldn't save to your account";
                line = s.error || "Something went wrong. Your progress is safe on this device.";
                act = "Try again";
                break;
        }
    }
    el.className = "close-save show " + cls;
    el.querySelector(".cs-icon").innerHTML = gnIcon(icon);
    el.querySelector(".cs-title").textContent = title;
    el.querySelector(".cs-line").textContent = line;
    const b = el.querySelector(".cs-bar");
    b.hidden = bar === null;
    if (bar !== null) b.firstChild.style.width = Math.round(bar * 100) + "%";
    const a = el.querySelector(".cs-act");
    a.hidden = !act; a.textContent = act;
    // The corner stack sits above the "Play next" bar while that's showing
    const pn = document.querySelector(".play-next.show"), region = el.parentNode;
    const r = pn && pn.getBoundingClientRect();
    if (region && region.id === "toastRegion") region.style.bottom = r ? Math.round(window.innerHeight - r.top + 10) + "px" : "";
    // Saved: fade out after a bit. Problems: stay longer, then get out of the way
    const final = fresh && s.phase !== "saving";
    if (final && !t.done) {
        t.done = true;
        clearTimeout(t.hideTimer);
        t.hideTimer = setTimeout(hideCloseSaveToast, s.phase === "ok" || s.phase === "paused" ? 4500 : 15000);
    } else if (!final && t.done) { t.done = false; clearTimeout(t.hideTimer); }
}
// The chip opens a small panel with where the save is at; it doesn't save
// anything by itself ("Save now" does)
function toggleSaveDetails(ev) {
    if (ev) ev.stopPropagation();
    if (document.getElementById("saveDetails")) return closeSaveDetails();
    const chip = document.getElementById("saveChip");
    if (!chip) return;
    const box = document.createElement("div");
    box.id = "saveDetails";
    box.className = "save-details";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Save details");
    document.body.appendChild(box);
    chip.setAttribute("aria-expanded", "true");
    renderSaveDetails();
    setTimeout(() => document.addEventListener("pointerdown", saveDetailsOutside, true), 0);
    document.addEventListener("keydown", saveDetailsKey, true);
}
function saveDetailsOutside(e) {
    const box = document.getElementById("saveDetails"), chip = document.getElementById("saveChip");
    if (box && !box.contains(e.target) && !(chip && chip.contains(e.target))) closeSaveDetails();
}
function saveDetailsKey(e) { if (e.key === "Escape") closeSaveDetails(); }
function closeSaveDetails() {
    const box = document.getElementById("saveDetails");
    if (box) box.remove();
    const chip = document.getElementById("saveChip");
    if (chip) chip.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", saveDetailsOutside, true);
    document.removeEventListener("keydown", saveDetailsKey, true);
}
function renderSaveDetails() {
    const box = document.getElementById("saveDetails"), chip = document.getElementById("saveChip");
    if (!box || !chip) return;
    const s = cloudSaveState, now = Date.now();
    const r = chip.getBoundingClientRect();
    // Under the chip, lined up with its left edge, kept on screen
    const w = box.offsetWidth || 330;
    box.style.top = Math.round(r.bottom + 8) + "px";
    box.style.left = Math.round(Math.min(Math.max(8, r.left), window.innerWidth - w - 8)) + "px";
    const mb = n => n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
    const head = {
        saving: ["busy", Date.now() - s.stepAt > 20000 ? "Still saving (slow connection)" : "Saving to your account"],
        ok: ["ok", "Saved to your account"],
        retry: ["warn", "Not saved yet"],
        conflict: ["warn", "Not saving to your account"],
        paused: ["", "Saved on this device only"],
        error: ["warn", "Not saved"]
    }[s.phase] || ["", "Cloud save"];
    const rows = [];
    if (s.phase === "saving") {
        rows.push(["Now", s.step || "Getting ready"]);
        if (s.parts) rows.push(["Progress", `<span class="sd-bar"><i style="width:${Math.round(s.part / s.parts * 100)}%"></i></span>`, true]);
        if (s.startedAt) rows.push(["Started", agoText(now - s.startedAt).replace("just now", "a moment ago")]);
    }
    if (s.phase === "retry") {
        if (s.error) rows.push(["What happened", escapeHtml(s.error), true]);
        rows.push(["Next try", s.retryAt ? "in " + inText(s.retryAt - now) : cloudBusy ? "now (waiting on the cloud)" : navigator.onLine === false ? "when you're back online" : "soon"]);
    }
    if (s.phase === "conflict") rows.push(["Why", "Another device saved to your account after this one. Open Account to pick which progress to keep."]);
    if (s.phase === "paused") rows.push(["Why", "The site used up today's cloud saves (Firebase's daily limit). They start again tomorrow."]);
    if (s.phase === "error") rows.push(["What happened", escapeHtml(s.error || "The cloud turned the save down without saying why. Your progress is safe on this device."), true]);
    if (typeof liveSaveStatusText === "function") { const t = liveSaveStatusText(); if (t) rows.push(["Live Save", escapeHtml(t), true]); }
    rows.push(["Last cloud save", s.lastAt ? `${new Date(s.lastAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${agoText(now - s.lastAt)})` : "not yet on this device"]);
    if (s.size) rows.push(["Size", mb(s.size)]);
    if (s.left && s.left.length) rows.push(["Too big for the cloud", s.left.map(l => `${l.files} item${l.files === 1 ? "" : "s"} from ${l.name} (${l.mb} MB)`).join(", ") + ". They stay on this device; the rest is in the cloud. These are usually a game's downloaded files, not saves."]);
    if (s.sum && typeof describeProgress === "function") rows.push(["What's saved", describeProgress(s.sum) + ", settings, favorites and game saves"]);
    if (cloudAutosaveTimer && s.phase !== "conflict" && s.phase !== "paused" && s.nextAt) rows.push(["Next autosave", "in " + inText(s.nextAt - now) + " (and when you close the game)"]);
    if (s.phase !== "conflict") rows.push(["On this device", "Your progress is always kept here too"]);
    // Built once, then only the text changes (so the buttons keep working while it updates)
    if (!box.querySelector(".sd-rows")) {
        box.innerHTML = `<div class="sd-head"></div><button type="button" class="sd-close" aria-label="Close" onclick="closeSaveDetails()">×</button>
            <dl class="sd-rows"></dl>
            <div class="sd-actions">
                <button type="button" class="sd-btn primary" onclick="saveNowFromDetails()"></button>
                <button type="button" class="sd-btn" onclick="closeSaveDetails(); openAccountPanel()">Account</button>
            </div>`;
    }
    const h = box.querySelector(".sd-head");
    h.className = "sd-head " + head[0];
    h.innerHTML = gnIcon(head[0] === "warn" ? "warning" : head[0] === "busy" ? "cloud" : "check") + `<b>${head[1]}</b>`;
    box.querySelector(".sd-rows").innerHTML = rows.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : escapeHtml(v)}</dd>`).join("");
    const go = box.querySelector(".sd-btn.primary");
    go.disabled = s.phase === "saving";
    go.textContent = s.phase === "saving" ? "Saving…" : s.phase === "conflict" ? "Choose which to keep" : "Save now";
}
function saveNowFromDetails() {
    if (cloudSaveState.phase === "conflict") { closeSaveDetails(); openAccountPanel(); return; }
    Promise.resolve(typeof syncOpenGameFiles === "function" ? syncOpenGameFiles() : null).catch(() => {}).then(() => uploadCloudSave());
}
// Keeps the times ("3 min ago", "retry in 20 s") current
setInterval(() => {
    if (document.hidden) return;
    const open = !!document.getElementById("saveDetails");
    if (open || cloudSaveState.phase !== "") renderSaveChip();
    if (closeToast) renderCloseSaveToast();
}, 1000);

// ── UI ──────────────────────────────────────────────────────────────────────
function setCloudStatus(text) {
    cloudStatus = text;
    const el = document.getElementById("acct-status");
    if (el) el.textContent = text;
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function openAccountPanel(mode) {
    document.getElementById("popupTitle").textContent = "Account";
    const body = document.getElementById("popupBody");
    if (!cloudAuth) {
        body.innerHTML = `<p>Accounts are still loading. Try again in a moment.</p>`;
    } else if (cloudUser) {
        if (accountNeedsUsername()) {
            body.innerHTML = `
            <p style="margin-top:0;">Signed in with Google as <b>${escapeHtml(cloudUser.email || "")}</b>. Pick a username for GN 2.0:</p>
            <label for="acct-pick-username" style="font-weight:bold;">Username</label><br>
            <input type="text" id="acct-pick-username" maxlength="20" autocomplete="username"><br><br>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                <button class="settings-button" onclick="cloudPickUsername()">Save username</button>
                <button class="settings-button" onclick="cloudAuth.signOut()">Cancel</button>
            </div>
            <p id="acct-msg" style="font-size:14px;color:#ef4444;"></p>`;
            body.querySelector("input").addEventListener("keydown", e => { if (e.key === "Enter") cloudPickUsername(); });
            body.contentEditable = false;
            document.getElementById("popupOverlay").style.display = "flex";
            return;
        }
        if (accountNeedsVerify()) {
            body.innerHTML = `
            <p style="margin-top:0;">Almost done, <b>${escapeHtml(currentUsername())}</b>!</p>
            <p>We sent a link to <b>${escapeHtml(cloudUser.email)}</b>. Click it to verify your email, then come back here. Check your spam folder if you don't see it.</p>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:1rem 0;">
                <button class="settings-button" onclick="cloudCheckVerified()">I clicked the link</button>
                <button class="settings-button" onclick="cloudResendVerify()">Send it again</button>
                <button class="settings-button" id="acct-signout" onclick="cloudAuth.signOut()">Sign out</button>
            </div>
            <p class="acct-hint">Cloud saves, ratings and reports start working once your email is verified.</p>`;
            body.contentEditable = false;
            document.getElementById("popupOverlay").style.display = "flex";
            return;
        }
        body.innerHTML = `
            <p style="margin-top:0;">Signed in as <b>${escapeHtml(currentUsername())}</b>${isLegacyAccount() ? "" : ` <span style="color:var(--text-muted);font-size:14px;">(${escapeHtml(cloudUser.email)})</span>`}</p>
            <p style="color:var(--text-muted);font-size:14px;">Game progress saves to the cloud every 2 minutes, when you close a game, and when you sign out.</p>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:1rem 0;">
                <button class="settings-button" onclick="confirmUploadCloudSave()">Save now</button>
                <button class="settings-button" onclick="confirmDownloadCloudSave()">Load cloud save</button>
                <button class="settings-button" onclick="openEarlierCloudSaves()" title="Cloud saves that were replaced in the last 7 days">Earlier cloud saves</button>
                <button class="settings-button" id="acct-signout" onclick="cloudSignOut()">Sign out</button>
            </div>
            ${typeof isSiteMod === "function" && isSiteMod() ? `<button class="settings-button" style="margin-bottom:1rem;" onclick="openAdminPanel()">${gnIcon("shield")} ${isSiteAdmin() ? "Admin" : "Mod"} Panel</button>` : ""}
            ${typeof myPerks === "function" && myPerks() ? `<button class="settings-button" style="margin-bottom:1rem;" onclick="openAbilitiesPanel()">${gnIcon("bolt")} Abilities</button>` : ""}
            <details class="acct-section">
                <summary>Google sign-in${hasGoogle() ? " (linked)" : ""}</summary>
                ${hasGoogle()
                    ? `<p class="acct-hint">Google is linked, so you can sign in with Google.</p>${hasPassword() ? `<button class="settings-button" onclick="cloudUnlinkGoogle()">Unlink Google</button>` : ""}`
                    : `<p class="acct-hint">Link your Google account to sign in with Google. If it doesn't work on your network, your normal sign-in still does.</p><button class="settings-button acct-google" onclick="cloudLinkGoogle()">Link Google account</button>`}
            </details>
            ${hasPassword() ? `<details class="acct-section">
                <summary>Change password</summary>
                <label for="acct-old-password">Current password</label>
                <input type="password" id="acct-old-password" autocomplete="current-password">
                <label for="acct-new-password">New password</label>
                <input type="password" id="acct-new-password" autocomplete="new-password" aria-describedby="acct-pw-hint">
                <label for="acct-new-password2">Confirm new password</label>
                <input type="password" id="acct-new-password2" autocomplete="new-password">
                <p id="acct-pw-hint" class="acct-hint">At least 6 characters.${isLegacyAccount() ? " Your account has no email yet, so there's no password reset: add an email below, or pick one you'll remember." : ""}</p>
                <button class="settings-button" onclick="cloudChangePassword()">Change password</button>
                <p id="acct-pw-msg" class="acct-msg" role="status"></p>
            </details>` : ""}
            ${!isLegacyAccount() && hasPassword() ? `<details class="acct-section" id="acct-chemail-section">
                <summary>Change email</summary>
                <p class="acct-hint">Your email is <b>${escapeHtml(cloudUser.email || "")}</b>. We'll send a link to the new one; it changes when you click it, and you sign in with the new email after that.</p>
                <label for="acct-new-email">New email</label>
                <input type="email" id="acct-new-email" autocomplete="email">
                <label for="acct-new-email-pw">Your password</label>
                <input type="password" id="acct-new-email-pw" autocomplete="current-password">
                <button class="settings-button" onclick="cloudChangeEmail()">Send link</button>
                <p id="acct-chemail-msg" class="acct-msg" role="status"></p>
            </details>` : ""}
            ${isLegacyAccount() ? `<details class="acct-section" id="acct-email-section">
                <summary>Add an email (for password resets)</summary>
                <p class="acct-hint">Add an email so you can reset your password if you forget it. We'll send a link to check it's yours. After you click it, you sign in with your email instead of your username; your username, saves and progress stay the same. Only the site's sign-in system keeps your email, and nobody else sees it.</p>
                <label for="acct-add-email">Email</label>
                <input type="email" id="acct-add-email" autocomplete="email">
                <label for="acct-add-email-pw">Your password</label>
                <input type="password" id="acct-add-email-pw" autocomplete="current-password">
                <button class="settings-button" onclick="cloudAddEmail()">Send link</button>
                <p id="acct-email-msg" class="acct-msg" role="status"></p>
            </details>` : ""}
            <details class="acct-section">
                <summary>Delete account</summary>
                <p class="acct-hint">This permanently deletes your account, its cloud save, and its ratings and reports. Game progress saved in this browser isn't touched.</p>
                ${hasPassword() ? `<label for="acct-delete-password">Confirm your password</label>
                <input type="password" id="acct-delete-password" autocomplete="current-password">` : `<p class="acct-hint">You'll confirm with Google.</p>`}
                <button class="settings-button" style="background:#b91c1c;" onclick="cloudDeleteAccount()">Delete my account</button>
            </details>
            <p id="acct-status" style="font-size:14px;color:var(--text-muted);"></p>`;
    } else {
        const create = mode === "create";
        body.innerHTML = `
            <p style="margin-top:0;color:var(--text-muted);font-size:14px;">${create
                ? "Pick a username and add your email. We'll send you a link to verify it, and it lets you reset your password if you forget it. Nobody else sees your email."
                : "Sign in to keep your game progress on any computer."}</p>
            <label for="acct-username" style="font-weight:bold;">${create ? "Username" : "Username or email"}</label><br>
            <input type="text" id="acct-username" autocomplete="username" maxlength="${create ? 20 : 120}"><br><br>
            ${create ? `<label for="acct-email" style="font-weight:bold;">Email</label><br>
            <input type="email" id="acct-email" autocomplete="email" maxlength="120"><br><br>` : ""}
            <label for="acct-password" style="font-weight:bold;">Password</label><br>
            <input type="password" id="acct-password" autocomplete="${create ? "new-password" : "current-password"}"><br><br>
            ${create ? `<label for="acct-password2" style="font-weight:bold;">Confirm password</label><br>
            <input type="password" id="acct-password2" autocomplete="new-password"><br><br>` : ""}
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                <button class="settings-button" onclick="cloudSignIn(${create})">${create ? "Create account" : "Sign in"}</button>
                <button class="settings-button" onclick="openAccountPanel('${create ? "signin" : "create"}')">${create ? "I have an account" : "Create an account"}</button>
            </div>
            ${create ? "" : `<p style="margin:0.6rem 0 0;font-size:14px;"><a href="#" onclick="cloudForgotPassword(); return false;">Forgot password?</a> <span style="color:var(--text-muted);">(accounts with an email)</span></p>`}
            <div style="margin-top:0.9rem;">${GOOGLE_BUTTON(create ? "Sign up with Google" : "Sign in with Google")}</div>
            <p id="acct-msg" style="font-size:14px;color:#ef4444;"></p>`;
        body.querySelectorAll("input").forEach(inp => inp.addEventListener("keydown", e => {
            if (e.key === "Enter") cloudSignIn(create);
        }));
    }
    setCloudStatus(cloudStatus);
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
}
function updateAccountButton() {
    const btn = document.getElementById("accountButton");
    if (!btn) return;
    btn.style.display = FIREBASE_CONFIG ? "" : "none";
    btn.title = cloudUser ? `Account: ${currentUsername()}` : "Sign in / create account";
    btn.classList.toggle("signed-in", !!cloudUser);
}

// ── Startup ─────────────────────────────────────────────────────────────────
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("couldn't load " + src));
        document.head.appendChild(s);
    });
}
async function initCloudAccounts() {
    updateAccountButton();
    if (!FIREBASE_CONFIG) return;
    try {
        const base = `https://www.gstatic.com/firebasejs/${CLOUD.sdkVersion}`;
        await loadScript(`${base}/firebase-app-compat.js`);
        await Promise.all([loadScript(`${base}/firebase-auth-compat.js`), loadScript(`${base}/firebase-firestore-compat.js`)]);
        firebase.initializeApp(FIREBASE_CONFIG);
        cloudAuth = firebase.auth();
        cloudDb = firebase.firestore();
        countFirestoreUse();
        cloudAuth.onAuthStateChanged(async user => {
            // Put back a username that Google's name replaced (before anything uses it)
            if (user && !isLegacyAccount(user) && !currentUsernameOf(user)) {
                try { if (await repairUsername(user)) { try { await user.reload(); } catch {} user = cloudAuth.currentUser || user; } } catch {}
            }
            if (user) { rememberUsername(user); rememberLogin(user); }
            const wasSignedIn = !!cloudUser;
            cloudUser = user;
            updateAccountButton();
            // An account the owner let in gets past the closed screen
            if (typeof applyOwnerSiteMode === "function") applyOwnerSiteMode();
            if (typeof syncMyProfileAndRoles === "function") syncMyProfileAndRoles(user);
            clearInterval(cloudAutosaveTimer); cloudAutosaveTimer = null;
            clearTimeout(cloudRetryTimer); cloudRetryTimer = null; cloudRetryDelay = 0;
            if (user && (accountNeedsVerify(user) || accountNeedsUsername(user))) {
                // New account waiting on its email link or a username: nothing syncs until then
                setCloudStatus(accountNeedsUsername(user) ? "Pick a username to finish your account (Account)." : "Verify your email to turn on cloud saves (Account).");
                if (accountNeedsUsername(user)) setTimeout(() => openAccountPanel(), 200);
            } else if (user) {
                startCloudAutosave();
                cloudSyncOnSignIn();
                // Accounts from before emails: say once that they can add one now
                if (isLegacyAccount(user)) {
                    const k = "gnmath-email-nudge-" + user.uid;
                    let seen = "";
                    try { seen = localStorage.getItem(k) || ""; } catch {}
                    if (!seen) {
                        try { localStorage.setItem(k, "shown"); } catch {}
                        setTimeout(() => notify("New: you can add an email to your account, so you can reset your password if you forget it. Open Account → Add an email.", { duration: 12000 }), 4000);
                    }
                }
            } else {
                cloudStatus = "";
            }
            if (document.getElementById("popupTitle").textContent === "Account" &&
                document.getElementById("popupOverlay").style.display === "flex") {
                openAccountPanel();
            }
            if (!user) { Object.assign(cloudSaveState, { phase: "", okAt: 0, lastAt: 0, size: 0, sum: null, error: "", retryAt: 0 }); try { localStorage.removeItem(SAVE_INFO_KEY); } catch {} }
            renderSaveChip();
            if (wasSignedIn && !user) {
                localStorage.removeItem(CLOUD.keys.syncedGen);
                localStorage.removeItem(CLOUD.keys.syncedHash);
            }
        });
        // Save when a game is closed
        const originalCloseZone = closeZone;
        // (after the game has written its last progress: retireGameFrame in app.js)
        closeZone = function () {
            let name = "";
            try { if (zoneViewer.style.display !== "none") name = (document.getElementById("zoneName").textContent || "").trim(); } catch {}
            const r = originalCloseZone.apply(this, arguments);
            if (cloudUser && name) showCloseSaveToast(name);
            if (cloudUser) Promise.race([Promise.resolve(window.gnGameFlush), new Promise(res => setTimeout(res, 4000))]).then(() => uploadCloudSave());
            return r;
        };
    } catch (e) {
        console.error("Accounts failed to start", e);
        cloudStatus = "Accounts couldn't load: " + (e.message || e);
    }
}
initCloudAccounts();

// After loading the Firebase copy of a save because the GN 2.0 Server was down
// (downloadCloudSave), say so once the page has reloaded
setTimeout(() => {
    try {
        const note = sessionStorage.getItem("gnmath-cloud-backup-note");
        if (note && typeof notify === "function") { sessionStorage.removeItem("gnmath-cloud-backup-note"); notify(note, { duration: 15000 }); }
    } catch {}
}, 1500);
