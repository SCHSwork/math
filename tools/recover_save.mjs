// Looks for a player's lost cloud save and can put it back.
// Runs in GitHub Actions (.github/workflows/recover-save.yml) with the
// FIREBASE_SERVICE_ACCOUNT key, so nobody has to open Firebase.
//
// The repo is public, so its Actions logs are too: this prints only levels,
// play time, dates and sizes, never the save's contents.
//
//   USERNAME=bob node tools/recover_save.mjs              # look
//   USERNAME=bob RESTORE=<gen> node tools/recover_save.mjs  # make that save his cloud save again
//   USERNAME=bob GRANT_LEVEL=9 GRANT_HOURS=5 node tools/recover_save.mjs  # give back level and play time
//
// Where an old save can still be:
//  1. Leftover pieces in saves/{uid}/chunks whose name isn't the current save's
//     (the site deleted old pieces after a new save, without checking it worked)
//  2. Firebase's own history: every document as it was in the last hour
//     (longer only if point-in-time recovery is turned on)
import admin from "firebase-admin";
import zlib from "zlib";
import fs from "fs";

const username = String(process.env.USERNAME || "").trim().toLowerCase();
const restore = String(process.env.RESTORE || "").trim();
if (!/^[a-z0-9_]{3,20}$/.test(username)) { console.log("Give a username (3-20 letters, numbers or _)."); process.exit(1); }

// The key pasted into GitHub can have real line breaks inside its private key,
// which isn't valid JSON, so read the three fields it needs either way.
const keyText = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
let key;
try { key = JSON.parse(keyText); }
catch {
    const field = name => { const m = new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(keyText); return m ? m[1] : ""; };
    key = { project_id: field("project_id"), client_email: field("client_email"), private_key: field("private_key") };
}
key.private_key = String(key.private_key || "").replace(/\\n/g, "\n");
admin.initializeApp({ credential: admin.credential.cert({ projectId: key.project_id, clientEmail: key.client_email, privateKey: key.private_key }) });
const db = admin.firestore();

let user;
try { user = await admin.auth().getUserByEmail(`${username}@gnmath.local`); }
catch (e) { console.log(`No account called "${username}".`); process.exit(1); }
const uid = user.uid;
console.log(`Account "${username}" (created ${user.metadata.creationTime}, last signed in ${user.metadata.lastSignInTime})`);

const metaRef = db.collection("saves").doc(uid);
const chunksRef = metaRef.collection("chunks");

function when(ts) { return ts && ts.toDate ? ts.toDate().toISOString().replace("T", " ").slice(0, 16) + " UTC" : "?"; }
// Level and play time from a save's contents
function summarize(bundle) {
    const ls = (bundle && bundle.localStorage) || {};
    let playSec = 0, level = 0, favorites = 0, games = 0;
    try { const p = JSON.parse(ls["gnmath-playtime"] || "{}"); for (const v of Object.values(p)) { playSec += Number(v) || 0; games++; } } catch {}
    try { level = JSON.parse(ls["gnmath-achievements"] || "{}").level || 0; } catch {}
    try { favorites = (JSON.parse(ls["gnmath-favorites"] || "[]") || []).length; } catch {}
    return `level ${level || "?"}, ${(playSec / 3600).toFixed(1)} h played over ${games} games, ${favorites} favorites, ${Object.keys(ls).length} saved items, ${(bundle.indexedDB || []).length} game databases`;
}
function decode(packed) {
    const bytes = Buffer.from(packed.slice(1), "base64");
    return JSON.parse(packed[0] === "g" ? zlib.gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"));
}
// Joins a save's pieces; null if any are missing
function join(docsById, gen, count) {
    const parts = [];
    for (let i = 0; i < count; i++) {
        const d = docsById.get(`${gen}_${i}`);
        if (!d) return null;
        parts.push(d.d);
    }
    return parts.join("");
}

async function look(label, readTime) {
    const get = ref => readTime ? db.runTransaction(t => t.get(ref), { readOnly: true, readTime }) : ref.get();
    const metaSnap = await get(metaRef);
    const meta = metaSnap.exists ? metaSnap.data() : null;
    const chunkSnap = await get(chunksRef);
    const docs = new Map(chunkSnap.docs.map(d => [d.id, d.data()]));
    const gens = new Map();
    for (const id of docs.keys()) { const g = id.replace(/_\d+$/, ""); gens.set(g, (gens.get(g) || 0) + 1); }
    console.log(`\n== ${label}`);
    if (!meta) { console.log("No cloud save."); return { meta, docs, gens }; }
    console.log(`Current save ${meta.gen}, saved ${when(meta.updatedAt)}, ${meta.chunkCount} piece(s)` + (meta.kept && meta.kept.length ? `; earlier saves kept: ${meta.kept.map(k => k.gen).join(", ")}` : ""));
    for (const [g, n] of gens) {
        const isCur = g === meta.gen;
        const count = isCur ? meta.chunkCount : n;
        const packed = join(docs, g, count);
        let s = "pieces missing, can't be read";
        if (packed) { try { s = summarize(decode(packed)); } catch (e) { s = "couldn't be read: " + e.message; } }
        console.log(`  ${isCur ? "current " : "LEFTOVER"} ${g}: ${n} piece(s) · ${s}`);
    }
    return { meta, docs, gens };
}

const now = await look("Now");

// Give back lost progress: the site adds it on top of what they have when they
// next open it signed in (applyGrant in js/achievements.js)
const grantLevel = Number(process.env.GRANT_LEVEL || 0), grantHours = Number(process.env.GRANT_HOURS || 0);
if (grantLevel > 0 || grantHours > 0) {
    if (!now.meta) { console.log("\nNo cloud save yet, so there's nowhere to put the grant. They need to sign in once first."); process.exit(1); }
    const grant = { id: "g" + Date.now().toString(36), level: Math.floor(grantLevel), playSec: Math.round(grantHours * 3600), note: String(process.env.GRANT_NOTE || "").slice(0, 200) };
    await metaRef.set({ grant }, { merge: true });
    console.log(`\nGrant ready: level ${grant.level || "unchanged"}, ${grantHours} h of play time.`);
    console.log(`It's added on top of their progress the next time ${username} opens the site signed in.`);
    process.exit(0);
}

if (restore) {
    let n = now.gens.get(restore), docs = now.docs, fromHistory = false;
    if (!n) {
        // Not there anymore: look in Firebase's history and write its pieces back
        for (const minutesAgo of [59, 45, 30, 15, 5]) {
            const t = new Date(Date.now() - minutesAgo * 60000); t.setSeconds(0, 0);
            try {
                const snap = await db.runTransaction(tx => tx.get(chunksRef), { readOnly: true, readTime: admin.firestore.Timestamp.fromDate(t) });
                const found = snap.docs.filter(d => d.id.startsWith(restore + "_"));
                if (found.length) { docs = new Map(found.map(d => [d.id, d.data()])); n = found.length; fromHistory = true; break; }
            } catch (e) {}
        }
        if (!n) { console.log(`\nThere's no save ${restore} to restore, now or in Firebase's history.`); process.exit(1); }
    }
    const packed = join(docs, restore, n);
    if (packed && fromHistory) {
        for (const [id, d] of docs) await chunksRef.doc(id).set(d);
        console.log(`\nWrote ${n} piece(s) of ${restore} back from Firebase's history.`);
    }
    if (!packed) { console.log(`\nSave ${restore} is missing pieces, so it can't be restored.`); process.exit(1); }
    const bundle = decode(packed);
    // Same fingerprint the site uses, so it recognizes the save
    const hash = (await import("crypto")).createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
    const cur = now.meta;
    await metaRef.set({
        gen: restore, chunkCount: n, hash, size: packed.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        kept: [...(cur && cur.gen ? [{ gen: cur.gen, chunkCount: cur.chunkCount || 0, sum: cur.sum || null, at: cur.updatedAt ? cur.updatedAt.toMillis() : Date.now(), until: Date.now() + 7 * 86400000 }] : []), ...((cur && cur.kept) || []).filter(k => k.gen !== restore)].slice(0, 6)
    });
    console.log(`\nRestored: ${restore} is ${username}'s cloud save again (${summarize(bundle)}).`);
    console.log("The save it replaced is kept for 7 days (Account → Earlier cloud saves).");
    console.log(`Tell ${username}: open the site, Account → Load cloud save. Don't press Save now first.`);
    process.exit(0);
}

// Firebase's history: as far back as it allows, in steps
for (const minutesAgo of [55, 30, 10]) {
    const t = new Date(Date.now() - minutesAgo * 60000);
    t.setSeconds(0, 0);
    try { await look(`${minutesAgo} minutes ago (Firebase history)`, admin.firestore.Timestamp.fromDate(t)); }
    catch (e) { console.log(`\n== ${minutesAgo} minutes ago: Firebase history not available (${e.message.split("\n")[0]})`); }
}
console.log("\nA LEFTOVER save with his old level can be put back: run this again with restore set to its name.");
