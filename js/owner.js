// ════════════════════════════════════════════════════════════════════════════
// The Owner Panel (Settings → Owner Panel). Only downloaded when it's opened
// (js/lazy.js), so players never load it. Needs app.js.
// ════════════════════════════════════════════════════════════════════════════

function saveStatusOverrideFromPanel() {
    setStatusOverride({ level: document.getElementById("owner-status-level")?.value, text: document.getElementById("owner-status-text")?.value });
    notify("Status saved.", { type: "success" });
}

// Expected back: the quick "Back in" buttons set the box to now + that much
// (to the nearest 5 minutes from an hour up), and the line under the
// box reads the time back in words before it's saved.
function setSiteBackIn(mins) {
    let t = Date.now() + mins * 60000;
    t = mins >= 60 ? Math.round(t / 300000) * 300000 : Math.round(t / 60000) * 60000;
    const box = document.getElementById("owner-site-back-at");
    if (box) box.value = toLocalInputValue(new Date(t).toISOString());
    updateBackPreview();
}

function setSiteBackTomorrow() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0);
    const box = document.getElementById("owner-site-back-at");
    if (box) box.value = toLocalInputValue(d.toISOString());
    updateBackPreview();
}

function backPreviewText(iso) {
    if (!iso || isNaN(Date.parse(iso))) return "No time set.";
    const t = new Date(iso), mins = Math.round((t - Date.now()) / 60000);
    const sameDay = t.toDateString() === new Date().toDateString();
    const when = (sameDay ? "today " : t.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) + ", ") + t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (mins <= 0) return `That's ${when}, which has already passed.`;
    const h = Math.floor(mins / 60), m = mins % 60;
    const left = mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${h} h${m ? " " + m + " min" : ""}` : `${Math.round(mins / 1440)} days`;
    return `Back ${when} (in ${left}). Press Save to show it.`;
}

function updateBackPreview() {
    const box = document.getElementById("owner-site-back-at"), out = document.getElementById("owner-back-preview");
    if (!out) return;
    const v = box && box.value ? new Date(box.value).toISOString() : "";
    out.textContent = backPreviewText(v);
}

// The datetime-local box works in local time; store it as a real time
function toLocalInputValue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function saveSiteMessageFromPanel() {
    const text = (document.getElementById("owner-site-message")?.value || "").slice(0, 400);
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteMessage, text);
    const back = document.getElementById("owner-site-back-at")?.value || "";
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.siteBackAt, back && !isNaN(Date.parse(back)) ? new Date(back).toISOString() : "");
    applyOwnerSiteMode();
    githubAutoSync();
    notify("Saved. It shows on the lock, maintenance and shutdown screens.", { type: "success" });
}

// ── Off-PC save backup (GN 2.0 Server → Cloudflare R2) ──────────────────────
// The keys are written to Firestore serverSecrets/r2, which only the owner can
// write and nobody can read (the server reads it with its admin key).
async function ownerOffsiteStatus() {
    const el = document.getElementById("owner-offsite-status");
    if (!el) return;
    let o = null;
    try { const r = await fetch(HOME_SERVER + "/api/status", { cache: "no-store" }); if (r.ok) o = (await r.json()).offsite; } catch {}
    if (!document.getElementById("owner-offsite-status")) return;
    const when = t => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    el.style.color = "";
    if (!o) { el.textContent = "The GN 2.0 Server can't be reached right now, so its backup status is unknown."; return; }
    if (o.err) { el.style.color = "var(--danger, #ef4444)"; el.textContent = "Last try failed: " + o.err; return; }
    if (o.running) { el.textContent = "Uploading tonight's backup now…"; return; }
    if (o.lastOk) { el.style.color = "var(--success, #22c55e)"; el.textContent = `Working. Last copied ${when(o.lastOk)} (${Math.round(o.bytes / 1e6)} MB, ${o.kept || 1} kept in R2).`; return; }
    el.textContent = o.configured ? "Keys saved. The first copy goes up within 10 minutes." : "Not set up yet: backups only exist on your PC.";
}

// ── Minecraft hosting on the GN 2.0 server (owner only) ─────────────────────
async function ownerMinecraft() {
    const el = document.getElementById("owner-mc");
    if (!el) return;
    if (typeof cloudUser === "undefined" || !cloudUser) { el.textContent = "Sign in to see this."; return; }
    let d = null, err = "";
    try {
        const r = await fetch(HOME_SERVER + "/api/owner/minecraft", { headers: { Authorization: "Bearer " + await cloudUser.getIdToken() }, cache: "no-store" });
        if (r.ok) d = await r.json(); else err = r.status === 404 ? "The server hasn't updated yet. Try again in a few minutes." : "The server said " + r.status;
    } catch { err = "The GN 2.0 Server can't be reached right now."; }
    if (!document.getElementById("owner-mc")) return;
    if (!d) { el.textContent = err; return; }
    if (d.setup) {
        if (ownerMinecraft.wasRunning && !d.setup.running) notify("Minecraft setup finished", { type: "success" });
        ownerMinecraft.wasRunning = d.setup.running;
        clearTimeout(ownerMinecraft.timer);
        if (d.setup.running) ownerMinecraft.timer = setTimeout(ownerMinecraft, 20000);
    }
    const s = d.status || {}, a = s.amp;
    const row = (label, html) => `<div style="display:flex;gap:0.5rem;align-items:center;margin:0.25rem 0;flex-wrap:wrap;"><b style="min-width:7rem;">${label}</b><span>${html}</span></div>`;
    const copy = v => `<code style="user-select:all;">${escapeHtml(v)}</code> <button class="settings-button" type="button" style="min-width:0;padding:0.2rem 0.6rem;font-size:12px;" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent).then(()=>notify('Copied',{type:'success'}))">Copy</button>`;
    el.innerHTML =
        row("Setup", (() => {
            const u = d.setup;
            if (!u) return !s.step ? "Not started yet (starts within about 10 minutes of an update)" : s.step === "done" ? "Finished" : "Running…";
            const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : new Date(ms).toLocaleString(); };
            const head = u.running ? `<span style="color:var(--warning,#f59e0b)">Running now</span> (started ${ago(u.startedAt)}) · this updates by itself`
                : `<span style="color:var(--success,#22c55e)">Done</span> · finished ${ago(u.finishedAt)}`;
            return head + (u.notes && u.notes.length ? `<ul style="margin:0.25rem 0 0 1rem;padding:0;font-size:12px;">${u.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : "");
        })()) +
        row("AMP panel", d.ampUp ? `<span style="color:var(--success,#22c55e)">Running</span> · <a href="https://amp.learnresearch.org" target="_blank" rel="noopener">amp.learnresearch.org</a>` : "Not running yet") +
        (a ? row("AMP login", copy(a.user) + " " + copy(a.pass)) : "") +
        (d.geyser && (d.geyser.appliedAt || d.geyser.error) ? row("Bedrock setup", d.geyser.error ? `<span style="color:var(--danger,#ef4444)">${escapeHtml(d.geyser.error)}</span>` : `<span style="color:var(--success,#22c55e)">Geyser set up</span> · restart GN Craft in AMP if you haven't since`) : "") +
        row("playit", d.playit === "active" ? `<span style="color:var(--success,#22c55e)">Running</span>` : escapeHtml(d.playit || "not installed")) +
        (s.playitClaim ? row("playit link", `<a href="${escapeHtml(s.playitClaim)}" target="_blank" rel="noopener">Claim this server on playit.gg</a>`) : "") +
        `<details style="margin-top:0.5rem;"><summary>Setup log</summary><pre style="white-space:pre-wrap;font-size:11px;max-height:16rem;overflow:auto;">${escapeHtml((d.log || []).join("\n"))}</pre></details>`;
}

async function ownerSavePlayitNxs() {
    const el = document.getElementById("owner-playit-nxs"), cfg = (el && el.value || "").trim();
    if (!/^\s*bedrock\s*:/m.test(cfg) || !/nxs\s*:/.test(cfg)) return notify("Paste the whole block from playit's Configuration help (it starts with bedrock:).", { type: "error" });
    if (/•/.test(cfg)) return notify("The token is hidden in what you pasted. Use playit's Copy button (or Show token first).", { type: "error" });
    if (typeof cloudDb === "undefined" || !cloudDb || !cloudUser) return notify("Sign in to your account first.", { type: "error" });
    try {
        await cloudDb.collection("serverSecrets").doc("playit-nxs").set({ config: cfg.slice(0, 6000), at: firebase.firestore.FieldValue.serverTimestamp() });
        el.value = "";
        notify("Sent. The server sets up Geyser within a minute; then restart GN Craft in AMP.", { type: "success" });
        setTimeout(ownerMinecraft, 8000);
    } catch (e) { notify("Couldn't send it: " + (e.message || e), { type: "error" }); }
}

// ── GN 2.0 Server maintenance (Firestore siteStatus/maintenance) ────────────
async function ownerMaintStatus() {
    const el = document.getElementById("owner-maint-status");
    if (!el || typeof cloudDb === "undefined" || !cloudDb) { if (el) el.textContent = "Sign in to see or set maintenance."; return; }
    try {
        const d = await cloudDb.collection("siteStatus").doc("maintenance").get();
        if (!document.getElementById("owner-maint-status")) return;
        const m = d.exists ? d.data() : null, now = Date.now();
        const start = m && m.start ? m.start.toMillis() : 0, until = m && m.until ? m.until.toMillis() : 0;
        const t = ms => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        el.style.color = "";
        if (!m || until < now) el.textContent = "No maintenance planned.";
        else if (start > now) el.textContent = `Scheduled: ${t(start)} until ${t(until)}.`;
        else { el.style.color = "var(--warning, #f59e0b)"; el.textContent = `On now, until ${t(until)} (${Math.max(1, Math.ceil((until - now) / 60000))} min left).`; }
    } catch (e) { el.textContent = "Couldn't check: " + (e.message || e); }
}

async function ownerSetMaint() {
    if (typeof cloudDb === "undefined" || !cloudDb || !cloudUser) return notify("Sign in to your account first.", { type: "error" });
    const mins = Math.round(Number(document.getElementById("owner-maint-mins").value));
    if (!(mins >= 1 && mins <= 1440)) return notify("Pick between 1 and 1,440 minutes.", { type: "error" });
    let start = Date.now();
    if (document.getElementById("owner-maint-when").value === "later") {
        start = new Date(document.getElementById("owner-maint-at").value).getTime();
        if (!isFinite(start)) return notify("Pick when the maintenance starts.", { type: "error" });
        if (start < Date.now()) start = Date.now();
    }
    const TS = firebase.firestore.Timestamp;
    try {
        await cloudDb.collection("siteStatus").doc("maintenance").set({
            start: TS.fromMillis(start), until: TS.fromMillis(start + mins * 60000),
            note: (document.getElementById("owner-maint-note").value || "").trim().slice(0, 200),
            at: firebase.firestore.FieldValue.serverTimestamp()
        });
        notify(start <= Date.now() + 60000 ? `Maintenance is on for ${mins} min. The status pages show it within a minute.` : "Maintenance scheduled.", { type: "success" });
        ownerMaintStatus();
    } catch (e) { notify("Couldn't set maintenance: " + (e.message || e), { type: "error" }); }
}

async function ownerEndMaint() {
    if (typeof cloudDb === "undefined" || !cloudDb || !cloudUser) return notify("Sign in to your account first.", { type: "error" });
    try {
        await cloudDb.collection("siteStatus").doc("maintenance").delete();
        notify("Maintenance ended.", { type: "success" });
        ownerMaintStatus();
    } catch (e) { notify("Couldn't end maintenance: " + (e.message || e), { type: "error" }); }
}

async function ownerSaveOffsite() {
    const v = id => (document.getElementById(id)?.value || "").trim();
    const data = { accountId: v("owner-r2-account").toLowerCase(), bucket: v("owner-r2-bucket").toLowerCase(), accessKeyId: v("owner-r2-key"), secretAccessKey: v("owner-r2-secret") };
    if (!/^[0-9a-f]{32}$/.test(data.accountId)) return notify("The Account ID should be 32 letters and numbers (it's on the R2 page).", { type: "error" });
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(data.bucket)) return notify("That bucket name doesn't look right.", { type: "error" });
    if (!data.accessKeyId || !data.secretAccessKey) return notify("Paste both the Access Key ID and the Secret Access Key.", { type: "error" });
    if (typeof cloudDb === "undefined" || !cloudDb || !cloudUser) return notify("Sign in to your account first.", { type: "error" });
    try {
        await cloudDb.collection("serverSecrets").doc("r2").set({ ...data, at: firebase.firestore.FieldValue.serverTimestamp() });
        for (const id of ["owner-r2-key", "owner-r2-secret"]) document.getElementById(id).value = "";
        notify("Saved. The server copies the first backup off your PC within 10 minutes.", { type: "success" });
        const el = document.getElementById("owner-offsite-status");
        if (el) { el.style.color = ""; el.textContent = "Keys saved. The first copy goes up within 10 minutes."; }
    } catch (e) {
        notify("Couldn't save the keys: " + (e.message || e), { type: "error" });
    }
}

function renderOwnerPanel() {
    document.getElementById('popupTitle').textContent = "Owner Panel";
    const popupBody = document.getElementById('popupBody');
    const mode         = getOwnerSiteMode();
    const reportsFile  = buildBrokenReportsFile();
    const announcement = getAnnouncement();
    const motd         = getMotd();
    const disabledCount = getDisabledZoneIds().size;
    const storedPat    = getGithubPat();
    const maskedPat    = storedPat ? storedPat.slice(0, 10) + "•".repeat(12) + storedPat.slice(-4) : "";
    const footerLinks  = getFooterLinks() || [];
    const visitorDefaults = getOwnerVisitorDefaults();
    const footerLinksJson = JSON.stringify(footerLinks, null, 2).replace(/"/g, '&quot;');

    popupBody.innerHTML = `
    <div class="settings-section">
        <h4>GitHub Sync</h4>
        <p style="margin:0 0 0.75rem;color:var(--text-muted);font-size:13px;">
            Settings load from GitHub on every page load for all visitors.
            Only the owner can push changes using their token.
        </p>
        <p style="margin:0 0 0.75rem;font-size:13px;">Unlocked with your GitHub token (<code>${maskedPat}</code>).
            <a href="#" onclick="ownerForgetToken(); return false;">Remove token from this browser</a></p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button id="owner-sync-btn" class="settings-button" type="button" style="flex:1;" onclick="ownerSyncSave()">Save &amp; Sync to GitHub</button>
            <button class="settings-button" type="button" style="flex:1;" onclick="ownerSyncPullManual()">Pull from GitHub</button>
        </div>
        <p id="owner-sync-status" style="margin:0.5rem 0 0;font-size:12px;color:var(--text-muted);min-height:1.2em;"></p>
    </div>

    <div class="settings-section">
        <h4>Website Status</h4>
        <label style="display:block;margin-bottom:0.4rem;">Site mode</label>
        <select id="owner-site-mode" class="settings-select" onchange="setOwnerSiteMode(this.value)">
            <option value="open"     ${mode === "open"     ? "selected" : ""}>Open — everyone can access</option>
            <option value="locked"   ${mode === "locked"   ? "selected" : ""}>Locked — show lock screen</option>
            <option value="maintenance" ${mode === "maintenance" ? "selected" : ""}>Maintenance — show maintenance screen</option>
            <option value="shutdown" ${mode === "shutdown" ? "selected" : ""}>Shut down — show shutdown screen</option>
        </select>
        <p id="owner-mode-sync" class="owner-mode-sync"></p>
        <label style="display:block;margin:0.85rem 0 0.4rem;">Message on the lock / maintenance / shutdown screen (optional)</label>
        <textarea id="owner-site-message" rows="2" maxlength="400" placeholder="e.g. Back after lunch, or: Moving to a new address, details on Discord"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;resize:vertical;margin-bottom:0.5rem;font-family:inherit;">${escapeOwnerHtml(getOwnerSiteMessage())}</textarea>
        <label style="display:block;margin:0.35rem 0 0.4rem;">Expected back (optional, shown on lock and maintenance screens)</label>
        <div class="back-quick" role="group" aria-label="Back in">
            <span>Back in</span>
            ${[[5, "5 min"], [10, "10 min"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 h"], [90, "1½ h"], [120, "2 h"], [180, "3 h"], [240, "4 h"], [360, "6 h"], [1440, "1 day"]]
                .map(([m, l]) => `<button type="button" class="back-chip" onclick="setSiteBackIn(${m})">${l}</button>`).join("")}
            <button type="button" class="back-chip" onclick="setSiteBackTomorrow()" title="Tomorrow at 8:00 AM">Tomorrow 8 AM</button>
        </div>
        <div class="owner-inline" style="display:flex;gap:0.5rem;margin-bottom:0.35rem;">
            <input type="datetime-local" id="owner-site-back-at" value="${toLocalInputValue(getSiteBackAt())}" oninput="updateBackPreview()"
                style="flex:1;min-width:0;padding:0.55rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;font-family:inherit;color-scheme:dark light;">
            <button class="settings-button" type="button" style="width:auto;padding:0 0.9rem;" onclick="document.getElementById('owner-site-back-at').value='';updateBackPreview()">Clear</button>
        </div>
        <p id="owner-back-preview" class="back-preview">${escapeOwnerHtml(backPreviewText(getSiteBackAt()))}</p>
        <button class="settings-button" type="button" onclick="saveSiteMessageFromPanel()">Save Message &amp; Time</button>
        <p style="margin:0.5rem 0 0;font-size:12px;color:var(--text-muted);">Visitors' screens check every minute and open by themselves when you switch back to Open (GitHub can take a few minutes to pass the change on).</p>
        <h4 style="margin:1.25rem 0 0.35rem;">Who can still get in</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">These accounts, and anyone with the password, get past the lock, maintenance and shutdown screens. Everyone else still sees the screen.</p>
        <div id="owner-access-list" class="owner-panel-list"></div>
        <form id="owner-access-add" class="owner-inline" style="display:flex;gap:0.5rem;margin:0.5rem 0;" onsubmit="ownerAddAccessAccount(event)">
            <input type="text" id="owner-access-username" placeholder="Username to let in" autocomplete="off" spellcheck="false"
                style="flex:1;min-width:0;padding:0.55rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;font-family:inherit;">
            <button class="settings-button" type="submit" style="width:auto;padding:0 1rem;">Add</button>
        </form>
        <label style="display:block;margin:0.75rem 0 0.4rem;">Password to get in <span id="owner-access-pass-state" style="font-weight:400;font-size:13px;color:var(--text-muted);"></span></label>
        <form class="owner-inline" style="display:flex;gap:0.5rem;" onsubmit="ownerSetAccessPassword(event)">
            <span class="pw-wrap" style="flex:1;min-width:0;"><input type="text" id="owner-access-pass" placeholder="New password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
                style="width:100%;padding:0.55rem 2.4rem 0.55rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;font-family:inherit;">${gnPwToggle(true)}</span>
            <button class="settings-button" type="submit" style="width:auto;padding:0 1rem;">Set</button>
            <button class="settings-button" type="button" id="owner-access-pass-clear" style="width:auto;padding:0 1rem;" onclick="ownerClearAccessPassword()">Remove</button>
        </form>
        <p style="margin:0.5rem 0 0;font-size:12px;color:var(--text-muted);">Changing or removing the password signs out everyone who used the old one. Use one that's hard to guess: it's checked in the visitor's browser, like the rest of the lock.</p>
    </div>

    <div class="settings-section">
        <h4>Status Indicator</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">The little status light in the bottom-left corner checks the site by itself. Set a status here to tell everyone something it can't detect.</p>
        <label style="display:block;margin-bottom:0.4rem;">Status</label>
        <select id="owner-status-level" class="settings-select">
            ${[["auto","Automatic (checks the site by itself)"],["ok","All good"],["degraded","Some problems"],["down","Major outage"],["maintenance","Maintenance"]].map(([v,l]) => `<option value="${v}" ${getStatusOverride().level === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <input type="text" id="owner-status-text" maxlength="80" placeholder="Short text, e.g. Some games are slow today"
            value="${escapeOwnerHtml(getStatusOverride().text)}"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin:0.5rem 0;">
        <button class="settings-button" type="button" onclick="saveStatusOverrideFromPanel()">Apply Status</button>
    </div>

    <div class="settings-section">
        <h4>New Visitor Defaults</h4>
        <p style="margin:0 0 0.75rem;font-size:13px;color:var(--text-muted);">Applied only when a visitor has not chosen their own setting. Existing preferences are never overwritten.</p>
        <label style="display:block;margin-bottom:0.35rem;">Color mode</label>
        <select id="owner-default-mode" class="settings-select"><option value="dark" ${visitorDefaults.mode === "dark" ? "selected" : ""}>Dark</option><option value="light" ${visitorDefaults.mode === "light" ? "selected" : ""}>Light</option></select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Theme</label>
        <select id="owner-default-theme" class="settings-select">${AVAILABLE_THEMES.filter(t => t !== "custom").map(theme => `<option value="${theme}" ${visitorDefaults.theme === theme ? "selected" : ""}>${themeLabel(theme)}${SCENE_THEMES[theme] ? " (scene)" : ""}</option>`).join("")}</select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Font size</label>
        <select id="owner-default-font-size" class="settings-select">${["small", "medium", "large"].map(size => `<option value="${size}" ${visitorDefaults.fontSize === size ? "selected" : ""}>${size[0].toUpperCase() + size.slice(1)}</option>`).join("")}</select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Card size</label>
        <select id="owner-default-card-size" class="settings-select">${["small", "medium", "large", "list"].map(size => `<option value="${size}" ${visitorDefaults.cardSize === size ? "selected" : ""}>${size[0].toUpperCase() + size.slice(1)}</option>`).join("")}</select>
        <br><br><label style="display:block;margin-bottom:0.35rem;">Default sort</label>
        <select id="owner-default-sort" class="settings-select">${[["name","Name"],["id","Date added"],["popular","Most popular"],["trendingDay","Trending today"],["trendingWeek","Trending this week"],["trendingMonth","Trending this month"]].map(([value,label]) => `<option value="${value}" ${visitorDefaults.defaultSort === value ? "selected" : ""}>${label}</option>`).join("")}</select>
        <br><br><div class="settings-inline"><label>Compact header</label><input id="owner-default-compact" type="checkbox" ${visitorDefaults.compactMode ? "checked" : ""}></div>
        <div class="settings-inline"><label>Hide Featured section</label><input id="owner-default-hide-featured" type="checkbox" ${visitorDefaults.hideFeatured ? "checked" : ""}></div>
        <div class="settings-inline"><label>Autofocus search</label><input id="owner-default-autofocus" type="checkbox" ${visitorDefaults.autofocusSearch ? "checked" : ""}></div>
        <div class="settings-inline"><label>Show play count</label><input id="owner-default-play-count" type="checkbox" ${visitorDefaults.showPlayCount ? "checked" : ""}></div>
        <div class="settings-inline"><label>Warn before leaving</label><input id="owner-default-warn" type="checkbox" ${visitorDefaults.warnBeforeUnload ? "checked" : ""}></div>
        <div class="settings-inline"><label>Reduce motion</label><input id="owner-default-reduced-motion" type="checkbox" ${visitorDefaults.reducedMotion ? "checked" : ""}></div>
        <button class="settings-button" type="button" style="margin-top:0.75rem;" onclick="saveOwnerVisitorDefaults()">Save New Visitor Defaults</button>
    </div>

    <div class="settings-section">
        <h4>Announcement Banner</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Shown as a bar below the header for all visitors. Visitors can close it; a new or changed message shows again.</p>
        <div class="settings-inline" style="margin-bottom:0.5rem;">
            <label>Show banner</label>
            <input id="owner-announcement-enabled" type="checkbox" ${announcement.enabled ? "checked" : ""} onchange="saveAnnouncementFromPanel()">
        </div>
        <label style="display:block;margin-bottom:0.4rem;">Style</label>
        <select id="owner-announcement-type" class="settings-select" style="margin-bottom:0.5rem;">
            ${[["info","Announcement (theme color)"],["success","Good news (green)"],["warning","Heads up (yellow)"],["urgent","Important (red)"]].map(([v,l]) => `<option value="${v}" ${announcement.type === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <input type="text" id="owner-announcement-text" placeholder="Announcement message… (links become clickable)"
            value="${announcement.text.replace(/"/g, '&quot;')}"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;">
        <button class="settings-button" type="button" onclick="saveAnnouncementFromPanel()">Apply Banner</button>
    </div>

    <div class="settings-section">
        <h4>Message of the Day (MOTD)</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Shown once per day as a popup when a visitor opens the site.</p>
        <div class="settings-inline" style="margin-bottom:0.5rem;">
            <label>Enable MOTD</label>
            <input id="owner-motd-enabled" type="checkbox" ${motd.enabled ? "checked" : ""} onchange="saveMotdFromPanel()">
        </div>
        <textarea id="owner-motd-text" rows="3" placeholder="Today's message…"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;resize:vertical;margin-bottom:0.5rem;font-family:inherit;">${motd.text.replace(/</g,'&lt;')}</textarea>
        <button class="settings-button" type="button" onclick="saveMotdFromPanel()">Apply MOTD</button>
        <button class="settings-button" type="button" style="margin-top:0.4rem;" onclick="resetMotdLastSeen()">Reset "seen" (re-show today)</button>
    </div>

    <div class="settings-section">
        <h4>Custom Footer Links</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Add extra links to the footer. One per line as <code>Label | https://url</code></p>
        <textarea id="owner-footer-links-text" rows="4" placeholder="My Site | https://example.com"
            style="width:100%;padding:0.625rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:13px;resize:vertical;margin-bottom:0.5rem;font-family:monospace;">${footerLinks.map(l => l.label + ' | ' + l.url).join('\n')}</textarea>
        <button class="settings-button" type="button" onclick="saveFooterLinksFromPanel()">Apply Footer Links</button>
        <button class="settings-button" type="button" style="margin-top:0.4rem;" onclick="clearFooterLinks()">Clear All</button>
    </div>

    <div class="settings-section">
        <h4>Game Submissions</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Games players sent in with "Submit a game". To add an approved one, put it in SCHSwork/GN-originals (see its README), then mark it added.</p>
        <div id="owner-submissions" class="owner-panel-list"></div>
        <button class="settings-button" type="button" style="margin-top:0.5rem;" onclick="renderOwnerSubmissions()">Refresh</button>
    </div>

    <div class="settings-section">
        <h4>Trusted Reporters</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">One broken report from a trusted account flags the game for everyone right away, instead of waiting for ${BROKEN_FLAG_THRESHOLD} reports. To make <i>other</i> accounts trusted reporters or game admins, use the <a href="#" onclick="openAdminPanel(); return false;">Admin Panel</a>.</p>
        <div id="owner-trusted-list" class="owner-panel-list"></div>
        <div id="owner-trusted-add" style="margin-top:0.5rem;"></div>
    </div>

    <div class="settings-section">
        <h4>Broken Reports</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Games people reported as broken, most reported first. Reports older than ${BROKEN_REPORT_DAYS} days don't count toward the card warning. Disabling hides a game for everyone.</p>
        <div id="owner-reports-list" class="owner-panel-list"><p style="margin:0.25rem;color:var(--text-muted);">Loading reports…</p></div>
        <button class="settings-button" type="button" style="margin-top:0.5rem;" onclick="renderOwnerReports(true)">Refresh</button>
    </div>

    <div class="settings-section">
        <h4>Disable Games <span style="font-weight:400;font-size:13px;color:var(--text-muted);">(${disabledCount} disabled)</span></h4>
        <p style="margin:0 0 0.5rem;font-size:13px;">Checked games are hidden from all visitors.</p>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="exportDisabledZones()">Export</button>
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="document.getElementById('owner-import-disabled').click()">Import</button>
            <input type="file" id="owner-import-disabled" accept=".json" style="display:none;" onchange="importDisabledZones(event)">
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="enableAllZones()">Enable All</button>
        </div>
        <div id="owner-game-list" class="owner-panel-list"></div>
    </div>

    <div class="settings-section">
        <h4>Minecraft Server</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">AMP, Java and playit are installed on the GN 2.0 server by its auto-updater. Only your account can see this.</p>
        <div id="owner-mc" style="font-size:13px;">Checking…</div>
        <button class="settings-button" type="button" style="margin-top:0.5rem;" onclick="ownerMinecraft()">Refresh</button>
        <p style="margin:1rem 0 0.35rem;font-size:13px;"><b>Bedrock (NetherNet) setup:</b> on playit.gg open the Bedrock tunnel → Configuration help → Geyser → <b>Copy</b>, then paste it here. It has a private token: it goes straight to the server and nobody can read it back.</p>
        <textarea id="owner-playit-nxs" rows="6" placeholder="bedrock:&#10;  address: 0.0.0.0&#10;  …" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:12px;font-family:monospace;"></textarea>
        <button class="settings-button" type="button" style="margin-top:0.5rem;" onclick="ownerSavePlayitNxs()">Send to the server</button>
    </div>

    <div class="settings-section">
        <h4>GN 2.0 Server Maintenance</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">Planning to restart or work on the server? While maintenance is on, the status pages show it in amber as "Down for maintenance, back in about X min" instead of down, and it doesn't count as an outage.</p>
        <p id="owner-maint-status" style="margin:0 0 0.75rem;font-size:13px;">Checking…</p>
        <label style="font-size:13px;display:block;margin-bottom:0.25rem;">Starts</label>
        <select id="owner-maint-when" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;" onchange="document.getElementById('owner-maint-at').style.display = this.value === 'later' ? '' : 'none'">
            <option value="now">Now</option><option value="later">Later…</option>
        </select>
        <input id="owner-maint-at" type="datetime-local" style="display:none;width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <label style="font-size:13px;display:block;margin-bottom:0.25rem;">How long (minutes)</label>
        <input id="owner-maint-mins" type="number" min="1" max="1440" value="15" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <input id="owner-maint-note" maxlength="200" placeholder="Note for players (optional), e.g. Restarting for an update" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="settings-button" type="button" style="min-width:0;flex:1;" onclick="ownerSetMaint()">Start / schedule</button>
            <button class="settings-button" type="button" style="min-width:0;flex:1;background:var(--surface-hover);" onclick="ownerEndMaint()">End maintenance</button>
        </div>
    </div>

    <div class="settings-section">
        <h4>Off-PC Save Backup</h4>
        <p style="margin:0 0 0.5rem;font-size:13px;color:var(--text-muted);">The GN 2.0 Server makes a backup of every save each night. With a Cloudflare R2 bucket set up, that backup is also copied off your PC (the newest 7 are kept), so a dead drive doesn't lose anyone's progress. The keys go straight to the server: nobody can read them back from here, not even you.</p>
        <p id="owner-offsite-status" style="margin:0 0 0.75rem;font-size:13px;">Checking…</p>
        <input id="owner-r2-account" placeholder="Account ID (32 letters and numbers)" autocomplete="off" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <input id="owner-r2-bucket" placeholder="Bucket name, e.g. gn-backups" autocomplete="off" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <input id="owner-r2-key" placeholder="Access Key ID" autocomplete="off" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <input id="owner-r2-secret" type="password" placeholder="Secret Access Key" autocomplete="new-password" style="width:100%;padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);font-size:14px;margin-bottom:0.5rem;font-family:inherit;">
        <button class="settings-button" type="button" onclick="ownerSaveOffsite()">Save keys</button>
    </div>

    <div class="settings-section">
        <h4>Zone Cache</h4>
        <button class="settings-button" type="button" onclick="forceRefreshZones()">Force Refresh Zones</button>
    </div>

    <div class="settings-section">
        <h4>Danger Zone</h4>
        <button class="settings-button" type="button"
            style="background:linear-gradient(135deg,#ef4444,#dc2626);"
            onclick="ownerResetAll()">Reset All Owner Data</button>
    </div>
    `;

    ownerOffsiteStatus();
    ownerMinecraft();
    ownerMaintStatus();
    const ownerGameList = document.getElementById("owner-game-list");
    const disabledIds = getDisabledZoneIds();
    zones.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(zone => {
        const row = document.createElement("label");
        row.className = "owner-game-toggle";

        const name = document.createElement("span");
        name.className = "owner-game-name";
        name.textContent = `${zone.name} (#${zone.id})`;
        row.appendChild(name);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = disabledIds.has(String(zone.id));
        checkbox.onchange = () => setZoneDisabled(zone.id, checkbox.checked);
        row.appendChild(checkbox);

        ownerGameList.appendChild(row);
    });

    popupBody.contentEditable = false;
    document.getElementById('popupOverlay').style.display = "flex";
    renderOwnerReports(true);
    renderOwnerTrusted();
    renderOwnerAccess();
    if (typeof renderOwnerSubmissions === "function") renderOwnerSubmissions();
    renderOwnerModeBar();
    organizeOwnerPanel(popupBody);
}

function organizeOwnerPanel(body) {
    const sections = [...body.querySelectorAll(":scope > .settings-section")];
    if (!sections.length) return;
    const icon = n => (typeof gnIcon === "function" ? gnIcon(n) + " " : "");
    const head = document.createElement("div");
    head.innerHTML = `
        <input type="search" class="set-search" id="owner-search" placeholder="Search owner settings…" aria-label="Search owner settings" data-lpignore="true" data-1p-ignore data-form-type="other">
        <div class="admin-tabs set-tabs" role="tablist">${OWNER_TABS.map(t => `<button type="button" role="tab" data-tab="${t.id}">${icon(t.icon)}${t.label}</button>`).join("")}</div>
        <p class="set-empty" id="owner-noresults" hidden>Nothing in the Owner Panel matches that.</p>`;
    const panes = new Map(OWNER_TABS.map(t => { const d = document.createElement("div"); d.className = "set-pane"; d.dataset.pane = t.id; return [t.id, d]; }));
    const titleOf = sec => (sec.querySelector("h4")?.textContent || "").trim();
    const placed = new Set();
    for (const t of OWNER_TABS) for (const name of t.sections) {
        for (const sec of sections) if (!placed.has(sec) && titleOf(sec).startsWith(name)) { panes.get(t.id).appendChild(sec); placed.add(sec); }
    }
    sections.filter(sec => !placed.has(sec)).forEach(sec => panes.get("setup").insertBefore(sec, panes.get("setup").lastElementChild));
    // The mode bar (and anything else above the sections) stays on top
    const first = body.firstChild;
    body.insertBefore(head, first);
    panes.forEach(p => body.appendChild(p));
    const tabs = [...head.querySelectorAll(".set-tabs button")];
    const KEY = "gnmath-owner-tab";
    const showTab = name => {
        if (!panes.has(name)) name = "site";
        tabs.forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false"));
        panes.forEach((p, id) => { p.hidden = id !== name; });
        try { localStorage.setItem(KEY, name); } catch {}
    };
    const search = head.querySelector("#owner-search");
    const filter = q => {
        q = q.trim().toLowerCase();
        head.querySelector(".set-tabs").hidden = !!q;
        sections.forEach(sec => { sec.hidden = false; });
        if (!q) {
            head.querySelector("#owner-noresults").hidden = true;
            let last = "site"; try { last = localStorage.getItem(KEY) || "site"; } catch {}
            return showTab(last);
        }
        let any = false;
        panes.forEach(p => { p.hidden = false; });
        sections.forEach(sec => {
            // Game names in the Disable Games list don't count as a match
            const text = [...sec.childNodes].filter(n => !(n.id === "owner-game-list" || n.querySelector?.("#owner-game-list"))).map(n => n.textContent).join(" ").toLowerCase();
            sec.hidden = !text.includes(q);
            any = any || !sec.hidden;
        });
        head.querySelector("#owner-noresults").hidden = any;
    };
    tabs.forEach(b => b.onclick = () => { if (search.value) search.value = ""; filter(""); showTab(b.dataset.tab); });
    search.addEventListener("input", e => filter(e.target.value));
    let last = "site"; try { last = localStorage.getItem(KEY) || "site"; } catch {}
    showTab(last);
}

async function ownerAddAccessAccount(e) {
    e.preventDefault();
    const input = document.getElementById("owner-access-username");
    const name = (typeof normalizeUsername === "function" ? normalizeUsername(input.value) : input.value.trim().toLowerCase());
    if (!name) return;
    if (typeof cloudUser !== "undefined" && cloudUser && currentUsername().toLowerCase() === name) {
        setAccessAllowed(cloudUser.uid, currentUsername()); input.value = "";
        notify(`${currentUsername()} can now get in while the site is closed.`, { type: "success" });
        return;
    }
    if (typeof cloudDb === "undefined" || !cloudDb) { notify("Accounts haven't loaded yet. Try again in a moment.", { type: "error" }); return; }
    try {
        const snap = await cloudDb.collection("profiles").where("username", "==", name).limit(1).get();
        if (snap.empty) { notify(`No account called "${name}". It has to have visited the site while signed in at least once.`, { type: "error" }); return; }
        const doc = snap.docs[0];
        setAccessAllowed(doc.id, doc.data().username || name);
        input.value = "";
        notify(`${doc.data().username || name} can now get in while the site is closed.`, { type: "success" });
    } catch (err) {
        notify("Couldn't look that account up. Sign in to your owner account on this browser first.", { type: "error" });
    }
}

async function ownerSetAccessPassword(e) {
    e.preventDefault();
    const input = document.getElementById("owner-access-pass");
    const pw = input.value.trim();
    if (pw.length < 6) { notify("Use at least 6 characters.", { type: "error" }); return; }
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
    const hash = await hashSitePassword(pw, salt, SITE_PASS_ITER);
    const a = getSiteAccess();
    a.pass = { salt, hash, iter: SITE_PASS_ITER };
    setSiteAccess(a);
    input.value = "";
    githubAutoSync();
    renderOwnerAccess();
    notify(getGithubPat() ? "Password set. Anyone who enters it gets in while the site is closed." : "Password saved in this browser only. Add your GitHub token above so it applies for everyone.", { type: getGithubPat() ? "success" : "error" });
}

function ownerClearAccessPassword() {
    const a = getSiteAccess();
    a.pass = null;
    setSiteAccess(a);
    githubAutoSync();
    renderOwnerAccess();
    notify("Password removed. Only the accounts in the list can get in now.", { type: "success" });
}

function renderOwnerTrusted() {
    const list = document.getElementById("owner-trusted-list");
    const add = document.getElementById("owner-trusted-add");
    if (!list || !add) return;
    const trusted = getTrustedReporters();
    list.innerHTML = "";
    if (!trusted.length) {
        const p = document.createElement("p");
        p.style.cssText = "margin:0.25rem;color:var(--text-muted);font-size:13px;";
        p.textContent = "No trusted accounts yet.";
        list.appendChild(p);
    }
    trusted.forEach(t => {
        const row = document.createElement("div");
        row.className = "owner-game-row";
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.4rem 0.25rem;";
        const name = document.createElement("span");
        name.textContent = t.name || t.uid;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-button";
        btn.style.width = "auto";
        btn.textContent = "Remove";
        btn.onclick = () => { setTrustedReporters(getTrustedReporters().filter(x => x.uid !== t.uid)); githubAutoSync(); renderOwnerTrusted(); if (typeof refreshCards === "function") refreshCards(); };
        row.append(name, btn);
        list.appendChild(row);
    });
    add.innerHTML = "";
    const me = typeof cloudUser !== "undefined" && cloudUser ? cloudUser : null;
    if (!me) {
        add.innerHTML = `<p style="margin:0;font-size:13px;color:var(--text-muted);">Sign in to an account on this browser to add it here.</p>`;
    } else if (!trusted.some(x => x.uid === me.uid)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-button";
        btn.textContent = `Make my account (${currentUsername()}) a trusted reporter`;
        btn.onclick = () => {
            setTrustedReporters([...getTrustedReporters(), { uid: me.uid, name: currentUsername() }]);
            githubAutoSync();
            renderOwnerTrusted();
            if (typeof refreshCards === "function") refreshCards();
            notify(`${currentUsername()} is now a trusted reporter. It's saved to GitHub, so it applies for everyone.`, { type: "success" });
        };
        add.appendChild(btn);
    }
}

async function renderOwnerReports(refresh) {
    const list = document.getElementById("owner-reports-list");
    if (!list) return;
    if (typeof cloudDb === "undefined" || !cloudDb) {
        list.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);">Reports need accounts to be switched on.</p>`;
        return;
    }
    if (refresh) await loadGameStats({ force: true });
    const box = document.getElementById("owner-reports-list");
    if (!box) return;
    const rows = Object.entries(gameStats)
        .map(([id, st]) => {
            const times = Object.values(st.r || {});
            return { id, st, total: times.length, recent: st.reports, last: times.length ? Math.max(...times) : 0 };
        })
        .filter(x => x.total > 0)
        .sort((a, b) => b.recent - a.recent || b.total - a.total || b.last - a.last);
    box.innerHTML = "";
    if (!rows.length) {
        box.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);">No broken reports.</p>`;
        return;
    }
    for (const x of rows) {
        const zone = zoneById(x.id);
        const row = document.createElement("div");
        row.className = "owner-game-toggle";
        const info = document.createElement("span");
        info.className = "owner-game-name";
        const title = document.createElement("b");
        title.textContent = zone ? `${zone.name} (#${x.id})` : `Game #${x.id}`;
        const detail = document.createElement("div");
        detail.style.cssText = "font-size:12px;color:var(--text-muted);";
        const votes = x.st.up + x.st.down;
        detail.textContent = `${x.recent} in last ${BROKEN_REPORT_DAYS} days · ${x.total} total · last ${timeAgo(x.last)}` +
            (votes ? ` · ${Math.round(x.st.up / votes * 100)}% liked of ${votes}` : "") +
            (isFlaggedBroken(x.st) ? " · flagged" : "");
        info.append(title, detail);
        row.appendChild(info);
        const disabled = isZoneDisabled(x.id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "settings-button";
        btn.style.cssText = "flex:0 0 auto;width:84px;min-width:0;padding:0.45rem 0;font-size:13px;white-space:nowrap;" + (disabled ? "background:var(--surface-hover);" : "");
        btn.textContent = disabled ? "Enable" : "Disable";
        btn.onclick = () => {
            setZoneDisabled(x.id, !disabled);
            const cb = [...document.querySelectorAll("#owner-game-list .owner-game-toggle")]
                .find(l => l.textContent.includes(`(#${x.id})`))?.querySelector("input");
            if (cb) cb.checked = !disabled;
            renderOwnerReports(false);
        };
        row.appendChild(btn);
        // Admins: clear its reports for everyone
        if (typeof isSiteAdmin === "function" && isSiteAdmin() && typeof markGameFixed === "function") {
            const fix = document.createElement("button");
            fix.type = "button";
            fix.className = "settings-button";
            fix.style.cssText = "flex:0 0 auto;width:84px;min-width:0;padding:0.45rem 0;font-size:13px;white-space:nowrap;margin-left:0.35rem;";
            fix.textContent = "Fixed";
            fix.title = "Mark fixed: clear its broken reports for everyone";
            fix.onclick = async () => { if (await markGameFixed(x.id)) renderOwnerReports(false); };
            row.appendChild(fix);
        }
        box.appendChild(row);
    }
}

function saveOwnerVisitorDefaults() {
    const value = id => document.getElementById(id);
    setOwnerVisitorDefaults({
        mode: value("owner-default-mode").value, theme: value("owner-default-theme").value,
        cardSize: value("owner-default-card-size").value, fontSize: value("owner-default-font-size").value, defaultSort: value("owner-default-sort").value,
        compactMode: value("owner-default-compact").checked, hideFeatured: value("owner-default-hide-featured").checked,
        autofocusSearch: value("owner-default-autofocus").checked, showPlayCount: value("owner-default-play-count").checked,
        warnBeforeUnload: value("owner-default-warn").checked, reducedMotion: value("owner-default-reduced-motion").checked
    });
    notify("New-visitor defaults saved. People who already chose their own settings keep them.", { type: "success" });
}

function setAnnouncement(text, enabled, type) {
    localStorage.setItem(OWNER_STORAGE_KEYS.announcement, text);
    localStorage.setItem(OWNER_STORAGE_KEYS.announcementEnabled, enabled ? "true" : "false");
    if (type) localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.announcementType, ANNOUNCEMENT_TYPES.includes(type) ? type : "info");
    applyAnnouncement();
    githubAutoSync();
}

function saveAnnouncementFromPanel() {
    const text    = document.getElementById('owner-announcement-text')?.value ?? "";
    const enabled = document.getElementById('owner-announcement-enabled')?.checked ?? false;
    const type    = document.getElementById('owner-announcement-type')?.value || "info";
    setAnnouncement(text, enabled, type);
}

function exportDisabledZones() {
    const disabledIds = Array.from(getDisabledZoneIds());
    downloadJsonFile("disabled-zones.json", { disabledZoneIds: disabledIds, exportedAt: new Date().toISOString() });
}

function importDisabledZones(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data.disabledZoneIds)) throw new Error("Invalid format");
            setDisabledZoneIds(new Set(data.disabledZoneIds.map(String)));
            notify(`Imported ${data.disabledZoneIds.length} disabled game(s).`, { type: "success" });
            renderOwnerPanel();
        } catch (err) {
            notify("Couldn't import that file: " + err.message, { type: "error" });
        }
    };
    reader.readAsText(file);
}

async function enableAllZones() {
    if (!(await askConfirm('Every game you disabled will be visible to everyone again.', { title: 'Turn all games back on?', confirmText: 'Turn on all' }))) return;
    setDisabledZoneIds(new Set());
    githubAutoSync();
    renderOwnerPanel();
}

async function forceRefreshZones() {
    featuredContainer.innerHTML = "";
    container.innerHTML = "Refreshing…";
    _allStatsCache = null;
    popularityData = {};
    await listZones();
    notify("Game list refreshed.", { type: "success" });
    renderOwnerPanel();
}

async function ownerResetAll() {
    if (!(await askConfirm('This clears site mode, disabled games, broken reports, the announcement, the message of the day and footer links.', { title: 'Reset all owner data?', confirmText: 'Reset everything', danger: true }))) return;
    localStorage.removeItem(OWNER_STORAGE_KEYS.siteMode);
    localStorage.removeItem(OWNER_STORAGE_KEYS.disabledZones);
    localStorage.removeItem(OWNER_STORAGE_KEYS.brokenReports);
    localStorage.removeItem(OWNER_STORAGE_KEYS.announcement);
    localStorage.removeItem(OWNER_STORAGE_KEYS.announcementEnabled);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.visitorDefaults);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motd);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motdEnabled);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motdLastSeen);
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.footerLinks);
    applyOwnerSiteMode();
    applyAnnouncement();
    applyFooterLinks();
    featuredContainer.innerHTML = "";
    sortZones();
    notify("All owner data was reset.", { type: "success" });
    renderOwnerPanel();
}

async function ownerSyncSave() {
    const btn    = document.getElementById("owner-sync-btn");
    const status = document.getElementById("owner-sync-status");
    if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
    if (status) status.textContent = "";
    try {
        const ok = await githubSyncPush();
        if (btn)    { btn.textContent = "Save & Sync to GitHub"; btn.disabled = false; }
        if (status) {
            status.textContent = ok
                ? "✓ Saved to GitHub — all devices will pick this up on next load."
                : "✗ Save failed. Check your token has repo write access.";
            status.style.color = ok ? "var(--success)" : "#ef4444";
        }
    } catch(e) {
        if (btn)    { btn.textContent = "Save & Sync to GitHub"; btn.disabled = false; }
        if (status) { status.textContent = "✗ Error: " + e.message; status.style.color = "#ef4444"; }
    }
}

async function ownerSyncPullManual() {
    const status = document.getElementById("owner-sync-status");
    if (status) { status.textContent = "Pulling…"; status.style.color = "var(--text-muted)"; }
    try {
        await githubSyncPull({ rerender: true });
        renderOwnerPanel();
        const s = document.getElementById("owner-sync-status");
        if (s) { s.textContent = "✓ Pulled latest settings from GitHub."; s.style.color = "var(--success)"; }
    } catch(e) {
        if (status) { status.textContent = "✗ Pull failed: " + e.message; status.style.color = "#ef4444"; }
    }
}

function setMotd(text, enabled) {
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motd, text);
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.motdEnabled, enabled ? "true" : "false");
    githubAutoSync();
}

async function ownerForgetToken() {
    if (!(await askConfirm("You'll need to paste it again to open the Owner Panel on this browser.", { title: "Remove GitHub token?", confirmText: "Remove", danger: true }))) return;
    setGithubPat("");
    try { sessionStorage.removeItem("gnmath-owner-unlocked"); } catch {}
    closePopup();
}

// ── MOTD panel helpers ────────────────────────────────────────────────────────
function saveMotdFromPanel() {
    const text    = document.getElementById("owner-motd-text")?.value ?? "";
    const enabled = document.getElementById("owner-motd-enabled")?.checked ?? false;
    setMotd(text, enabled);
}

function resetMotdLastSeen() {
    localStorage.removeItem(OWNER_EXTRA_STORAGE_KEYS.motdLastSeen);
    notify("The message of the day will show again on the next visit.", { type: "success" });
}

// ── Footer links panel helpers ────────────────────────────────────────────────
function saveFooterLinksFromPanel() {
    const raw = document.getElementById("owner-footer-links-text")?.value ?? "";
    const links = raw.split("\n")
        .map(line => line.trim())
        .filter(line => line.includes("|"))
        .map(line => {
            const idx = line.indexOf("|");
            return { label: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
        })
        .filter(({ label, url }) => label && url);
    setFooterLinks(links);
    notify(`Saved ${links.length} footer link(s).`, { type: "success" });
}

async function clearFooterLinks() {
    if (!(await askConfirm('Your custom footer links will be removed for everyone.', { title: 'Remove all footer links?', confirmText: 'Remove', danger: true }))) return;
    setFooterLinks([]);
    renderOwnerPanel();
}

function setFooterLinks(links) {
    localStorage.setItem(OWNER_EXTRA_STORAGE_KEYS.footerLinks, JSON.stringify(links));
    applyFooterLinks();
    githubAutoSync();
}
