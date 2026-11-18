// Shows how an account is set up, to sort out sign-in problems: how it signs
// in (password, Google), whether its email is verified, its username claim and
// when its profile was last updated. Runs in GitHub Actions
// (.github/workflows/account-check.yml) with the FIREBASE_SERVICE_ACCOUNT key.
// The repo is public, so emails are shown partly hidden and nothing is changed.
//   USERNAME=bob node tools/account_check.mjs
import admin from "firebase-admin";
import fs from "fs";

const username = String(process.env.USERNAME || "").trim().toLowerCase();
if (!/^[a-z0-9_]{3,20}$/.test(username)) { console.log("Give a username (3-20 letters, numbers or _)."); process.exit(1); }
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

const mask = e => { if (!e) return "(none)"; const [a, d] = String(e).split("@"); return d === "gnmath.local" ? e : `${a.slice(0, 2)}***@${d}`; };
const show = u => {
    console.log(`  uid ${u.uid}`);
    console.log(`  sign-in email: ${mask(u.email)} · verified: ${u.emailVerified} · disabled: ${u.disabled}`);
    console.log(`  display name: ${u.displayName || "(none)"}`);
    console.log(`  ways to sign in: ${u.providerData.map(p => p.providerId + (p.email ? " (" + mask(p.email) + ")" : "")).join(", ") || "(none)"}`);
    console.log(`  created ${u.metadata.creationTime} · last sign-in ${u.metadata.lastSignInTime} · last active ${u.metadata.lastRefreshTime || "?"}`);
};

let legacy = null, claimed = null;
try { legacy = await admin.auth().getUserByEmail(`${username}@gnmath.local`); } catch {}
const nameDoc = await db.collection("usernames").doc(username).get();
console.log(`usernames/${username}: ${nameDoc.exists ? JSON.stringify({ uid: nameDoc.data().uid, e: nameDoc.data().e }) : "(not claimed)"}`);
if (nameDoc.exists) { try { claimed = await admin.auth().getUser(nameDoc.data().uid); } catch (e) { console.log("  that uid has no account: " + e.code); } }

console.log(`\nAccount signing in as ${username}@gnmath.local:`); legacy ? show(legacy) : console.log("  (none)");
if (claimed && (!legacy || claimed.uid !== legacy.uid)) { console.log("\nAccount that claimed the username:"); show(claimed); }

for (const u of [legacy, claimed].filter(Boolean)) {
    const p = await db.collection("profiles").doc(u.uid).get();
    const d = p.exists ? p.data() : null;
    console.log(`\nprofiles/${u.uid}: ` + (d ? `username ${d.username}, last seen ${d.lastSeen && d.lastSeen.toDate().toISOString()}, level ${d.level}` : "(none)"));
}
// Other accounts with the same display name (a second account made by Google sign-in)
const list = await admin.auth().listUsers(1000);
const same = list.users.filter(u => (u.displayName || "").toLowerCase() === username && u.uid !== legacy?.uid && u.uid !== claimed?.uid);
for (const u of same) { console.log(`\nAnother account named ${username}:`); show(u); }
const googleNoName = list.users.filter(u => u.providerData.some(p => p.providerId === "google.com") && !u.displayName);
if (googleNoName.length) console.log(`\n${googleNoName.length} Google account(s) with no username yet: ` + googleNoName.map(u => `${u.uid} (${mask(u.email)}, created ${u.metadata.creationTime})`).join("; "));
