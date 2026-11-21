/*
 * Turns rivalsdata's "Live Game" panel into plain objects.
 * Every field except `team`/`idx` is optional (ban phase hides most of them).
 */
(function (root) {
  'use strict';
  const R = root.RDT;

  const last = (u) => (u || '').split('/').pop().split('?')[0].replace(/\.\w+$/, '');

  function findPanel(doc) {
    return doc.querySelector('[role="tabpanel"][aria-labelledby="live-game"]');
  }

  function parseRankSpans(li) {
    // The rank cell holds 1 span per rank: ranked first, then "(QP)" when shown.
    const out = { ranked: null, qp: null };
    li.querySelectorAll('img[src*="/ranks/"]').forEach((img) => {
      const box = img.parentElement;
      const label = Array.from(box.childNodes).filter((n) => n.nodeType === 3)
        .map((n) => n.textContent).join('').trim();
      const rank = R.parseRank(label, last(img.getAttribute('src')));
      if (!rank) return;
      const sub = (box.querySelector('span') || {}).textContent || '';
      const m = /(-?\d+)\s*RS/.exec(sub);
      const rec = Object.assign({}, rank, { rs: m ? +m[1] : null });
      rec.idx = R.rankIdx(rank);
      rec.abs = rec.rs != null ? R.absScore(rank, rec.rs) : null;
      if (/\(QP\)/i.test(sub)) { if (!out.qp) out.qp = rec; } else if (!out.ranked) out.ranked = rec;
    });
    return out;
  }

  function parseRow(li, team, idx) {
    const grid = li.firstElementChild;
    if (!grid) return null;
    const link = li.querySelector('a[href*="/player/"]');
    const uid = link ? (/\/player\/(\d+)/.exec(link.getAttribute('href')) || [])[1] || null : null;
    const nameCell = grid.children[1];
    const name = (link ? link.textContent : (nameCell ? nameCell.textContent : '')).trim();
    const masked = !uid;
    // "*****7": the 7 is just this player's number in the match, NOT part of their name. Kept for display only.
    const slot = masked ? name.replace(/^[*•·\s]+/, '') : null;

    const ranks = parseRankSpans(li);
    if (!ranks.ranked && !ranks.qp) return null; // not a player row
    const rk = ranks.ranked || { tier: null, div: null, label: null, idx: null, rs: null, abs: null };

    // Read the W/L cell on its own: li.textContent would glue the slot number ("*****1") onto "4W - 7L".
    const wlCell = grid.children[3];
    const wl = /(\d+)\s*W\s*-\s*(\d+)\s*L/.exec(wlCell ? wlCell.textContent : '');
    const iconImg = grid.querySelector('img[src*="/icons/"]');
    const heroes = [], heroNames = {};
    li.querySelectorAll('img[src*="/assets/heroes/"]').forEach((img) => {
      const slug = last(img.getAttribute('src'));
      if (!heroNames[slug]) { heroNames[slug] = 1; heroes.push(slug); }
    });
    const labels = {};
    li.querySelectorAll('button[aria-label][aria-controls] img[src*="/assets/heroes/"]').forEach((img) => {
      labels[last(img.getAttribute('src'))] = img.closest('button').getAttribute('aria-label');
    });
    const partyEl = li.querySelector('[title="In a party"]');
    const partySvg = partyEl && partyEl.querySelector('svg');

    return {
      idx, team, masked, uid, name, slot,
      icon: iconImg ? last(iconImg.getAttribute('src')) : null,
      tier: rk.tier, div: rk.div, rankLabel: rk.label,
      rankIdx: rk.idx, rs: rk.rs, abs: rk.abs,
      qp: ranks.qp ? { label: ranks.qp.label, rs: ranks.qp.rs, abs: ranks.qp.abs, rankIdx: ranks.qp.idx } : null,
      w: wl ? +wl[1] : null, l: wl ? +wl[2] : null,
      heroes: heroes.length ? heroes : null,
      heroLabels: labels,
      party: !!partyEl,
      partyColor: partySvg ? (partySvg.style.color || null) : null,
      isProfileOwner: !!(link && link.getAttribute('aria-current') === 'page'),
      el: li,
      nameEl: nameCell || grid,
      heroesEl: grid.children[4] || null,           // the Top Heroes cell (blank boxes while the name is hidden)
    };
  }

  // ---- the expanded row (chevron): Heroes (games + win%), Proficiency (Lv) and Match history (W/L + RS change) ----
  const HERO_IMG = 'img[src*="/assets/heroes/"]';
  // One string per ELEMENT (its own text nodes joined): React renders `Lv {level}`, `{wr}%` and `+{rs}` as several
  // adjacent text nodes, which must read as "Lv 51", "67%" and "+14" again.
  function leafTexts(node) {
    const out = [];
    [node].concat(Array.from(node.querySelectorAll('*'))).forEach((e) => {
      const t = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    });
    return out;
  }
  const HEADING = /^(?:Heroes|Proficiency|Match History|Season\s*\d*|Lv\.?\s*\d*|Level\s*\d*|W|L|Win|Loss)$/i;
  /** The hero's display name as written in its row (the icons carry no alt text on the real site). */
  const nameFrom = (t) => t.find((x) => /[A-Za-z]{3,}/.test(x) && !HEADING.test(x) && !/^[+\-−–]?\s*\d/.test(x)) || null;
  /** Smallest ancestor of a hero icon that still holds only that one icon = that icon's row. */
  function rowOf(img, scope) {
    let row = img;
    while (row.parentElement && row !== scope && row.parentElement !== scope && row.parentElement.querySelectorAll(HERO_IMG).length === 1) row = row.parentElement;
    return row;
  }
  const signed = (t) => { const m = /^([+\-−–])\s*(\d+)$/.exec(t); return m ? (m[1] === '+' ? 1 : -1) * +m[2] : null; };

  /**
   * Rows are told apart by what they contain, not by class names:
   *   "Lv 51"                      -> proficiency      "12" + "67%"        -> hero record
   *   "W"/"L" (+ "+14"/"-22")      -> match history
   * `scopes` = the elements that may hold the panel (the row itself, and the node after it).
   */
  function scrapeDetail(scopes) {
    const d = { season: null, heroes: [], proficiency: [], matches: [] };
    const seen = new Set();
    (Array.isArray(scopes) ? scopes : [scopes]).filter(Boolean).forEach((scope) => {
      if (d.season == null) { const m = leafTexts(scope).map((t) => /^Season\s+(\d+)$/.exec(t)).find(Boolean); if (m) d.season = +m[1]; }
      scope.querySelectorAll(HERO_IMG).forEach((img) => {
        const row = rowOf(img, scope);
        if (seen.has(row)) return;
        seen.add(row);
        const t = leafTexts(row);
        if (!t.length) return;                                              // a plain hero icon (e.g. the Top Heroes tiles)
        const slug = last(img.getAttribute('src')), name = (img.getAttribute('alt') || img.getAttribute('title') || '').trim() || nameFrom(t);
        const lv = /(?:^|\s)(?:Lv\.?|Level)\s*(\d+)(?:\s|$)/i.exec(t.join(' '));     // also if "Lv" and the number sit in separate elements
        const res = t.find((x) => /^(W|L|Win|Loss|Victory|Defeat)$/i.test(x));
        const pc = t.map((x) => /^(\d+(?:\.\d+)?)\s*%$/.exec(x)).find(Boolean);
        if (lv) d.proficiency.push({ slug, name, level: +lv[1] });
        else if (res) d.matches.push({ slug, name, result: /^(W|Win|Victory)$/i.test(res) ? 'W' : 'L', rs: t.map(signed).find((v) => v != null) ?? null });
        else if (pc) { const g = t.find((x) => /^\d+$/.test(x)); d.heroes.push({ slug, name, games: g != null ? +g : null, wr: Math.round(+pc[1]) }); }
      });
    });
    return d.heroes.length || d.proficiency.length || d.matches.length ? d : null;
  }

  /** @returns {null | {season, teams:[{label, avg}], rows:[row]}} */
  function scrapeLive(doc) {
    const panel = findPanel(doc);
    if (!panel) return null;
    const rows = [], teams = [];
    panel.querySelectorAll('section').forEach((sec, ti) => {
      const label = (/Team\s*\d+/.exec(sec.textContent) || ['Team ' + (ti + 1)])[0];
      const avg = /Avg:\s*(\d+)\s*RS/.exec(sec.textContent);
      teams.push({ label, avg: avg ? +avg[1] : null });
      sec.querySelectorAll('ul > li').forEach((li) => {
        const r = parseRow(li, ti + 1, rows.length);
        if (r) rows.push(r);
      });
    });
    if (!rows.length) return null;
    let season = null;
    for (const e of doc.querySelectorAll('button span, button')) {
      const m = /^Season\s+(\d+)$/.exec(e.textContent.trim());
      if (m) { season = +m[1]; break; }
    }
    // Mode: the profile header reads "In game (Quick Play)" / "In game (Competitive)"; the second (QP) rank column is a fallback.
    const mm = /In game \(([^)]+)\)/.exec(doc.body ? doc.body.textContent : '');
    const mode = mm ? mm[1].trim().toLowerCase() : null;
    const qpLobby = mode ? mode.includes('quick') : rows.some((r) => r.qp);
    rows.forEach((r) => { r.qpLobby = qpLobby; });
    return { season, teams, rows, qpLobby, mode };
  }

  root.RDT = Object.assign(root.RDT || {}, { scrapeLive, scrapeDetail });
  if (typeof module !== 'undefined' && module.exports) module.exports = { scrapeLive, scrapeDetail };
})(typeof globalThis !== 'undefined' ? globalThis : this);
