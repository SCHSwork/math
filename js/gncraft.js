// ═════════════════════════════════════════════════════════════════════════════
// GN Craft spotlight on the home page: tells people the GN 2.0 Minecraft server
// exists, shows whether it's up and who's on (from the GN 2.0 Server, which
// checks GN Craft every 30 seconds), and gets them in: Play in the browser
// (play/gncraft, signed in as their GN 2.0 username) or the addresses for
// Java and Bedrock. Sits at the top of the home tabs, so it steps aside while
// searching like they do. Can be hidden (comes back after 30 days).
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const GAME_ID = 300093;
    const HIDE_KEY = "gnmath-gncraft-spotlight-hidden";
    const JAVA = "mc.learnresearch.org";
    const BEDROCK = "dedication-confined.tun.ply.gg", BEDROCK_PORT = "19132";
    const home = document.getElementById("homeTabs");
    if (!home) return;
    try { if (Date.now() - Number(localStorage.getItem(HIDE_KEY) || 0) < 30 * 86400000) return; } catch {}

    const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const box = document.createElement("section");
    box.id = "gncraftSpot";
    box.setAttribute("aria-label", "GN Craft, the GN 2.0 Minecraft server");
    box.innerHTML = `
        <img class="gcs-cover" src="play/gncraft/cover.png" alt="" width="112" height="112">
        <div class="gcs-body">
            <div class="gcs-kicker"><span class="gcs-new">New</span> The GN 2.0 Minecraft server</div>
            <h2>GN Craft</h2>
            <p class="gcs-text">One survival world for everyone on GN 2.0. Play right here in your browser with your GN 2.0 account, or join from Minecraft Java or Bedrock.</p>
            <div class="gcs-status" aria-live="polite"><span class="gcs-dot"></span><span class="gcs-status-text">Checking the server…</span></div>
        </div>
        <div class="gcs-actions">
            <button type="button" class="settings-button gcs-play">Play in browser</button>
            <button type="button" class="gcs-more" aria-expanded="false">Join from Java or Bedrock</button>
            <button type="button" class="gcs-cmds-btn" aria-expanded="false">Commands and tips</button>
            <a class="gcs-map" href="https://map.learnresearch.org" target="_blank" rel="noopener">Live 3D map</a>
        </div>
        <div class="gcs-cmds" hidden>
            <div><b>Easiest:</b> type <code>/menu</code> (or right-click the menu compass you start with) for buttons instead of commands</div>
            <div><code>/sethome</code> then <code>/home</code> save a spot and teleport back to it (up to 3 homes)</div>
            <div><code>/tpa name</code> ask to teleport to a friend, who answers with <code>/tpaccept</code> or <code>/tpdeny</code></div>
            <div><code>/back</code> go back to where you died or last teleported</div>
            <div><code>/msg name text</code> private message, <code>/r text</code> to reply, <code>/list</code> to see who's on</div>
            <div><b>Protect your stuff:</b> <code>/claim</code> hands you a claim shovel: right-click two opposite corners of your land and it's protected (the shovel goes away when you're done). <code>/trust name</code> lets a friend build there.</div>
            <div class="gcs-note">Type <code>/help</code> in the game for the full list.</div>
        </div>
        <div class="gcs-addrs" hidden>
            <div><b>Java</b> <code>${JAVA}</code> <button type="button" data-copy="${JAVA}">Copy</button></div>
            <div><b>Bedrock</b> <code>${BEDROCK}</code> port <code>${BEDROCK_PORT}</code> <button type="button" data-copy="${BEDROCK}">Copy</button></div>
            <div class="gcs-note">Browser players use their GN 2.0 username. Java and Bedrock players use their own accounts, so each is a separate character in the same world.</div>
        </div>
        <button type="button" class="gcs-close" title="Hide" aria-label="Hide GN Craft">×</button>`;
    home.insertBefore(box, home.firstChild);

    const $ = sel => box.querySelector(sel);
    $(".gcs-play").onclick = () => {
        const z = (typeof zones !== "undefined" && Array.isArray(zones)) ? zones.find(g => Number(g.id) === GAME_ID) : null;
        if (z && typeof openZone === "function") openZone(z);
        else if (typeof notify === "function") notify("GN Craft is still loading. Try again in a second.");
    };
    // Two panels (addresses, commands): opening one closes the other
    const panels = [[".gcs-more", ".gcs-addrs"], [".gcs-cmds-btn", ".gcs-cmds"]];
    for (const [btn, panel] of panels) $(btn).onclick = () => {
        const open = $(panel).hidden;
        for (const [b, p] of panels) { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); }
        $(panel).hidden = !open;
        $(btn).setAttribute("aria-expanded", String(open));
    };
    box.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1500); }
        catch { if (typeof notify === "function") notify(b.dataset.copy); }
    });
    $(".gcs-close").onclick = () => {
        try { localStorage.setItem(HIDE_KEY, String(Date.now())); } catch {}
        box.remove();
    };

    // Is it up, and who's on?
    async function check() {
        if (!document.body.contains(box)) return;
        const dot = $(".gcs-dot"), text = $(".gcs-status-text");
        let d = null;
        try {
            if (typeof HOME_SERVER !== "undefined") {
                const r = await fetch(HOME_SERVER + "/api/minecraft", { cache: "no-store" });
                d = await r.json().catch(() => null);
            }
        } catch {}
        if (!d) { dot.className = "gcs-dot"; text.textContent = "Couldn't check the server right now"; return; }
        if (!d.online) { dot.className = "gcs-dot off"; text.textContent = "Resting right now. Check back soon"; return; }
        dot.className = "gcs-dot on";
        const n = Number(d.players) || 0, names = Array.isArray(d.names) ? d.names.slice(0, 3) : [];
        text.innerHTML = n === 0 ? "Online · nobody's on yet, be the first"
            : `Online · <b>${n}</b> playing${names.length ? ": " + names.map(esc).join(", ") + (n > names.length ? " and more" : "") : ""}`;
    }
    check();
    setInterval(() => { if (!document.hidden) check(); }, 60000);
})();
