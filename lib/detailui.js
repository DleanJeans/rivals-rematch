/*
 * Hero tiles with a hover tooltip, and the three-panel dropdown (Heroes / Proficiency / Match history),
 * modelled on rivalsdata's Live Game rows. Used by the database page and the on-page panel (inside a shadow root).
 *
 * `detail` is what content/scrape.js reads from a player's expanded row:
 *   { t, season, heroes:[{slug,name,games,wr}], proficiency:[{slug,name,level}], matches:[{slug,name,result,rs}] }
 */
(function (root) {
  'use strict';
  const GOOD = '#4AAC4D', BAD = '#f87171';
  const HERO = (s) => 'https://rivalsdata.com/assets/heroes/' + encodeURIComponent(s) + '.webp';
  const mk = (tag, cls, text) => { const e = root.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pretty = (slug) => String(slug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const lvColor = (lv) => (lv >= 50 ? '#e5484d' : lv >= 35 ? '#c084fc' : lv >= 27 ? '#7dd3e0' : lv >= 22 ? '#5fb3a6' : '#e3b45a');
  const lvWidth = (lv) => Math.max(4, Math.min(100, Math.round(((lv - 20) / 35) * 100)));   // matches the site's bar lengths

  const css = `
  .dtile{width:32px;height:32px;border-radius:6px;background:var(--line,#2a2d36);object-fit:cover;cursor:default;outline:none}
  .dtile:hover,.dtile:focus-visible{box-shadow:0 0 0 2px var(--acc,#ffd050)}
  .dtip{position:fixed;inset:auto;margin:0;display:none;z-index:2147483003;pointer-events:none;border:1px solid #3a3f4b;border-radius:10px;
    background:#14161c;color:#eef0f5;padding:8px 14px 8px 8px;box-shadow:0 8px 28px #000a;font:13px/1.3 Inter,system-ui,sans-serif;align-items:center;gap:10px;white-space:nowrap}
  .dtip img{width:34px;height:34px;border-radius:6px;background:#2a2d36}
  .dtip b{font-size:14px;margin-right:6px}.dtip .st{font-weight:600}.dtip .dm{color:#8e94a4;font-weight:400}
  .chev{border:0;background:none;color:var(--dim,#8e94a4);cursor:pointer;font-size:14px;padding:2px 6px;line-height:1}
  .chev:hover{color:var(--tx,#fff)}
  .dp{display:grid;grid-template-columns:1.1fr 1.3fr 1fr;border-top:1px solid var(--line,#2a2d36);background:var(--card,#171a21);font-size:13px;color:var(--tx,#e6e8ee)}
  .dp .col{padding:6px 0 10px;min-width:0}.dp .col+.col{border-left:1px solid var(--line,#2a2d36)}
  .dp h5{margin:0;padding:8px 12px;font-size:11px;letter-spacing:.06em;color:var(--dim,#8e94a4);font-weight:600;display:flex;justify-content:space-between;align-items:center}
  .dp h5 .chip{font-weight:500;letter-spacing:0;border:1px solid var(--line,#2a2d36);border-radius:6px;padding:1px 8px;color:var(--tx,#e6e8ee)}
  .dp .r{display:grid;align-items:center;gap:10px;padding:4px 12px}
  .dp .hr{grid-template-columns:28px 1fr 34px 46px}
  .dp .pr{grid-template-columns:28px 1fr 46px}
  .dp .mr{grid-template-columns:28px 18px 1fr}
  .dp .r img{width:28px;height:28px;border-radius:5px;background:var(--line,#2a2d36)}
  .dp .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dp .g{color:var(--dim,#8e94a4);text-align:right;font-variant-numeric:tabular-nums}
  .dp .p{text-align:right;font-variant-numeric:tabular-nums}
  .dp .bar{height:9px;border-radius:5px;background:color-mix(in srgb,var(--tx,#fff) 10%,transparent);overflow:hidden}
  .dp .bar i{display:block;height:100%;border-radius:5px}
  .dp .mr.w{background:color-mix(in srgb,${GOOD} 13%,transparent)}.dp .mr.l{background:color-mix(in srgb,${BAD} 13%,transparent)}
  .dp .mr .wl{font-weight:700}.dp .mr .rs{text-align:right;font-variant-numeric:tabular-nums}
  .dp .empty{padding:14px 16px;color:var(--dim,#8e94a4);grid-column:1/-1}
  .dp .foot{grid-column:1/-1;padding:4px 12px 8px;font-size:11px;color:var(--dim,#8e94a4)}
  @media (max-width:760px){.dp{grid-template-columns:1fr}.dp .col+.col{border-left:0;border-top:1px solid var(--line,#2a2d36)}}
  `;

  /** Stats for one hero from a player's detail: season record (derived from games x win%) and proficiency level. */
  function heroStat(d, slug) {
    if (!d) return null;
    const h = (d.heroes || []).find((x) => x.slug === slug), p = (d.proficiency || []).find((x) => x.slug === slug);
    if (!h && !p) return null;
    let w = null, l = null;
    if (h && h.games != null && h.wr != null) { w = Math.round((h.games * h.wr) / 100); l = h.games - w; }
    return { name: (h && h.name) || (p && p.name) || pretty(slug), games: h ? h.games : null, wr: h ? h.wr : null, w, l, level: p ? p.level : null };
  }

  /** One tooltip element per root: <img> + hero name + "29W 21L" (or "Level 44" when there is no season record). */
  function makeTip(host) {
    const tip = mk('div', 'dtip'); tip.setAttribute('popover', 'manual'); host.appendChild(tip);
    return {
      show(anchor, slug, d, labels, note) {
        const st = heroStat(d, slug);
        tip.textContent = '';
        const im = root.document.createElement('img'); im.src = HERO(slug); im.alt = ''; tip.appendChild(im);
        tip.appendChild(mk('b', '', (st && st.name) || (labels && labels[slug]) || pretty(slug)));
        if (!st) tip.appendChild(mk('span', 'dm', 'no stats saved yet'));
        else {
          if (st.w != null) tip.appendChild(mk('span', 'st', st.w + 'W ' + st.l + 'L'));
          if (st.level != null) tip.appendChild(mk('span', st.w != null ? 'dm' : 'st', (st.w != null ? '· Lv ' : 'Level ') + st.level));
        }
        if (note) tip.appendChild(mk('span', 'dm', '· ' + note));
        tip.style.display = 'flex';
        try { if (tip.showPopover && !tip.matches(':popover-open')) tip.showPopover(); } catch (_) { /* z-index fallback */ }
        const r = anchor.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(6, Math.min(r.left, root.innerWidth - tw - 6)) + 'px';
        tip.style.top = (r.bottom + th + 12 > root.innerHeight ? Math.max(6, r.top - th - 8) : r.bottom + 8) + 'px';
      },
      hide() {
        tip.style.display = 'none';
        try { if (tip.matches(':popover-open')) tip.hidePopover(); } catch (_) { /* ignore */ }
      },
    };
  }

  function heroTile(slug, d, tip, labels, note) {
    const im = root.document.createElement('img');
    im.className = 'dtile'; im.src = HERO(slug); im.alt = (labels && labels[slug]) || pretty(slug); im.tabIndex = 0; im.dataset.slug = slug;
    const on = () => tip.show(im, slug, d, labels, note), off = () => tip.hide();
    im.addEventListener('mouseenter', on); im.addEventListener('focus', on);
    im.addEventListener('mouseleave', off); im.addEventListener('blur', off);
    return im;
  }

  function heroImg(slug) { const im = root.document.createElement('img'); im.src = HERO(slug); im.alt = ''; return im; }
  const pct = (n) => { const s = mk('span', 'p', n + '%'); s.style.color = n >= 50 ? GOOD : BAD; return s; };

  /** The dropdown shown under a player row: Heroes | Proficiency | Match history. */
  function detailPanel(d) {
    const dp = mk('div', 'dp');
    if (!d || !((d.heroes || []).length || (d.proficiency || []).length || (d.matches || []).length)) {
      dp.appendChild(mk('div', 'empty', 'No hero details saved for this player yet. Open their lobby on rivalsdata.com and press “Read hero details” in the extension popup.'));
      return dp;
    }
    const col = (title, chip) => { const c = mk('div', 'col'); const h = mk('h5'); h.appendChild(mk('span', '', title)); if (chip) h.appendChild(mk('span', 'chip', chip)); c.appendChild(h); dp.appendChild(c); return c; };

    const hc = col('HEROES', d.season ? 'Season ' + d.season : null);
    (d.heroes || []).slice().sort((a, b) => (b.games || 0) - (a.games || 0)).slice(0, 14).forEach((h) => {
      const r = mk('div', 'r hr'); r.appendChild(heroImg(h.slug)); r.appendChild(mk('span', 'nm', h.name || pretty(h.slug)));
      r.appendChild(mk('span', 'g', h.games != null ? String(h.games) : '')); r.appendChild(h.wr != null ? pct(h.wr) : mk('span')); hc.appendChild(r);
    });

    const pc = col('PROFICIENCY');
    (d.proficiency || []).slice().sort((a, b) => (b.level || 0) - (a.level || 0)).slice(0, 14).forEach((h) => {
      const r = mk('div', 'r pr'); r.appendChild(heroImg(h.slug));
      const bar = mk('div', 'bar'); const i = mk('i'); i.style.width = lvWidth(h.level) + '%'; i.style.background = lvColor(h.level); bar.appendChild(i); bar.title = h.name || pretty(h.slug);
      r.appendChild(bar); r.appendChild(mk('span', 'p', 'Lv ' + h.level)); pc.appendChild(r);
    });

    const mc = col('MATCH HISTORY');
    (d.matches || []).slice(0, 14).forEach((m) => {
      const win = m.result === 'W';
      const r = mk('div', 'r mr ' + (win ? 'w' : 'l')); r.appendChild(heroImg(m.slug));
      const wl = mk('span', 'wl', m.result); wl.style.color = win ? GOOD : BAD; r.appendChild(wl);
      const rs = mk('span', 'rs', m.rs == null ? '' : (m.rs >= 0 ? '+' : '') + m.rs); rs.style.color = m.rs > 0 ? GOOD : m.rs < 0 ? BAD : 'inherit'; r.appendChild(rs); mc.appendChild(r);
    });
    if (d.t) dp.appendChild(mk('div', 'foot', 'Read ' + new Date(d.t).toLocaleString()));
    return dp;
  }

  root.RDT = Object.assign(root.RDT || {}, { ui: { css, heroStat, makeTip, heroTile, detailPanel, pretty } });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RDT.ui;
})(typeof globalThis !== 'undefined' ? globalThis : this);
