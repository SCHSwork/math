// ═════════════════════════════════════════════════════════════════════════════
// Extra filters in the Sort & filter menu: Genre, Source and Show.
// Genres come from config/game-info.json (written per game). Games missing
// from it are matched from their name and tags instead ("racer" → Racing).
// A game can be in more than one genre.
// ═════════════════════════════════════════════════════════════════════════════
const GENRES = [
    { id: "action",    label: "Action & fighting",   re: /\b(fight|fighter|smash|brawl|kombat|bowmasters|stick ?man|stickman|duel|sword|karate|ninja|combat|beat ?em|slash|hero)/, tags: ["action"] },
    { id: "adventure", label: "Adventure & RPG",     re: /\b(adventure|rpg|quest|dungeon|legend|dragon|knight|island|explor|kingdom|hollow|undertale|deltarune|terraria)/, tags: ["adventure"] },
    { id: "arcade",    label: "Arcade & classic",    re: /\b(arcade|snake|pong|breakout|brick|flappy|asteroid|pinball|invaders|paddle|retro|8 ?bit|pixel)/, tags: ["arcade"] },
    { id: "cards",     label: "Cards & board",       re: /\b(chess|checkers|solitaire|cards?|uno|poker|mahjong|board|monopoly|domino|blackjack|klondike|backgammon|yahtzee)\b/, tags: ["board"] },
    { id: "horror",    label: "Horror",              re: /\b(five nights|fnaf|horror|granny|baldi|scary|backrooms|poppy|slender|creepy|deception|evil|haunt|ghost|zombie|siren|nightmare|dead|blood|freddy)/, tags: ["horror"] },
    { id: "idle",      label: "Idle & clicker",      re: /\b(clicker|idle|tycoon|cookie|incremental|capitalist|merge)/, tags: ["idle"] },
    { id: "learning",  label: "Learning & coding",   re: /\b(math|typing|quiz|code|coding|css|geography|science|spelling|wordle|learn to code)/, tags: ["coding"] },
    { id: "multi",     label: "2 player & multiplayer", re: /\b(2 ?players?|two players?|duo|multiplayer|versus)\b|\.io\b|\bio$/, tags: ["2 player"] },
    { id: "music",     label: "Music & rhythm",      re: /\b(fnf|friday night|rhythm|beat|piano|music|dance|song|melody)/, tags: ["fnf"] },
    { id: "platformer",label: "Platformer & running", re: /\b(tower|mario|runs?|runner|running|jump|jumper|platform|celeste|ovo|geometry dash|vex|parkour|climb|dash|escape)/, tags: ["platformer"] },
    { id: "puzzle",    label: "Puzzle",              re: /\b(puzzle|2048|sudoku|blocks?|match|cut the rope|bloxorz|maze|sort|logic|brain|riddle|tiles?|connect|unblock|bubble)/, tags: ["puzzle", "memory"] },
    { id: "racing",    label: "Racing & driving",    re: /\b(rac(e|er|ers|ing)|drift|cars?\b|moto|bike|kart|driv|truck|highway|traffic|rally|speed|parking)/, tags: ["racing"] },
    { id: "retro",     label: "Retro & emulated",    re: /\b(nes|snes|gba|n64|nds|psx|dos|gameboy|sega)\b/, tags: ["emulator", "nes", "gba", "n64", "nds", "psx", "dos", "flash"] },
    { id: "sandbox",   label: "Sandbox & building",  re: /\b(craft|build|sandbox|city|simulator|sim|world|farm|tycoon)/, tags: ["simulation"] },
    { id: "shooter",   label: "Shooter",             re: /\b(shoot|shooter|guns?|sniper|war|battle|tanks?|fps|bullet|krunker|strike|blast|raid|doom|quake|invaders?)/, tags: ["shooter"] },
    { id: "sports",    label: "Sports",              re: /\b(soccer|football|basketball|golf|tennis|hockey|baseball|bowling|pool|volley|ski|skate|boxing|wrestl|penalty|sports?|goal|dunk|basket|cricket|ping ?pong)/, tags: [] },
    { id: "strategy",  label: "Strategy & defense",  re: /\b(strategy|defen[cs]e|td|civ|empire|tactic|rts|conquer|siege)/, tags: ["strategy"] }
];
const genreCache = new Map();
// Hand-written info for each game (config/game-info.json): genres "g",
// a one-line description "d", keywords "k" and "p": 2 for 2-player games.
// Games without an entry fall back to guessing from the name.
let GAME_INFO = {};
function getGameInfo(id) { return GAME_INFO[String(id)] || null; }
const gameInfoReady = fetch("config/game-info.json")
    .then(r => (r.ok ? r.json() : {}))
    .then(data => {
        GAME_INFO = data && typeof data === "object" ? data : {};
        genreCache.clear();
        if (Array.isArray(zones) && zones.length) { updateFilterCounts(); if (extraFiltersActive()) applyFilters(); }
    })
    .catch(() => {});
function zoneGenres(zone) {
    const key = zone.id + "|" + zone.name;
    if (genreCache.has(key)) return genreCache.get(key);
    const info = getGameInfo(zone.id);
    const tags = (zone.special || []).map(t => String(t).toLowerCase());
    let set;
    if (info && Array.isArray(info.g) && info.g.length) {
        set = new Set(info.g);
        if (info.p === 2) set.add("multi");
        // Library tags like "emulator" or "fnf" are always right, so keep them too
        GENRES.forEach(g => { if (g.tags.some(t => tags.includes(t)) && ["retro", "music"].includes(g.id)) set.add(g.id); });
    } else {
        const name = String(zone.name || "").toLowerCase().replace(/['’]/g, "");
        set = new Set(GENRES.filter(g => g.re.test(name) || g.tags.some(t => tags.includes(t))).map(g => g.id));
    }
    genreCache.set(key, set);
    return set;
}
function zoneSource(zone) {
    if (typeof isOriginalZone === "function" && isOriginalZone(zone)) return (zone.special || []).includes("js13k") ? "js13k" : "originals";
    return "library";
}
function showMatches(zone, show) {
    switch (show) {
        case "unplayed":  return !(typeof getPlaytime === "function" && getPlaytime(zone.id) > 0) && !(typeof getRecent === "function" && getRecent().includes(String(zone.id)));
        case "played":    return (typeof getPlaytime === "function" && getPlaytime(zone.id) > 0) || (typeof getRecent === "function" && getRecent().includes(String(zone.id)));
        case "favorites": return typeof isFavorite === "function" && isFavorite(zone.id);
        case "working":   return !(typeof isFlaggedBroken === "function" && isFlaggedBroken(zone.id));
        case "liked": {
            const s = typeof getZoneStats === "function" ? getZoneStats(zone.id) : null;
            const votes = s ? s.up + s.down : 0;
            return votes >= (typeof MIN_VOTES_TO_SHOW !== "undefined" ? MIN_VOTES_TO_SHOW : 3) && s.up / votes >= 0.8;
        }
        default: return true;
    }
}
// Called by applyFilters() for every game
function gameMatchesExtraFilters(zone) {
    const genre = document.getElementById("genreOptions")?.value || "all";
    const source = document.getElementById("sourceOptions")?.value || "all";
    const show = document.getElementById("showOptions")?.value || "all";
    if (genre !== "all" && !zoneGenres(zone).has(genre)) return false;
    if (source !== "all" && zoneSource(zone) !== source) return false;
    if (show !== "all" && !showMatches(zone, show)) return false;
    return true;
}
function extraFiltersActive() {
    return ["genreOptions", "sourceOptions", "showOptions"].some(id => {
        const el = document.getElementById(id);
        return el && el.value !== "all";
    });
}
function resetExtraFilters() {
    ["genreOptions", "sourceOptions", "showOptions"].forEach(id => { const el = document.getElementById(id); if (el) el.value = "all"; });
}
// Fill the Genre and Source lists with how many games are in each
function updateFilterCounts() {
    if (!Array.isArray(zones) || !zones.length) return;
    const visible = zones.filter(z => !(typeof isZoneDisabled === "function" && isZoneDisabled(z.id)));
    const genreSel = document.getElementById("genreOptions");
    if (genreSel) {
        const current = genreSel.value || "all";
        genreSel.innerHTML = "";
        genreSel.add(new Option(`All genres`, "all"));
        for (const g of GENRES) {
            const n = visible.filter(z => zoneGenres(z).has(g.id)).length;
            if (n) genreSel.add(new Option(`${g.label} (${n})`, g.id));
        }
        genreSel.value = [...genreSel.options].some(o => o.value === current) ? current : "all";
    }
    const srcSel = document.getElementById("sourceOptions");
    if (srcSel) {
        const count = s => visible.filter(z => zoneSource(z) === s).length;
        const labels = { all: `All sources (${visible.length})`, library: `Main library (${count("library")})`, originals: `GN Originals (${count("originals")})`, js13k: `js13k tiny games (${count("js13k")})` };
        for (const o of srcSel.options) if (labels[o.value]) o.textContent = labels[o.value];
    }
}
["genreOptions", "sourceOptions", "showOptions"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
        applyFilters();
        if (typeof updateFilterDot === "function") updateFilterDot();
    });
});

// ── Game jam games on/off ───────────────────────────────────────────────────
// The js13k games are tiny entries made in a month for a game jam. Some people
// would rather not see them, so a switch above All games hides them everywhere
// (lists, search, finder, random game, Today's pick). Saved on this device.
const HIDE_JAM_KEY = "gnmath-hide-jam-games";
let ZONES_ALL = null;
function isJamGame(z) { return (z.special || []).includes("js13k"); }
function getHideJam() { try { return localStorage.getItem(HIDE_JAM_KEY) === "true"; } catch { return false; } }
function applyJamPreference(list) {
    ZONES_ALL = list;
    updateJamToggle();
    return getHideJam() ? list.filter(z => !isJamGame(z)) : list.slice();
}
function updateJamToggle() {
    const btn = document.getElementById("jamToggle");
    if (!btn) return;
    const shown = !getHideJam();
    const n = (ZONES_ALL || []).filter(isJamGame).length;
    btn.setAttribute("aria-checked", shown ? "true" : "false");
    btn.classList.toggle("on", shown);
    document.getElementById("jamToggleLabel").textContent = `Game jam games: ${shown ? "shown" : "hidden"}${n ? ` (${n.toLocaleString()})` : ""}`;
    btn.title = shown ? "Hide the js13k game jam games" : "Show the js13k game jam games";
    const srcOpt = document.querySelector('#sourceOptions option[value="js13k"]');
    if (srcOpt) srcOpt.hidden = !shown;
}
function toggleJamGames() {
    const hide = !getHideJam();
    try { localStorage.setItem(HIDE_JAM_KEY, hide ? "true" : "false"); } catch {}
    if (ZONES_ALL) {
        zones = hide ? ZONES_ALL.filter(z => !isJamGame(z)) : ZONES_ALL.slice();
        const src = document.getElementById("sourceOptions");
        if (hide && src && src.value === "js13k") src.value = "all";
        featuredContainer.innerHTML = "";
        sortZones();
        if (typeof renderGameOfTheDay === "function") renderGameOfTheDay();
    }
    updateJamToggle();
    notify(hide ? "Game jam games are hidden. Turn them back on above All games." : "Game jam games are shown again.", { type: "success" });
}
document.addEventListener("DOMContentLoaded", updateJamToggle);
