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
    // "*****7" -> suffix "7": the only characters of the real name still visible.
    const suffix = masked ? name.replace(/^[*•·\s]+/, '') : null;

    const ranks = parseRankSpans(li);
    if (!ranks.ranked && !ranks.qp) return null; // not a player row
    const rk = ranks.ranked || { tier: null, div: null, label: null, idx: null, rs: null, abs: null };

    // Read the W/L cell on its own: li.textContent would glue a name suffix ("*****1") onto "4W - 7L".
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
      idx, team, masked, uid, name, suffix,
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
    };
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
    const qpLobby = rows.some((r) => r.qp);   // QP lobbies show a second, (QP)-labelled rank column
    rows.forEach((r) => { r.qpLobby = qpLobby; });
    return { season, teams, rows, qpLobby };
  }

  root.RDT = Object.assign(root.RDT || {}, { scrapeLive });
  if (typeof module !== 'undefined' && module.exports) module.exports = { scrapeLive };
})(typeof globalThis !== 'undefined' ? globalThis : this);
