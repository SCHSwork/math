# Changelog

All the changes to GN 2.0, newest first.






## October 30, 2026 — Username in the search box

### Fixed
- **Your username no longer shows up in the search box** after a refresh or signing in. Chrome's password manager was filling it in: "Focus search on load" puts the cursor in the box, and the old guard unlocked the box on any focus, so Chrome treated it as a username field. Now only a real click, tap or key press unlocks it, and text that appears without you typing it is put back to what you had, any time it happens (the old guard only watched the first 5 seconds).

## October 29, 2026 — Minecraft 1.8.8 and the nightly check

### Fixed
- **Minecraft 1.8.8 starts again** (it was a black screen for everyone). The site removes accidental second copies of a game page by cutting at the first `</html>`, but Eaglercraft has `</html>` inside its own code (text for a popup window), so half the game was thrown away. Only a real end of page counts now. Checked every library and washed game page: Minecraft was the only one affected.
- **The nightly game check can't lose a night anymore.** On Oct 28 a game froze the test browser, the run hit GitHub's 3-hour limit and nothing was saved. Every game now has a time limit (a frozen game goes under "Couldn't tell"), results are saved after each game, and the save step always runs.
- **8 more authors for the added games:** Chess (Stefano Gioffré), 2048 Cupcakes (0x0800), Flappy 2048 (hczhcz), Sleeping Beauty (Ondřej Žára), Space Invaders (Tóth Róbert), Stack (BMQB), Horse Master (Tom McHenry), Bomb It 2 (Zlong Games). Found in the games' own license files and pages, or confirmed online.
- **Flappy Plane is off the site.** It looks like a 9/11 joke game. It's marked `"hidden"` in config/library-washed.json, so it stays off.
- **osu! no longer shows as "not starting".** Its menu is a normal web page, not a game canvas; a page with a full menu on screen now counts as working.

## October 28, 2026 — Authors for the new games

### Fixed
- **The 82 added games (ids 990000+) said just "by" with no name.** Games with no known author now show nothing there instead of an empty "by".
- **Game info works for them.** It used to look them up in the main library's repo, where they don't exist, and got stuck on "Loading...". It now shows the name, author (or "Unknown"), where the files came from and a description.
- Filled in the authors we know for sure: Paper Minecraft and Appel (griffpatch), Edge Surf (Microsoft), Interactive Buddy (Shock Value), Kitten Cannon (Dan Fessler), MineKhan (Willard Pierce), Space Company (sparksp), Weave Silk (Yuri Vishnevsky), WebGL Fluid Simulation (Pavel Dobryakov), You Are Jeff Bezos (Kris Lorischild), Papa Louie: When Pizzas Attack (Flipline Studios), Sugar, Sugar (Bart Bonte), Fireboy and Watergirl (Oslo Albet). The rest can be added in config/library-washed.json ("author").

## October 28, 2026 — Mark games fixed

### Added
- **Admins can mark a game fixed** from the Game check list, the in-game ⋯ menu ("Mark fixed (clear reports)") and the owner panel's Broken Reports ("Fixed"). It clears every broken report on the game, so its ⚠ warning goes away for everyone, and moves it to "Marked fixed" in Game check until a later nightly check finds it failing again. Reports sent after that count as usual. Each one is saved in the Log.
- Database rules: players can still rate and report a game after it's marked fixed; only admins can change the fixed time.

## October 28, 2026 — Game sound fix

### Fixed
- **Games that stayed silent now get their sound.** Browsers keep sound off until you tap or press a key, and Safari (iPads, iPhones, Macs) only counts taps inside the game itself, so games that set up their sound too early never played any. Every game page now turns sound on with your first tap, click or key press in the game (`gameAudioUnlockHook` in js/app.js): it wakes sound the browser put to sleep and restarts music the browser refused. Sound a game paused or muted itself is left alone.
- The game frame now allows autoplay, fullscreen and controllers.
- **Game check no longer flags games that work.** jsDelivr often turns away the test server (HTTP 403 or a dropped connection) for files players download fine; the check now gets those files from GitHub instead. Games that show something with no errors (like Coreball) count as working, and games whose files the test server still can't download go under "Couldn't tell" instead of "Not starting". Rechecked the 11 flagged games: 8 now pass.
- **Admin Panel tabs no longer hide off the edge on phones.** Admins have 8 tabs, so Game check and New games were scrolled out of sight (mods only have 4, so they could see it). The tabs now go onto a second row.

## October 26, 2026 — Nightly game check

### Added
- **Every night (about 3 AM) GitHub opens about 250 games in a real browser** (`tools/check_games.mjs`, `.github/workflows/game-check.yml`), plus every game that failed last time, so each game is checked about once a week and fixed games clear themselves.
  - Games where nothing appears within 20 seconds are checked again with 45 seconds and a fresh browser before they count as "not starting".
  - The test never touches the site's database (online count, error reports, accounts).
- **Admin Panel → Game check** lists the games that didn't start, with the reason (the script error or missing file), since when, and the full error list. Open plays the game; on the owner's browser, Turn off hides it. A count on the tab shows how many are failing.
- Run it any time from the repo's Actions tab ("Nightly game check" → Run workflow), optionally for just some game ids.

## October 26, 2026 — Play next

### Added
- **"Play next" suggestions** (js/play-next.js). Close a game you played for at least 30 seconds and a small panel offers six more. Up to 3 are from the same series, the next one first (Vex 7 after Vex 6); the rest share its genres, most played first. Games you've already played, turned-off games, games reported broken and partner games are skipped.
- The panel goes away after 25 seconds, when you open something, or with × / Esc. "Don't suggest games" turns it off in that browser.

## October 26, 2026 — Halloween week 🎃

### Added
- **Halloween week, Oct 24 – Nov 1** (js/halloween.js), with everything going back to normal on Nov 2:
  - **Decorations:** the site wears the Halloween scene (orange moon, bats, graveyard) for everyone. "Turn off decorations" in the banner, or picking any theme in Settings, switches it off for that visitor; their own theme is never changed.
  - **A 🎃 Spooky tab** first on the home page, with horror and Halloween games, most played first.
  - **A banner** counting down to Halloween (once a day).
  - **Two limited-time badges:** 🎃 Trick or Treat (play any game on Oct 31) and 👻 Spooky Season (play 5 spooky games during the week).

## October 26, 2026 — Library games' outside files are locked to one version

### Security
- **662 library games load scripts, SDKs or game files from other people's repos by branch name** (…@main, …@master, @latest or no version), from 207 repos in all. Whatever got pushed there would run on GN 2.0 the next time someone opened the game, so one bad change or hacked account could break or take over those games overnight. Each of those links is now fixed to the commit that's there today:
  - `config/library-pins.json`, made by `tools/build_library_pins.py`.
  - The site swaps the links in the page (`pinLibraryLinks`) and the ones a game builds while it runs (`pinLinksHook`).
  - Pins never move by themselves. New branch links are pinned when they first appear (with the daily update). To move them forward on purpose: `python3 tools/build_library_pins.py --refresh [owner/repo]`.
  - 11 repos are gone or private and stay as they were (jsDelivr may still have copies).
- The split-file sizes and big-file list now use the pinned commits too.

## October 26, 2026 — Admin Panel: who's online, levels and visitors

### Added
- **Accounts tab: online status for every account.** A green dot shows "Online" or "Playing <game>"; otherwise "Seen 3 h ago" and so on. Online accounts are listed first, the summary says how many are online, and there's a new "Online now" filter.
- **Each account shows its level** (Lv 14), plus games tried, time played and badges.
  - Signed-in players' profiles now carry these, updated every 5 minutes while the site is open and soon after they open or close a game (one small write each time).
- **Visitors, including people without accounts**, at the top of the Accounts tab:
  - online now, signed in, and without an account
  - visitors today, this week and all time (different browsers)
  - what's being played right now; click a game to open it.

### Changed
- `config/firestore.rules`: profiles may include level, xp, badges, played, tried and playing.
- Home tabs stop switching on their own a few seconds after the page loads, and the Top 10 shows up sooner.

## October 26, 2026 — Simpler home page

### Changed
- **The home page shows one row at a time instead of six stacked sections.** Top 10, Featured, New, Recent, Favorites and GN Originals are now tabs above a single row (js/home-tabs.js). Your choice is remembered; first-time visitors see Top 10. Tabs only appear when they have games (no Recent tab until you've played something). Arrow keys switch tabs.
- **Game of the Day is a small chip at the end of the tab bar** (cover, name, Play, ×) instead of a big banner.
- **The "Game jam games" and "Partner games" switches moved into Sort & filter**, so All games starts right away.
- While searching or filtering, the tabs step aside so results come first.

## October 26, 2026 — Top 10, "playing now" and levels & badges

### Added
- **Top 10 this week** at the top of the home page, with big rank numbers beside the covers. It's the games played most on GN 2.0 this week; early in the week, when there isn't enough yet, it fills in with what's popular across the game library.
- **"N playing" badges on game cards**, with a pulsing dot, showing how many people have that game open right now.
  - How it stays cheap (js/live.js): each browser's online heartbeat now also says which game is open (just the game id). Every 5 minutes one browser adds them up and saves the counts in `live/now`, and adds them to the week's total in `live/w<year><week>`. Everyone else reads one small document every 5 minutes, which replaces the old per-browser online count, so Firebase use stays about the same. The database rules only let those documents change every 2 minutes.
- **Levels and badges** (js/achievements.js). A level ring in the header shows your level and progress to the next one; click it for your rank, XP and all 30 badges with progress bars.
  - XP comes from trying new games, play time, visiting on different days, favorites, ratings, reports and the Game of the Day, plus a bonus for each badge.
  - Badges include Explorer (try 10/50/150/400 games), Marathon (play time), On a Roll (visit streaks), Night Owl, Early Bird, Genre Hopper, Daily Pick, Fresh Finds, Feeling Lucky, Bug Hunter, Homegrown (GN Originals) and Jam Session (js13k).
  - Unlocking a badge or reaching a new level shows a short celebration with confetti. Existing players start at the level their history already earns, with one hello instead of a pile of popups.
  - Everything is kept in this browser and goes with your cloud save.

### Changed
- `config/firestore.rules`: presence heartbeats may include `g` (the open game's id); new `live/now` and `live/w…` documents.

## October 26, 2026 — "Watch an ad for a reward" no longer breaks games

### Fixed
- **About 50 Yandex games (mostly Unity ports) froze or crashed when you picked "watch an ad" for a perk.** They load Yandex's real SDK, which can't reach Yandex from here, so it never finished starting and nothing that waited on it ever answered. The site now gives them a stand-in instead (`yandexSdkStub` in js/app.js): rewarded ads give the reward right away, ad breaks end at once, saves are kept in your browser, and account-only things (leaderboards, purchases, sign-in) politely say no.
- **Games that use Google's game ads (`adBreak` / `adsbygoogle`)**: the ad script is removed, so rewarded ads never gave the reward or handed control back. Those ad breaks now end right away, and rewarded ones count as watched.

## October 26, 2026 — More games that never started now work

Found by opening every library and UBZone game in a test browser and checking which ones never showed a game.

### Fixed
- **Games that use a helper worker now start**, e.g. Look Outside and Saihate Station (RPG Maker's music decoder). Browsers only start a worker from the page's own site, and game files come from jsDelivr, so these failed with "Failed to construct 'Worker'". The worker is now started from a tiny same-site file that loads the real one (`crossOriginWorkerHook` in js/app.js).
- Games copied from Google Sites (Coreball, Big Tower Tiny Square 2, Pac-Man World 2, 64 in 1 NES…) no longer throw "maeExportApis_ is not a function" when they start, which also kept that error out of the error log.
- **Ace Attorney Investigations: Miles Edgeworth** had two typos in its library copy (`response.rrayBuffer()` and a stray `a`) and stopped at "Error loading game". The site fixes them when it loads the game.

## October 26, 2026 — Stand-in for game portal SDKs

### Fixed
- Games that call the Poki, CrazyGames or GameDistribution SDK, but whose SDK file is removed (ads) or missing, get a stand-in where every call succeeds right away (ad breaks end at once, rewarded ads give the reward). Games that bring their own stand-in, or load the real SDK, use theirs.

## October 26, 2026 — 12 UBZone games that showed a blank page now load

### Fixed
- **12 UBZone games opened to a blank white page**: -3 Remastered, Bendy, Minecraft P.E., GDWEB+, Lobotomy Dash, Snowball.IO, Flying Gorilla, FNAE Last Breath, three, Antidisestablishmentarianism, Pneumonoultramicroscopicsilicovolcanoconiosis and The Ultimate Baldi's Basics Decompile. Their files start with an empty page and have the real game after it, and the site's fix for library files that contain their page twice kept the empty one. Now it keeps the copy that has the game in it.

## October 26, 2026 — Press / to search

### Added
- **Press `/` anywhere on the home page to jump to the search box** (not while a game is open or you're typing somewhere else).

## October 26, 2026 — New games row on the home page

### Added
- **A "New games" row under Featured**: everything added in the last 2 weeks, newest first, with a "See all" tile at the end that opens the full list (Sort & filter → New in the last 2 weeks). It hides itself when nothing is new, and closes like the other rows when you search.

## October 26, 2026 — Construct 3 games start again; Among Us added

### Fixed
- **Construct 3 games that never started now work**, e.g. Draw the Hill, Dreadhead Parkour, Teen Titans GO!: Jump Jousts 2 and Cat Gunner. They looked for their files on GN 2.0 instead of in their own folder (game pages are written into the game window, so they saw GN 2.0's address). The site now tells them their real folder and runs them without helper workers (`construct3Hook` in js/app.js). Copies already hand-patched for this are left alone.

### Added
- **Among Us (Fan Game)** from Strongdog, skipped before because of the problem above. It's in Featured.

## October 26, 2026 — Flash games no longer depend on jsDelivr

### Fixed
- **139 Flash games (Papa's games, Bloons, Riddle School…) now load the Flash player (Ruffle) from GN 2.0 itself** (`vendor/ruffle`, the same version they used before) instead of from jsDelivr. It works wherever the site works, even on networks that block jsDelivr and its backups, and it's downloaded once for all Flash games.
- When jsDelivr is blocked and games fall back to unpkg, `ruffle.min.js` links are changed to `ruffle.js` (unpkg doesn't have the .min file, so those games failed to start).
- Flash games that load "the newest Ruffle" from unpkg or jsDelivr (no version: Road of Fury, Bloxorz, the Strongdog Flash games) use the site's copy too. Those links change every night and unpkg is often blocked; Road of Fury and Bloxorz didn't start because of it.

## October 26, 2026 — Games fit the screen

### Fixed
- **The game window now uses the whole screen under the top bar.** It was 90% wide and stuck to the left, leaving an empty strip on the right of every game.
- **Games made for one fixed size now fit the screen** (new `js/game-fit.js`, runs inside every game). Games that sat small in the top-left corner are made bigger and centered; games whose bottom or right side was cut off (common on phones and short laptop screens) are made smaller to fit. They keep their shape, and turning a phone re-fits them right away. Games that already fill the screen aren't touched.
  - Games from engines that handle being resized (Unity, Construct, GameMaker, Phaser, Godot, Clickteam and others) are scaled; games we can't identify are only centered, unless they don't fit at all, so clicks still land in the right place.
  - On a sample of 64 games, the ones that didn't fit dropped from 9 to 2 on a computer screen and from 13 to 4 on a phone held sideways.
- **Flash games show black bars at the sides** instead of white or grey ones (or half-drawn art from outside the game's stage), and no longer have a white border around them.

### Added
- **⋯ More → Fit game to screen: on/off.** If fitting ever causes trouble in a game, turn it off for that game; it's remembered.

## October 26, 2026 — Real thumbnails for new games

### Changed
- **17 Strongdog games that only had their name on a colored card now have real thumbnails.** Most are the game's own title screen (Bomb It 2 & 3, 3 Pandas, Sugar Sugar, Papa Louie, Comic Book Cody, Hot Dog Bush, Boxing Physics, There Is No Game, Veloce, ASCII Space). Games with no usable title screen got drawn artwork (100ng, CS:GO Clicker, Space Company, You Are Jeff Bezos, Konnekt, Avalanche).

## October 26, 2026 — Find new games

### Added
- **Type "new" in the search box** (or "new games", "latest", "recently added") to see every game added in the last 2 weeks, newest first.
- **Sort & filter → Show → 🆕 New this week / 🆕 New in the last 2 weeks.** Newest first unless you pick another sort.
- `config/added-dates.json`: the day each game was added to the site (library, GN Originals, UBZone and washed games), built from the game lists' history by `tools/build_added_dates.py`. It updates every day with the split-file sizes. Partner catalogs aren't included.

### Changed
- **"Newest" sort is now "Recently added"** and uses the real day each game was added, so washed and Strongdog games show up first.
- **NEW badges** now go on every game added in the last week (washed and UBZone games too, not just the library's 12 highest ids). Hovering the badge says when it was added.

## October 26, 2026 — New games in Featured

### Changed
- **The Featured row starts with 20 of the newly added games**: Drive Mad, Subway Surfers (San Francisco, Beijing, Monaco), Paper Minecraft, Funny Shooter 2, Boxing Physics, Crowd Drift City, Cyber City Driver, Fireboy and Watergirl, Papa Louie: When Pizzas Attack!, Kitten Cannon, Bomb It, Idle Shark, MineKhan, Flip Hero, Dunkers Fight 2P, The Ninja, Appel and Scratch Brawl 2. Washed library games the library features (Into The Pit, Sally Face) come next, then the library's usual picks.
- Washed games can be featured with `"featured": true` in `config/library-washed.json` (`featuredOrder` sets their place).

## October 25, 2026 — 81 games from Strongdog

### New
- **81 games** from the [Strongdog](https://github.com/Avioso/strongdog) collection that GN 2.0 didn't have, each washed, locked to the checked version and tested in a browser before being added: 100ng: 100-Player Pong, 2048 Cupcakes, 2048 Multitasking, 3 Pandas, 9007199254740992, ASCII Space, Amidst the Clouds, Appel, Avalanche, Ball Hop, Ball Platformer, Ballistic Chickens, Big Tower Holiday Special, Biters.io, Black Hole Square, Bomb It, Bomb It 2, Bomb It 3, Boxing Physics, Bubble Scratch, CS:GO Clicker, Captain Callisto, Chess, Comic Book Cody, Connect 3, Crowd Drift City, Cyber City Driver, Dunkers Fight 2P, Eat.io, Edge Surf, Eel Slap!, Endless War 3, Fireboy and Watergirl, Flappy 2048, Flappy Plane, Flip Hero, Floyd, Funny Shooter 2, Goodnight, Horse Master, Hot Dog Bush, Idle Shark, Interactive Buddy, Kitchen Gun Game, Kitten Cannon, Konnekt, Mario (Scratch), MineKhan, Minhero: Tower of Sages, Papa Louie: When Pizzas Attack!, Paper Minecraft, Picky Package, Pokey Stick, Pushback, Retrohaunt, Roadblocks, Sand and Water, Scratch Brawl 2, Shape Switcher, Shuttledeck, Sleeping Beauty, Space Company, Space Invaders, Stack, Steal This Election, Sugar, Sugar, Terrain Generator, The Ninja, The Ninja 2, The Ninja 3, The Ninja 4, The Ninja 5, The Ninja 5 (Hacked), There Is No Game, Tower Master, Veloce, Wall Smash, Weave Silk, WebGL Fluid Simulation, Whac-a-Mole, You Are Jeff Bezos.
- Washing removed ads and trackers (Google AdSense and Analytics, Yandex Metrica, GameMonetize, CrazyGames, AdinPlay and others), replaced ad SDKs the games call with a stand-in that skips ads, removed links to that site's own scripts and security rules tied to it, and moved libraries from Google's and unpkg's CDNs to jsDelivr. Flash games use their own copy of Ruffle.
- **100ng (100-player Pong)** is online-only and needs its maker's server, which is sometimes down.
- Left out after checking: games GN 2.0 already has (FNAF 1–4, 1v1, Getting Over It, Slither.io, Run, Paper.io, Fancy Pants, Bad Time Simulator, Pong), pages that just frame another website (Krunker, Zombs Royale, BrowserQuest, 1v1 Space, Disc Us and 22 Construct Arcade links), online games that can't work from here (Shell Shockers: an outdated copy of a game that updates constantly; Ferge.io), Construct 3 games that need to run code in background workers (Among Us, Algae's Escapade, Yoshi's Fabrication Station), games that depend on outside services (Rodeo Stampede, Restaurant Rush), three single-file games of 77–97 MB, a broken demo, and non-games (a pirated-video site, a TV static page).

### Changed
- **Game files over 20 MB load from GitHub or githack automatically.** jsDelivr won't serve them, which used to make such games fail. The daily size-list job now also lists those files.
- **Trackers and ad networks are blocked inside every game**, not just their scripts: fetch, XHR, beacons, images and websockets to those hosts go nowhere. Added Yandex, Unity's analytics, id.net/Playtomic, GameMonetize, GameDistribution, CrazyGames, AdinPlay, CPMStar, Poki's tracker and others to the list.
- Washed entries can also point straight at a page in a repo (locked to a commit), for single-file games too big to copy.

## October 25, 2026 — Subway Surfers is back (3 cities)

### New
- **Subway Surfers: San Francisco, Beijing and Monaco** are playable again. The game library removed every Subway Surfers version in December 2025; these come from the same GitHub collection as Drive Mad ([Avioso/strongdog](https://github.com/Avioso/strongdog)), washed and locked to the checked version:
  - removed Google AdSense, Google Analytics, an ad SDK loaded from a Russian ad site, another ad network, and a lock to the 4399 game site;
  - Poki's ad SDK is replaced with a stand-in that skips ads, and the loading screen can't fetch Poki's font or thumbnail;
  - the two biggest files of each city are over jsDelivr's 20 MB limit, so they come from GitHub directly (or githack if GitHub is blocked for that player).
- Houston was in that collection too, but its game files are gone from the internet, so it can't be added.
- New covers for San Francisco and Monaco.

## October 25, 2026 — Drive Mad is back

### New
- **Drive Mad** (by Martin Magni) is playable again. The game library removed it in December 2025, so this copy comes from another collection on GitHub ([Avioso/strongdog](https://github.com/Avioso/strongdog)) and loads through jsDelivr like the rest of the games. It was washed first: an obfuscated GameMonetize "Jump" ad/redirect script and a link to that site's own script were removed, and the game files are locked to the exact version that was checked.
- The washed list (`config/library-washed.json`) can now hold games that aren't in the library's list at all (`"extra": true`).

## October 25, 2026 — Automatic error reports

### New
- **Things that go wrong for players are reported automatically**, for admins to look over in **Admin Panel → Errors**:
  - the site itself crashing,
  - a game crashing while it runs (including Unity "abort" popups),
  - a game that couldn't load from any source while the player was online,
  - a game piece that kept arriving cut off,
  - a cloud save failing.
- The same error from many players is **one entry with a count**, plus the details of the latest time: the error and where in the code, the game, browser and device, screen, whether they were online, which game sources were blocked, how long they'd been on the page, the site version, and the account name if they were signed in.
- Admins can search, copy the details, open the game, mark an error resolved (it reopens if it happens again) or delete it. The tab shows how many open errors happened in the last day.
- Each browser sends at most 15 reports a day and never the same one twice in a visit, and none when the site is near its daily Firebase limit. Reports made while offline are sent on the next visit. Known noise (browser extensions, being offline) is skipped.

## October 25, 2026 — Big games protected from broken downloads

### New
- **Every game that loads in pieces is now protected from cut-off downloads**, not just Into The Pit. Big games come split into pieces that they download, join and often save in the browser. If a piece arrived cut off, the joined file was broken, and games that saved it failed on every load after that. Now, inside every game:
  - each piece is checked against its exact size, and a short one is downloaded again (up to 3 times);
  - a joined file that's too small is never saved, and one saved before is thrown out and downloaded again;
  - for games locked to an exact version, a piece that keeps arriving short gives a clear error instead of a broken game.
- The sizes come from `config/part-sizes.json`, which a GitHub Action rebuilds every day and whenever the game lists change (`tools/build_part_sizes.py`), since games that load from a branch can change.
- **Re-download game files** in a game's ⋯ More menu deletes the game files it saved in your browser (not your progress), so they're downloaded fresh.

## October 25, 2026 — Into The Pit uses far less memory

### Fixed
- **Five Nights at Freddy's: Into The Pit** crashed with an `abort({})` popup at the end of loading on phones. The game is 645 MB, and its page kept copying it in memory (2–3 copies at once), more than a phone's browser allows. It now keeps the downloaded parts as files the browser can store on disk, 3 at a time, so only the game's own copy has to fit in memory. It's still very big, so phones and tablets get a heads-up before the download, and a plain message instead of a popup if they run out of memory anyway.
- The loading bar no longer counts a game's own joined files a second time.
- **Into The Pit no longer gets stuck on a broken download.** If one of its pieces was cut off mid-download, the page used to save the broken copy and fail on every load after that ("section extends past end of the module"). It now checks every piece's exact size, downloads short ones again, never saves or reuses an incomplete copy, and ignores copies saved by the old page.

## October 25, 2026 — 10 new library games, washed

### New
- **10 games the library added after its clean version are now playable:** Friday Night Funkin Vs. Dave and Bambi v3, Five Nights at Freddy's: Into The Pit, Sally Face, Gamble With Friends, The One Fish, Chain-Chillas, Wolfenstein 3D, ROAM0120.EXE, Sugary Spire Exhibition Night: Pizzano's Awesome Night Mod, and Pet The Cat.
- Each was **washed** before going live: its page was checked and cleaned, the code of every outside repo it loads its game from was scanned, and those repos were locked to the exact version that was checked, so they can't be swapped for something else later. The cleaned pages live in `washed/` and are listed in `config/library-washed.json`.
  - Dave and Bambi v3 still had the malicious ad script in a new disguise (it loads `cdn.r9x.in`), plus three trackers. All removed. The other nine pages were clean.
- `tools/wash_library_games.py` does all of this for future new games, and stops on anything suspicious instead of saving it. The new-games checker no longer lists washed games.

## October 25, 2026 — SpiderDoll works again

### Fixed
- **SpiderDoll** never got past loading. It had two problems, both in the game library's copy (so it was broken everywhere, not just here):
  - Its game files are split in two halves. The page downloaded and joined them, then told the game to load files with the unsplit names, which don't exist. The site now points the game at the joined files. This fix applies to any game with the same mistake.
  - A Newgrounds plugin inside it reads every stylesheet on the page when it starts, and crashed because the game's stylesheet comes from another site. Games now get an empty list instead of a crash, which helps any other game with that plugin too.
- The loading bar no longer counts those joined files twice.

## October 23, 2026 — A better loading bar

### Changed
- **The percentage no longer jumps backwards.** Games often start a second or third download partway through, which used to make the bar hit 99% and then drop. The site now remembers how big each game was the last time it loaded on this device, so later loads show a steady, real percentage and time left.
- **Every file counts.** Scripts, images, sounds and other files a game loads now count toward the total, not just some of its downloads.
- **It no longer says "ready" too early.** It waits until the game's page has finished loading, and nothing has downloaded for a moment.
- **It says what's happening:** which source the game is coming from, when it switches to a faster one, download speed, time left, when the network has stalled, and how long the game took once it's ready.
- **New look:** the loading screen uses your site style's accent color with the game's cover, and the bar over the game shows the cover, a big percentage and a moving shine.

## October 22, 2026 — Games open faster

### Changed
- **Games no longer wait on a blocked source.** Games load from several sources (jsDelivr, GitHub, githack, and backups). Before, the site tried them one at a time and waited up to 30 seconds on each, so a source that a school filter silently blocks could stall a game for half a minute or more. Now, if a source hasn't answered in 2.5 seconds, the next one starts too, and whichever answers first is used.
- **Blocked or slow sources are remembered for 6 hours**, across visits, instead of only until the tab closes, so later games skip them right away.
- **Resting the mouse on a game starts loading it**, so it often opens almost instantly when clicked.
- The page connects to the game sources early, while it's still loading.

## October 22, 2026 — Action log

### New
- **Log tab** in the Admin Panel: who suspended or unsuspended someone, made or removed a mod or admin, or removed ratings or submissions, and when. Searchable by name. Only admins can see it, and entries can't be changed or deleted from the site.
- Suspensions and role changes **can't skip the log**: Firebase only accepts them when they're saved together with their log entry.
- **Firestore rules publish themselves** when `config/firestore.rules` changes on GitHub (needs the `FIREBASE_SERVICE_ACCOUNT` secret).

## October 22, 2026 — Mods, and the owner can't be removed

### New
- **Mod role.** Mods get a **Mod Panel** with Accounts (view-only), Reports & ideas, and Game submissions. They can't suspend anyone, remove ratings, handle takedowns or change anyone's role. Admins make someone a mod from Admin Panel → Accounts → **Make mod**. Mods show a purple badge, and there's a "Mods" filter.

### Changed
- **The site owner is locked in.** When the owner saves their GitHub token in the Owner Panel while signed in, the site writes that account into `config/firestore.rules` as the owner by itself. Publish the rules in the Firebase console to finish. The owner is always an admin, and nobody can remove or suspend them.
- **Only the owner can add or remove admins.** Admins can still add and remove mods.
- Takedown requests stay admin-only, since they include people's contact info.

## October 21, 2026 — Lighter effects, and only the style you use is loaded

### New
- **Lighter effects** (Settings → Look → Layout): pauses moving backgrounds and other endless animations (scenes, the aquarium's fish, bubbles, blinking lights). One-time animations like cards appearing still play.
  - **Auto** (the default) turns it on by itself if this device seems to struggle. After the page settles it watches how smoothly the screen updates, twice, and only acts if both checks are clearly choppy. A short note says when it does. Devices with very little memory or only two processor cores start with it on, with a one-time note saying why.
  - **On** and **Off** override Auto.

### Changed
- **Each site style's look is now its own file** (css/skins/), and only the one you're using is downloaded. The main stylesheet went from 352 KB to 186 KB, so every page load has less to read, and hovering over cards takes about 20–25% less work. The saved style still loads before the page appears, so it never flashes, and a style's file starts loading as soon as you point at it in the picker, so switching is instant.

## October 21, 2026 — Much lighter on the graphics chip

Having the site open no longer makes the rest of the browser (other tabs too) choppy. The screen was being redrawn 60 times a second even when nothing was happening, and on some scenes it had to redo large blurs every time. Counting screen redraws per second with the page sitting still:

| | Before | After |
|---|---|---|
| Default style | 60 | about 2 |
| Space scene | 54 | 17 |
| Snowfall scene | 60 | 30 |
| Aquarium | 60, plus about 1,260 repaints | 21, no repaints |
| Arcade | 60 | 6 |
| Frutiger Aero | 60 | 17 |

### Changed
- **Background animations run at 15 frames a second** (30 for falling snow, rain, shooting stars and other quick things) instead of 60. They drift slowly, so they look the same.
- **The shimmer on Today's pick and the pulsing status light** play a few times when the page opens, then rest. Looping forever kept the whole screen redrawing.
- **Scenes no longer use large blur filters** on their glowing clouds (Nebula, Aurora, Lava, Pastel dream, Spirit aura). The glows already fade out softly, so they look nearly the same.
- **Fewer frosted-glass effects:** the search box and header buttons no longer blur again on top of the already-frosted header, the dark backdrop behind popups is plain, and Frutiger Aero's cards keep their glassy look without a live blur.
- **Aquarium:** the fish draw at half resolution, 24 times a second. The cards no longer bob (they lift and glow when you point at one instead), and the light rays and water edge hold still.

## October 20, 2026 — Faster site, especially on slower computers

### Changed
- **All games builds cards as you scroll** instead of all ~1,800 at once, so the page holds about 4,400 elements instead of 24,500. Hovering, scrolling and the animated styles are much smoother. The scroll-to-bottom button and the browser's find (Ctrl+F) build the rest first, so they still reach every game.
- **Pop-up book:** cards now spring up once as they come into view, instead of running 1,800 scroll-linked animations all the time. Scrolling no longer freezes for over a second at a time on slow computers.
- **Aquarium:** the game list no longer takes up to a minute to finish loading. The fish draw about 30 times a second instead of 60, hold still while you scroll, and use cheaper glow effects. The light rays are a separate layer that costs almost nothing, and fewer cards bob.
- **Arcade and Aquarium:** the chasing bulbs and the water's edge move without making the browser recheck the page every frame. With either style open and nothing moving, the computer now does a fraction of the work.

## October 20, 2026 — Scene pickers follow the site style

### Changed
- Settings → Look only shows **Scenes** and **Your own background** when the Default or Glass style is on, since the other styles draw their own backgrounds. With any other style, a short note says why they're hidden. They come back as soon as you switch to Default or Glass.

## October 19, 2026 — Aquarium, Arcade and Pop-up book

### New
- **Aquarium** style: fish, glowing jellyfish, light rays, bubbles and swaying seaweed swim live behind the page. Games float in glass cards that bob gently, and bubbles rise from the one you point at. The header is the rippling water surface and the footer is the sandy bottom. The animation stops while a game is open or the tab is hidden, and holds still with reduced motion.
- **Arcade** style: every game is an arcade cabinet with a backlit marquee, a CRT screen with scanlines and a joystick and buttons. Point at one and the screen brightens, INSERT COIN blinks and the joystick tilts. Chasing marquee bulbs line the header over a loud arcade carpet.
- **Pop-up book** style: the page is an open storybook on a desk. Games are paper cut-outs that fold up off the page as you scroll to them, with their names on paper ribbons.

## October 19, 2026 — Vending machine, Art museum, Receipt and Subway map

### New
- **Vending machine** style: games sit on metal coils behind glass in a red machine. Each has a slot code and a price on a green display (more-played games cost more). Point at one and it tips forward off its coil. The search box is the machine's display.
- **Art museum** style: every game hangs in a gold, wood or silver frame under its own little spotlight, with a placard below it.
- **Receipt** style: the page is a long torn store receipt. Games are line items with prices, the rows at the top are clip-out coupons, and there's a barcode at the end.
- **Subway map** style: games are stations on colored train lines, one line per row, with "Mind the gap" in the footer.

## October 19, 2026 — Trading cards, VHS shelf and Patches on denim

### New
- **Trading cards** style: each game is a collectible card on a felt table. Rarity comes from real play counts over the last year (top 2% Legendary, next 8% Epic, next 20% Rare, the rest Common). The holo foil follows your pointer, and cards tilt slightly unless reduced motion is on. Games outside the main library have no play counts, so they show as Common.
- **VHS shelf** style: games stand as tape spines on wooden shelves. Hover or tab to one and it slides out to show the cover.
- **Patches on denim** style: games are sewn-on patches in five colors on denim, with a stitched leather header.

## October 19, 2026 — Minimalist, Semi-Flat, Neumorphism and Cyberpunk

### New
- **Four more site styles** (23 in all), in Settings → Look → Site style:
  - **Minimalist**: lots of space and no boxes or shadows; games are just the cover and the name. Uses your color theme and follows light/dark mode.
  - **Semi-Flat**: friendly flat colors in your theme color with soft shadows and rounded cards. Follows light/dark mode.
  - **Neumorphism**: soft gray buttons and cards that look pressed out of the page, and press in when tapped.
  - **Cyberpunk**: hazard yellow, hot pink and cyan on black, with angled cuts, hazard stripes under the header and a logo glitch when you point at it (off with Reduce motion).
- Glassmorphism and Neo-Brutalism are already here as **Glass** and **Bold**.

## October 18, 2026 — 5 more site styles

### New
- **Five more site styles** in Settings → Look → Site style (19 in all):
  - **Sci-fi HUD**: a spaceship console with dark glass panels, cut corners, cyan outlines and corner brackets.
  - **Candy**: pastel pink with sprinkles, extra-round cards and squishy jelly buttons that bounce.
  - **Fantasy quest**: a stone wall with parchment cards in gold frames and red wax-seal buttons.
  - **Web 1999**: an old-school starry homepage with a rainbow logo, glowing table borders and blue underlined links.
  - **Spreadsheet**: looks like a work spreadsheet, with gridlines, a formula bar and cells.
- Sci-fi HUD and Candy use two fonts that come with the site (Orbitron and Fredoka, both free licenses).

## October 18, 2026 — Dock site style

### New
- **Dock** site style (Settings → Look → Site style): a coral top bar with the GN 2.0 logo, a dark desktop, and a dock along the bottom with Games, Search, Your games, Random, Find a game, Account and Settings, plus the status light and a clock and date. Tap the status light for details. The panic button stays in the top bar. The dock hides while you play a game.

## October 18, 2026 — Readable footer and a scroll button

### New
- **Scroll button** in the bottom-right corner: jumps to the bottom of the page (it keeps up while All games is still filling in), and turns into **back to top** once you're there. It hides while a game is open.

### Fixed
- The footer links (DMCA, Terms, Changelog…) had no background, so they were hard to read on top of scenes and backgrounds like Frutiger Aero's grass. The page was missing the footer's opening tag; now the footer has its own bar in every theme, and its links use the theme's main text color. Checked in all 533 style, theme and scene combinations.

## October 18, 2026 — New Frutiger Aero background

- **Frutiger Aero** has a new, realistic-looking background: a sunny sky with fluffy clouds over a water line, and underwater light rays, bubbles, distant fish and deep grass below. The drifting bubbles stay underwater. It's painted by code that comes with the site (`tools/paint_aero_background.py`), with no outside photos, so it can't get a copyright claim.

## October 18, 2026 — Frutiger Aero

- The **Aero** site style is now a full **Frutiger Aero** look: a bright blue sky with clouds and a sun glare, rolling green hills, sweeping light streaks, bubbles slowly drifting up behind the page, frosted glass cards, and glossy green and aqua orb buttons. The bubbles stay still with Reduce motion and while a game is open.

## October 18, 2026 — 5 new site styles

### New
- **Five more site styles** in **Settings → Look → Site style** (12 in all), each changing fonts, buttons, cards and the header:
  - **Chalkboard**: chalk handwriting on a green classroom board with a wooden frame.
  - **Blueprint**: white lines on blue drafting paper with a grid; cards light up in yellow when you point at them.
  - **Aero**: glossy 2000s sky with shiny bubble buttons.
  - **Neon sign**: glowing pink and cyan tubes on a dark brick wall, with a script logo that flickers on (it stays still with Reduce motion).
  - **Handheld**: a 4-shade green handheld game screen; game covers turn green until you point at them.
- Chalkboard and Neon sign use two fonts that come with the site (Gochi Hand and Yellowtail, both free licenses), so they look the same on Chromebooks and phones and can't be blocked by school filters.

## October 18, 2026 — Readable search text

### Fixed
- Typed text in the search box was nearly invisible with the **Glass** site style (dark see-through text on a see-through box) and invisible with **Notebook** (white on white) while typing. Both now keep readable text in every color, mode and scene. Checked across all 328 style, theme and mode combinations.

## October 18, 2026 — Ro16

- **Ro16 [DEMO]** added to UBZone games (91 now). It's a big game (about 300 MB) that needs browser features the normal player can't give it, so it opens in its own tab. The first load takes a while; after that the browser keeps a copy.
- Like the other UBZone games, it only loads the checked version of its files, and it can't send anything anywhere: every web request except its own game files is blocked.

## October 18, 2026 — UBZone games in the status light

- The **status light** has a **UBZone games** row: whether their list loaded and whether their files can be reached from your network. It turns yellow if they can't.
- The **GN Status** page now tracks the UBZone games list, every repo their files come from (at the checked versions), and the three backup jsDelivr addresses (Fastly, G-Core, Cloudflare) the site switches to when jsDelivr is blocked.

## October 17, 2026 — Takedowns for UBZone games

- **Takedown requests now link UBZone games back to their original repos.** When someone picks a UBZone game on the takedown form, it shows the GitHub repos the game's files come from, with a link to GitHub's DMCA form, so the owner can have the files themselves taken down too. Admins see the same links on the request in Admin Panel → Takedowns.
- Each UBZone game's **Info** panel lists its original files and has a "Send a takedown request" link.
- The DMCA page explains UBZone games and where their files are hosted.

## October 17, 2026 — 48 more UBZone games

- **48 more UBZone games** (90 in all), including Bendy, Undertale, Subway Surfers, Minecraft P.E, Bloodmoney 2, Brotato, C.S. 1.6, GDWEB+, Wave Dash and 15 more FNF mods.
- These load files from other repos too. Each of those repos is now pinned to the exact version that was scanned, so the games can't pick up later changes.
- Game pages with Google Analytics or ad-bidding tags have them removed before the game runs.
- 15 are still left out: ad code built into the game, Yandex redirects, developer site locks, deleted repos, Unity files that load more code from a branch, a broken file, a missing file and the two Epstein games.

## October 17, 2026 — UBZone games

- **42 new games from unblockedzone**, including 13 Eaglercraft versions and clients, 10 FNF mods, Baldi's Creepy Run, Where's Baldi, Infinite Craft and 3 Scratch games. Choose **UBZone games** under Source to see just them.
- Each one was checked first: every game file and the outside folders they load were scanned for the October 11 script, trackers, ads and hidden data calls. The games load only that checked version, so later changes to their site can't reach GN 2.0.
- Of that site's 187 games, 79 were already here. 66 of the other 108 weren't added: they had trackers or ads, loaded code that could change at any time, had a missing file, or (two of them) were kidnapping/abuse joke games.

## October 17, 2026 — Takedown requests and updated Terms

- **Takedown requests go to the admins.** Game owners can send a copyright takedown request from the DMCA page, the Terms, or a game's ⋯ menu ("Copyright takedown…"), with no account needed. Requests show up in Admin Panel → **Takedowns**, where admins can check the proof, reply by email, and **Remove game**, which hides it for every visitor within about 10 minutes (no GitHub token needed). Removed games can be restored.
- **Terms of Use updated:** no-affiliation notice, third-party content, the takedown process, and a clearer "as is" / limitation of liability section. The DMCA page now points to the request form.
- Needs the new `takedowns` and `removals` rules in `config/firestore.rules` published in the Firebase console.

## October 17, 2026

### New
- **3 more backup game sources.** Besides jsDelivr, GitHub and githack, games and pictures can now also load from jsDelivr's backup addresses on other networks (fastly.jsdelivr.net, gcore.jsdelivr.net and testingcf.jsdelivr.net). School filters that block the main jsDelivr address often miss these, and the site switches to them by itself. Games that load their own files from jsDelivr are pointed at a working backup too.


## October 16, 2026

### Fixed
- With a site style like Glass on, the scene previews in Settings lost their pictures and turned into blank gray pills. They now keep their picture and readable labels in every style.

### New
- **Site styles** that change how the whole site looks, not just its colors: fonts, buttons, cards and the header. In **Settings → Look → Site style**: **Glass** (frosted see-through panels, works with any color or scene), **Hacker terminal** (green text on black with scanlines), **Retro desktop** (gray 90s computer windows), **Bold** (thick black outlines and bright blocks), **Notebook** (lined paper, taped photos and sticky notes), **Pixel** (chunky 8-bit game style) and **Comic book** (halftone dots and speech bubbles). Default keeps the normal look.
- **Your own background.** In Settings → Look → Your own background, paste a link to any picture or GIF and it becomes the site's background, with no download needed (handy on school computers that block downloads). You can also pick a picture from your device. A **Darken** slider keeps the text readable. Only you see it; it's saved on your device and in your cloud save.
- **Spirit aura** scene: swirling blue and purple energy with flickering wisps and sparks.
- **Scene themes** with animated backgrounds, in **Settings → Look → Scenes**: 🌌 **Outer space** (twinkling stars, a planet and shooting stars), 🌀 **Andromeda** (a glowing spiral galaxy that slowly turns), **Nebula** (drifting pink and teal clouds), **Aurora** (northern lights swaying), **Retro sunset** (a striped sun over a moving neon grid) and **Deep sea** (light rays and rising bubbles). Cards and panels turn see-through so the scene shows behind them. Then 9 more: ✨ **Starry night** (lots of stars, a crescent moon, shooting stars), 🕳️ **Black hole** (a spinning ring of glowing gas), 🪐 **Saturn** (a floating ringed planet), ❄️ **Snowfall** (snow over mountains), 🌸 **Cherry blossom** (falling petals), **Firefly forest** (blinking fireflies among trees), 🌆 **Neon city** (a glowing skyline in the rain), 💻 **Code rain** (green code pouring down) and 🌋 **Lava** (rising lava-lamp blobs). Plus ☀️ **Sunny sky**, ☀️ **Autumn leaves**, ☀️ **Pastel dream**, ⛈️ **Thunderstorm**, 🎃 **Halloween** and 👾 **Retro arcade**, and pattern scenes that aren't landscapes: 🎊 ☀️ **Confetti**, 🌊 ☀️ **Wavy** (rolling color bands), 🌈 **Prism** (a turning rainbow kaleidoscope), 🐝 **Honeycomb** (glowing gold hexagons) and 🎮 **Game icons** (controllers, trophies and gems floating up). Snowfall and Autumn leaves are just the falling snow and leaves, without hills or trees. The ☀️ scenes are bright with dark text; the rest are dark. The picker is grouped into Space, Sky & weather, Patterns and Fun. Scenes pause while you're playing a game or the tab is hidden, and hold still with Reduce motion. The owner can also pick one as the default for new visitors.
- **Animations.** Switching dark/light mode now spreads out in a circle from where you clicked, and theme colors fade into each other. Each header button has its own little move (the gear turns, the dice rolls, the sparkle twinkles, the panic button shakes). Game covers get a light sweep when you hover them, buttons press in when clicked, the favorite star pops, popups shrink away when closed, tabs fade in, the toggles spring, Today's pick's Play button shimmers, and the All games section slides up as you scroll to it. Turn on **Settings → Look → Reduce motion** (or your device's reduce-motion setting) to switch them all off.


## October 15, 2026

### Changed
- **Nicer scrollbars.** The page's scrollbar (and the ones inside panels and lists) is now slim and rounded, in your theme color, with a track that matches dark or light mode. It gets brighter when you hover or drag it.


## October 14, 2026

### Changed
- **Admins can see what each account did.** Opening an account in Admin Panel → Accounts now lists the games it liked, disliked and reported as broken (with dates), plus the reports and ideas it sent. Each game can be opened, and a single rating or broken report can be removed without wiping all of that person's activity.
- **Settings are reorganized.** They're split into four tabs (🎨 Look, 🎮 Games, 🛡️ Privacy, ⋯ More) with a search box that finds any setting, one tidy row per setting with a short explanation, and on/off switches instead of checkboxes. Settings opens on the tab you used last. Report a problem, ideas, submitting a game and export/import are under More, and the Admin and Owner Panels are tucked into a Staff section there.

### New
- **Report a problem and Suggest a feature.** Signed-in players can report a broken game, a site bug, ads or inappropriate content, or something else, and suggest features. Find them in the footer, in Settings, in the game player's ⋯ More menu (the game is filled in for you) and in the status light. You can see what you sent and what the mods replied, and withdraw anything not reviewed yet.
- **Mod review.** Admins get a **Reports & ideas** tab in the Admin Panel with a count of what's waiting. Reports can be confirmed, marked fixed or rejected; ideas approved, marked done or rejected, each with a note the sender sees.
- **Ideas board.** Approved ideas show on a board where signed-in players can vote, so the most-wanted ones rise to the top.

### Changed
- **Games are saved before the site locks.** If someone is in the middle of a game when the site is locked, put in maintenance or shut down, the game is asked to save first (the same way it would if the tab were closing, including Unity games' saves), then it's closed and the save is uploaded to their account if they're signed in. The lock screen shows "Saving your game…" and then "✓ Your game was saved to your account" (or "on this device" for people without an account).
- **Locking the site no longer locks the owner out.** When the owner switches to Locked, Maintenance or Shut down, they keep using the site with a bar at the top that says what visitors see and whether the change has reached them: *Saving to GitHub…* → *Saved, waiting for visitors to get it* (with a timer) → *Live: visitors are getting this*. The bar has **Preview screen** (see exactly what visitors see), **Reopen site** and **Owner Panel**. The same progress shows under the mode in the Owner Panel. "Owner access" on the lock screen now lets the owner in without reopening the site for everyone.


## October 13, 2026

### Fixed
- **Locking, maintenance and shutdown now reach everyone reliably.** People already on the site used to keep using it until they reloaded; now open pages check for owner changes about once a minute and show the lock, maintenance or shutdown screen by themselves. Switching quickly between Locked, Maintenance and Shut down in the Owner Panel could also fail to save (GitHub rejected the second save), so the site stayed on the old setting. Saves now go one at a time and retry, and an old cached copy of the settings from a backup source can no longer undo a newer change.

### Changed
- **Owner-change checks pace themselves.** Open pages normally check about once a minute, but slow down by themselves when GitHub says it's getting too many requests (or is close to its limit), and when lots of people are online, since a whole school often shares one network and GitHub's limit is per network. They speed back up once things are fine. Tabs in the same browser share one check instead of each making their own.
- **Firebase use paces itself too.** The free Firebase plan has a daily limit for the whole site, and when it runs out, accounts, ratings and the online count stop for everyone until it resets. Now ratings and the online count refresh less often when lots of people are online. If Firebase says the limit was reached, those features pause and try again later (15 min, then 30, 1 h, then every 2 h) instead of retrying over and over. Cloud autosave no longer contacts Firebase when nothing on this device changed, and tabs in the same browser share one online heartbeat and count. A new **"Database use"** row in the status light shows the current pace, or that it's paused and when it'll try again.
- **Firebase usage is counted.** Every browser counts the Firebase reads and writes it makes today and sends that with its online heartbeat; the site adds them up, and the "Database use" row shows about how much of the daily limit is used and when it resets. Background updates now go by that: normal speed while there's plenty left, slowing down just enough for the rest to last until the reset (at most 4 times slower), and pausing only at about 97%. Rating, saving and signing in always go through. Needs the updated `config/firestore.rules` published in the Firebase console; until then it goes by how many people are online instead.
- **"Live updates" in the status light.** It shows how often this page is checking for owner changes right now, and if it's slowed down or paused, why (lots of people online, close to or over GitHub's request limit, or trouble reaching GitHub).


## October 12, 2026

### New
- **Site status light** in the bottom-left corner. Green means everything's working; yellow or red means something isn't, like a game source being blocked or accounts not connecting. Click it to see each part of the site (your connection, game library, GN Originals, accounts and saves, partner games). The owner can also set a status by hand, such as "Maintenance". It hides while you play, and you can turn it off in Settings.
- **People online now.** The status light shows how many people are on GN 2.0 and GN Light right now (anyone with the site open in the last 5 minutes), and the GN Status page has a "People online now" number too. No account needed and nothing personal is stored: each open tab just sends a random id and the time every 2 minutes.
- **Maintenance mode.** Besides Locked and Shut down, the owner can now show a "Down for maintenance" screen, and set an **expected back time** that shows on the lock and maintenance screens with a countdown ("in 42 min").
- **New lock and shutdown screens.** They now say what's going on, can show a message from the owner, and **open by themselves** when the site is back (they check every minute, or tap Check now), so nobody has to keep reloading.

### Fixed
- The status light could say GitHub or githack were unreachable when they were fine. A cover picture that didn't load (often just a missing picture) counted as the whole source being down, and it stayed "down" for the rest of the visit. Now the light checks the source with a tiny file first, and re-checks sources marked down once a minute, so it matches the GN Status page.

### Changed
- **Announcement banner redesigned.** It has an icon and four styles (announcement, good news, heads up, important), links in it can be clicked, and you can close it. A new or changed announcement shows up again.
- **1,976 more partner games from Playgama**, uploaded there by their own developers: 3D, puzzle, racing, shooting, simulation, idle and more. Like the html5games.com games, they play from Playgama's own site, may show Playgama's ads, and are marked **AD**. Only games without in-game purchases are included, and copies of big brands were left out. GN 2.0 has no Playgama account and earns nothing from them. If Playgama is blocked on your network, its games are hidden automatically while the others stay.
- **Duplicate check.** Games with the same name in more than one place were compared one by one (developer, description and the game files). 10 html5games.com games and 11 Playgama games that are the same game as one in the library are hidden, so the ad-free copy is the one you see. Same-name games that turned out to be different (for example two different games called Slope, Snakes, Bottle Flip or Zop) are all kept.

### Changed
- Privacy Policy and Terms updated for Playgama.

### Fixed
- Opening a game while another is still open (for example with the 🎲 button in the player) no longer breaks the new game. Each game now gets a fresh frame, so leftovers from the last game can't clash with it.

### Fixed
- **The site no longer freezes right after it opens on slow computers like school Chromebooks.** In the first few seconds, play counts, ratings and the partner-games check each finished at different times, and each one rebuilt every game card on the page. That froze slower computers 3 to 5 times in a row, often just as you clicked a game. Now:
  - they share one redraw, and nothing is redrawn while a game is open (it catches up when you close the game);
  - All games draws the first screenful right away and the rest in small pieces when the browser is free;
  - favorites, play time and hidden games are read once per redraw instead of several times per card;
  - card pictures share one watcher instead of piling up a new one every redraw.
  On a computer slowed down to Chromebook speed, freezing in the first 15 seconds dropped from 3.7 s to 1.2 s, and the longest single freeze from about 1 s to 0.3 s.

## October 12, 2026

### New
- **3 more Godot games:** Gobot, a big third-person shooter by GDQuest (it takes a while to load), Squash the Creeps and Kenney's Match 3.
- **7 modern 3D games** in GN Originals: Kenney's 3D Platformer, Racing, Blaster Arena (FPS) and City Builder, plus Godot's Robot Platformer 3D, Truck Town and Voxel World. They're open source (MIT, with CC0 or CC BY-SA art) and run straight in the browser.
- **135 new WebAssembly games in GN Originals**: 120 tiny retro games for the WASM-4 fantasy console (under a new **WASM-4 retro games** Source filter), 14 games by raylib's creator (Koala Seasons, Dr. Turtle & Mr. Shark, Skully Escape, Retro Maze 3D and more), and the platformer Inovation 2007. All are open-licensed and credited in the game's Info panel.
- **Alerts for new library games.** When the game library adds a game that isn't in its clean version, admins and the owner get a notice when they open the site, and a new **New library games** tab in the Admin Panel lists them with a "Mark checked" button. A GitHub Action also checks every 6 hours and opens a GitHub issue on this repo (so the owner gets a GitHub notification) listing the games to check.

## October 11, 2026

### Fixed
- **Blocked a malicious script in the game library.** Early on October 11 the outside game library was changed so every game included a hidden ad script that could change your tab title and show a popup asking you to install an "EZ Block" extension (don't install it). GN 2.0 now loads library games from the last clean version of the library (October 10), and refuses to run any game file that contains that script.
- Games the library adds after October 10 are hidden for now, since they only exist in the infected versions. New games will be checked and added one at a time instead.

## October 9, 2026

### New
- **GN Light** link in the footer: a separate, much faster version of the site for slow computers (same games, no accounts or ads).
- **About 320 partner games from html5games.com**, including Temple Blocks, Cut the Rope 2, Om Nom Run, Moto Fury, Defly.io, mahjong, solitaire, sports and puzzle games. html5games.com lets websites share its games for free on the condition that the games keep their ads, so:
  - each partner game has a yellow **AD** badge on its card and a "May contain ads from html5games.com" notice above the game;
  - they play from html5games.com's own servers in a sandboxed frame that can't take you away from GN 2.0;
  - a new **Partner games switch** above All games hides them all, and they're under their own **Source** filter;
  - if html5games.com is blocked on your network, they're hidden automatically (the switch says why);
  - they're never Today's pick. GN 2.0 itself still has no ads and earns nothing from these.

### Changed
- **Privacy Policy and Terms updated** for partner games: what loads from Famobi, that their ads and cookies follow Famobi's own privacy policy, and that GN 2.0 shares nothing about you with them.

### Fixed
- **The site is much less laggy.** With nearly 2,000 games, opening the page was freezing the browser for up to 3 seconds. Cards that are far off screen are now skipped until you scroll to them, only the first screenful animates in, and the scrolling rows measure themselves at most once per frame. Page load work dropped from about 3.2 s to 0.2 s in testing, and typing in search no longer stutters.
- **Color Match** (and any other game whose file has the same problem) no longer crashes with a Unity "null function" error. Its file in the game library contains the whole page twice, which started the game twice; the site now keeps only the first copy.
- Your account name no longer shows up in the search box when the site opens. Some browsers ignored the earlier fix, so the search boxes now stay locked until you click or tap into them, and any text the browser adds before you type is cleared.

### New
- **Two GitHub Game Off games**: Strider (side-scrolling action) and Escape Space (a brick-breaking puzzle game).
- **Admin Panel** (Settings → Admin Panel, or 🛡️ in your Account panel if you're an admin; admins get a blue dot on the account button). It lists every account with when it joined, when it was last seen, and its ratings, reports and submissions, with search and filters. For each account an admin can:
  - make or remove a **game admin**;
  - make or remove a **trusted reporter** (needs the owner's GitHub token on that browser);
  - **suspend** the account with a reason it will see (it can still play and keep its saves, but can't rate, report or submit);
  - remove all of its ratings and reports;
  - delete its submissions.
  The panel also has a Game submissions tab. All of this is enforced by the database rules, not just the page.
- **Submit a game** (in the footer and in Settings). Signed-in players can send in a game they made or that's free to share: name, link, creator, how it can be shared, genre and a short description. They can see its status (waiting, approved, added or not added) and any note from the owner, and can withdraw it while it's waiting. The owner reviews submissions in a new **Game Submissions** section of the Owner Panel.
- **41 more js13k games**: the 3D and VR games that needed shared libraries from the contest's server. GN 2.0 now hosts A-Frame and three.js itself, so these run, bringing the js13k games to 667 and the site to about 1,570 games.
- **Game jam games switch** above All games. Turn it off to hide all the js13k game jam games from the lists, search, the game finder, the random game button and Today's pick. It's saved on your device.

### Changed
- Privacy Policy updated for game submissions. Deleting your account now also deletes your submissions.
- **A much smarter ✨ Find me a game.**
  - Every one of the 1,500+ games now has a short description, genres and theme keywords, so the finder understands what a game actually is, not just its name.
  - It handles **themes** ("zombies", "cats", "space"), **moods** ("chill", "funny", "hard", "cute"), **what you don't want** ("nothing scary", "shooter but no zombies") and **"like <game>"**, which compares genres and themes (for example, "games like Slope" finds Slope 2, Tunnel Rush and Rolling Sky).
  - Opening it shows **picks for you** based on what you play, or popular games if you're new.
  - Each result shows what the game is, why it was picked and a **More like this** button.
  - **Narrow it down** chips (not played yet, 2 player, quick, popular, relaxing, no horror) and **Show more** results.
  - Your recent searches are kept as chips.
- **Genre filters are far more accurate**, because they now use each game's real genres instead of guessing from its name.

## October 8, 2026

### New
- **✨ Find me a game** (new button in the header). Describe what you feel like playing, like "scary game I haven't played", "racing games with friends" or "something like Geometry Dash", and it suggests games with the reasons it picked them. It runs in your browser, and nothing you type is sent anywhere. Typing a long sentence in the search box also offers to send it to the finder.
- **Random game options.** Hold (or right-click) the 🎲 button to choose what it picks: genre, source, only games you haven't played, only favorites, only well-liked games, skip broken games, or use your Sort & filter choices. A normal click then uses those options, and the button gets an outline so you can tell they're on.
- **More filters** in Sort & filter:
  - **Genre**: 17 genres, such as Horror, Racing, Puzzle, Shooter, Sports, Music and 2 player, each showing how many games it has. Genres are matched from game names and tags, so a few games may land in an odd genre or none.
  - **Source**: main library, GN Originals or js13k tiny games.
  - **Show**: not played yet, played before, favorites, hide games flagged broken, or well liked (80%+ 👍).
  - **Type** (formerly Tag) now has proper names, such as "Nintendo DS" and "FNF mods".
  - The menu uses two columns on wider screens, and Reset clears everything.
- **Trusted reporters.** The owner panel can mark accounts as trusted. One broken report from a trusted account flags the game for everyone right away, and the card says "⚠ Reported broken". Reporting the game again removes the flag.
- **626 tiny games from the js13kGames competition**, where each whole game fits in 13 KB. They're under the new **js13k (tiny games)** tag and in All games, and the site now has over 1,500 games. Only entries with an open license that ran in the site's player were added; every game's Info panel credits its creator and license.
- **3 more GN Originals** from the leereilly/games list: Particle Clicker, Pond and Emberwind.
- **No duplicate 2048.** It's in both the main library and GN Originals, so only the library copy shows. The GN Originals copy appears only if the library is down.
- **30 more GN Originals** (63 in all), including Trimps, Bubble Shooter, Match 3, Space Huggers, Drakonas, BitBot, Dental Defender, Drunken Viking, Raging Gardens, Monster Wants Candy, Turkey Cooking Simulator and three LittleJS games. Like the first batch, each one was tested in the site's player and keeps its creator's license and credit.
- **GN Originals**: 33 open-source games in their own row on the home page, including 2048, Hextris, HexGL, A Dark Room, Untrusted, Elevator Saga, Flexbox Froggy, Radius Raid and Clumsy Bird. They're kept with their licenses in a separate repo, [SCHSwork/GN-originals](https://github.com/SCHSwork/GN-originals), and you can also find them with the **GN Originals** tag.
  - Each game's Info panel shows who made it, its license and a link to its source code.
  - They load through the same three backup sources as the rest of the site, and they still show up if the main game library is down.
  - Every game was tested in the site's player. Small fixes keep them working there: buttons that would have taken you off the site open in a new tab, and some outside scripts (a remote script in Hextris, plus the Clay.io and Facebook SDKs in Zop and Parity) were removed.

### Fixed
- Chrome no longer fills your saved username into the search box when the page loads. The box is now marked as a search field, which password managers skip. As a bonus, pressing **Esc** in the search box clears it.

## October 7, 2026

### New
- **Change password** in the Account panel. It asks for your current password first.
- **Keyboard shortcuts list.** Press **?** or use the footer link. `/` jumps to search, the panic key leaves instantly, **Esc** closes panels and dialogs, and **← →** scroll a row of games once you Tab to it.
- **GN 2.0 icon.** The site has its own red "GN" icon for the tab, phone home screens, and when it's installed as an app (named "GN 2.0"). The tab cloak still comes first: when it's on, the tab shows the cloak's title and icon, and the GN icon appears only when the cloak is off.
- **Faster repeat visits and offline backup.** A small background helper saves game covers, so they load instantly next time. If you're offline, the site still opens with your saved game list.
- **Backup game sources.** The game list, cover images and games now load from three places: jsDelivr, then GitHub directly, then githack. If one fails, times out or is blocked by a school filter, the site switches automatically and remembers for the rest of the session. When jsDelivr is down, links inside games are pointed at the backups too. If every source is down, the last game list that loaded is shown with a notice.
- **Game of the Day**: one game is featured at the top of the page each day, the same for everyone.
- **Changelog**: this list. You can open it from the footer.
- **⋯ More menu** in each game's top bar: favorite, restart, game info, open in new tab, download, report broken, and **clear this game's data**. Clearing removes only that game's saves; other games aren't touched.
- **Smarter search**: handles typos ("geomtry dash"), missing spaces, accents and abbreviations ("fnaf"), shows the best matches first, and works together with the tag filter and sort menu.
- **My Stats** (in Settings): total play time, games tried, % of the library explored, and your top 5 most-played games.
- **NEW badges** on the 12 most recently added games, and a **Newest** sort option.
- **Broken reports in the owner panel**, most reported first, with one-click Disable/Enable.

### Changed
- **No more browser pop-ups.** The plain gray "This page says…" boxes are replaced by notices in the site's style that fade on their own, and proper confirmation dialogs with clear button names. Dangerous actions like deleting an account start on Cancel. When you sign in on a new device, the cloud-save question is now two clear buttons, **Keep this device's** or **Load my cloud save**.
- **Accessibility.**
  - Every button and setting has a name screen readers can announce.
  - Keyboard focus is clearly visible, including a full outline on game cards.
  - Panels move focus in and back out, and Esc closes them.
  - Low-contrast text (the red labels and the NEW badge) is now easier to read in every theme.
- **Site code split into files** (`css/styles.css` and `js/`). Nothing changes for players, but updates are safer and load reliably. A leftover setting that pointed parts of the page at the original gn-math site was removed.
- **Tidier header.** Sort and tag filter moved into one **Sort & filter** button, which shows a dot when something other than the default is selected. The search box has a magnifier icon and a `/` hint. On phones the header is two compact rows, and the tag filter is no longer pushed out of view.
- **The tab cloak now applies immediately.** Before, "GN 2.0" flashed in the tab for a moment while the page loaded.
- **Scrolling rows have no scroll bar.** Featured and Your games now show ‹ › arrow buttons when you hover over them, with a soft fade on the side that has more games. Touchscreens and trackpads can still swipe.
- **Cleaner home page.** Recent and Favorites are now one compact **Your games** row with a switch between them. Featured is a single scrolling row instead of a full grid. Game of the Day is a slim **Today's pick** strip. Section headings are simpler, long game names cut off after two lines, and each card shows one short info line (for example "186K plays").
- The site is now called **GN 2.0**.
- **Google Analytics is removed from every game** before it runs, and tracking sites are blocked.
- The Privacy Policy, Terms and DMCA pages were updated for GN 2.0, ratings, reports and the no-tracking change.
- Deleting your account now also removes your ratings and broken reports.
- The README was rewritten to describe the site as it is now.

### Fixed
- Removed a broken background-helper setup that caused an error on every page load.
- **Play counts now work for every game.** Before, games whose files have names like `33-ff.html`, including many of the most popular ones, showed no count, and only the top 100 files were read. Popular and Trending sorts are accurate now too.
- Clicking Close twice on a game no longer causes an error.

## October 6, 2026

### New
- **Accounts with cloud saves**: username and password only, no email. Game progress and settings sync every 2 minutes, when you close a game, and when you sign out. The site asks which copy to keep if another device saved newer progress.
- **Favorites** (☆ on any card) and **Recently Played** rows.
- **Play time** tracking shown on cards, plus a **My Most Played** sort.
- **👍 / 👎 ratings** (one vote per account) and a **Top Rated** sort.
- **Shared broken reports**: games with 3 or more reports in 14 days get a warning flag on their card.
- **Loading bar** with real progress, download size and time left for big games.
- **Panic button** (⚠ in the header or the <kbd>`</kbd> key) that jumps to a safe site. Both can be changed in Settings.
- **Random game** button (from the BETA branch).
- **New-visitor defaults** restored in the owner panel (theme, card size, sort and more).
- **Loading screen** with the game's cover while it starts.
- **`/` key** jumps to the search bar.
- **Privacy Policy** and **Terms of Use** written for this site, plus a **Delete account** option.

### Changed
- **Ads removed from games**: a hidden ad loader that showed a fake "Download VaultSearch" pop-up is stripped from every game, and ad networks are blocked.
- The owner panel now unlocks with a **GitHub token** instead of a password that anyone could read in the page source.
- Owner settings now sync to this repo (SCHSwork/math) instead of the old one.
- **Export / Import Data** now uses the same reliable format as cloud saves (old export files still import).
- The signed-in account button is now easy to see: a white icon with a green dot.
- The loading bar shows the game name and the progress on separate lines, so long names aren't cut off.

### Removed
- Leftovers from the original site: its Google Analytics, link-preview URLs, the "Play more games at gn-math.dev" pop-up, Discord links, the Discord and "[!] COMMENTS" tiles, and the Contact pop-up.

### Fixed
- Lock and shutdown modes no longer break on school networks. They used to stop working once a school's shared connection used up GitHub's hourly limit.
- The game list no longer fails to load for the same reason.
- Your GitHub token and owner settings are never included in exported save files.
- Games no longer open by themselves when you load the site.
