// GN 2.0 Server (data.learnresearch.org). Runs in the gn-home VM behind a
// Cloudflare tunnel, on 127.0.0.1:8080, kept running by pm2 ("gn-data").
// It updates itself: update.sh (cron, every 5 minutes) installs any new version
// of this file pushed to main, and rolls back if it doesn't start.
// (Auto-update tested 2026-11-19.)
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
const SAVE_QUOTA = 400 * 1024 * 1024;   // per player: their save, the earlier ones kept for a week, and Live Save
const BRANCH_TTL_MS = 10 * 60 * 1000;
const SYNC_EVERY_MS = 30 * 60 * 1000;
for (const d of [CACHE_DIR, SAVES_DIR, STATE_DIR, BACKUP_DIR, DATA("public")]) fs.mkdirSync(d, { recursive: true });
const started = Date.now();
const VERSION = crypto.createHash("sha1").update(fs.readFileSync(__filename)).digest("hex").slice(0, 7);
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
    history.push({ t: m.t, req: m.req, saves: m.saves, gh: m.gh, plays: m.plays, beats: m.beats || 0, online: live.online, bytes: m.bytes, errors: m.errors, ms: m.req ? Math.round(m.msTotal / m.req) : 0 });
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
        else if (req.path === "/api/presence" && req.method === "POST") minute.beats = (minute.beats || 0) + 1;
    });
    next();
});
app.use((req, res, next) => {
    res.set({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, CF-Cache-Status",
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
const refused = {};                                // uid -> last refused write (for /api/status)
const dirtyUids = new Set(readJson(path.join(STATE_DIR, "dirty.json"), []));
const saveDirtyUids = () => writeJson(path.join(STATE_DIR, "dirty.json"), [...dirtyUids]).catch(() => {});
async function uidBytes(uid) {
    // Save Rewind's snapshots don't count toward the limit (they're trimmed by age)
    const rw = path.sep + "rewind" + path.sep;
    if (!usage.has(uid)) usage.set(uid, (await walk(path.join(SAVES_DIR, uid))).filter(x => !x.f.includes(rw)).reduce((n, x) => n + x.size, 0));
    return usage.get(uid);
}
// Firebase sign-in tokens say when they were issued. A VM's clock drifts, and
// one even a minute behind would see fresh tokens as "issued in the future"
// and turn them down, so if Firebase's own check fails, the token is checked
// again against Google's keys allowing 5 minutes of clock difference.
let joseLib = null;
const joseLoad = () => joseLib || (joseLib = import("jose").then(j => ({ j, keys: j.createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")) })).catch(() => null));
let authError = null;   // the last reason a sign-in was turned down (for /api/status)
async function verifyToken(token) {
    try { return await admin.auth().verifyIdToken(token); }
    catch (e) {
        const L = await joseLoad();
        if (L) {
            try {
                const { payload } = await L.j.jwtVerify(token, L.keys, { issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID, clockTolerance: 300 });
                if (payload.sub) return { uid: payload.sub };
            } catch (e2) { authError = { at: Date.now(), msg: String(e2.message || e2).slice(0, 200) }; return null; }
        }
        authError = { at: Date.now(), msg: String(e.message || e).slice(0, 200) };
        return null;
    }
}
async function authed(req, uid) {
    const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    if (!m) return 401;
    const t = await verifyToken(m[1]);
    if (!t) return 401;
    return t.uid === uid ? 0 : 403;
}
// ── Live Save: the newest progress while someone plays (js/live-save.js) ────
// One file per player, replaced every time: saves/<uid>/live.json
// { main (packed save), blobs, hash, sum, size, sid, at }. The game data it
// points at is stored as normal blobs parts. promoteLive() below turns it into
// a normal cloud save in Firebase when the player goes offline.
const pendingLive = new Set();

// ── Save Rewind: an hourly snapshot of each player's Live Save, kept 48 hours ─
// saves/<uid>/rewind/<time>.json (same shape as live.json) plus index.json
// [{ at, sum, size }]. Players pick one in Account → Earlier cloud saves to go
// back to it (when a game breaks or wipes its own save). The game data the
// snapshots point at is kept here even after newer saves stop using it.
const REWIND_EVERY_MS = 60 * 60000, REWIND_KEEP_MS = 48 * 3600000;
const rewindBlobCache = new Map();   // uid -> Set of blob part names snapshots need
async function rewindIndex(uid) { return readJson(path.join(SAVES_DIR, uid, "rewind", "index.json"), []); }
async function rewindSnapshot(uid, live, body) {
    const dir = path.join(SAVES_DIR, uid, "rewind");
    let index = (await rewindIndex(uid)).filter(x => Date.now() - x.at < REWIND_KEEP_MS);
    for (const f of await fsp.readdir(dir).catch(() => [])) {
        const at = Number(f.replace(/\.json$/, ""));
        if (/^\d+\.json$/.test(f) && !index.some(x => x.at === at)) await fsp.unlink(path.join(dir, f)).catch(() => {});
    }
    const last = index.length ? index[index.length - 1].at : 0;
    if (live.at - last >= REWIND_EVERY_MS) {
        await writeAtomic(path.join(dir, live.at + ".json"), body);
        index.push({ at: live.at, sum: live.sum || null, size: live.size || 0, blobs: (live.blobs || []).map(b => [b.id, b.n]) });
    }
    await writeAtomic(path.join(dir, "index.json"), JSON.stringify(index));
    rewindBlobCache.delete(uid);
}
async function rewindBlobs(uid) {
    if (!rewindBlobCache.has(uid)) {
        const need = new Set();
        for (const x of await rewindIndex(uid)) for (const [id, n] of x.blobs || []) for (let j = 0; j < (n || 1); j++) need.add(`${id}_${j}`);
        rewindBlobCache.set(uid, need);
    }
    return rewindBlobCache.get(uid);
}
app.get(/^\/api\/saves\/([A-Za-z0-9]{1,128})\/rewind(?:\/(\d{10,16}))?$/, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        const uid = req.params[0], at = req.params[1];
        const bad = await authed(req, uid);
        if (bad) return res.sendStatus(bad);
        if (!at) return res.json((await rewindIndex(uid)).filter(x => Date.now() - x.at < REWIND_KEEP_MS).map(({ at, sum, size }) => ({ at, sum, size })).reverse());
        const file = path.join(SAVES_DIR, uid, "rewind", at + ".json");
        if (!(await exists(file))) return res.sendStatus(404);
        res.type("application/json").send(await fsp.readFile(file, "utf8"));
    } catch (e) { log("rewind error", e.message); res.sendStatus(500); }
});
app.all(/^\/api\/saves\/([A-Za-z0-9]{1,128})\/live$/, express.text({ type: "*/*", limit: "30mb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        const uid = req.params[0];
        const bad = await authed(req, uid);
        if (bad) return res.sendStatus(bad);
        const file = path.join(SAVES_DIR, uid, "live.json");
        if (req.method === "GET") { const st = await exists(file); if (!st) return res.sendStatus(404); return res.type("application/json").send(await fsp.readFile(file, "utf8")); }
        if (req.method === "DELETE") { await fsp.unlink(file).catch(() => {}); return res.sendStatus(200); }
        if (req.method !== "PUT") return res.sendStatus(405);
        let b; try { b = JSON.parse(req.body || ""); } catch { return res.sendStatus(400); }
        if (!b || typeof b.main !== "string" || !b.main || !Array.isArray(b.blobs) || typeof b.hash !== "string") return res.sendStatus(400);
        const live = { main: b.main, blobs: b.blobs.filter(x => x && /^[A-Za-z0-9_-]{1,64}$/.test(String(x.id))).map(x => ({ id: String(x.id), n: Math.max(1, x.n | 0) })),
            hash: b.hash.slice(0, 64), sum: b.sum && typeof b.sum === "object" ? b.sum : null, size: Number(b.size) || b.main.length,
            sid: ID20.test(String(b.sid || "")) ? String(b.sid) : "", at: Date.now() };
        const old = await exists(file);
        const body = JSON.stringify(live);
        const now = await uidBytes(uid) - (old ? old.size : 0) + Buffer.byteLength(body);
        if (now > SAVE_QUOTA) return res.sendStatus(413);
        await writeAtomic(file, body);
        usage.set(uid, now);
        rewindSnapshot(uid, live, body).catch(e => log("rewind snapshot", e.message));
        pendingLive.add(uid);
        dirtyUids.add(uid); saveDirtyUids();
        liveSavesToday++;
        res.sendStatus(200);
    } catch (e) { log("live save error", e.message); res.sendStatus(500); }
});
// Counted per day, kept on disk so restarts (every update) don't reset it
const LIVE_COUNT_FILE = path.join(STATE_DIR, "live-saves.json");
const liveCount0 = readJson(LIVE_COUNT_FILE, {});
let liveSavesDay = today();
let liveSavesToday = liveCount0.day === liveSavesDay ? liveCount0.n || 0 : 0;
let liveSavesPromoted = liveCount0.day === liveSavesDay ? liveCount0.promoted || 0 : 0;
setInterval(() => {
    if (today() !== liveSavesDay) { liveSavesDay = today(); liveSavesToday = 0; liveSavesPromoted = 0; }
    writeJson(LIVE_COUNT_FILE, { day: liveSavesDay, n: liveSavesToday, promoted: liveSavesPromoted }).catch(() => {});
}, 60000);

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
            if (now > SAVE_QUOTA) { refused[uid] = { at: Date.now(), why: "full", bytes: now }; return res.sendStatus(413); }
            await writeAtomic(file, body);
            usage.set(uid, now);
            dirtyUids.add(uid); saveDirtyUids();
            return res.sendStatus(200);
        }
        if (req.method === "DELETE") {
            const old = await exists(file);
            if (!old) return res.sendStatus(404);
            // Still needed by a Save Rewind snapshot: keep it here (Firebase's copy can go)
            if (kind === "blobs" && (await rewindBlobs(uid)).has(name)) return res.sendStatus(200);
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


// ── Online now, "N playing", Top 10 (takes over Firestore presence) ─────────
// Each open copy of the site says "still here" (and which game is open) every
// couple of minutes: POST /api/presence. That used to be a Firestore write per
// browser; now it's in memory here. Every few minutes the server adds them up
// (plus anyone still using Firestore because they can't reach this server) and
// writes ONE summary to Firestore live/now and the week's Top 10 counts, the
// same documents as before, so everything that reads them keeps working.
const ONLINE_MS = 5 * 60000, LIST_MS = 10 * 60000, ROUND_MS = 4 * 60000;
const presence = new Map();                      // id -> { t, s, g, u }
const VISITORS_FILE = path.join(STATE_DIR, "visitors.json");
const visitors = readJson(VISITORS_FILE, {});    // id -> [firstSeen, lastSeen, inFirestore: 1 | 0 | -1 unknown]
let visitorsDirty = false;
const ID20 = /^[A-Za-z0-9]{20}$/;
app.post("/api/presence", express.text({ type: "*/*", limit: "4kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    let b; try { b = JSON.parse(req.body || "{}"); } catch { return res.sendStatus(400); }
    const id = String(b.id || "");
    if (!ID20.test(id)) return res.sendStatus(400);
    const g = /^\d{1,7}$/.test(String(b.g || "")) ? String(b.g) : "";
    const site = /^[a-z0-9]{1,10}$/.test(String(b.s || "")) ? String(b.s) : "gn2";
    let u = null;
    if (b.u && typeof b.u === "object") {
        const day = Object.keys(b.u)[0];
        const v = b.u[day] || {};
        if (/^[\w-]{1,12}$/.test(day || "")) u = { day, r: Math.min(100000, Math.max(0, v.r | 0)), w: Math.min(100000, Math.max(0, v.w | 0)) };
    }
    const now = Date.now();
    presence.set(id, { t: now, s: site, g, u });
    const v = visitors[id];
    if (v) v[1] = now; else visitors[id] = [now, now, -1];
    visitorsDirty = true;
    res.json({ ok: true });
});
let live = { online: 0, games: {}, at: 0, h: [] };
let liveWeek = { id: "", p: {} };
let fsSessions = [];                             // people still on Firestore presence
let fsUsage = { day: "", r: 0, w: 0 };
let fsCounts = { at: 0, day: null, week: null, all: null };
function weekId(at = Date.now()) {
    const d = new Date(at), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear(), wk = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return `w${y}${String(wk).padStart(2, "0")}`;
}
const packHist = list => list.map(([t, n]) => Math.floor(t / 60000).toString(36) + ":" + n.toString(36)).join(",");
const parseHist = str => String(str || "").split(",").map(x => x.split(":")).filter(x => x.length === 2)
    .map(([m, n]) => [parseInt(m, 36) * 60000, parseInt(n, 36)]).filter(([t, n]) => t > 0 && n >= 0 && Date.now() - t < 86400000);
async function liveStartup() {
    if (!db) return;
    try {
        const now = await db.collection("live").doc("now").get();
        if (now.exists) live.h = parseHist(now.get("h"));
    } catch (e) { log("live startup", e.message); }
}
async function readWeek(id) {
    liveWeek = { id, p: {} };
    if (!db) return;
    try { const d = await db.collection("live").doc(id).get(); if (d.exists) liveWeek.p = { ...(d.get("p") || {}) }; } catch {}
}
function usageNow() {
    const counts = {};
    for (const p of presence.values()) if (p.u) { const c = counts[p.u.day] = counts[p.u.day] || { r: 0, w: 0 }; c.r += p.u.r; c.w += p.u.w; }
    const day = Object.keys(counts).sort().pop() || fsUsage.day;
    const mine = counts[day] || { r: 0, w: 0 };
    const extra = fsUsage.day === day ? fsUsage : { r: 0, w: 0 };
    return day ? { day, r: mine.r + extra.r, w: mine.w + extra.w } : null;
}
let liveBusy = false;
async function liveRound() {
    if (liveBusy) return;
    liveBusy = true;
    try {
        const now = Date.now(), cutoff = now - ONLINE_MS;
        if (db) {
            try {
                const snap = await db.collection("presence").where("t", ">", admin.firestore.Timestamp.fromMillis(now - LIST_MS)).select("s", "g", "t").get();
                fsSessions = snap.docs.filter(d => !presence.has(d.id)).map(d => ({ id: d.id, t: d.get("t") ? d.get("t").toMillis() : 0, s: d.get("s") || "gn2", g: d.get("g") || "" }));
            } catch (e) { log("presence read", e.message); }
        }
        let online = 0;
        const counts = {};
        const add = p => { if (p.t <= cutoff) return; online++; if (p.g && /^\d{1,7}$/.test(p.g)) counts[p.g] = (counts[p.g] || 0) + 1; };
        for (const [id, p] of presence) { if (p.t < now - 3 * LIST_MS) presence.delete(id); else add(p); }
        fsSessions.forEach(add);
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 150);
        live.h.push([now, online]);
        while (live.h.length > 400 || (live.h.length && now - live.h[0][0] > 86400000)) live.h.shift();
        live = { online, games: Object.fromEntries(top), at: now, h: live.h };
        const wk = weekId(now);
        if (liveWeek.id !== wk) await readWeek(wk);
        for (const [id, n] of top) liveWeek.p[id] = (liveWeek.p[id] || 0) + n;
        if (db) {
            const FV = admin.firestore.FieldValue;
            await db.collection("live").doc("now").set({ online, games: live.games, h: packHist(live.h), at: FV.serverTimestamp() });
            if (top.length) await db.collection("live").doc(wk).set({ at: FV.serverTimestamp(), p: Object.fromEntries(top.map(([id, n]) => [id, FV.increment(n)])) }, { merge: true });
        }
        await checkVisitorsInFirestore();
    } catch (e) {
        log("live round", e.message);
    } finally { liveBusy = false; }
}
// Browsers seen here for the first time: did they ever write Firestore presence
// (so the all-time visitor count doesn't count them twice)? One cheap check each, ever.
async function checkVisitorsInFirestore() {
    if (!db) return;
    const unknown = Object.entries(visitors).filter(([, v]) => v[2] === -1).slice(0, 300).map(([id]) => id);
    for (let i = 0; i < unknown.length; i += 100) {
        const group = unknown.slice(i, i + 100);
        const snaps = await db.getAll(...group.map(id => db.collection("presence").doc(id)), { fieldMask: [] });
        snaps.forEach((s, k) => { visitors[group[k]][2] = s.exists ? 1 : 0; });
        visitorsDirty = true;
    }
}
// Visitor totals and the Firebase use everyone reported (cached 10 minutes)
async function firestoreCounts() {
    if (!db || Date.now() - fsCounts.at < 10 * 60000) return fsCounts;
    const col = db.collection("presence"), TS = admin.firestore.Timestamp;
    const cnt = async q => { try { return (await q.count().get()).data().count; } catch { return null; } };
    const [day, week, all] = await Promise.all([
        cnt(col.where("t", ">", TS.fromMillis(Date.now() - 86400000))),
        cnt(col.where("t", ">", TS.fromMillis(Date.now() - 7 * 86400000))),
        cnt(col)
    ]);
    fsCounts = { at: Date.now(), day, week, all };
    const u = usageNow();
    if (u) {
        try {
            const AF = admin.firestore.AggregateField;
            const out = await col.aggregate({ r: AF.sum(`u.\`${u.day}\`.r`), w: AF.sum(`u.\`${u.day}\`.w`) }).get();
            fsUsage = { day: u.day, r: out.data().r || 0, w: out.data().w || 0 };
        } catch {}
    }
    return fsCounts;
}
app.get("/api/live", (req, res) => {
    res.set("Cache-Control", "no-store");
    const wk = weekId();
    res.json({ online: live.online, games: live.games, at: live.at, h: packHist(live.h), week: { id: wk, p: liveWeek.id === wk ? liveWeek.p : {} }, usage: usageNow() });
});
app.get("/api/presence", (req, res) => {
    res.set("Cache-Control", "no-store");
    const since = Date.now() - LIST_MS;
    const mine = [...presence].filter(([, p]) => p.t > since).map(([id, p]) => ({ id, t: p.t, s: p.s, g: p.g }));
    res.json({ sessions: mine.concat(fsSessions.filter(p => p.t > since)) });
});
app.get("/api/visitors", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const fc = await firestoreCounts();
    const now = Date.now(), list = Object.values(visitors);
    const here = ms => list.filter(v => v[1] > now - ms).length;
    const plus = (a, b) => a == null ? b : a + b;
    res.json({
        day: plus(fc.day, here(86400000)), week: plus(fc.week, here(7 * 86400000)),
        all: plus(fc.all, list.filter(v => v[2] !== 1).length),
        online: live.online
    });
});
setInterval(() => {
    if (!visitorsDirty) return;
    visitorsDirty = false;
    writeJson(VISITORS_FILE, visitors).catch(() => {});
}, 60000);

// ── Games that won't load for real players ──────────────────────────────────
// When a game crashes or never starts, the site tells the server
// (POST /api/game-report). If 3+ different people hit it within a day and it
// fails for a big share of its plays, it's flagged: the site shows a
// "Not loading for many" badge and the status page lists it.
const REPORTS_FILE = path.join(STATE_DIR, "game-reports.json");
let reports = readJson(REPORTS_FILE, []).filter(r => Date.now() - r.t < 7 * 86400000);
const reportSeen = new Map();
const KINDS_OK = new Set(["stopped", "start", "graphics", "crash", "load"]);
let flaggedBefore = new Set();
app.post("/api/game-report", express.text({ type: "*/*", limit: "4kb" }), (req, res) => {
    res.set("Cache-Control", "no-store");
    let b; try { b = JSON.parse(req.body || "{}"); } catch { return res.sendStatus(400); }
    const id = String(b.id || ""), kind = String(b.kind || ""), v = String(b.v || "").slice(0, 40);
    if (!/^[\w.-]{1,40}$/.test(id) || !KINDS_OK.has(kind)) return res.sendStatus(400);
    const key = v + "|" + id, now = Date.now();
    if (v && now - (reportSeen.get(key) || 0) < 30 * 60000) return res.sendStatus(204);
    reportSeen.set(key, now);
    reports.push({ t: now, id, kind, msg: String(b.msg || "").slice(0, 200), v: v || crypto.randomBytes(4).toString("hex") });
    if (reports.length > 5000) reports = reports.slice(-5000);
    writeJson(REPORTS_FILE, reports).catch(() => {});
    gameHealthCache = null;
    res.sendStatus(204);
});
let gameHealthCache = null;
function gameHealth() {
    if (gameHealthCache && Date.now() - gameHealthCache.at < 60000) return gameHealthCache;
    const now = Date.now(), since = now - 86400000;
    const yday = new Date(now - 86400000).toISOString().slice(0, 10);
    const byId = {};
    for (const r of reports) {
        if (r.t < since) continue;
        const g = byId[r.id] = byId[r.id] || { id: r.id, fails: 0, people: new Set(), kinds: {}, lastMsg: "", lastAt: 0, firstAt: r.t };
        g.fails++; g.people.add(r.v); g.kinds[r.kind] = (g.kinds[r.kind] || 0) + 1;
        if (r.t > g.lastAt) { g.lastAt = r.t; if (r.msg) g.lastMsg = r.msg; }
    }
    const list = Object.values(byId).map(g => {
        const playsN = ((plays[today()] || {})[g.id] || 0) + ((plays[yday] || {})[g.id] || 0);
        const people = g.people.size, rate = playsN ? Math.min(1, people / playsN) : 1;
        return { id: g.id, fails: g.fails, people, plays: playsN, rate: Math.round(rate * 100) / 100, kinds: g.kinds, lastMsg: g.lastMsg, lastAt: g.lastAt, since: g.firstAt, flagged: people >= 3 && rate >= 0.25 };
    }).sort((a, b) => b.people - a.people || b.fails - a.fails);
    const flagged = list.filter(g => g.flagged);
    for (const g of flagged) if (!flaggedBefore.has(g.id)) event("warn", `Game ${g.id} isn't loading for ${g.people} players`);
    flaggedBefore = new Set(flagged.map(g => g.id));
    gameHealthCache = { at: now, flagged, watching: list.filter(g => !g.flagged).slice(0, 20) };
    return gameHealthCache;
}
app.get("/api/game-health", (req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    const h = gameHealth();
    res.json({ updated: h.at, flagged: h.flagged, watching: h.watching });
});
setInterval(() => { gameHealth(); const cut = Date.now() - 7 * 86400000; if (reports.length && reports[0].t < cut) { reports = reports.filter(r => r.t >= cut); writeJson(REPORTS_FILE, reports).catch(() => {}); } }, 10 * 60000);

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
    // Game data the newest Live Save points at gets a Firebase copy too
    try {
        const live = JSON.parse(await fsp.readFile(path.join(SAVES_DIR, uid, "live.json"), "utf8"));
        const have = new Set(need.map(([k, n]) => k + "/" + n));
        for (const b of live.blobs || []) for (let j = 0; j < (b.n || 1); j++) if (!have.has(`blobs/${b.id}_${j}`)) need.push(["blobs", `${b.id}_${j}`]);
    } catch {}
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
    for (const n of await rewindBlobs(uid)) wanted.add("blobs/" + n);   // Save Rewind needs these
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

// ── Live Save → Firebase cloud save ─────────────────────────────────────────
// When a player's newest Live Save is newer than their Firebase cloud save and
// they've gone offline (no heartbeat from that browser for 5 minutes), or 30
// minutes have passed in a long session, it becomes their cloud save in
// Firebase: its pieces are written there, and the save record points at it
// (with liveSid, so that browser knows it's its own progress: liveAdopt()).
const PROMOTED_FILE = path.join(STATE_DIR, "promoted.json");
const promoted = readJson(PROMOTED_FILE, {});     // uid -> { mtime, wall }
async function promoteOne(uid, live) {
    const ref = db.collection("saves").doc(uid), FV = admin.firestore.FieldValue;
    const snap = await ref.get();
    const meta = snap.exists ? snap.data() : null;
    const metaAt = meta && meta.updatedAt && meta.updatedAt.toMillis ? meta.updatedAt.toMillis() : 0;
    if (meta && (metaAt > live.at || meta.hash === live.hash)) return "already newer";
    const gen = "L" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
    const CH = 500000, chunkCount = Math.max(1, Math.ceil(live.main.length / CH));
    // The game data first: Firebase must have every piece before the record points at it
    const parts = [];
    for (const b of live.blobs || []) for (let j = 0; j < (b.n || 1); j++) parts.push(`${b.id}_${j}`);
    for (let i = 0; i < parts.length; i += 100) {
        const group = parts.slice(i, i + 100);
        const snaps = await db.getAll(...group.map(n => ref.collection("blobs").doc(n)), { fieldMask: [] });
        for (let k = 0; k < group.length; k++) {
            if (snaps[k].exists) continue;
            const d = await fsp.readFile(path.join(SAVES_DIR, uid, "blobs", group[k]), "utf8").catch(() => null);
            if (d == null) throw new Error("missing game data " + group[k]);
            await ref.collection("blobs").doc(group[k]).set({ d });
        }
    }
    for (let i = 0; i < chunkCount; i++) {
        const d = live.main.slice(i * CH, (i + 1) * CH);
        await writeAtomic(path.join(SAVES_DIR, uid, "chunks", `${gen}_${i}`), d);
        await ref.collection("chunks").doc(`${gen}_${i}`).set({ d });
    }
    let dropped = null;
    await db.runTransaction(async t => {
        const cur = await t.get(ref);
        const m = cur.exists ? cur.data() : null;
        if ((m && m.gen) !== (meta && meta.gen)) throw new Error("the save changed meanwhile");
        let kept = Array.isArray(m && m.kept) ? m.kept.slice() : [];
        // The save this replaces is kept for a week, unless it was this same
        // browser's previous Live Save (like an autosave replacing its own)
        if (m && m.gen) {
            if (m.liveSid && m.liveSid === live.sid) dropped = m;
            else kept.unshift({ gen: m.gen, chunkCount: m.chunkCount || 0, sum: m.sum || null, at: metaAt || Date.now(), until: Date.now() + 7 * 86400000, ...(Array.isArray(m.blobs) && m.blobs.length ? { blobs: m.blobs } : {}) });
        }
        kept = kept.filter(k => k && k.gen && (k.until || 0) > Date.now()).slice(0, 6);
        const rec = { gen, chunkCount, hash: live.hash, sum: live.sum || null, blobs: live.blobs || [], size: live.size || live.main.length,
            updatedAt: FV.serverTimestamp(), kept, liveSid: live.sid || null };
        rec.fbCopy = { gen, chunkCount, hash: live.hash, sum: live.sum || null, blobs: rec.blobs, at: Date.now() };
        t.set(ref, rec);
    });
    // Clean up the replaced Live Save's own pieces
    if (dropped) {
        for (let i = 0; i < (dropped.chunkCount || 0); i++) {
            const n = `${dropped.gen}_${i}`;
            ref.collection("chunks").doc(n).delete().catch(() => {});
            fsp.unlink(path.join(SAVES_DIR, uid, "chunks", n)).catch(() => {});
        }
    }
    return "promoted " + gen;
}
let promoting = false;
async function promoteLive() {
    if (!db || promoting) return;
    promoting = true;
    try {
        for (const uid of await fsp.readdir(SAVES_DIR).catch(() => [])) {
            if (!UID_RE.test(uid)) continue;
            const file = path.join(SAVES_DIR, uid, "live.json");
            const st = await exists(file);
            if (!st) continue;
            const pr = promoted[uid] || { mtime: 0, wall: 0 };
            if (st.mtimeMs <= pr.mtime) continue;                       // nothing new since last time
            let live; try { live = JSON.parse(await fsp.readFile(file, "utf8")); } catch { continue; }
            const p = live.sid ? presence.get(live.sid) : null;
            const online = p && Date.now() - p.t < ONLINE_MS;
            if (online && Date.now() - pr.wall < 30 * 60000 && Date.now() - live.at < 30 * 60000) continue;   // still playing
            try {
                const r = await promoteOne(uid, live);
                promoted[uid] = { mtime: st.mtimeMs, wall: Date.now() };
                if (/^promoted/.test(r)) { liveSavesPromoted++; log("live save", uid, r); }
            } catch (e) {
                log("live save promotion failed", uid, e.message);
                if (/RESOURCE_EXHAUSTED|quota/i.test(e.message)) break;
            }
        }
        await writeJson(PROMOTED_FILE, promoted).catch(() => {});
    } finally { promoting = false; }
}
setInterval(promoteLive, 60000);

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
        ok: true, version: VERSION, uptime: Math.round(process.uptime()), now: Date.now(),   // process.uptime ignores clock changes
        cacheFiles: cacheStats.files, cacheBytes: cacheStats.bytes,
        players: saves.length, saveBytes, playsToday: Object.values(plays[today()] || {}).reduce((a, b) => a + b, 0),
        online: live.online, onlineHere: [...presence.values()].filter(p => p.t > Date.now() - ONLINE_MS).length, onlineFirestore: fsSessions.filter(p => p.t > Date.now() - ONLINE_MS).length,
        gamesFlagged: gameHealth().flagged.length,
        liveSaves: { today: liveSavesToday, toFirebase: liveSavesPromoted },
        authError,
        refusedSaves: Object.entries(refused).filter(([, r]) => Date.now() - r.at < 3600000).map(([u, r]) => ({ who: u.slice(0, 5), ...r })),
        biggestPlayers: [...usage].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u, b]) => ({ who: u.slice(0, 5), mb: Math.round(b / 1e5) / 10 })),
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

// The site itself is NOT served from here (home upload is only ~20 Mbps):
// learnresearch.org is hosted by Cloudflare Pages. Clear out the copy an
// earlier version kept.
for (const d of ["site", "site.new", "site.old", "site.tgz"]) fsp.rm(DATA(d), { recursive: true, force: true }).catch(() => {});
app.use(express.static(DATA("public"), { maxAge: "1h" }));

app.use((req, res) => res.status(404).json({ error: "not found" }));

app.listen(8080, "127.0.0.1", () => {
    log(`GN 2.0 Server listening on 8080 (Firebase sync ${db ? "on" : "off: no firebase-key.json"})`);
    event("start", `Server started (version ${VERSION})`);
    trimCache(); setInterval(trimCache, 60 * 60 * 1000);
    countSaves(); setInterval(countSaves, 10 * 60 * 1000);
    liveStartup().then(() => setTimeout(liveRound, 30000));
    setInterval(liveRound, ROUND_MS);
    backup(); setInterval(backup, 60 * 60 * 1000);
    if (db) { setTimeout(runSync, 20000); setInterval(runSync, SYNC_EVERY_MS); }
});
