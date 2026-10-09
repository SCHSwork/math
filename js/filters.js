// ═════════════════════════════════════════════════════════════════════════════
// Extra filters in the Sort & filter menu: Genre, Source and Show.
// Most library games have no genre tags, so genres are matched from each
// game's name and tags (e.g. "racer", "drift" → Racing). A game can be in
// more than one genre, and some games won't match any.
// ═════════════════════════════════════════════════════════════════════════════
const GENRES = [
    { id: "action",    label: "Action & fighting",   re: /\b(fight|fighter|smash|brawl|kombat|bowmasters|stick ?man|stickman|duel|sword|karate|ninja|combat|beat ?em|slash|hero)/, tags: ["action"] },
    { id: "adventure", label: "Adventure & RPG",     re: /\b(adventure|rpg|quest|dungeon|legend|dragon|knight|island|explor|kingdom|hollow|undertale|deltarune|terraria)/, tags: ["adventure"] },
    { id: "arcade",    label: "Arcade & classic",    re: /\b(arcade|snake|pong|breakout|brick|flappy|asteroid|pinball|invaders|paddle|retro|8 ?bit|pixel)/, tags: ["arcade"] },
    { id: "cards",     label: "Cards & board",       re: /\b(chess|checkers|solitaire|cards?|uno|poker|mahjong|board|monopoly|domino|blackjack|klondike|backgammon|yahtzee)\b/, tags: ["board"] },
    { id: "horror",    label: "Horror",              re: /\b(five nights|fnaf|horror|granny|baldi|scary|backrooms|poppy|slender|creepy|deception|evil|haunt|ghost|zombie|siren|nightmare|dead|blood|freddy)/, tags: ["horror"] },
    { id: "idle",      label: "Idle & clicker",      re: /\b(clicker|idle|tycoon|cookie|incremental|capitalist|merge)/, tags: ["idle"] },
    { id: "learning",  label: "Learning & coding",   re: /\b(math|typing|learn|quiz|code|coding|css|geography|science|spelling|word)/, tags: ["coding"] },
    { id: "multi",     label: "2 player & multiplayer", re: /\b(2 ?players?|two players?|duo|multiplayer|versus|vs)\b|\.io\b|\bio$/, tags: ["2 player"] },
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
function zoneGenres(zone) {
    const key = zone.id + "|" + zone.name;
    if (genreCache.has(key)) return genreCache.get(key);
    const name = String(zone.name || "").toLowerCase().replace(/['’]/g, "");
    const tags = (zone.special || []).map(t => String(t).toLowerCase());
    const set = new Set(GENRES.filter(g => g.re.test(name) || g.tags.some(t => tags.includes(t))).map(g => g.id));
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
