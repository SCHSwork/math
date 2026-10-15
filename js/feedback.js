// ═════════════════════════════════════════════════════════════════════════════
// Report a problem / Suggest a feature.
// Signed-in players send reports (a broken game, a site bug, bad content…) and
// feature ideas. Each one is saved in Firestore (feedback/<id>) with the
// account that sent it. Only that account and the mods (game admins, see
// admins/<uid>) can read reports. Mods review everything in Admin Panel →
// Reports & ideas: they can confirm, mark fixed or reject reports, and approve,
// mark done or reject ideas, with a note the sender sees.
// Approved ideas show on a public ideas list where signed-in players can
// upvote them, so mods can see what people want most.
// ═════════════════════════════════════════════════════════════════════════════
const FEEDBACK_CATEGORIES = {
    game: "A game doesn't work",
    content: "Something inappropriate or harmful",
    ads: "Ads, popups or a sketchy game",
    site: "Something on the site is broken",
    account: "Account or cloud saves",
    other: "Something else"
};
const FEEDBACK_STATUS = {
    bug: {
        open: "⏳ Waiting for a mod",
        confirmed: "🔎 Confirmed, being worked on",
        fixed: "✅ Fixed",
        rejected: "✖ Closed"
    },
    feature: {
        open: "⏳ Waiting for a mod",
        approved: "👍 Approved, on the ideas list",
        done: "🎉 Added to the site",
        rejected: "✖ Not planned"
    }
};
const FEEDBACK_LIMIT = { count: 5, perMs: 60 * 60 * 1000 };   // per account per hour, on this device
const FEEDBACK_SENT_KEY = "gnmath-feedback-sent";

function fbTally(r, w) { if (typeof fbCount === "function") fbCount(r, w); }
function feedbackTime(f) {
    const t = f.createdAt;
    const d = t && typeof t.toDate === "function" ? t.toDate() : (t ? new Date(t) : null);
    return d && !isNaN(d) ? d : null;
}
function feedbackDate(f) { const d = feedbackTime(f); return d ? d.toLocaleDateString() : ""; }
function feedbackReady(action) {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG || typeof cloudDb === "undefined" || !cloudDb) {
        notify("Reports and ideas need the account system, which couldn't load on this network right now.", { type: "error" });
        return false;
    }
    if (!cloudUser) {
        notify(`Sign in or create a free account to ${action}. It lets you see what the mods say back.`);
        openAccountPanel();
        return false;
    }
    if (typeof isSuspended === "function" && isSuspended()) { notify("This account is suspended, so it can't send reports or ideas.", { type: "error" }); return false; }
    return true;
}
function feedbackRateOk() {
    let sent = [];
    try { sent = JSON.parse(localStorage.getItem(FEEDBACK_SENT_KEY) || "[]"); } catch {}
    sent = sent.filter(t => Date.now() - t < FEEDBACK_LIMIT.perMs);
    return sent.length < FEEDBACK_LIMIT.count;
}
function feedbackNoteSent() {
    let sent = [];
    try { sent = JSON.parse(localStorage.getItem(FEEDBACK_SENT_KEY) || "[]"); } catch {}
    sent = sent.filter(t => Date.now() - t < FEEDBACK_LIMIT.perMs);
    sent.push(Date.now());
    try { localStorage.setItem(FEEDBACK_SENT_KEY, JSON.stringify(sent)); } catch {}
}
// Short, non-personal description of the device, to help reproduce bugs
function feedbackContext() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /CrOS/.test(ua) ? "Chrome (Chromebook)" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other browser";
    const os = /CrOS/.test(ua) ? "ChromeOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    const down = typeof mirrorDown !== "undefined" && mirrorDown.size ? ` · sources down: ${[...mirrorDown].join(", ")}` : "";
    return `${browser}${os ? " on " + os : ""} · ${screen.width}×${screen.height}${down}`.slice(0, 200);
}

// type: "bug" or "feature"; zone: the game it's about (optional)
function openFeedback(type = "bug", { zone = null } = {}) {
    if (!feedbackReady(type === "feature" ? "suggest a feature" : "report a problem")) return;
    if (!zone && type === "bug" && typeof zoneViewer !== "undefined" && zoneViewer.style.display === "flex" && typeof currentGameId !== "undefined") {
        zone = (typeof zones !== "undefined" ? zones : []).find(z => String(z.id) === String(currentGameId)) || null;
    }
    const isBug = type === "bug";
    document.getElementById("popupTitle").textContent = isBug ? "Report a problem" : "Suggest a feature";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    const field = (label, html, hint) => `<label class="submit-field"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ""}</label>`;
    body.innerHTML = `
        <div class="admin-tabs fb-switch" role="tablist">
            <button type="button" role="tab" data-type="bug" aria-selected="${isBug}">⚠️ Report a problem</button>
            <button type="button" role="tab" data-type="feature" aria-selected="${!isBug}">💡 Suggest a feature</button>
            <button type="button" role="tab" data-type="ideas" aria-selected="false">🗳️ Ideas board</button>
        </div>
        <p style="margin:0 0 1rem;color:var(--text-muted);font-size:14px;">${isBug
            ? "Tell the mods what went wrong. They can see your report and reply to it here."
            : "Got an idea to make GN 2.0 better? Mods review every idea, and approved ones go on the ideas board where everyone can vote."}</p>
        <form id="fb-form" class="submit-form" autocomplete="off" novalidate>
            ${isBug ? field("What kind of problem? *", `<select id="fb-cat">${Object.entries(FEEDBACK_CATEGORIES).map(([k, v]) => `<option value="${k}" ${zone && k === "game" ? "selected" : ""}>${escapeHtmlText(v)}</option>`).join("")}</select>`) : ""}
            ${isBug ? `<div id="fb-game-wrap">${field("Which game?", `<input id="fb-game" maxlength="80" list="fb-game-list" placeholder="Game name (if it's about a game)" value="${zone ? escapeHtmlText(zone.name) : ""}"><datalist id="fb-game-list"></datalist>`)}</div>` : ""}
            ${field(isBug ? "Short summary *" : "Your idea in a few words *", `<input id="fb-title" maxlength="80" required placeholder="${isBug ? "e.g. Slope freezes after 10 seconds" : "e.g. A dark-blue theme"}">`)}
            ${field(isBug ? "What happened? *" : "Tell us more", `<textarea id="fb-details" maxlength="1000" rows="4" placeholder="${isBug ? "What did you do, what did you expect, and what happened instead?" : "How would it work? Why would it help?"}"></textarea>`, isBug ? "Please don't include personal info like your full name or school." : "")}
            ${isBug ? `<label class="random-check"><input type="checkbox" id="fb-ctx" checked> Include my browser and screen size (helps fix bugs): <span class="fb-ctx-text"></span></label>` : ""}
            <p id="fb-error" class="submit-error" role="alert" hidden></p>
            <button type="submit" class="settings-button" id="fb-send">${isBug ? "Send report" : "Send idea"}</button>
        </form>
        <div id="fb-mine" class="submit-mine"></div>`;
    body.querySelectorAll(".fb-switch button").forEach(b => b.onclick = () => {
        if (b.dataset.type === "ideas") openIdeasBoard();
        else if (b.dataset.type !== type) openFeedback(b.dataset.type, { zone });
    });
    const ctx = body.querySelector(".fb-ctx-text");
    if (ctx) ctx.textContent = feedbackContext();
    const list = body.querySelector("#fb-game-list");
    if (list && typeof zones !== "undefined") {
        const recent = (typeof getRecent === "function" ? getRecent() : []).map(id => zones.find(z => String(z.id) === String(id))).filter(Boolean);
        list.innerHTML = recent.slice(0, 20).map(z => `<option value="${escapeHtmlText(z.name)}">`).join("");
    }
    const cat = body.querySelector("#fb-cat");
    const syncCat = () => { const w = body.querySelector("#fb-game-wrap"); if (w) w.hidden = !["game", "ads", "content"].includes(cat.value); };
    if (cat) { cat.addEventListener("change", syncCat); syncCat(); }
    body.querySelector("#fb-form").onsubmit = e => { e.preventDefault(); sendFeedback(type, zone); };
    document.getElementById("popupOverlay").style.display = "flex";
    setTimeout(() => body.querySelector(zone ? "#fb-title" : (cat ? "#fb-cat" : "#fb-title"))?.focus(), 50);
    renderMyFeedback();
}

function feedbackError(msg) {
    const el = document.getElementById("fb-error");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
}

async function sendFeedback(type, zone) {
    const val = id => (document.getElementById(id)?.value || "").trim();
    const isBug = type === "bug";
    const category = isBug ? val("fb-cat") : "idea";
    const title = val("fb-title"), details = val("fb-details");
    const gameWrap = document.getElementById("fb-game-wrap");
    const gameName = isBug && gameWrap && !gameWrap.hidden ? val("fb-game") : "";
    if (!title) return feedbackError(isBug ? "Please add a short summary." : "Please write your idea in a few words.");
    if (isBug && details.length < 5) return feedbackError("Please say what happened, so the mods can find the problem.");
    if (!feedbackRateOk()) return feedbackError("You've sent a lot in the last hour. Please wait a bit before sending more.");
    const match = gameName && typeof zones !== "undefined" ? (zone && zone.name === gameName ? zone : zones.find(z => z.name.toLowerCase() === gameName.toLowerCase())) : null;
    feedbackError("");
    const btn = document.getElementById("fb-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
        await cloudDb.collection("feedback").add({
            uid: cloudUser.uid,
            username: currentUsername().slice(0, 40),
            type,
            category,
            title: title.slice(0, 80),
            details: details.slice(0, 1000),
            gameId: match ? String(match.id).slice(0, 12) : "",
            gameName: gameName.slice(0, 80),
            context: isBug && document.getElementById("fb-ctx")?.checked ? feedbackContext() : "",
            status: "open",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        fbTally(0, 1);
        feedbackNoteSent();
        notify(isBug ? "Thanks! Your report was sent to the mods." : "Thanks! Your idea was sent to the mods.", { type: "success" });
        document.getElementById("fb-form").reset();
        const ctx = document.querySelector(".fb-ctx-text");
        if (ctx) ctx.textContent = feedbackContext();
        renderMyFeedback();
    } catch (e) {
        console.error(e);
        feedbackError("Couldn't send it: " + (typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e));
    } finally {
        btn.disabled = false;
        btn.textContent = isBug ? "Send report" : "Send idea";
    }
}

// The sender's own reports and ideas, with what the mods said
async function renderMyFeedback() {
    const box = document.getElementById("fb-mine");
    if (!box || !cloudUser) return;
    try {
        const snap = await cloudDb.collection("feedback").where("uid", "==", cloudUser.uid).get();
        fbTally(Math.max(1, snap.size), 0);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!list.length) { box.innerHTML = ""; return; }
        list.sort((a, b) => (feedbackTime(b) || 0) - (feedbackTime(a) || 0));
        box.innerHTML = `<h4>What you've sent</h4>`;
        for (const f of list.slice(0, 30)) {
            const row = document.createElement("div");
            row.className = "submit-row";
            const left = document.createElement("div");
            const b = document.createElement("b");
            b.textContent = (f.type === "feature" ? "💡 " : "⚠️ ") + f.title;
            const meta = document.createElement("small");
            meta.textContent = `${FEEDBACK_STATUS[f.type]?.[f.status] || f.status}${feedbackDate(f) ? " · " + feedbackDate(f) : ""}`;
            left.append(b, meta);
            if (f.note) {
                const note = document.createElement("small");
                note.className = "fb-mod-note";
                note.textContent = "Mod: " + f.note;
                left.appendChild(note);
            }
            row.appendChild(left);
            if (f.status === "open") {
                const del = document.createElement("button");
                del.type = "button";
                del.className = "finder-chip";
                del.textContent = "Withdraw";
                del.onclick = async () => {
                    if (!(await askConfirm(`Withdraw "${f.title}"?`, { confirmText: "Withdraw", danger: true }))) return;
                    try { await cloudDb.collection("feedback").doc(f.id).delete(); fbTally(0, 1); renderMyFeedback(); }
                    catch { notify("Couldn't withdraw it. Try again in a moment.", { type: "error" }); }
                };
                row.appendChild(del);
            }
            box.appendChild(row);
        }
    } catch (e) {
        console.warn("Couldn't load your reports", e);
    }
}

// ── Ideas board: approved ideas everyone can vote on ────────────────────────
async function loadPublicIdeas() {
    const snap = await cloudDb.collection("feedback").where("type", "==", "feature").where("status", "in", ["approved", "done"]).get();
    fbTally(Math.max(1, snap.size), 0);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function openIdeasBoard() {
    if (!feedbackReady("vote on ideas")) return;
    document.getElementById("popupTitle").textContent = "Ideas board";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    body.innerHTML = `
        <div class="admin-tabs fb-switch" role="tablist">
            <button type="button" role="tab" data-type="bug" aria-selected="false">⚠️ Report a problem</button>
            <button type="button" role="tab" data-type="feature" aria-selected="false">💡 Suggest a feature</button>
            <button type="button" role="tab" data-type="ideas" aria-selected="true">🗳️ Ideas board</button>
        </div>
        <p style="margin:0 0 0.75rem;color:var(--text-muted);font-size:14px;">Ideas the mods approved. Vote for the ones you want most; the most-wanted ones get looked at first.</p>
        <div id="fb-ideas" class="fb-ideas"><p style="color:var(--text-muted);font-size:13px;">Loading ideas…</p></div>`;
    body.querySelectorAll(".fb-switch button").forEach(b => b.onclick = () => { if (b.dataset.type !== "ideas") openFeedback(b.dataset.type); });
    document.getElementById("popupOverlay").style.display = "flex";
    const box = document.getElementById("fb-ideas");
    let ideas;
    try { ideas = await loadPublicIdeas(); }
    catch (e) { box.innerHTML = `<p class="submit-error">Couldn't load ideas: ${escapeHtmlText(typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e)}</p>`; return; }
    if (!ideas.length) { box.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No approved ideas yet. Be the first to suggest one!</p>`; return; }
    const votes = f => Object.keys(f.votes || {}).length;
    ideas.sort((a, b) => (a.status === "done") - (b.status === "done") || votes(b) - votes(a));
    box.innerHTML = "";
    for (const f of ideas) {
        const row = document.createElement("div");
        row.className = "fb-idea" + (f.status === "done" ? " done" : "");
        const mine = !!(f.votes && f.votes[cloudUser.uid]);
        const vote = document.createElement("button");
        vote.type = "button";
        vote.className = "fb-vote" + (mine ? " on" : "");
        vote.disabled = f.status === "done";
        vote.setAttribute("aria-pressed", mine ? "true" : "false");
        vote.title = f.status === "done" ? "Already added" : mine ? "Remove your vote" : "Vote for this idea";
        vote.innerHTML = `<span aria-hidden="true">▲</span><b></b>`;
        vote.querySelector("b").textContent = votes(f);
        vote.onclick = async () => {
            vote.disabled = true;
            const path = `votes.${cloudUser.uid}`;
            try {
                await cloudDb.collection("feedback").doc(f.id).update({ [path]: mine ? firebase.firestore.FieldValue.delete() : true });
                fbTally(0, 1);
                f.votes = { ...(f.votes || {}) };
                if (mine) delete f.votes[cloudUser.uid]; else f.votes[cloudUser.uid] = true;
                openIdeasBoard();
            } catch (e) { vote.disabled = false; notify("Couldn't save your vote: " + (e.message || e), { type: "error" }); }
        };
        const text = document.createElement("div");
        const t = document.createElement("b");
        t.textContent = f.title;
        const meta = document.createElement("small");
        meta.textContent = `${f.status === "done" ? "🎉 Added to the site" : "Suggested"} by ${f.username || "someone"}${feedbackDate(f) ? " · " + feedbackDate(f) : ""}`;
        text.append(t);
        if (f.details) { const p = document.createElement("p"); p.textContent = f.details; text.appendChild(p); }
        if (f.note) { const n = document.createElement("small"); n.className = "fb-mod-note"; n.textContent = "Mod: " + f.note; text.appendChild(n); }
        text.appendChild(meta);
        row.append(vote, text);
        box.appendChild(row);
    }
}

// ── Mods: review reports and ideas (Admin Panel → Reports & ideas) ─────────
let modFeedbackFilter = "open";
async function renderModFeedback() {
    const box = document.getElementById("admin-feedback");
    if (!box) return;
    box.innerHTML = `
        <div class="admin-toolbar">
            <select id="fb-mod-filter" aria-label="Show">
                <option value="open">Waiting for review</option>
                <option value="bug">All reports</option>
                <option value="feature">All ideas</option>
                <option value="active">Confirmed or approved</option>
                <option value="closed">Fixed, done or rejected</option>
                <option value="all">Everything</option>
            </select>
        </div>
        <p id="fb-mod-summary" class="admin-summary">Loading…</p>
        <div id="fb-mod-list" class="owner-panel-list fb-mod-list"></div>`;
    const sel = document.getElementById("fb-mod-filter");
    sel.value = modFeedbackFilter;
    sel.onchange = () => { modFeedbackFilter = sel.value; drawModFeedback(); };
    try {
        const snap = await cloudDb.collection("feedback").get();
        fbTally(Math.max(1, snap.size), 0);
        modFeedbackCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateFeedbackTabCount();
        drawModFeedback();
    } catch (e) {
        document.getElementById("fb-mod-summary").textContent = "Couldn't load reports: " + (typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e) + ". Make sure the newest config/firestore.rules is published.";
    }
}
let modFeedbackCache = [];
function updateFeedbackTabCount() {
    const n = modFeedbackCache.filter(f => f.status === "open").length;
    const tab = document.querySelector('.admin-tabs button[data-tab="feedback"]');
    if (!tab) return;
    tab.querySelector(".admin-tab-count")?.remove();
    if (n) tab.insertAdjacentHTML("beforeend", ` <span class="admin-tab-count">${n}</span>`);
}
function drawModFeedback() {
    const listEl = document.getElementById("fb-mod-list");
    if (!listEl) return;
    const flt = modFeedbackFilter;
    const closed = f => ["fixed", "done", "rejected"].includes(f.status);
    const list = modFeedbackCache.filter(f =>
        flt === "all" ? true :
        flt === "open" ? f.status === "open" :
        flt === "bug" || flt === "feature" ? f.type === flt :
        flt === "active" ? ["confirmed", "approved"].includes(f.status) :
        closed(f));
    const votes = f => Object.keys(f.votes || {}).length;
    list.sort((a, b) => (a.status !== "open") - (b.status !== "open") || votes(b) - votes(a) || (feedbackTime(b) || 0) - (feedbackTime(a) || 0));
    const openN = modFeedbackCache.filter(f => f.status === "open").length;
    document.getElementById("fb-mod-summary").textContent =
        (() => { const nb = modFeedbackCache.filter(f => f.type === "bug").length, ni = modFeedbackCache.filter(f => f.type === "feature").length;
            return `${openN} waiting for review · ${nb} report${nb === 1 ? "" : "s"} · ${ni} idea${ni === 1 ? "" : "s"} in total`; })();
    listEl.innerHTML = list.length ? "" : `<p style="margin:0.25rem;color:var(--text-muted);font-size:13px;">Nothing here.</p>`;
    for (const f of list) {
        const isBug = f.type === "bug";
        const row = document.createElement("div");
        row.className = "submit-review fb-review";
        row.dataset.status = f.status;
        const head = document.createElement("div");
        const b = document.createElement("b");
        b.textContent = (isBug ? "⚠️ " : "💡 ") + f.title;
        head.appendChild(b);
        const info = document.createElement("small");
        const bits = [isBug ? (FEEDBACK_CATEGORIES[f.category] || f.category) : "Feature idea"];
        if (f.gameName) bits.push("game: " + f.gameName + (f.gameId ? ` (#${f.gameId})` : ""));
        bits.push(`from ${f.username || "?"}${feedbackDate(f) ? " on " + feedbackDate(f) : ""}`);
        if (!isBug && votes(f)) bits.push(`▲ ${votes(f)} vote${votes(f) === 1 ? "" : "s"}`);
        info.textContent = bits.join(" · ");
        row.append(head, info);
        if (f.details) { const p = document.createElement("p"); p.textContent = f.details; row.appendChild(p); }
        if (f.context) { const c = document.createElement("small"); c.className = "fb-ctx"; c.textContent = "Device: " + f.context; row.appendChild(c); }
        const status = document.createElement("small");
        status.className = "submit-status";
        status.textContent = FEEDBACK_STATUS[f.type]?.[f.status] || f.status;
        if (f.reviewedBy) status.textContent += ` (by ${f.reviewedBy})`;
        const note = document.createElement("input");
        note.className = "submit-note";
        note.maxLength = 200;
        note.placeholder = "Note for the sender (optional, they'll see it)";
        note.value = f.note || "";
        note.setAttribute("aria-label", `Note for ${f.title}`);
        const actions = document.createElement("div");
        actions.className = "submit-actions";
        const setStatus = async st => {
            const data = { status: st, note: note.value.trim().slice(0, 200), reviewedBy: currentUsername().slice(0, 40), reviewedAt: firebase.firestore.FieldValue.serverTimestamp() };
            try {
                await cloudDb.collection("feedback").doc(f.id).update(data);
                fbTally(0, 1);
                Object.assign(f, data, { reviewedAt: new Date() });
                updateFeedbackTabCount();
                drawModFeedback();
                notify("Updated.", { type: "success" });
            } catch (e) { notify("Couldn't update it: " + (e.message || e), { type: "error" }); }
        };
        const choices = isBug
            ? [["Confirm", "confirmed"], ["Mark fixed", "fixed"], ["Reject", "rejected"], ["Reopen", "open"]]
            : [["Approve", "approved"], ["Mark done", "done"], ["Reject", "rejected"], ["Reopen", "open"]];
        for (const [label, st] of choices) {
            if (f.status === st || (st === "open" && f.status === "open")) continue;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "finder-chip" + (st === "confirmed" || st === "approved" ? " fb-primary" : "");
            btn.textContent = label;
            btn.onclick = () => setStatus(st);
            actions.appendChild(btn);
        }
        if (isBug && f.gameId && typeof zones !== "undefined") {
            const z = zones.find(x => String(x.id) === String(f.gameId));
            if (z) {
                const play = document.createElement("button");
                play.type = "button";
                play.className = "finder-chip";
                play.textContent = "Open game";
                play.onclick = () => { closePopup(); openZone(z); };
                actions.appendChild(play);
            }
        }
        const del = document.createElement("button");
        del.type = "button";
        del.className = "finder-chip";
        del.textContent = "Delete";
        del.onclick = async () => {
            if (!(await askConfirm(`Delete "${f.title}"? The sender won't see it any more.`, { confirmText: "Delete", danger: true }))) return;
            try {
                await cloudDb.collection("feedback").doc(f.id).delete();
                fbTally(0, 1);
                modFeedbackCache = modFeedbackCache.filter(x => x !== f);
                updateFeedbackTabCount();
                drawModFeedback();
            } catch { notify("Couldn't delete it.", { type: "error" }); }
        };
        actions.appendChild(del);
        row.append(status, note, actions);
        listEl.appendChild(row);
    }
}
