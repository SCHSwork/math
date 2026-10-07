# Changelog

All the changes to GN 2.0, newest first.

## October 7, 2026

### New
- **Game of the Day**: one game is featured at the top of the page each day, the same for everyone.
- **Changelog**: this list. You can open it from the footer.
- **⋯ More menu** in each game's top bar: favorite, restart, game info, open in new tab, download, report broken, and **clear this game's data**. Clearing removes only that game's saves; other games aren't touched.
- **Smarter search**: handles typos ("geomtry dash"), missing spaces, accents and abbreviations ("fnaf"), shows the best matches first, and works together with the tag filter and sort menu.
- **My Stats** (in Settings): total play time, games tried, % of the library explored, and your top 5 most-played games.
- **NEW badges** on the 12 most recently added games, and a **Newest** sort option.
- **Broken reports in the owner panel**, most reported first, with one-click Disable/Enable.

### Changed
- The site is now called **GN 2.0**.
- **Google Analytics is removed from every game** before it runs, and tracking sites are blocked.
- The Privacy Policy, Terms and DMCA pages were updated for GN 2.0, ratings, reports and the no-tracking change.
- Deleting your account now also removes your ratings and broken reports.
- The README was rewritten to describe the site as it is now.

### Fixed
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
