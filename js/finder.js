// ═════════════════════════════════════════════════════════════════════════════
// 1. Random game options: hold (or right-click) the 🎲 button to choose what
//    kind of game it picks. A normal click uses those options.
// 2. Game finder: describe what you want ("scary game for 2 players I haven't
//    played") and it suggests games. It runs entirely in the browser: it reads
//    your words for genres, moods and wishes, then ranks the library. No text
//    is sent anywhere.
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
// Everyday words that point to a genre, on top of each genre's own keywords
const FINDER_WORDS = {
    horror: /\b(scary|spooky|creepy|horror|terrifying|jumpscares?|halloween|haunted|frightening)\b/,
    racing: /\b(cars?|racing|race|driving|drive|drift|vehicles?|motorcycles?|bikes?|fast)\b/,
    shooter: /\b(guns?|shooting|shoot|shooter|fps|war|battle|army|sniper|blast)\b/,
    sports: /\b(sports?|soccer|football|basketball|golf|tennis|hockey|baseball|bowling|skate|skating|ski)\b/,
    puzzle: /\b(puzzles?|brain|think|thinking|logic|smart|tricky|relax|relaxing|chill|calm|matching)\b/,
    idle: /\b(idle|clicker|click|afk|incremental|tycoon|money|business)\b/,
    music: /\b(music|rhythm|songs?|beat|dance|dancing|fnf|friday night)\b/,
    platformer: /\b(platformers?|jumping|jump|parkour|running|runner|obstacle|obby)\b/,
    action: /\b(action|fighting|fight|fighter|combat|ninja|swords?|stickman|brawl)\b/,
    adventure: /\b(adventure|story|rpg|quest|explore|exploring|exploration|dungeon|fantasy)\b/,
    arcade: /\b(arcade|classic|old school|simple|snake|pong|breakout)\b/,
    cards: /\b(cards?|board games?|chess|checkers|solitaire|poker|uno|mahjong)\b/,
    learning: /\b(learn|learning|educational|school|math|typing|coding|code|programming)\b/,
    multi: /\b(2 ?players?|two players?|with (a |my )?friends?|multiplayer|together|versus|co-?op|against each other|same keyboard)\b/,
    retro: /\b(retro|emulat|nintendo|gameboy|game boy|nes|snes|n64|ds|playstation|psx|dos|flash)\b/,
    sandbox: /\b(sandbox|build|building|craft|crafting|create|creative|city|simulator|simulation|farm|farming)\b/,
    strategy: /\b(strategy|strategic|tower defen[cs]e|defen[cs]e|tactics|plan|planning|empire)\b/
};
const FINDER_STOP = new Set("break short time bored boring fun funny friend friends free online best new old easy hard while during class lunch recess a an the and or for to of in on at with game games play playing want wanna like something some any me my i im i'm that is are be can you find give show recommend suggest good fun cool really very kind sort type thing stuff one ones please which what where who it this those these there just get got".split(" "));

function parseFinderQuery(text) {
    const q = " " + String(text || "").toLowerCase().replace(/[’']/g, "") + " ";
    const wants = { genres: new Set(), unplayed: false, favorites: false, liked: false, popular: false, newest: false, short: false, threeD: false, source: null, similarTo: null, words: [] };
    for (const [id, re] of Object.entries(FINDER_WORDS)) if (re.test(q)) wants.genres.add(id);
    for (const g of GENRES) if (g.re.test(q)) wants.genres.add(g.id);
    if (/\b(havent played|have not played|never played|not played|new to me|unplayed|something new|i havent tried|havent tried)\b/.test(q)) wants.unplayed = true;
    if (/\b(my favou?rites?|favou?rited|starred)\b/.test(q)) wants.favorites = true;
    if (/\b(well liked|highly rated|top rated|best rated|liked|good reviews|people like)\b/.test(q)) wants.liked = true;
    if (/\b(popular|most played|trending|famous|best|top|everyone plays|hot)\b/.test(q)) wants.popular = true;
    if (/\b(newest|latest|recently added|just added|new games?)\b/.test(q) && !wants.unplayed) wants.newest = true;
    if (/\b(short|quick|tiny|small|few minutes|fast to play|bite.?sized|13 ?k|js13k)\b/.test(q)) wants.short = true;
    if (/\b3d\b/.test(q)) wants.threeD = true;
    if (/\b(gn originals?|open.?source)\b/.test(q)) wants.source = "originals";
    if (/\bjs13k\b/.test(q)) wants.source = "js13k";
    // "like Geometry Dash" / "similar to Celeste"
    const m = q.match(/\b(?:like|similar to|games like|something like)\s+(.+?)(?:\s+(?:but|that|which|and|with|for)\b|[,.!?]|$)/);
    if (m) {
        const target = normText(m[1]);
        const hit = target.length >= 3 && zones.find(z => normText(z.name) === target) || zones.find(z => target.length >= 4 && normText(z.name).startsWith(target));
        if (hit) wants.similarTo = hit;
    }
    // Leftover words become a name search ("minecraft", "zombie", "sonic")
    const genreWords = new Set(Object.values(FINDER_WORDS).flatMap(re => (q.match(new RegExp(re.source, "g")) || []).map(w => w.trim())));
    wants.words = normText(q).split(" ").filter(w => w.length > 2 && !FINDER_STOP.has(w) && !genreWords.has(w) &&
        !/^(havent|played|never|liked|rated|popular|newest|latest|short|quick|tiny|small|minutes|friends?|players?|people|everyone|favorites?|similar|something|ones?)$/.test(w));
    if (wants.similarTo) {
        const sim = normText(wants.similarTo.name).split(" ");
        wants.words = wants.words.filter(w => !sim.includes(w));
    }
    return wants;
}

function findGames(text, limit = 12) {
    const wants = parseFinderQuery(text);
    const plays = id => (popularityData?.year?.[id]) ?? 0;
    const maxPlays = Math.max(1, ...zones.map(z => plays(z.id)));
    const simGenres = wants.similarTo ? zoneGenres(wants.similarTo) : null;
    const scored = [];
    for (const z of zones) {
        if (!z.url || z.url.startsWith("http") || isZoneDisabled(z.id)) continue;
        if (wants.similarTo && z === wants.similarTo) continue;
        if (wants.unplayed && !showMatches(z, "unplayed")) continue;
        if (wants.favorites && !showMatches(z, "favorites")) continue;
        if (wants.liked && !showMatches(z, "liked")) continue;
        if (wants.source && zoneSource(z) !== wants.source) continue;
        const g = zoneGenres(z);
        const reasons = [];
        let score = 0;
        if (wants.genres.size) {
            const matched = [...wants.genres].filter(id => g.has(id));
            if (!matched.length) continue;             // must match at least one asked-for genre
            score += 30 * matched.length;
            if (matched.length === wants.genres.size && wants.genres.size > 1) score += 25;
            matched.forEach(id => reasons.push(GENRES.find(x => x.id === id)?.label));
        }
        if (simGenres && simGenres.size) {
            const shared = [...simGenres].filter(id => g.has(id)).length;
            if (!shared && !wants.genres.size) continue;
            score += 20 * shared;
            if (shared) reasons.push(`Like ${wants.similarTo.name}`);
        }
        if (wants.words.length) {
            const s = searchScore(z, wants.words.join(" "), wants.words);
            if (s > 0) { score += 15 + Math.min(s, 60); reasons.push("Name matches"); }
            else if (!wants.genres.size && !simGenres) continue;
        }
        if (wants.short && zoneSource(z) === "js13k") { score += 20; reasons.push("Quick to play"); }
        if (wants.threeD && /\b3d\b/i.test(z.name + " " + (z.special || []).join(" "))) { score += 25; reasons.push("3D"); }
        const p = plays(z.id) / maxPlays;
        score += (wants.popular ? 40 : 10) * Math.sqrt(p);
        if (wants.popular && p > 0.05) reasons.push("Popular");
        if (wants.newest && zoneSource(z) === "library") score += 30 * (Number(z.id) / Math.max(1, ...zones.filter(x => zoneSource(x) === "library").map(x => Number(x.id))));
        const st = getZoneStats(z.id), votes = st.up + st.down;
        if (votes >= 3) score += 10 * (st.up / votes);
        if (wants.unplayed) reasons.push("New to you");
        if (wants.liked) reasons.push("Well liked");
        if (typeof isFlaggedBroken === "function" && isFlaggedBroken(z.id)) score -= 40;
        score += Math.random() * 6;                    // a little variety each time
        scored.push({ z, score, reasons: [...new Set(reasons.filter(Boolean))] });
    }
    scored.sort((a, b) => b.score - a.score);
    return { wants, results: scored.slice(0, limit) };
}

function describeWants(w) {
    const bits = [];
    if (w.genres.size) bits.push([...w.genres].map(id => GENRES.find(g => g.id === id)?.label.toLowerCase()).join(" + "));
    if (w.similarTo) bits.push(`like ${w.similarTo.name}`);
    if (w.words.length) bits.push(`named like “${w.words.join(" ")}”`);
    if (w.short) bits.push("quick to play");
    if (w.threeD) bits.push("3D");
    if (w.unplayed) bits.push("you haven't played");
    if (w.favorites) bits.push("from your favorites");
    if (w.liked) bits.push("well liked");
    if (w.popular) bits.push("popular first");
    if (w.newest) bits.push("newest first");
    if (w.source) bits.push(w.source === "js13k" ? "js13k games" : "GN Originals");
    return bits.length ? "Looking for: " + bits.join(", ") : "";
}

const FINDER_EXAMPLES = ["scary game I haven't played", "racing games with friends", "something like Geometry Dash", "chill puzzle game", "quick games for a short break", "popular shooter", "learn to code"];

function openGameFinder(prefill) {
    document.getElementById("popupTitle").textContent = "✨ Find me a game";
    const body = document.getElementById("popupBody");
    body.contentEditable = false;
    body.innerHTML = `
        <form id="finder-form" class="finder-form" autocomplete="off">
            <input type="search" id="finder-input" name="gn-finder" placeholder="Describe what you feel like playing…" aria-label="Describe what you feel like playing" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other">
            <button type="submit" class="settings-button" style="width:auto;">Find</button>
        </form>
        <div class="finder-chips">${FINDER_EXAMPLES.map(e => `<button type="button" class="finder-chip">${escapeHtmlText(e)}</button>`).join("")}</div>
        <p id="finder-understood" class="finder-understood" aria-live="polite"></p>
        <div id="finder-results" class="finder-results"></div>
        <p style="margin:0.75rem 0 0;color:var(--text-muted);font-size:12px;">Works right in your browser: it reads your words for genres and wishes like "haven't played" or "with friends". Nothing you type is sent anywhere.</p>`;
    const input = document.getElementById("finder-input");
    const run = () => {
        const text = input.value.trim();
        const out = document.getElementById("finder-results");
        const said = document.getElementById("finder-understood");
        out.innerHTML = "";
        if (!text) { said.textContent = ""; return; }
        const { wants, results } = findGames(text);
        said.textContent = describeWants(wants);
        if (!results.length) {
            out.innerHTML = `<p style="color:var(--text-muted);">No games fit that. Try different words, or fewer wishes.</p>`;
            return;
        }
        for (const { z, reasons } of results) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "finder-row";
            const img = document.createElement("img");
            img.alt = "";
            img.loading = "lazy";
            setCoverImage(img, z.cover, false);
            const text = document.createElement("span");
            text.className = "finder-text";
            const name = document.createElement("b");
            name.textContent = z.name;
            const why = document.createElement("span");
            why.className = "finder-why";
            why.textContent = reasons.slice(0, 3).join(" · ") || (z.author ? "by " + z.author : "");
            text.append(name, why);
            const play = document.createElement("span");
            play.className = "finder-play";
            play.textContent = "Play";
            row.append(img, text, play);
            row.onclick = () => { closePopup(); openZone(z); };
            out.appendChild(row);
        }
    };
    document.getElementById("finder-form").onsubmit = e => { e.preventDefault(); run(); };
    body.querySelectorAll(".finder-chip").forEach(c => c.onclick = () => { input.value = c.textContent; run(); });
    document.getElementById("popupOverlay").style.display = "flex";
    if (prefill) { input.value = prefill; run(); }
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
