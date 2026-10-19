# Changelog

All the changes to GN 2.0, newest first.






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
