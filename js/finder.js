// ═════════════════════════════════════════════════════════════════════════════
// 1. Random game options: hold (or right-click) the 🎲 button to choose what
//    kind of game it picks. A normal click uses those options.
// 2. Game finder: describe what you want ("scary game for 2 players I haven't
//    played", "like Slope but not hard") and it suggests games, using each
//    game's genres, description and keywords plus your play history. It runs
//    entirely in the browser. No text is sent anywhere.
// Needs filters.js (genres) and library.js (play history, favorites).
// ═════════════════════════════════════════════════════════════════════════════
const RANDOM_SETTINGS_KEY = "gnmath-random-settings";
const RANDOM_DEFAULTS = { genre: "all", source: "all", unplayed: false, favorites: false, skipBroken: true, liked: false, useFilters: false };

function getRandomSettings() {
    try { return { ...RANDOM_DEFAULTS, ...(JSON.parse(localStorage.getItem(RANDOM_SETTINGS_KEY)) || {}) }; }
    catch { return { ...RANDOM_DEFAULTS }; }
}
function setRandomSettings(s) {
    try { localStorage.setItem(RANDOM_SETTINGS_KEY, JSON.stringify(s)); } catch {}
    updateRandomButtonTitle();
}
function randomSettingsChanged(s = getRandomSettings()) {
    return Object.keys(RANDOM_DEFAULTS).some(k => s[k] !== RANDOM_DEFAULTS[k]);
}
function randomPool(s = getRandomSettings()) {
    const currentId = zoneViewer.style.display === "flex" ? document.getElementById("zoneId").textContent : null;
    let pool = zones.filter(z => z.url && !z.url.startsWith("http") && !isZoneDisabled(z.id) && String(z.id) !== currentId);
    if (s.useFilters) {
        const tag = filterOptions.value;
        if (tag && tag !== "none") pool = pool.filter(z => z.special?.includes(tag));
        if (typeof gameMatchesExtraFilters === "function") pool = pool.filter(gameMatchesExtraFilters);
    }
    if (s.genre !== "all") pool = pool.filter(z => zoneGenres(z).has(s.genre));
    if (s.source !== "all") pool = pool.filter(z => zoneSource(z) === s.source);
    if (s.unplayed) pool = pool.filter(z => showMatches(z, "unplayed"));
    if (s.favorites) pool = pool.filter(z => showMatches(z, "favorites"));
    if (s.liked) pool = pool.filter(z => showMatches(z, "liked"));
    if (s.skipBroken) pool = pool.filter(z => showMatches(z, "working"));
    return pool;
}
// Replaces the simple version in app.js
function openRandomZone() {
    if (!Array.isArray(zones) || zones.length < 2) { notify("Games are still loading. Try again in a second."); return; }
    const s = getRandomSettings();
    const pool = randomPool(s);
    if (!pool.length) {
        notify(randomSettingsChanged(s) ? "No games match your random game options. Hold the 🎲 button to change them." : "No games to pick from right now.");
        return;
    }
    openZone(pool[Math.floor(Math.random() * pool.length)]);
}

function updateRandomButtonTitle() {
    const changed = randomSettingsChanged();
    document.querySelectorAll("#randomGame, .zone-controls [data-random]").forEach(b => {
        b.title = changed ? "Random game, using your options (hold for options)" : "Random game! (hold for options)";
        b.classList.toggle("has-options", changed);
    });
}

function openRandomSettings() {
    const s = getRandomSettings();
    document.getElementById("popupTitle").textContent = "Random game options";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    const genreOpts = GENRES.map(g => `<option value="${g.id}">${g.label}</option>`).join("");
    body.innerHTML = `
        <p style="margin:0 0 1rem;color:var(--text-muted);font-size:14px;">Choose what kind of game 🎲 picks. These are saved on this device.</p>
        <div class="random-grid">
            <label class="filter-field"><span>Genre</span><select id="rnd-genre"><option value="all">Any genre</option>${genreOpts}</select></label>
            <label class="filter-field"><span>Source</span><select id="rnd-source">
                <option value="all">Anywhere</option><option value="library">Main library</option>
                <option value="originals">GN Originals</option><option value="js13k">js13k tiny games</option></select></label>
        </div>
        <label class="random-check"><input type="checkbox" id="rnd-unplayed"> Only games I haven't played</label>
        <label class="random-check"><input type="checkbox" id="rnd-favorites"> Only my favorites</label>
        <label class="random-check"><input type="checkbox" id="rnd-liked"> Only well-liked games (80%+ 👍)</label>
        <label class="random-check"><input type="checkbox" id="rnd-skipBroken"> Skip games flagged broken</label>
        <label class="random-check"><input type="checkbox" id="rnd-useFilters"> Also use my Sort &amp; filter choices</label>
        <p id="rnd-count" style="margin:0.9rem 0;font-size:14px;font-weight:700;"></p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="settings-button" id="rnd-go" style="flex:1;">🎲 Pick a game</button>
            <button type="button" class="settings-button" id="rnd-reset" style="flex:0 0 auto;width:auto;background:var(--bg-secondary);color:var(--text);">Reset</button>
        </div>`;
    const ids = ["genre", "source"], checks = ["unplayed", "favorites", "liked", "skipBroken", "useFilters"];
    const read = () => {
        const out = {};
        ids.forEach(k => out[k] = document.getElementById("rnd-" + k).value);
        checks.forEach(k => out[k] = document.getElementById("rnd-" + k).checked);
        return out;
    };
    const fill = v => {
        ids.forEach(k => document.getElementById("rnd-" + k).value = v[k]);
        checks.forEach(k => document.getElementById("rnd-" + k).checked = !!v[k]);
    };
    const refresh = () => {
        const v = read();
        setRandomSettings(v);
        const n = randomPool(v).length;
        document.getElementById("rnd-count").textContent = n ? `${n.toLocaleString()} game${n === 1 ? "" : "s"} to pick from` : "No games match. Try fewer options.";
        document.getElementById("rnd-go").disabled = !n;
    };
    fill(s);
    body.querySelectorAll("select, input").forEach(el => el.addEventListener("change", refresh));
    document.getElementById("rnd-go").onclick = () => { closePopup(); openRandomZone(); };
    document.getElementById("rnd-reset").onclick = () => { fill(RANDOM_DEFAULTS); refresh(); };
    refresh();
    document.getElementById("popupOverlay").style.display = "flex";
}

// Hold (touch or mouse) or right-click the 🎲 button for options
function attachRandomHold(btn) {
    if (!btn || btn.dataset.holdReady) return;
    btn.dataset.holdReady = "1";
    let timer = null, held = false;
    const start = e => {
        if (e.button !== undefined && e.button !== 0) return;
        held = false;
        clearTimeout(timer);
        timer = setTimeout(() => {
            held = true;
            if (navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
            openRandomSettings();
        }, 500);
    };
    const cancel = () => clearTimeout(timer);
    btn.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, cancel));
    // A hold shouldn't also pick a game when the finger lifts
    btn.addEventListener("click", e => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
    btn.addEventListener("contextmenu", e => { e.preventDefault(); clearTimeout(timer); openRandomSettings(); });
    btn.setAttribute("aria-haspopup", "dialog");
}
function setupRandomButtons() {
    const viewerBtn = document.querySelector('.zone-controls button[onclick="openRandomZone()"]');
    if (viewerBtn) viewerBtn.dataset.random = "1";
    attachRandomHold(document.getElementById("randomGame"));
    attachRandomHold(viewerBtn);
    updateRandomButtonTitle();
}

// ── Game finder ─────────────────────────────────────────────────────────────
// Understands a description by matching it against what we know about every
// game (config/game-info.json: genres, a one-line description and keywords),
// plus your own play history. Runs entirely in the browser.

// Everyday words that point to a genre
const FINDER_WORDS = {
    horror: /\b(scary|spooky|creepy|horror|terrifying|jumpscares?|halloween|haunted|frightening|fnaf)\b/,
    racing: /\b(cars?|racing|race|races|driving|drive|drift|drifting|vehicles?|motorcycles?|motorbikes?|bikes?)\b/,
    shooter: /\b(guns?|shooting|shoot|shooter|shooters|fps|sniper)\b/,
    sports: /\b(sports?|soccer|football|basketball|golf|tennis|hockey|baseball|bowling|skate|skating|ski|skiing|volleyball|boxing)\b/,
    puzzle: /\b(puzzles?|brain|thinking|logic|tricky|riddles?|matching)\b/,
    idle: /\b(idle|clicker|clicking|afk|incremental|tycoon)\b/,
    music: /\b(music|rhythm|songs?|beats?|dance|dancing|fnf|friday night funkin)\b/,
    platformer: /\b(platformers?|platforming|jumping|parkour|obby|runner)\b/,
    action: /\b(action|fighting|fight|fighter|combat|ninja|swords?|brawl|beat em up)\b/,
    adventure: /\b(adventure|rpg|quest|explore|exploring|exploration|dungeons?|fantasy)\b/,
    arcade: /\b(arcade|classic|old school)\b/,
    cards: /\b(cards?|card games?|board games?|chess|checkers|solitaire|poker|uno|mahjong)\b/,
    learning: /\b(learn|learning|educational|math|typing|coding|code|programming)\b/,
    multi: /\b(2 ?players?|two players?|with (a |my )?(friend|friends|brother|sister|buddy)|multiplayer|together|versus|co-?op|against each other|same keyboard|split ?screen)\b/,
    retro: /\b(retro|emulat\w*|nintendo|gameboy|game boy|nes|snes|n64|playstation|psx|dos|flash games?|old games?)\b/,
    sandbox: /\b(sandbox|building|craft|crafting|creative|city builder|simulators?|simulation|farming|farm)\b/,
    strategy: /\b(strategy|strategic|tower defen[cs]e|defen[cs]e|tactics|tactical|rts)\b/
};
// Moods → genres they lean toward and keywords to look for
const FINDER_MOODS = [
    { re: /\b(chill|relax\w*|calm|cozy|peaceful|easy going|laid back|wholesome)\b/, genres: ["puzzle", "idle", "sandbox"], keys: ["relaxing", "cute", "casual"], avoid: ["horror"], label: "relaxing" },
    { re: /\b(hard|difficult|challeng\w*|rage|frustrating|skill)\b/, keys: ["hard", "difficult", "challenging", "rage"], label: "challenging" },
    { re: /\b(easy|simple|casual|for kids|little kids?)\b/, keys: ["easy", "casual", "simple", "cute"], avoid: ["horror"], label: "easy" },
    { re: /\b(funny|silly|goofy|hilarious|meme|lol|ragdoll)\b/, keys: ["funny", "silly", "ragdoll", "parody", "meme"], label: "funny" },
    { re: /\b(cute|adorable|kawaii)\b/, keys: ["cute"], label: "cute" },
    { re: /\b(story|story ?driven|narrative|plot)\b/, genres: ["adventure"], keys: ["story"], label: "story" },
    { re: /\b(fast|fast[- ]paced|intense|adrenaline|quick reflexes)\b/, genres: ["action", "arcade", "racing"], keys: ["fast", "reflexes"], label: "fast-paced" },
    { re: /\b(3d)\b/, keys: ["3d"], label: "3D" },
    { re: /\b(pixel|8 ?bit|16 ?bit)\b/, keys: ["pixel art", "retro style"], label: "pixel art" },
    { re: /\b(physics)\b/, keys: ["physics", "ragdoll"], label: "physics" }
];
const FINDER_STOP = new Set(("break short time bored boring fun funny friend friends free online best new old easy hard while during class lunch recess " +
    "a an the and or for to of in on at with without game games play playing want wanna like something some any me my i im that is are be can you " +
    "find give show recommend suggest good cool really very kind sort type thing stuff one ones please which what where who it this those these " +
    "there just get got lets let maybe should could would where not no nothing dont isnt but also more less much many lot lots kinda sorta looking " +
    "into about where when then than from up down out all im ill ive id its little big sister brother kid kids son daughter mom dad family " +
    "sport sports card cards board").split(" "));

const stem = w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function gameKeywords(z) {
    const info = getGameInfo(z.id);
    return (info && info.k) || [];
}
function gameText(z) {
    const info = getGameInfo(z.id);
    return normText([z.name, info?.d || "", ...(info?.k || [])].join(" "));
}
function genreLabel(id) { return GENRES.find(g => g.id === id)?.label || id; }

// What you usually play: genre weights from play time, recents and favorites
function playerTaste() {
    const w = {};
    const add = (z, amt) => { if (!z) return; for (const g of zoneGenres(z)) w[g] = (w[g] || 0) + amt; };
    const byId = id => zones.find(z => String(z.id) === String(id));
    if (typeof getRecent === "function") getRecent().slice(0, 15).forEach((id, i) => add(byId(id), 2 - i * 0.1));
    if (typeof getFavorites === "function") getFavorites().forEach(id => add(byId(id), 3));
    if (typeof getPlaytime === "function") zones.forEach(z => { const s = getPlaytime(z.id); if (s > 60) add(z, Math.min(6, Math.log10(s))); });
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    if (!total) return null;
    for (const k in w) w[k] /= total;
    return w;
}

function findZoneByName(text) {
    const t = normText(text);
    if (t.length < 3) return null;
    let best = null, bestScore = 0;
    for (const z of zones) {
        const n = normText(z.name);
        let s = n === t ? 1000 : n.startsWith(t) ? 500 - n.length : 0;
        if (!s) { const sc = searchScore(z, t, t.split(" ")); if (sc >= 35) s = sc; }
        if (s > bestScore) { bestScore = s; best = z; }
    }
    return best;
}

function parseFinderQuery(text) {
    let q = " " + String(text || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9.\- ]+/g, " ") + " ";
    const wants = { genres: new Set(), avoidGenres: new Set(), keys: [], avoidKeys: [], moods: [], unplayed: false, favorites: false,
        liked: false, popular: false, newest: false, short: false, source: null, similarTo: null, personal: false, two: false, words: [] };
    // Things you DON'T want: "not scary", "no shooters", "without guns", "nothing horror"
    q = q.replace(/\b(?:not|no|without|nothing|never|isnt|dont want|dont like|hate|except|avoid|but not|anything but)\s+(?:too\s+|very\s+|any\s+|a\s+)?([a-z0-9-]+(?:\s+[a-z0-9-]+)?)/g, (m, what) => {
        const s = " " + what + " ";
        let hit = false;
        for (const [id, re] of Object.entries(FINDER_WORDS)) if (re.test(s)) { wants.avoidGenres.add(id); hit = true; }
        if (!hit) what.split(" ").filter(w => w.length > 2 && !FINDER_STOP.has(w)).forEach(w => wants.avoidKeys.push(w));
        return " ";
    });
    if (/\b(havent played|have not played|never played|not played|new to me|unplayed|something new|havent tried)\b/.test(q)) wants.unplayed = true;
    q = q.replace(/\b(havent played|have not played|never played|new to me|havent tried)\b/g, " ");
    if (/\b(my favou?rites?|favou?rited|starred)\b/.test(q)) wants.favorites = true;
    if (/\b(well liked|highly rated|top rated|best rated|good reviews|people like)\b/.test(q)) wants.liked = true;
    if (/\b(popular|most played|trending|famous|best|top|everyone plays|hot|good)\b/.test(q)) wants.popular = true;
    if (/\b(newest|latest|recently added|just added|new games?)\b/.test(q) && !wants.unplayed) wants.newest = true;
    if (/\b(short|quick|tiny|small|few minutes|bite.?sized|13 ?k|js13k|quick break)\b/.test(q)) wants.short = true;
    if (/\b(for me|recommend|suggest|surprise me|what should i play|pick for me|i might like|id like|based on)\b/.test(q)) wants.personal = true;
    if (/\b(gn originals?|open.?source)\b/.test(q)) wants.source = "originals";
    if (/\bjs13k\b/.test(q)) wants.source = "js13k";
    // "like Geometry Dash" / "similar to Celeste" / "games like slope"
    const m = q.match(/\b(?:like|similar to|same as|kinda like|such as)\s+(.+?)(?=\s+(?:but|that|which|and|with|for|i|to)\b|$)/);
    if (m) {
        const hit = findZoneByName(m[1]);
        if (hit) { wants.similarTo = hit; q = q.replace(m[0], " "); }
    }
    for (const [id, re] of Object.entries(FINDER_WORDS)) if (re.test(q)) wants.genres.add(id);
    if (wants.genres.has("multi")) wants.two = true;
    for (const mood of FINDER_MOODS) if (mood.re.test(q)) {
        wants.moods.push(mood);
        (mood.keys || []).forEach(k => wants.keys.push(k));
        (mood.avoid || []).forEach(g => wants.avoidGenres.add(g));
    }
    wants.avoidGenres.forEach(g => wants.genres.delete(g));
    // Leftover words are themes or names: "zombies", "cats", "space", "minecraft"
    // (sport and board-game words stay as themes too, so "soccer" finds soccer games first)
    const used = new RegExp(Object.entries(FINDER_WORDS).filter(([id]) => id !== "sports" && id !== "cards").map(([, r]) => r.source).concat(FINDER_MOODS.map(m => m.re.source)).join("|"), "g");
    wants.words = normText(q.replace(used, " ")).split(" ").filter(w => w.length > 2 && !FINDER_STOP.has(w) &&
        !/^(played|never|liked|rated|popular|newest|latest|quick|tiny|small|minutes|people|everyone|favorites?|similar|something|recommend|suggest|surprise)$/.test(w));
    return wants;
}

function scoreGame(z, wants, ctx) {
    const g = zoneGenres(z);
    const info = getGameInfo(z.id);
    const reasons = [];
    let score = 0;
    for (const a of wants.avoidGenres) if (g.has(a)) return null;
    if (wants.avoidKeys.length) {
        const t = gameText(z).split(" ").map(stem);
        if (wants.avoidKeys.some(k => t.includes(stem(k)))) return null;
    }
    if (wants.genres.size) {
        const matched = [...wants.genres].filter(id => g.has(id) || (id === "multi" && info?.p === 2));
        if (!matched.length) return null;
        score += 30 * matched.length + (matched.length === wants.genres.size && wants.genres.size > 1 ? 30 : 0);
        matched.forEach(id => reasons.push(genreLabel(id)));
    }
    if (wants.similarTo) {
        const sg = ctx.simGenres, sk = ctx.simKeys;
        const sharedG = [...sg].filter(id => g.has(id)).length;
        const myKeys = gameKeywords(z).map(stem);
        const sharedK = myKeys.filter(k => sk.has(k));
        const sameSeries = ctx.simFirst && normText(z.name).split(" ")[0] === ctx.simFirst;
        if (!sharedG && !sharedK.length && !sameSeries) return null;
        score += 14 * sharedG + 12 * sharedK.length + (sameSeries ? 10 : 0);
        reasons.push(sharedK.length ? `Like ${wants.similarTo.name} (${sharedK.slice(0, 2).join(", ")})` : `Like ${wants.similarTo.name}`);
    }
    if (wants.words.length) {
        const name = normText(z.name), nameWords = name.split(" ").map(stem);
        const keys = gameKeywords(z).flatMap(k => normText(k).split(" ")).map(stem);
        const desc = normText(info?.d || "").split(" ").map(stem);
        let hits = 0;
        for (const w0 of wants.words) {
            const w = stem(w0);
            if (nameWords.includes(w) || (w.length >= 4 && name.includes(w))) { score += 28; hits++; reasons.push("Name matches"); }
            else if (keys.includes(w)) { score += 24; hits++; reasons.push(`Has ${w0}`); }
            else if (desc.includes(w)) { score += 14; hits++; reasons.push(`Has ${w0}`); }
        }
        if (!hits) {
            const fuzzy = searchScore(z, wants.words.join(" "), wants.words);
            if (fuzzy > 0) { score += 10 + Math.min(fuzzy, 30); hits++; reasons.push("Name matches"); }
        }
        if (!hits && !wants.genres.size && !wants.similarTo) return null;
        if (!hits) score -= 10;
    }
    if (wants.keys.length) {
        const keys = gameKeywords(z).map(k => k.toLowerCase());
        const d = (info?.d || "").toLowerCase();
        const hit = wants.keys.filter(k => keys.includes(k) || d.includes(k));
        if (hit.length) { score += 16 * hit.length; wants.moods.forEach(m => { if ((m.keys || []).some(k => hit.includes(k))) reasons.push(m.label[0].toUpperCase() + m.label.slice(1)); }); }
        const moodGenres = wants.moods.flatMap(m => m.genres || []);
        if (moodGenres.some(x => g.has(x))) score += 12;
        if (!hit.length && !moodGenres.some(x => g.has(x)) && !wants.genres.size && !wants.words.length && !wants.similarTo) return null;
    }
    if (wants.two) { if (info?.p === 2) { score += 15; if (!reasons.includes(genreLabel("multi"))) reasons.push("2 player"); } }
    if (wants.short && zoneSource(z) === "js13k") { score += 20; reasons.push("Quick to play"); }
    if (ctx.taste && (wants.personal || ctx.onlyPersonal)) {
        let t = 0; for (const x of g) t += ctx.taste[x] || 0;
        if (t > 0) { score += 60 * t; const top = [...g].sort((a, b) => (ctx.taste[b] || 0) - (ctx.taste[a] || 0))[0]; reasons.push(`You like ${genreLabel(top).toLowerCase()}`); }
    }
    const p = ctx.plays(z.id) / ctx.maxPlays;
    score += (wants.popular ? 45 : 12) * Math.sqrt(p);
    if (wants.popular && p > 0.05) reasons.push("Popular");
    if (wants.newest && zoneSource(z) === "library") score += 30 * (Number(z.id) / ctx.maxLibId);
    const st = getZoneStats(z.id), votes = st.up + st.down;
    if (votes >= 3) score += 12 * (st.up / votes);
    if (info?.d) score += 4;                       // known games first when it's close
    if (typeof isFlaggedBroken === "function" && isFlaggedBroken(z.id)) score -= 50;
    if (wants.unplayed) reasons.push("New to you");
    if (wants.liked) reasons.push("Well liked");
    return { z, score: score + ctx.jitter(z.id), reasons: [...new Set(reasons)] };
}

function findGames(text, limit = 40) {
    const wants = parseFinderQuery(text);
    const plays = id => (popularityData?.year?.[id]) ?? 0;
    const lib = zones.filter(z => zoneSource(z) === "library");
    const seed = Math.floor(Math.random() * 1e9);
    const ctx = {
        plays, maxPlays: Math.max(1, ...zones.map(z => plays(z.id))), maxLibId: Math.max(1, ...lib.map(z => Number(z.id))),
        taste: playerTaste(),
        onlyPersonal: false,
        jitter: id => (((Number(id) * 2654435761 + seed) >>> 0) % 1000) / 1000 * 6
    };
    const empty = !wants.genres.size && !wants.words.length && !wants.similarTo && !wants.keys.length && !wants.avoidGenres.size && !wants.avoidKeys.length;
    if (empty) { ctx.onlyPersonal = true; if (!wants.popular && !wants.newest && !ctx.taste) wants.popular = true; }
    if (wants.personal && !ctx.taste && !wants.popular) wants.popular = true;
    if (wants.similarTo) {
        ctx.simGenres = zoneGenres(wants.similarTo);
        ctx.simKeys = new Set(gameKeywords(wants.similarTo).map(stem));
        ctx.simFirst = normText(wants.similarTo.name).split(" ")[0];
        if (ctx.simFirst.length < 4) ctx.simFirst = null;
    }
    const playedRecently = new Set(typeof getRecent === "function" ? getRecent().slice(0, 5) : []);
    const scored = [];
    for (const z of zones) {
        if (!z.url || z.url.startsWith("http") || isZoneDisabled(z.id)) continue;
        if (wants.similarTo && z === wants.similarTo) continue;
        if (wants.unplayed && !showMatches(z, "unplayed")) continue;
        if (wants.favorites && !showMatches(z, "favorites")) continue;
        if (wants.liked && !showMatches(z, "liked")) continue;
        if (wants.source && zoneSource(z) !== wants.source) continue;
        if ((wants.personal || empty) && playedRecently.has(String(z.id))) continue;   // suggest something you haven't just played
        const r = scoreGame(z, wants, ctx);
        if (r) scored.push(r);
    }
    scored.sort((a, b) => b.score - a.score);
    return { wants, results: scored.slice(0, limit), total: scored.length };
}

function describeWants(w) {
    const bits = [];
    if (w.genres.size) bits.push([...w.genres].map(id => genreLabel(id).toLowerCase()).join(" + "));
    w.moods.forEach(m => bits.push(m.label));
    if (w.similarTo) bits.push(`like ${w.similarTo.name}`);
    if (w.words.length) bits.push(`with “${w.words.join(" ")}”`);
    if (w.avoidGenres.size || w.avoidKeys.length) bits.push("no " + [...[...w.avoidGenres].map(id => genreLabel(id).toLowerCase()), ...w.avoidKeys].join(", no "));
    if (w.short) bits.push("quick to play");
    if (w.unplayed) bits.push("you haven't played");
    if (w.favorites) bits.push("from your favorites");
    if (w.liked) bits.push("well liked");
    if (w.personal) bits.push("based on what you play");
    if (w.popular) bits.push("popular first");
    if (w.newest) bits.push("newest first");
    if (w.source) bits.push(w.source === "js13k" ? "js13k games" : "GN Originals");
    return bits.length ? "Looking for: " + bits.join(" · ") : "";
}

const FINDER_EXAMPLES = ["scary game I haven't played", "racing with a friend", "games like Slope", "chill puzzle, nothing scary",
    "zombies", "funny 2 player games", "something for me", "hard platformer", "cats", "space shooter"];
const FINDER_REFINE = [["Not played yet", "I haven't played"], ["2 player", "2 player"], ["Quick", "quick"], ["Popular", "popular"], ["Relaxing", "relaxing"], ["No horror", "not scary"]];
const FINDER_PAGE = 8;

function finderRow(z, reasons) {
    const info = getGameInfo(z.id);
    const row = document.createElement("div");
    row.className = "finder-row";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    setCoverImage(img, z.cover, false);
    const text = document.createElement("div");
    text.className = "finder-text";
    const name = document.createElement("b");
    name.textContent = z.name;
    text.appendChild(name);
    if (info?.d) {
        const d = document.createElement("span");
        d.className = "finder-desc";
        d.textContent = info.d;
        text.appendChild(d);
    }
    const why = document.createElement("span");
    why.className = "finder-why";
    why.textContent = reasons.slice(0, 3).join(" · ");
    if (why.textContent) text.appendChild(why);
    const actions = document.createElement("div");
    actions.className = "finder-actions";
    const sim = document.createElement("button");
    sim.type = "button";
    sim.className = "finder-more";
    sim.textContent = "More like this";
    sim.onclick = e => { e.stopPropagation(); finderSearch(`like ${z.name}`); };
    const play = document.createElement("button");
    play.type = "button";
    play.className = "finder-play";
    play.textContent = "Play";
    play.onclick = e => { e.stopPropagation(); closePopup(); openZone(z); };
    actions.append(play, sim);
    row.append(img, text, actions);
    row.tabIndex = 0;
    row.onclick = () => { closePopup(); openZone(z); };
    row.onkeydown = e => { if (e.key === "Enter" && e.target === row) { closePopup(); openZone(z); } };
    return row;
}

let finderState = null;
function finderSearch(text) {
    const input = document.getElementById("finder-input");
    if (!input) return;
    input.value = text;
    const out = document.getElementById("finder-results");
    const said = document.getElementById("finder-understood");
    const refine = document.getElementById("finder-refine");
    const t = text.trim();
    const { wants, results, total } = findGames(t || "for me");
    finderState = { results, shown: 0 };
    said.textContent = t ? describeWants(wants) : (playerTaste() ? "Picked for you, based on what you play" : "Popular right now");
    out.innerHTML = "";
    refine.hidden = !t;
    const ex = document.getElementById("finder-examples");
    if (ex) ex.hidden = !!t;
    if (t) try {
        const hist = JSON.parse(localStorage.getItem("gnmath-finder-history") || "[]").filter(x => x !== t);
        localStorage.setItem("gnmath-finder-history", JSON.stringify([t, ...hist].slice(0, 6)));
    } catch {}
    if (!results.length) {
        out.innerHTML = `<p style="color:var(--text-muted);margin:0.5rem 0;">No games fit all of that. Try fewer wishes or different words.</p>`;
        return;
    }
    showMoreFinder(total);
}
function showMoreFinder(total) {
    const out = document.getElementById("finder-results");
    if (!finderState || !out) return;
    document.getElementById("finder-more-btn")?.remove();
    const next = finderState.results.slice(finderState.shown, finderState.shown + FINDER_PAGE);
    next.forEach(({ z, reasons }) => out.appendChild(finderRow(z, reasons)));
    finderState.shown += next.length;
    if (finderState.shown < finderState.results.length) {
        const more = document.createElement("button");
        more.type = "button";
        more.id = "finder-more-btn";
        more.className = "finder-chip finder-show-more";
        more.textContent = `Show more (${Math.min(finderState.results.length, total || finderState.results.length) - finderState.shown} more)`;
        more.onclick = () => showMoreFinder(total);
        out.appendChild(more);
    }
}

function openGameFinder(prefill) {
    document.getElementById("popupTitle").textContent = "✨ Find me a game";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem("gnmath-finder-history") || "[]"); } catch {}
    const chips = [...new Set([...hist.slice(0, 3), ...FINDER_EXAMPLES])].slice(0, 10);
    body.innerHTML = `
        <form id="finder-form" class="finder-form" autocomplete="off">
            <input type="search" id="finder-input" name="gn-finder" placeholder="e.g. funny 2 player game, nothing scary" aria-label="Describe what you feel like playing" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
            <button type="submit" class="settings-button" style="width:auto;">Find</button>
        </form>
        <div class="finder-chips finder-examples" id="finder-examples">${chips.map(e => `<button type="button" class="finder-chip${hist.includes(e) ? " recent" : ""}">${escapeHtmlText(e)}</button>`).join("")}</div>
        <div id="finder-refine" class="finder-chips finder-refine" hidden><span>Narrow it down:</span>${FINDER_REFINE.map(([label, add]) => `<button type="button" class="finder-chip" data-add="${escapeHtmlText(add)}">+ ${escapeHtmlText(label)}</button>`).join("")}</div>
        <p id="finder-understood" class="finder-understood" aria-live="polite"></p>
        <div id="finder-results" class="finder-results"></div>
        <p style="margin:0.75rem 0 0;color:var(--text-muted);font-size:12px;">Try genres, moods ("chill", "funny", "hard"), themes ("zombies", "space"), "like &lt;game&gt;", "with a friend", or what you don't want ("nothing scary"). It works in your browser, and nothing you type is sent anywhere.</p>`;
    const input = document.getElementById("finder-input");
    document.getElementById("finder-form").onsubmit = e => { e.preventDefault(); finderSearch(input.value); };
    input.addEventListener("input", () => { if (!input.value.trim()) { const ex = document.getElementById("finder-examples"); if (ex) ex.hidden = false; } });
    body.querySelectorAll(".finder-examples .finder-chip").forEach(c => c.onclick = () => finderSearch(c.textContent));
    body.querySelectorAll(".finder-refine .finder-chip").forEach(c => c.onclick = () => {
        const add = c.dataset.add;
        if (!normText(input.value).includes(normText(add))) finderSearch((input.value.trim() + ", " + add).replace(/^, /, ""));
    });
    document.getElementById("popupOverlay").style.display = "flex";
    const start = () => finderSearch(prefill || "");
    if (typeof gameInfoReady !== "undefined") gameInfoReady.then(start); else start();
    setTimeout(() => input.focus(), 30);
}

// Long, sentence-like searches get a nudge toward the finder
function maybeSuggestFinder() {
    const v = searchBar.value.trim();
    let hint = document.getElementById("finderHint");
    const sentence = v.split(/\s+/).length >= 4;
    if (!sentence) { if (hint) hint.hidden = true; return; }
    if (!hint) {
        hint = document.createElement("button");
        hint.type = "button";
        hint.id = "finderHint";
        hint.className = "finder-hint";
        hint.onclick = () => { const t = searchBar.value; searchBar.value = ""; applyFilters(); openGameFinder(t); hint.hidden = true; };
        const main = document.querySelector("main");
        main.insertBefore(hint, main.firstChild);
    }
    hint.textContent = `✨ Ask the game finder: “${v.length > 60 ? v.slice(0, 57) + "…" : v}”`;
    hint.hidden = false;
}

(function setupFinder() {
    const go = () => {
        setupRandomButtons();
        searchBar.addEventListener("input", maybeSuggestFinder);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
