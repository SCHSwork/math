// Bot check, after the page has loaded (the first part is at the top of index.html,
// which sends browsers that can't be real to the bot page before anything loads).
//
// - window.gnHuman: a promise that resolves on the first real tap, click, key,
//   wheel or mouse move. Visits are only counted after it (js/presence.js), so
//   bots that just load the page never show up in Sessions or the online count.
// - window.gnBotScore: { score, flags } of soft signs that something isn't a real
//   player. They don't block anyone; they're sent with the session so they show
//   in Admin Panel → Sessions, to see what's being flagged before blocking more.
// - Cloud networks: asks the GN 2.0 Server whether this visit comes from a cloud
//   server (AWS, Azure, Hetzner...). Unless someone has played from that network
//   before, the browser is marked as a bot for a day and gets the bot page.
// - "gn-real": set once a browser signs in or plays a game for a minute. A real
//   browser is never marked by the trap link or a cloud network.
(function () {
    const REAL_KEY = "gn-real", BOT_KEY = "gn-bot", NET_KEY = "gn-net";
    const isReal = () => { try { return !!localStorage.getItem(REAL_KEY); } catch { return false; } };
    const setReal = () => { try { if (!isReal()) localStorage.setItem(REAL_KEY, String(Date.now())); localStorage.removeItem(BOT_KEY); } catch {} };

    // ── First real input ────────────────────────────────────────────────────────
    window.gnHuman = new Promise(resolve => {
        const evs = ["pointerdown", "keydown", "touchstart", "wheel", "mousemove"];
        const done = e => {
            if (e && e.isTrusted === false) return;   // made up by a script, not a person
            evs.forEach(t => removeEventListener(t, done, true));
            resolve();
        };
        evs.forEach(t => addEventListener(t, done, { capture: true, passive: true }));
    });

    // ── Real browsers: signed in, or a game open for a minute ───────────────────
    let gameFor = 0;
    const realTimer = setInterval(() => {
        if (isReal()) { clearInterval(realTimer); return; }
        try { if (typeof cloudUser !== "undefined" && cloudUser) { setReal(); return; } } catch {}
        const v = document.getElementById("zoneViewer");
        gameFor = v && v.style.display === "flex" && !document.hidden ? gameFor + 5 : 0;
        if (gameFor >= 60) setReal();
    }, 5000);

    // ── Soft signs ──────────────────────────────────────────────────────────────
    const flags = [];
    let score = 0;
    const add = (f, n) => { if (!flags.includes(f)) { flags.push(f); score += n; } };
    window.gnBotScore = { score: 0, flags: "" };
    const publish = () => { window.gnBotScore = { score: Math.min(99, score), flags: flags.join(" ").slice(0, 60) }; };
    function softChecks() {
        const n = navigator, ua = n.userAgent || "";
        try {
            const c = document.createElement("canvas"), gl = c.getContext("webgl") || c.getContext("experimental-webgl");
            if (gl) {
                const x = gl.getExtension("WEBGL_debug_renderer_info");
                const r = String(gl.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
                // Software graphics: headless browsers and virtual machines (also a real
                // computer with graphics turned off, which is why this is only a sign)
                if (/SwiftShader|llvmpipe|softpipe|Microsoft Basic Render/i.test(r)) add("soft-gpu", 2);
                const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
            } else add("no-webgl", 1);
        } catch {}
        if (!outerWidth || !outerHeight) add("no-window", 2);
        if (!n.languages || !n.languages.length) add("no-lang", 2);
        // Desktop Chrome always lists its PDF viewer
        if (/Chrome\//.test(ua) && !/Mobile|Android/.test(ua) && n.plugins && n.plugins.length === 0) add("no-plugins", 1);
        if (/iPhone|iPad|Android.+Mobile/.test(ua) && !n.maxTouchPoints) add("no-touch", 2);
        let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
        if (!tz || tz === "UTC" || tz === "Etc/UTC") add("utc", 1);   // servers usually run on UTC
        let mark = null; try { mark = JSON.parse(localStorage.getItem(BOT_KEY) || "null"); } catch {}
        if (mark) add("was-marked", 2);
        publish();
    }
    // A person takes a moment; something that "moves the mouse" instantly is scripted
    window.gnHuman.then(() => { if (performance.now() < 150) add("instant-input", 1); publish(); });

    // ── Cloud networks ──────────────────────────────────────────────────────────
    async function netCheck() {
        if (typeof HOME_SERVER === "undefined") return;
        let v = null;
        try { v = JSON.parse(localStorage.getItem(NET_KEY) || "null"); } catch {}
        if (!v || Date.now() - v.at > 6 * 3600000) {
            try {
                const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 6000);
                const r = await fetch(HOME_SERVER + "/api/net", { signal: ctrl.signal }).finally(() => clearTimeout(timer));
                if (!r.ok) return;
                const j = await r.json();
                v = { at: Date.now(), dc: !!j.dc, trusted: !!j.trusted, org: String(j.org || "").slice(0, 40) };
                try { localStorage.setItem(NET_KEY, JSON.stringify(v)); } catch {}
            } catch { return; }   // server down: no verdict, nobody blocked
        }
        if (!v.dc) return;
        add("cloud", 3); publish();
        if (v.trusted || isReal()) return;
        try { localStorage.setItem(BOT_KEY, JSON.stringify({ why: "cloud network " + v.org, until: Date.now() + 86400000 })); } catch { return; }
        location.reload();   // the check at the top of index.html shows the bot page
    }

    setTimeout(() => { softChecks(); netCheck(); }, 1500);
})();
