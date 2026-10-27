// ═════════════════════════════════════════════════════════════════════════════
// "🔥 N playing now" on game cards, and the "Top 10 this week" row.
//
// Each browser's online heartbeat (presence.js) also says which game is open
// (g: the game id, nothing else). Every 5 minutes ONE browser, whichever
// notices first, adds those up and saves the result in two small documents:
//   live/now        { at, online, games: { id: players } }   (replaced)
//   live/w<YYYYWW>  { at, p: { id: playerSnapshots } }       (added to all week)
// Everyone else just reads live/now (one read every 5 minutes, which replaces
// the old per-browser online count) and the week document once per half hour.
// A precondition on the write makes sure only one browser's count is saved per
// round. The database rules only let these documents change every 2 minutes.
// ═════════════════════════════════════════════════════════════════════════════
const LIVE = {
    roundMs: 5 * 60 * 1000,        // how often the counts are added up
    readMs: 5 * 60 * 1000,         // how often a browser reads live/now
    weekReadMs: 30 * 60 * 1000,    // how often a browser reads the week document
    activeMs: 5 * 60 * 1000,       // presence seen this recently = online
    sharedKey: "gnmath-live-shared",
    weekKey: "gnmath-cache-live-week",
    top10Min: 3                    // a game needs this many snapshots to count as "played here"
};
let liveNow = null;     // { online, games: Map id→n, at }
let liveWeek = null;    // { week, p: { id: n }, readAt }

function liveWeekId(at = Date.now()) {
    // ISO week (weeks start Monday), as w + year + week number: w202644
    const d = new Date(at);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    const wk = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return `w${y}${String(wk).padStart(2, "0")}`;
}
function liveCount(id) { return liveNow && liveNow.games ? liveNow.games.get(String(id)) || 0 : 0; }
window.gnLiveFresh = () => !!(liveNow && Date.now() - liveNow.at < LIVE.roundMs + 3 * 60 * 1000);

// ── Badges on cards ─────────────────────────────────────────────────────────
function liveBadgeText(n) { return n === 1 ? "1 playing" : `${n} playing`; }
function addLiveBadge(card, id) {
    const n = liveCount(id);
    let b = card.querySelector(".card-live");
    if (!n) { if (b) b.remove(); return; }
    if (!b) {
        b = document.createElement("div");
        b.className = "card-live";
        let box = card.querySelector(".card-badges");
        if (!box) { box = document.createElement("div"); box.className = "card-badges"; card.appendChild(box); }
        box.prepend(b);
    }
    b.textContent = liveBadgeText(n);
    b.title = `${n} ${n === 1 ? "person is" : "people are"} playing this right now`;
}
function applyLiveBadges() {
    document.querySelectorAll(".zone-item[data-id]").forEach(c => addLiveBadge(c, c.dataset.id));
}

// ── Top 10 this week ────────────────────────────────────────────────────────
function top10List() {
    if (!Array.isArray(zones) || !zones.length) return [];
    const ok = z => z && !isZoneDisabled(z.id) && !(typeof isPartnerZone === "function" && isPartnerZone(z)) && Number(z.id) >= 0;
    const byId = new Map(zones.map(z => [String(z.id), z]));
    const out = [], seen = new Set();
    // Played here this week (most snapshots first)
    const p = liveWeek && liveWeek.week === liveWeekId() ? liveWeek.p : {};
    Object.entries(p || {}).filter(([, n]) => n >= LIVE.top10Min).sort((a, b) => b[1] - a[1])
        .forEach(([id]) => { const z = byId.get(id); if (ok(z) && out.length < 10 && !seen.has(id)) { out.push({ z, here: true }); seen.add(id); } });
    // Not enough yet (start of the week): fill up with what's popular this week
    // across every site that uses the game library
    const week = (typeof popularityData !== "undefined" && popularityData.week) || {};
    Object.entries(week).sort((a, b) => b[1] - a[1])
        .forEach(([id]) => { const z = byId.get(id); if (ok(z) && out.length < 10 && !seen.has(id)) { out.push({ z, here: false }); seen.add(id); } });
    return out;
}
function renderTop10() {
    const wrap = document.getElementById("top10Wrapper");
    const row = document.getElementById("top10Zones");
    if (!wrap || !row) return;
    const list = top10List();
    wrap.hidden = list.length < 5;
    if (wrap.hidden) return;
    const key = list.map(x => x.z.id).join(",");
    if (row.dataset.key === key) { applyLiveBadges(); return; }
    row.dataset.key = key;
    if (typeof clearCards === "function") clearCards(row); else row.innerHTML = "";
    list.forEach((x, i) => {
        const item = document.createElement("div");
        item.className = "t10-item";
        const num = document.createElement("span");
        num.className = "t10-rank";
        num.textContent = String(i + 1);
        num.setAttribute("aria-hidden", "true");
        const card = createZoneCard(x.z);
        card.setAttribute("aria-label", `Number ${i + 1} this week: ${x.z.name}`);
        item.append(num, card);
        row.appendChild(item);
    });
    if (typeof observeLazyZoneImages === "function") observeLazyZoneImages("#top10Zones img.lazy-zone-img");
    const hereCount = list.filter(x => x.here).length;
    const sub = document.getElementById("top10Note");
    if (sub) sub.textContent = hereCount >= 10 ? "Most played on GN 2.0 this week" : hereCount ? "Most played this week" : "Most played this week across the game library";
    applyLiveBadges();
}

// ── Firestore (plain web requests, like presence.js) ────────────────────────
(function () {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) return;
    const P = FIREBASE_CONFIG.projectId, KEY = FIREBASE_CONFIG.apiKey;
    const ROOT = `projects/${P}/databases/(default)/documents`;
    const API = `https://firestore.googleapis.com/v1/${ROOT}`;
    const fbOn = () => typeof fbPaused === "function";
    let busy = false;

    const shared = () => { try { return JSON.parse(localStorage.getItem(LIVE.sharedKey) || "null") || {}; } catch { return {}; } };
    const setShared = v => { try { localStorage.setItem(LIVE.sharedKey, JSON.stringify(v)); } catch {} };
    const intOf = v => Number(v?.integerValue ?? v?.doubleValue ?? 0) || 0;

    async function req(url, opts) {
        const res = await fetch(url, opts);
        if (res.status === 404) return null;
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); if (fbOn()) noteFbError(e); throw e; }
        if (fbOn()) noteFbOk();
        return res.json();
    }
    async function getDoc(path) {
        if (fbOn()) fbCount(1, 0);
        return req(`${API}/${path}?key=${encodeURIComponent(KEY)}`);
    }
    function setNow(doc) {
        if (!doc || !doc.fields) return;
        const f = doc.fields;
        const games = new Map(Object.entries(f.games?.mapValue?.fields || {}).map(([k, v]) => [k, intOf(v)]).filter(([, n]) => n > 0));
        const at = Date.parse(f.at?.timestampValue || doc.updateTime) || Date.now();
        liveNow = { online: intOf(f.online), games, at, updateTime: doc.updateTime };
        setShared({ readAt: Date.now(), online: liveNow.online, games: [...games], at, updateTime: doc.updateTime });
        if (liveNow.online > 0) {
            window.gnActiveUsers = { count: Math.max(1, liveNow.online), at: Date.now(), error: null };
            if (typeof updateSiteStatus === "function") updateSiteStatus();
        }
        applyLiveBadges();
    }

    // Add up everyone's heartbeats and save the round (only one browser wins)
    async function runRound(prev) {
        if (fbOn() && fbBackgroundPaused()) return;
        const cutoff = new Date(Date.now() - LIVE.activeMs).toISOString();
        const out = await req(`${API}:runQuery?key=${encodeURIComponent(KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: "presence" }],
                select: { fields: [{ fieldPath: "g" }] },
                where: { fieldFilter: { field: { fieldPath: "t" }, op: "GREATER_THAN", value: { timestampValue: cutoff } } },
                limit: 3000
            }
        }) });
        const docs = (out || []).filter(x => x && x.document);
        if (fbOn()) fbCount(Math.max(1, docs.length), 0);
        const counts = {};
        for (const d of docs) {
            const g = d.document.fields?.g?.stringValue;
            if (g && /^\d{1,7}$/.test(g)) counts[g] = (counts[g] || 0) + 1;
        }
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 150);
        const gameFields = Object.fromEntries(top.map(([id, n]) => [id, { integerValue: String(n) }]));
        const week = liveWeekId();
        const writes = [{
            update: { name: `${ROOT}/live/now`, fields: { online: { integerValue: String(docs.length) }, games: { mapValue: { fields: gameFields } } } },
            updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" }],
            currentDocument: prev && prev.updateTime ? { updateTime: prev.updateTime } : { exists: false }
        }];
        if (top.length) writes.push({
            update: { name: `${ROOT}/live/${week}`, fields: {} },
            updateMask: { fieldPaths: [] },
            updateTransforms: [{ fieldPath: "at", setToServerValue: "REQUEST_TIME" },
                ...top.map(([id, n]) => ({ fieldPath: `p.\`${id}\``, increment: { integerValue: String(n) } }))]
        });
        const commit = w => req(`${API}:commit?key=${encodeURIComponent(KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writes: [w] }) });
        try {
            if (fbOn()) fbCount(0, 1);
            await commit(writes[0]);
        } catch (e) {
            // Another browser saved this round first (precondition), or rules not published yet
            return;
        }
        // This browser won the round: add it to the week too
        if (writes[1]) {
            try { if (fbOn()) fbCount(0, 1); await commit(writes[1]); } catch (e) { console.info("Weekly count not saved:", e.message || e); }
        }
        liveNow = { online: docs.length, games: new Map(top), at: Date.now(), updateTime: null };
        setShared({ readAt: Date.now(), online: docs.length, games: top, at: Date.now(), updateTime: null });
        window.gnActiveUsers = { count: Math.max(1, docs.length), at: Date.now(), error: null };
        if (typeof updateSiteStatus === "function") updateSiteStatus();
        // The week document changed: refresh the Top 10 soon
        if (liveWeek) liveWeek.readAt = 0;
        applyLiveBadges();
    }

    async function tick() {
        if (document.hidden || busy) return;
        if (fbOn() && fbPaused()) return;
        busy = true;
        try {
            const s = shared();
            const readEvery = fbOn() ? fbEvery(LIVE.readMs) : LIVE.readMs;
            if (Date.now() - (s.readAt || 0) < readEvery) {
                // Another tab read it recently
                if (s.games) { liveNow = { online: s.online, games: new Map(s.games), at: s.at, updateTime: s.updateTime }; applyLiveBadges(); }
            } else {
                const doc = await getDoc("live/now");
                if (doc) setNow(doc); else setShared({ ...s, readAt: Date.now() });
                const age = doc ? Date.now() - (Date.parse(doc.fields?.at?.timestampValue || doc.updateTime) || 0) : Infinity;
                // Stale: this browser does the round (a little random wait spreads browsers out)
                const roundEvery = fbOn() ? fbEvery(LIVE.roundMs) : LIVE.roundMs;
                if (age > roundEvery + Math.random() * 60000) await runRound(doc);
            }
            await readWeek();
        } catch (e) {
            console.info("Live counts unavailable:", e.message || e);
        } finally {
            busy = false;
        }
        renderTop10();
    }
    async function readWeek() {
        if (!liveWeek) { try { liveWeek = JSON.parse(localStorage.getItem(LIVE.weekKey) || "null"); } catch {} }
        const week = liveWeekId();
        if (liveWeek && liveWeek.week === week && Date.now() - (liveWeek.readAt || 0) < LIVE.weekReadMs) return;
        if (fbOn() && fbBackgroundPaused()) return;
        const doc = await getDoc(`live/${week}`);
        const p = {};
        for (const [k, v] of Object.entries(doc?.fields?.p?.mapValue?.fields || {})) p[k] = intOf(v);
        liveWeek = { week, p, readAt: Date.now() };
        try { localStorage.setItem(LIVE.weekKey, JSON.stringify(liveWeek)); } catch {}
    }
    window.refreshLive = tick;

    // Opening and closing games updates this browser's heartbeat soon after
    const wrapGame = () => {
        const o = window.openZone, c = window.closeZone;
        if (typeof o === "function" && !o.__live) { window.openZone = function () { const r = o.apply(this, arguments); setTimeout(() => { window.presenceGameChanged && window.presenceGameChanged(); window.profileGameChanged && window.profileGameChanged(); }, 0); return r; }; window.openZone.__live = true; }
        if (typeof c === "function" && !c.__live) { window.closeZone = function () { const r = c.apply(this, arguments); window.presenceGameChanged && window.presenceGameChanged(); window.profileGameChanged && window.profileGameChanged(); return r; }; window.closeZone.__live = true; }
    };
    if (document.readyState === "complete") wrapGame(); else window.addEventListener("load", wrapGame);
    // Top 10 from the saved week counts right away (or a quick read on a first visit)
    setTimeout(() => { readWeek().catch(() => {}).finally(renderTop10); }, 1200);
    // After the online heartbeat has started (presence.js waits 4s)
    setTimeout(() => { tick(); setInterval(tick, 30000); }, 7000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
})();
