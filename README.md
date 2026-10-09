# GN 2.0

A single-page browser game site with no ads, no trackers, and optional accounts with cloud saves. It runs entirely on GitHub Pages and uses Firebase for accounts.

Most games come from the community-run gn-math library on jsDelivr. GN Originals adds about 690 open-source games: 65 hand-picked ones in their own row, plus 626 tiny js13kGames entries under the js13k tag. The hand-picked ones include 2048, Hextris, HexGL, A Dark Room, Untrusted, Trimps and Bubble Shooter. All of them are kept with their licenses in [SCHSwork/GN-originals](https://github.com/SCHSwork/GN-originals).

## Features

**Playing**
- **Today's pick** (game of the day) at the top of the page, the same for everyone each day
- **Smart search** that handles typos, missing spaces and abbreviations ("geomtry dash", "fnaf"), and works together with tag filters
- Sort by name, newest, date added, popular, trending, top rated or my most played
- Filter by **genre** (17 genres), **source** (library / GN Originals / js13k), **show** (not played yet, played, favorites, hide broken, well liked) and **type** (ports, Flash, emulators…)
- **NEW** badges on the 12 most recently added games
- **Your games**: one compact row that switches between Recent and Favorites (☆ on any card)
- **✨ Find me a game**: describe what you want ("chill puzzle, nothing scary", "games like Slope", "zombies") and get suggestions with reasons, plus picks based on what you play. It uses `config/game-info.json` (genres, a one-line description and keywords for every game), runs in the browser, and sends nothing anywhere
- **Random game** button (hold it for options: genre, source, unplayed only, favorites, skip broken)
- **Keyboard shortcuts** (press **?**) and full keyboard / screen-reader support
- **My Stats** (Settings): total play time, games tried, % of the library explored and your most-played games
- **Loading bar** with real progress, size and time left for big games
- Fullscreen, rate and close from the game's top bar; a **⋯ More** menu holds favorite, restart, game info, open in new tab, download, report broken and **clear this game's data** (only that game's saves are removed; other games aren't touched)

**GN Originals**
- A row of open-source games from [SCHSwork/GN-originals](https://github.com/SCHSwork/GN-originals), also under the **GN Originals** tag
- Each game's Info panel shows who made it, its license and its source code
- They still load if the main game library is down
- To add one, follow the steps in that repo's README; the site picks it up on its own

**Reliable**
- Every game-library file has three sources (jsDelivr → GitHub → githack). Failed or filtered sources are skipped automatically, links inside games are rewritten when jsDelivr is down, and the last game list is kept as an offline backup.

**Clean games**
- Ad loaders, ad banners and Google Analytics are stripped from every game before it runs, and known ad and tracking hosts are blocked as a backup.

**Accounts and saves** (optional, username only, no email)
- Cloud saves of all game progress and site settings, synced every 2 minutes, when a game closes and on sign-out
- Asks which copy to keep if another device saved newer progress
- Change password and delete account from the Account panel
- **Export / Import Data** to back up progress to a file (same format as cloud saves)
- **Delete account** removes the account, its cloud save and its ratings and reports

**Community**
- 👍 / 👎 ratings (one vote per account), shown on cards after 3 votes
- **Report Broken**: games reported by 3+ people in 14 days get a warning flag on their card

**Privacy tools**
- **Panic button** (⚠ in the header, or the <kbd>`</kbd> key) jumps to a safe site. The site and key can be changed in Settings.
- Tab cloak presets (Canvas, Classroom, Drive) and a tab-preview cloak
- `/` jumps to the search bar

**Settings**
- Light/dark mode, color themes, custom color, card size, font size, compact header, reduced motion

## Owner panel

Open it from **Settings → Owner Panel**. It unlocks with a **GitHub token** for an account that can push to this repo. The token is checked with GitHub and saved only in that browser.

From the panel you can:
- set the site to **open**, **locked** or **shut down**
- see **broken reports** (most reported first) and disable a game in one click
- make accounts **trusted reporters**: one report from them flags a game right away
- disable individual games
- set an announcement banner, a message of the day and extra footer links
- choose **new-visitor defaults** (theme, card size, sort, and so on)

Changes are saved to `config/owner-settings.json` in this repo, and every visitor loads them on their next visit.

**Making a token:** go to github.com → Settings → Developer settings → Fine-grained tokens → **Generate new token**. Give it access to **only this repository**, with **Contents: Read and write**. Never commit a token or paste it anywhere public.

## Files

```
index.html             the page (plus the tiny tab-cloak script that must run first)
sw.js                  background helper: caches covers, lets the site open offline
manifest.json          app name and icons for "install as app"
CHANGELOG.md           everything that's changed, newest first (also in the site footer)

css/styles.css         all the styles
js/
  ui.js                notices, dialogs, accessibility helpers (loaded first)
  originals.js         GN Originals: loads games.json from SCHSwork/GN-originals
  app.js               game list, search, cards, player, ad/tracker removal,
                       backup sources, settings, owner panel, panic button, tab cloak
  accounts.js          accounts and cloud saves (Firebase)
  library.js           favorites, recent, play time, stats, Today's pick,
                       ratings and reports, keyboard shortcuts
  filters.js           Genre / Source / Show filters
  finder.js            ✨ game finder and random game options
  loading-bar.js       game loading bar
  game-menu.js         the ⋯ More menu and per-game data clearing
  url-options.js, service-worker-setup.js    small start-up helpers

assets/icons/          site icon at every size
config/
  owner-settings.json  site-wide settings, written by the owner panel
  firestore.rules      Firebase database security rules
  game-info.json       genres, description and keywords for every game (used by filters and the finder)
tools/
  stamp_versions.py    run after editing css/ or js/ so browsers load the new version
```

## Firebase setup

Accounts, cloud saves, ratings and reports use the Firebase project set in `FIREBASE_CONFIG` in `index.html`. That config is meant to be public; the database rules are what keep data safe.

To use a different project:
1. Create a Firebase project (the free Spark plan is enough).
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Firestore Database:** create the `(default)` database in production mode.
4. **Firestore → Rules:** paste in `config/firestore.rules` and click **Publish**. Republish it whenever that file changes.
5. **Project settings → Your apps → Web:** register an app, then copy its config into `FIREBASE_CONFIG` in `index.html`.

If `FIREBASE_CONFIG` is set to `null`, the account features are turned off and the rest of the site still works.

## Legal

The site includes a Privacy Policy, Terms of Use and a DMCA page (links in the footer). Games belong to their creators. Takedown requests for library games go to the gn-math library that hosts the files. For GN Originals, open an issue on SCHSwork/GN-originals.
