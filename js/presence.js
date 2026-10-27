// ═════════════════════════════════════════════════════════════════════════════
// "People online now". Each open copy of the site writes a tiny note to the
// Firestore collection presence/<random id> every couple of minutes:
// { t: server time, s: "gn2" }. Nothing about the person is stored; the id is
// random and lives only in this browser. Anyone seen in the last 5 minutes
// counts as online. Counting uses Firestore's count query, which costs about
// about one read per 1,000 people online. Works without an account.
// Needs the presence rule from config/firestore.rules to be published.
// ═════════════════════════════════════════════════════════════════════════════
const PRESENCE = {
    heartbeatMs: 2 * 60 * 1000,   // how often an open tab says "still here"
    activeMs: 5 * 60 * 1000,      // seen within this long = online
    countEveryMs: 3 * 60 * 1000,  // how often the number refreshes
    site: "gn2",
    idKey: "gnmath-presence-id",
    sharedKey: "gnmath-presence-shared"   // last heartbeat + count, shared by tabs
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
    async function beat() {
        if (document.hidden || (fbOn() && fbBackgroundPaused())) return;
        lastBeat = Date.now();
        // Tabs in this browser share one id, so one heartbeat covers them all
        if (Date.now() - (presenceShared().beatAt || 0) < presenceBeatMs() - 30000) return;
        setPresenceShared({ beatAt: Date.now() });
        try {
            if (fbOn()) fbCount(0, 1);
            const withUsage = presenceUsageAllowed();
            try {
                await post("commit", beatBody(withUsage));
            } catch (e) {
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
        if (!document.hidden && lastBeat && Date.now() - lastBeat >= presenceBeatMs()) { beat().then(() => count(true)); }
    });
})();
