// Nightly game check (.github/workflows/game-check.yml).
//
// Opens games on a local copy of the site in a real browser, the same way a
// player does, and notes which ones never show a game. Each night it checks
// the next batch (so every game gets checked every week or so) plus every game
// that failed last time (so fixed games clear). Results go to
// config/game-health.json, which the Admin Panel shows under "Game check".
//
//   node tools/check_games.mjs                      # tonight's batch
//   node tools/check_games.mjs --batch=50           # smaller batch
//   node tools/check_games.mjs --ids=2,11,990123    # just these
//   node tools/check_games.mjs --reported           # just the games players reported broken
// Every night's batch also includes the games players reported broken.
//
// It also measures how much each working game downloads while it starts and
// saves that to config/game-sizes.json (shown on cards for big games, and used
// by Show → "Quick to load").
//
// Needs: npm i playwright && npx playwright install --with-deps chromium,
// and the site served at SITE_URL (default http://127.0.0.1:8080/).
import { chromium } from "playwright";
import fs from "fs";
import { reportedGames } from "./reported_games.mjs";

const SITE = process.env.SITE_URL || "http://127.0.0.1:8080/";
const OUT = new URL("../config/game-health.json", import.meta.url);
const SIZES_OUT = new URL("../config/game-sizes.json", import.meta.url);
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || "").split("=")[1];
const BATCH = Number(arg("batch") || 275);
const WORKERS = Number(arg("workers") || 2);
const WAIT_MS = 20000, CONFIRM_WAIT_MS = 45000;
// Big games (50 MB+) can still be downloading after 45s. On the second try, keep
// waiting (up to this much longer) as long as their loading text keeps changing
// ("34 MB / 54 MB", "part 14/23"); a game whose loading is stuck still fails.
const LOADING_EXTRA_MS = 120000;
const LOADING_RE = /load|download|\d+\s*%|please wait|starting|initiali/i;
const MAX_MINUTES = Number(arg("minutes") || 150);
const started = Date.now();

const health = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { games: {}, next: 0 };
health.games ||= {};
const sizes = fs.existsSync(SIZES_OUT) ? JSON.parse(fs.readFileSync(SIZES_OUT, "utf8")) : {};
sizes.kb ||= {};
// After a game shows up, keep counting until its downloads stop (a Unity game
// shows its loading bar long before its 100 MB of files are in)
const QUIET_MS = 3000, SIZE_WAIT_MS = 90000;

// Things a test browser shouldn't touch: the site's database (online count,
// error reports, accounts) and trackers
const BLOCK = /(^|\.)(firestore\.googleapis\.com|firebase\w*\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|google-analytics\.com|googletagmanager\.com)$/;
const NOISE = /firestore|favicon|sha\.txt|api\.github|googletagmanager|google-analytics|data\.jsdelivr|^Failed to load resource|gameanalytics|fonts\.(googleapis|gstatic)|google\.com\/jsapi/i;

// Software WebGL, so 3D games can draw without a graphics card
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

// jsDelivr often refuses the test server (GitHub's machines): HTTP 403 or a
// dropped connection, for files players download fine. When that happens, get
// the same file from GitHub directly, so a game is only called broken for a
// real problem and not because the test server was turned away.
const MIME = { js: "application/javascript", mjs: "application/javascript", css: "text/css", html: "text/html", htm: "text/html", json: "application/json",
    wasm: "application/wasm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm", swf: "application/x-shockwave-flash",
    xml: "application/xml", txt: "text/plain", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2" };
const JSD_GH = /^https?:\/\/(?:cdn|fastly|gcore|testingcf)\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)(?:@([^/]+))?\/([^?#]*)/;
// Downloads made by the game (not the site around it) are added to st.bytes while st.counting.
const routedRequests = new WeakSet();
const jsdRefused = new Set();
function countBytes(st, req, n) {
    try { if (!st.counting || !n || req.frame() === req.frame().page().mainFrame() && !/^(fetch|xhr)$/.test(req.resourceType())) return; } catch (e) { return; }
    st.bytes += n;
}
async function viaGitHub(route, st) {
    const url = route.request().url();
    routedRequests.add(route.request());
    let res = null;
    try { res = await route.fetch({ timeout: 30000 }); } catch (e) {}
    // jsDelivr refusing a repo (it's too big for it) breaks the game for every
    // player whose jsDelivr works; here it would quietly come from GitHub instead
    if (res && res.status() >= 400 && res.status() !== 404) {
        const m = /jsdelivr\.net\/gh\/([\w.-]+\/[\w.-]+)/.exec(url);
        if (m && !jsdRefused.has(m[1])) { jsdRefused.add(m[1]); console.log(`::warning::jsDelivr refuses ${m[1]} (HTTP ${res.status()}); add it to JSD_REFUSED_REPOS in js/app.js`); }
    }
    if (res && (res.status() < 400 || res.status() === 404)) {
        if (res.status() < 400) { try { countBytes(st, route.request(), (await res.body()).length); } catch (e) {} }
        return route.fulfill({ response: res });
    }
    const m = url.match(JSD_GH);
    const ref = !m[3] || ["latest", "main", "master"].includes(m[3]) ? "HEAD" : m[3];
    try {
        const raw = await fetch(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${ref}/${m[4]}`, { signal: AbortSignal.timeout(60000) });
        if (raw.ok) {
            const body = Buffer.from(await raw.arrayBuffer());
            countBytes(st, route.request(), body.length);
            const ext = (m[4].split("/").pop().match(/\.([a-z0-9]+)$/i) || [])[1] || "";
            return route.fulfill({ status: 200, body,
                headers: { "content-type": MIME[ext.toLowerCase()] || "application/octet-stream", "access-control-allow-origin": "*" } });
        }
    } catch (e) {}
    cdnRefused.add(url);
    if (res) return route.fulfill({ response: res });
    return route.abort();
}
const cdnRefused = new Set();

async function makePage() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route(url => BLOCK.test(new URL(url).hostname), r => r.abort());
    const st = { errors: [], bytes: 0, counting: false, inflight: new Set(), lastNet: 0 };
    await ctx.route(JSD_GH, route => viaGitHub(route, st));
    const page = await ctx.newPage();
    const gameReq = rq => { try { return rq.frame() !== page.mainFrame() || /^(fetch|xhr)$/.test(rq.resourceType()); } catch (e) { return false; } };
    page.on("request", rq => { if (st.counting && gameReq(rq)) { st.inflight.add(rq); st.lastNet = Date.now(); } });
    const done = rq => { if (st.inflight.delete(rq)) st.lastNet = Date.now(); };
    page.on("requestfailed", done);
    page.on("requestfinished", async rq => {
        done(rq);
        if (!st.counting || routedRequests.has(rq) || !gameReq(rq)) return;
        try { const s = await rq.sizes(); countBytes(st, rq, s.responseBodySize > 0 ? s.responseBodySize : 0); } catch (e) {}
    });
    // (Offline-cache helpers can't start inside the game window; that's harmless)
    page.on("pageerror", e => { const m = String(e.message); if (!/ServiceWorker|serviceWorker|ResizeObserver/.test(m)) st.errors.push("Script error: " + m.slice(0, 160)); });
    page.on("response", res => { if (res.status() >= 400 && !NOISE.test(res.url())) st.errors.push(`HTTP ${res.status()} ${res.url().slice(0, 160)}`); });
    page.on("requestfailed", rq => { const u = rq.url(); if (!NOISE.test(u) && !BLOCK.test(new URL(u).hostname)) st.errors.push(`Failed ${u.slice(0, 160)}`); });
    // Quiet the first-visit extras (tips, celebrations) so they don't get in the way
    await page.addInitScript(() => { try { localStorage.setItem("gnmath-playnext-off", "1"); localStorage.setItem("gnmath-achievements", JSON.stringify({ v: 1, init: 1, days: [], tried: {}, gotd: [], weekendDays: [], unlocked: {}, level: 99 })); } catch (e) {} });
    await page.goto(SITE, { timeout: 90000 });
    await page.waitForFunction(() => typeof zones !== "undefined" && zones.length > 500, null, { timeout: 120000 });
    await page.waitForTimeout(2000);
    return { ctx, page, st };
}

// What's in the game frame: the biggest canvas / Flash player / video / frame
const measure = () => {
    const f = document.getElementById("zoneFrame");
    let d; try { d = f.contentDocument; } catch (e) { return { other: true }; }
    if (!d || !d.body) return { empty: true };
    const W = f.contentWindow.innerWidth, H = f.contentWindow.innerHeight;
    let best = 0, painted = 0;
    const SURFACES = /^(CANVAS|SVG|EMBED|OBJECT|VIDEO|IFRAME|RUFFLE-PLAYER|RUFFLE-EMBED|RUFFLE-OBJECT)$/;
    // Every element, including ones inside shadow roots (WASM-4 games draw their
    // canvas inside <wasm4-app>'s shadow root, which querySelectorAll can't see)
    const each = function* (root) {
        for (const el of root.querySelectorAll("*")) { yield el; if (el.shadowRoot) yield* each(el.shadowRoot); }
    };
    const look = (doc, depth) => {
        const win = doc.defaultView;
        for (const el of each(doc)) {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            const tag = el.tagName.toUpperCase();
            if (SURFACES.test(tag)) {
                const cs = win.getComputedStyle(el);
                if (r.width < 80 || r.height < 60 || cs.display === "none" || cs.visibility === "hidden") continue;
                best = Math.max(best, r.width * r.height);
                if (tag === "IFRAME" && depth < 2) { try { if (el.contentDocument) look(el.contentDocument, depth + 1); } catch (e) {} }
            } else if (depth === 0 && tag !== "HTML" && tag !== "BODY") {
                // Games drawn with plain elements (colored boxes, images) instead of a canvas.
                // A box covering (nearly) the whole page is just a background, so it doesn't count.
                const area = Math.min(r.width, W) * Math.min(r.height, H);
                if (area >= W * H * 0.9) continue;
                const cs = win.getComputedStyle(el);
                if (cs.visibility === "hidden" || cs.opacity === "0") continue;
                const filled = tag === "IMG" || cs.backgroundImage !== "none" || !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.backgroundColor);
                if (filled) painted += area;
            }
        }
    };
    look(d, 0);
    const text = (d.body.innerText || "").replace(/\s+/g, " ").trim();
    return { surface: best / Math.max(1, W * H), painted: painted / Math.max(1, W * H), text: text.slice(0, 120), textLen: text.length };
};

async function check(w, z, waitMs) {
    const { page, st } = w;
    st.errors.length = 0;
    st.bytes = 0; st.inflight.clear(); st.counting = true; st.lastNet = Date.now();
    cdnRefused.clear();
    await page.evaluate(id => openZone(zones.find(x => String(x.id) === id)), String(z.id));
    let m = null;
    const t0 = Date.now();
    let until = t0 + waitMs;
    const hardEnd = until + (waitMs === CONFIRM_WAIT_MS ? LOADING_EXTRA_MS : 0);
    let lastText = "", changedAt = Date.now();
    while (Date.now() < until) {
        await page.waitForTimeout(2500);
        m = await page.evaluate(measure).catch(() => null);
        if (m && (m.surface > 0.05 || m.other)) break;       // a game is showing
        if (m && m.text !== lastText) { lastText = m.text; changedAt = Date.now(); }
        // Still downloading and making progress: give it a bit longer
        if (m && Date.now() >= until - 2500 && until < hardEnd && LOADING_RE.test(m.text) && Date.now() - changedAt < 15000)
            until = Math.min(hardEnd, until + 15000);
    }
    // A game is showing: wait for its downloads to finish, to know how big it is
    let sizeKb = null;
    if (m && (m.surface > 0.05 || m.other || m.textLen > 0 || m.painted > 0.1)) {
        const sizeEnd = Date.now() + SIZE_WAIT_MS;
        while (Date.now() < sizeEnd && (st.inflight.size || Date.now() - st.lastNet < QUIET_MS)) await page.waitForTimeout(500);
        sizeKb = Math.round(st.bytes / 1024);
    }
    st.counting = false;
    try { await page.evaluate(() => closeZone()); await page.waitForTimeout(400); } catch (e) {}
    const errors = [...new Set(st.errors)].slice(0, 4);
    // The most telling error: a script crash, or a game file that's missing
    const pickWhy = () => errors.find(e => e.startsWith("Script error")) || errors.find(e => /\.(js|wasm|data|unityweb|pck|swf|html?|json)(\?|$)/i.test(e)) || errors[0];
    if (!m) return { s: "broken", why: "The test browser crashed on this game", errors };
    if (m.surface > 0.05 || m.other) return { s: "ok", sizeKb };
    const loading = LOADING_RE.test(m.text);
    if (m.textLen > 40 && !errors.some(e => e.startsWith("Script error"))) return { s: "ok", note: "page without a game canvas (menus or text)", sizeKb };
    // A whole menu on screen (e.g. osu!) is a working game even if a side script failed
    if (m.textLen >= 300) return { s: "ok", note: "page without a game canvas (menus or text)", sizeKb };
    // Something on screen and nothing went wrong: a game drawn without a canvas (e.g. Coreball)
    if (m.textLen > 0 && !errors.length) return { s: "ok", note: "game without a canvas", sizeKb };
    // Drawn with plain elements (boxes, images) rather than a canvas, e.g. 404ms
    if (m.painted > 0.1 && !loading && !errors.some(e => e.startsWith("Script error"))) return { s: "ok", note: "game without a canvas", sizeKb };
    // Only problem: files the test server couldn't download from jsDelivr or GitHub
    const cdnOnly = errors.length && errors.every(e => /^(Failed|HTTP (403|429|5\d\d)) https?:\/\/[^/]*(jsdelivr\.net|githubusercontent\.com|githack\.com)\//.test(e) || [...cdnRefused].some(u => e.includes(u.slice(0, 150))) || /^Script error: \w+ is not defined$/.test(e));
    if (cdnOnly && errors.some(e => !e.startsWith("Script error"))) return { s: "slow", why: "The test server couldn't download this game's files (it usually works for players)", errors };
    if (loading) return { s: "slow", why: `Still loading after ${Math.round((Date.now() - t0) / 1000)}s: "${m.text.slice(0, 60)}"`, errors };
    if (errors.length) return { s: "broken", why: pickWhy(), errors };
    return { s: "broken", why: m.textLen ? `Shows only: "${m.text.slice(0, 60)}"` : "Blank page", errors };
}

// A game that freezes the test browser makes page calls wait forever (one
// night that used up the whole 3-hour run and nothing was saved). Every step
// gets a time limit, and a stuck page is thrown away.
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(what), { stuck: true })), ms))]);
const closeCtx = ctx => withTimeout(ctx.close(), 15000, "close").catch(() => {});
const GAME_LIMIT_MS = { [WAIT_MS]: 75000, [CONFIRM_WAIT_MS]: 110000 + LOADING_EXTRA_MS };

const w0 = await makePage();
const all = await w0.page.evaluate(() => zones
    .filter(z => Number(z.id) >= 0 && z.url && !(typeof isPartnerZone === "function" && isPartnerZone(z)) && !String(z.url).startsWith("http") && !z.newTab)
    .map(z => ({ id: String(z.id), name: z.name })));
all.sort((a, b) => Number(a.id) - Number(b.id));
await closeCtx(w0.ctx);

let list;
// Tonight's batch, and how far into it the run has got. "next" (where tomorrow's
// batch starts) only moves past games that were actually checked, so a run cut
// off by the time limit picks up where it stopped instead of skipping the rest.
let batch = [], batchStart = 0, batchDone = 0;
const checkedIds = new Set();
function advanceNext() {
    while (batchDone < batch.length && checkedIds.has(batch[batchDone].id)) batchDone++;
    health.next = (batchStart + batchDone) % Math.max(1, all.length);
}
// Games players reported broken in the last 2 weeks
let reported = [];
try {
    reported = await reportedGames();
    console.log(`Reported broken by players: ${reported.length}`);
    for (const r of reported) console.log(`  report ${r.id} ${(all.find(z => z.id === r.id) || {}).name || "(not on the site)"}: ${r.reports} report(s)${r.trusted ? ", trusted reporter" : ""}, last ${r.last.slice(0, 10)}`);
} catch (e) { console.log("Couldn't read the broken reports:", e.message); }
const reportedIds = new Set(reported.map(r => r.id));
const only = arg("ids");
if (process.argv.includes("--reported")) {
    list = all.filter(z => reportedIds.has(z.id));
} else if (only) {
    const want = new Set(only.split(","));
    list = all.filter(z => want.has(z.id));
} else {
    const start = (health.next || 0) % Math.max(1, all.length);
    batchStart = start;
    batch = all.slice(start, start + BATCH).concat(all.slice(0, Math.max(0, Math.min(start, start + BATCH - all.length))));
    // Plus everything that failed last time
    const failed = all.filter(z => health.games[z.id] && health.games[z.id].s !== "ok" && !batch.includes(z));
    const rep = all.filter(z => reportedIds.has(z.id) && !batch.includes(z) && !failed.includes(z));
    list = [...rep, ...failed, ...batch];
}
console.log(`Checking ${list.length} of ${all.length} games`);

// Results are saved after every game, so a run that's cut off still keeps what it checked
function saveHealth(final) {
    if (final) {
        const ids = new Set(all.map(z => z.id));
        for (const id of Object.keys(health.games)) if (!ids.has(id)) delete health.games[id];   // games that left the site
    }
    health.updated = new Date().toISOString();
    health.total = all.length;
    health.counts = Object.values(health.games).reduce((c, g) => (c[g.s] = (c[g.s] || 0) + 1, c), {});
    fs.writeFileSync(OUT, JSON.stringify(health, null, 1) + "\n");
    if (final) { const ids = new Set(all.map(z => z.id)); for (const id of Object.keys(sizes.kb)) if (!ids.has(id)) delete sizes.kb[id]; }
    sizes.updated = new Date().toISOString();
    fs.writeFileSync(SIZES_OUT, JSON.stringify(sizes) + "\n");
    return health.counts;
}
const queue = [...list];
const today = new Date().toISOString().slice(0, 10);
async function worker() {
    let w = await makePage(), n = 0;
    const fresh = async () => { await closeCtx(w.ctx); w = await makePage(); n = 0; };
    const run = async (z, waitMs) => {
        try { return await withTimeout(check(w, z, waitMs), GAME_LIMIT_MS[waitMs], "stuck"); }
        catch (e) {
            if (e.stuck) return { s: "slow", why: "The game froze the test browser (it may still work for players)", errors: [...new Set(w.st.errors)].slice(0, 4), stuck: true };
            return { s: "broken", why: "Test error: " + String(e.message || e).slice(0, 120) };
        }
    };
    while (queue.length && (Date.now() - started) / 60000 < MAX_MINUTES) {
        const z = queue.shift();
        let r = await run(z, WAIT_MS);
        // Double-check failures with more time and a fresh page before calling them broken
        // (a game that froze the browser isn't tried again: it would just freeze it again)
        if (r.stuck) await fresh();
        else if (r.s !== "ok") { await fresh(); r = await run(z, CONFIRM_WAIT_MS); if (r.stuck) await fresh(); }
        delete r.stuck;
        // Only a game that worked was measured properly; a cut-off measurement (0) isn't kept
        if (r.s === "ok" && r.sizeKb > 0) sizes.kb[z.id] = r.sizeKb;
        delete r.sizeKb;
        const prev = health.games[z.id];
        health.games[z.id] = { s: r.s, at: today, t: new Date().toISOString(), ...(r.why ? { why: r.why } : {}), ...(r.errors && r.errors.length ? { errors: r.errors } : {}),
            ...(r.s !== "ok" ? { since: prev && prev.s === r.s && prev.since ? prev.since : today } : {}) };
        console.log(`${z.id} ${z.name}: ${r.s}${r.why ? " - " + r.why : ""}`);
        checkedIds.add(z.id);
        if (batch.length) advanceNext();
        saveHealth(false);
        if (++n % 8 === 0) await fresh();
    }
    await closeCtx(w.ctx);
}
// Stop by the time limit even if a worker is stuck somewhere unexpected
await Promise.race([Promise.all(Array.from({ length: WORKERS }, worker)), new Promise(r => setTimeout(r, (MAX_MINUTES + 10) * 60000 - (Date.now() - started)))]);
console.log("Done:", JSON.stringify(saveHealth(true)));
await withTimeout(browser.close(), 20000, "close").catch(() => {});
process.exit(0);
