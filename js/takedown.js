// ═════════════════════════════════════════════════════════════════════════════
// Copyright takedown requests.
// A game's owner fills in the form (DMCA page, Terms, or a game's ⋯ menu). No
// account is needed, since owners usually won't have one. Each request is saved
// to Firestore (takedowns/<id>) and only the mods (admins/<uid>) can read it.
// Mods review requests in Admin Panel → Takedowns. "Remove game" adds the game
// to removals/games, a public list every visitor checks, so the game is hidden
// for everyone within a few minutes, with no GitHub token needed.
// Needs the takedowns and removals rules from config/firestore.rules.
// ═════════════════════════════════════════════════════════════════════════════
const TAKEDOWN = {
    removedKey: "gnmath-takedown-removed",
    sentKey: "gnmath-takedown-sent",
    checkEveryMs: 10 * 60 * 1000,      // how often visitors re-check the removed list
    perDay: 3,                          // requests per device per day
    email: "gn.math.business@gmail.com"
};
const TAKEDOWN_STATUS = {
    open: "⏳ Waiting for review",
    info: "✉️ Asked for more info",
    removed: "🚫 Game removed",
    rejected: "✖ Rejected",
    restored: "↩ Game restored"
};

// ── Everyone: keep the removed list up to date ──────────────────────────────
function takedownCache() { try { return JSON.parse(localStorage.getItem(TAKEDOWN.removedKey) || "{}") || {}; } catch { return {}; } }
function applyTakedownRemovals(ids) {
    const next = new Set(ids.map(String));
    const same = next.size === takedownRemovedIds.size && [...next].every(id => takedownRemovedIds.has(id));
    try { localStorage.setItem(TAKEDOWN.removedKey, JSON.stringify({ ids: [...next], at: Date.now() })); } catch {}
    if (same) return;
    takedownRemovedIds = next;
    // Redraw the game grid (not while someone's playing; it redraws on close)
    if (typeof zones !== "undefined" && zones.length && typeof sortZones === "function"
        && !(typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex")) {
        if (typeof featuredContainer !== "undefined") featuredContainer.innerHTML = "";
        sortZones();
    }
}
async function refreshTakedownRemovals(force = false) {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) return;
    if (!force && Date.now() - (takedownCache().at || 0) < TAKEDOWN.checkEveryMs) return;
    const P = FIREBASE_CONFIG.projectId, KEY = FIREBASE_CONFIG.apiKey;
    try {
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents/removals/games?key=${encodeURIComponent(KEY)}`, { cache: "no-store" });
        if (typeof fbCount === "function") fbCount(1, 0);
        if (res.status === 404) return applyTakedownRemovals([]);
        if (!res.ok) return;
        const doc = await res.json();
        const vals = doc.fields?.ids?.arrayValue?.values || [];
        applyTakedownRemovals(vals.map(v => v.stringValue).filter(Boolean));
    } catch {}
}
refreshTakedownRemovals();
setInterval(() => { if (!document.hidden) refreshTakedownRemovals(); }, 60 * 1000);

// ── The request form ────────────────────────────────────────────────────────
function takedownRateOk(note) {
    let sent = [];
    try { sent = JSON.parse(localStorage.getItem(TAKEDOWN.sentKey) || "[]"); } catch {}
    sent = sent.filter(t => Date.now() - t < 864e5);
    if (note) { sent.push(Date.now()); try { localStorage.setItem(TAKEDOWN.sentKey, JSON.stringify(sent)); } catch {} }
    return sent.length < TAKEDOWN.perDay;
}
function openTakedownForm(zone = null) {
    if (!zone && typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex" && typeof currentGameId !== "undefined") {
        zone = zones.find(z => String(z.id) === String(currentGameId)) || null;
    }
    document.getElementById("popupTitle").textContent = "Copyright takedown request";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    const cloudOk = typeof cloudDb !== "undefined" && cloudDb;
    const field = (label, html, hint) => `<label class="submit-field"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ""}</label>`;
    body.innerHTML = `
        <p style="margin:0 0 0.75rem;font-size:14px;">If you own the rights to a game listed on GN 2.0 and want it taken down, fill this in. It goes straight to the site's admins, who review every request and remove the game for everyone once it's confirmed. You don't need an account.</p>
        ${cloudOk ? "" : `<p class="submit-error">The request form can't connect on this network right now. Please email <a href="mailto:${TAKEDOWN.email}?subject=!DMCA">${TAKEDOWN.email}</a> with the subject starting with <code>!DMCA</code> instead.</p>`}
        <form id="td-form" class="submit-form" autocomplete="off" novalidate ${cloudOk ? "" : "hidden"}>
            ${field("Your name *", `<input id="td-name" maxlength="80" required>`)}
            ${field("Email for replies *", `<input id="td-email" type="email" maxlength="120" required placeholder="you@example.com">`, "Only the admins can see this. We'll use it only about this request.")}
            ${field("Company or studio", `<input id="td-org" maxlength="120" placeholder="Optional">`)}
            ${field("Game on this site *", `<input id="td-game" maxlength="80" list="td-game-list" required placeholder="Start typing the game's name" value="${zone ? escapeHtmlText(zone.name) : ""}"><datalist id="td-game-list"></datalist>`)}
            <div id="td-ubzone" class="td-ubzone" hidden></div>
            ${field("Your original game *", `<input id="td-work" maxlength="300" required placeholder="Link to the official page, store page or website">`)}
            ${field("How can we confirm you own it? *", `<textarea id="td-proof" maxlength="500" rows="3" required placeholder="e.g. email from the domain on the official site, a link to your developer account, or the store page that lists you as the publisher"></textarea>`)}
            ${field("Anything else", `<textarea id="td-details" maxlength="1000" rows="2" placeholder="Optional"></textarea>`)}
            <label class="random-check"><input type="checkbox" id="td-good-faith"> I believe in good faith that this use of the game isn't authorized by the owner, its agent, or the law.</label>
            <label class="random-check"><input type="checkbox" id="td-accurate"> The information here is accurate, and I am the owner or am authorized to act for the owner.</label>
            <p id="td-error" class="submit-error" role="alert" hidden></p>
            <button type="submit" class="settings-button" id="td-send">Send request to the admins</button>
        </form>
        <p class="td-foot" style="margin:0.75rem 0 0;font-size:13px;color:var(--text-muted);">Prefer email? Write to <a href="mailto:${TAKEDOWN.email}?subject=!DMCA">${TAKEDOWN.email}</a> with the subject starting with <code>!DMCA</code>. <a href="#" onclick="loadDMCA(); return false;">More about takedowns</a></p>`;
    // Suggest matching game names as they type (the full list is ~2,000)
    const input = body.querySelector("#td-game"), list = body.querySelector("#td-game-list");
    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        const hits = q.length < 2 || typeof zones === "undefined" ? [] : zones.filter(z => z.name.toLowerCase().includes(q)).slice(0, 15);
        list.innerHTML = hits.map(z => `<option value="${escapeHtmlText(z.name)}">`).join("");
    });
    // UBZone games are copies of files in other people's GitHub repos: show
    // those repos so the owner can go to the source too.
    const ubBox = body.querySelector("#td-ubzone");
    const showUbzoneSource = () => {
        if (!ubBox) return;
        const q = input.value.trim().toLowerCase();
        const g = zone && zone.name.toLowerCase() === q ? zone : (typeof zones !== "undefined" ? zones.find(z => z.name.toLowerCase() === q) : null);
        const isUb = g && typeof isUbzoneZone === "function" && isUbzoneZone(g);
        ubBox.hidden = !isUb;
        ubBox.innerHTML = isUb ? `<p><b>Where this copy comes from.</b> GN 2.0 loads this game from these GitHub repos (from the unblockedzone collection). Your request here removes it from GN 2.0; to have the files themselves taken down, contact those repos too or send GitHub a DMCA notice at <a href="https://github.com/contact/dmca" target="_blank" rel="noopener noreferrer">github.com/contact/dmca</a>.</p>${ubzoneSourceListHtml(g)}` : "";
    };
    input.addEventListener("input", showUbzoneSource);
    input.addEventListener("change", showUbzoneSource);
    showUbzoneSource();
    body.querySelector("#td-form").onsubmit = e => { e.preventDefault(); sendTakedown(zone); };
    document.getElementById("popupOverlay").style.display = "flex";
    setTimeout(() => body.querySelector("#td-name")?.focus(), 50);
}
function takedownError(msg) {
    const el = document.getElementById("td-error");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
}
async function sendTakedown(zone) {
    const val = id => (document.getElementById(id)?.value || "").trim();
    const name = val("td-name"), email = val("td-email"), org = val("td-org"), gameName = val("td-game"),
        work = val("td-work"), proof = val("td-proof"), details = val("td-details");
    if (!name) return takedownError("Please add your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return takedownError("Please add an email address we can reply to.");
    if (!gameName) return takedownError("Please say which game on this site it's about.");
    if (!work) return takedownError("Please link to your original game.");
    if (proof.length < 10) return takedownError("Please tell us how we can confirm you own it.");
    if (!document.getElementById("td-good-faith").checked || !document.getElementById("td-accurate").checked) return takedownError("Please tick both statements.");
    if (!takedownRateOk()) return takedownError(`You've sent several requests today. Please email ${TAKEDOWN.email} instead.`);
    const match = typeof zones === "undefined" ? null
        : (zone && zone.name === gameName ? zone : zones.find(z => z.name.toLowerCase() === gameName.toLowerCase()));
    takedownError("");
    const btn = document.getElementById("td-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
        const data = {
            name: name.slice(0, 80), email: email.slice(0, 120), org: org.slice(0, 120),
            gameId: match ? String(match.id).slice(0, 12) : "", gameName: gameName.slice(0, 80),
            work: work.slice(0, 300), proof: proof.slice(0, 500), details: details.slice(0, 1000),
            statement: true, status: "open",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (typeof cloudUser !== "undefined" && cloudUser) data.uid = cloudUser.uid;
        await cloudDb.collection("takedowns").add(data);
        if (typeof fbCount === "function") fbCount(0, 1);
        takedownRateOk(true);
        document.getElementById("popupBody").innerHTML = `
            <p style="font-size:15px;"><b>✓ Request sent.</b></p>
            <p>The admins will review it and email you at <b>${escapeHtmlText(email)}</b> if they need anything else. Once it's confirmed, the game is removed for everyone.</p>
            <p style="font-size:13px;color:var(--text-muted);">If it's urgent, you can also email <a href="mailto:${TAKEDOWN.email}?subject=!DMCA">${TAKEDOWN.email}</a>.</p>`;
    } catch (e) {
        console.error(e);
        takedownError(`Couldn't send it (${e.code || e.message || e}). Please email ${TAKEDOWN.email} with the subject starting with !DMCA instead.`);
        btn.disabled = false;
        btn.textContent = "Send request to the admins";
    }
}

// ── Mods: Admin Panel → Takedowns ───────────────────────────────────────────
let modTakedowns = [], modTakedownFilter = "open";
function takedownTime(t) { const d = t?.createdAt?.toDate ? t.createdAt.toDate() : null; return d && !isNaN(d) ? d : null; }
async function renderModTakedowns() {
    const box = document.getElementById("admin-takedowns");
    if (!box) return;
    box.innerHTML = `
        <div class="admin-toolbar">
            <select id="td-mod-filter" aria-label="Show">
                <option value="open">Waiting for review</option>
                <option value="removed">Removed games</option>
                <option value="all">Everything</option>
            </select>
        </div>
        <p id="td-mod-summary" class="admin-summary">Loading…</p>
        <div id="td-mod-list" class="owner-panel-list fb-mod-list"></div>
        <p class="admin-footnote">Check the proof before removing a game: the email should match the official site, or the store page should list them. "Remove game" hides it for every visitor within about 10 minutes. Requesters can't see notes, so reply by email.</p>`;
    const sel = document.getElementById("td-mod-filter");
    sel.value = modTakedownFilter;
    sel.onchange = () => { modTakedownFilter = sel.value; drawModTakedowns(); };
    try {
        const snap = await cloudDb.collection("takedowns").get();
        if (typeof fbCount === "function") fbCount(Math.max(1, snap.size), 0);
        modTakedowns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateTakedownTabCount();
        drawModTakedowns();
    } catch (e) {
        document.getElementById("td-mod-summary").textContent = "Couldn't load takedown requests: " + (e.code || e.message || e) + ". Make sure the newest config/firestore.rules is published.";
    }
}
function updateTakedownTabCount() {
    const n = modTakedowns.filter(t => t.status === "open" || t.status === "info").length;
    const tab = document.querySelector('.admin-tabs button[data-tab="takedowns"]');
    if (!tab) return;
    tab.querySelector(".admin-tab-count")?.remove();
    if (n) tab.insertAdjacentHTML("beforeend", ` <span class="admin-tab-count">${n}</span>`);
}
async function setGameRemoved(gameId, removed) {
    const FV = firebase.firestore.FieldValue;
    await cloudDb.collection("removals").doc("games").set({
        ids: removed ? FV.arrayUnion(String(gameId)) : FV.arrayRemove(String(gameId)),
        updatedAt: FV.serverTimestamp(),
        updatedBy: currentUsername().slice(0, 40)
    }, { merge: true });
    if (typeof fbCount === "function") fbCount(0, 1);
    const ids = new Set(takedownRemovedIds);
    removed ? ids.add(String(gameId)) : ids.delete(String(gameId));
    applyTakedownRemovals([...ids]);
}
function drawModTakedowns() {
    const listEl = document.getElementById("td-mod-list");
    if (!listEl) return;
    const f = modTakedownFilter;
    const list = modTakedowns.filter(t => f === "all" ? true : f === "open" ? (t.status === "open" || t.status === "info") : t.status === f);
    list.sort((a, b) => (takedownTime(b) || 0) - (takedownTime(a) || 0));
    const waiting = modTakedowns.filter(t => t.status === "open" || t.status === "info").length;
    document.getElementById("td-mod-summary").textContent = `${waiting} waiting · ${takedownRemovedIds.size} game${takedownRemovedIds.size === 1 ? "" : "s"} removed by takedown · ${modTakedowns.length} request${modTakedowns.length === 1 ? "" : "s"} in total`;
    listEl.innerHTML = list.length ? "" : `<p style="margin:0.25rem;color:var(--text-muted);font-size:13px;">Nothing here.</p>`;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const chip = (label, fn, primary) => { const b = el("button", "finder-chip" + (primary ? " fb-primary" : ""), label); b.type = "button"; b.onclick = fn; return b; };
    for (const t of list) {
        const row = el("div", "submit-review fb-review");
        row.dataset.status = t.status;
        const z = t.gameId && typeof zones !== "undefined" ? zones.find(x => String(x.id) === String(t.gameId)) : null;
        const head = el("div"); head.appendChild(el("b", "", "©️ " + (t.gameName || "?") + (t.gameId ? ` (#${t.gameId})` : " (no exact match)")));
        const d = takedownTime(t);
        row.append(head, el("small", "", `from ${t.name}${t.org ? " · " + t.org : ""}${d ? " on " + d.toLocaleDateString() : ""}`));
        const mail = el("small", "");
        const a = el("a", "", t.email);
        a.href = `mailto:${encodeURIComponent(t.email).replace(/%40/g, "@")}?subject=${encodeURIComponent("Your takedown request for " + (t.gameName || "a game") + " on GN 2.0")}`;
        mail.append("Reply: ", a);
        row.appendChild(mail);
        const work = el("p", "");
        work.append(el("b", "", "Original: "));
        if (/^https?:\/\//i.test(t.work || "")) { const w = el("a", "", t.work); w.href = t.work; w.target = "_blank"; w.rel = "noopener noreferrer"; work.appendChild(w); }
        else work.append(t.work || "");
        row.appendChild(work);
        const proof = el("p", ""); proof.append(el("b", "", "Proof: "), t.proof || ""); row.appendChild(proof);
        if (t.details) row.appendChild(el("p", "", t.details));
        // UBZone games: link the repos the files really come from
        if (z && typeof isUbzoneZone === "function" && isUbzoneZone(z)) {
            const src = el("p", "");
            src.append(el("b", "", "Files from: "));
            ubzoneSourceLinks(z).forEach((l, i) => {
                if (i) src.append(", ");
                const a = el("a", "", l.label); a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer"; src.appendChild(a);
            });
            src.append(" (UBZone game; tell the requester they can also contact these repos or GitHub)");
            row.appendChild(src);
        }
        if (t.uid) row.appendChild(el("small", "fb-ctx", "Sent while signed in to a GN 2.0 account."));
        const status = el("small", "submit-status", (TAKEDOWN_STATUS[t.status] || t.status) + (t.reviewedBy ? ` (by ${t.reviewedBy})` : ""));
        const note = el("input", "submit-note");
        note.maxLength = 200; note.placeholder = "Note for other admins (optional)"; note.value = t.note || "";
        const actions = el("div", "submit-actions");
        const setStatus = async st => {
            const data = { status: st, note: note.value.trim().slice(0, 200), reviewedBy: currentUsername().slice(0, 40), reviewedAt: firebase.firestore.FieldValue.serverTimestamp() };
            await cloudDb.collection("takedowns").doc(t.id).update(data);
            if (typeof fbCount === "function") fbCount(0, 1);
            Object.assign(t, data);
            updateTakedownTabCount();
            drawModTakedowns();
        };
        const act = (fn, done) => async () => {
            try { if ((await fn()) !== false && done) notify(done, { type: "success" }); }
            catch (e) { notify("Couldn't update it: " + (e.code || e.message || e), { type: "error" }); }
        };
        // Pick the game by id when the name didn't match exactly
        let idInput = null;
        if (!t.gameId && t.status !== "removed") {
            idInput = el("input", "submit-note");
            idInput.placeholder = "Game id to remove (find it with the site's search)";
            idInput.maxLength = 12;
            row.appendChild(idInput);
        }
        const gameId = () => t.gameId || (idInput ? idInput.value.trim() : "");
        if (t.status !== "removed") actions.appendChild(chip("Remove game", act(async () => {
            const id = gameId();
            if (!id) throw new Error("type the game's id first");
            const g = typeof zones !== "undefined" ? zones.find(x => String(x.id) === id) : null;
            if (!(await askConfirm(`Remove "${g ? g.name : "game #" + id}" for everyone?`, { confirmText: "Remove", danger: true }))) return false;
            await setGameRemoved(id, true);
            if (!t.gameId) { await cloudDb.collection("takedowns").doc(t.id).update({ gameId: id }).catch(() => {}); t.gameId = id; }
            await setStatus("removed");
        }, "Game removed for everyone. Let the requester know by email."), true));
        if (t.status === "removed" && t.gameId) actions.appendChild(chip("Restore game", act(async () => {
            if (!(await askConfirm("Put this game back on the site? Only do this if the request was withdrawn or was false.", { confirmText: "Restore" }))) return false;
            await setGameRemoved(t.gameId, false);
            await setStatus("restored");
        }, "Game restored.")));
        if (t.status !== "info" && t.status !== "removed") actions.appendChild(chip("Asked for more info", act(() => setStatus("info"))));
        if (t.status !== "rejected" && t.status !== "removed") actions.appendChild(chip("Reject", act(() => setStatus("rejected"))));
        if (t.status !== "open") actions.appendChild(chip("Reopen", act(() => setStatus("open"))));
        if (z) actions.appendChild(chip("Open game", () => { closePopup(); openZone(z); }));
        actions.appendChild(chip("Delete", act(async () => {
            if (!(await askConfirm("Delete this request? It can't be undone. (A removed game stays removed.)", { confirmText: "Delete", danger: true }))) return false;
            await cloudDb.collection("takedowns").doc(t.id).delete();
            modTakedowns = modTakedowns.filter(x => x !== t);
            updateTakedownTabCount();
            drawModTakedowns();
        })));
        row.append(status, note, actions);
        listEl.appendChild(row);
    }
}
