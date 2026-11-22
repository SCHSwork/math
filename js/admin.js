// ═════════════════════════════════════════════════════════════════════════════
// Admin, part 2 of 2: the Admin Panel. Loaded only when someone opens it
// (loadAdminPanel() in js/admin-core.js); the role checks, profile heartbeat
// and action log it uses are in js/admin-core.js, which every page loads.
// ═════════════════════════════════════════════════════════════════════════════
let adminData = null;   // { profiles, admins:Set, bans:Map, subs:Map uid→count, stats:Map uid→{votes,reports} }
// Usernames of accounts from before emails, saved in usernames/ so new
// accounts can't take them. Old accounts also claim their own name when they
// sign in (js/accounts.js claimLegacyUsername); this catches the ones that
// haven't. Runs at most once a day per admin device, and never hands a name
// to one of two accounts that both use it (an admin decides those).
async function backfillUsernames() {
    const KEY = "gnmath-usernames-backfilled";
    try { if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 86400000) return; } catch {}
    if (!adminData || !isSiteAdmin()) return;
    try {
        const claims = adminData.claims;
        const uses = new Map();
        for (const p of adminData.profiles) if (/^[a-z0-9_]{3,20}$/.test(p.username || "")) uses.set(p.username, (uses.get(p.username) || 0) + 1);
        const todo = adminData.profiles.filter(p => uses.get(p.username) === 1 && !claims.has(p.username));
        for (let i = 0; i < todo.length; i += 400) {
            const b = cloudDb.batch();
            todo.slice(i, i + 400).forEach(p => b.set(cloudDb.collection("usernames").doc(p.username), { uid: p.uid, e: false }));
            await b.commit();
            todo.slice(i, i + 400).forEach(p => claims.set(p.username, p.uid));
        }
        if (typeof fbCount === "function") fbCount(claims.size + 1, todo.length);
        try { localStorage.setItem(KEY, String(Date.now())); } catch {}
    } catch (e) { console.warn("Couldn't save usernames", e); }
}
// Usernames more than one account shows (from before usernames were all
// claimed): name → uids
function duplicateUsernames() {
    const by = new Map();
    for (const p of (adminData?.profiles || [])) {
        if (!/^[a-z0-9_]{3,20}$/.test(p.username || "")) continue;
        if (!by.has(p.username)) by.set(p.username, []);
        by.get(p.username).push(p.uid);
    }
    return new Map([...by].filter(([, uids]) => uids.length > 1));
}
async function loadAdminData() {
    const [profiles, admins, mods, bans, subs, stats, feedback, perks, usernames] = await Promise.all([
        cloudDb.collection("profiles").get(),
        cloudDb.collection("admins").get(),
        cloudDb.collection("mods").get().catch(() => ({ docs: [] })),
        cloudDb.collection("bans").get(),
        cloudDb.collection("submissions").get().catch(() => ({ docs: [] })),
        cloudDb.collection("gameStats").get().catch(() => ({ docs: [] })),
        cloudDb.collection("feedback").get().catch(() => ({ docs: [] })),
        cloudDb.collection("perks").get().catch(() => ({ docs: [] })),
        cloudDb.collection("usernames").get().catch(() => ({ docs: [] }))
    ]);
    // Per account: which games they liked / disliked and reported as broken
    const statMap = new Map();
    const entryFor = uid => { let s = statMap.get(uid); if (!s) { s = { votes: 0, reports: 0, likes: [], dislikes: [], broken: [] }; statMap.set(uid, s); } return s; };
    for (const d of stats.docs) {
        const data = d.data() || {};
        for (const [k, entry] of Object.entries(data)) {
            if (!/^z/.test(k) || !entry) continue;
            const gameId = k.slice(1);
            for (const [uid, v] of Object.entries(entry.v || {})) { const s = entryFor(uid); s.votes++; (v === -1 ? s.dislikes : s.likes).push({ gameId, shard: d.id }); }
            for (const [uid, at] of Object.entries(entry.r || {})) { const s = entryFor(uid); s.reports++; s.broken.push({ gameId, shard: d.id, at }); }
        }
    }
    const fbMap = new Map();
    feedback.docs.forEach(d => { const f = { id: d.id, ...(d.data() || {}) }; if (f.uid) { if (!fbMap.has(f.uid)) fbMap.set(f.uid, []); fbMap.get(f.uid).push(f); } });
    const subMap = new Map();
    subs.docs.forEach(d => { const u = (d.data() || {}).uid; if (u) subMap.set(u, (subMap.get(u) || 0) + 1); });
    adminData = {
        profiles: profiles.docs.map(d => ({ uid: d.id, ...(d.data() || {}) })),
        admins: new Map(admins.docs.map(d => [d.id, d.data() || {}])),
        mods: new Map(mods.docs.map(d => [d.id, d.data() || {}])),
        bans: new Map(bans.docs.map(d => [d.id, d.data() || {}])),
        perks: new Map(perks.docs.map(d => [d.id, d.data() || {}])),
        subs: subMap,
        stats: statMap,
        feedback: fbMap,
        claims: new Map(usernames.docs.map(d => [d.id, (d.data() || {}).uid]))   // username → uid that owns it
    };
    // Admins/bans whose account has no profile yet still show up
    for (const uid of [...adminData.admins.keys(), ...adminData.mods.keys(), ...adminData.bans.keys()]) {
        if (!adminData.profiles.some(p => p.uid === uid)) {
            adminData.profiles.push({ uid, username: adminData.admins.get(uid)?.name || adminData.mods.get(uid)?.name || adminData.bans.get(uid)?.name || "(no profile yet)" });
        }
    }
    adminData.dupes = duplicateUsernames();
    return adminData;
}

async function openAdminPanel() {
    if (!cloudUser) { notify("Sign in to your admin account first."); openAccountPanel(); return; }
    document.getElementById("popupTitle").textContent = "Admin Panel";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
    if (!isSiteMod()) {
        await syncMyProfileAndRoles(cloudUser);
    }
    if (!isSiteMod()) {
        body.innerHTML = `<p>This account (<b>${escapeHtmlText(currentUsername())}</b>) isn't a game admin or mod.</p>
            <p style="color:var(--text-muted);font-size:14px;">An existing admin can make it one from their Admin Panel. The very first admin is added once in the Firebase console: in <b>Firestore Database → Data</b>, add a document to a collection named <code>admins</code>, using this account's ID <code>${escapeHtmlText(cloudUser.uid)}</code> as the document ID.</p>`;
        return;
    }
    const modOnly = !isSiteAdmin();
    if (modOnly) document.getElementById("popupTitle").textContent = "Mod Panel";
    body.innerHTML = `
        <div class="admin-tabs admin-tabs-wrap" role="tablist">
            <button type="button" role="tab" data-tab="accounts" aria-selected="true">Accounts</button>
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="sessions" aria-selected="false">Sessions</button>`}
            <button type="button" role="tab" data-tab="feedback" aria-selected="false">Reports</button>
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="takedowns" aria-selected="false">Takedowns</button>`}
            <button type="button" role="tab" data-tab="submissions" aria-selected="false">Submissions</button>
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="log" aria-selected="false">Log</button>`}
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="errors" aria-selected="false">Errors <span class="admin-tab-count" id="errors-tab-count" hidden></span></button>`}
            <button type="button" role="tab" data-tab="gamecheck" aria-selected="false">Game check <span class="admin-tab-count" id="gamecheck-tab-count" hidden></span></button>
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="newgames" aria-selected="false">New games${unreviewedNewGames().length ? ` <span class="admin-tab-count">${unreviewedNewGames().length}</span>` : ""}</button>`}
        </div>
        <div id="admin-accounts">
            <div id="admin-visitors" class="admin-visitors"><p class="admin-summary">Loading visitors…</p></div>
            <div class="admin-toolbar">
                <input type="search" id="admin-search" data-no-autofill placeholder="Search usernames…" aria-label="Search accounts" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
                <select id="admin-filter" aria-label="Show">
                    <option value="all">All accounts</option>
                    <option value="online">Online now</option>
                    <option value="admins">Admins</option>
                    <option value="mods">Mods</option>
                    <option value="trusted">Trusted reporters</option>
                    <option value="banned">Suspended</option>
                    <option value="recent">Seen this week</option>
                    <option value="dupes">Duplicate names</option>
                </select>
            </div>
            <p id="admin-summary" class="admin-summary">Loading accounts…</p>
            <div id="admin-list" class="admin-list"></div>
            ${modOnly ? `<p class="admin-footnote">You're a mod, so this list is view-only. Ask an admin to suspend someone or change roles.</p>` : ""}
            <p class="admin-footnote">Passwords and cloud saves are private, even from admins. To delete an account completely or reset a password, use the Firebase console (Authentication → Users). Accounts show up here after they next visit the site.</p>
        </div>
        <div id="admin-sessions" hidden></div>
        <div id="admin-submissions" hidden><div id="owner-submissions" class="owner-panel-list"></div></div>
        <div id="admin-newgames" hidden></div>
        <div id="admin-feedback" hidden></div>
        <div id="admin-takedowns" hidden></div>
        <div id="admin-log" hidden></div>
        <div id="admin-errors" hidden></div>
        <div id="admin-gamecheck" hidden></div>`;
    body.querySelectorAll(".admin-tabs button").forEach(b => b.onclick = () => {
        body.querySelectorAll(".admin-tabs button").forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false"));
        b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        document.getElementById("admin-accounts").hidden = b.dataset.tab !== "accounts";
        document.getElementById("admin-sessions").hidden = b.dataset.tab !== "sessions";
        if (b.dataset.tab === "sessions") renderSessions();
        document.getElementById("admin-submissions").hidden = b.dataset.tab !== "submissions";
        document.getElementById("admin-newgames").hidden = b.dataset.tab !== "newgames";
        document.getElementById("admin-feedback").hidden = b.dataset.tab !== "feedback";
        document.getElementById("admin-takedowns").hidden = b.dataset.tab !== "takedowns";
        document.getElementById("admin-log").hidden = b.dataset.tab !== "log";
        if (document.getElementById("admin-errors")) document.getElementById("admin-errors").hidden = b.dataset.tab !== "errors";
        document.getElementById("admin-gamecheck").hidden = b.dataset.tab !== "gamecheck";
        if (b.dataset.tab === "gamecheck") renderGameCheck();
        if (b.dataset.tab === "errors") renderErrorLog();
        if (b.dataset.tab === "log") renderActionLog();
        if (b.dataset.tab === "takedowns" && typeof renderModTakedowns === "function") renderModTakedowns();
        if (b.dataset.tab === "feedback" && typeof renderModFeedback === "function") renderModFeedback();
        if (b.dataset.tab === "newgames") renderNewLibraryGames();
        if (b.dataset.tab === "submissions" && typeof renderOwnerSubmissions === "function") renderOwnerSubmissions();
    });
    updateGameCheckCount();
    // How many reports and ideas are waiting, shown on the tab
    if (typeof updateFeedbackTabCount === "function") {
        cloudDb.collection("feedback").where("status", "==", "open").get().then(snap => {
            if (typeof fbCount === "function") fbCount(Math.max(1, snap.size), 0);
            if (!modFeedbackCache.length) modFeedbackCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            updateFeedbackTabCount();
        }).catch(() => {});
    }
    // Open error reports seen in the last day, shown on their tab
    if (!modOnly) {
        cloudDb.collection("errorLogs").where("lastAt", ">", new Date(Date.now() - 86400000)).get().then(snap => {
            if (typeof fbCount === "function") fbCount(Math.max(1, snap.size), 0);
            const n = snap.docs.filter(d => (d.data() || {}).status !== "resolved").length;
            const el = document.getElementById("errors-tab-count");
            if (el && n) { el.textContent = n; el.hidden = false; }
        }).catch(() => {});
    }
    // Takedown requests waiting, shown on their tab
    if (!modOnly && typeof updateTakedownTabCount === "function") {
        cloudDb.collection("takedowns").where("status", "in", ["open", "info"]).get().then(snap => {
            if (typeof fbCount === "function") fbCount(Math.max(1, snap.size), 0);
            if (!modTakedowns.length) modTakedowns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            updateTakedownTabCount();
        }).catch(() => {});
    }
    document.getElementById("admin-search").addEventListener("input", renderAdminList);
    document.getElementById("admin-filter").addEventListener("change", renderAdminList);
    try {
        await loadAdminData();
        renderAdminList();
        renderVisitors();
        backfillUsernames();
    } catch (e) {
        console.error(e);
        document.getElementById("admin-summary").textContent = "Couldn't load accounts: " + (typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e);
    }
}

// ── Game check (nightly test of every game: tools/check_games.mjs) ──────────
let gameHealthPromise = null;
function loadGameHealth(force) {
    if (!gameHealthPromise || force) gameHealthPromise = fetch("config/game-health.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
    return gameHealthPromise;
}
function updateGameCheckCount() {
    loadGameHealth().then(h => {
        const c = document.getElementById("gamecheck-tab-count");
        if (!c) return;
        const broken = h ? Object.entries(h.games || {}).filter(([id, g]) => g.s === "broken" && !(typeof isZoneDisabled === "function" && isZoneDisabled(id)) && !gameCheckFixed(id, g)).length : 0;
        c.textContent = broken; c.hidden = !broken;
    });
}
// Marked fixed by an admin after this check ran: hidden until a later check fails again
function gameCheckFixed(id, g) {
    const fixed = typeof getZoneStats === "function" ? getZoneStats(id).fixed || 0 : 0;
    const ran = Date.parse(g.t || "") || Date.parse(g.at || "") || 0;
    return fixed > ran;
}
async function renderGameCheck(force) {
    const box = document.getElementById("admin-gamecheck");
    if (!box) return;
    box.innerHTML = `<p class="admin-summary">Loading the game check…</p>`;
    const h = await loadGameHealth(force);
    if (!h || !h.games) {
        box.innerHTML = `<p class="admin-summary">No results yet. The check runs every night (about 3 AM); to run it now, open the "Nightly game check" workflow in the repo's Actions tab and press "Run workflow".</p>`;
        return;
    }
    const entries = Object.entries(h.games).map(([id, g]) => ({ id, g, z: typeof zoneById === "function" ? zoneById(id) : null })).filter(x => x.z);
    const fixedList = entries.filter(x => x.g.s !== "ok" && gameCheckFixed(x.id, x.g));
    const broken = entries.filter(x => x.g.s === "broken" && !gameCheckFixed(x.id, x.g)), slow = entries.filter(x => x.g.s === "slow" && !gameCheckFixed(x.id, x.g));
    const admin = typeof isSiteAdmin === "function" && isSiteAdmin();
    const okN = entries.filter(x => x.g.s === "ok").length;
    const off = x => typeof isZoneDisabled === "function" && isZoneDisabled(x.id);
    const when = h.updated ? timeAgo(h.updated) : "";
    const row = x => `<div class="gc-row${off(x) ? " gc-off" : ""}" data-id="${escapeHtmlText(x.id)}">
            <div class="gc-main"><b>${escapeHtmlText(x.z.name)}</b> <small>#${escapeHtmlText(x.id)}${off(x) ? " · turned off" : ""} · since ${escapeHtmlText(x.g.since || x.g.at || "")}</small>
            <div class="gc-why">${escapeHtmlText(x.g.why || "")}</div>
            ${x.g.errors && x.g.errors.length > 1 ? `<details class="gc-errs"><summary>${x.g.errors.length} errors</summary>${x.g.errors.map(e => `<div>${escapeHtmlText(e)}</div>`).join("")}</details>` : ""}</div>
            <div class="gc-actions"><button type="button" class="finder-chip gc-open">Open</button>
            ${admin && !gameCheckFixed(x.id, x.g) ? `<button type="button" class="finder-chip gc-fixed">Mark fixed</button>` : ""}
            ${typeof isOwnerBrowser === "function" && isOwnerBrowser() ? `<button type="button" class="finder-chip gc-toggle">${off(x) ? "Turn on" : "Turn off"}</button>` : ""}</div>
        </div>`;
    // Games players reported, with what the game said on their device
    let reported = [];
    try {
        const snap = await cloudDb.collection("brokenDiag").orderBy("at", "desc").limit(200).get();
        const by = new Map();
        snap.docs.forEach(d => {
            const r = d.data();
            if (!by.has(r.gameId)) by.set(r.gameId, []);
            by.get(r.gameId).push(r);
        });
        reported = [...by.entries()].map(([id, list]) => ({ id, list, z: typeof zoneById === "function" ? zoneById(id) : null }));
    } catch (e) { console.warn("Couldn't load the report details", e); }
    const repRow = x => `<div class="gc-row${off(x) ? " gc-off" : ""}" data-id="${escapeHtmlText(x.id)}">
            <div class="gc-main"><b>${escapeHtmlText(x.z ? x.z.name : x.list[0].gameName)}</b> <small>#${escapeHtmlText(x.id)}${off(x) ? " · turned off" : ""} · ${x.list.length} report${x.list.length === 1 ? "" : "s"}, last ${escapeHtmlText(x.list[0].at && x.list[0].at.toDate ? timeAgo(x.list[0].at.toDate().toISOString()) : "just now")}</small>
            ${x.list.map(r => `<details class="gc-errs"><summary>What the game said for ${escapeHtmlText(r.by || "someone")}${r.at && r.at.toDate ? ", " + escapeHtmlText(r.at.toDate().toLocaleString()) : ""}</summary><pre class="game-log">${escapeHtmlText(r.diag || "")}</pre></details>`).join("")}</div>
            <div class="gc-actions">${x.z ? `<button type="button" class="finder-chip gc-open">Open</button>` : ""}
            ${admin ? `<button type="button" class="finder-chip gc-fixed">Mark fixed</button>` : ""}
            ${typeof isOwnerBrowser === "function" && isOwnerBrowser() ? `<button type="button" class="finder-chip gc-toggle">${off(x) ? "Turn on" : "Turn off"}</button>` : ""}</div>
        </div>`;
    box.innerHTML = `
        ${reported.length ? `<h4 class="gc-h">Reported by players (${reported.length})</h4><p class="admin-footnote">Each report comes with what the game said on that person's device. Mark fixed clears them.</p>${reported.map(repRow).join("")}` : ""}
        <p class="admin-summary">Checked ${entries.length.toLocaleString()} of ${(h.total || entries.length).toLocaleString()} games${when ? `, last run ${escapeHtmlText(when)}` : ""}:
            <b class="gc-ok">${okN.toLocaleString()} working</b> · <b class="gc-bad">${broken.length} not starting</b> · ${slow.length} couldn't tell.
            <button type="button" class="finder-chip" id="gc-refresh">Refresh</button></p>
        <p class="admin-footnote">Every night about 250 games are opened in a real browser, plus every game that failed last time, so each game is checked about once a week. "Not starting" means no game appeared within 45 seconds (checked twice). "Couldn't tell" means the game was still loading, or the test server couldn't download its files. Some "not starting" games still work for players (they need a click or a login), so open one before turning it off.</p>
        ${broken.length ? `<h4 class="gc-h">Not starting (${broken.length})</h4>${broken.sort((a, b) => off(a) - off(b) || String(a.z.name).localeCompare(b.z.name)).map(row).join("")}` : `<p>No broken games found.</p>`}
        ${slow.length ? `<details class="gc-slow"><summary>Couldn't tell (${slow.length})</summary>${slow.map(row).join("")}</details>` : ""}
        ${fixedList.length ? `<details class="gc-slow"><summary>Marked fixed (${fixedList.length})</summary><p class="admin-footnote">These come back if a later nightly check finds them failing again.</p>${fixedList.map(row).join("")}</details>` : ""}`;
    box.querySelector("#gc-refresh").onclick = () => renderGameCheck(true);
    box.querySelectorAll(".gc-row").forEach(r => {
        const id = r.dataset.id;
        const op = r.querySelector(".gc-open");
        if (op) op.onclick = () => { const z = zoneById(id); if (z) { closePopup(); openZone(z); } };
        const fx = r.querySelector(".gc-fixed");
        if (fx) fx.onclick = async () => { if (await markGameFixed(id)) { renderGameCheck(); updateGameCheckCount(); } };
        const t = r.querySelector(".gc-toggle");
        if (t) t.onclick = () => { setZoneDisabled(id, !isZoneDisabled(id)); renderGameCheck(); };
    });
}

// ── Visitors (everyone, with or without an account) ──────────────────────────
// Online now and what's being played come from live/now (js/live.js); visitor
// totals are count queries on the anonymous online heartbeats (presence/*),
// about one read each per 1,000 browsers. "Browsers" because a person on two
// devices counts twice, and clearing site data starts a new one.
// Who's online and visitor totals come from the GN 2.0 Server when it can be
// reached (it takes everyone's heartbeats now), else from Firestore presence.
async function homeServerJson(path) {
    if (typeof HOME_SERVER === "undefined") throw new Error("no server");
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(HOME_SERVER + path, { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
}
async function onlineSessions() {
    try {
        const j = await homeServerJson("/api/presence");
        return (j.sessions || []).map(p => ({ id: p.id, s: p.s, g: p.g || undefined, t: { toMillis: () => p.t, toDate: () => new Date(p.t) } }));
    } catch {}
    const pres = await cloudDb.collection("presence").where("t", ">", firebase.firestore.Timestamp.fromMillis(Date.now() - 10 * 60000)).get();
    return pres.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
}
let visitorTotals = null;
async function presenceCountSince(ms) {
    try {
        if (!visitorTotals || Date.now() - visitorTotals.at > 60000) visitorTotals = { at: Date.now(), p: homeServerJson("/api/visitors") };
        const v = await visitorTotals.p;
        const n = ms === 86400000 ? v.day : ms === 7 * 86400000 ? v.week : !ms ? v.all : null;
        if (Number.isFinite(n)) return n;
    } catch { visitorTotals = null; }
    return presenceCountSinceFirestore(ms);
}
async function presenceCountSinceFirestore(ms) {
    const P = FIREBASE_CONFIG.projectId, KEY = FIREBASE_CONFIG.apiKey;
    const q = { from: [{ collectionId: "presence" }] };
    if (ms) q.where = { fieldFilter: { field: { fieldPath: "t" }, op: "GREATER_THAN", value: { timestampValue: new Date(Date.now() - ms).toISOString() } } };
    if (typeof fbCount === "function") fbCount(1, 0);
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents:runAggregationQuery?key=${encodeURIComponent(KEY)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: q, aggregations: [{ alias: "n", count: {} }] } })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const out = await res.json();
    return Number((Array.isArray(out) ? out : [out]).map(x => x?.result?.aggregateFields?.n?.integerValue).find(v => v != null)) || 0;
}
async function renderVisitors() {
    const box = document.getElementById("admin-visitors");
    if (!box) return;
    let now = null;
    try {
        if (typeof fbCount === "function") fbCount(1, 0);
        const d = await cloudDb.collection("live").doc("now").get();
        if (d.exists) now = d.data();
    } catch (e) {}
    const total = now && Number.isFinite(now.online) ? now.online : (window.gnActiveUsers && window.gnActiveUsers.count) || 0;
    const signedIn = adminData ? adminData.profiles.filter(profileOnline).length : 0;
    const guests = Math.max(0, total - signedIn);
    const [day, week, all] = await Promise.all([86400000, 7 * 86400000, 0].map(ms => presenceCountSince(ms).catch(() => null)));
    const fmt = n => n == null ? "–" : Number(n).toLocaleString();
    const tile = (n, label, title) => `<div class="av-tile"${title ? ` title="${escapeHtmlText(title)}"` : ""}><b>${n}</b><span>${label}</span></div>`;
    const games = Object.entries((now && now.games) || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([id, n]) => { const z = typeof zoneById === "function" ? zoneById(id) : null; return z ? `<button type="button" class="av-game" data-id="${escapeHtmlText(id)}">${escapeHtmlText(z.name)} <span>${n}</span></button>` : ""; }).join("");
    const updated = now && now.at && now.at.toDate ? `updated ${timeAgo(now.at)}` : "";
    box.innerHTML = `
        <div class="av-tiles">
            ${tile(fmt(total), "online now", "Everyone with the site open in the last 5 minutes")}
            ${tile(fmt(signedIn), "signed in", "Accounts active in the last 7 minutes")}
            ${tile(fmt(guests), "without an account")}
            ${tile(fmt(day), "visitors today", "Different browsers in the last 24 hours")}
            ${tile(fmt(week), "this week", "Different browsers in the last 7 days")}
            ${tile(fmt(all), "all time", "Every browser that has ever opened the site")}
        </div>
        ${games ? `<div class="av-games"><span class="av-games-label">Playing now${updated ? ` · ${escapeHtmlText(updated)}` : ""}:</span> ${games}</div>` : ""}`;
    box.querySelectorAll(".av-game").forEach(b => b.onclick = () => { const z = zoneById(b.dataset.id); if (z) { closePopup(); openZone(z); } });
}

// ── Sessions (admins) ─────────────────────────────────────────────────────────
// Every browser with the site open (js/presence.js), with or without an
// account: when the visit started, what's open, browser, system, screen,
// language, time zone and site address. Boot one to remove it from the site
// for a while: its progress is saved, its game closes and it sees a "you've
// been removed" screen until the boot runs out or is lifted. A boot follows
// the browser, not the person: another browser, or clearing site data, gets
// a new session. Costs about two reads per session listed.
const BOOT_TIMES = [["5m", "5 minutes", 5 * 60000], ["10m", "10 minutes", 10 * 60000], ["30m", "30 minutes", 30 * 60000], ["1h", "1 hour", 3600000],
    ["1d", "1 day", 86400000], ["7d", "1 week", 7 * 86400000], ["forever", "Until I lift it", 50 * 365 * 86400000], ["custom", "Custom time…", 0]];
// Jumpscare pictures: links the admin adds (kept in this browser). Each
// jumpscare picks one at random; with none, it uses the built-in faces.
const SCARE_PICS_KEY = "gnmath-scare-pics";
// Jumpscare style, kept in this browser: "buildup" (fake crash, then the
// face) or "instant" (the face right away)
const SCARE_STYLE_KEY = "gnmath-scare-style";
function getScareStyle() { try { return localStorage.getItem(SCARE_STYLE_KEY) === "instant" ? "instant" : "buildup"; } catch { return "buildup"; } }
function scareStylePicker() {
    const wrap = document.createElement("label");
    wrap.className = "scare-style";
    wrap.innerHTML = `${gnIcon("ghost")} Jumpscare style <select aria-label="Jumpscare style">
        <option value="buildup">Build-up: fake crash first (about 7 s)</option>
        <option value="instant">Instant: the face right away</option></select>`;
    const sel = wrap.querySelector("select");
    sel.value = getScareStyle();
    sel.onchange = () => { try { localStorage.setItem(SCARE_STYLE_KEY, sel.value); } catch {} };
    return wrap;
}
function getScarePics() {
    try { return (JSON.parse(localStorage.getItem(SCARE_PICS_KEY) || "[]") || []).filter(u => /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600).slice(0, 40); } catch { return []; }
}
function scarePicsEditor() {
    const d = document.createElement("details");
    d.className = "scare-pics";
    d.innerHTML = `<summary>Jumpscare pictures (${getScarePics().length || "built-in"})</summary>
        <p class="admin-footnote">Paste picture links (https), one per line. Each jumpscare picks one at random. Leave it empty to use the built-in pictures: ${typeof SCARE_BANK !== "undefined" ? SCARE_BANK.map(b => escapeHtml(b.title)).join(", ") : ""} (public-domain paintings from Wikimedia Commons). Kept in this browser only. Links to pictures (.png, .jpg, .gif or .webp) work best; if one doesn't load, they get a built-in face.</p>
        <textarea class="submit-note" rows="4" spellcheck="false" placeholder="https://example.com/scary.jpg"></textarea>
        <div class="admin-actions"><button type="button" class="finder-chip">Save pictures</button><span class="admin-id"></span></div>`;
    const ta = d.querySelector("textarea"), save = d.querySelector("button"), msg = d.querySelector(".admin-id");
    ta.value = getScarePics().join("\n");
    save.onclick = () => {
        const lines = ta.value.split(/\s+/).map(x => x.trim()).filter(Boolean);
        const ok = lines.filter(u => /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600);
        try { localStorage.setItem(SCARE_PICS_KEY, JSON.stringify(ok.slice(0, 40))); } catch {}
        msg.textContent = `Saved ${ok.length} picture${ok.length === 1 ? "" : "s"}` + (lines.length > ok.length ? ` (${lines.length - ok.length} skipped: links must start with https://)` : "") + ".";
        d.querySelector("summary").textContent = `Jumpscare pictures (${ok.length || "built-in"})`;
    };
    return d;
}
// Find screen (identify.js): lights up one session's screen with a color and
// number for 30 seconds; the same color and number show here
function findScreenButton(id, name) {
    const wrap = document.createElement("span");
    wrap.className = "find-screen";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "finder-chip";
    btn.innerHTML = gnIcon("eye") + " Find screen";
    btn.title = `Light up ${name}'s screen for 30 seconds so you can see which computer it is`;
    const tag = document.createElement("span");
    tag.className = "find-screen-tag"; tag.hidden = true;
    let timer = null;
    btn.onclick = async () => {
        const keys = Object.keys(IDENTIFY_COLORS);
        const c = keys[Math.floor(Math.random() * keys.length)], n = 10 + Math.floor(Math.random() * 90);
        btn.disabled = true;
        try {
            await cloudDb.collection("identify").doc(id).set({
                k: "find", c, n, until: firebase.firestore.Timestamp.fromMillis(Date.now() + IDENTIFY_MS),
                by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp()
            });
            const [cname, hex] = IDENTIFY_COLORS[c];
            tag.hidden = false;
            tag.style.background = hex;
            tag.style.color = c === "yellow" || c === "cyan" ? "#111" : "#fff";
            tag.textContent = `Look for: ${cname} ${n}`;
            clearTimeout(timer);
            timer = setTimeout(() => { tag.hidden = true; }, IDENTIFY_MS);
        } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); }
        btn.disabled = false;
    };
    // Jumpscare, just for fun: a face and a scream on their screen for 1.5 s
    const boo = document.createElement("button");
    boo.type = "button"; boo.className = "finder-chip";
    boo.innerHTML = gnIcon("ghost") + " Jumpscare";
    boo.title = `Jumpscare ${name}: fake game crash, then a scary picture and a scream`;
    boo.onclick = async () => {
        if (!(await askConfirm(getScareStyle() === "instant"
            ? `Jumpscare ${name}? ${getScarePics().length ? "One of your jumpscare pictures" : "A scary picture"} fills their screen right away with a scream and two red flashes. About 2 seconds; their game carries on after.`
            : `Jumpscare ${name}? Their game freezes, a fake error pops up, then ${getScarePics().length ? "one of your jumpscare pictures" : "a scary picture"} fills their screen with a scream and two red flashes. About 7 seconds; their game carries on after.`, { title: "Jumpscare?", confirmText: "Do it" }))) return;
        boo.disabled = true;
        try {
            // Your pictures if you've added some, otherwise the built-in public-domain ones
            const own = getScarePics(), pool = own.length ? own : (typeof SCARE_BANK !== "undefined" ? SCARE_BANK.map(b => b.url) : []);
            const pic = pool.length ? pool[Math.floor(Math.random() * pool.length)] : "";
            await cloudDb.collection("identify").doc(id).set({
                ...(pic ? { u: pic } : {}),
                m: getScareStyle(), k: "scare", c: "red", n: 1, until: firebase.firestore.Timestamp.fromMillis(Date.now() + 15000),
                by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp()
            });
            notify(`Jumpscared ${name}.`, { type: "success" });
        } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); }
        setTimeout(() => { boo.disabled = false; }, 3000);
    };
    const troll = trollPicker(name, doc => cloudDb.collection("identify").doc(id).set(doc));
    wrap.append(btn, tag, boo, troll);
    return wrap;
}
// Prank picker (js/identify.js TROLLS): pick one, type the text for a
// message, then Send. send(doc) does the write and returns when it's done.
function trollPicker(name, send) {
    const wrap = document.createElement("span");
    wrap.className = "troll-picker";
    const pick = document.createElement("select");
    pick.setAttribute("aria-label", `Prank for ${name}`);
    (typeof TROLLS !== "undefined" ? TROLLS : []).forEach(([v, label, , , what]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; o.title = what; pick.appendChild(o); });
    const text = document.createElement("input");
    text.type = "text"; text.maxLength = 140; text.className = "submit-note"; text.hidden = true;
    text.placeholder = "Your message (they'll see your name)";
    text.setAttribute("aria-label", `Message for ${name}`); text.setAttribute("data-lpignore", "true");
    const go = document.createElement("button");
    go.type = "button"; go.className = "finder-chip";
    go.innerHTML = gnIcon("dice") + " Prank";
    const sync = () => { text.hidden = pick.value !== "msg"; const d = TROLLS.find(x => x[0] === pick.value); go.title = d ? `${d[4]} (${name})` : ""; };
    pick.onchange = () => { sync(); if (!text.hidden) text.focus(); };
    sync();
    go.onclick = async () => {
        const t = pick.value, x = text.value.trim().slice(0, 140);
        if (t === "msg" && !x) { notify("Type the message first.", { type: "error" }); text.focus(); return; }
        go.disabled = true; go.dataset.busy = "1";
        try {
            await send({
                k: "troll", t, ...(t === "msg" ? { x } : {}), c: "purple", n: 1,
                until: firebase.firestore.Timestamp.fromMillis(Date.now() + 60000),
                by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp()
            });
            const label = TROLLS.find(z => z[0] === t)[1];
            notify(`${label} sent to ${name}.`, { type: "success" });
            if (t === "msg") text.value = "";
        } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); }
        delete go.dataset.busy;
        // An ability's button is turned back on by its cooldown timer instead
        if (go.dataset.perkBtn) go.disabled = perkReadyAt(go.dataset.perkBtn) > Date.now();
        else setTimeout(() => { go.disabled = false; }, 2000);
    };
    wrap.append(pick, text, go);
    wrap.button = go;
    return wrap;
}
const BOOT_UNITS = [["m", "minutes", 60000], ["h", "hours", 3600000], ["d", "days", 86400000]];
async function renderSessions() {
    const box = document.getElementById("admin-sessions");
    if (!box) return;
    box.innerHTML = `<p class="admin-summary">Loading sessions…</p>`;
    let pres, boots;
    try {
        const TS = firebase.firestore.Timestamp;
        [pres, boots] = await Promise.all([
            onlineSessions(),
            cloudDb.collection("boots").where("until", ">", TS.now()).get().catch(() => ({ docs: [] }))
        ]);
        if (!adminData) await loadAdminData();
    } catch (e) {
        box.innerHTML = `<p class="admin-summary">Couldn't load sessions: ${escapeHtmlText(e.message || e)}</p>`;
        return;
    }
    const live = pres.slice().sort((a, b) => (b.t?.toMillis?.() || 0) - (a.t?.toMillis?.() || 0));
    const details = new Map();
    for (let i = 0; i < live.length; i += 30) {
        const ids = live.slice(i, i + 30).map(x => x.id);
        try {
            const snap = await cloudDb.collection("sessions").where(firebase.firestore.FieldPath.documentId(), "in", ids).get();
            snap.docs.forEach(d => details.set(d.id, d.data() || {}));
        } catch (e) { /* rules not published yet */ }
    }
    if (typeof fbCount === "function") fbCount(live.length + details.size + boots.docs.length + 2, 0);
    const bootMap = new Map(boots.docs.map(d => [d.id, d.data() || {}]));
    const bySid = new Map((adminData?.profiles || []).filter(p => p.sid).map(p => [p.sid, p]));
    const mine = typeof window.gnSessionId === "function" ? window.gnSessionId() : "";
    const ms = v => v && v.toMillis ? v.toMillis() : Number(v) || 0;
    const fmtTime = v => { const t = ms(v); return t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–"; };
    const label = (id, acct) => acct ? acct.username : `Guest session ${id.slice(0, 6)}`;

    box.innerHTML = `
        <div class="admin-toolbar"><button type="button" class="finder-chip" id="sessions-refresh">Refresh</button></div>
        <p class="admin-summary">${live.length} session${live.length === 1 ? "" : "s"} open in the last 10 minutes · ${bootMap.size} booted</p>
        <div id="sessions-list" class="admin-list"></div>
        ${bootMap.size ? `<h3 class="admin-subhead">Booted</h3><div id="sessions-booted" class="admin-list"></div>` : ""}
        <p class="admin-footnote">A session is one browser with the site open. Without an account it shows as a guest session. Booting saves their progress, closes their game and shows them a "you've been removed" screen until it runs out; it takes effect right away. <b>Find screen</b> lights up that session's screen for 30 seconds with a color and number (shown here too), so you can spot which computer it is. It follows the browser, so another browser or clearing site data gets a new session. Boots are saved in the Log.</p>`;
    document.getElementById("sessions-refresh").onclick = () => renderSessions();
    box.appendChild(scareStylePicker());
    box.appendChild(scarePicsEditor());
    const list = document.getElementById("sessions-list");

    const bootControls = (row, id, name, info) => {
        const box2 = document.createElement("div");
        box2.className = "admin-actions";
        const b = bootMap.get(id);
        if (b) {
            const until = ms(b.until), forever = until > Date.now() + 5 * 365 * 86400000;
            const line = document.createElement("small");
            line.className = "admin-id";
            line.textContent = `Booted ${forever ? "until lifted" : "until " + fmtTime(b.until)} by ${b.by || "an admin"}${b.reason ? " · " + b.reason : ""}`;
            box2.appendChild(line);
            const un = document.createElement("button");
            un.type = "button"; un.className = "finder-chip"; un.textContent = "Lift boot";
            un.onclick = async () => {
                un.disabled = true;
                try {
                    await loggedWrite("unboot", id, name, "", w => w.delete(cloudDb.collection("boots").doc(id)));
                    notify(`${name} can come back now.`, { type: "success" });
                    renderSessions();
                } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); un.disabled = false; }
            };
            box2.appendChild(un);
        } else if (id === mine) {
            const line = document.createElement("small");
            line.className = "admin-id";
            line.textContent = "This is you.";
            box2.appendChild(line);
        } else {
            const reason = document.createElement("input");
            reason.type = "text"; reason.maxLength = 200; reason.placeholder = "Reason (they'll see it)"; reason.className = "submit-note"; reason.setAttribute("aria-label", `Boot reason for ${name}`);
            reason.setAttribute("data-lpignore", "true");
            const time = document.createElement("select");
            time.setAttribute("aria-label", "How long");
            BOOT_TIMES.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; time.appendChild(o); });
            time.value = "5m";
            // Custom: a number and minutes / hours / days, shown when "Custom time…" is picked
            const custom = document.createElement("span");
            custom.className = "boot-custom"; custom.hidden = true;
            const amount = document.createElement("input");
            amount.type = "number"; amount.min = "1"; amount.max = "999"; amount.step = "1"; amount.value = "15"; amount.className = "submit-note boot-amount";
            amount.setAttribute("aria-label", "How many");
            const unit = document.createElement("select");
            unit.setAttribute("aria-label", "Minutes, hours or days");
            BOOT_UNITS.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; unit.appendChild(o); });
            custom.append(amount, unit);
            time.onchange = () => { custom.hidden = time.value !== "custom"; if (!custom.hidden) amount.focus(); };
            const go = document.createElement("button");
            go.type = "button"; go.className = "finder-chip danger"; go.textContent = "Boot";
            go.onclick = async () => {
                let [, tl, dur] = BOOT_TIMES.find(x => x[0] === time.value);
                if (time.value === "custom") {
                    const n = Math.floor(Number(amount.value));
                    const [, ul, ums] = BOOT_UNITS.find(x => x[0] === unit.value);
                    if (!(n >= 1 && n <= 999)) { notify("Enter how long: a number from 1 to 999.", { type: "error" }); amount.focus(); return; }
                    dur = n * ums;
                    tl = `${n} ${n === 1 ? ul.replace(/s$/, "") : ul}`;
                }
                const why = reason.value.trim().slice(0, 200);
                if (!(await askConfirm(`${name} will be removed from the site ${time.value === "forever" ? "until you lift it" : "for " + tl}. Their progress is saved first.${why ? " Reason shown to them: " + why : ""}`, { title: "Boot this session?", confirmText: "Boot", danger: true }))) return;
                go.disabled = true;
                try {
                    const data = {
                        until: firebase.firestore.Timestamp.fromMillis(Date.now() + dur), reason: why,
                        by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp(),
                        name: String(name).slice(0, 40), info: String(info || "").slice(0, 200)
                    };
                    await loggedWrite("boot", id, name, `${tl}${why ? " · " + why : ""}`, w => w.set(cloudDb.collection("boots").doc(id), data));
                    notify(`${name} is booted ${time.value === "forever" ? "until you lift it" : "for " + tl}. It takes effect right away.`, { type: "success" });
                    renderSessions();
                } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); go.disabled = false; }
            };
            box2.append(reason, time, custom, go);
        }
        if (!b && live.some(p => p.id === id)) box2.prepend(findScreenButton(id, name));
        row.appendChild(box2);
    };

    if (!live.length) list.innerHTML = `<p class="admin-summary">Nobody has the site open right now.</p>`;
    for (const p of live) {
        const d = details.get(p.id) || {};
        const acct = bySid.get(p.id);
        const name = label(p.id, acct);
        const game = p.g && typeof zoneById === "function" ? zoneById(p.g) : null;
        const row = document.createElement("details");
        row.className = "admin-row";
        const sum = document.createElement("summary");
        const st = document.createElement("span");
        st.className = "admin-presence on";
        st.textContent = game ? `Playing ${game.name}` : "Browsing";
        const b = document.createElement("b");
        b.textContent = name;
        sum.append(st, b);
        const tags = [];
        if (!acct) tags.push(["Guest", "guest"]);
        if (p.s === "light") tags.push(["GN Light", "light"]);
        if (bootMap.has(p.id)) tags.push(["Booted", "banned"]);
        // Bot score from js/botcheck.js: 3 or more is worth a look, 5 or more is very likely a bot
        if ((d.bs || 0) >= 3) tags.push([d.bs >= 5 ? "Likely bot" : "Bot?", "bot"]);
        for (const [t, cls] of tags) { const x = document.createElement("span"); x.className = "admin-badge " + cls; x.textContent = t; sum.appendChild(x); }
        const meta = document.createElement("small");
        const info = [d.b, d.os ? "on " + d.os : "", d.d && d.d !== "computer" ? `(${d.d})` : ""].filter(Boolean).join(" ");
        meta.textContent = [d.st ? "opened " + timeAgo(d.st) : "", "active " + timeAgo(p.t), info].filter(Boolean).join(" · ");
        sum.appendChild(meta);
        row.appendChild(sum);
        const more = document.createElement("div");
        more.className = "admin-activity";
        const lines = [
            ["Opened", d.st ? fmtTime(d.st) : "–"],
            ["Last active", fmtTime(p.t)],
            ["Playing", game ? game.name : "Nothing open"],
            ["Account", acct ? acct.username : "None (guest)"],
            ["Browser", d.b || "–"], ["System", [d.os, d.d].filter(Boolean).join(", ") || "–"],
            ["Screen", d.sc || "–"], ["Language", d.lang || "–"], ["Time zone", d.tz || "–"],
            ["Site address", d.host || "–"],
            ["Bot score", d.bs == null ? "–" : `${d.bs}${d.bf ? " (" + d.bf + ")" : ""}`],
            ["Session ID", p.id]
        ];
        more.innerHTML = `<dl class="admin-session-info">${lines.map(([k, v]) => `<dt>${escapeHtmlText(k)}</dt><dd>${escapeHtmlText(v)}</dd>`).join("")}</dl>` +
            (!details.has(p.id) ? `<p class="admin-footnote">No session details yet (they opened the site before this was added, or on GN Light).</p>` : "");
        row.appendChild(more);
        if (p.s !== "light") bootControls(row, p.id, name, info);
        list.appendChild(row);
    }
    const bl = document.getElementById("sessions-booted");
    if (bl) for (const [id, b] of bootMap) {
        const row = document.createElement("div");
        row.className = "admin-row";
        const head = document.createElement("div");
        head.innerHTML = `<b>${escapeHtmlText(b.name || "Session " + id.slice(0, 6))}</b> <small>${escapeHtmlText([b.info, "booted " + (b.at ? timeAgo(b.at) : "")].filter(Boolean).join(" · "))}</small>`;
        row.appendChild(head);
        bootControls(row, id, b.name || "Session " + id.slice(0, 6), b.info);
        bl.appendChild(row);
    }
}

// ── Action log ──────────────────────────────────────────────────────────────
// Role and suspension changes are saved in one batch with their log entry and
// auditLog's pointer (auditLast/<account>); the rules refuse them otherwise.
async function loggedWrite(action, target, targetName, detail, apply) {
    const batch = cloudDb.batch();
    const logRef = cloudDb.collection("auditLog").doc();
    const at = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(logRef, { action, target, targetName: String(targetName || "").slice(0, 40), by: cloudUser.uid, byName: currentUsername().slice(0, 40), at, detail: String(detail || "").slice(0, 200) });
    batch.set(cloudDb.collection("auditLast").doc(target), { action, by: cloudUser.uid, at, logId: logRef.id });
    apply(batch);
    await batch.commit();
    actionLogCache = null;
}
const ACTION_LABELS = {
    suspend: "suspended", unsuspend: "unsuspended", make_mod: "made a mod:", remove_mod: "removed mod from",
    make_admin: "made an admin:", remove_admin: "removed admin from", remove_ratings: "removed all ratings & reports from",
    remove_rating: "removed a rating from", delete_submissions: "deleted the submissions of",
    make_trusted: "made a trusted reporter:", remove_trusted: "removed trusted reporter from", mark_fixed: "marked a game fixed:",
    give_site_access: "let in while the site is closed:", remove_site_access: "removed closed-site access from",
    boot: "booted", unboot: "lifted the boot on",
    set_perks: "set the abilities of", remove_perks: "removed the abilities of"
};
let actionLogCache = null, actionLogFilter = "";
async function renderActionLog() {
    const box = document.getElementById("admin-log");
    if (!box) return;
    if (!actionLogCache) {
        box.innerHTML = `<p class="admin-summary">Loading the log…</p>`;
        try {
            const snap = await cloudDb.collection("auditLog").orderBy("at", "desc").limit(200).get();
            if (typeof fbCount === "function") fbCount(Math.max(1, snap.size), 0);
            actionLogCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            box.innerHTML = `<p class="admin-summary">Couldn't load the log: ${escapeHtmlText(e.message || String(e))}</p>`;
            return;
        }
    }
    box.innerHTML = `
        <div class="admin-toolbar">
            <input type="search" id="log-search" data-no-autofill placeholder="Search by name…" aria-label="Search the log" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
        </div>
        <p id="log-summary" class="admin-summary"></p>
        <div id="log-list" class="admin-list"></div>
        <p class="admin-footnote">Every suspension, mod, admin or trusted reporter change, and rating or submission removal is logged here. Entries can't be edited or deleted from the site. Shows the newest 200.</p>`;
    const input = document.getElementById("log-search");
    input.value = actionLogFilter;
    const draw = () => {
        actionLogFilter = input.value;
        const q = normText(actionLogFilter);
        const rows = actionLogCache.filter(e => !q || normText(e.byName).includes(q) || normText(e.targetName).includes(q));
        document.getElementById("log-summary").textContent = rows.length ? `${rows.length} action${rows.length === 1 ? "" : "s"}` : (q ? "Nothing matches." : "No actions yet.");
        const list = document.getElementById("log-list");
        list.innerHTML = "";
        for (const e of rows) {
            const row = document.createElement("div");
            row.className = "admin-act-item";
            const d = e.at && typeof e.at.toDate === "function" ? e.at.toDate() : null;
            const text = document.createElement("span");
            text.textContent = `${e.byName || "?"} ${ACTION_LABELS[e.action] || e.action} ${e.targetName || "?"}${e.detail ? " — " + e.detail : ""}`;
            const when = document.createElement("small");
            when.textContent = d ? d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
            row.append(text, when);
            list.appendChild(row);
        }
    };
    input.addEventListener("input", draw);
    draw();
}

// ── Error reports ───────────────────────────────────────────────────────────
// Sent automatically by js/errors.js. One entry per kind of error, with how
// many times it happened and the details of the latest time.
const ERROR_SOURCES = { site: "Site", game: "Game crashed", "game-load": "Game didn't load", download: "Download", "cloud-save": "Cloud save" };
let errorLogCache = null, errorLogFilter = "open";
async function renderErrorLog(force) {
    const box = document.getElementById("admin-errors");
    if (!box) return;
    if (!errorLogCache || force) {
        box.innerHTML = `<p class="admin-summary">Loading error reports…</p>`;
        try {
            const snap = await cloudDb.collection("errorLogs").orderBy("lastAt", "desc").limit(200).get();
            if (typeof fbCount === "function") fbCount(Math.max(1, snap.size), 0);
            errorLogCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            box.innerHTML = `<p class="admin-summary">Couldn't load error reports: ${escapeHtmlText(e.message || String(e))}</p>`;
            return;
        }
    }
    box.innerHTML = `
        <div class="admin-toolbar">
            <select id="err-filter" aria-label="Show">
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
            </select>
            <input type="search" id="err-search" data-no-autofill placeholder="Search errors or games…" aria-label="Search error reports" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
            <button type="button" class="finder-chip" id="err-refresh">Refresh</button>
        </div>
        <p id="err-summary" class="admin-summary"></p>
        <div id="err-list" class="admin-list"></div>
        <p class="admin-footnote">Sent automatically when something goes wrong for a player. The same error from many players is one entry with a count; the details are from the latest time. A resolved error opens again if it happens again. Shows the 200 most recent.</p>`;
    const sel = document.getElementById("err-filter"), search = document.getElementById("err-search");
    sel.value = errorLogFilter;
    const when = v => { const d = v && typeof v.toDate === "function" ? v.toDate() : null; return d ? d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "?"; };
    const draw = () => {
        errorLogFilter = sel.value;
        const q = normText(search.value);
        const rows = errorLogCache.filter(e => (errorLogFilter === "all" || (e.status || "open") === errorLogFilter)
            && (!q || normText(`${e.message} ${e.gameName} ${e.where} ${e.source}`).includes(q)));
        const total = rows.reduce((n, e) => n + (e.count || 0), 0);
        document.getElementById("err-summary").textContent = rows.length
            ? `${rows.length} kind${rows.length === 1 ? "" : "s"} of error · ${total.toLocaleString()} time${total === 1 ? "" : "s"} in all`
            : (errorLogFilter === "open" && !q ? "No open errors." : "Nothing matches.");
        const list = document.getElementById("err-list");
        list.innerHTML = "";
        for (const e of rows) {
            const row = document.createElement("details");
            row.className = "admin-row";
            const sum = document.createElement("summary");
            const b = document.createElement("b"); b.textContent = e.message || "(no message)";
            const src = document.createElement("span"); src.className = "admin-badge" + (e.source === "site" ? " banned" : ""); src.textContent = ERROR_SOURCES[e.source] || e.source;
            sum.append(b, src);
            if (e.status === "resolved") { const r = document.createElement("span"); r.className = "admin-badge trusted"; r.textContent = "Resolved"; sum.appendChild(r); }
            const meta = document.createElement("small");
            meta.textContent = [e.gameName ? "Game: " + e.gameName : "", `${(e.count || 0).toLocaleString()}×`, "last " + when(e.lastAt), "first " + when(e.firstAt)].filter(Boolean).join(" · ");
            sum.appendChild(meta);
            row.appendChild(sum);
            const body = document.createElement("div");
            body.className = "admin-actions err-body";
            const l = e.last || {};
            const facts = [
                ["Where", e.where], ["Game", e.gameName ? `${e.gameName} (#${e.gameId})` : ""], ["Detail", l.detail],
                ["Browser", l.browser], ["Screen", l.screen], ["Device memory", l.memory ? l.memory + " GB" : ""],
                ["Online", l.online === false ? "No" : ""], ["Blocked sources", l.blockedSources], ["On the page for", l.secondsOnPage != null ? l.secondsOnPage + "s" : ""],
                ["Site version", l.version], ["Account", l.user], ["Full message", l.message !== e.message ? l.message : ""]
            ].filter(([, v]) => v);
            const dl = document.createElement("dl");
            dl.className = "err-facts";
            for (const [k, v] of facts) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
            body.appendChild(dl);
            if (l.stack) { const pre = document.createElement("pre"); pre.className = "err-stack"; pre.textContent = l.stack; body.appendChild(pre); }
            const btn = (label, fn, danger) => {
                const x = document.createElement("button"); x.type = "button"; x.className = "finder-chip" + (danger ? " danger" : ""); x.textContent = label;
                x.onclick = async () => { x.disabled = true; try { await fn(); } catch (err) { notify("That didn't work: " + (err.message || err), { type: "error" }); x.disabled = false; } };
                body.appendChild(x);
            };
            const zone = e.gameId && typeof zones !== "undefined" ? zones.find(z => String(z.id) === String(e.gameId)) : null;
            if (zone) btn("Open game", () => { closePopup(); openZone(zone); });
            btn("Copy details", async () => {
                await navigator.clipboard.writeText([`${ERROR_SOURCES[e.source] || e.source}: ${e.message}`, `${e.count}× · first ${when(e.firstAt)} · last ${when(e.lastAt)}`, ...facts.map(([k, v]) => `${k}: ${v}`), l.stack ? "\n" + l.stack : ""].join("\n"));
                notify("Copied.", { type: "success" });
            });
            btn(e.status === "resolved" ? "Reopen" : "Mark resolved", async () => {
                const status = e.status === "resolved" ? "open" : "resolved";
                await cloudDb.collection("errorLogs").doc(e.id).update({ status });
                if (typeof fbCount === "function") fbCount(0, 1);
                e.status = status; draw();
            });
            btn("Delete", async () => {
                if (!(await askConfirm("Delete this error report? If it happens again, a new one starts.", { title: "Delete error report?", confirmText: "Delete", danger: true }))) return;
                await cloudDb.collection("errorLogs").doc(e.id).delete();
                if (typeof fbCount === "function") fbCount(0, 1);
                errorLogCache = errorLogCache.filter(x => x !== e); draw();
            }, true);
            row.appendChild(body);
            list.appendChild(row);
        }
    };
    sel.onchange = draw;
    search.oninput = draw;
    document.getElementById("err-refresh").onclick = () => renderErrorLog(true);
    draw();
}

function adminRoleBadges(p) {
    const out = [];
    if (p.uid === getSiteOwnerUid()) out.push(["Owner", "admin"]);
    else if (adminData.admins.has(p.uid)) out.push(["Admin", "admin"]);
    if (adminData.mods.has(p.uid)) out.push(["Mod", "mod"]);
    if (adminData.perks && adminData.perks.has(p.uid)) out.push(["Abilities", "mod"]);
    if (typeof isTrustedReporter === "function" && isTrustedReporter(p.uid)) out.push(["Trusted reporter", "trusted"]);
    if (adminData.bans.has(p.uid)) out.push(["Suspended", "banned"]);
    if (cloudUser && p.uid === cloudUser.uid) out.push(["You", "you"]);
    return out;
}

function renderAdminList() {
    const list = document.getElementById("admin-list");
    if (!list || !adminData) return;
    const q = normText(document.getElementById("admin-search").value);
    const filter = document.getElementById("admin-filter").value;
    const weekAgo = Date.now() - 7 * 86400000;
    let rows = adminData.profiles.filter(p => {
        if (q && !normText(p.username).includes(q)) return false;
        if (filter === "admins") return adminData.admins.has(p.uid) || p.uid === getSiteOwnerUid();
        if (filter === "mods") return adminData.mods.has(p.uid);
        if (filter === "trusted") return typeof isTrustedReporter === "function" && isTrustedReporter(p.uid);
        if (filter === "banned") return adminData.bans.has(p.uid);
        if (filter === "recent") return timeOf(p.lastSeen) >= weekAgo;
        if (filter === "online") return profileOnline(p);
        if (filter === "dupes") return adminData.dupes.has(p.username);
        return true;
    });
    rows.sort((a, b) => (profileOnline(b) - profileOnline(a)) || timeOf(b.lastSeen) - timeOf(a.lastSeen) || String(a.username).localeCompare(String(b.username)));
    const total = adminData.profiles.length;
    const online = adminData.profiles.filter(profileOnline).length;
    document.getElementById("admin-summary").textContent =
        `${total.toLocaleString()} account${total === 1 ? "" : "s"} · ${online} online now · ${adminData.admins.size} admin${adminData.admins.size === 1 ? "" : "s"} · ${adminData.mods.size} mod${adminData.mods.size === 1 ? "" : "s"} · ${adminData.bans.size} suspended` +
        (rows.length !== total ? ` · showing ${rows.length}` : "");
    list.innerHTML = "";
    const shown = rows.slice(0, 200);
    for (const p of shown) list.appendChild(adminRow(p));
    if (rows.length > shown.length) {
        const more = document.createElement("p");
        more.className = "admin-footnote";
        more.textContent = `Showing the first 200. Search to find a specific account.`;
        list.appendChild(more);
    }
    if (!rows.length) list.innerHTML = `<p class="admin-footnote">No accounts match.</p>`;
}

function adminRow(p) {
    const row = document.createElement("details");
    row.className = "admin-row";
    const sum = document.createElement("summary");
    const name = document.createElement("b");
    name.textContent = p.username || "(unknown)";
    sum.appendChild(name);
    for (const [label, cls] of adminRoleBadges(p)) {
        const b = document.createElement("span");
        b.className = "admin-badge " + cls;
        b.textContent = label;
        sum.appendChild(b);
    }
    // Same username as another account: say which one really owns the name
    if (adminData.dupes?.has(p.username)) {
        const owner = adminData.claims.get(p.username);
        const b = document.createElement("span");
        b.className = "admin-badge dupe";
        b.textContent = owner === p.uid ? "Owns name" : "Duplicate name";
        b.title = owner === p.uid
            ? "Another account shows this username too. This one owns it."
            : owner ? "Another account owns this username. This one is a duplicate from before names were all claimed."
            : "More than one account uses this username and none has claimed it yet.";
        sum.appendChild(b);
    }
    // Level, and online now (with the game they have open) or when last seen
    if (Number.isFinite(p.level) && p.level > 0) {
        const lv = document.createElement("span");
        lv.className = "admin-level";
        lv.textContent = `Lv ${p.level}`;
        lv.title = `Level ${p.level}${typeof achTitle === "function" ? " " + achTitle(p.level) : ""} · ${Number(p.xp || 0).toLocaleString()} XP · ${p.badges || 0} badges`;
        sum.insertBefore(lv, name.nextSibling);
    }
    const on = profileOnline(p);
    const status = document.createElement("span");
    status.className = "admin-presence " + (on ? "on" : "off");
    const game = on && p.playing && typeof zoneById === "function" ? zoneById(p.playing) : null;
    status.textContent = on ? (game ? `Playing ${game.name}` : "Online") : p.lastSeen ? `Seen ${timeAgo(p.lastSeen)}` : "Never seen";
    sum.insertBefore(status, name);
    const meta = document.createElement("small");
    const st = adminData.stats.get(p.uid) || { votes: 0, reports: 0 };
    const mins = Number(p.played || 0);
    meta.textContent = [p.createdAt ? "joined " + fmtDate(p.createdAt) : "",
        p.tried ? `${p.tried} game${p.tried === 1 ? "" : "s"} tried` : "",
        mins ? `${mins >= 60 ? Math.floor(mins / 60) + "h " + (mins % 60) + "m" : mins + "m"} played` : "",
        p.badges ? `${p.badges} badge${p.badges === 1 ? "" : "s"}` : "",
        `${st.votes} rating${st.votes === 1 ? "" : "s"}`, `${st.reports} report${st.reports === 1 ? "" : "s"}`,
        adminData.subs.get(p.uid) ? `${adminData.subs.get(p.uid)} submission(s)` : ""].filter(Boolean).join(" · ");
    sum.appendChild(meta);
    row.appendChild(sum);
    // Their likes, dislikes and reports, drawn when the row is opened
    const activity = document.createElement("div");
    activity.className = "admin-activity";
    row.appendChild(activity);
    row.addEventListener("toggle", () => { if (row.open) renderAdminActivity(activity, p); });
    // Mods only look: no buttons
    if (!isSiteAdmin()) {
        const idLine = document.createElement("small");
        idLine.className = "admin-id";
        idLine.textContent = (adminData.bans.get(p.uid)?.reason ? "Suspended: " + adminData.bans.get(p.uid).reason + " · " : "") + "Account ID: " + p.uid;
        row.appendChild(idLine);
        return row;
    }

    const box = document.createElement("div");
    box.className = "admin-actions";
    const me = cloudUser && p.uid === cloudUser.uid;
    const isAdm = adminData.admins.has(p.uid);
    const isOwn = p.uid === getSiteOwnerUid();
    const isMod = adminData.mods.has(p.uid);
    const isBan = adminData.bans.has(p.uid);
    const trusted = typeof isTrustedReporter === "function" && isTrustedReporter(p.uid);
    const canTrust = typeof getGithubPat === "function" && !!getGithubPat();
    const btn = (label, fn, opts = {}) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "finder-chip" + (opts.danger ? " danger" : "");
        b.textContent = label;
        if (opts.disabled) { b.disabled = true; b.title = opts.disabled; }
        b.onclick = async () => {
            b.disabled = true;
            try { await fn(); } catch (e) { console.error(e); notify("That didn't work: " + (typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e), { type: "error" }); }
            b.disabled = false;
        };
        box.appendChild(b);
    };
    btn(isAdm ? "Remove game admin" : "Make game admin", async () => {
        if (isAdm) {
            if (!(await askConfirm(`${p.username} will no longer be able to manage accounts, handle takedowns or review reports and submissions.`, { title: "Remove game admin?", confirmText: "Remove admin", danger: true }))) return;
            await loggedWrite("remove_admin", p.uid, String(p.username || ""), "", b => b.delete(cloudDb.collection("admins").doc(p.uid)));
            adminData.admins.delete(p.uid);
        } else {
            if (!(await askConfirm(`${p.username} will be able to see every account, suspend people, handle takedowns and add or remove mods. For just reviewing reports and submissions, make them a mod instead.`, { title: "Make game admin?", confirmText: "Make admin" }))) return;
            const data = { name: String(p.username || "").slice(0, 40), addedBy: currentUsername().slice(0, 40), addedAt: firebase.firestore.FieldValue.serverTimestamp() };
            await loggedWrite("make_admin", p.uid, String(p.username || ""), "", b => b.set(cloudDb.collection("admins").doc(p.uid), data));
            adminData.admins.set(p.uid, data);
        }
        notify(isAdm ? `${p.username} is no longer a game admin.` : `${p.username} is now a game admin.`, { type: "success" });
        renderAdminList();
    }, isOwn ? { disabled: "This is the site owner, who can't be removed." }
        : me ? { disabled: "You can't remove your own admin access." }
        : !isSiteOwner() ? { disabled: "Only the site owner can add or remove admins." } : {});
    if (!isAdm) btn(isMod ? "Remove mod" : "Make mod", async () => {
        if (isMod) {
            if (!(await askConfirm(`${p.username} will no longer be able to review reports, ideas or game submissions.`, { title: "Remove mod?", confirmText: "Remove mod", danger: true }))) return;
            await loggedWrite("remove_mod", p.uid, String(p.username || ""), "", b => b.delete(cloudDb.collection("mods").doc(p.uid)));
            adminData.mods.delete(p.uid);
        } else {
            if (!(await askConfirm(`${p.username} will be able to review reports, ideas and game submissions. They won't see accounts or be able to suspend anyone or change roles.`, { title: "Make mod?", confirmText: "Make mod" }))) return;
            const data = { name: String(p.username || "").slice(0, 40), addedBy: currentUsername().slice(0, 40), addedAt: firebase.firestore.FieldValue.serverTimestamp() };
            await loggedWrite("make_mod", p.uid, String(p.username || ""), "", b => b.set(cloudDb.collection("mods").doc(p.uid), data));
            adminData.mods.set(p.uid, data);
        }
        notify(isMod ? `${p.username} is no longer a mod.` : `${p.username} is now a mod.`, { type: "success" });
        renderAdminList();
    });
    if (typeof isAccessAllowed === "function") {
        const allowed = isAccessAllowed(p.uid);
        btn(allowed ? "Remove from closed-site access" : "Let in while site is closed", async () => {
            setAccessAllowed(p.uid, allowed ? null : String(p.username || ""));
            logAction(allowed ? "remove_site_access" : "give_site_access", p.uid, String(p.username || ""), "");
            notify(allowed ? `${p.username} no longer gets in while the site is closed.` : `${p.username} can now get in while the site is closed.`, { type: "success" });
            renderAdminList();
        }, !isSiteOwner() ? { disabled: "Only the site owner can change this." } : {});
    }
    btn(trusted ? "Remove trusted reporter" : "Make trusted reporter", async () => {
        const list = getTrustedReporters();
        setTrustedReporters(trusted ? list.filter(x => x.uid !== p.uid) : [...list, { uid: p.uid, name: String(p.username || "").slice(0, 40) }]);
        logAction(trusted ? "remove_trusted" : "make_trusted", p.uid, String(p.username || ""), "");
        if (typeof githubAutoSync === "function") githubAutoSync();
        if (typeof refreshCards === "function") refreshCards();
        notify(trusted ? `${p.username} is no longer a trusted reporter.` : `${p.username} is now a trusted reporter. Saved to GitHub.`, { type: "success" });
        renderAdminList();
    }, canTrust ? {} : { disabled: "Trusted reporters are saved to GitHub, so this needs the owner's GitHub token on this browser (Owner Panel)." });
    btn(isBan ? "Unsuspend" : "Suspend", async () => {
        if (isBan) {
            await loggedWrite("unsuspend", p.uid, String(p.username || ""), "", b => b.delete(cloudDb.collection("bans").doc(p.uid)));
            adminData.bans.delete(p.uid);
            notify(`${p.username} is no longer suspended.`, { type: "success" });
        } else {
            const reason = document.getElementById("admin-reason-" + p.uid)?.value.trim().slice(0, 200) || "";
            if (!(await askConfirm(`${p.username} will still be able to play and keep their saves, but won't be able to rate, report or submit games.${reason ? " Reason shown to them: " + reason : ""}`, { title: "Suspend account?", confirmText: "Suspend", danger: true }))) return;
            const data = { name: String(p.username || "").slice(0, 40), reason, by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp() };
            await loggedWrite("suspend", p.uid, String(p.username || ""), reason, b => b.set(cloudDb.collection("bans").doc(p.uid), data));
            adminData.bans.set(p.uid, data);
            notify(`${p.username} is suspended.`, { type: "success" });
        }
        renderAdminList();
    }, me ? { disabled: "You can't suspend yourself.", danger: true }
        : isOwn ? { disabled: "The site owner can't be suspended.", danger: true } : { danger: true });
    btn("Remove their ratings & reports", async () => {
        if (!(await askConfirm(`Delete every rating and broken report from ${p.username}? This can't be undone.`, { title: "Remove ratings & reports?", confirmText: "Remove", danger: true }))) return;
        const n = await adminRemoveStats(p.uid);
        logAction("remove_ratings", p.uid, String(p.username || ""), `${n} rating(s)/report(s)`);
        adminData.stats.delete(p.uid);
        if (typeof loadGameStats === "function") loadGameStats({ force: true });
        notify(`Removed ${n} rating(s)/report(s) from ${p.username}.`, { type: "success" });
        renderAdminList();
    }, { danger: true });
    if (adminData.subs.get(p.uid)) btn("Delete their submissions", async () => {
        if (!(await askConfirm(`Delete all game submissions from ${p.username}?`, { title: "Delete submissions?", confirmText: "Delete", danger: true }))) return;
        const snap = await cloudDb.collection("submissions").where("uid", "==", p.uid).get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));
        logAction("delete_submissions", p.uid, String(p.username || ""), `${snap.docs.length} submission(s)`);
        adminData.subs.delete(p.uid);
        notify(`Deleted ${snap.docs.length} submission(s).`, { type: "success" });
        renderAdminList();
    }, { danger: true });
    if (!isBan && !me && !isOwn) {
        const reason = document.createElement("input");
        reason.id = "admin-reason-" + p.uid;
        reason.className = "submit-note";
        reason.maxLength = 200;
        reason.placeholder = "Reason if you suspend them (they'll see it)";
        reason.setAttribute("aria-label", `Suspension reason for ${p.username}`);
        box.appendChild(reason);
    } else if (isBan && adminData.bans.get(p.uid)?.reason) {
        const r = document.createElement("small");
        r.textContent = "Suspended: " + adminData.bans.get(p.uid).reason;
        box.appendChild(r);
    }
    if (isSiteOwner() && !isAdm && !isOwn) box.appendChild(perksEditor(p));
    const idLine = document.createElement("small");
    idLine.className = "admin-id";
    idLine.textContent = "Account ID: " + p.uid;
    box.appendChild(idLine);
    row.appendChild(box);
    return row;
}

// ── Abilities ───────────────────────────────────────────────────────────────
// The owner can give someone a few admin abilities without making them an
// admin, each usable once per cooldown (perks/<uid>; config/firestore.rules
// checks the cooldown, so it can't be skipped). They use them from Account →
// Abilities.
const PERKS = [
    ["scare", "Jumpscare", "ghost", 30, "A fake game crash, then a scary picture and a scream on someone's screen"],
    ["find", "Find screen", "eye", 5, "Lights up someone's screen with a color and number for 30 seconds"],
    ["boot", "Boot", "ban", 60, "Removes someone from the site for up to 15 minutes"],
    ["troll", "Pranks", "dice", 10, "Upside down, spin, earthquake, fart sound, fake update, a message and more on someone's screen"]
];
const PERK_BOOT_TIMES = [[1, "1 minute"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"]];
const cooldownText = m => m === 0 ? "no wait" : m < 60 ? `${m} min` : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
function perksEditor(p) {
    const cur = (adminData.perks.get(p.uid) || {}).a || {};
    const d = document.createElement("details");
    d.className = "perks-editor";
    d.innerHTML = `<summary>${gnIcon("bolt")} Abilities${Object.keys(cur).length ? ": " + PERKS.filter(x => x[0] in cur).map(x => `${x[1]} (every ${cooldownText(cur[x[0]])})`).join(", ") : ""}</summary>
        <p class="admin-footnote">Give ${escapeHtmlText(p.username || "them")} some admin abilities without making them an admin. Each one can be used once per wait time. They use them from Account → Abilities. They can't use them on you.</p>
        ${PERKS.map(([k, label, icon, def, what]) => `<label class="perk-line">
            <input type="checkbox" data-perk="${k}" ${k in cur ? "checked" : ""}>
            <span>${gnIcon(icon)} <b>${label}</b> <small>${escapeHtmlText(what)}</small></span>
            <span class="perk-cd">once every <input type="number" min="0" max="10080" step="1" data-cd="${k}" value="${k in cur ? cur[k] : def}" aria-label="${label}: minutes between uses"> min</span>
        </label>`).join("")}
        <div class="admin-actions"></div>`;
    const acts = d.querySelector(".admin-actions");
    const save = document.createElement("button");
    save.type = "button"; save.className = "finder-chip"; save.textContent = "Save abilities";
    save.onclick = async () => {
        const a = {};
        for (const [k, label] of PERKS) {
            if (!d.querySelector(`[data-perk="${k}"]`).checked) continue;
            const m = Math.floor(Number(d.querySelector(`[data-cd="${k}"]`).value));
            if (!(m >= 0 && m <= 10080)) { notify(`${label}: enter minutes from 0 to 10080 (a week).`, { type: "error" }); return; }
            a[k] = m;
        }
        const name = String(p.username || "");
        save.disabled = true;
        try {
            if (!Object.keys(a).length) {
                if (!adminData.perks.has(p.uid)) { save.disabled = false; return; }
                await loggedWrite("remove_perks", p.uid, name, "", b => b.delete(cloudDb.collection("perks").doc(p.uid)));
                adminData.perks.delete(p.uid);
                notify(`${name} has no abilities now.`, { type: "success" });
            } else {
                const detail = PERKS.filter(x => x[0] in a).map(x => `${x[1]} every ${cooldownText(a[x[0]])}`).join(", ");
                const data = { name: name.slice(0, 40), a, by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp() };
                await loggedWrite("set_perks", p.uid, name, detail, b => b.set(cloudDb.collection("perks").doc(p.uid), data));
                adminData.perks.set(p.uid, data);
                notify(`${name} can now use: ${detail}.`, { type: "success" });
            }
            renderAdminList();
        } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); save.disabled = false; }
    };
    acts.appendChild(save);
    if (Object.keys(cur).length) {
        const off = document.createElement("button");
        off.type = "button"; off.className = "finder-chip danger"; off.textContent = "Remove all";
        off.onclick = () => { d.querySelectorAll("[data-perk]").forEach(c => { c.checked = false; }); save.click(); };
        acts.appendChild(off);
    }
    return d;
}

// The Abilities panel, for someone the owner gave abilities to
let perksTicker = null;
function perkReadyAt(k) {
    const cd = (myPerks() || {})[k];
    const last = siteAdminState.perkUse[k] || 0;
    return cd == null ? Infinity : last + cd * 60000;
}
// One write that uses ability k: its time in perkUse/ plus the action itself
async function usePerk(k, apply, log) {
    const mark = b => b.set(cloudDb.collection("perkUse").doc(cloudUser.uid), { [k]: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    try {
        if (log) await loggedWrite(log[0], log[1], log[2], log[3], b => { mark(b); apply(b); });
        else { const b = cloudDb.batch(); mark(b); apply(b); await b.commit(); }
    } catch (e) {
        if (/permission/i.test(String(e && (e.code || e.message)))) {
            await loadMyPerks();
            throw new Error(myPerks() && k in myPerks() ? "it isn't ready yet. Wait for the timer." : "you don't have that ability anymore.");
        }
        throw e;
    }
    siteAdminState.perkUse[k] = Date.now();
}
async function openAbilitiesPanel() {
    if (!cloudUser) { notify("Sign in first."); openAccountPanel(); return; }
    document.getElementById("popupTitle").textContent = "Abilities";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
    body.innerHTML = `<p class="admin-summary">Loading…</p>`;
    await loadMyPerks();
    const perks = myPerks();
    if (!perks) { body.innerHTML = `<p>This account doesn't have any abilities. The site owner gives them out.</p>`; return; }
    body.innerHTML = `
        <div class="perk-status" id="perk-status"></div>
        <div class="admin-toolbar"><button type="button" class="finder-chip" id="perk-refresh">Refresh</button></div>
        <p class="admin-summary" id="perk-summary">Loading who's online…</p>
        <div id="perk-list" class="admin-list"></div>
        <p class="admin-footnote">Each ability works once, then waits until its timer runs out. Everything you do here is seen by the site owner.</p>`;
    document.getElementById("perk-refresh").onclick = () => renderPerkSessions();
    if ("scare" in perks) document.querySelector("#popupBody .admin-toolbar").appendChild(scareStylePicker());
    const status = document.getElementById("perk-status");
    const tick = () => {
        if (!document.body.contains(status)) { clearInterval(perksTicker); perksTicker = null; return; }
        const now = Date.now();
        status.innerHTML = PERKS.filter(x => x[0] in perks).map(([k, label, icon]) => {
            const at = perkReadyAt(k);
            return `<span class="perk-pill ${at <= now ? "ready" : ""}">${gnIcon(icon)} ${label}: ${at <= now ? "ready" : "ready in " + inText(at - now)}</span>`;
        }).join("");
        document.querySelectorAll("[data-perk-btn]").forEach(b => {
            const ready = perkReadyAt(b.dataset.perkBtn) <= now;
            if (!b.dataset.busy) b.disabled = !ready;
            b.title = ready ? "" : "Ready in " + inText(perkReadyAt(b.dataset.perkBtn) - now);
        });
    };
    clearInterval(perksTicker);
    perksTicker = setInterval(tick, 1000);
    tick();
    renderPerkSessions();
}
async function renderPerkSessions() {
    const list = document.getElementById("perk-list"), summary = document.getElementById("perk-summary");
    if (!list) return;
    const perks = myPerks() || {};
    let live = [], bySid = new Map();
    try {
        live = (await onlineSessions()).filter(p => p.s !== "light");
        for (let i = 0; i < live.length; i += 30) {
            const snap = await cloudDb.collection("profiles").where("sid", "in", live.slice(i, i + 30).map(x => x.id)).get();
            snap.docs.forEach(d => bySid.set((d.data() || {}).sid, { uid: d.id, ...(d.data() || {}) }));
        }
        if (typeof fbCount === "function") fbCount(live.length + bySid.size + 1, 0);
    } catch (e) {
        summary.textContent = "Couldn't load who's online: " + (e.message || e);
        return;
    }
    const mine = typeof window.gnSessionId === "function" ? window.gnSessionId() : "";
    const owner = typeof getSiteOwnerUid === "function" ? getSiteOwnerUid() : "";
    // Not yourself, and never the owner
    live = live.filter(p => p.id !== mine && !(bySid.get(p.id) && bySid.get(p.id).uid === owner))
        .sort((a, b) => (b.t?.toMillis?.() || 0) - (a.t?.toMillis?.() || 0));
    summary.textContent = live.length ? `${live.length} other ${live.length === 1 ? "person" : "people"} on the site right now` : "Nobody else is on the site right now.";
    list.innerHTML = "";
    for (const p of live) {
        const acct = bySid.get(p.id);
        const name = acct ? acct.username : `Guest ${p.id.slice(0, 6)}`;
        const game = p.g && typeof zoneById === "function" ? zoneById(p.g) : null;
        const row = document.createElement("div");
        row.className = "admin-row";
        const head = document.createElement("div");
        head.innerHTML = `<span class="admin-presence on">${escapeHtmlText(game ? "Playing " + game.name : "Browsing")}</span> <b>${escapeHtmlText(name)}</b>`;
        row.appendChild(head);
        const acts = document.createElement("div");
        acts.className = "admin-actions";
        const mk = (k, label, icon, fn) => {
            const b = document.createElement("button");
            b.type = "button"; b.className = "finder-chip" + (k === "boot" ? " danger" : "");
            b.dataset.perkBtn = k;
            b.innerHTML = gnIcon(icon) + " " + label;
            b.disabled = perkReadyAt(k) > Date.now();
            b.onclick = async () => {
                b.dataset.busy = "1"; b.disabled = true;
                try { await fn(); } catch (e) { notify("That didn't work: " + (e.message || e), { type: "error" }); }
                delete b.dataset.busy;
                b.disabled = perkReadyAt(k) > Date.now();
            };
            acts.appendChild(b);
            return b;
        };
        const tag = document.createElement("span");
        tag.className = "find-screen-tag"; tag.hidden = true;
        if ("find" in perks) mk("find", "Find screen", "eye", async () => {
            const keys = Object.keys(IDENTIFY_COLORS);
            const c = keys[Math.floor(Math.random() * keys.length)], n = 10 + Math.floor(Math.random() * 90);
            await usePerk("find", b => b.set(cloudDb.collection("identify").doc(p.id), {
                k: "find", c, n, until: firebase.firestore.Timestamp.fromMillis(Date.now() + IDENTIFY_MS),
                by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp()
            }));
            const [cname, hex] = IDENTIFY_COLORS[c];
            Object.assign(tag.style, { background: hex, color: c === "yellow" || c === "cyan" ? "#111" : "#fff" });
            tag.textContent = `Look for: ${cname} ${n}`; tag.hidden = false;
            setTimeout(() => { tag.hidden = true; }, IDENTIFY_MS);
        });
        if ("scare" in perks) mk("scare", "Jumpscare", "ghost", async () => {
            if (!(await askConfirm(`Jumpscare ${name}? ${getScareStyle() === "instant" ? "A scary picture fills their screen right away with a scream. About 2 seconds" : "Their game freezes, a fake error pops up, then a scary picture fills their screen with a scream. About 7 seconds"}; their game carries on after. You can do it again in ${cooldownText(perks.scare)}.`, { title: "Jumpscare?", confirmText: "Do it" }))) return;
            const pool = typeof SCARE_BANK !== "undefined" ? SCARE_BANK.map(x => x.url) : [];
            const pic = pool.length ? pool[Math.floor(Math.random() * pool.length)] : "";
            await usePerk("scare", b => b.set(cloudDb.collection("identify").doc(p.id), {
                ...(pic ? { u: pic } : {}),
                m: getScareStyle(), k: "scare", c: "red", n: 1, until: firebase.firestore.Timestamp.fromMillis(Date.now() + 15000),
                by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp()
            }));
            notify(`Jumpscared ${name}.`, { type: "success" });
        });
        if ("troll" in perks) {
            const tp = trollPicker(name, async doc => {
                await usePerk("troll", b => b.set(cloudDb.collection("identify").doc(p.id), doc));
            });
            tp.button.dataset.perkBtn = "troll";
            tp.button.disabled = perkReadyAt("troll") > Date.now();
            acts.appendChild(tp);
        }
        let time = null;
        if ("boot" in perks) {
            time = document.createElement("select");
            time.setAttribute("aria-label", "How long");
            PERK_BOOT_TIMES.forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; time.appendChild(o); });
            time.value = "5";
            mk("boot", "Boot", "ban", async () => {
                const mins = Number(time.value), tl = PERK_BOOT_TIMES.find(x => x[0] === mins)[1];
                if (!(await askConfirm(`${name} will be removed from the site for ${tl}. Their progress is saved first. You can boot someone again in ${cooldownText(perks.boot)}.`, { title: "Boot?", confirmText: "Boot", danger: true }))) return;
                const data = {
                    until: firebase.firestore.Timestamp.fromMillis(Date.now() + mins * 60000), reason: "",
                    by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp(),
                    name: String(name).slice(0, 40), info: ""
                };
                await usePerk("boot", b => b.set(cloudDb.collection("boots").doc(p.id), data), ["boot", p.id, name, tl + " (ability)"]);
                notify(`${name} is booted for ${tl}.`, { type: "success" });
            });
            acts.appendChild(time);
        }
        acts.appendChild(tag);
        row.appendChild(acts);
        list.appendChild(row);
    }
}

// ── One account's activity: likes, dislikes, broken reports, reports & ideas ─
function adminGameName(id) {
    const all = (typeof ZONES_ALL !== "undefined" && ZONES_ALL) || (typeof zones !== "undefined" ? zones : []);
    const z = all.find(x => String(x.id) === String(id));
    return { zone: z || null, name: z ? z.name : `Game #${id} (not on the site any more)` };
}
function renderAdminActivity(box, p) {
    const st = adminData.stats.get(p.uid) || { likes: [], dislikes: [], broken: [] };
    const fb = (adminData.feedback && adminData.feedback.get(p.uid)) || [];
    box.innerHTML = "";
    const section = (title, count, open) => {
        const d = document.createElement("details");
        d.className = "admin-act-sec";
        if (open) d.open = true;
        const s = document.createElement("summary");
        s.textContent = `${title} (${count})`;
        d.appendChild(s);
        const list = document.createElement("div");
        list.className = "admin-act-list";
        d.appendChild(list);
        box.appendChild(d);
        return list;
    };
    const empty = (list, text) => { const e = document.createElement("small"); e.className = "admin-act-empty"; e.textContent = text; list.appendChild(e); };
    // A game with "open" and (for mods) "remove this one" buttons
    const gameItem = (list, item, kind) => {
        const { zone, name } = adminGameName(item.gameId);
        const row = document.createElement("div");
        row.className = "admin-act-item";
        const label = document.createElement("span");
        label.textContent = name + (item.at ? " · " + fmtDate(item.at) : "");
        row.appendChild(label);
        if (zone) {
            const open = document.createElement("button");
            open.type = "button"; open.className = "finder-chip"; open.textContent = "Open";
            open.onclick = () => { closePopup(); openZone(zone); };
            row.appendChild(open);
        }
        if (!isSiteAdmin()) { list.appendChild(row); return; }
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "finder-chip danger";
        rm.textContent = kind === "broken" ? "Remove report" : "Remove rating";
        rm.onclick = async () => {
            rm.disabled = true;
            try {
                const del = firebase.firestore.FieldValue.delete();
                const field = kind === "broken" ? "r" : "v";
                await cloudDb.collection("gameStats").doc(item.shard).set({ ["z" + item.gameId]: { [field]: { [p.uid]: del } } }, { merge: true });
                logAction("remove_rating", p.uid, String(p.username || ""), `${kind === "broken" ? "broken report" : kind} on ${adminGameName(item.gameId).name}`);
                if (typeof fbCount === "function") fbCount(0, 1);
                const arr = kind === "broken" ? st.broken : kind === "like" ? st.likes : st.dislikes;
                arr.splice(arr.indexOf(item), 1);
                if (kind === "broken") st.reports--; else st.votes--;
                if (typeof loadGameStats === "function") loadGameStats({ force: true });
                renderAdminActivity(box, p);
                const meta = box.parentElement?.querySelector(":scope > summary small");
                if (meta) meta.textContent = meta.textContent.replace(/\d+ ratings?/, `${st.votes} rating${st.votes === 1 ? "" : "s"}`).replace(/\d+ reports?/, `${st.reports} report${st.reports === 1 ? "" : "s"}`);
                notify("Removed.", { type: "success" });
            } catch (e) { rm.disabled = false; notify("Couldn't remove it: " + (e.message || e), { type: "error" }); }
        };
        row.appendChild(rm);
        list.appendChild(row);
    };
    const byName = arr => [...arr].sort((a, b) => adminGameName(a.gameId).name.localeCompare(adminGameName(b.gameId).name));
    let list = section("Liked", st.likes.length, st.likes.length > 0 && st.likes.length <= 12);
    if (!st.likes.length) empty(list, "No likes."); else byName(st.likes).forEach(i => gameItem(list, i, "like"));
    list = section("Disliked", st.dislikes.length, st.dislikes.length > 0 && st.dislikes.length <= 12);
    if (!st.dislikes.length) empty(list, "No dislikes."); else byName(st.dislikes).forEach(i => gameItem(list, i, "dislike"));
    list = section("Reported as broken", st.broken.length, st.broken.length > 0);
    if (!st.broken.length) empty(list, "No broken-game reports."); else [...st.broken].sort((a, b) => timeOf(b.at) - timeOf(a.at)).forEach(i => gameItem(list, i, "broken"));
    list = section("Reports & ideas sent", fb.length, fb.length > 0);
    if (!fb.length) empty(list, "Nothing sent.");
    else [...fb].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).forEach(f => {
        const row = document.createElement("div");
        row.className = "admin-act-item admin-act-fb";
        const t = document.createElement("span");
        const status = (typeof FEEDBACK_STATUS !== "undefined" && FEEDBACK_STATUS[f.type]?.[f.status]) || f.status;
        t.textContent = `${f.type === "feature" ? "Idea:" : "Problem:"} ${f.title}${f.gameName ? " · " + f.gameName : ""} · ${status}${f.createdAt ? " · " + fmtDate(f.createdAt) : ""}`;
        t.title = f.details || "";
        row.appendChild(t);
        const view = document.createElement("button");
        view.type = "button"; view.className = "finder-chip"; view.textContent = "View";
        view.onclick = () => {
            const tab = document.querySelector('.admin-tabs button[data-tab="feedback"]');
            if (typeof modFeedbackFilter !== "undefined") modFeedbackFilter = "all";
            tab?.click();
            setTimeout(() => {
                const el = [...document.querySelectorAll(".fb-review")].find(r => r.querySelector("b")?.textContent.includes(f.title));
                if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("admin-flash"); setTimeout(() => el.classList.remove("admin-flash"), 1600); }
            }, 900);
        };
        row.appendChild(view);
        list.appendChild(row);
    });
}

// Delete one account's votes and reports from every stats shard
async function adminRemoveStats(uid) {
    const snap = await cloudDb.collection("gameStats").get();
    const del = firebase.firestore.FieldValue.delete();
    let n = 0;
    for (const d of snap.docs) {
        const data = d.data() || {};
        const update = {};
        for (const [k, entry] of Object.entries(data)) {
            if (!/^z/.test(k) || !entry) continue;
            if (entry.v && uid in entry.v) { update[k] = update[k] || {}; update[k].v = { [uid]: del }; n++; }
            if (entry.r && uid in entry.r) { update[k] = update[k] || {}; update[k].r = { ...(update[k].r || {}), [uid]: del }; n++; }
        }
        if (Object.keys(update).length) await d.ref.set(update, { merge: true });
    }
    return n;
}


// ── New library games ───────────────────────────────────────────────────────
// The game library is pinned to its last clean version (October 10, 2026), so
// games it adds later are hidden. Admins and the owner get a notice when new
// ones appear, so each can be checked and added safely (e.g. to GN Originals).
function renderNewLibraryGames() {
    const box = document.getElementById("admin-newgames");
    if (!box) return;
    const all = typeof newLibraryGames !== "undefined" ? newLibraryGames : [];
    const seen = checkedNewGames();
    if (!all.length) { box.innerHTML = `<p class="admin-summary">No new library games. Everything in the library's game list is in the clean version.</p>`; return; }
    box.innerHTML = `<p class="admin-summary">${all.length} game${all.length === 1 ? "" : "s"} added to the library after its last clean version (October 10). They're hidden from players because every newer library version contains the malicious ad script. Check each one (for example, whether it can be loaded from its original source) before adding it to GN Originals.</p>
        <div class="admin-list">${all.map(g => `<div class="newgame-row"><div><b>${escapeHtmlText(g.name)}</b><div class="newgame-meta">Library id ${escapeHtmlText(String(g.id))} · ${escapeHtmlText(g.file)}${g.author ? " · by " + escapeHtmlText(g.author) : ""}</div></div>
            <button type="button" class="newgame-btn" data-newgame="${escapeHtmlText(String(g.id))}">${seen.has(String(g.id)) ? "Checked ✓" : "Mark checked"}</button></div>`).join("")}</div>
        <p class="admin-footnote">"Mark checked" only hides the notice on this browser; it doesn't add the game.</p>`;
    box.querySelectorAll("[data-newgame]").forEach(b => b.onclick = () => {
        const set = checkedNewGames(), id = b.dataset.newgame;
        set.has(id) ? set.delete(id) : set.add(id);
        setCheckedNewGames(set); renderNewLibraryGames();
    });
}
