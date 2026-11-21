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
    qpHighRankOnly: true,                    // Quick Play lobbies: only keep players at QP_TIERS
    matchRankRange: 3,                       // only try to recognise hidden players up to this many ranks below you (GM1 -> D1)
    autoDetails: false,                      // also read every player's hero panel automatically (slower)
    autoSaveFile: true,                      // keep data/players.json up to date while the database page is open
  };
  // Kept in code (not in saved settings) so changing it reaches everyone who already has settings stored.
  const QP_TIERS = ['grandmaster', 'celestial', 'eternity', 'oneaboveall'];
  const HIST_CAP = 15, GAMES_CAP = 400, SAME_GAME_MS = 3 * 3600e3;

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
    // Quick Play is full of every rank: keep only players at GM or above.
    const filterQp = lobby.qpLobby && settings.qpHighRankOnly;
    const keep = (r) => !filterQp || (r.tier && QP_TIERS.includes(r.tier));
    const known = everyone.filter(keep);
    const skipped = everyone.length - known.length;
    if (!known.length) return { saved: 0, skipped, newGame: false, gameId: null };
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
    game.last = now; game.mode = lobby.qpLobby ? 'Quick Play' : 'Competitive';

    const writes = {};
    const st = Object.assign({ checked: 0, correct: 0, iconChecked: 0, iconSame: 0 }, all.rdt_stats || {});
    for (const r of known) {
      const key = 'p:' + r.uid;
      const p = all[key] ? JSON.parse(JSON.stringify(all[key])) : {
        uid: r.uid, names: [], icon: null, firstSeen: now, lastSeen: now, seen: 0,
        asTeammate: 0, asEnemy: 0, partied: 0, last: {}, hist: [], tag: '', note: '',
      };
      if (r.name && p.names[0] !== r.name) { p.names = [r.name].concat(p.names.filter((n) => n !== r.name)).slice(0, 6); }
      if (r.icon) p.icon = r.icon;
      p.lastSeen = now;

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
    await set(writes);
    return { saved: known.length, skipped, newGame, gameId: game.id };
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

  async function updatePlayer(uid, patch) {
    const r = await get('p:' + uid);
    if (!r['p:' + uid]) return;
    await set({ ['p:' + uid]: Object.assign({}, r['p:' + uid], patch) });
  }
  const deletePlayer = (uid) => remove('p:' + uid);
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
    const body = { players, games, stats: a.stats, settings: a.settings };
    const exportedAt = Date.now();
    return {
      sig: JSON.stringify(body), count: players.length, games: games.length,
      fp: exportedAt + ':' + players.length,           // same fingerprint loadSeed() derives, so this browser won't re-merge it
      text: JSON.stringify(Object.assign({ version: 1, exportedAt }, body), null, 1) + '\n',
    };
  }

  async function exportAll() {
    const a = await loadAll();
    return { version: 1, exportedAt: Date.now(), players: a.players, games: a.games, stats: a.stats, settings: a.settings };
  }
  /** Merge: keep whichever record of a player was seen most recently, union names. */
  async function importAll(data) {
    if (!data || !Array.isArray(data.players)) throw new Error('Not a Rivals Rematch export');
    const all = await get(null);
    const w = {};
    for (const p of data.players) {
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
      .sort((a, b) => a.t - b.t).slice(-GAMES_CAP);
    const tot = (st) => (st ? (st.checked || 0) + (st.iconChecked || 0) : 0);
    if (data.stats && tot(data.stats) > tot(all.rdt_stats)) w.rdt_stats = data.stats;               // keep whichever track record has more evidence
    if (data.settings && !all.rdt_settings) w.rdt_settings = data.settings;                        // ...and your settings (UID etc.)
    await set(w);
    return data.players.length;
  }

  root.RDT = Object.assign(root.RDT || {}, {
    store: { getSettings, saveSettings, loadPlayers, loadAll, toCandidate, ingest, recordOutcome,
      updatePlayer, saveDetail, deletePlayer, wipe, exportAll, snapshot, importAll, loadSeed, SETTINGS_DEFAULTS },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
