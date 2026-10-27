// ═════════════════════════════════════════════════════════════════════════════
// Levels and badges.
// XP comes from things you already do: trying games, play time, coming back on
// different days, favorites, ratings, the Game of the Day, plus a bonus for
// every badge. Most of it is worked out from data the site already keeps
// (play time, recently played, favorites); the few extra things it notes (days
// visited, games tried, night/early plays…) are in gnmath-achievements. All of
// it is in localStorage, so cloud saves carry it to every device.
// The level chip in the header opens the badge list; unlocking a badge or
// reaching a new level shows a short celebration.
// ═════════════════════════════════════════════════════════════════════════════
const ACH_KEY = "gnmath-achievements";

function achRead() {
    const a = readJson(ACH_KEY, null);
    return a && typeof a === "object" ? a : null;
}
function achWrite(a) { writeJson(ACH_KEY, a); }
function achBlank() {
    return { v: 1, days: [], tried: {}, gotd: [], night: 0, early: 0, weekendDays: [], random: 0, reported: {}, rated: {}, newPlays: 0, unlocked: {}, level: 0 };
}
function achDay(at = Date.now()) {
    const d = new Date(at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function achState() {
    return Object.assign(achBlank(), achRead() || {});
}

// ── Everything the badges and XP are worked out from ────────────────────────
function achStats() {
    const a = achState();
    const play = typeof getPlaytimeMap === "function" ? getPlaytimeMap() : {};
    const secs = Object.values(play).map(Number).filter(n => n > 0);
    const totalSec = secs.reduce((n, x) => n + x, 0);
    const tried = new Set(Object.keys(a.tried));
    (typeof getRecent === "function" ? getRecent() : []).forEach(id => tried.add(String(id)));
    Object.entries(play).forEach(([id, s]) => { if (Number(s) >= 60) tried.add(String(id)); });
    const triedZones = [...tried].map(id => (typeof zoneById === "function" && Array.isArray(zones) ? zoneById(id) : null)).filter(Boolean);
    const genres = new Set();
    let originals = 0, jam = 0, flash = 0;
    triedZones.forEach(z => {
        if (typeof zoneGenres === "function") zoneGenres(z).forEach(g => genres.add(g));
        const src = typeof zoneSource === "function" ? zoneSource(z) : "";
        if (src === "originals") originals++;
        if (src === "js13k") jam++;
    });
    // Days in a row, ending today or yesterday
    const days = [...new Set(a.days)].sort();
    let streak = 0, best = 0, run = 0, prev = null;
    for (const d of days) {
        const t = Date.parse(d + "T12:00:00");
        run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
        best = Math.max(best, run);
        prev = t;
    }
    if (days.length) {
        const last = Date.parse(days[days.length - 1] + "T12:00:00");
        const gap = Math.round((Date.parse(achDay() + "T12:00:00") - last) / 86400000);
        streak = gap <= 1 ? run : 0;
    }
    const perDay = {};
    Object.values(a.tried).forEach(d => { perDay[d] = (perDay[d] || 0) + 1; });
    return {
        tried: tried.size, totalSec, longest: secs.length ? Math.max(...secs) : 0,
        favorites: typeof getFavorites === "function" ? getFavorites().length : 0,
        ratings: Object.keys(a.rated || {}).length, reports: Object.keys(a.reported || {}).length, random: a.random, gotd: a.gotd.length,
        days: days.length, streak, bestStreak: best,
        night: a.night, early: a.early, weekendDays: a.weekendDays.length,
        genres: genres.size, originals, jam, newPlays: a.newPlays,
        bestDay: Math.max(0, ...Object.values(perDay)),
        halloween: (a.hw || []).length, spooky: Object.keys(a.spooky || {}).length
    };
}

// ── Badges ──────────────────────────────────────────────────────────────────
// [id, icon, name, what to do, stat, goal, xp]
const ACH_BADGES = [
    ["first", "🎮", "Press Start", "Play your first game", "tried", 1, 25],
    ["explorer1", "🧭", "Explorer", "Try 10 different games", "tried", 10, 50],
    ["explorer2", "🗺️", "Adventurer", "Try 50 different games", "tried", 50, 100],
    ["explorer3", "🌍", "Globetrotter", "Try 150 different games", "tried", 150, 250],
    ["explorer4", "🚀", "Completionist", "Try 400 different games", "tried", 400, 500],
    ["time1", "⏱️", "Warming Up", "Play for 1 hour in total", "totalSec", 3600, 50],
    ["time2", "🕹️", "Dedicated", "Play for 10 hours in total", "totalSec", 36000, 150],
    ["time3", "🏃", "Marathon", "Play for 50 hours in total", "totalSec", 180000, 400],
    ["devoted", "💜", "True Fan", "Play one game for 2 hours", "longest", 7200, 100],
    ["fav1", "⭐", "Collector", "Favorite 5 games", "favorites", 5, 25],
    ["fav2", "🌟", "Curator", "Favorite 25 games", "favorites", 25, 75],
    ["critic1", "👍", "Critic", "Rate 5 games", "ratings", 5, 50],
    ["critic2", "🎤", "Top Reviewer", "Rate 25 games", "ratings", 25, 150],
    ["bug", "🐛", "Bug Hunter", "Report a broken game", "reports", 1, 50],
    ["genres1", "🌈", "Genre Hopper", "Play games from 6 genres", "genres", 6, 75],
    ["genres2", "🎨", "Well Rounded", "Play games from 12 genres", "genres", 12, 200],
    ["streak1", "🔥", "On a Roll", "Visit 3 days in a row", "bestStreak", 3, 50],
    ["streak2", "⚡", "Regular", "Visit 7 days in a row", "bestStreak", 7, 150],
    ["streak3", "👑", "Unstoppable", "Visit 30 days in a row", "bestStreak", 30, 500],
    ["days", "📆", "Loyal", "Visit on 20 different days", "days", 20, 150],
    ["gotd1", "📅", "Daily Pick", "Play the Game of the Day", "gotd", 1, 25],
    ["gotd2", "🗓️", "Pick of the Week", "Play the Game of the Day 7 times", "gotd", 7, 100],
    ["fresh", "🆕", "Fresh Finds", "Play 5 games added in the last 2 weeks", "newPlays", 5, 75],
    ["binge", "🍿", "Binge", "Try 5 new games in one day", "bestDay", 5, 50],
    ["lucky", "🎲", "Feeling Lucky", "Use the random game button 10 times", "random", 10, 50],
    ["night", "🦉", "Night Owl", "Play a game after 10 PM", "night", 1, 25],
    ["early", "🌅", "Early Bird", "Play a game before 7 AM", "early", 1, 25],
    ["weekend", "🛋️", "Weekend Warrior", "Play on 4 weekend days", "weekendDays", 4, 50],
    ["originals", "🏠", "Homegrown", "Play 5 GN Originals", "originals", 5, 75],
    ["jam", "🧩", "Jam Session", "Play 10 js13k jam games", "jam", 10, 75],
    ["trickortreat", "🎃", "Trick or Treat", "Play a game on Halloween (Oct 31). Limited time!", "halloween", 1, 100],
    ["spookyseason", "👻", "Spooky Season", "Play 5 spooky games during Halloween week. Limited time!", "spooky", 5, 150]
].map(([id, icon, name, desc, stat, goal, xp]) => ({ id, icon, name, desc, stat, goal, xp }));

function achEarned(stats) { return ACH_BADGES.filter(b => (stats[b.stat] || 0) >= b.goal); }

// ── XP and levels ───────────────────────────────────────────────────────────
function achXp(stats, earned) {
    return Math.round(
        stats.tried * 10 +
        Math.floor(stats.totalSec / 60) +
        stats.days * 15 +
        Math.min(stats.favorites, 50) * 5 +
        stats.ratings * 5 +
        Math.min(stats.reports, 20) * 10 +
        stats.gotd * 25 +
        earned.reduce((n, b) => n + b.xp, 0)
    );
}
// Level n needs 100 + 60·(n-1) more XP than level n-1
function achLevelFor(xp) {
    let level = 1, need = 100, at = 0;
    while (xp >= at + need) { at += need; level++; need = 100 + 60 * (level - 1); }
    return { level, into: xp - at, need, next: at + need };
}
const ACH_TITLES = [[1, "Rookie"], [3, "Player"], [6, "Gamer"], [10, "Pro"], [15, "Elite"], [20, "Master"], [30, "Legend"], [45, "Mythic"], [60, "GN Immortal"]];
function achTitle(level) { let t = ACH_TITLES[0][1]; for (const [l, name] of ACH_TITLES) if (level >= l) t = name; return t; }
function achSummary() {
    const stats = achStats();
    const earned = achEarned(stats);
    const xp = achXp(stats, earned);
    return { stats, earned, xp, ...achLevelFor(xp) };
}

// ── Header chip ─────────────────────────────────────────────────────────────
function achRenderChip(sum = achSummary()) {
    let chip = document.getElementById("levelChip");
    if (!chip) {
        const host = document.querySelector(".control-buttons");
        if (!host) return;
        chip = document.createElement("button");
        chip.id = "levelChip";
        chip.type = "button";
        chip.className = "level-chip";
        chip.onclick = () => openAchievementsPanel();
        chip.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="lc-track" cx="18" cy="18" r="15.5"></circle><circle class="lc-ring" cx="18" cy="18" r="15.5"></circle></svg><span class="lc-num"></span>`;
        host.prepend(chip);
    }
    const pct = Math.max(0, Math.min(1, sum.into / sum.need));
    chip.querySelector(".lc-num").textContent = sum.level;
    chip.querySelector(".lc-ring").style.strokeDashoffset = String(97.4 * (1 - pct));
    chip.title = `Level ${sum.level} ${achTitle(sum.level)} · ${sum.into}/${sum.need} XP to level ${sum.level + 1} · ${sum.earned.length}/${ACH_BADGES.length} badges`;
    chip.setAttribute("aria-label", `Your level: ${sum.level}, ${achTitle(sum.level)}. ${sum.earned.length} badges. Open badges`);
}

// ── Celebrations ────────────────────────────────────────────────────────────
let achToastQueue = [], achToastBusy = false;
function achToast(kind, icon, title, text) {
    achToastQueue.push({ kind, icon, title, text });
    if (!achToastBusy) achNextToast();
}
function achNextToast() {
    const t = achToastQueue.shift();
    if (!t) { achToastBusy = false; return; }
    achToastBusy = true;
    const el = document.createElement("div");
    el.className = `ach-toast ach-k-${t.kind}`;
    el.setAttribute("role", "status");
    const icon = document.createElement("div"); icon.className = "ach-icon"; icon.textContent = t.icon;
    const body = document.createElement("div"); body.className = "ach-body";
    const h = document.createElement("div"); h.className = "ach-title"; h.textContent = t.title;
    const p = document.createElement("div"); p.className = "ach-text"; p.textContent = t.text;
    body.append(h, p);
    el.append(icon, body);
    // Confetti
    const burst = document.createElement("div"); burst.className = "ach-burst"; burst.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 14; i++) { const s = document.createElement("i"); s.style.setProperty("--a", `${i * (360 / 14)}deg`); s.style.setProperty("--d", `${40 + (i % 3) * 18}px`); burst.appendChild(s); }
    el.appendChild(burst);
    el.onclick = () => { el.classList.remove("show"); openAchievementsPanel(); };
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => { el.remove(); achNextToast(); }, 400); }, 4200);
}

// Compare with what was already celebrated, and celebrate anything new
function achCheck(silent) {
    const a = achState();
    const sum = achSummary();
    const fresh = sum.earned.filter(b => !a.unlocked[b.id]);
    const first = !a.init;
    a.init = 1;
    fresh.forEach(b => { a.unlocked[b.id] = Date.now(); });
    const leveled = sum.level > (a.level || 0);
    const oldLevel = a.level || 0;
    a.level = sum.level;
    achWrite(a);
    achRenderChip(sum);
    if (silent) return;
    if (first) {
        // First time on this device: one hello instead of a pile of badges
        if (sum.level > 1 || sum.earned.length) achToast("level", "🏆", `You're level ${sum.level}: ${achTitle(sum.level)}`, `${sum.earned.length} badge${sum.earned.length === 1 ? "" : "s"} from what you've played. Tap to see them all.`);
        return;
    }
    fresh.slice(0, 3).forEach(b => achToast("badge", b.icon, `Badge unlocked: ${b.name}`, `${b.desc} · +${b.xp} XP`));
    if (fresh.length > 3) achToast("badge", "🏅", `+${fresh.length - 3} more badges`, "Tap to see them all");
    if (leveled && oldLevel > 0) achToast("level", "⬆️", `Level ${sum.level}!`, sum.level >= 3 && achTitle(sum.level) !== achTitle(oldLevel) ? `You're now a ${achTitle(sum.level)}` : `${sum.need} XP to level ${sum.level + 1}`);
}

// ── Noting things as they happen ────────────────────────────────────────────
function achNote(fn) { const a = achState(); fn(a); achWrite(a); }
function achNoteVisit() {
    achNote(a => {
        const d = achDay();
        if (!a.days.includes(d)) a.days.push(d);
        if (a.days.length > 400) a.days = a.days.slice(-400);
    });
}
function achNoteGameOpen(z) {
    if (!z || z.id == null) return;
    const id = String(z.id), now = new Date(), d = achDay();
    achNote(a => {
        if (!a.tried[id]) {
            a.tried[id] = d;
            if (typeof isAddedWithinDays === "function" && isAddedWithinDays(z, 14)) a.newPlays++;
        }
        const h = now.getHours();
        if (h >= 22 || h < 4) a.night++;
        if (h >= 4 && h < 7) a.early++;
        const wd = now.getDay();
        if ((wd === 0 || wd === 6) && !a.weekendDays.includes(d)) a.weekendDays.push(d);
        try {
            const g = typeof gameOfTheDay === "function" ? gameOfTheDay() : null;
            if (g && String(g.id) === id && !a.gotd.includes(d)) a.gotd.push(d);
        } catch {}
        if (!a.days.includes(d)) a.days.push(d);
        // Halloween week (halloween.js)
        if (typeof halloweenActive === "function" && halloweenActive(now)) {
            if (isHalloweenDay(now)) { a.hw = a.hw || []; if (!a.hw.includes(String(now.getFullYear()))) a.hw.push(String(now.getFullYear())); }
            if (typeof isSpookyZone === "function" && isSpookyZone(z)) { a.spooky = a.spooky || {}; a.spooky[id] = d; }
        }
    });
    // Check again once they've played a bit (play-time badges)
    setTimeout(() => achCheck(), 1500);
}

function openAchievementsPanel() {
    const sum = achSummary();
    const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const a = achState();
    const fmt = (b, v) => b.stat === "totalSec" || b.stat === "longest" ? `${Math.floor(v / 3600)}h ${Math.floor((v % 3600) / 60)}m / ${Math.round(b.goal / 3600)}h` : `${Math.min(v, b.goal)} / ${b.goal}`;
    const badges = ACH_BADGES.map(b => {
        const v = sum.stats[b.stat] || 0, got = v >= b.goal;
        const pct = Math.min(100, Math.round(v / b.goal * 100));
        const when = got && a.unlocked[b.id] ? new Date(a.unlocked[b.id]).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
        return `<div class="ach-badge ${got ? "got" : ""}" title="${esc(b.desc)}">
            <div class="ab-icon">${b.icon}</div>
            <div class="ab-name">${esc(b.name)}</div>
            <div class="ab-desc">${esc(b.desc)}</div>
            ${got ? `<div class="ab-done">✓ ${when ? esc(when) : "Unlocked"} · +${b.xp} XP</div>` : `<div class="ab-bar"><span style="width:${pct}%"></span></div><div class="ab-prog">${esc(fmt(b, v))}</div>`}
        </div>`;
    }).join("");
    const s = sum.stats;
    const hours = s.totalSec >= 3600 ? `${Math.floor(s.totalSec / 3600)}h` : `${Math.floor(s.totalSec / 60)}m`;
    document.getElementById("popupTitle").textContent = "Level & badges";
    const body = document.getElementById("popupBody");
    body.innerHTML = `
        <div class="ach-head">
            <div class="ach-level"><span>${sum.level}</span></div>
            <div class="ach-head-main">
                <div class="ach-rank">${esc(achTitle(sum.level))}</div>
                <div class="ach-xpbar"><span style="width:${Math.round(sum.into / sum.need * 100)}%"></span></div>
                <div class="ach-xptext">${sum.into} / ${sum.need} XP to level ${sum.level + 1} · ${sum.xp.toLocaleString()} XP total</div>
            </div>
        </div>
        <div class="ach-stats">
            <div><b>${s.tried}</b><span>games tried</span></div>
            <div><b>${hours}</b><span>played</span></div>
            <div><b>${s.streak}</b><span>day streak</span></div>
            <div><b>${sum.earned.length}/${ACH_BADGES.length}</b><span>badges</span></div>
        </div>
        <p class="ach-how">Earn XP by trying new games, playing, coming back on different days, rating and favoriting games and playing the Game of the Day. ${typeof cloudUser !== "undefined" && cloudUser ? "Your level is saved with your cloud save." : "Sign in to keep your level on every device."}</p>
        <div class="ach-grid">${badges}</div>`;
    body.contentEditable = false;
    document.getElementById("popupOverlay").style.display = "flex";
}

// ── Hook into the rest of the site ──────────────────────────────────────────
(function () {
    const wrap = (name, after) => {
        const fn = window[name];
        if (typeof fn !== "function" || fn.__ach) return;
        const w = function () {
            const r = fn.apply(this, arguments);
            try { after.apply(this, arguments); } catch (e) {}
            return r;
        };
        w.__ach = true;
        window[name] = w;
    };
    function hook() {
        wrap("openZone", z => {
            if (z && !(typeof isZoneDisabled === "function" && isZoneDisabled(z.id))) achNoteGameOpen(z);
        });
        wrap("closeZone", () => setTimeout(() => achCheck(), 300));     // play time was just saved
        wrap("toggleFavorite", () => setTimeout(() => achCheck(), 0));
        wrap("openRandomZone", () => { achNote(a => { a.random++; }); });
        const cur = () => (typeof currentGameId !== "undefined" && currentGameId ? String(currentGameId) : "");
        wrap("rateCurrentZone", () => { const id = cur(); if (id) achNote(a => { a.rated = a.rated || {}; a.rated[id] = 1; }); setTimeout(() => achCheck(), 0); });
        wrap("reportCurrentZone", () => { const id = cur(); if (id) achNote(a => { a.reported = a.reported || {}; a.reported[id] = 1; }); setTimeout(() => achCheck(), 0); });
    }
    function start() {
        hook();
        achNoteVisit();
        // Wait for the game list (genres and sources need it)
        const ready = () => Array.isArray(window.zones || (typeof zones !== "undefined" ? zones : null)) && zones.length;
        let tries = 0;
        const t = setInterval(() => {
            if (ready() || ++tries > 60) { clearInterval(t); achCheck(); }
        }, 1000);
        achRenderChip();
        // While playing: play-time badges and levels (play time is saved every 30s)
        setInterval(() => {
            const v = document.getElementById("zoneViewer");
            if (v && v.style.display === "flex") achCheck();
        }, 60000);
    }
    if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
