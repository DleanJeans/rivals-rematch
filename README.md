# Rivals Rematch

A Chrome extension that **remembers the players in your Marvel Rivals lobbies** (read from
[rivalsdata.com](https://rivalsdata.com)'s *Live Game* tab) and **recognises them again during the ban
phase**, when names are hidden. Everything is stored locally in your browser; nothing is sent anywhere.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open your profile on rivalsdata.com and keep the **Live Game** tab open while you queue.
3. Click the toolbar icon: **Read & save this lobby** reads the page right now, saves the players and then also reads every other
   player's hero details (there is a separate *Read hero details* button to redo just that). It reads the page right now (it also injects itself if the tab was
   opened before the extension was installed/reloaded). It reports what was saved; **Open database** opens the full DB.
   Saving also happens automatically in the background; the panel at the bottom-right of the page shows its status.

## Updating
An unpacked extension does not update itself. Download the repo again (or `git pull`), then press the **reload**
button on the extension's card at `chrome://extensions`. The installed version is shown in the toolbar popup and
at the top of the database page (currently 0.9.6) so you can check you have the latest.

## How it works
- **When names are visible** (in game, or the revealed rows in a ban phase) every player is saved:
  name, UID, avatar, rank + RS, W-L, top heroes, party flag, and whether they were your teammate or enemy.
- **When names are hidden** each masked row is matched against that database using whatever is still
  visible: rank/division, RS, W-L, the avatar, and top heroes / party icon when shown. (The `7` in `*****7` is just
  the player's number in that match, not part of their name, so it is ignored.) A global assignment guarantees two rows never claim the same person.
- Matching leans on one hard rule: season **W and L only ever go up**. Your example fits it —
  PlayerA. `4W-1L → 6W-3L` (+2W +2L) with RS unchanged; RS can move at most about ±25 per game (GM), and RS shows −20…99 within a division (below −20 you derank), so impossible changes are ruled out.
- **Quick Play lobbies are not saved at all** (Ranked lobbies save everyone). Database → Settings → *Save Quick Play lobbies too* turns it on,
  and then only players ranked GM or above are kept. Hidden-name recognition still works in Quick Play against what you already have.
- **Hero details:** hover a hero tile (database, lobbies, on-page panel) for a tooltip with the hero's name and record (or its
  level), and open the ▾ dropdown under a player for **Heroes** (games + win rate), **Proficiency** (levels) and **Match history**.
  Details already read in the current match are skipped when you press the buttons again (Shift-click *Read hero details* to force a
  re-read); a new match reads everyone again. The data comes from rivalsdata's own expanded row: press **Read hero details** in the toolbar popup (it opens every player's
  row at once, reads them and closes them again, so a whole lobby takes a few seconds), or tick *Read hero details automatically* in Settings.
- **Rank range:** hidden players are only matched if they are within a few ranks of you (default 3 below: GM1 → D1; it follows
  your rank). Rows below that get no chip, and the panel says how many were skipped. Change it in Settings.
- **Open all profiles:** a button on every lobby (Lobbies tab) and in the toolbar popup opens each other player's rivalsdata profile in
  background tabs (never your own; a team column has its own button). Each tab then checks itself: if the player is **In game (Competitive)**
  it opens their *Live Game* tab and reads it; otherwise the tab closes itself (a page that never finished loading is left alone).
  Shift-click opens the profiles plainly, with no checking and no closing.
- **Deleting:** each lobby line has a **Delete** button (it rolls back the counts that lobby added, and offers to forget players who appear in
  no other lobby; starred, tagged or noted players are always kept), and each player has ✕. Deletions are remembered in the data file, so
  they survive Save to GitHub and loading the file on another machine; a player seen again later simply comes back.
- **Saved heroes on hidden players:** for a likely match, the site's blank Top Heroes boxes are covered with the heroes you saved for that
  player (dashed outline; hover for the tooltip and when you last saw them). Settings can turn this off.
- Hidden rows get a chip over the `****` (green ≥80 %, amber ≥ threshold, grey "(maybe)", dashed "no match"),
  and a **HUD** lists each recognised player's name, **last-known top heroes**, teammate/enemy history and your notes —
  handy for deciding bans.
- Open the database from the popup: search, sort, tag/note players, lobby log, settings, export/import.

## Keeping your data between sessions (e.g. a PC that resets)
Keep this repo **private** (the file lists other players' names and your notes), and load the extension from the repo folder.

1. **Once per browser session:** open the database (toolbar icon → *Open database*) and click **Save to data/**. Pick the repo's
   `data` folder (or the repo folder itself). Chrome remembers the choice; after a browser restart it asks you to allow writing again.
2. From then on `data/players.json` is **kept up to date automatically while the database page is open**, and the file is only
   rewritten when something actually changed. Before logging off, click **Save to data/** (or the popup's *Save to data/players.json*)
   to be sure it's current.
3. **Commit and push** `data/players.json` (GitHub Desktop, git, or upload it on github.com).
4. Next session: download/clone the repo, **Load unpacked** — the extension merges `data/players.json` on first run, so everything
   is already there (settings and the accuracy record too).

Writing the file needs Chrome's folder-access feature, so it only works on a Chromium browser. *Export* still downloads the same file.

### Or: save straight to GitHub (no folder, no git)
Database → Settings → **Save to GitHub** (or the **Save to GitHub** button in the popup / database header):

1. Create a **fine-grained token** at <https://github.com/settings/personal-access-tokens/new> — *Only select repositories* → this repo,
   permission **Contents: Read and write**, a short expiry. Paste it into the Token box (press Tab); it is then cleared from the screen.
2. The first click **merges** whatever is already in the repo's `data/players.json` into your local data, then commits the result.
   Because it merges first, a session at home and one at the cafe never overwrite each other. Nothing is committed if nothing changed.
3. The token is kept for **this browser session only** (gone when the browser closes) unless you tick *Remember*. *Forget token now*
   clears it immediately. It is never written to the data file, exports, or messages.

## Honest limits
- It can only recognise people it has **seen with a visible name before**. New players show "no match".
- With only rank tier visible (as in the Quick Play capture) matches rest on avatar + rank, so
  confidence is lower and most rows will say "no match". The extension **checks itself**: when names are revealed it
  compares its earlier guesses and shows the running accuracy (Settings).
- It relies on rivalsdata's current page markup; if the site is redesigned, `content/scrape.js` is the only file to adjust.

## Tests
`npm test` (needs Playwright). Fixtures in `tests/fixtures` are real page captures.
