// ═════════════════════════════════════════════════════════════════════════════
// Firebase usage pacing. The free Firebase plan has a daily limit for the whole
// site (about 50,000 reads and 20,000 writes). When it runs out, accounts,
// ratings and the online count stop for everyone until it resets (midnight US
// Pacific time).
//
// Firebase doesn't tell the site how much is used, so every browser counts the
// reads and writes it makes today and sends that tally with its online-count
// heartbeat (presence.js). Adding those up gives an estimate for the whole
// site. Background work (ratings refresh, online count, autosave) then:
//   • runs at normal speed while there's plenty left
//   • slows down just enough for the rest to last until the reset
//   • stops near the very end, keeping the last bit for things people do
//     (rating, saving, signing in), which always go through
//   • pauses everything if Firebase says the limit was reached anyway
// Shared by all tabs in this browser through localStorage. Read by
// presence.js, library.js, accounts.js and the status light.
// ═════════════════════════════════════════════════════════════════════════════
// Free (Spark) plan daily limits. On the paid Blaze plan, raise these to the
// daily amount you're happy to pay for.
const FB_DAILY_LIMIT = { reads: 50000, writes: 20000 };
const FB_PACE_KEY = "gnmath-firebase-pace";
const FB_TALLY_KEY = "gnmath-firebase-tally";
const FB_USAGE_KEY = "gnmath-firebase-usage";
const FB_PAUSE_MIN_MS = 15 * 60 * 1000, FB_PAUSE_MAX_MS = 2 * 60 * 60 * 1000;
const FB_MAX_SLOWDOWN = 4;          // background work never gets slower than this
const FB_RESERVE = 0.97;            // above this share used, only user actions run

function fbReadJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null") || {}; } catch { return {}; } }
function fbWriteJson(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

// ── The Firebase day (it resets at midnight US Pacific time) ────────────────
function fbDayKey(at = Date.now()) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
    const get = t => p.find(x => x.type === t).value;
    return get("year") + get("month") + get("day");
}
function fbMsUntilReset() {
    const now = Date.now(), today = fbDayKey(now);
    // Step forward to the first minute that's already tomorrow in Pacific time
    let lo = now, hi = now + 26 * 3600000;
    while (hi - lo > 60000) { const mid = (lo + hi) / 2; if (fbDayKey(mid) === today) lo = mid; else hi = mid; }
    return hi - now;
}

// ── This browser's own count for today ──────────────────────────────────────
function getFbTally() {
    const t = fbReadJson(FB_TALLY_KEY), day = fbDayKey();
    return t.day === day ? { day, r: Number(t.r) || 0, w: Number(t.w) || 0 } : { day, r: 0, w: 0 };
}
function fbCount(reads = 0, writes = 0) {
    const t = getFbTally();
    t.r += Math.max(0, Math.round(reads));
    t.w += Math.max(0, Math.round(writes));
    fbWriteJson(FB_TALLY_KEY, t);
}

// ── Site-wide total (sum of everyone's tallies, from presence.js) ───────────
function getFbUsage() {
    const u = fbReadJson(FB_USAGE_KEY);
    if (u.day !== fbDayKey() || !u.at) return null;
    return { day: u.day, r: Number(u.r) || 0, w: Number(u.w) || 0, at: Number(u.at), rate: Number(u.rate) || 0 };
}
function setFbUsage(reads, writes) {
    const prev = getFbUsage(), now = Date.now();
    const used = Math.max(reads / FB_DAILY_LIMIT.reads, writes / FB_DAILY_LIMIT.writes);
    let rate = prev ? prev.rate : 0;   // share of the daily limit used per hour
    if (prev && now - prev.at >= 60000) {
        const prevUsed = Math.max(prev.r / FB_DAILY_LIMIT.reads, prev.w / FB_DAILY_LIMIT.writes);
        const sample = Math.max(0, used - prevUsed) / ((now - prev.at) / 3600000);
        rate = rate ? rate * 0.6 + sample * 0.4 : sample;   // smoothed
    }
    fbWriteJson(FB_USAGE_KEY, { day: fbDayKey(), r: reads, w: writes, at: now, rate });
    if (typeof updateSiteStatus === "function") updateSiteStatus();
}
function fbUsedShare() {
    const u = getFbUsage();
    return u ? Math.max(u.r / FB_DAILY_LIMIT.reads, u.w / FB_DAILY_LIMIT.writes) : null;
}

// ── Quota errors ────────────────────────────────────────────────────────────
function getFbPace() {
    const p = fbReadJson(FB_PACE_KEY);
    return { pauseUntil: Number(p.pauseUntil) || 0, pauseMs: Number(p.pauseMs) || 0, hitAt: Number(p.hitAt) || 0 };
}
function setFbPace(changes) { fbWriteJson(FB_PACE_KEY, { ...getFbPace(), ...changes }); }
// Firebase said the limit was reached: stop everything for a while
function fbPaused() { return Date.now() < getFbPace().pauseUntil; }
// Background work only: also stops when nearly everything is used
function fbBackgroundPaused() {
    const used = fbUsedShare();
    return fbPaused() || (used !== null && used >= FB_RESERVE);
}

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

// ── How much to stretch background timers ───────────────────────────────────
// With a recent site-wide total: slow down just enough that, at the current
// speed, what's used plus what's still to come fits in the daily limit (with a
// 10% margin). Under half used, never slower than normal.
// Without one (e.g. the database rules aren't updated yet): go by how many
// people are online, 1x up to 100 people and 4x at 400+.
function fbSlowdown() {
    const u = getFbUsage(), used = fbUsedShare();
    if (u && Date.now() - u.at < 30 * 60000) {
        if (used < 0.5) return 1;
        const left = Math.max(0.01, 0.9 - used);
        const needed = u.rate * (fbMsUntilReset() / 3600000);   // share the rest of the day would use at this speed
        const floor = used >= 0.85 ? 2 : used >= 0.7 ? 1.5 : 1;
        return Math.min(FB_MAX_SLOWDOWN, Math.max(floor, needed / left));
    }
    const online = window.gnActiveUsers?.count || 0;
    return Math.min(FB_MAX_SLOWDOWN, Math.max(1, online / 100));
}
function fbEvery(ms, maxFactor = FB_MAX_SLOWDOWN) {
    return ms * Math.min(maxFactor, fbSlowdown());
}

// One line for the status light
function fbPaceSummary() {
    const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`; };
    const n = x => Math.round(x).toLocaleString();
    const pace = getFbPace(), u = getFbUsage();
    const usage = u ? `About ${n(u.r)} of ${n(FB_DAILY_LIMIT.reads)} reads and ${n(u.w)} of ${n(FB_DAILY_LIMIT.writes)} writes used today (resets in ${mins(fbMsUntilReset())}). ` : "";
    if (Date.now() < pace.pauseUntil) {
        return { level: "degraded", detail: `${usage}The site reached Firebase's daily free limit. Accounts, ratings and the online count are paused and will try again in about ${mins(pace.pauseUntil - Date.now())}. Games still work, and progress is saved on this device.` };
    }
    if (fbBackgroundPaused()) {
        return { level: "degraded", detail: `${usage}Almost all used up, so background updates (ratings refresh, online count, autosave) are paused. Rating, saving and signing in still work.` };
    }
    const f = fbSlowdown();
    const timers = `ratings refresh every ${mins(fbEvery(10 * 60000))}, online count every ${mins(fbEvery(3 * 60000))}`;
    if (f <= 1.05) return { level: "ok", detail: `${usage}Normal pace: ${timers}.` };
    const why = u ? "so what's left lasts until the reset" : "because lots of people are online, to stay under Firebase's daily limit";
    return { level: "info", detail: `${usage}Slowed down ${why}: ${timers}.` };
}
