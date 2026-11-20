// GN 2.0 Server (data.learnresearch.org). Runs in the gn-home VM behind a
// Cloudflare tunnel, on 127.0.0.1:8080, kept running by pm2 ("gn-data").
// Update it with:  curl -sL raw.githubusercontent.com/SCHSwork/math/main/server/i.sh | bash
//
//   GET  /health                         alive check
//   GET  /api/status                     uptime, cache, saves, sync
//   GET  /gh/:owner/:repo@:ref/:path     backup game-file source (cached copy of GitHub)
//   POST /api/play                       count a play  {id, v}
//   GET  /api/plays?period=day|week|month|year
//   GET|HEAD|PUT|DELETE /api/saves/:uid/:kind/:name   cloud save parts (Firebase sign-in required)
//   DELETE /api/saves/:uid/              all of a player's save parts
//
// Cloud saves are synced with Firebase every 30 minutes, both ways, once a
// Firebase service account key is at ~/gn-data/firebase-key.json.
"use strict";
const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const os = require("os");

const ROOT = __dirname;
const DATA = p => path.join(ROOT, p);
const PROJECT_ID = "gn-math-dfd85";
const KEY_FILE = DATA("firebase-key.json");
const CACHE_DIR = DATA("cache/gh");
const SAVES_DIR = DATA("saves");
const STATE_DIR = DATA("state");
const BACKUP_DIR = DATA("backups");
const CACHE_MAX_BYTES = 40 * 1024 ** 3;
const SAVE_QUOTA = 60 * 1024 * 1024;
const BRANCH_TTL_MS = 10 * 60 * 1000;
const SYNC_EVERY_MS = 30 * 60 * 1000;
for (const d of [CACHE_DIR, SAVES_DIR, STATE_DIR, BACKUP_DIR, DATA("public")]) fs.mkdirSync(d, { recursive: true });
const started = Date.now();
const log = (...a) => console.log(new Date().toISOString(), ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = async (f, v) => { await fsp.writeFile(f + ".tmp", JSON.stringify(v)); await fsp.rename(f + ".tmp", f); };
async function writeAtomic(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
}
const exists = f => fsp.stat(f).then(s => s, () => null);

// ── Firebase ────────────────────────────────────────────────────────────────
const admin = require("firebase-admin");
const hasKey = fs.existsSync(KEY_FILE);
admin.initializeApp(hasKey ? { credential: admin.credential.cert(readJson(KEY_FILE, {})), projectId: PROJECT_ID } : { projectId: PROJECT_ID });
const db = hasKey ? admin.firestore() : null;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// ── Live stats for the status page (schswork.github.io/Homework-/server.html) ─
// Requests are counted per minute; the last 24 hours are kept in /api/history.
const HISTORY_FILE = path.join(STATE_DIR, "history.json");
const history = readJson(HISTORY_FILE, []).filter(p => p && Date.now() - p.t < 86400000);
const events = readJson(path.join(STATE_DIR, "events.json"), []).slice(-50);
function event(kind, text) {
    events.push({ t: Date.now(), kind, text });
    while (events.length > 50) events.shift();
    writeJson(path.join(STATE_DIR, "events.json"), events).catch(() => {});
}
const blankMinute = () => ({ t: Math.floor(Date.now() / 60000) * 60000, req: 0, saves: 0, gh: 0, plays: 0, bytes: 0, errors: 0, msTotal: 0 });
let minute = blankMinute();
function rollMinute() {
    const m = minute;
    minute = blankMinute();
    history.push({ t: m.t, req: m.req, saves: m.saves, gh: m.gh, plays: m.plays, bytes: m.bytes, errors: m.errors, ms: m.req ? Math.round(m.msTotal / m.req) : 0 });
    while (history.length && Date.now() - history[0].t > 86400000) history.shift();
}
setTimeout(() => { rollMinute(); setInterval(rollMinute, 60000); }, 60000 - (Date.now() % 60000));
setInterval(() => writeJson(HISTORY_FILE, history).catch(() => {}), 5 * 60000);
app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on("finish", () => {
        if (req.path.startsWith("/api/status") || req.path === "/api/history") return;   // the status page itself
        minute.req++;
        minute.msTotal += Number(process.hrtime.bigint() - t0) / 1e6;
        minute.bytes += Number(res.getHeader("content-length") || 0);
        if (res.statusCode >= 500) minute.errors++;
        if (req.path.startsWith("/api/saves")) minute.saves++;
        else if (req.path.startsWith("/gh/")) minute.gh++;
        else if (req.path === "/api/play") minute.plays++;
    });
    next();
});
app.use((req, res, next) => {
    res.set({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range",
        "Access-Control-Max-Age": "86400"
    });
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.get("/health", (req, res) => { res.set("Cache-Control", "no-store"); res.json({ ok: true, time: Date.now() }); });

// ── Backup game-file source: /gh/owner/repo@ref/path ────────────────────────
const TYPES = { ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript", ".gz": "application/octet-stream", ".br": "application/octet-stream",
    ".unityweb": "application/octet-stream", ".data": "application/octet-stream", ".pck": "application/octet-stream", ".mem": "application/octet-stream" };
const inflight = new Map();
let active = 0; const queue = [];
const slot = () => new Promise(r => { if (active < 6) { active++; r(); } else queue.push(r); });
const release = () => { const n = queue.shift(); if (n) n(); else active--; };
async function fetchToCache(url, file) {
    if (inflight.has(file)) return inflight.get(file);
    const job = (async () => {
        await slot();
        try {
            const res = await fetch(url, { redirect: "follow" });
            if (res.status === 404) return 404;
            if (!res.ok) return res.status >= 500 ? 502 : res.status;
            await writeAtomic(file, Buffer.from(await res.arrayBuffer()));
            return 200;
        } finally { release(); }
    })().finally(() => inflight.delete(file));
    inflight.set(file, job);
    return job;
}
app.use("/gh", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.sendStatus(405);
    let p; try { p = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
    const m = /^\/([\w.-]+)\/([\w.-]+?)@([\w.\-\/]+?)\/(.+)$/.exec(p);
    if (!m || p.includes("..") || p.includes("\0")) return res.sendStatus(400);
    const [, owner, repo, ref, file] = m;
    const sha = /^[0-9a-f]{40}$/.test(ref);
    const local = path.join(CACHE_DIR, owner, repo, ref.replace(/\//g, "__"), file);
    if (!local.startsWith(CACHE_DIR + path.sep)) return res.sendStatus(400);
    let st = await exists(local);
    if (!st || (!sha && Date.now() - st.mtimeMs > BRANCH_TTL_MS)) {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref === "latest" ? "HEAD" : ref}/${file.split("/").map(encodeURIComponent).join("/")}`;
        let code = 502;
        try { code = await fetchToCache(url, local); } catch (e) { log("gh fetch failed", url, e.message); }
        if (code !== 200 && !st) return res.sendStatus(code === 404 ? 404 : 502);
        if (code === 404) { fsp.unlink(local).catch(() => {}); return res.sendStatus(404); }
        st = await exists(local);
    }
    fsp.utimes(local, new Date(), st.mtime).catch(() => {});
    const type = TYPES[path.extname(local).toLowerCase()];
    res.sendFile(local, {
        headers: { "Cache-Control": sha ? "public, max-age=31536000, immutable" : "public, max-age=600", ...(type ? { "Content-Type": type } : {}) },
        dotfiles: "allow"
    });
});
async function walk(dir, out = []) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) await walk(f, out);
        else { const s = await exists(f); if (s) out.push({ f, size: s.size, at: s.atimeMs, m: s.mtimeMs }); }
    }
    return out;
}
let cacheStats = { files: 0, bytes: 0 };
async function trimCache() {
    const all = await walk(CACHE_DIR);
    let total = all.reduce((n, x) => n + x.size, 0);
    if (total > CACHE_MAX_BYTES) {
        all.sort((a, b) => a.at - b.at);
        for (const x of all) { if (total <= CACHE_MAX_BYTES * 0.9) break; await fsp.unlink(x.f).catch(() => {}); total -= x.size; x.gone = true; }
    }
    const left = all.filter(x => !x.gone);
    cacheStats = { files: left.length, bytes: left.reduce((n, x) => n + x.size, 0) };
}

// ── Play counts ─────────────────────────────────────────────────────────────
const PLAYS_FILE = path.join(STATE_DIR, "plays.json");
const plays = readJson(PLAYS_FILE, {});           // { "2026-11-20": { "123": 4 } }
const recent = new Map();                          // v|id -> time
let playsDirty = false;
const today = () => new Date().toISOString().slice(0, 10);
app.post("/api/play", express.text({ type: "*/*", limit: "2kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    let b; try { b = JSON.parse(req.body || "{}"); } catch { return res.sendStatus(400); }
    const id = String(b.id || "").slice(0, 40), v = String(b.v || "").slice(0, 40);
    if (!/^[\w.-]+$/.test(id)) return res.sendStatus(400);
    const key = v + "|" + id, now = Date.now();
    if (v && now - (recent.get(key) || 0) < 30 * 60 * 1000) return res.sendStatus(204);
    if (v) recent.set(key, now);
    const d = (plays[today()] = plays[today()] || {});
    d[id] = (d[id] || 0) + 1;
    playsDirty = true;
    res.sendStatus(204);
});
app.get("/api/plays", (req, res) => {
    const days = { day: 1, week: 7, month: 30, year: 365 }[req.query.period] || 7;
    const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10), out = {};
    for (const [day, m] of Object.entries(plays)) if (day >= from) for (const [id, n] of Object.entries(m)) out[id] = (out[id] || 0) + n;
    res.set("Cache-Control", "public, max-age=300");
    res.json(out);
});
setInterval(() => {
    if (playsDirty) { playsDirty = false; writeJson(PLAYS_FILE, plays).catch(e => log("plays save failed", e.message)); }
    const cut = Date.now() - 30 * 60 * 1000;
    for (const [k, t] of recent) if (t < cut) recent.delete(k);
    const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    for (const day of Object.keys(plays)) if (day < old) delete plays[day];
}, 60000);

// ── Cloud saves ─────────────────────────────────────────────────────────────
const UID_RE = /^[A-Za-z0-9]{1,128}$/, NAME_RE = /^[A-Za-z0-9_-]{1,120}$/, KINDS = new Set(["chunks", "blobs"]);
const usage = new Map();                           // uid -> bytes
const dirtyUids = new Set(readJson(path.join(STATE_DIR, "dirty.json"), []));
const saveDirtyUids = () => writeJson(path.join(STATE_DIR, "dirty.json"), [...dirtyUids]).catch(() => {});
async function uidBytes(uid) {
    if (!usage.has(uid)) usage.set(uid, (await walk(path.join(SAVES_DIR, uid))).reduce((n, x) => n + x.size, 0));
    return usage.get(uid);
}
async function authed(req, uid) {
    const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    if (!m) return 401;
    try { const t = await admin.auth().verifyIdToken(m[1]); return t.uid === uid ? 0 : 403; }
    catch { return 401; }
}
app.use("/api/saves", express.text({ type: "*/*", limit: "1100kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        const parts = req.path.split("/").filter(Boolean);
        const [uid, kind, name] = parts;
        if (!uid || !UID_RE.test(uid)) return res.sendStatus(400);
        const bad = await authed(req, uid);
        if (bad) return res.sendStatus(bad);
        if (parts.length === 1) {                      // the whole account
            if (req.method !== "DELETE") return res.sendStatus(405);
            await fsp.rm(path.join(SAVES_DIR, uid), { recursive: true, force: true });
            usage.delete(uid);
            return res.sendStatus(200);
        }
        if (parts.length !== 3 || !KINDS.has(kind) || !NAME_RE.test(name)) return res.sendStatus(400);
        const file = path.join(SAVES_DIR, uid, kind, name);
        if (req.method === "GET" || req.method === "HEAD") {
            const st = await exists(file);
            if (!st) return res.sendStatus(404);
            if (req.method === "HEAD") return res.set("Content-Length", String(st.size)).status(200).end();
            res.type("text/plain");
            return res.send(await fsp.readFile(file, "utf8"));
        }
        if (req.method === "PUT") {
            const body = typeof req.body === "string" ? req.body : "";
            if (!body) return res.sendStatus(400);
            const old = await exists(file);
            const now = await uidBytes(uid) - (old ? old.size : 0) + Buffer.byteLength(body);
            if (now > SAVE_QUOTA) return res.sendStatus(413);
            await writeAtomic(file, body);
            usage.set(uid, now);
            dirtyUids.add(uid); saveDirtyUids();
            return res.sendStatus(200);
        }
        if (req.method === "DELETE") {
            const old = await exists(file);
            if (!old) return res.sendStatus(404);
            await fsp.unlink(file);
            usage.set(uid, Math.max(0, (await uidBytes(uid)) - old.size));
            return res.sendStatus(200);
        }
        res.sendStatus(405);
    } catch (e) {
        log("saves error", e.message);
        res.sendStatus(500);
    }
});

// ── Two-way sync with Firebase (needs firebase-key.json) ────────────────────
// For every save that changed (in Firebase, or written here) since the last
// sync: every part the save record points at (current save, earlier kept
// saves, the Firebase copy) is made to exist in both places. Then fbCopy is
// set to the current save, so the site knows Firebase has the newest one.
const SYNC_FILE = path.join(STATE_DIR, "sync.json");
const syncState = readJson(SYNC_FILE, { lastSync: 0, known: {} });   // known[uid] = [part names known to be in Firebase]
let syncStatus = { enabled: !!db, running: false, lastSync: syncState.lastSync || null, lastResult: hasKey ? "not run yet" : "no firebase-key.json", partsUp: 0, partsDown: 0 };
function partsOf(rec) {
    const out = [];
    const add = s => {
        if (!s || !s.gen) return;
        for (let i = 0; i < (s.chunkCount || 0); i++) out.push(["chunks", `${s.gen}_${i}`]);
        for (const b of Array.isArray(s.blobs) ? s.blobs : []) if (b && b.id) for (let j = 0; j < (b.n || 1); j++) out.push(["blobs", `${b.id}_${j}`]);
    };
    add(rec); (Array.isArray(rec.kept) ? rec.kept : []).forEach(add); add(rec.fbCopy);
    const seen = new Set();
    return out.filter(([k, n]) => !seen.has(k + "/" + n) && seen.add(k + "/" + n));
}
async function syncUid(uid, counts) {
    const ref = db.collection("saves").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return;
    const rec = snap.data();
    const known = new Set(syncState.known[uid] || []);
    const need = partsOf(rec);
    const current = new Set(partsOf({ gen: rec.gen, chunkCount: rec.chunkCount, blobs: rec.blobs }).map(([k, n]) => k + "/" + n));
    let currentInFb = true;
    const check = [];
    for (const [kind, name] of need) {
        const local = await exists(path.join(SAVES_DIR, uid, kind, name));
        if (local && known.has(kind + "/" + name)) continue;
        check.push({ kind, name, local });
    }
    // Which parts Firebase has: asked without their contents (a field mask),
    // so checking is cheap. Parts are up to ~500 KB each, so the ones to
    // download are fetched a few at a time.
    for (let i = 0; i < check.length; i += 100) {
        const group = check.slice(i, i + 100);
        const snaps = await db.getAll(...group.map(c => ref.collection(c.kind).doc(c.name)), { fieldMask: [] });
        group.forEach((c, k) => { c.inFb = snaps[k].exists; });
    }
    const downloads = check.filter(c => c.inFb && !c.local);
    for (let i = 0; i < downloads.length; i += 3) {
        await Promise.all(downloads.slice(i, i + 3).map(async c => {
            const s = await ref.collection(c.kind).doc(c.name).get();
            const d = s.exists ? s.data().d : null;
            if (typeof d === "string") { await writeAtomic(path.join(SAVES_DIR, uid, c.kind, c.name), d); counts.down++; }
        }));
    }
    for (const c of check) {
        const key = c.kind + "/" + c.name, file = path.join(SAVES_DIR, uid, c.kind, c.name);
        {
            if (c.inFb) {
                known.add(key);
            } else if (c.local) {
                await ref.collection(c.kind).doc(c.name).set({ d: await fsp.readFile(file, "utf8") });
                known.add(key); counts.up++;
            } else if (current.has(key)) currentInFb = false;   // in neither place
        }
    }
    for (const key of current) if (!known.has(key)) currentInFb = false;
    if (currentInFb && rec.gen && (!rec.fbCopy || rec.fbCopy.gen !== rec.gen)) {
        await db.runTransaction(async t => {
            const now = await t.get(ref);
            if (!now.exists || now.data().gen !== rec.gen) return;
            t.set(ref, { fbCopy: { gen: rec.gen, chunkCount: rec.chunkCount || 0, hash: rec.hash || null, sum: rec.sum || null, blobs: rec.blobs || [], at: Date.now() } }, { merge: true });
        });
    }
    // Parts here that no save points at anymore (and are a day old)
    const wanted = new Set(need.map(([k, n]) => k + "/" + n));
    for (const kind of KINDS) {
        for (const e of await fsp.readdir(path.join(SAVES_DIR, uid, kind)).catch(() => [])) {
            if (wanted.has(kind + "/" + e) || e.endsWith(".tmp")) continue;
            const f = path.join(SAVES_DIR, uid, kind, e), st = await exists(f);
            if (st && Date.now() - st.mtimeMs > 86400000) { await fsp.unlink(f).catch(() => {}); known.delete(kind + "/" + e); }
        }
    }
    usage.delete(uid);
    syncState.known[uid] = [...known].filter(k => wanted.has(k));
}
async function runSync() {
    if (!db || syncStatus.running) return;
    syncStatus.running = true;
    const startedAt = Date.now(), counts = { up: 0, down: 0 };
    try {
        const uids = new Set(dirtyUids);
        let q = db.collection("saves");
        if (syncState.lastSync) q = q.where("updatedAt", ">", admin.firestore.Timestamp.fromMillis(syncState.lastSync - 5 * 60 * 1000));
        (await q.select().get()).forEach(d => uids.add(d.id));
        let failed = 0;
        for (const uid of uids) {
            if (!UID_RE.test(uid)) continue;
            try {
                await syncUid(uid, counts);
                dirtyUids.delete(uid);
            } catch (e) {
                if (/RESOURCE_EXHAUSTED|quota/i.test(e.message)) throw e;   // Firebase's daily limit: stop for now
                failed++;
                log("sync failed for", uid, e.message);                     // tried again next time
            }
            await writeJson(SYNC_FILE, syncState).catch(() => {});
        }
        if (!failed) syncState.lastSync = startedAt;
        syncStatus.lastResult = `${failed ? "partly ok" : "ok"}: ${uids.size} player${uids.size === 1 ? "" : "s"}, ${counts.up} up, ${counts.down} down${failed ? `, ${failed} to retry` : ""}`;
    } catch (e) {
        syncStatus.lastResult = (/RESOURCE_EXHAUSTED|quota/i.test(e.message) ? "Firebase daily limit, will retry: " : "error: ") + e.message;
    } finally {
        syncStatus = { ...syncStatus, running: false, lastSync: syncState.lastSync || null, partsUp: syncStatus.partsUp + counts.up, partsDown: syncStatus.partsDown + counts.down };
        await writeJson(SYNC_FILE, syncState).catch(() => {});
        saveDirtyUids();
        log("sync", syncStatus.lastResult);
        event(/^ok/.test(syncStatus.lastResult) ? "sync" : "warn", "Firebase sync " + syncStatus.lastResult);
    }
}
app.get("/api/sync-status", (req, res) => { res.set("Cache-Control", "no-store"); res.json(syncStatus); });

// ── Nightly backup of saves (keeps 7) ───────────────────────────────────────
function backup() {
    const out = path.join(BACKUP_DIR, `saves-${today()}.tar.gz`);
    if (fs.existsSync(out)) return;
    execFile("tar", ["-czf", out, "-C", ROOT, "saves", "state"], err => {
        if (err) { event("warn", "Save backup failed: " + err.message); return log("backup failed", err.message); }
        const all = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith("saves-")).sort();
        for (const f of all.slice(0, -7)) fs.unlinkSync(path.join(BACKUP_DIR, f));
        log("backup done", out);
        event("backup", "Nightly save backup made");
    });
}

let saveBytes = 0;
async function countSaves() { saveBytes = (await walk(SAVES_DIR)).reduce((n, x) => n + x.size, 0); }
app.get("/api/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const saves = await fsp.readdir(SAVES_DIR).catch(() => []);
    let disk = null;
    try { const d = await fsp.statfs(ROOT); disk = { free: d.bavail * d.bsize, total: d.blocks * d.bsize }; } catch {}
    const last = history[history.length - 1] || null;
    res.json({
        ok: true, uptime: Math.round((Date.now() - started) / 1000), now: Date.now(),
        cacheFiles: cacheStats.files, cacheBytes: cacheStats.bytes,
        players: saves.length, saveBytes, playsToday: Object.values(plays[today()] || {}).reduce((a, b) => a + b, 0),
        sync: { ...syncStatus, everyMs: SYNC_EVERY_MS },
        system: { load: os.loadavg()[0], cpus: os.cpus().length, memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(), rss: process.memoryUsage().rss, hostUptime: os.uptime(), disk, node: process.version },
        thisMinute: { req: minute.req, saves: minute.saves, gh: minute.gh, plays: minute.plays }, lastMinute: last,
        events: events.slice(-20).reverse()
    });
});
app.get("/api/history", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ interval: 60000, points: history });
});

app.use(express.static(DATA("public"), { maxAge: "1h" }));
app.use((req, res) => res.status(404).json({ error: "not found" }));

app.listen(8080, "127.0.0.1", () => {
    log(`GN 2.0 Server listening on 8080 (Firebase sync ${db ? "on" : "off: no firebase-key.json"})`);
    event("start", "Server started");
    trimCache(); setInterval(trimCache, 60 * 60 * 1000);
    countSaves(); setInterval(countSaves, 10 * 60 * 1000);
    backup(); setInterval(backup, 60 * 60 * 1000);
    if (db) { setTimeout(runSync, 20000); setInterval(runSync, SYNC_EVERY_MS); }
});
