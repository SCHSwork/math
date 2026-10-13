// ═════════════════════════════════════════════════════════════════════════════
// Firebase usage pacing. The free Firebase plan has a daily limit for the whole
// site (about 50,000 reads and 20,000 writes). When it runs out, accounts,
// ratings and the online count stop for everyone until it resets (midnight US
// Pacific time). So background Firebase work here:
//   • slows down when lots of people are online (more people = more requests)
//   • pauses when Firebase says the limit was reached, and tries again later
// Shared by all tabs in this browser through localStorage. Read by
// presence.js, library.js, accounts.js and the status light.
// ═════════════════════════════════════════════════════════════════════════════
const FB_PACE_KEY = "gnmath-firebase-pace";
const FB_PAUSE_MIN_MS = 15 * 60 * 1000, FB_PAUSE_MAX_MS = 2 * 60 * 60 * 1000;

function getFbPace() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(FB_PACE_KEY) || "null"); } catch {}
    return { pauseUntil: Number(p?.pauseUntil) || 0, pauseMs: Number(p?.pauseMs) || 0, hitAt: Number(p?.hitAt) || 0 };
}
function setFbPace(changes) {
    try { localStorage.setItem(FB_PACE_KEY, JSON.stringify({ ...getFbPace(), ...changes })); } catch {}
}
function fbPaused() { return Date.now() < getFbPace().pauseUntil; }

// Firestore's "quota used up" error, from the Firebase library or plain web requests
function isFbQuotaError(e) {
    const text = String((e && (e.code || "")) + " " + (e && e.message || e || ""));
    return /resource-exhausted|RESOURCE_EXHAUSTED|quota exceeded|HTTP 429/i.test(text);
}
// Call with any Firebase error. Returns true if it was the daily limit.
function noteFbError(e) {
    if (!isFbQuotaError(e)) return false;
    const pace = getFbPace();
    if (Date.now() < pace.pauseUntil) return true;          // another tab already paused
    // Wait longer each time it's still out: 15 min, 30, 1 h, then every 2 h
    const pauseMs = Math.min(FB_PAUSE_MAX_MS, pace.pauseMs ? pace.pauseMs * 2 : FB_PAUSE_MIN_MS);
    setFbPace({ pauseUntil: Date.now() + pauseMs, pauseMs, hitAt: Date.now() });
    if (typeof updateSiteStatus === "function") updateSiteStatus();
    return true;
}
// Call after a Firebase request works, so the next pause starts short again
function noteFbOk() {
    const pace = getFbPace();
    if (pace.pauseMs && Date.now() >= pace.pauseUntil) setFbPace({ pauseMs: 0 });
}

// How much to stretch background timers: 1x up to 100 people online, 4x at 400+
function fbCrowdFactor() {
    const online = window.gnActiveUsers?.count || 0;
    return Math.min(4, Math.max(1, online / 100));
}
function fbEvery(ms, maxFactor = 4) {
    return ms * Math.min(maxFactor, fbCrowdFactor());
}

// One line for the status light
function fbPaceSummary() {
    const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`; };
    const pace = getFbPace();
    if (Date.now() < pace.pauseUntil) {
        return { level: "degraded", detail: `The site reached Firebase's daily free limit. Accounts, ratings and the online count are paused and will try again in about ${mins(pace.pauseUntil - Date.now())}. Games still work, and progress is saved on this device.` };
    }
    const f = fbCrowdFactor();
    const ratings = `ratings refresh every ${mins(fbEvery(10 * 60000))}`;
    if (f <= 1.05) return { level: "ok", detail: `Normal pace: ${ratings}, online count every ${mins(fbEvery(3 * 60000))}.` };
    return { level: "info", detail: `Slowed down because lots of people are online, to stay under Firebase's daily limit: ${ratings}, online count every ${mins(fbEvery(3 * 60000))}.` };
}
