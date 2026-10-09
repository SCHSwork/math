# Changelog

All the changes to GN 2.0, newest first.

## October 9, 2026

### Fixed
- Your account name no longer shows up in the search box when the site opens. Some browsers ignored the earlier fix, so the search boxes now stay locked until you click or tap into them, and any text the browser adds before you type is cleared.

### New
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
