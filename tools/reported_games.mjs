// Games players reported broken (👎 "Report broken"), read from the site's
// public gameStats documents in Firestore. Reports from before an admin marked
// a game fixed, and reports older than 14 days, don't count (same as the site).
//
//   node tools/reported_games.mjs          # prints the list
//   import { reportedGames } from "./reported_games.mjs"
import fs from "fs";

const PROJECT = "gn-math-dfd85", KEY = "AIzaSyCVUtHKcMZCs7aaCcO_Gp8fmy41MZnjqcs";
const SHARDS = 16, DAYS = 14;

// Firestore's REST format → plain values
function plain(v) {
    if (!v || typeof v !== "object") return v;
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(plain);
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("timestampValue" in v) return Date.parse(v.timestampValue);
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    return null;
}

export async function reportedGames() {
    const settings = JSON.parse(fs.readFileSync(new URL("../config/owner-settings.json", import.meta.url), "utf8"));
    const trusted = new Set((settings.trustedReporters || []).map(t => t.uid));
    const cutoff = Date.now() - DAYS * 86400000;
    const out = [];
    for (let i = 0; i < SHARDS; i++) {
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/gameStats/s${i}?key=${KEY}`);
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`gameStats/s${i}: HTTP ${res.status}`);
        const fields = (await res.json()).fields || {};
        for (const [zk, raw] of Object.entries(fields)) {
            const e = plain(raw) || {}, fixed = Number(e.fixed) || 0;
            const r = Object.entries(e.r || {}).filter(([, ms]) => ms > fixed && ms >= cutoff);
            if (!r.length) continue;
            out.push({ id: zk.slice(1), reports: r.length, trusted: r.some(([uid]) => trusted.has(uid)), last: new Date(Math.max(...r.map(([, ms]) => ms))).toISOString() });
        }
    }
    return out.sort((a, b) => b.reports - a.reports || (b.last > a.last ? 1 : -1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const list = await reportedGames();
    console.log(JSON.stringify(list, null, 1));
}
