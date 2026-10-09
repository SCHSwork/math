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
    chunkChars: 900000,                      // Firestore docs max out at ~1 MB
    maxChars: 18000000,                      // ~18 MB compressed cap per save
    keys: {
        syncedGen: "gnmath-cloud-synced-gen",
        syncedHash: "gnmath-cloud-synced-hash"
    }
};
let cloudAuth = null, cloudDb = null, cloudUser = null;
let cloudBusy = false, cloudStatus = "", cloudAutosaveTimer = null;

// ── What goes into a save ────────────────────────────────────────────────────
function isCloudExcludedStorageKey(key) {
    return isProtectedStorageKey(key) || key.startsWith("gnmath-cloud-") || key.startsWith("gnmath-cache-") || key.startsWith("firebase:");
}
function isCloudExcludedDb(name) {
    // Firebase's own login/cache databases, and Unity's download cache (game files, not progress)
    return /^firebase|^firestore\//i.test(name) || name === "UnityCache";
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

// ── Firestore: saves/{uid} holds meta, saves/{uid}/chunks/{gen}_{i} hold data ─
function saveDocRef() { return cloudDb.collection("saves").doc(cloudUser.uid); }
async function fetchCloudMeta() {
    const snap = await saveDocRef().get();
    return snap.exists ? snap.data() : null;
}
async function uploadCloudSave({ force = false } = {}) {
    if (!cloudUser || cloudBusy) return false;
    cloudBusy = true;
    try {
        setCloudStatus("Saving…");
        const json = JSON.stringify(await collectCloudBundle());
        const hash = await sha256Hex(json);
        const meta = await fetchCloudMeta();
        const localGen = localStorage.getItem(CLOUD.keys.syncedGen);
        if (meta && meta.gen !== localGen && !force) {
            // Someone saved from another device since this device last synced.
            setCloudStatus("Another device saved newer progress — open Account to choose which to keep.");
            return false;
        }
        if (meta && meta.hash === hash) {
            localStorage.setItem(CLOUD.keys.syncedHash, hash);
            setCloudStatus("Up to date — " + new Date().toLocaleTimeString());
            return true;
        }
        const packed = await gzipToB64(json);
        if (packed.length > CLOUD.maxChars) {
            setCloudStatus(`Save is too big for the cloud (${(packed.length / 1e6).toFixed(1)} MB).`);
            return false;
        }
        const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const chunkCount = Math.max(1, Math.ceil(packed.length / CLOUD.chunkChars));
        const chunks = saveDocRef().collection("chunks");
        for (let i = 0; i < chunkCount; i++) {
            await chunks.doc(`${gen}_${i}`).set({ d: packed.slice(i * CLOUD.chunkChars, (i + 1) * CLOUD.chunkChars) });
        }
        await saveDocRef().set({
            gen, chunkCount, hash,
            size: packed.length,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        localStorage.setItem(CLOUD.keys.syncedGen, gen);
        localStorage.setItem(CLOUD.keys.syncedHash, hash);
        if (meta && meta.gen) {
            for (let i = 0; i < (meta.chunkCount || 0); i++) {
                chunks.doc(`${meta.gen}_${i}`).delete().catch(() => {});
            }
        }
        setCloudStatus("Saved to cloud — " + new Date().toLocaleTimeString());
        return true;
    } catch (e) {
        console.error("Cloud save failed", e);
        setCloudStatus("Cloud save failed: " + (e.message || e));
        return false;
    } finally {
        cloudBusy = false;
    }
}
async function downloadCloudSave() {
    if (!cloudUser || cloudBusy) return false;
    cloudBusy = true;
    try {
        setCloudStatus("Loading cloud save…");
        const meta = await fetchCloudMeta();
        if (!meta) { setCloudStatus("No cloud save yet."); return false; }
        const chunks = saveDocRef().collection("chunks");
        const parts = await Promise.all(
            Array.from({ length: meta.chunkCount }, (_, i) => chunks.doc(`${meta.gen}_${i}`).get())
        );
        if (parts.some(p => !p.exists)) throw new Error("cloud save is incomplete, try again");
        const json = await b64ToText(parts.map(p => p.data().d).join(""));
        if (typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex") closeZone();
        await applyCloudBundle(JSON.parse(json));
        localStorage.setItem(CLOUD.keys.syncedGen, meta.gen);
        localStorage.setItem(CLOUD.keys.syncedHash, meta.hash);
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
        const meta = await fetchCloudMeta();
        const localGen = localStorage.getItem(CLOUD.keys.syncedGen);
        if (!meta) { await uploadCloudSave({ force: true }); return; }
        if (meta.gen === localGen) { await uploadCloudSave(); return; }
        const when = meta.updatedAt && meta.updatedAt.toDate ? meta.updatedAt.toDate().toLocaleString() : "earlier";
        const choice = await askChoice(
            `Your account has game progress saved on ${when}, and this device has its own. Which do you want to keep?`, {
                title: "Pick which progress to keep",
                choices: [
                    { value: "device", label: "Keep this device's" },
                    { value: "cloud", label: "Load my cloud save", primary: true }
                ]
            });
        if (choice === "cloud") await downloadCloudSave();
        else if (choice === "device") await uploadCloudSave({ force: true });
        else setCloudStatus("Not synced yet. Open Account to choose which progress to keep.");
    } catch (e) {
        console.error(e);
        setCloudStatus("Couldn't reach the cloud: " + (e.message || e));
    }
}

// ── Accounts ────────────────────────────────────────────────────────────────
function normalizeUsername(raw) { return (raw || "").trim().toLowerCase(); }
function usernameToEmail(u) { return `${u}@${CLOUD.usernameDomain}`; }
function currentUsername() { return cloudUser && cloudUser.email ? cloudUser.email.split("@")[0] : ""; }
function friendlyAuthError(e) {
    const code = (e && e.code) || "";
    if (code.includes("email-already-in-use")) return "That username is taken.";
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Wrong username or password.";
    if (code.includes("weak-password")) return "Password needs at least 6 characters.";
    if (code.includes("too-many-requests")) return "Too many tries. Wait a bit and try again.";
    if (code.includes("network")) return "Couldn't connect. Check your internet.";
    return (e && e.message) || "Something went wrong.";
}
async function cloudSignIn(create) {
    const u = normalizeUsername(document.getElementById("acct-username")?.value);
    const p = document.getElementById("acct-password")?.value || "";
    const msg = document.getElementById("acct-msg");
    const say = t => { if (msg) msg.textContent = t; };
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return say("Username: 3–20 letters, numbers, or _");
    if (p.length < 6) return say("Password needs at least 6 characters.");
    if (create && p !== (document.getElementById("acct-password2")?.value || "")) return say("Passwords don't match.");
    say(create ? "Creating account…" : "Signing in…");
    try {
        if (create) await cloudAuth.createUserWithEmailAndPassword(usernameToEmail(u), p);
        else await cloudAuth.signInWithEmailAndPassword(usernameToEmail(u), p);
    } catch (e) {
        say(friendlyAuthError(e));
    }
}
async function cloudSignOut() {
    if (!(await askConfirm("Your progress will be saved to the cloud first.", { title: "Sign out?", confirmText: "Sign out" }))) return;
    await uploadCloudSave();
    await cloudAuth.signOut();
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
    if (!pw) { setCloudStatus("Enter your password to delete your account."); return; }
    if (!(await askConfirm(`This permanently deletes "${currentUsername()}", its cloud save, its ratings and reports, and its game submissions. It can't be undone.`, { title: "Delete account?", confirmText: "Delete account", danger: true }))) return;
    try {
        setCloudStatus("Deleting…");
        clearInterval(cloudAutosaveTimer);
        // Firebase requires a fresh sign-in before deleting an account.
        await cloudUser.reauthenticateWithCredential(
            firebase.auth.EmailAuthProvider.credential(cloudUser.email, pw)
        );
        cloudBusy = true;
        const chunks = await saveDocRef().collection("chunks").get();
        await Promise.all(chunks.docs.map(d => d.ref.delete()));
        if (typeof removeMyGameStats === "function") await removeMyGameStats(cloudUser.uid);
        try { await cloudDb.collection("profiles").doc(cloudUser.uid).delete(); } catch (e) {}
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
        if (cloudUser) cloudAutosaveTimer = setInterval(() => { if (!document.hidden) uploadCloudSave(); }, CLOUD.autosaveMs);
    } finally {
        cloudBusy = false;
    }
}

async function confirmUploadCloudSave() {
    if (await askConfirm("This device's progress will replace your cloud save.", { title: "Save to cloud?", confirmText: "Save now" })) uploadCloudSave({ force: true });
}
async function confirmDownloadCloudSave() {
    if (await askConfirm("Your cloud save will replace this device's game progress.", { title: "Load cloud save?", confirmText: "Load cloud save" })) downloadCloudSave();
}

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
        body.innerHTML = `
            <p style="margin-top:0;">Signed in as <b>${escapeHtml(currentUsername())}</b></p>
            <p style="color:var(--text-muted);font-size:14px;">Game progress saves to the cloud every 2 minutes, when you close a game, and when you sign out.</p>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin:1rem 0;">
                <button class="settings-button" onclick="confirmUploadCloudSave()">Save now</button>
                <button class="settings-button" onclick="confirmDownloadCloudSave()">Load cloud save</button>
                <button class="settings-button" onclick="cloudSignOut()">Sign out</button>
            </div>
            ${typeof isSiteAdmin === "function" && isSiteAdmin() ? `<button class="settings-button" style="margin-bottom:1rem;" onclick="openAdminPanel()">🛡️ Admin Panel</button>` : ""}
            <details class="acct-section">
                <summary>Change password</summary>
                <label for="acct-old-password">Current password</label>
                <input type="password" id="acct-old-password" autocomplete="current-password">
                <label for="acct-new-password">New password</label>
                <input type="password" id="acct-new-password" autocomplete="new-password" aria-describedby="acct-pw-hint">
                <label for="acct-new-password2">Confirm new password</label>
                <input type="password" id="acct-new-password2" autocomplete="new-password">
                <p id="acct-pw-hint" class="acct-hint">At least 6 characters. There's no password reset, so pick one you'll remember.</p>
                <button class="settings-button" onclick="cloudChangePassword()">Change password</button>
                <p id="acct-pw-msg" class="acct-msg" role="status"></p>
            </details>
            <details class="acct-section">
                <summary>Delete account</summary>
                <p class="acct-hint">This permanently deletes your account, its cloud save, and its ratings and reports. Game progress saved in this browser isn't touched.</p>
                <label for="acct-delete-password">Confirm your password</label>
                <input type="password" id="acct-delete-password" autocomplete="current-password">
                <button class="settings-button" style="background:#b91c1c;" onclick="cloudDeleteAccount()">Delete my account</button>
            </details>
            <p id="acct-status" style="font-size:14px;color:var(--text-muted);"></p>`;
    } else {
        const create = mode === "create";
        body.innerHTML = `
            <p style="margin-top:0;color:var(--text-muted);font-size:14px;">${create
                ? "Pick a username. No email needed — but there's <b>no password reset</b>, so remember your password."
                : "Sign in to keep your game progress on any computer."}</p>
            <label for="acct-username" style="font-weight:bold;">Username</label><br>
            <input type="text" id="acct-username" autocomplete="username" maxlength="20"><br><br>
            <label for="acct-password" style="font-weight:bold;">Password</label><br>
            <input type="password" id="acct-password" autocomplete="${create ? "new-password" : "current-password"}"><br><br>
            ${create ? `<label for="acct-password2" style="font-weight:bold;">Confirm password</label><br>
            <input type="password" id="acct-password2" autocomplete="new-password"><br><br>` : ""}
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                <button class="settings-button" onclick="cloudSignIn(${create})">${create ? "Create account" : "Sign in"}</button>
                <button class="settings-button" onclick="openAccountPanel('${create ? "signin" : "create"}')">${create ? "I have an account" : "Create an account"}</button>
            </div>
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
        cloudAuth.onAuthStateChanged(user => {
            const wasSignedIn = !!cloudUser;
            cloudUser = user;
            updateAccountButton();
            if (typeof syncMyProfileAndRoles === "function") syncMyProfileAndRoles(user);
            clearInterval(cloudAutosaveTimer);
            if (user) {
                cloudAutosaveTimer = setInterval(() => { if (!document.hidden) uploadCloudSave(); }, CLOUD.autosaveMs);
                cloudSyncOnSignIn();
            } else {
                cloudStatus = "";
            }
            if (document.getElementById("popupTitle").textContent === "Account" &&
                document.getElementById("popupOverlay").style.display === "flex") {
                openAccountPanel();
            }
            if (wasSignedIn && !user) {
                localStorage.removeItem(CLOUD.keys.syncedGen);
                localStorage.removeItem(CLOUD.keys.syncedHash);
            }
        });
        // Save when a game is closed
        const originalCloseZone = closeZone;
        closeZone = function () { originalCloseZone.apply(this, arguments); uploadCloudSave(); };
    } catch (e) {
        console.error("Accounts failed to start", e);
        cloudStatus = "Accounts couldn't load: " + (e.message || e);
    }
}
initCloudAccounts();
