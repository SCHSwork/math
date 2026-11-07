// Prints the site's automatic error reports (errorLogs) for a game, or for the
// last few hours. Runs in GitHub Actions (.github/workflows/error-reports.yml).
// The repo is public, so usernames are left out.
//   GAME=63 HOURS=24 node tools/error_reports.mjs
import admin from "firebase-admin";
import fs from "fs";

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
const game = String(process.env.GAME || "").trim();
const hours = Number(process.env.HOURS || 24) || 24;
const since = new Date(Date.now() - hours * 3600000);
const snap = await db.collection("errorLogs").where("lastAt", ">", since).get();
const rows = snap.docs.map(d => d.data()).filter(e => !game || String(e.gameId) === game || String(e.gameName || "").toLowerCase().includes(game.toLowerCase()))
    .sort((a, b) => b.lastAt.toMillis() - a.lastAt.toMillis());
console.log(`${rows.length} error report(s) in the last ${hours} h` + (game ? ` for "${game}"` : "") + ":");
for (const e of rows.slice(0, 60)) {
    const s = e.last || {};
    console.log(`\n[${e.lastAt.toDate().toISOString().slice(0, 16)}Z] x${e.count} ${e.source} · ${e.gameName || "site"} (${e.gameId || "-"}) · ${e.status}`);
    console.log(`  ${String(e.message).slice(0, 300)}`);
    if (e.where) console.log(`  at ${String(e.where).slice(0, 200)}`);
    if (s.detail) console.log(`  detail: ${String(s.detail).slice(0, 300)}`);
    console.log(`  ${s.browser || ""} · ${String(s.ua || "").slice(0, 140)} · screen ${s.screen || "?"} · memory ${s.memory || "?"} GB · site ${s.version || "?"} · ${s.secondsOnPage}s on page` + (s.blockedSources ? ` · blocked: ${s.blockedSources}` : ""));
}
