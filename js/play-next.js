// ═════════════════════════════════════════════════════════════════════════════
// "Play next": after you close a game you played for a bit, a small panel at
// the bottom suggests six more: other games in the same series first (Vex 7
// after Vex 6), then games sharing its genres, most played first. Games you've
// already played, turned-off games and partner games are skipped. It goes away
// on its own after 25 seconds, when you open something, or with ×.
// "Don't suggest games" turns it off in this browser.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const OFF_KEY = "gnmath-playnext-off";
    const MIN_PLAY_MS = 30000;
    let opened = null;   // { zone, at }

    const off = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; } };
    const words = n => String(n || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    // "Vex 6" → "vex", "Five Nights at Freddy's 2" → "five nights at freddy s"
    const seriesKey = n => words(n).filter(w => !/^\d+$/.test(w) && !/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(w)).join(" ");

    function suggestions(z) {
        if (!Array.isArray(zones) || !zones.length) return [];
        const played = new Set([...(typeof getRecent === "function" ? getRecent() : []), ...Object.keys(typeof getPlaytimeMap === "function" ? getPlaytimeMap() : {})].map(String));
        played.add(String(z.id));
        const ok = x => x && !played.has(String(x.id)) && Number(x.id) >= 0
            && !(typeof isZoneDisabled === "function" && isZoneDisabled(x.id))
            && !(typeof isPartnerZone === "function" && isPartnerZone(x))
            && !(typeof isFlaggedBroken === "function" && isFlaggedBroken(getZoneStats(x.id)));
        const pop = (typeof popularityData !== "undefined" && (popularityData.week || popularityData.month)) || {};
        // Most played; ties (or no play counts yet) in a random order that changes daily
        const day = new Date().toDateString();
        const jitter = x => { let h = 2166136261; const k = day + x.id; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
        const score = x => (pop[x.id] || 0) + jitter(x);
        const out = [], seen = new Set();
        const add = x => { if (out.length < 6 && ok(x) && !seen.has(String(x.id))) { out.push(x); seen.add(String(x.id)); } };
        // Same series
        const key = seriesKey(z.name);
        if (key.length >= 3) {
            // The next one first (Vex 7 after Vex 6), then the closest; at most 3
            const num = n => { const m = String(n).match(/(\d+)(?!.*\d)/); return m ? Number(m[1]) : 1; };
            const me = num(z.name);
            zones.filter(x => seriesKey(x.name) === key && ok(x))
                .sort((a, b) => { const da = num(a.name) - me, db = num(b.name) - me; return (da > 0 ? da : 100 - da) - (db > 0 ? db : 100 - db); })
                .slice(0, 3).forEach(add);
        }
        // Shared genres (more shared first, then most played)
        const g = typeof zoneGenres === "function" ? zoneGenres(z) : new Set();
        if (g.size) {
            zones.map(x => ({ x, n: [...(typeof zoneGenres === "function" ? zoneGenres(x) : [])].filter(t => g.has(t)).length }))
                .filter(o => o.n > 0)
                .sort((a, b) => b.n - a.n || score(b.x) - score(a.x))
                .slice(0, 200).forEach(o => add(o.x));
        }
        // Still short: popular games
        zones.slice().sort((a, b) => score(b) - score(a)).slice(0, 100).forEach(add);
        return out;
    }

    function hide() {
        const el = document.getElementById("playNext");
        if (!el) return;
        el.classList.remove("show");
        setTimeout(() => el.remove(), 300);
    }
    function show(z) {
        const list = suggestions(z);
        if (list.length < 3) return;
        hide();
        const el = document.createElement("section");
        el.id = "playNext";
        el.className = "play-next";
        el.setAttribute("aria-label", "Games to play next");
        const head = document.createElement("div");
        head.className = "pn-head";
        const t = document.createElement("div");
        t.className = "pn-title";
        t.textContent = `Liked ${z.name}? Play next:`;
        const stop = document.createElement("button");
        stop.type = "button"; stop.className = "pn-stop"; stop.textContent = "Don't suggest games";
        stop.onclick = () => { try { localStorage.setItem(OFF_KEY, "1"); } catch {} hide(); };
        const x = document.createElement("button");
        x.type = "button"; x.className = "pn-x"; x.setAttribute("aria-label", "Close"); x.textContent = "×";
        x.onclick = hide;
        head.append(t, stop, x);
        const row = document.createElement("div");
        row.className = "shelf shelf-small pn-row";
        list.forEach(g => row.appendChild(createZoneCard(g)));
        el.append(head, row);
        document.body.appendChild(el);
        if (typeof observeLazyZoneImages === "function") observeLazyZoneImages("#playNext img.lazy-zone-img");
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
        clearTimeout(show.t);
        show.t = setTimeout(hide, 25000);
    }

    function hook() {
        const o = window.openZone, c = window.closeZone;
        if (typeof o === "function" && !o.__pn) {
            window.openZone = function (z) { hide(); opened = z ? { zone: z, at: Date.now() } : null; return o.apply(this, arguments); };
            window.openZone.__pn = true;
        }
        if (typeof c === "function" && !c.__pn) {
            window.closeZone = function () {
                const r = c.apply(this, arguments);
                const was = opened; opened = null;
                if (was && !off() && Date.now() - was.at >= MIN_PLAY_MS) setTimeout(() => show(was.zone), 400);
                return r;
            };
            window.closeZone.__pn = true;
        }
    }
    window.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
    if (document.readyState === "complete") hook(); else window.addEventListener("load", hook);
})();
