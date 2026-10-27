// ═════════════════════════════════════════════════════════════════════════════
// Halloween week (Oct 24 – Nov 1, the visitor's own time). While it's on:
//   • the site wears the Halloween scene (moon, bats, graveyard) for everyone
//     who hasn't switched it off; picking any theme in Settings switches it off
//   • a 🎃 Spooky tab on the home page lists horror and Halloween games
//   • two limited-time badges (achievements.js): Trick or Treat (play on
//     Halloween) and Spooky Season (play 5 spooky games during the week)
// Nothing is saved to the visitor's theme; on Nov 2 everything goes back.
// ═════════════════════════════════════════════════════════════════════════════
const HALLOWEEN_OFF_KEY = "gnmath-halloween-off";
function halloweenActive(d = new Date()) {
    const y = d.getFullYear();
    return d >= new Date(y, 9, 24) && d < new Date(y, 10, 2);
}
function isHalloweenDay(d = new Date()) { return d.getMonth() === 9 && d.getDate() === 31; }
function halloweenOff() { try { return localStorage.getItem(HALLOWEEN_OFF_KEY) === String(new Date().getFullYear()); } catch { return false; } }
const SPOOKY_NAME = /hallowe?en|pumpkin|ghost|zombie|witch|haunt|spook|skelet|vampire|monster|grave|creep|scary|horror|fnaf|five nights|freddy|slender|granny|backrooms|poppy|baldi|bendy|undead|nightmare|scream|horror/i;
function isSpookyZone(z) {
    if (!z) return false;
    try { if (typeof zoneGenres === "function" && zoneGenres(z).has("horror")) return true; } catch {}
    return SPOOKY_NAME.test(String(z.name || ""));
}

(function () {
    if (!halloweenActive()) return;
    document.documentElement.classList.add("halloween-week");

    // ── Decorations ─────────────────────────────────────────────────────────
    const decorate = () => {
        if (halloweenOff() || typeof setTheme !== "function") return;
        setTheme("halloween", { persist: false });
    };
    // Settings call setTheme(…) with persist on: that's the visitor choosing, so
    // the decorations step aside for the rest of the year
    const wrapSetTheme = () => {
        const orig = window.setTheme;
        if (typeof orig !== "function" || orig.__hw) return;
        const w = function (name, opts) {
            const persist = !opts || opts.persist !== false;
            if (persist) { try { localStorage.setItem(HALLOWEEN_OFF_KEY, String(new Date().getFullYear())); } catch {} removeBanner(); }
            else if (!halloweenOff()) name = "halloween";
            return orig.call(this, name, opts);
        };
        w.__hw = true;
        window.setTheme = w;
    };
    function removeBanner() { const b = document.getElementById("hwBanner"); if (b) b.remove(); }
    function banner() {
        if (halloweenOff() || document.getElementById("hwBanner")) return;
        let seen = "";
        try { seen = localStorage.getItem("gnmath-halloween-banner") || ""; } catch {}
        const today = new Date().toDateString();
        if (seen === today && !isHalloweenDay()) return;      // once a day (always on Halloween)
        try { localStorage.setItem("gnmath-halloween-banner", today); } catch {}
        const b = document.createElement("div");
        b.id = "hwBanner";
        b.className = "hw-banner";
        b.setAttribute("role", "status");
        const days = Math.ceil((new Date(new Date().getFullYear(), 9, 31) - new Date(new Date().toDateString())) / 86400000);
        const text = isHalloweenDay() ? "Happy Halloween! Play any game today for the 🎃 Trick or Treat badge." :
            days > 0 ? `Halloween in ${days} day${days === 1 ? "" : "s"}! Check the 🎃 Spooky tab and earn the limited Halloween badges.` :
            "Halloween week is wrapping up. Last chance for the limited Halloween badges!";
        b.innerHTML = `<span class="hw-pumpkin" aria-hidden="true">🎃</span><span class="hw-text"></span><button type="button" class="hw-off">Turn off decorations</button><button type="button" class="hw-x" aria-label="Close">×</button>`;
        b.querySelector(".hw-text").textContent = text;
        b.querySelector(".hw-x").onclick = () => b.remove();
        b.querySelector(".hw-off").onclick = () => {
            try { localStorage.setItem(HALLOWEEN_OFF_KEY, String(new Date().getFullYear())); } catch {}
            b.remove();
            const saved = typeof getVisitorSetting === "function" ? getVisitorSetting("gnmath-theme", "theme") : "red";
            // Back to the visitor's own theme (without marking it as a new choice)
            if (typeof setTheme === "function") setTheme(saved, { persist: false });
        };
        const main = document.querySelector("main");
        if (main) main.prepend(b);
    }

    // ── Spooky tab ──────────────────────────────────────────────────────────
    function renderSpooky() {
        const tabs = document.getElementById("homeTabs");
        if (!tabs || !Array.isArray(zones) || !zones.length) return;
        let wrap = document.getElementById("spookyWrapper");
        if (!wrap) {
            wrap = document.createElement("details");
            wrap.id = "spookyWrapper";
            wrap.className = "home-section";
            wrap.open = true;
            wrap.innerHTML = `<summary class="section-title">Spooky games</summary><div id="spookyZones" class="shelf"></div>`;
            const first = tabs.querySelector(":scope > .home-section");
            tabs.insertBefore(wrap, first);
        }
        const week = (typeof popularityData !== "undefined" && popularityData.week) || {};
        const list = zones.filter(z => isSpookyZone(z) && !(typeof isZoneDisabled === "function" && isZoneDisabled(z.id))
            && !(typeof isPartnerZone === "function" && isPartnerZone(z)) && Number(z.id) >= 0)
            .sort((a, b) => (week[b.id] || 0) - (week[a.id] || 0)).slice(0, 40);
        const grid = document.getElementById("spookyZones");
        const key = list.map(z => z.id).join(",");
        if (grid.dataset.key !== key) {
            grid.dataset.key = key;
            if (typeof clearCards === "function") clearCards(grid); else grid.innerHTML = "";
            list.forEach(z => grid.appendChild(createZoneCard(z)));
            if (typeof observeLazyZoneImages === "function") observeLazyZoneImages("#spookyZones img.lazy-zone-img");
        }
        wrap.hidden = !list.length;
        if (typeof renderHomeTabs === "function") renderHomeTabs();
    }
    window.renderSpooky = renderSpooky;

    function start() {
        wrapSetTheme();
        decorate();
        banner();
        let tries = 0;
        const t = setInterval(() => {
            if ((Array.isArray(window.zones || (typeof zones !== "undefined" ? zones : null)) && zones.length) || ++tries > 60) { clearInterval(t); renderSpooky(); }
        }, 1000);
    }
    if (document.readyState === "complete") start(); else window.addEventListener("load", start);
})();
