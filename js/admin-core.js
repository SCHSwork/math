// ═════════════════════════════════════════════════════════════════════════════
// Admin, part 1 of 2: what every visitor's page needs. Role checks, the
// signed-in profile heartbeat, the action log and the new-library-games notice.
// The Admin Panel itself (js/admin.js) is only downloaded when it's opened, so
// players never load it; openAdminPanel() below loads it first.
//
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
//   • Abilities: a document perks/<uid> the owner sets. Lets someone use a few
//     admin abilities (Jumpscare, Find screen, Boot for up to 15 min), each
//     with its own cooldown, without being an admin (Abilities panel).
//   • Suspended: a document bans/<uid>. A suspended account can still play and
//     keep its cloud save, but can't rate, report or submit games.
// Every account keeps a small profile (profiles/<uid>: username, joined, last
// seen) so admins can find it. Passwords and cloud saves are never visible.
// ═════════════════════════════════════════════════════════════════════════════
let siteAdminState = { uid: null, admin: false, owner: false, mod: false, banned: null, perks: null, perkUse: {} };

// Profile + role check, run whenever someone signs in
async function syncMyProfileAndRoles(user) {
    siteAdminState = { uid: user ? user.uid : null, admin: false, owner: false, mod: false, banned: null, perks: null, perkUse: {} };
    if (!user || !cloudDb) return;
    await profileBeat(true);
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
    await loadMyPerks(user);
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
// ── Profile heartbeat ───────────────────────────────────────────────────────
// While signed in and the tab is open, the profile's last-seen time, level,
// XP, badges, minutes played, games tried and the game open now are updated
// every 5 minutes (and soon after opening or closing a game), so admins can
// see who's online and what they're playing. One small write each time.
const PROFILE_BEAT_MS = 5 * 60 * 1000;
const PROFILE_ONLINE_MS = 7 * 60 * 1000;     // seen this recently = online
let profileBeatAt = 0, profileLastPlaying = null, profileBeatTimer = null;
function profileStats() {
    const out = {};
    try {
        if (typeof achSummary === "function") {
            const a = achSummary();
            Object.assign(out, { level: a.level, xp: Math.min(a.xp, 1e8), badges: a.earned.length, tried: Math.min(a.stats.tried, 100000), played: Math.min(Math.round(a.stats.totalSec / 60), 1e8) });
        }
    } catch (e) {}
    const v = document.getElementById("zoneViewer");
    const id = typeof currentGameId !== "undefined" && currentGameId ? String(currentGameId) : "";
    out.playing = v && v.style.display === "flex" && /^\d{1,7}$/.test(id) ? id : "";
    // This browser's session id (js/presence.js), so admins can match the account to its session
    try { const sid = typeof window.gnSessionId === "function" ? window.gnSessionId() : ""; if (/^[A-Za-z0-9]{20}$/.test(sid)) out.sid = sid; } catch (e) {}
    return out;
}
async function profileBeat(force) {
    const user = cloudUser;
    if (!user || !cloudDb) return;
    if (!force && (document.hidden || (typeof fbBackgroundPaused === "function" && fbBackgroundPaused()))) return;
    profileBeatAt = Date.now();
    const base = {
        username: (typeof currentUsername === "function" && cloudUser === user ? currentUsername() : (user.email || "").split("@")[0]).slice(0, 40),
        createdAt: user.metadata && user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : "",
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    };
    const extra = profileStats();
    profileLastPlaying = extra.playing;
    const ref = cloudDb.collection("profiles").doc(user.uid);
    try {
        if (typeof fbCount === "function") fbCount(0, 1);
        await ref.set({ ...base, ...extra }, { merge: true });
    } catch (e) {
        // Rules without the new fields yet: keep at least the basics updated
        try { await ref.set(base, { merge: true }); } catch (e2) { /* rules not published yet */ }
    }
}
setInterval(() => { if (cloudUser && Date.now() - profileBeatAt >= PROFILE_BEAT_MS - 5000) profileBeat(false); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && cloudUser && Date.now() - profileBeatAt >= PROFILE_BEAT_MS) profileBeat(false); });
window.profileGameChanged = function () {
    if (!cloudUser || profileStats().playing === profileLastPlaying) return;
    clearTimeout(profileBeatTimer);
    profileBeatTimer = setTimeout(() => { if (profileStats().playing !== profileLastPlaying) profileBeat(false); }, Math.max(0, 60000 - (Date.now() - profileBeatAt)) + 2000);
};
function profileOnline(p) { return Date.now() - timeOf(p.lastSeen) < PROFILE_ONLINE_MS; }
function timeAgo(v) {
    const t = timeOf(v);
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
    return fmtDate(v);
}

function isSiteAdmin() { return !!(siteAdminState.admin && cloudUser && siteAdminState.uid === cloudUser.uid); }
function isSiteOwner() { return !!(siteAdminState.owner && isSiteAdmin()); }
// Admins, or mods who aren't suspended
function isSiteMod() { return isSiteAdmin() || !!(siteAdminState.mod && !siteAdminState.banned && cloudUser && siteAdminState.uid === cloudUser.uid); }
// Abilities the owner gave this account ({ scare: 30, find: 5, boot: 60 },
// minutes between uses), or null
function myPerks() {
    return cloudUser && siteAdminState.uid === cloudUser.uid && !siteAdminState.banned && siteAdminState.perks && Object.keys(siteAdminState.perks).length ? siteAdminState.perks : null;
}
async function loadMyPerks(user = cloudUser) {
    if (!user || !cloudDb) return;
    try {
        const [p, u] = await Promise.all([
            cloudDb.collection("perks").doc(user.uid).get(),
            cloudDb.collection("perkUse").doc(user.uid).get().catch(() => null)
        ]);
        siteAdminState.perks = p && p.exists ? ((p.data() || {}).a || null) : null;
        const use = {};
        if (u && u.exists) for (const [k, v] of Object.entries(u.data() || {})) use[k] = v && v.toMillis ? v.toMillis() : 0;
        siteAdminState.perkUse = use;
    } catch (e) {}
}
function isSuspended() { return !!(siteAdminState.banned && cloudUser && siteAdminState.uid === cloudUser.uid); }
function refreshAccountButtonAdmin() {
    if (cloudUser && siteAdminState.uid === cloudUser.uid && typeof getSiteOwnerUid === "function" && cloudUser.uid === getSiteOwnerUid()) {
        siteAdminState.owner = true;
        siteAdminState.admin = true;
    }
    const btn = document.getElementById("accountButton");
    if (btn) btn.classList.toggle("is-admin", isSiteMod() || !!myPerks());
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

// Other actions just add an entry
function logAction(action, target, targetName, detail) {
    if (!cloudUser || !cloudDb) return;
    cloudDb.collection("auditLog").add({ action, target, targetName: String(targetName || "").slice(0, 40), by: cloudUser.uid, byName: currentUsername().slice(0, 40), at: firebase.firestore.FieldValue.serverTimestamp(), detail: String(detail || "").slice(0, 200) })
        .then(() => { if (typeof actionLogCache !== "undefined") actionLogCache = null; })   // the panel's cached log, once loaded
        .catch(e => console.error("Couldn't log action", e));
}

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

// ── Loading the Admin Panel (js/admin.js) on first use ──────────────────────
let adminPanelLoad = null;
function loadAdminPanel() {
    if (!adminPanelLoad) {
        // The panel also uses the report, submission and prank files (js/lazy.js)
        adminPanelLoad = Promise.all(["feedback", "submit", "identify"].map(gnLoad)).then(() => new Promise((resolve, reject) => {
            const s = document.createElement("script");
            const meta = document.querySelector('meta[name="gn-admin-js"]');
            s.src = (meta && meta.dataset.src) || "js/admin.js";   // versioned by tools/stamp_versions.py
            s.onload = resolve;
            s.onerror = () => { adminPanelLoad = null; reject(new Error("couldn't load the Admin Panel")); };
            document.body.appendChild(s);
        })).catch(e => { adminPanelLoad = null; throw e; });
    }
    return adminPanelLoad;
}
// Replaced by the real one when js/admin.js loads
function openAbilitiesPanel(...args) {
    const stub = openAbilitiesPanel;
    return loadAdminPanel()
        .then(() => { if (window.openAbilitiesPanel !== stub) return window.openAbilitiesPanel(...args); })
        .catch(e => notify("Couldn't open Abilities. Check your connection and try again.", { type: "error" }));
}
function openAdminPanel(...args) {
    const stub = openAdminPanel;
    return loadAdminPanel()
        .then(() => { if (window.openAdminPanel !== stub) return window.openAdminPanel(...args); })
        .catch(e => notify("Couldn't open the Admin Panel. Check your connection and try again.", { type: "error" }));
}
