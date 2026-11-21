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
  visible: rank/division, RS, W-L, the avatar, and top heroes / party icon when shown. (The `7` in `*****7` is just
  the player's number in that match, not part of their name, so it is ignored.) A global assignment guarantees two rows never claim the same person.
- Matching leans on one hard rule: season **W and L only ever go up**. Your example fits it —
  PlayerA. `4W-1L → 6W-3L` (+2W +2L) with RS unchanged; RS can move at most about ±25 per game (GM), and RS shows −20…99 within a division (below −20 you derank), so impossible changes are ruled out.
- **Quick Play lobbies** only save players ranked **GM or above** (GM, Celestial, Eternity, One Above All) (everyone is saved in Ranked). Toggle in Database → Settings.
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

## Honest limits
- It can only recognise people it has **seen with a visible name before**. New players show "no match".
- With only rank tier visible (as in the Quick Play capture) matches rest on avatar + rank, so
  confidence is lower and most rows will say "no match". The extension **checks itself**: when names are revealed it
  compares its earlier guesses and shows the running accuracy (Settings).
- It relies on rivalsdata's current page markup; if the site is redesigned, `content/scrape.js` is the only file to adjust.

## Tests
`npm test` (needs Playwright). Fixtures in `tests/fixtures` are real page captures.
