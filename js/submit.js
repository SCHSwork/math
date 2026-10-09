// ═════════════════════════════════════════════════════════════════════════════
// Submit a game: signed-in players can suggest a game for the site. Each
// submission goes to Firestore (submissions/<id>) with the account that sent
// it. Only that account and the site admins can read it (see
// config/firestore.rules). Admins review them in the Owner Panel; approved
// games are then added to SCHSwork/GN-originals by hand.
// ═════════════════════════════════════════════════════════════════════════════
const SUBMIT_RELATIONS = {
    mine: "I made this game",
    permission: "I have the creator's permission",
    license: "It has an open-source / free license"
};
const SUBMIT_STATUS = {
    pending: "⏳ Waiting for review",
    approved: "✅ Approved, coming soon",
    added: "🎮 Added to the site",
    rejected: "✖ Not added"
};

function submitField(label, html, hint) {
    return `<label class="submit-field"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ""}</label>`;
}

function openSubmitGame() {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) { notify("Submitting games isn't available on this site."); return; }
    if (!cloudUser) {
        notify("Sign in or create a free account to submit a game, so you can follow what happens to it.");
        openAccountPanel();
        return;
    }
    document.getElementById("popupTitle").textContent = "Submit a game";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    const genres = GENRES.map(g => `<option value="${g.id}">${escapeHtmlText(g.label)}</option>`).join("");
    body.innerHTML = `
        <p style="margin:0 0 1rem;color:var(--text-muted);font-size:14px;">Made a game, or know a great one that's free to share? Send it in and the site owner will take a look. We can only add games the creator allows to be shared.</p>
        <form id="submit-form" class="submit-form" autocomplete="off" novalidate>
            ${submitField("Game name *", `<input id="sub-name" maxlength="80" required>`)}
            ${submitField("Link to the game *", `<input id="sub-url" type="url" maxlength="300" placeholder="https://… (itch.io, GitHub, your own site)" required>`, "Where we can play or download it.")}
            ${submitField("Made by *", `<input id="sub-author" maxlength="80" required placeholder="Creator's name or username">`)}
            <fieldset class="submit-field submit-radios"><legend>How can it be shared? *</legend>
                ${Object.entries(SUBMIT_RELATIONS).map(([k, v], i) => `<label><input type="radio" name="sub-rel" value="${k}" ${i === 0 ? "checked" : ""}> ${escapeHtmlText(v)}</label>`).join("")}
            </fieldset>
            <div id="sub-license-wrap" hidden>${submitField("Which license?", `<input id="sub-license" maxlength="80" placeholder="e.g. MIT, GPL-3.0, CC BY 4.0">`)}</div>
            ${submitField("Genre", `<select id="sub-genre"><option value="">Pick one (optional)</option>${genres}</select>`)}
            ${submitField("What's the game about?", `<textarea id="sub-desc" maxlength="500" rows="3" placeholder="A sentence or two. What do you do in it?"></textarea>`)}
            <label class="random-check"><input type="checkbox" id="sub-ok"> The details above are true, and it's okay for GN 2.0 to host this game.</label>
            <p id="sub-error" class="submit-error" role="alert" hidden></p>
            <button type="submit" class="settings-button" id="sub-send">Send submission</button>
        </form>
        <div id="sub-mine" class="submit-mine"></div>`;
    const relInputs = body.querySelectorAll('input[name="sub-rel"]');
    const syncLicense = () => {
        const rel = body.querySelector('input[name="sub-rel"]:checked')?.value;
        document.getElementById("sub-license-wrap").hidden = rel !== "license";
    };
    relInputs.forEach(r => r.addEventListener("change", syncLicense));
    document.getElementById("submit-form").onsubmit = e => { e.preventDefault(); sendSubmission(); };
    document.getElementById("popupOverlay").style.display = "flex";
    renderMySubmissions();
}

function submissionError(msg) {
    const el = document.getElementById("sub-error");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
}

async function sendSubmission() {
    const val = id => (document.getElementById(id)?.value || "").trim();
    const name = val("sub-name"), url = val("sub-url"), author = val("sub-author");
    const relation = document.querySelector('input[name="sub-rel"]:checked')?.value || "mine";
    const license = relation === "license" ? val("sub-license") : "";
    if (!name) return submissionError("Please enter the game's name.");
    if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}/i.test(url)) return submissionError("Please enter a full link that starts with https://");
    if (!author) return submissionError("Please say who made the game.");
    if (relation === "license" && !license) return submissionError("Please say which license the game uses.");
    if (!document.getElementById("sub-ok").checked) return submissionError("Please tick the box to confirm.");
    submissionError("");
    const btn = document.getElementById("sub-send");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
        await cloudDb.collection("submissions").add({
            uid: cloudUser.uid,
            username: currentUsername().slice(0, 40),
            name: name.slice(0, 80),
            url: url.slice(0, 300),
            author: author.slice(0, 80),
            relation,
            license: license.slice(0, 80),
            genre: val("sub-genre").slice(0, 40),
            description: val("sub-desc").slice(0, 500),
            status: "pending",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        notify(`Thanks! "${name}" was sent for review.`, { type: "success" });
        document.getElementById("submit-form").reset();
        document.getElementById("sub-license-wrap").hidden = true;
        renderMySubmissions();
    } catch (e) {
        console.error(e);
        submissionError("Couldn't send it: " + (typeof statsErrorText === "function" ? statsErrorText(e) : e.message || e));
    } finally {
        btn.disabled = false;
        btn.textContent = "Send submission";
    }
}

function submissionTime(s) {
    const t = s.createdAt;
    const d = t && typeof t.toDate === "function" ? t.toDate() : (t ? new Date(t) : null);
    return d && !isNaN(d) ? d.toLocaleDateString() : "";
}

async function renderMySubmissions() {
    const box = document.getElementById("sub-mine");
    if (!box || !cloudUser) return;
    try {
        const snap = await cloudDb.collection("submissions").where("uid", "==", cloudUser.uid).get();
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!list.length) { box.innerHTML = ""; return; }
        list.sort((a, b) => (submissionTime(b) > submissionTime(a) ? 1 : -1));
        box.innerHTML = `<h4>Your submissions</h4>`;
        for (const s of list) {
            const row = document.createElement("div");
            row.className = "submit-row";
            const left = document.createElement("div");
            const b = document.createElement("b");
            b.textContent = s.name;
            const meta = document.createElement("small");
            meta.textContent = `${SUBMIT_STATUS[s.status] || s.status}${submissionTime(s) ? " · " + submissionTime(s) : ""}${s.note ? " · " + s.note : ""}`;
            left.append(b, meta);
            row.appendChild(left);
            if (s.status === "pending") {
                const del = document.createElement("button");
                del.type = "button";
                del.className = "finder-chip";
                del.textContent = "Withdraw";
                del.onclick = async () => {
                    if (!(await askConfirm(`Withdraw "${s.name}"?`, { confirmText: "Withdraw", danger: true }))) return;
                    try { await cloudDb.collection("submissions").doc(s.id).delete(); renderMySubmissions(); }
                    catch (e) { notify("Couldn't withdraw it. Try again in a moment.", { type: "error" }); }
                };
                row.appendChild(del);
            }
            box.appendChild(row);
        }
    } catch (e) {
        console.warn("Couldn't load your submissions", e);
    }
}

// ── Owner Panel: review submissions ─────────────────────────────────────────
// Reading needs an admin account: a document admins/<your account id> in
// Firestore, which can only be created from the Firebase console.
async function renderOwnerSubmissions() {
    const box = document.getElementById("owner-submissions");
    if (!box) return;
    if (typeof cloudUser === "undefined" || !cloudUser || !cloudDb) {
        box.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);font-size:13px;">Sign in to your admin account on this browser to see game submissions.</p>`;
        return;
    }
    box.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);font-size:13px;">Loading submissions…</p>`;
    let list;
    try {
        const snap = await cloudDb.collection("submissions").get();
        list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        const uid = escapeHtmlText(cloudUser.uid);
        box.innerHTML = `
            <p style="margin:0.25rem 0 0.5rem;font-size:13px;">This account (<b>${escapeHtmlText(currentUsername())}</b>) isn't a submissions admin yet. To make it one, once:</p>
            <ol style="margin:0 0 0.5rem 1.1rem;padding:0;font-size:13px;line-height:1.6;">
                <li>Open the Firebase console → <b>Firestore Database</b> → <b>Data</b>.</li>
                <li>Start a collection named <code>admins</code>.</li>
                <li>Use this as the Document ID: <code id="admin-uid">${uid}</code> <button type="button" class="finder-chip" onclick="navigator.clipboard?.writeText('${uid}').then(()=>notify('Copied'))">Copy</button></li>
                <li>Add any field (for example <code>name</code> = <code>${escapeHtmlText(currentUsername())}</code>) and save.</li>
                <li>Make sure the newest <code>config/firestore.rules</code> is published.</li>
            </ol>`;
        return;
    }
    if (!list.length) { box.innerHTML = `<p style="margin:0.25rem;color:var(--text-muted);font-size:13px;">No submissions yet.</p>`; return; }
    const order = { pending: 0, approved: 1, added: 2, rejected: 3 };
    list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (submissionTime(b) > submissionTime(a) ? 1 : -1));
    box.innerHTML = "";
    for (const s of list) {
        const row = document.createElement("div");
        row.className = "submit-review";
        const head = document.createElement("div");
        const b = document.createElement("b");
        b.textContent = s.name;
        const link = document.createElement("a");
        const safe = (() => { try { const u = new URL(s.url); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } })();
        if (safe) { link.href = safe; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = " ↗ open link"; }
        head.append(b, link);
        const info = document.createElement("small");
        info.textContent = `by ${s.author} · sent by ${s.username || "?"}${submissionTime(s) ? " on " + submissionTime(s) : ""} · ${SUBMIT_RELATIONS[s.relation] || s.relation}${s.license ? " (" + s.license + ")" : ""}${s.genre ? " · " + (GENRES.find(g => g.id === s.genre)?.label || s.genre) : ""}`;
        const desc = document.createElement("p");
        desc.textContent = s.description || "";
        const status = document.createElement("small");
        status.className = "submit-status";
        status.textContent = SUBMIT_STATUS[s.status] || s.status;
        const actions = document.createElement("div");
        actions.className = "submit-actions";
        const noteInput = document.createElement("input");
        noteInput.className = "submit-note";
        noteInput.maxLength = 200;
        noteInput.placeholder = "Note for the sender (optional, they'll see it)";
        noteInput.value = s.note || "";
        noteInput.setAttribute("aria-label", `Note for ${s.name}`);
        const setStatus = async st => {
            const note = noteInput.value.trim().slice(0, 200);
            try { await cloudDb.collection("submissions").doc(s.id).update({ status: st, note }); renderOwnerSubmissions(); }
            catch (e) { notify("Couldn't update it: " + (e.message || e), { type: "error" }); }
        };
        [["Approve", "approved"], ["Mark added", "added"], ["Reject", "rejected"]].forEach(([label, st]) => {
            if (s.status === st) return;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "finder-chip";
            btn.textContent = label;
            btn.onclick = () => setStatus(st);
            actions.appendChild(btn);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "finder-chip";
        del.textContent = "Delete";
        del.onclick = async () => {
            if (!(await askConfirm(`Delete the submission "${s.name}"?`, { confirmText: "Delete", danger: true }))) return;
            try { await cloudDb.collection("submissions").doc(s.id).delete(); renderOwnerSubmissions(); }
            catch (e) { notify("Couldn't delete it.", { type: "error" }); }
        };
        actions.appendChild(del);
        row.append(head, info);
        if (s.description) row.appendChild(desc);
        row.append(status, noteInput, actions);
        box.appendChild(row);
    }
}
