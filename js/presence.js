// ═════════════════════════════════════════════════════════════════════════════
// "People online now". Each open copy of the site writes a tiny note to the
// Firestore collection presence/<random id> every couple of minutes:
// { t: server time, s: "gn2", g: game open now }. The id is random and lives
// only in this browser. Anyone seen in the last 5 minutes counts as online.
// Counting uses Firestore's count query, which costs about one read per 1,000
// people online. Works without an account.
//
// Sessions (Admin Panel → Sessions): at the start of each visit the same
// browser also writes sessions/<same id> with when the visit started and its
// browser, system, screen, language, time zone and site address. Only admins
// can read those. A signed-in account's profile notes its session id, so
// admins can see which account a session belongs to.
//
// Booting: an admin can write boots/<session id> (until when, and why).
// realtime.js listens to that document, so it arrives within seconds; this
// page then saves the player's progress (cloud save if signed in), closes the
// game and shows a "you've been removed" screen until the boot ends or is
// lifted. Every tab in that browser shows it.
// Needs the presence, sessions and boots rules from config/firestore.rules.
// ═════════════════════════════════════════════════════════════════════════════
const PRESENCE = {
    heartbeatMs: 2 * 60 * 1000,   // how often an open tab says "still here"
    activeMs: 5 * 60 * 1000,      // seen within this long = online
    countEveryMs: 3 * 60 * 1000,  // how often the number refreshes
    site: "gn2",
    idKey: "gnmath-presence-id",
    sharedKey: "gnmath-presence-shared",  // last heartbeat + count, shared by tabs
    bootKey: "gnmath-booted"              // { until, reason } while this browser is booted
};
// Busy times stretch these (firebase-pace.js). The heartbeat stays under
// activeMs so people don't drop out of the count.
const fbOn = () => typeof fbPaused === "function";
function presenceBeatMs() { return fbOn() ? fbEvery(PRESENCE.heartbeatMs, 2) : PRESENCE.heartbeatMs; }
function presenceCountMs() { return fbOn() ? fbEvery(PRESENCE.countEveryMs) : PRESENCE.countEveryMs; }
function presenceShared() {
    try { return JSON.parse(localStorage.getItem(PRESENCE.sharedKey) || "null") || {}; } catch { return {}; }
}
function setPresenceShared(changes) {
    try { localStorage.setItem(PRESENCE.sharedKey, JSON.stringify({ ...presenceShared(), ...changes })); } catch {}
}
// Each heartbeat also carries this browser's Firebase read/write count for
// today as u: { "<Pacific date>": { r, w } }, and the count step adds everyone's
// up, so the site can see roughly how much of Firebase's daily limit is used
// (firebase-pace.js). Needs the updated presence rule; until it's published the
// heartbeat falls back to the old fields.
const PRESENCE_NO_USAGE_KEY = "gnmath-presence-no-usage";
function presenceUsageAllowed() {
    try { return Date.now() - Number(localStorage.getItem(PRESENCE_NO_USAGE_KEY) || 0) > 6 * 3600000; } catch { return true; }
}
const PRESENCE_NO_GAME_KEY = "gnmath-presence-no-game";
function presenceGameAllowed() {
    try { return Date.now() - Number(localStorage.getItem(PRESENCE_NO_GAME_KEY) || 0) > 6 * 3600000; } catch { return true; }
}
// Read by the status light (status.js)
window.gnActiveUsers = { count: null, at: 0, error: null };

(function () {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) return;
    // Plain web requests to Firestore instead of the Firebase library, so this
    // adds almost nothing to the page.
    const P = FIREBASE_CONFIG.projectId, KEY = FIREBASE_CONFIG.apiKey;
    const API = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
    let lastBeat = 0, lastCount = 0, counting = false;

    function presenceId() {
        let id = null;
        try { id = localStorage.getItem(PRESENCE.idKey); } catch {}
        if (!id || !/^[A-Za-z0-9]{20}$/.test(id)) {
            const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            const r = crypto.getRandomValues(new Uint8Array(20));
            id = Array.from(r, b => abc[b % abc.length]).join("");
            try { localStorage.setItem(PRESENCE.idKey, id); } catch {}
        }
        return id;
    }
    async function post(path, body) {
        const res = await fetch(`${API}:${path}?key=${encodeURIComponent(KEY)}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            if (fbOn()) noteFbError(err);
            throw err;
        }
        if (fbOn()) noteFbOk();
        return res.json();
    }

    // The game open right now (only its id), for "N playing now" (live.js)
    function currentGame() {
        try {
            const viewer = document.getElementById("zoneViewer");
            const id = typeof currentGameId !== "undefined" && currentGameId ? String(currentGameId) : "";
            return viewer && viewer.style.display === "flex" && /^\d{1,7}$/.test(id) && !document.hidden ? id : "";
        } catch { return ""; }
    }

    window.gnSessionId = presenceId;

    // ── Session details (written once per visit, admins-only) ─────────────────
    function browserInfo() {
        const ua = navigator.userAgent || "";
        const uad = navigator.userAgentData;
        let browser = "Other", os = "Other";
        const m = (re) => { const r = re.exec(ua); return r ? r[1].split(".")[0] : ""; };
        if (/Edg\//.test(ua)) browser = "Edge " + m(/Edg\/([\d.]+)/);
        else if (/OPR\//.test(ua)) browser = "Opera " + m(/OPR\/([\d.]+)/);
        else if (/Firefox\//.test(ua)) browser = "Firefox " + m(/Firefox\/([\d.]+)/);
        else if (/CriOS\//.test(ua)) browser = "Chrome (iOS) " + m(/CriOS\/([\d.]+)/);
        else if (/Chrome\//.test(ua)) browser = "Chrome " + m(/Chrome\/([\d.]+)/);
        else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari " + m(/Version\/([\d.]+)/);
        if (/CrOS/.test(ua)) os = "ChromeOS";
        else if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
        else if (/Windows NT/.test(ua)) os = "Windows";
        else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
        else if (/Mac OS X/.test(ua)) os = (navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS");
        else if (/Android/.test(ua)) os = "Android " + m(/Android ([\d.]+)/);
        else if (/Linux/.test(ua)) os = "Linux";
        if (uad && uad.platform === "Chrome OS") os = "ChromeOS";
        const mobile = (uad && uad.mobile) || /Mobi|iPhone|Android.+Mobile/.test(ua);
        const tablet = !mobile && (/iPad|Tablet|Android/.test(ua) || (os === "iPadOS"));
        let tz = "";
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
        const str = (v, n) => ({ stringValue: String(v || "").slice(0, n) });
        return {
            s: { stringValue: PRESENCE.site },
            b: str(browser, 40),
            os: str(os, 40),
            d: str(mobile ? "phone" : tablet ? "tablet" : "computer", 10),
            sc: str(`${screen.width || 0}x${screen.height || 0}`, 12),
            lang: str(navigator.language, 20),
            tz: str(tz, 60),
            host: str(location.host, 100)
        };
    }
    const PRESENCE_NO_SESSION_KEY = "gnmath-presence-no-session";
    async function writeSession() {
        try { if (Date.now() - Number(localStorage.getItem(PRESENCE_NO_SESSION_KEY) || 0) < 6 * 3600000) return; } catch {}
        try {
            if (fbOn()) fbCount(0, 1);
            await post("commit", { writes: [{
                update: { name: `projects/${P}/databases/(default)/documents/sessions/${presenceId()}`, fields: browserInfo() },
                updateTransforms: [{ fieldPath: "st", setToServerValue: "REQUEST_TIME" }]
            }] });
        } catch (e) {
            // Rules without sessions yet: try again in a few hours
            if (/HTTP 403/.test(e.message)) { try { localStorage.setItem(PRESENCE_NO_SESSION_KEY, String(Date.now())); } catch {} }
        }
    }

    // ── Booting ─────────────────────────────────────────────────────────────────
    let booted = false;
    function bootFlag() {
        try { const b = JSON.parse(localStorage.getItem(PRESENCE.bootKey) || "null"); return b && b.until > Date.now() ? b : null; } catch { return null; }
    }
    // Asks the database whether this browser is booted (one read; only after a
    // refused heartbeat or when a boot is remembered here)
    async function fetchBoot() {
        const res = await fetch(`${API}/boots/${presenceId()}?key=${encodeURIComponent(KEY)}`);
        if (fbOn()) fbCount(1, 0);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const f = (await res.json()).fields || {};
        const until = Date.parse(f.until?.timestampValue || "") || 0;
        return until > Date.now() ? { until, reason: f.reason?.stringValue || "" } : null;
    }
    async function applyBoot(b) {
        if (booted) return;
        booted = true;
        try { localStorage.setItem(PRESENCE.bootKey, JSON.stringify(b)); } catch {}
        // Save their progress first: games save into this browser, and a
        // signed-in player's cloud save gets one last upload
        // The game is closed first, so its last progress is in what's uploaded
        try { if (typeof closeZone === "function") closeZone(); } catch {}
        try { await Promise.race([Promise.resolve(window.gnGameFlush), new Promise(r => setTimeout(r, 4000))]); } catch {}
        try {
            if (typeof cloudUser !== "undefined" && cloudUser && typeof uploadCloudSave === "function") {
                await Promise.race([uploadCloudSave({ background: true }), new Promise(r => setTimeout(r, 8000))]);
            }
        } catch {}
        showBootScreen(b);
    }
    function showBootScreen(b) {
        let el = document.getElementById("gn-boot-screen");
        if (!el) {
            el = document.createElement("div");
            el.id = "gn-boot-screen";
            el.setAttribute("role", "alertdialog");
            el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0b10;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center";
            document.body.appendChild(el);
        }
        const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
        const forever = b.until > Date.now() + 5 * 365 * 86400000;
        const when = forever ? "" : new Date(b.until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
        el.innerHTML = `<div style="max-width:420px"><h2 style="margin:0 0 8px;font-size:24px">You've been removed from GN 2.0</h2>` +
            (b.reason ? `<p style="margin:0 0 8px">Reason: ${esc(b.reason)}</p>` : "") +
            `<p style="margin:0;opacity:.75">${forever ? "An admin removed this session." : `You can come back after ${esc(when)}.`} Your game progress was saved.</p></div>`;
        document.documentElement.style.overflow = "hidden";
    }
    // Lifted (realtime.js saw the boot document go away): let them back in
    function liftBoot() {
        if (!booted && !bootFlag()) return;
        try { localStorage.removeItem(PRESENCE.bootKey); } catch {}
        if (booted) location.reload();
    }
    // Without the live connection, check now and then instead (one read each)
    let bootPoll = null;
    function bootListenFailed() {
        if (bootPoll) return;
        bootPoll = setInterval(() => {
            if (document.hidden) return;
            fetchBoot().then(b => { if (b) applyBoot(b); else liftBoot(); }).catch(() => {});
        }, 5 * 60000);
    }
    window.gnBoot = { apply: b => applyBoot(b), lift: liftBoot, listenFailed: bootListenFailed };
    // Every tab in this browser: show it when another tab finds the boot
    window.addEventListener("storage", e => {
        if (e.key !== PRESENCE.bootKey) return;
        const b = bootFlag();
        if (b && !booted) applyBoot(b);
        else if (!b && booted) location.reload();
    });
    // A boot remembered from before: show it right away, then ask the database
    // whether it still stands (an admin may have lifted it)
    (function () {
        const b = bootFlag();
        if (!b) return;
        const show = () => { booted = true; showBootScreen(b); };
        if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
        // (realtime.js's live listener confirms it or lifts it; this is the backup)
        setTimeout(() => {
            if (!booted) return;
            fetchBoot().then(now => {
                if (now) { try { localStorage.setItem(PRESENCE.bootKey, JSON.stringify(now)); } catch {} return; }
                liftBoot();
            }).catch(() => {});
        }, 20000);
    })();

    let gameNoted = "";
    function beatBody(withUsage) {
        const fields = { s: { stringValue: PRESENCE.site } };
        const g = presenceGameAllowed() ? currentGame() : "";
        gameNoted = g;
        if (g) fields.g = { stringValue: g };
        if (withUsage && fbOn()) {
            const t = getFbTally();
            fields.u = { mapValue: { fields: { [t.day]: { mapValue: { fields: {
                r: { integerValue: String(Math.min(100000, t.r)) },
                w: { integerValue: String(Math.min(100000, t.w)) }
            } } } } } };
        }
        return { writes: [{
            update: { name: `projects/${P}/databases/(default)/documents/presence/${presenceId()}`, fields },
            updateTransforms: [{ fieldPath: "t", setToServerValue: "REQUEST_TIME" }]
        }] };
    }
    // The GN 2.0 Server takes the heartbeat when it can be reached (no Firebase
    // write); it adds everyone up and writes the live/now summary itself. If it
    // can't be reached, the heartbeat goes to Firestore like before (and the
    // server is tried again 5 minutes later).
    async function beatServer() {
        if (typeof HOME_SERVER === "undefined" || (window.gnHomeDownUntil || 0) > Date.now()) return false;
        const body = { id: presenceId(), s: PRESENCE.site, g: presenceGameAllowed() ? currentGame() : "" };
        if (fbOn()) { const t = getFbTally(); body.u = { [t.day]: { r: Math.min(100000, t.r), w: Math.min(100000, t.w) } }; }
        try {
            const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 8000);
            const res = await fetch(HOME_SERVER + "/api/presence", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), signal: ctrl.signal }).finally(() => clearTimeout(timer));
            if (res.ok) { gameNoted = body.g; return true; }
        } catch {}
        window.gnHomeDownUntil = Date.now() + 5 * 60000;
        return false;
    }
    async function beat() {
        if (booted || document.hidden || (fbOn() && fbBackgroundPaused())) return;
        lastBeat = Date.now();
        // Tabs in this browser share one id, so one heartbeat covers them all
        const prevBeat = presenceShared().beatAt || 0;
        if (Date.now() - prevBeat < presenceBeatMs() - 30000) return;
        setPresenceShared({ beatAt: Date.now() });
        // Nothing from this browser for a while: a new visit, so a new session
        const newVisit = Date.now() - Math.max(prevBeat, presenceShared().sessionAt || 0) > PRESENCE.activeMs;
        try {
            if (await beatServer()) {
                if (newVisit) { setPresenceShared({ sessionAt: Date.now() }); writeSession(); }
                return;
            }
            if (fbOn()) fbCount(0, 1);
            const withUsage = presenceUsageAllowed();
            try {
                await post("commit", beatBody(withUsage));
            } catch (e) {
                // Refused: first check whether an admin booted this browser
                if (/HTTP 403/.test(e.message)) {
                    const b = await fetchBoot().catch(() => null);
                    if (b) { applyBoot(b); return; }
                }
                // Old database rules don't allow the game field yet: stop sending it for a while
                if (/HTTP 403/.test(e.message) && gameNoted) {
                    try { localStorage.setItem(PRESENCE_NO_GAME_KEY, String(Date.now())); } catch {}
                    if (fbOn()) fbCount(0, 1);
                    await post("commit", beatBody(withUsage));
                    return;
                }
                // Old database rules don't allow the usage field yet: send without it
                if (!withUsage || !/HTTP 403/.test(e.message)) throw e;
                try { localStorage.setItem(PRESENCE_NO_USAGE_KEY, String(Date.now())); } catch {}
                if (fbOn()) fbCount(0, 1);
                await post("commit", beatBody(false));
            }
            if (newVisit) { setPresenceShared({ sessionAt: Date.now() }); writeSession(); }
        } catch (e) {
            window.gnActiveUsers.error = String(e.message || e);
            console.info("Online count unavailable:", e.message || e);
        }
    }

    async function count(force) {
        if (counting || (!force && Date.now() - lastCount < 30000)) return;
        // live.js reads the online count together with the "playing now" counts
        if (typeof window.gnLiveFresh === "function" && window.gnLiveFresh()) { lastCount = Date.now(); if (fbOn()) sumUsageSometimes(); return; }
        lastCount = Date.now();
        // Use a count another tab got recently instead of asking again
        const shared = presenceShared();
        if (Number.isFinite(shared.count) && Date.now() - (shared.countAt || 0) < (force ? presenceCountMs() : 30000) - 5000) {
            window.gnActiveUsers = { count: shared.count, at: shared.countAt, error: null };
            if (typeof updateSiteStatus === "function") updateSiteStatus();
            return;
        }
        if (fbOn() && fbPaused()) return;
        counting = true;
        if (fbOn()) sumUsage();
        try {
            if (fbOn()) fbCount(1, 0);
            const out = await post("runAggregationQuery", { structuredAggregationQuery: {
                structuredQuery: {
                    from: [{ collectionId: "presence" }],
                    where: { fieldFilter: { field: { fieldPath: "t" }, op: "GREATER_THAN", value: { timestampValue: new Date(Date.now() - PRESENCE.activeMs).toISOString() } } }
                },
                aggregations: [{ alias: "n", count: {} }]
            } });
            const n = Number((Array.isArray(out) ? out : [out]).map(x => x?.result?.aggregateFields?.n?.integerValue).find(v => v != null));
            if (!Number.isFinite(n)) throw new Error("bad count");
            window.gnActiveUsers = { count: Math.max(1, n), at: Date.now(), error: null };
            setPresenceShared({ count: Math.max(1, n), countAt: Date.now() });
            if (typeof updateSiteStatus === "function") updateSiteStatus();
        } catch (e) {
            window.gnActiveUsers.error = String(e.message || e);
        } finally {
            counting = false;
        }
    }
    window.refreshActiveUsers = () => count(false);
    // The usage total still needs adding up now and then when live.js does the count
    let lastUsageSum = 0;
    function sumUsageSometimes() {
        if (Date.now() - lastUsageSum < presenceCountMs()) return;
        lastUsageSum = Date.now();
        sumUsage();
    }
    // Opening or closing a game: tell the others soon (at most every 20 seconds)
    window.presenceGameChanged = function () {
        if (!presenceGameAllowed() || currentGame() === gameNoted) return;
        const wait = Math.max(0, 20000 - (Date.now() - lastBeat));
        clearTimeout(window.__gnPresenceGameTimer);
        window.__gnPresenceGameTimer = setTimeout(() => {
            if (currentGame() === gameNoted) return;
            setPresenceShared({ beatAt: 0 });
            beat();
        }, wait + 1500);
    };

    // Adds up every browser's Firebase count for today (about 1 read per 1,000 browsers)
    async function sumUsage() {
        // The GN 2.0 Server adds everyone's usage up (live.js gets it from there)
        if (Date.now() - (window.gnServerUsageAt || 0) < 10 * 60000) return;
        const day = fbDayKey();
        try {
            fbCount(1, 0);
            const out = await post("runAggregationQuery", { structuredAggregationQuery: {
                structuredQuery: { from: [{ collectionId: "presence" }] },
                aggregations: [
                    { alias: "r", sum: { field: { fieldPath: `u.\`${day}\`.r` } } },
                    { alias: "w", sum: { field: { fieldPath: `u.\`${day}\`.w` } } }
                ]
            } });
            const f = (Array.isArray(out) ? out : [out]).map(x => x?.result?.aggregateFields).find(Boolean);
            if (!f) return;
            const num = v => Number(v?.integerValue ?? v?.doubleValue ?? 0) || 0;
            // Nobody has reported yet today (e.g. old rules): don't show a fake zero
            const r = num(f.r), w = num(f.w);
            if (r + w > 0) setFbUsage(r, w);
        } catch (e) {
            console.info("Firebase usage total unavailable:", e.message || e);
        }
    }

    // Wait until the page has settled so this never slows down the first load
    setTimeout(async () => {
        await beat();
        count(true);
        setInterval(() => {
            if (document.hidden) return;
            if (Date.now() - lastBeat >= presenceBeatMs() - 1000) beat();
            if (Date.now() - lastCount >= presenceCountMs()) count(true);
        }, 30000);
    }, 4000);
    document.addEventListener("visibilitychange", () => {
        if (!booted && !document.hidden && lastBeat && Date.now() - lastBeat >= presenceBeatMs()) { beat().then(() => count(true)); }
    });
})();
