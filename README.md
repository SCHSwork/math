# GN 2.0

A single-page browser game site with no ads, no trackers, and optional accounts with cloud saves. It runs entirely on GitHub Pages and uses Firebase for accounts.

The game list and game files come from the community-run gn-math library on jsDelivr. GN 2.0 doesn't host any games itself.

## Features

**Playing**
- **Today's pick** (game of the day) at the top of the page, the same for everyone each day
- **Smart search** that handles typos, missing spaces and abbreviations ("geomtry dash", "fnaf"), and works together with tag filters
- Sort by name, newest, date added, popular, trending, top rated or my most played
- **NEW** badges on the 12 most recently added games
- **Your games**: one compact row that switches between Recent and Favorites (☆ on any card)
- **Random game** button
- **My Stats** (Settings): total play time, games tried, % of the library explored and your most-played games
- **Loading bar** with real progress, size and time left for big games
- Fullscreen, rate and close from the game's top bar; a **⋯ More** menu holds favorite, restart, game info, open in new tab, download, report broken and **clear this game's data** (only that game's saves are removed; other games aren't touched)

**Reliable**
- Every game-library file has three sources (jsDelivr → GitHub → githack). Failed or filtered sources are skipped automatically, links inside games are rewritten when jsDelivr is down, and the last game list is kept as an offline backup.

**Clean games**
- Ad loaders, ad banners and Google Analytics are stripped from every game before it runs, and known ad and tracking hosts are blocked as a backup.

**Accounts and saves** (optional, username only, no email)
- Cloud saves of all game progress and site settings, synced every 2 minutes, when a game closes and on sign-out
- Asks which copy to keep if another device saved newer progress
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
- disable individual games
- set an announcement banner, a message of the day and extra footer links
- choose **new-visitor defaults** (theme, card size, sort, and so on)

Changes are saved to `owner-settings.json` in this repo, and every visitor loads them on their next visit.

**Making a token:** go to github.com → Settings → Developer settings → Fine-grained tokens → **Generate new token**. Give it access to **only this repository**, with **Contents: Read and write**. Never commit a token or paste it anywhere public.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole site: markup, styles and scripts |
| `owner-settings.json` | Site-wide owner settings, written by the owner panel |
| `firestore.rules` | Security rules for the Firebase database |
| `CHANGELOG.md` | Everything that's changed, newest first (also shown on the site under **Changelog** in the footer) |

## Firebase setup

Accounts, cloud saves, ratings and reports use the Firebase project set in `FIREBASE_CONFIG` in `index.html`. That config is meant to be public; the database rules are what keep data safe.

To use a different project:
1. Create a Firebase project (the free Spark plan is enough).
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Firestore Database:** create the `(default)` database in production mode.
4. **Firestore → Rules:** paste in `firestore.rules` and click **Publish**. Republish it whenever that file changes.
5. **Project settings → Your apps → Web:** register an app, then copy its config into `FIREBASE_CONFIG` in `index.html`.

If `FIREBASE_CONFIG` is set to `null`, the account features are turned off and the rest of the site still works.

## Legal

The site includes a Privacy Policy, Terms of Use and a DMCA page (links in the footer). Games belong to their creators. Takedown requests go to the gn-math library that hosts the files.
