// ═════════════════════════════════════════════════════════════════════════════
// Admin Panel: account management for site admins.
//
// Roles (all checked by config/firestore.rules, not just by this page):
//   • Owner: the account in ownerUid() in config/firestore.rules, filled in by
//     the site when the owner saves their GitHub token (see claimOwnerAccount).
//     Always an admin. Only the owner can add or remove admins, and nobody can
//     remove or suspend the owner.
//   • Game admin: a document admins/<uid>. Admins manage accounts, handle
//     takedowns, review everything mods can, and add or remove mods.
//   • Mod: a document mods/<uid>. Mods review reports, ideas and game
//     submissions, and can look at the account list without changing anything.
//   • Trusted reporter: listed in config/owner-settings.json (needs the owner's
//     GitHub token on this browser to change).
//   • Suspended: a document bans/<uid>. A suspended account can still play and
//     keep its cloud save, but can't rate, report or submit games.
// Every account keeps a small profile (profiles/<uid>: username, joined, last
// seen) so admins can find it. Passwords and cloud saves are never visible.
// ═════════════════════════════════════════════════════════════════════════════
let siteAdminState = { uid: null, admin: false, owner: false, mod: false, banned: null };

// Profile + role check, run whenever someone signs in
async function syncMyProfileAndRoles(user) {
    siteAdminState = { uid: user ? user.uid : null, admin: false, owner: false, mod: false, banned: null };
    if (!user || !cloudDb) return;
    const username = (user.email || "").split("@")[0].slice(0, 40);
    try {
        const ref = cloudDb.collection("profiles").doc(user.uid);
        const created = user.metadata && user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : "";
        await ref.set({ username, createdAt: created, lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { /* rules not published yet: ignore */ }
    try {
        const a = await cloudDb.collection("admins").doc(user.uid).get();
        siteAdminState.admin = !!(a && a.exists);
    } catch (e) {}
    if (typeof getSiteOwnerUid === "function" && user.uid === getSiteOwnerUid()) {
        siteAdminState.owner = true;
        siteAdminState.admin = true;
    }
    try {
        const m = await cloudDb.collection("mods").doc(user.uid).get();
        siteAdminState.mod = !!(m && m.exists);
    } catch (e) {}
    try {
        const b = await cloudDb.collection("bans").doc(user.uid).get();
        if (b && b.exists) {
            siteAdminState.banned = b.data() || {};
            const why = siteAdminState.banned.reason ? ` Reason: ${siteAdminState.banned.reason}` : "";
            notify(`This account is suspended, so it can't rate, report or submit games. You can still play and keep your saves.${why}`, { type: "error", duration: 9000 });
        }
    } catch (e) {}
    if (typeof refreshAccountButtonAdmin === "function") refreshAccountButtonAdmin();
    // Owner's browser (GitHub token saved): make sure this account is the owner
    if (isOwnerBrowser() && typeof claimOwnerAccount === "function") claimOwnerAccount();
}
function isSiteAdmin() { return !!(siteAdminState.admin && cloudUser && siteAdminState.uid === cloudUser.uid); }
function isSiteOwner() { return !!(siteAdminState.owner && isSiteAdmin()); }
// Admins, or mods who aren't suspended
function isSiteMod() { return isSiteAdmin() || !!(siteAdminState.mod && !siteAdminState.banned && cloudUser && siteAdminState.uid === cloudUser.uid); }
function isSuspended() { return !!(siteAdminState.banned && cloudUser && siteAdminState.uid === cloudUser.uid); }
function refreshAccountButtonAdmin() {
    if (cloudUser && siteAdminState.uid === cloudUser.uid && typeof getSiteOwnerUid === "function" && cloudUser.uid === getSiteOwnerUid()) {
        siteAdminState.owner = true;
        siteAdminState.admin = true;
    }
    const btn = document.getElementById("accountButton");
    if (btn) btn.classList.toggle("is-admin", isSiteMod());
}

function fmtDate(v) {
    if (!v) return "";
    const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
    return isNaN(d) ? "" : d.toLocaleDateString();
}
function timeOf(v) {
    if (!v) return 0;
    const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
    return isNaN(d) ? 0 : d.getTime();
}

let adminData = null;   // { profiles, admins:Set, bans:Map, subs:Map uid→count, stats:Map uid→{votes,reports} }
async function loadAdminData() {
    const [profiles, admins, mods, bans, subs, stats, feedback] = await Promise.all([
        cloudDb.collection("profiles").get(),
        cloudDb.collection("admins").get(),
        cloudDb.collection("mods").get().catch(() => ({ docs: [] })),
        cloudDb.collection("bans").get(),
        cloudDb.collection("submissions").get().catch(() => ({ docs: [] })),
        cloudDb.collection("gameStats").get().catch(() => ({ docs: [] })),
        cloudDb.collection("feedback").get().catch(() => ({ docs: [] }))
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
        subs: subMap,
        stats: statMap,
        feedback: fbMap
    };
    // Admins/bans whose account has no profile yet still show up
    for (const uid of [...adminData.admins.keys(), ...adminData.mods.keys(), ...adminData.bans.keys()]) {
        if (!adminData.profiles.some(p => p.uid === uid)) {
            adminData.profiles.push({ uid, username: adminData.admins.get(uid)?.name || adminData.mods.get(uid)?.name || adminData.bans.get(uid)?.name || "(no profile yet)" });
        }
    }
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
        <div class="admin-tabs" role="tablist">
            <button type="button" role="tab" data-tab="accounts" aria-selected="true">Accounts</button>
            <button type="button" role="tab" data-tab="feedback" aria-selected="false">Reports &amp; ideas</button>
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="takedowns" aria-selected="false">Takedowns</button>`}
            <button type="button" role="tab" data-tab="submissions" aria-selected="false">Game submissions</button>
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="log" aria-selected="false">Log</button>`}
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="errors" aria-selected="false">Errors <span class="admin-tab-count" id="errors-tab-count" hidden></span></button>`}
            ${modOnly ? "" : `<button type="button" role="tab" data-tab="newgames" aria-selected="false">New library games${unreviewedNewGames().length ? ` <span class="admin-tab-count">${unreviewedNewGames().length}</span>` : ""}</button>`}
        </div>
        <div id="admin-accounts">
            <div class="admin-toolbar">
                <input type="search" id="admin-search" data-no-autofill placeholder="Search usernames…" aria-label="Search accounts" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
                <select id="admin-filter" aria-label="Show">
                    <option value="all">All accounts</option>
                    <option value="admins">Admins</option>
                    <option value="mods">Mods</option>
                    <option value="trusted">Trusted reporters</option>
                    <option value="banned">Suspended</option>
                    <option value="recent">Seen this week</option>
                </select>
            </div>
            <p id="admin-summary" class="admin-summary">Loading accounts…</p>
            <div id="admin-list" class="admin-list"></div>
            ${modOnly ? `<p class="admin-footnote">You're a mod, so this list is view-only. Ask an admin to suspend someone or change roles.</p>` : ""}
            <p class="admin-footnote">Passwords and cloud saves are private, even from admins. To delete an account completely or reset a password, use the Firebase console (Authentication → Users). Accounts show up here after they next visit the site.</p>
        </div>
        <div id="admin-submissions" hidden><div id="owner-submissions" class="owner-panel-list"></div></div>
        <div id="admin-newgames" hidden></div>
        <div id="admin-feedback" hidden></div>
        <div id="admin-takedowns" hidden></div>
        <div id="admin-log" hidden></div>
        <div id="admin-errors" hidden></div>`;
    body.querySelectorAll(".admin-tabs button").forEach(b => b.onclick = () => {
        body.querySelectorAll(".admin-tabs button").forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false"));
        document.getElementById("admin-accounts").hidden = b.dataset.tab !== "accounts";
        document.getElementById("admin-submissions").hidden = b.dataset.tab !== "submissions";
        document.getElementById("admin-newgames").hidden = b.dataset.tab !== "newgames";
        document.getElementById("admin-feedback").hidden = b.dataset.tab !== "feedback";
        document.getElementById("admin-takedowns").hidden = b.dataset.tab !== "takedowns";
        document.getElementById("admin-log").hidden = b.dataset.tab !== "log";
        if (document.getElementById("admin-errors")) document.getElementById("admin-errors").hidden = b.dataset.tab !== "errors";
        if (b.dataset.tab === "errors") renderErrorLog();
        if (b.dataset.tab === "log") renderActionLog();
        if (b.dataset.tab === "takedowns" && typeof renderModTakedowns === "function") renderModTakedowns();
        if (b.dataset.tab === "feedback" && typeof renderModFeedback === "function") renderModFeedback();
        if (b.dataset.tab === "newgames") renderNewLibraryGames();
        if (b.dataset.tab === "submissions" && typeof renderOwnerSubmissions === "function") renderOwnerSubmissions();
    });
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
    } catch (e) {
        console.error(e);
        document.getElementById("admin-summary").textContent = "Couldn't load accounts: " + (typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e);
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
// Other actions just add an entry
function logAction(action, target, targetName, detail) {
    if (!cloudUser || !cloudDb) return;
    cloudDb.collection("auditLog").add({ action, target, targetName: String(targetName || "").slice(0, 40), by: cloudUser.uid, byName: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp(), detail: String(detail || "").slice(0, 200) })
        .then(() => { actionLogCache = null; })
        .catch(e => console.error("Couldn't log action", e));
}
const ACTION_LABELS = {
    suspend: "suspended", unsuspend: "unsuspended", make_mod: "made a mod:", remove_mod: "removed mod from",
    make_admin: "made an admin:", remove_admin: "removed admin from", remove_ratings: "removed all ratings & reports from",
    remove_rating: "removed a rating from", delete_submissions: "deleted the submissions of",
    make_trusted: "made a trusted reporter:", remove_trusted: "removed trusted reporter from"
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
            : (errorLogFilter === "open" && !q ? "No open errors. 🎉" : "Nothing matches.");
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
            meta.textContent = [e.gameName ? "🎮 " + e.gameName : "", `${(e.count || 0).toLocaleString()}×`, "last " + when(e.lastAt), "first " + when(e.firstAt)].filter(Boolean).join(" · ");
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
        return true;
    });
    rows.sort((a, b) => timeOf(b.lastSeen) - timeOf(a.lastSeen) || String(a.username).localeCompare(String(b.username)));
    const total = adminData.profiles.length;
    document.getElementById("admin-summary").textContent =
        `${total.toLocaleString()} account${total === 1 ? "" : "s"} · ${adminData.admins.size} admin${adminData.admins.size === 1 ? "" : "s"} · ${adminData.mods.size} mod${adminData.mods.size === 1 ? "" : "s"} · ${adminData.bans.size} suspended` +
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
    const meta = document.createElement("small");
    const st = adminData.stats.get(p.uid) || { votes: 0, reports: 0 };
    meta.textContent = [p.createdAt ? "joined " + fmtDate(p.createdAt) : "", p.lastSeen ? "last seen " + fmtDate(p.lastSeen) : "",
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
    const idLine = document.createElement("small");
    idLine.className = "admin-id";
    idLine.textContent = "Account ID: " + p.uid;
    box.appendChild(idLine);
    row.appendChild(box);
    return row;
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
    let list = section("👍 Liked", st.likes.length, st.likes.length > 0 && st.likes.length <= 12);
    if (!st.likes.length) empty(list, "No likes."); else byName(st.likes).forEach(i => gameItem(list, i, "like"));
    list = section("👎 Disliked", st.dislikes.length, st.dislikes.length > 0 && st.dislikes.length <= 12);
    if (!st.dislikes.length) empty(list, "No dislikes."); else byName(st.dislikes).forEach(i => gameItem(list, i, "dislike"));
    list = section("⚠ Reported as broken", st.broken.length, st.broken.length > 0);
    if (!st.broken.length) empty(list, "No broken-game reports."); else [...st.broken].sort((a, b) => timeOf(b.at) - timeOf(a.at)).forEach(i => gameItem(list, i, "broken"));
    list = section("📝 Reports & ideas sent", fb.length, fb.length > 0);
    if (!fb.length) empty(list, "Nothing sent.");
    else [...fb].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).forEach(f => {
        const row = document.createElement("div");
        row.className = "admin-act-item admin-act-fb";
        const t = document.createElement("span");
        const status = (typeof FEEDBACK_STATUS !== "undefined" && FEEDBACK_STATUS[f.type]?.[f.status]) || f.status;
        t.textContent = `${f.type === "feature" ? "💡" : "⚠️"} ${f.title}${f.gameName ? " · " + f.gameName : ""} · ${status}${f.createdAt ? " · " + fmtDate(f.createdAt) : ""}`;
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
const NEW_GAMES_SEEN_KEY = "gnmath-new-library-games-checked";
function checkedNewGames() { try { return new Set(JSON.parse(localStorage.getItem(NEW_GAMES_SEEN_KEY) || "[]")); } catch { return new Set(); } }
function setCheckedNewGames(set) { try { localStorage.setItem(NEW_GAMES_SEEN_KEY, JSON.stringify([...set])); } catch {} }
function unreviewedNewGames() {
    const seen = checkedNewGames();
    return (typeof newLibraryGames !== "undefined" ? newLibraryGames : []).filter(g => !seen.has(String(g.id)));
}
function isOwnerBrowser() { try { return !!localStorage.getItem("gnmath-owner-github-pat"); } catch { return false; } }
let newGamesNoticeShown = false;
function notifyNewLibraryGames() {
    // Wait until we know whether this is an admin (accounts load after the game list)
    setTimeout(() => {
        if (newGamesNoticeShown) return;
        if (!(isOwnerBrowser() || (typeof isSiteAdmin === "function" && isSiteAdmin()))) return;
        const list = unreviewedNewGames();
        if (!list.length) return;
        newGamesNoticeShown = true;
        notify(`${list.length} new game${list.length === 1 ? " was" : "s were"} added to the game library and ${list.length === 1 ? "is" : "are"} hidden until checked: ${list.slice(0, 3).map(g => g.name).join(", ")}${list.length > 3 ? "…" : ""}. See Admin Panel → New library games.`, { type: "info", duration: 12000 });
    }, 4000);
}
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
