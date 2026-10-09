// ═════════════════════════════════════════════════════════════════════════════
// Admin Panel: account management for site admins.
//
// Roles (all checked by config/firestore.rules, not just by this page):
//   • Game admin: a document admins/<uid>. Admins review game submissions,
//     manage accounts and can make other accounts admins. The very first admin
//     is added once in the Firebase console.
//   • Trusted reporter: listed in config/owner-settings.json (needs the owner's
//     GitHub token on this browser to change).
//   • Suspended: a document bans/<uid>. A suspended account can still play and
//     keep its cloud save, but can't rate, report or submit games.
// Every account keeps a small profile (profiles/<uid>: username, joined, last
// seen) so admins can find it. Passwords and cloud saves are never visible.
// ═════════════════════════════════════════════════════════════════════════════
let siteAdminState = { uid: null, admin: false, banned: null };

// Profile + role check, run whenever someone signs in
async function syncMyProfileAndRoles(user) {
    siteAdminState = { uid: user ? user.uid : null, admin: false, banned: null };
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
    try {
        const b = await cloudDb.collection("bans").doc(user.uid).get();
        if (b && b.exists) {
            siteAdminState.banned = b.data() || {};
            const why = siteAdminState.banned.reason ? ` Reason: ${siteAdminState.banned.reason}` : "";
            notify(`This account is suspended, so it can't rate, report or submit games. You can still play and keep your saves.${why}`, { type: "error", duration: 9000 });
        }
    } catch (e) {}
    if (typeof refreshAccountButtonAdmin === "function") refreshAccountButtonAdmin();
}
function isSiteAdmin() { return !!(siteAdminState.admin && cloudUser && siteAdminState.uid === cloudUser.uid); }
function isSuspended() { return !!(siteAdminState.banned && cloudUser && siteAdminState.uid === cloudUser.uid); }
function refreshAccountButtonAdmin() {
    const btn = document.getElementById("accountButton");
    if (btn) btn.classList.toggle("is-admin", isSiteAdmin());
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
    const [profiles, admins, bans, subs, stats] = await Promise.all([
        cloudDb.collection("profiles").get(),
        cloudDb.collection("admins").get(),
        cloudDb.collection("bans").get(),
        cloudDb.collection("submissions").get().catch(() => ({ docs: [] })),
        cloudDb.collection("gameStats").get().catch(() => ({ docs: [] }))
    ]);
    const statMap = new Map();
    for (const d of stats.docs) {
        const data = d.data() || {};
        for (const [k, entry] of Object.entries(data)) {
            if (!/^z/.test(k) || !entry) continue;
            for (const uid of Object.keys(entry.v || {})) { const s = statMap.get(uid) || { votes: 0, reports: 0 }; s.votes++; statMap.set(uid, s); }
            for (const uid of Object.keys(entry.r || {})) { const s = statMap.get(uid) || { votes: 0, reports: 0 }; s.reports++; statMap.set(uid, s); }
        }
    }
    const subMap = new Map();
    subs.docs.forEach(d => { const u = (d.data() || {}).uid; if (u) subMap.set(u, (subMap.get(u) || 0) + 1); });
    adminData = {
        profiles: profiles.docs.map(d => ({ uid: d.id, ...(d.data() || {}) })),
        admins: new Map(admins.docs.map(d => [d.id, d.data() || {}])),
        bans: new Map(bans.docs.map(d => [d.id, d.data() || {}])),
        subs: subMap,
        stats: statMap
    };
    // Admins/bans whose account has no profile yet still show up
    for (const uid of [...adminData.admins.keys(), ...adminData.bans.keys()]) {
        if (!adminData.profiles.some(p => p.uid === uid)) {
            adminData.profiles.push({ uid, username: adminData.admins.get(uid)?.name || adminData.bans.get(uid)?.name || "(no profile yet)" });
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
    if (!isSiteAdmin()) {
        await syncMyProfileAndRoles(cloudUser);
    }
    if (!isSiteAdmin()) {
        body.innerHTML = `<p>This account (<b>${escapeHtmlText(currentUsername())}</b>) isn't a game admin.</p>
            <p style="color:var(--text-muted);font-size:14px;">An existing admin can make it one from their Admin Panel. The very first admin is added once in the Firebase console: in <b>Firestore Database → Data</b>, add a document to a collection named <code>admins</code>, using this account's ID <code>${escapeHtmlText(cloudUser.uid)}</code> as the document ID.</p>`;
        return;
    }
    body.innerHTML = `
        <div class="admin-tabs" role="tablist">
            <button type="button" role="tab" data-tab="accounts" aria-selected="true">Accounts</button>
            <button type="button" role="tab" data-tab="submissions" aria-selected="false">Game submissions</button>
        </div>
        <div id="admin-accounts">
            <div class="admin-toolbar">
                <input type="search" id="admin-search" placeholder="Search usernames…" aria-label="Search accounts" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
                <select id="admin-filter" aria-label="Show">
                    <option value="all">All accounts</option>
                    <option value="admins">Admins</option>
                    <option value="trusted">Trusted reporters</option>
                    <option value="banned">Suspended</option>
                    <option value="recent">Seen this week</option>
                </select>
            </div>
            <p id="admin-summary" class="admin-summary">Loading accounts…</p>
            <div id="admin-list" class="admin-list"></div>
            <p class="admin-footnote">Passwords and cloud saves are private, even from admins. To delete an account completely or reset a password, use the Firebase console (Authentication → Users). Accounts show up here after they next visit the site.</p>
        </div>
        <div id="admin-submissions" hidden><div id="owner-submissions" class="owner-panel-list"></div></div>`;
    body.querySelectorAll(".admin-tabs button").forEach(b => b.onclick = () => {
        body.querySelectorAll(".admin-tabs button").forEach(x => x.setAttribute("aria-selected", x === b ? "true" : "false"));
        document.getElementById("admin-accounts").hidden = b.dataset.tab !== "accounts";
        document.getElementById("admin-submissions").hidden = b.dataset.tab !== "submissions";
        if (b.dataset.tab === "submissions" && typeof renderOwnerSubmissions === "function") renderOwnerSubmissions();
    });
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

function adminRoleBadges(p) {
    const out = [];
    if (adminData.admins.has(p.uid)) out.push(["Admin", "admin"]);
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
        if (filter === "admins") return adminData.admins.has(p.uid);
        if (filter === "trusted") return typeof isTrustedReporter === "function" && isTrustedReporter(p.uid);
        if (filter === "banned") return adminData.bans.has(p.uid);
        if (filter === "recent") return timeOf(p.lastSeen) >= weekAgo;
        return true;
    });
    rows.sort((a, b) => timeOf(b.lastSeen) - timeOf(a.lastSeen) || String(a.username).localeCompare(String(b.username)));
    const total = adminData.profiles.length;
    document.getElementById("admin-summary").textContent =
        `${total.toLocaleString()} account${total === 1 ? "" : "s"} · ${adminData.admins.size} admin${adminData.admins.size === 1 ? "" : "s"} · ${adminData.bans.size} suspended` +
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

    const box = document.createElement("div");
    box.className = "admin-actions";
    const me = cloudUser && p.uid === cloudUser.uid;
    const isAdm = adminData.admins.has(p.uid);
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
            if (!(await askConfirm(`${p.username} will no longer be able to manage accounts or review submissions.`, { title: "Remove game admin?", confirmText: "Remove admin", danger: true }))) return;
            await cloudDb.collection("admins").doc(p.uid).delete();
            adminData.admins.delete(p.uid);
        } else {
            if (!(await askConfirm(`${p.username} will be able to manage accounts (including making other admins and suspending people) and review game submissions.`, { title: "Make game admin?", confirmText: "Make admin" }))) return;
            const data = { name: String(p.username || "").slice(0, 40), addedBy: currentUsername().slice(0, 40), addedAt: firebase.firestore.FieldValue.serverTimestamp() };
            await cloudDb.collection("admins").doc(p.uid).set(data);
            adminData.admins.set(p.uid, data);
        }
        notify(isAdm ? `${p.username} is no longer a game admin.` : `${p.username} is now a game admin.`, { type: "success" });
        renderAdminList();
    }, me ? { disabled: "You can't remove your own admin access. Ask another admin." } : {});
    btn(trusted ? "Remove trusted reporter" : "Make trusted reporter", async () => {
        const list = getTrustedReporters();
        setTrustedReporters(trusted ? list.filter(x => x.uid !== p.uid) : [...list, { uid: p.uid, name: String(p.username || "").slice(0, 40) }]);
        if (typeof githubAutoSync === "function") githubAutoSync();
        if (typeof refreshCards === "function") refreshCards();
        notify(trusted ? `${p.username} is no longer a trusted reporter.` : `${p.username} is now a trusted reporter. Saved to GitHub.`, { type: "success" });
        renderAdminList();
    }, canTrust ? {} : { disabled: "Trusted reporters are saved to GitHub, so this needs the owner's GitHub token on this browser (Owner Panel)." });
    btn(isBan ? "Unsuspend" : "Suspend", async () => {
        if (isBan) {
            await cloudDb.collection("bans").doc(p.uid).delete();
            adminData.bans.delete(p.uid);
            notify(`${p.username} is no longer suspended.`, { type: "success" });
        } else {
            const reason = document.getElementById("admin-reason-" + p.uid)?.value.trim().slice(0, 200) || "";
            if (!(await askConfirm(`${p.username} will still be able to play and keep their saves, but won't be able to rate, report or submit games.${reason ? " Reason shown to them: " + reason : ""}`, { title: "Suspend account?", confirmText: "Suspend", danger: true }))) return;
            const data = { name: String(p.username || "").slice(0, 40), reason, by: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp() };
            await cloudDb.collection("bans").doc(p.uid).set(data);
            adminData.bans.set(p.uid, data);
            notify(`${p.username} is suspended.`, { type: "success" });
        }
        renderAdminList();
    }, me ? { disabled: "You can't suspend yourself.", danger: true } : { danger: true });
    btn("Remove their ratings & reports", async () => {
        if (!(await askConfirm(`Delete every rating and broken report from ${p.username}? This can't be undone.`, { title: "Remove ratings & reports?", confirmText: "Remove", danger: true }))) return;
        const n = await adminRemoveStats(p.uid);
        adminData.stats.delete(p.uid);
        if (typeof loadGameStats === "function") loadGameStats({ force: true });
        notify(`Removed ${n} rating(s)/report(s) from ${p.username}.`, { type: "success" });
        renderAdminList();
    }, { danger: true });
    if (adminData.subs.get(p.uid)) btn("Delete their submissions", async () => {
        if (!(await askConfirm(`Delete all game submissions from ${p.username}?`, { title: "Delete submissions?", confirmText: "Delete", danger: true }))) return;
        const snap = await cloudDb.collection("submissions").where("uid", "==", p.uid).get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));
        adminData.subs.delete(p.uid);
        notify(`Deleted ${snap.docs.length} submission(s).`, { type: "success" });
        renderAdminList();
    }, { danger: true });
    if (!isBan && !me) {
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
