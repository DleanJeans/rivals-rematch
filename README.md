# Rivals Rematch

A Chrome extension that **remembers the players in your Marvel Rivals lobbies** (read from
[rivalsdata.com](https://rivalsdata.com)'s *Live Game* tab) and **recognises them again during the ban
phase**, when names are hidden. Everything is stored locally in your browser; nothing is sent anywhere.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open your profile on rivalsdata.com and keep the **Live Game** tab open while you queue.
3. Click the toolbar icon: **Read & save this lobby** reads the page right now (it also injects itself if the tab was
   opened before the extension was installed/reloaded). It reports what was saved; **Open database** opens the full DB.
   Saving also happens automatically in the background; the panel at the bottom-right of the page shows its status.

## Updating
An unpacked extension does not update itself. Download the repo again (or `git pull`), then press the **reload**
button on the extension's card at `chrome://extensions`. The installed version is shown in the toolbar popup and
at the top of the database page (currently 0.2.0) so you can check you have the latest.

## How it works
- **When names are visible** (in game, or the revealed rows in a ban phase) every player is saved:
  name, UID, avatar, rank + RS, W-L, top heroes, party flag, and whether they were your teammate or enemy.
- **When names are hidden** each masked row is matched against that database using whatever is still
  visible: rank/division, RS, W-L, the avatar, the **visible end of the masked name** (`*****7` → ends in "7"),
  and top heroes / party icon when shown. A global assignment guarantees two rows never claim the same person.
- Matching leans on one hard rule: season **W and L only ever go up**. Your example fits it —
  PlayerA. `4W-1L → 6W-3L` (+2W +2L) with RS unchanged; RS can move at most about +20 per win and −25 per loss (GM), and RS shows −20…99 within a division (below −20 you derank), so impossible changes are ruled out.
- **Quick Play lobbies** only save players ranked **GM or above** (GM, Celestial, Eternity, One Above All) (everyone is saved in Ranked). Toggle in Database → Settings.
- Hidden rows get a chip over the `****` (green ≥80 %, amber ≥ threshold, grey "(maybe)", dashed "no match"),
  and a **HUD** lists each recognised player's name, **last-known top heroes**, teammate/enemy history and your notes —
  handy for deciding bans.
- Open the database from the popup: search, sort, tag/note players, lobby log, settings, export/import.

## Keeping your data between sessions (e.g. a PC that resets)
1. Keep this repo **private** (it will hold other players' names and your notes).
2. End of session: Database → **Export** (saves `players.json`), then on GitHub: `data/` → *Add file → Upload files* → commit.
3. Next session: download the repo as a ZIP, unzip, `chrome://extensions` → **Load unpacked**. The extension merges
   `data/players.json` into its storage on first run, so everything is already there. Settings and the accuracy record come back too.

## Honest limits
- It can only recognise people it has **seen with a visible name before**. New players show "no match".
- With only rank tier visible (as in the Quick Play capture) matches rest on avatar + name-end + rank, so
  confidence is lower. The extension **checks itself**: when names are revealed it compares its earlier guesses and
  shows the running accuracy (Settings). If the name-end rule proves wrong it switches itself off.
- It relies on rivalsdata's current page markup; if the site is redesigned, `content/scrape.js` is the only file to adjust.

## Tests
`npm test` (needs Playwright). Fixtures in `tests/fixtures` are real page captures.
