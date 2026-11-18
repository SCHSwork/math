// ═════════════════════════════════════════════════════════════════════════════
// Instant changes over Firebase's live connection (the database code is
// already loaded for everyone by accounts.js, so this adds no download).
//
//  • Boots: each tab listens to boots/<its session id>. An admin's boot arrives
//    in a second or two; a lifted boot lets them back in right away. Costs one
//    read when the page opens, then nothing unless a boot is added or lifted.
//  • Site mode: every tab listens to site/mode { mode, msg, backAt, access, at }, which
//    the owner's browser writes whenever the site mode, its message or its
//    "back at" time changes (alongside the usual save to GitHub). Lock,
//    maintenance and shutdown reach everyone at once instead of waiting for
//    GitHub's copy (up to ~5 minutes). One read on open, one per change.
//    Whichever is newer wins: this or the owner settings from GitHub.
//
// If the live connection can't start (blocked network, rules not published),
// the old ways still work: the heartbeat check for boots and the GitHub
// settings for site modes.
// ═════════════════════════════════════════════════════════════════════════════
const REALTIME_LIVE_MODE_KEY = "gnmath-live-site-mode";   // { mode, msg, backAt, at } last seen live

// The live site mode last applied here (its time is compared with GitHub's copy)
function getLiveSiteModeAt() {
    try { return Number(JSON.parse(localStorage.getItem(REALTIME_LIVE_MODE_KEY) || "null")?.at) || 0; } catch { return 0; }
}

(function () {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) return;
    const count = (r) => { try { if (typeof fbCount === "function") fbCount(r, 0); } catch {} };
    const ms = v => v && typeof v.toMillis === "function" ? v.toMillis() : 0;

    function start() {
        // ── Boots ────────────────────────────────────────────────────────────
        const sid = typeof window.gnSessionId === "function" ? window.gnSessionId() : "";
        if (/^[A-Za-z0-9]{20}$/.test(sid) && window.gnBoot) {
            cloudDb.collection("boots").doc(sid).onSnapshot(snap => {
                count(1);
                const d = snap.exists ? snap.data() || {} : null;
                const until = d ? ms(d.until) : 0;
                if (until > Date.now()) window.gnBoot.apply({ until, reason: String(d.reason || "").slice(0, 200) });
                else window.gnBoot.lift();
            }, () => { window.gnBoot.listenFailed && window.gnBoot.listenFailed(); });
        }
        // ── Find screen (identify.js) ────────────────────────────────────────
        if (/^[A-Za-z0-9]{20}$/.test(sid) && typeof gnShowIdentify === "function") {
            let shownAt = 0;
            cloudDb.collection("identify").doc(sid).onSnapshot(snap => {
                count(1);
                const d = snap.exists ? snap.data() || {} : null;
                const at = d ? ms(d.at) : 0, until = d ? ms(d.until) : 0;
                if (!d || until <= Date.now()) { gnHideIdentify(); return; }
                if (at && at <= shownAt) return;
                shownAt = at || Date.now();
                gnShowIdentify({ c: String(d.c || ""), n: Number(d.n), until });
            }, () => {});
        }

        // ── Site mode ────────────────────────────────────────────────────────
        cloudDb.collection("site").doc("mode").onSnapshot(snap => {
            count(1);
            if (!snap.exists) return;
            const d = snap.data() || {};
            const at = ms(d.at);
            if (!at || typeof OWNER_SITE_MODES === "undefined" || !OWNER_SITE_MODES.includes(d.mode)) return;
            // Older than what this browser already has (from GitHub or live): skip
            if (at <= getLiveSiteModeAt()) return;
            if (typeof getAppliedSettingsAt === "function" && at <= getAppliedSettingsAt()) return;
            // The owner's own browser already has its change
            if (typeof getGithubPat === "function" && getGithubPat()) return;
            try { localStorage.setItem(REALTIME_LIVE_MODE_KEY, JSON.stringify({ mode: d.mode, at })); } catch {}
            try {
                localStorage.setItem(OWNER_STORAGE_KEYS.siteMode, d.mode);
                localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteMessage, String(d.msg || "").slice(0, 400));
                localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteBackAt, d.backAt && !isNaN(Date.parse(d.backAt)) ? d.backAt : "");
                // Checked again whenever it's read (getSiteAccess)
                if (d.access && typeof d.access === "object" && typeof setSiteAccess === "function") setSiteAccess(d.access);
            } catch {}
            if (typeof applyOwnerSiteMode === "function") applyOwnerSiteMode();
        }, () => {});
    }

    // Wait for accounts.js to set up Firebase (it loads right after the page)
    let tries = 0;
    (function wait() {
        if (typeof cloudDb !== "undefined" && cloudDb) { try { start(); } catch (e) { console.warn("Live updates unavailable", e); } return; }
        if (++tries < 240) setTimeout(wait, 500);
        else if (window.gnBoot && window.gnBoot.listenFailed) window.gnBoot.listenFailed();
    })();
})();

// Owner: publish the site mode, its message and "back at" time to site/mode
// so open pages switch right away. Needs the owner signed in to their account.
let _liveModeLast = "";
let _liveModeTimer = null;
function publishLiveSiteMode() {
    if (typeof cloudDb === "undefined" || !cloudDb || typeof cloudUser === "undefined" || !cloudUser) return;
    if (typeof getSiteOwnerUid === "function" && getSiteOwnerUid() && cloudUser.uid !== getSiteOwnerUid()) return;
    const data = {
        mode: getOwnerSiteMode(),
        msg: (typeof getOwnerSiteMessage === "function" ? getOwnerSiteMessage() : "").slice(0, 400),
        backAt: (typeof getSiteBackAt === "function" ? getSiteBackAt() : "") || "",
        // The password to get in and the accounts let in, so a new password
        // works right away instead of after GitHub's copy updates
        access: typeof getSiteAccess === "function" ? (a => ({ allowed: a.allowed, pass: a.pass }))(getSiteAccess()) : { allowed: [], pass: null }
    };
    const key = JSON.stringify(data);
    if (key === _liveModeLast) return;
    clearTimeout(_liveModeTimer);
    _liveModeTimer = setTimeout(async () => {
        try {
            await cloudDb.collection("site").doc("mode").set({ ...data, at: firebase.firestore.FieldValue.serverTimestamp() });
            _liveModeLast = key;
            try { if (typeof fbCount === "function") fbCount(0, 1); } catch {}
        } catch (e) { console.warn("Couldn't publish the site mode live", e); }
    }, 400);
}
