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
    idKey: "gnmath-presence-id"
};
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function beat() {
        if (document.hidden) return;
        lastBeat = Date.now();
        try {
            await post("commit", { writes: [{
                update: { name: `projects/${P}/databases/(default)/documents/presence/${presenceId()}`, fields: { s: { stringValue: PRESENCE.site } } },
                updateTransforms: [{ fieldPath: "t", setToServerValue: "REQUEST_TIME" }]
            }] });
        } catch (e) {
            window.gnActiveUsers.error = String(e.message || e);
            console.info("Online count unavailable:", e.message || e);
        }
    }

    async function count(force) {
        if (counting || (!force && Date.now() - lastCount < 30000)) return;
        counting = true;
        lastCount = Date.now();
        try {
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
            if (typeof updateSiteStatus === "function") updateSiteStatus();
        } catch (e) {
            window.gnActiveUsers.error = String(e.message || e);
        } finally {
            counting = false;
        }
    }
    window.refreshActiveUsers = () => count(false);

    // Wait until the page has settled so this never slows down the first load
    setTimeout(async () => {
        await beat();
        count(true);
        setInterval(() => {
            if (document.hidden) return;
            if (Date.now() - lastBeat >= PRESENCE.heartbeatMs - 1000) beat();
            if (Date.now() - lastCount >= PRESENCE.countEveryMs) count(true);
        }, 30000);
    }, 4000);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && lastBeat && Date.now() - lastBeat >= PRESENCE.heartbeatMs) { beat().then(() => count(true)); }
    });
})();
