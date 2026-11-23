/*
 * chrome.storage.local persistence. Layout (one key per player so a write only
 * touches what changed, and the DB page can edit notes without races):
 *   p:<uid>        player record
 *   rdt_games      [recent lobbies]  (capped)
 *   rdt_stats      {guesses checked/correct, avatar-swap counts}
 *   rdt_settings   user settings
 */
(function (root) {
  'use strict';
  const R = root.RDT;
  const area = () => root.chrome.storage.local;
  const get = (k) => new Promise((res) => area().get(k, res));
  const set = (o) => new Promise((res) => area().set(o, res));
  const remove = (k) => new Promise((res) => area().remove(k, res));

  const SETTINGS_DEFAULTS = {
    selfUid: R.DEFAULT_SELF_UID,
    overlay: true,       // show names over masked rows + HUD
    minShow: 0.5,        // below this the guess is shown as "maybe"
    useIcons: true,
    saveQuickPlay: false,                    // Quick Play lobbies are NOT saved at all unless this is on
    qpHighRankOnly: true,                    // ...and then only players at QP_TIERS (GM and above) are kept
    showSavedHeroes: true,                   // likely matches: show the heroes you saved over the site's blank hero boxes
    saveRankLimit: false,                    // also SAVE only players up to saveRankRange ranks below you (the matching range above only affects recognition)
    saveRankRange: 3,
    matchRankRange: 3,                       // only try to recognise hidden players up to this many ranks below you (GM1 -> D1)
    autoDetails: false,                      // also read every player's hero panel automatically (slower)
    autoSaveFile: true,                      // keep data/players.json up to date while the database page is open
  };
  // Kept in code (not in saved settings) so changing it reaches everyone who already has settings stored.
  const QP_TIERS = ['grandmaster', 'celestial', 'eternity', 'oneaboveall'];
  const HIST_CAP = 15, GAMES_CAP = 400, SAME_GAME_MS = 3 * 3600e3;

  // ---- deletions are remembered ("tombstones"), otherwise the next sync would merge the repo's copy straight back in
  const sortKeys = (o) => Object.keys(o || {}).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {});
  const normTomb = (t) => ({ players: sortKeys(t && t.players), games: sortKeys(t && t.games) });

  async function getSettings() {
    const r = await get('rdt_settings');
    return Object.assign({}, SETTINGS_DEFAULTS, r.rdt_settings || {});
  }
  const saveSettings = (s) => set({ rdt_settings: s });

  async function loadPlayers() {
    const all = await get(null);
    return Object.keys(all).filter((k) => k.startsWith('p:')).map((k) => all[k]);
  }
  async function loadAll() {
    const all = await get(null);
    return {
      players: Object.keys(all).filter((k) => k.startsWith('p:')).map((k) => all[k]),
      deleted: normTomb(all.rdt_deleted),
      games: all.rdt_games || [],
      stats: all.rdt_stats || {},
      settings: Object.assign({}, SETTINGS_DEFAULTS, all.rdt_settings || {}),
    };
  }

  /** Candidate view of a stored player for the matcher. */
  function toCandidate(p) {
    const l = p.last || {};
    return {
      uid: p.uid, names: p.names || [], abs: l.abs != null ? l.abs : null,
      w: l.w != null ? l.w : null, l: l.l != null ? l.l : null, season: l.season || null,
      icon: p.icon || null, heroes: l.heroes || null, rankIdx: l.rankIdx != null ? l.rankIdx : null, qp: l.qp || null, t: l.t || p.lastSeen,
    };
  }

  const sameField = (a, b) => a == null || b == null || a === b;

  /**
   * Save every row whose identity is visible. Idempotent: re-scraping the same
   * lobby changes nothing (counters only move when a (game, player) pair is new).
   */
  async function ingest(lobby, settings, now) {
    now = now || Date.now();
    const everyone = lobby.rows.filter((r) => r.uid);
    // Quick Play lobbies are ignored entirely unless the user opted in; when they did, only GM and above is kept.
    if (lobby.qpLobby && !settings.saveQuickPlay) return { saved: 0, skipped: everyone.length, newGame: false, gameId: null, qpNotSaved: true };
    const filterQp = lobby.qpLobby && settings.qpHighRankOnly;
    const keep = (r) => !filterQp || (r.tier && QP_TIERS.includes(r.tier));
    // Optional rank limit: only players up to `saveRankRange` ranks below yours are saved (you, and rows with no known rank, always are).
    let minIdx = null;
    if (settings.saveRankLimit) {
      const meRow = everyone.find((r) => r.uid === settings.selfUid);
      let selfIdx = meRow && meRow.rankIdx != null ? meRow.rankIdx : null;
      if (selfIdx == null) { const st = (await get('p:' + settings.selfUid))['p:' + settings.selfUid]; selfIdx = st && st.last && st.last.rankIdx != null ? st.last.rankIdx : null; }
      minIdx = R.minRankIdx(selfIdx, settings.saveRankRange != null ? settings.saveRankRange : 3);
    }
    const inRange = (r) => minIdx == null || r.uid === settings.selfUid || r.rankIdx == null || r.rankIdx >= minIdx;
    const afterQp = everyone.filter(keep);
    const known = afterQp.filter(inRange);
    const rankSkipped = afterQp.length - known.length;
    const skipped = everyone.length - afterQp.length;
    if (!known.length) return { saved: 0, skipped, rankSkipped, newGame: false, gameId: null };
    const all = await get(null);
    let games = all.rdt_games || [];
    const selfRow = everyone.find((r) => r.uid === settings.selfUid);   // team side even if you're filtered out
    const selfTeam = selfRow ? selfRow.team : null;

    // ---- which stored lobby is this? (stats of shared players differ between games)
    const identical = (g) => known.filter((r) => {
      const gp = g.players[r.uid];
      return gp && sameField(r.abs, gp.abs) && sameField(r.w, gp.w) && sameField(r.l, gp.l) &&
        (r.abs != null || r.w != null) && (gp.abs != null || gp.w != null);
    }).length;
    let game = null, best = 0;
    for (const g of games) {
      if (now - g.last > SAME_GAME_MS) continue;
      const n = identical(g);
      if (n > best) { best = n; game = g; }
    }
    const need = game ? Math.max(1, Math.ceil(0.6 * Math.min(known.length, Object.keys(game.players).length))) : 1;
    if (game && best < need) game = null;
    let newGame = false;
    if (!game) {
      game = { id: now.toString(36), t: now, last: now, season: lobby.season, players: {} };
      games.push(game); newGame = true;
    }
    game.last = Math.max(game.last || 0, now); game.mode = lobby.qpLobby ? 'Quick Play' : 'Competitive';

    const writes = {};
    let newPlayers = 0, added = 0;                                  // seen for the first time in this very lobby (stays true if the lobby is saved again)
    const st = Object.assign({ checked: 0, correct: 0, iconChecked: 0, iconSame: 0 }, all.rdt_stats || {});
    for (const r of known) {
      const key = 'p:' + r.uid;
      const p = all[key] ? JSON.parse(JSON.stringify(all[key])) : {
        uid: r.uid, names: [], icon: null, firstSeen: now, lastSeen: now, seen: 0,
        asTeammate: 0, asEnemy: 0, partied: 0, last: {}, hist: [], tag: '', note: '',
      };
      if (r.name && p.names[0] !== r.name) { p.names = [r.name].concat(p.names.filter((n) => n !== r.name)).slice(0, 6); }
      if (r.icon) p.icon = r.icon;
      p.lastSeen = Math.max(p.lastSeen || 0, now);       // `now` is when the match started when the page says so

      const L = p.last || {};
      const merged = Object.assign({}, L, { t: now, season: lobby.season || L.season || null, team: r.team });
      if (r.rs != null) Object.assign(merged, { rankLabel: r.rankLabel, rankIdx: r.rankIdx, rs: r.rs, abs: r.abs });
      if (r.w != null) { merged.w = r.w; merged.l = r.l; }
      if (r.heroes) { merged.heroes = r.heroes; merged.heroLabels = Object.assign({}, L.heroLabels, r.heroLabels); }
      if (r.qp) merged.qp = r.qp;
      merged.party = r.party; merged.partyColor = r.partyColor;
      p.last = merged;

      if (merged.abs != null && merged.w != null) {
        const h = p.hist[p.hist.length - 1];
        if (!h || h.abs !== merged.abs || h.w !== merged.w || h.l !== merged.l) {
          p.hist.push({ t: now, abs: merged.abs, w: merged.w, l: merged.l, season: merged.season });
          if (p.hist.length > HIST_CAP) p.hist.shift();
        }
      }

      if (!all[key]) added++;
      if (!all[key] || (game.players[r.uid] && p.seen <= 1 && p.firstSeen >= game.t)) newPlayers++;
      if (!game.players[r.uid]) {              // first time this player is recorded in this lobby
        if (all[key] && all[key].icon && r.icon) { st.iconChecked++; if (all[key].icon === r.icon) st.iconSame++; }
        p.seen++;
        if (r.party) p.partied++;
        if (selfTeam != null && r.uid !== settings.selfUid) {
          if (r.team === selfTeam) p.asTeammate++; else p.asEnemy++;
        }
      }
      game.players[r.uid] = {                      // snapshot as it looked in this lobby (the lobby tab draws from it)
        team: r.team, idx: r.idx, name: r.name, icon: r.icon || p.icon || null,
        abs: merged.abs != null ? merged.abs : null, rankLabel: merged.rankLabel || null, rs: merged.rs != null ? merged.rs : null,
        w: merged.w != null ? merged.w : null, l: merged.l != null ? merged.l : null,
        heroes: merged.heroes || null, party: !!r.party, partyColor: r.partyColor || null,
      };
      writes[key] = p;
    }
    if (games.length > GAMES_CAP) games = games.slice(-GAMES_CAP);
    writes.rdt_games = games; writes.rdt_stats = st;
    const tomb = normTomb(all.rdt_deleted);
    if (known.some((r) => tomb.players[r.uid])) { known.forEach((r) => { delete tomb.players[r.uid]; }); writes.rdt_deleted = tomb; }   // seen again => back
    await set(writes);
    return { saved: known.length, skipped, newGame, gameId: game.id, newPlayers, oldPlayers: known.length - newPlayers, added, rankSkipped };
  }

  /** Compare earlier ban-phase guesses with the names revealed later. */
  async function recordOutcome(checked, correct) {
    const r = await get('rdt_stats');
    const s = Object.assign({ checked: 0, correct: 0 }, r.rdt_stats || {});
    s.checked += checked; s.correct += correct;
    await set({ rdt_stats: s });
    return s;
  }

  /** Keep a player's latest hero panel (heroes / proficiency / match history). */
  async function saveDetail(uid, d, now, gameId) {
    const r = await get('p:' + uid);
    const p = r['p:' + uid];
    if (!p || !d) return false;
    const cap = (a) => (a || []).slice(0, 20);
    p.detail = { t: now || Date.now(), gameId: gameId || null, season: d.season, heroes: cap(d.heroes), proficiency: cap(d.proficiency), matches: cap(d.matches) };
    await set({ ['p:' + uid]: p });
    return true;
  }

  const ONLINE_TTL = 30 * 60e3;                                       // a stored online status goes stale after 30 minutes
  /** true = seen in a Competitive game, false = seen not in one, null = unknown or stale. */
  const onlineOf = (p, now) => (p && p.online && (now || Date.now()) - p.online.t < ONLINE_TTL ? !!p.online.inGame : null);

  async function updatePlayer(uid, patch) {
    const r = await get('p:' + uid);
    if (!r['p:' + uid]) return;
    await set({ ['p:' + uid]: Object.assign({}, r['p:' + uid], patch) });
  }
  async function deletePlayer(uid) {
    const r = await get('rdt_deleted'); const t = normTomb(r.rdt_deleted);
    t.players[uid] = Date.now();
    await set({ rdt_deleted: normTomb(t) });
    await remove('p:' + uid);
  }

  /** What deleting a lobby does: roll back the counts it added, and which players would then appear in no lobby at all. */
  function planDelete(all, g) {
    const settings = Object.assign({}, SETTINGS_DEFAULTS, all.rdt_settings || {});
    const selfTeam = g.players[settings.selfUid] ? g.players[settings.selfUid].team : null;
    const updates = {}, orphans = [];
    Object.keys(g.players).forEach((uid) => {
      const p = all['p:' + uid]; if (!p) return;
      const gp = g.players[uid], q = JSON.parse(JSON.stringify(p));
      q.seen = Math.max(0, (q.seen || 0) - 1);
      if (gp.party) q.partied = Math.max(0, (q.partied || 0) - 1);
      if (selfTeam != null && uid !== settings.selfUid) {
        if (gp.team === selfTeam) q.asTeammate = Math.max(0, (q.asTeammate || 0) - 1); else q.asEnemy = Math.max(0, (q.asEnemy || 0) - 1);
      }
      updates['p:' + uid] = q;
      if (q.seen === 0 && uid !== settings.selfUid && !q.starred && !q.tag && !q.note) orphans.push('p:' + uid);   // starred/tagged/noted players are always kept
    });
    return { updates, orphans };
  }
  async function previewDeleteGame(id) {
    const all = await get(null); const g = (all.rdt_games || []).find((x) => x.id === id);
    return g ? { players: Object.keys(g.players).length, orphans: planDelete(all, g).orphans.length } : { players: 0, orphans: 0 };
  }
  async function deleteGame(id, opt) {
    const all = await get(null); const games = all.rdt_games || [];
    const g = games.find((x) => x.id === id);
    if (!g) return { removed: false, forgot: 0 };
    const { updates, orphans } = planDelete(all, g);
    const forget = opt && opt.forgetOrphans ? orphans : [];
    const tomb = normTomb(all.rdt_deleted), now = Date.now();
    tomb.games[id] = now;
    forget.forEach((k) => { tomb.players[k.slice(2)] = now; delete updates[k]; });
    await set(Object.assign(updates, { rdt_games: games.filter((x) => x.id !== id), rdt_deleted: normTomb(tomb) }));
    if (forget.length) await remove(forget);
    return { removed: true, forgot: forget.length };
  }
  async function wipe() { await new Promise((res) => area().clear(res)); }

  /**
   * Merge the bundled data/players.json (if the repo ships one) into storage. Runs only when the
   * file is new/changed, so it never overwrites what you collected since. Safe when the file is absent.
   */
  async function loadSeed(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return 0;
      const data = await res.json();
      if (!data || !Array.isArray(data.players) || !data.players.length) return 0;
      const fp = (data.exportedAt || 0) + ':' + data.players.length;
      const have = await get('rdt_seed');
      if (have.rdt_seed === fp) return 0;
      const n = await importAll(data);
      await set({ rdt_seed: fp });
      return n;
    } catch (_) { return 0; }
  }

  /**
   * The file that goes into the repo. Players are sorted by uid and games by time so git diffs stay small;
   * `sig` ignores exportedAt so an unchanged database never rewrites (or re-commits) the file.
   */
  async function snapshot() {
    const a = await loadAll();
    const players = a.players.slice().sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
    const games = a.games.slice().sort((x, y) => x.t - y.t);
    const body = { players, games, stats: a.stats, settings: a.settings, deleted: a.deleted };
    const exportedAt = Date.now();
    return {
      sig: JSON.stringify(body), count: players.length, games: games.length,
      fp: exportedAt + ':' + players.length,           // same fingerprint loadSeed() derives, so this browser won't re-merge it
      text: JSON.stringify(Object.assign({ version: 1, exportedAt }, body), null, 1) + '\n',
    };
  }

  async function exportAll() {
    const a = await loadAll();
    return { version: 1, exportedAt: Date.now(), players: a.players, games: a.games, stats: a.stats, settings: a.settings, deleted: a.deleted };
  }
  /** Merge: keep whichever record of a player was seen most recently, union names. */
  async function importAll(data) {
    if (!data || !Array.isArray(data.players)) throw new Error('Not a Rivals Rematch export');
    const all = await get(null);
    const w = {};
    const tomb = normTomb(all.rdt_deleted), inc = normTomb(data.deleted);
    Object.keys(inc.players).forEach((u) => { if (inc.players[u] > (tomb.players[u] || 0)) tomb.players[u] = inc.players[u]; });
    Object.keys(inc.games).forEach((g) => { if (inc.games[g] > (tomb.games[g] || 0)) tomb.games[g] = inc.games[g]; });
    for (const p of data.players) {
      const t = tomb.players[p.uid];
      if (t && (p.lastSeen || 0) <= t) continue;                          // deleted after it was last seen: it stays deleted
      if (t) delete tomb.players[p.uid];                                  // seen again after the deletion: it is back
      const mine = all['p:' + p.uid];
      if (!mine) { w['p:' + p.uid] = p; continue; }
      if (JSON.stringify(mine) === JSON.stringify(p)) continue;        // identical: leave it exactly as it is (keeps syncs idempotent)
      const win = (p.lastSeen || 0) > (mine.lastSeen || 0) ? p : mine;
      const lose = win === p ? mine : p;
      w['p:' + p.uid] = Object.assign({}, win, {
        names: Array.from(new Set(win.names.concat(lose.names))).slice(0, 6),
        firstSeen: Math.min(win.firstSeen || Infinity, lose.firstSeen || Infinity),
        seen: Math.max(win.seen, lose.seen), asTeammate: Math.max(win.asTeammate, lose.asTeammate),
        asEnemy: Math.max(win.asEnemy, lose.asEnemy),
        tag: win.tag || lose.tag, note: win.note || lose.note,
      });
      if (win.starred || lose.starred) w['p:' + p.uid].starred = true;       // only ever add the key when it is true
    }
    const ids = new Set((all.rdt_games || []).map((g) => g.id));
    w.rdt_games = (all.rdt_games || []).concat((data.games || []).filter((g) => !ids.has(g.id)))
      .filter((g) => !tomb.games[g.id]).sort((a, b) => a.t - b.t).slice(-GAMES_CAP);
    const drop = Object.keys(tomb.players).map((u) => 'p:' + u).filter((k) => all[k] && !w[k] && (all[k].lastSeen || 0) <= tomb.players[k.slice(2)]);   // apply deletions made elsewhere
    w.rdt_deleted = normTomb(tomb);
    const tot = (st) => (st ? (st.checked || 0) + (st.iconChecked || 0) : 0);
    if (data.stats && tot(data.stats) > tot(all.rdt_stats)) w.rdt_stats = data.stats;               // keep whichever track record has more evidence
    if (data.settings && !all.rdt_settings) w.rdt_settings = data.settings;                        // ...and your settings (UID etc.)
    await set(w);
    if (drop.length) await remove(drop);
    return data.players.length;
  }

  root.RDT = Object.assign(root.RDT || {}, {
    store: { getSettings, saveSettings, loadPlayers, loadAll, toCandidate, ingest, recordOutcome,
      updatePlayer, onlineOf, ONLINE_TTL, saveDetail, deletePlayer, deleteGame, previewDeleteGame, wipe, exportAll, snapshot, importAll, loadSeed, SETTINGS_DEFAULTS },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
