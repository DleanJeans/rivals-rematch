/*
 * Shared, DOM-free logic: rank maths + lobby matcher.
 * Loaded as a classic script in the content script and DB page, and
 * `require()`d by the node tests. Everything hangs off the global `RDT`.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ ranks
  // Verified against rivalsdata's team "Avg RS": one division = 100 RS and
  // GM1 + 0 RS == 4700, so (tier, division, RS) collapses to a single number.
  const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond',
    'grandmaster', 'celestial', 'eternity', 'oneaboveall'];
  const ABBR = { B: 'bronze', S: 'silver', G: 'gold', P: 'platinum', D: 'diamond',
    GM: 'grandmaster', C: 'celestial', E: 'eternity', OAA: 'oneaboveall' };
  const TIER_ABBR = Object.fromEntries(Object.entries(ABBR).map(([k, v]) => [v, k]));
  const ABS_OFFSET = 3000;

  function normTier(s) {
    if (!s) return null;
    const k = String(s).toLowerCase().replace(/[^a-z]/g, '');
    if (TIERS.includes(k)) return k;
    return ABBR[String(s).toUpperCase().replace(/[^A-Z]/g, '')] || null;
  }

  /** "GM1" (+ optional image tier name) -> {tier, div, label} or null */
  function parseRank(label, imgTier) {
    const text = (label || '').trim();
    const m = /^([A-Za-z]+)\s*([123])?$/.exec(text);
    const tier = normTier(imgTier) || (m && normTier(m[1]));
    if (!tier) return null;
    const div = m && m[2] ? +m[2] : 1;
    return { tier, div, label: text || TIER_ABBR[tier] + div };
  }

  /** Division index: 0 = Bronze 3 ... 17 = GM1. */
  function rankIdx(r) { return TIERS.indexOf(r.tier) * 3 + (3 - (r.div || 1)); }
  /** Comparable absolute score (GM1 + 70 RS -> 4770). rs may be negative. */
  function absScore(r, rs) { return ABS_OFFSET + rankIdx(r) * 100 + rs; }

  // ---------------------------------------------------------------- matcher
  const DEFAULTS = {
    unknownCost: 3.0,  // prior for "never seen this person"; higher => more willing to guess
    candBase: 1.0,     // prior cost of any one specific stored person
    gameCost: 0.3,     // each game played since the last sighting is slightly less likely
    rsPerNetWin: 22,   // net wins * this ~= expected RS change
    iconMatch: 0.8, iconMiss: 1.2, // only used when avatars are not masked
    suffixMiss: 6,     // name must end with the visible suffix (also checks old names)
    useSuffix: true,
    useIcons: true,
    maxAgeDays: 45,    // ignore players not seen for this long (used by the caller)
  };

  /**
   * Negative-log-likelihood-ish cost that hidden `row` is stored player `c`.
   * Every feature is optional: missing evidence simply contributes nothing.
   * row: {rankIdx, abs?, w?, l?, season?, icon?, suffix?, heroes?[]}
   * c:   {names[], abs?, w?, l?, season?, icon?, heroes?[]}
   * Hard rule: season W and L only ever grow, so they can't go down.
   */
  function pairCost(row, c, o) {
    if (row.season && c.season && row.season !== c.season) return Infinity;
    let cost = o.candBase;

    let dW = null, dL = null, dG = null;
    if (row.w != null && c.w != null) {
      dW = row.w - c.w; dL = row.l - c.l;
      if (dW < 0 || dL < 0) return Infinity;
      dG = dW + dL;
      cost += o.gameCost * dG;
    }

    if (c.abs != null) {
      const rowAbs = row.abs != null ? row.abs : ABS_OFFSET + row.rankIdx * 100 + 50;
      let resid = rowAbs - c.abs, sigma;
      if (dG != null) { resid -= o.rsPerNetWin * (dW - dL); sigma = dG === 0 ? 3 : 14 + 12 * Math.sqrt(dG); }
      else sigma = 40;
      if (row.abs == null) sigma = Math.max(sigma, 60); // only the division is known
      cost += 0.5 * (resid / sigma) * (resid / sigma);
    }

    if (o.useSuffix && row.suffix && c.names && c.names.length) {
      const s = row.suffix.toLowerCase();
      cost += c.names.some((n) => n.toLowerCase().endsWith(s))
        ? -Math.min(2.5, 0.8 + 0.7 * s.length) : o.suffixMiss;
    }

    if (row.heroes && row.heroes.length && c.heroes && c.heroes.length) {
      const have = new Set(row.heroes);
      const inter = c.heroes.filter((h) => have.has(h)).length;
      cost += 1.0 - 3.0 * (inter / Math.min(row.heroes.length, c.heroes.length));
    }

    if (o.useIcons && row.icon && c.icon) cost += row.icon === c.icon ? -o.iconMatch : o.iconMiss;
    return cost;
  }

  // Classic O(n^2 m) Hungarian algorithm (n rows <= m cols), minimises total cost.
  function hungarian(cost) {
    const n = cost.length, m = cost[0].length;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0;
      const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0]; let delta = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
    return ans;
  }

  /**
   * Assign every hidden row to at most one stored player (globally optimal, so
   * two rows can never claim the same person) or to "unknown".
   * returns per row: {uid|null, p (0..1), alts:[{uid,p,cost}] best 3}
   */
  function matchLobby(rows, cands, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const BIG = 1e6, n = rows.length, k = cands.length;
    if (!n) return [];
    const c = rows.map((r) => cands.map((cd) => {
      const x = pairCost(r, cd, o); return Number.isFinite(x) ? x : BIG;
    }));
    const full = c.map((row) => row.concat(new Array(n).fill(o.unknownCost)));
    const asg = hungarian(full);
    return rows.map((r, i) => {
      let z = Math.exp(-o.unknownCost);
      const scored = [];
      for (let j = 0; j < k; j++) if (c[i][j] < BIG) { const e = Math.exp(-c[i][j]); z += e; scored.push({ j, e }); }
      scored.sort((a, b) => b.e - a.e);
      const alts = scored.slice(0, 3).map(({ j, e }) => ({ uid: cands[j].uid, p: e / z, cost: c[i][j] }));
      const j = asg[i];
      if (j < 0 || j >= k || c[i][j] >= BIG) return { uid: null, p: 0, alts };
      return { uid: cands[j].uid, p: Math.exp(-c[i][j]) / z, alts };
    });
  }

  const api = { TIERS, TIER_ABBR, parseRank, rankIdx, absScore, pairCost, hungarian, matchLobby, DEFAULTS,
    // Pre-seeded so it works out of the box; change it in the DB page > Settings.
    DEFAULT_SELF_UID: '520435205' };
  root.RDT = Object.assign(root.RDT || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
