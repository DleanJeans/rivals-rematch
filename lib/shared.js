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

  /** Icon for a rank label like "GM1" (same images rivalsdata uses), or null if the tier is unknown. */
  function rankIconUrl(label) {
    const r = parseRank(label);
    return r && r.tier !== 'oneaboveall' ? 'https://rivalsdata.com/assets/ranks/' + r.tier + '.webp' : null;
  }

  /** Division index: 0 = Bronze 3 ... 17 = GM1. */
  function rankIdx(r) { return TIERS.indexOf(r.tier) * 3 + (3 - (r.div || 1)); }
  /** Division index back to a label: 17 -> "GM1", 14 -> "D1". */
  function rankLabelOf(idx) {
    const t = TIERS[Math.floor(idx / 3)];
    if (!t) return null;
    return t === 'oneaboveall' ? 'OAA' : TIER_ABBR[t] + (3 - (idx % 3));
  }
  /** Lowest division worth matching: `range` divisions below yours (GM1 and 3 -> D1). null = no limit known. */
  function minRankIdx(selfIdx, range) {
    return selfIdx == null || range == null ? null : Math.max(0, selfIdx - range);
  }

  /** Comparable absolute score (GM1 + 70 RS -> 4770). rs may be negative. */
  function absScore(r, rs) { return ABS_OFFSET + rankIdx(r) * 100 + rs; }

  // ---------------------------------------------------------------- matcher
  const DEFAULTS = {
    unknownCost: 3.0,  // prior for "never seen this person"; higher => more willing to guess
    candBase: 1.0,     // prior cost of any one specific stored person
    gameCost: 0.3,     // each game played since the last sighting is slightly less likely
    rsPerNetWin: 18,   // typical RS swing per net win (observed: +19/+20 for single wins at GM)
    maxWin: 25,        // RS gained in one win is at most this at GM+ (observed range is -25..+25) ...
    maxLoss: 25,       // ... and lost in one loss at most this (per rivalsdata observations)
    lowTierScale: 1.5, // below GM the caps are unknown; assume they are larger (guess)
    rsMin: -20, rsMax: 99, // RS displayed within a division; below -20 you derank
    iconSwap: 0.4,     // chance a returning player changed avatar since last sighting (learned, see store)
    iconFreq: null,    // {iconId: share of known players using it}; common default avatars say little
    useIcons: true,
    maxAgeDays: 45,    // ignore players not seen for this long (used by the caller)
  };

  /** Cost of the rank/RS evidence: candidate (abs, division) -> hidden row. */
  function rankCost(row, cAbs, cIdx, dG, dW, dL, o) {
    const scale = row.rankIdx >= 15 ? 1 : o.lowTierScale;      // 15 = GM3
    const winCap = o.maxWin * scale, lossCap = o.maxLoss * scale;
    if (row.abs != null) {
      // Exact RS visible: how plausible is this change for the games played since?
      const dAbs = row.abs - cAbs;
      if (dG == null) return 0.5 * (dAbs / 40) * (dAbs / 40);
      const resid = dAbs - o.rsPerNetWin * (dW - dL);
      const sigma = dG === 0 ? 3 : 10 + 8 * Math.sqrt(dG);
      // Hard-ish physics: wins add at most winCap each, losses cost at most lossCap each.
      const out = Math.max(0, -lossCap * dL - dAbs, dAbs - winCap * dW);
      return 0.5 * (resid / sigma) * (resid / sigma) + 0.5 * (out / 4) * (out / 4);
    }
    // Only the division is shown, so RS is somewhere in [rsMin, rsMax] of it. The candidate
    // qualifies if, after the games it could have played, it can land inside that window.
    const base = ABS_OFFSET + row.rankIdx * 100, lo = base + o.rsMin, hi = base + o.rsMax;
    const gain = dG != null ? winCap * dW : winCap * 3, loss = dG != null ? lossCap * dL : lossCap * 3;
    const from = cAbs - loss, to = cAbs + gain;                // reachable abs range
    let out = Math.max(0, lo - to, from - hi);
    // The windows overlap in absolute terms, so use the stored division to respect direction:
    // you are promoted only by climbing past 100 (arrive at >= 0) and deranked only by dropping below -20.
    if (cIdx != null && cIdx < row.rankIdx) out = Math.max(out, base - to);
    if (cIdx != null && cIdx > row.rankIdx) out = Math.max(out, from - (ABS_OFFSET + cIdx * 100 + o.rsMin - 1));
    return 0.5 * (out / 5) * (out / 5);
  }

  /**
   * Negative-log-likelihood-ish cost that hidden `row` is stored player `c`.
   * Every feature is optional: missing evidence simply contributes nothing.
   * row: {rankIdx, abs?, w?, l?, season?, icon?, heroes?[]}
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

    if (row.rankIdx != null && c.abs != null) {
      let rc = rankCost(row, c.abs, c.rankIdx, dG, dW, dL, o);
      // In a Quick Play lobby an unlabelled rank might be the QP one; hedge using the stored QP rank.
      if (row.qpLobby && c.qp && c.qp.abs != null) {
        rc = Math.min(rc, 1.0 + rankCost(row, c.qp.abs, c.qp.rankIdx, null, null, null, o));
      }
      cost += rc;
    }

    if (row.heroes && row.heroes.length && c.heroes && c.heroes.length) {
      const have = new Set(row.heroes);
      const inter = c.heroes.filter((h) => have.has(h)).length;
      cost += 1.0 - 3.0 * (inter / Math.min(row.heroes.length, c.heroes.length));
    }

    // Avatar = likelihood ratio. Same avatar: (1-swap)/q where q is how common that avatar is
    // (a shared default avatar is weak evidence, a rare one strong). Different avatar: the
    // person may simply have swapped, so it only costs ln((1-q)/swap).
    if (o.useIcons && row.icon && c.icon) {
      const q = Math.min(0.5, Math.max(0.01, (o.iconFreq && o.iconFreq[row.icon]) || 0.05));
      const sw = Math.min(0.95, Math.max(0.05, o.iconSwap));
      cost += row.icon === c.icon
        ? Math.max(-2.5, Math.min(0.5, -Math.log((1 - sw) / q)))
        : Math.min(2.5, Math.log((1 - q) / sw));
    }
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

  const api = { TIERS, TIER_ABBR, parseRank, rankIconUrl, rankLabelOf, minRankIdx, rankIdx, absScore, pairCost, hungarian, matchLobby, DEFAULTS,
    // Pre-seeded so it works out of the box; change it in the DB page > Settings.
    DEFAULT_SELF_UID: '520435205' };
  root.RDT = Object.assign(root.RDT || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
