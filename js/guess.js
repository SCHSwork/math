// ═════════════════════════════════════════════════════════════════════════════
// Daily Guess: name the game from a zoomed-in crop of its cover.
// Everyone gets the same game each day (picked from the date, like Today's
// pick). Six tries; every miss zooms the picture out and unlocks a clue
// (genre, creator, the shape of the name, first letters). A miss that shares a
// genre or creator with the answer counts as "close". Win or lose, the answer ends with a
// Play button, so even a miss turns up a game to try. The result can be copied
// as an emoji grid. Everything is kept in localStorage (gnmath-guess), so
// cloud saves carry streaks to every device.
// ═════════════════════════════════════════════════════════════════════════════
(function () {
    const KEY = "gnmath-guess";
    const SEEN_KEY = "gnmath-guess-seen";
    const MAX = 6;
    const ZOOM = [5.2, 3.6, 2.6, 1.9, 1.45, 1.2];   // picture zoom after 0…5 misses (1 = whole cover, shown at the end)
    const FIRST_DAY = Date.parse("2026-11-03T12:00:00");
    const wrap = document.getElementById("guessWrapper");
    if (!wrap) return;

    // ── Saved state ─────────────────────────────────────────────────────────
    function blank() { return { v: 1, played: 0, wins: 0, ace: 0, streak: 0, best: 0, lastWin: "", dist: [0, 0, 0, 0, 0, 0], day: "", answer: null, guesses: [], done: false, won: false }; }
    function load() { const s = readJson(KEY, null); return Object.assign(blank(), s && typeof s === "object" ? s : {}); }
    function save(s) { writeJson(KEY, s); }
    function dayKey() { return typeof todayKey === "function" ? todayKey() : new Date().toISOString().slice(0, 10); }
    function dayDiff(a, b) { return Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000); }
    function puzzleNumber() { return Math.max(1, Math.round((Date.parse(dayKey() + "T12:00:00") - FIRST_DAY) / 86400000) + 1); }

    // ── Which games can be the answer ───────────────────────────────────────
    const NOT_A_GAME = /soundboard|chat ?bot|comments|^\[|tier ?list|proxy|browser|emulator$/i;
    function isLocalLibraryGame(z) {
        const id = Number(z.id);
        return z && z.url && !String(z.url).startsWith("http") && id >= 0 && id < 100000 && z.cover
            && !isZoneDisabled(z.id) && !(typeof isPartnerZone === "function" && isPartnerZone(z));
    }
    function pickAnswer(day) {
        if (!Array.isArray(zones) || !zones.length) return null;
        const pool = zones.filter(z => isLocalLibraryGame(z) && !NOT_A_GAME.test(z.name || "")).sort((a, b) => Number(a.id) - Number(b.id));
        if (!pool.length) return null;
        const h = hashString("gn2-guess-" + day);
        // Two days a week it's a well-known (featured) game, so it isn't always a deep cut
        const famous = pool.filter(z => z.featured);
        const list = famous.length >= 10 && h % 7 < 2 ? famous : pool;
        const pick = list[Math.floor(h / 7) % list.length];
        // Today's pick and the answer are never the same game
        const gotd = typeof gameOfTheDay === "function" ? gameOfTheDay() : null;
        return gotd && String(gotd.id) === String(pick.id) ? list[(Math.floor(h / 7) + 1) % list.length] : pick;
    }
    // Where the zoom points: away from the edges, the same for everyone that day
    function focus(day) {
        const h = hashString("gn2-guess-focus-" + day);
        return { x: 28 + (h % 45), y: 28 + (Math.floor(h / 45) % 45) };
    }

    // ── Clues ───────────────────────────────────────────────────────────────
    function genresOf(z) {
        try { return [...zoneGenres(z)].filter(g => g !== "multi"); } catch { return []; }
    }
    function genreLabel(id) {
        const g = typeof GENRES !== "undefined" && GENRES.find(x => x.id === id);
        return g ? g.label : id;
    }
    function nameShape(name, firstLetters) {
        return String(name).split(/\s+/).filter(Boolean).map(w => [...w].map((c, i) =>
            /[a-z0-9]/i.test(c) ? (firstLetters && i === 0 ? c.toUpperCase() : "•") : c).join("")).join("   ");
    }
    // Why a miss was "close": same creator, or a genre in common (or "")
    function closeReason(guess, answer) {
        if (guess.author && guess.author === answer.author) return "same creator";
        const a = new Set(genresOf(answer));
        return genresOf(guess).some(g => a.has(g)) ? "same genre" : "";
    }
    function isClose(guess, answer) { return !!closeReason(guess, answer); }

    // ── Building the panel ──────────────────────────────────────────────────
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    let state = null, answer = null, renderedFor = "";

    function ensureToday() {
        const day = dayKey();
        state = load();
        if (state.day !== day) {
            // A new day: if yesterday's was left unfinished or lost, the streak ends
            if (state.lastWin && dayDiff(state.lastWin, day) > 1) state.streak = 0;
            const z = pickAnswer(day);
            if (!z) return false;
            Object.assign(state, { day, answer: String(z.id), guesses: [], done: false, won: false });
            save(state);
        }
        answer = zoneById(state.answer) || null;
        if (!answer) {   // the game went away (taken down): pick again
            const z = pickAnswer(day);
            if (!z) return false;
            Object.assign(state, { answer: String(z.id), guesses: [], done: false, won: false });
            save(state);
            answer = z;
        }
        return true;
    }

    function render(force) {
        if (!Array.isArray(zones) || !zones.length || typeof zoneById !== "function") return;
        if (!ensureToday()) { wrap.hidden = true; return; }
        const sig = state.day + "|" + state.answer + "|" + state.guesses.join(",") + "|" + state.done;
        if (!force && sig === renderedFor) return;
        renderedFor = sig;
        wrap.hidden = false;
        const body = wrap.querySelector(".guess-body");
        body.innerHTML = "";
        const misses = state.guesses.filter(g => g !== state.answer).length;
        const zoom = state.done ? 1 : ZOOM[Math.min(misses, ZOOM.length - 1)];
        const f = focus(state.day);

        // Picture
        const frame = el("div", "guess-frame" + (state.done ? " solved" : ""));
        const img = el("img");
        img.alt = state.done ? `Cover of ${answer.name}` : "A zoomed-in piece of a game's cover";
        img.draggable = false;
        img.dataset.placeholder = coverPlaceholder(state.done ? answer.name : "?");
        setCoverImage(img, answer.cover, false);
        img.style.transformOrigin = `${f.x}% ${f.y}%`;
        img.style.transform = `scale(${zoom})`;
        frame.appendChild(img);
        const zoomTag = el("span", "guess-zoom", state.done ? "Full cover" : `${zoom.toFixed(1).replace(/\.0$/, "")}× zoom`);
        frame.appendChild(zoomTag);
        img.oncontextmenu = e => e.preventDefault();

        // Right side
        const side = el("div", "guess-side");
        const head = el("div", "guess-head");
        head.append(el("div", "guess-label", `Daily Guess #${puzzleNumber()}`),
            el("div", "guess-tries", state.done ? (state.won ? `Solved in ${state.guesses.length}/${MAX}` : `Out of tries`) : `Try ${state.guesses.length + 1} of ${MAX}`));
        side.appendChild(head);

        // Past guesses
        const list = el("ol", "guess-list");
        state.guesses.forEach(id => {
            const li = el("li");
            if (id === "skip") { li.className = "g-skip"; li.textContent = "Skipped"; }
            else {
                const z = zoneById(id);
                const right = id === state.answer;
                const why = !right && z ? closeReason(z, answer) : "";
                const close = !!why;
                li.className = right ? "g-right" : close ? "g-close" : "g-wrong";
                li.append(el("span", "g-mark", right ? "✓" : close ? "≈" : "✗"), el("span", "g-name", z ? z.name : "(game removed)"));
                if (close) li.appendChild(el("span", "g-note", why));
            }
            list.appendChild(li);
        });
        if (state.guesses.length) side.appendChild(list);

        // Clues
        if (!state.done && misses >= 1) {
            const clues = el("div", "guess-clues");
            const g = genresOf(answer);
            if (misses >= 1) clues.appendChild(clue("Genre", g.length ? g.map(genreLabel).join(", ") : "Not sure!"));
            if (misses >= 3) clues.appendChild(clue("Made by", answer.author || "Unknown creator"));
            if (misses >= 4) clues.appendChild(clue("Name", nameShape(answer.name, misses >= 5), "g-shape"));
            side.appendChild(clues);
        }

        if (!state.done) side.appendChild(guessForm());
        else side.appendChild(result());
        body.append(frame, side);
        if (typeof window.renderHomeTabs === "function") window.renderHomeTabs();
    }
    function clue(name, value, cls) {
        const d = el("div", "guess-clue" + (cls ? " " + cls : ""));
        d.append(el("span", "gc-name", name), el("span", "gc-value", value));
        return d;
    }

    // ── Typing a guess ──────────────────────────────────────────────────────
    function guessForm() {
        const form = el("form", "guess-form");
        form.setAttribute("autocomplete", "off");
        const input = el("input");
        input.type = "text";
        input.placeholder = "Type a game name…";
        input.setAttribute("aria-label", "Your guess");
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-expanded", "false");
        input.setAttribute("aria-controls", "guessSuggest");
        input.spellcheck = false;
        const menu = el("ul", "guess-suggest");
        menu.id = "guessSuggest";
        menu.setAttribute("role", "listbox");
        menu.hidden = true;
        const row = el("div", "guess-row");
        const skip = el("button", "guess-skip", "Skip");
        skip.type = "button";
        skip.title = "Zoom out and get the next clue (uses a try)";
        skip.onclick = () => submit("skip");
        row.append(input, skip);
        form.append(row, menu);
        let matches = [], active = 0;
        const guessed = new Set(state.guesses);

        function update() {
            const q = normText(input.value);
            matches = [];
            if (q) {
                const tokens = q.split(" ");
                const seen = new Set();
                matches = zones.filter(z => Number(z.id) >= 0 && z.name && !isZoneDisabled(z.id) && !guessed.has(String(z.id)))
                    .map(z => [z, searchScore(z, q, tokens)]).filter(([, s]) => s > 0)
                    .sort((a, b) => b[1] - a[1]).map(([z]) => z)
                    .filter(z => { const n = normText(z.name); if (seen.has(n)) return false; seen.add(n); return true; })
                    .slice(0, 6);
            }
            active = 0;
            menu.innerHTML = "";
            matches.forEach((z, i) => {
                const li = el("li", i === active ? "on" : "", z.name);
                li.setAttribute("role", "option");
                li.id = "guessOpt" + i;
                li.onmousedown = e => { e.preventDefault(); submit(String(z.id)); };
                menu.appendChild(li);
            });
            menu.hidden = !matches.length;
            input.setAttribute("aria-expanded", matches.length ? "true" : "false");
            if (matches.length) input.setAttribute("aria-activedescendant", "guessOpt0"); else input.removeAttribute("aria-activedescendant");
        }
        function move(d) {
            if (!matches.length) return;
            active = (active + d + matches.length) % matches.length;
            [...menu.children].forEach((li, i) => li.classList.toggle("on", i === active));
            input.setAttribute("aria-activedescendant", "guessOpt" + active);
        }
        input.addEventListener("input", update);
        input.addEventListener("keydown", e => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Escape") { menu.hidden = true; }
            e.stopPropagation();   // keep the site's keyboard shortcuts out of the guess box
        });
        input.addEventListener("blur", () => setTimeout(() => { menu.hidden = true; }, 120));
        form.onsubmit = e => {
            e.preventDefault();
            if (matches[active]) submit(String(matches[active].id));
        };
        // Put the cursor back after a wrong guess
        if (state.guesses.length) setTimeout(() => { if (document.activeElement === document.body) input.focus({ preventScroll: true }); }, 0);
        return form;
    }

    function submit(id) {
        state = load();
        if (state.done || state.day !== dayKey()) { render(true); return; }
        if (id !== "skip" && state.guesses.includes(id)) return;
        state.guesses.push(id);
        const won = id === state.answer;
        if (won || state.guesses.length >= MAX) {
            state.done = true;
            state.won = won;
            state.played++;
            if (won) {
                state.wins++;
                state.dist[state.guesses.length - 1]++;
                if (state.guesses.length === 1) state.ace++;
                state.streak = state.lastWin && dayDiff(state.lastWin, state.day) === 1 ? state.streak + 1 : 1;
                state.best = Math.max(state.best, state.streak);
                state.lastWin = state.day;
            } else {
                state.streak = 0;
            }
        }
        save(state);
        render(true);
        if (state.done) {
            const frame = wrap.querySelector(".guess-frame");
            if (frame && won) frame.classList.add("pop");
            if (typeof achCheck === "function") achCheck(false);
        } else {
            const input = wrap.querySelector(".guess-form input");
            if (input) input.focus({ preventScroll: true });
            const last = wrap.querySelector(".guess-list li:last-child");
            if (last) last.classList.add("shake");
        }
    }

    // ── After the last try ──────────────────────────────────────────────────
    function shareText() {
        const marks = state.guesses.map(id => id === state.answer ? "🟩" : id === "skip" ? "⬛" : (zoneById(id) && isClose(zoneById(id), answer)) ? "🟨" : "🟥").join("");
        const score = state.won ? `${state.guesses.length}/${MAX}` : `X/${MAX}`;
        return `GN 2.0 Daily Guess #${puzzleNumber()} ${score}\n${marks}${state.streak > 1 ? `\n🔥 ${state.streak} day streak` : ""}`;
    }
    function result() {
        const box = el("div", "guess-result");
        box.appendChild(el("div", "gr-title", state.won ? ["Called it! 🎯", "Nice! 🙌", "Got it 👍", "Good eye", "Phew!", "Just made it 😅"][state.guesses.length - 1] : "So close! It was…"));
        box.appendChild(el("div", "gr-name", answer.name));
        if (answer.author) box.appendChild(el("div", "gr-by", "by " + answer.author));
        const actions = el("div", "gr-actions");
        const play = el("button", "settings-button gr-play", "Play " + (answer.name.length > 22 ? "it" : answer.name));
        play.type = "button";
        play.onclick = () => openZone(answer);
        const share = el("button", "gr-share", "Copy result");
        share.type = "button";
        share.onclick = async () => {
            const text = shareText();
            let ok = false;
            try { await navigator.clipboard.writeText(text); ok = true; } catch {
                try { const t = el("textarea"); t.value = text; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch {}
            }
            share.textContent = ok ? "Copied!" : "Couldn't copy";
            setTimeout(() => { share.textContent = "Copy result"; }, 1800);
        };
        actions.append(play, share);
        box.appendChild(actions);
        // Stats
        const s = el("div", "gr-stats");
        const stat = (n, label) => { const d = el("div"); d.append(el("b", null, String(n)), el("span", null, label)); return d; };
        s.append(stat(state.played, "played"), stat(state.played ? Math.round(state.wins / state.played * 100) + "%" : "0%", "solved"),
            stat(state.streak, "streak"), stat(state.best, "best"));
        box.appendChild(s);
        const dist = el("div", "gr-dist");
        dist.setAttribute("aria-label", "How many tries your wins took");
        const top = Math.max(1, ...state.dist);
        state.dist.forEach((n, i) => {
            const r = el("div", "gd-row" + (state.won && state.guesses.length === i + 1 ? " today" : ""));
            const bar = el("span", "gd-bar", String(n));
            bar.style.width = Math.max(8, Math.round(n / top * 100)) + "%";
            r.append(el("span", "gd-n", String(i + 1)), bar);
            dist.appendChild(r);
        });
        box.appendChild(dist);
        box.appendChild(el("div", "gr-next", "New puzzle at midnight"));
        return box;
    }

    // ── For the home tab and badges ─────────────────────────────────────────
    window.guessTabCount = function () {
        let seen = false;
        try { seen = !!localStorage.getItem(SEEN_KEY); } catch {}
        if (!seen) return "NEW";
        const s = load();
        return s.day === dayKey() && s.done ? (s.won ? "✓" : "") : "•";
    };
    window.guessMarkSeen = function () { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} };
    window.guessStats = function () { const s = load(); return { wins: s.wins, ace: s.ace, best: s.best }; };
    window.renderDailyGuess = render;

    // Draw once the game list is in, and roll over at midnight
    const start = setInterval(() => { if (Array.isArray(zones) && zones.length > 50) { clearInterval(start); render(); } }, 500);
    setInterval(() => { if (renderedFor && !renderedFor.startsWith(dayKey() + "|")) render(true); }, 60000);
})();
