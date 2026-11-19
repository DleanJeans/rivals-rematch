/*
 * Orchestrator. On every change of the Live Game panel:
 *   1. rows with a visible identity  -> saved to the local DB
 *   2. rows with a masked identity   -> matched against the DB, shown as chips + HUD
 */
(function (root) {
  'use strict';
  if (root.__rdtContentLoaded) return;
  root.__rdtContentLoaded = true;
  const R = root.RDT, S = R.store;
  const doc = root.document;
  const HERO = (s) => 'https://rivalsdata.com/assets/heroes/' + encodeURIComponent(s) + '.webp';
  const ICON = (s) => 'https://cdn.rivalsdata.com/assets/icons/' + encodeURIComponent(s) + '.webp';
  // rank text with its icon in front: <span class="rk"><img> GM1</span>
  function rankSpan(label, extraClass) {
    const sp = el('span', 'rk' + (extraClass ? ' ' + extraClass : ''));
    const url = label && R.rankIconUrl(label);
    if (url) { const im = doc.createElement('img'); im.src = url; im.alt = ''; sp.appendChild(im); }
    sp.appendChild(doc.createTextNode(label || 'QP only'));
    return sp;
  }
  const PLAYER = (u) => 'https://rivalsdata.com/player/' + encodeURIComponent(u);

  let host = null, shadow = null, chipLayer = null, hud = null;
  let lastSig = '', running = false, again = false, current = null;
  let hudCollapsed = null; // null = auto
  let pending = new Map(); // ban-phase guesses awaiting the reveal: key -> {uid, suffix, t}
  let stats = {};
  let statusText = 'starting…';
  let lastResult = { noPanel: true };

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
  .chip{position:fixed;display:flex;align-items:center;gap:6px;padding:0 8px;border-radius:6px;
    background:#1c1f26;border:1px solid #3a3f4b;color:#e8eaf0;font-size:13px;font-weight:500;overflow:hidden;
    white-space:nowrap;pointer-events:auto;cursor:default}
  .chip .nm{overflow:hidden;text-overflow:ellipsis}
  .chip .pc{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;padding:1px 5px;border-radius:4px}
  .hi{border-color:#2f8f46}.hi .pc{background:#1f5a2e;color:#b8f2c5}
  .mid{border-color:#b8892a}.mid .pc{background:#6b4f12;color:#ffe2a1}
  .lo{border-color:#4a4f5c;color:#aab}.lo .pc{background:#30343e;color:#bbc}
  .none{border-style:dashed;color:#8a90a0;font-weight:400}
  .tip{position:fixed;inset:auto;margin:0;z-index:2147483002;display:none;max-width:320px;background:#12141a;border:1px solid #4a4f5c;border-radius:8px;
    padding:8px 10px;color:#dfe2ea;font-size:12px;line-height:1.45;pointer-events:none;box-shadow:0 6px 24px #000a}
  .tip b{color:#fff}.tip .dim{color:#8e94a4}
  .hud{position:fixed;left:14px;bottom:14px;z-index:2147483001;width:430px;max-width:calc(100vw - 28px);max-height:70vh;overflow:auto;
    background:#14161c;border:1px solid #3a3f4b;border-radius:10px;color:#e4e7ee;font-size:12px;pointer-events:auto;
    box-shadow:0 8px 30px #000b}
  .hud.min{width:auto;overflow:hidden}
  .hh{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none;font-weight:600;
    position:sticky;top:0;background:#1b1e26;border-bottom:1px solid #2c303a}
  .hh .sp{flex:1}.hh .sub{font-weight:400;color:#8e94a4}
  .hud.min .hh{border-bottom:0;position:static}
  .r{display:grid;grid-template-columns:22px 1fr auto;gap:2px 8px;padding:7px 10px;border-bottom:1px solid #22252d;align-items:center}
  .r:last-child{border-bottom:0}
  .t1{color:#6ea8ff}.t2{color:#ff7b7b}.tm{font-weight:700;text-align:center}
  .who img.av{width:20px;height:20px;border-radius:4px;vertical-align:middle;margin-right:6px;background:#2a2d36}
  .rk{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.rk img{width:18px;height:18px;object-fit:contain}
  .who a{color:#fff;font-weight:600;text-decoration:none}.who a:hover{text-decoration:underline}
  .who .q{color:#8e94a4;font-weight:400}
  .meta{grid-column:2/4;color:#8e94a4;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
  .heroes{display:flex;gap:3px}.heroes img{width:26px;height:26px;border-radius:4px;background:#2a2d36}
  .badge{padding:0 5px;border-radius:4px;background:#2a2d36;color:#cdd}
  .badge.tag{background:#5a2a2a;color:#ffd0d0}
  .badge.star{background:#5a4a12;color:#ffe08a}
  .foot{padding:7px 10px;color:#8e94a4;border-top:1px solid #22252d}
  `;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = doc.createElement('div'); host.id = 'rdt-host';
    shadow = host.attachShadow({ mode: 'open' });
    const st = doc.createElement('style'); st.textContent = CSS; shadow.appendChild(st);
    chipLayer = doc.createElement('div'); chipLayer.className = 'layer'; shadow.appendChild(chipLayer);
    hud = doc.createElement('div'); hud.className = 'hud'; shadow.appendChild(hud);
    doc.body.appendChild(host);
    tip = doc.createElement('div'); tip.className = 'tip'; tip.setAttribute('popover', 'manual'); shadow.appendChild(tip); // top layer: always above the chips
  }
  let tip = null;
  function clearOverlay() { if (host) { host.remove(); host = null; } }

  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pct = (p) => Math.round(p * 100) + '%';
  const ago = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  };
  const wlText = (l) => (l && l.w != null ? l.w + 'W-' + l.l + 'L' : '');

  function playerLine(p) {
    const l = p.last || {};
    return [l.rankLabel ? l.rankLabel + (l.rs != null ? ' ' + l.rs + ' RS' : '') : '', wlText(l),
      'seen ' + ago(p.lastSeen)].filter(Boolean).join(' · ');
  }

  // --------------------------------------------------------------- rendering
  function chipClass(m, minShow) {
    if (!m.uid) return 'none';
    return m.p >= Math.max(0.8, minShow) ? 'hi' : m.p >= minShow ? 'mid' : 'lo';
  }

  function render(items, settings) {
    ensureHost();
    chipLayer.textContent = '';
    items.forEach((it) => {
      const cls = chipClass(it.match, settings.minShow);
      const c = el('div', 'chip ' + cls);
      const player = it.player;
      const label = !it.match.uid ? 'no match' : (cls === 'lo' ? '(maybe) ' : '') + (player.names[0] || player.uid);
      c.appendChild(el('span', 'nm', label));
      if (it.match.uid) c.appendChild(el('span', 'pc', pct(it.match.p)));
      c.addEventListener('mouseenter', () => showTip(it, c));
      c.addEventListener('mouseleave', hideTip);
      c.dataset.row = it.row.idx;
      chipLayer.appendChild(c);
      it.chip = c;
    });
    renderHud(items, settings);
    position(items);
  }

  function position(items) {
    items = items || (current && current.items) || [];
    items.forEach((it) => {
      if (!it.chip || !it.row.nameEl.isConnected) return;
      const r = it.row.nameEl.getBoundingClientRect();
      const s = it.chip.style;
      s.left = r.left + 'px'; s.top = (r.top + 1) + 'px';
      s.width = Math.max(r.width, 90) + 'px'; s.height = Math.max(r.height - 2, 20) + 'px';
      const off = r.bottom < 0 || r.top > root.innerHeight;
      s.display = off ? 'none' : 'flex';
    });
  }

  function hideTip() {
    tip.style.display = 'none';
    try { if (tip.matches(':popover-open')) tip.hidePopover(); } catch (_) { /* older Chrome: z-index fallback */ }
  }

  function showTip(it, anchor) {
    tip.textContent = '';
    const p = it.player;
    tip.appendChild(el('div', '', 'Hidden: ' + [(it.row.rankLabel || 'QP only') + (it.row.rs != null ? ' ' + it.row.rs + ' RS' : ''),
      it.row.w != null ? it.row.w + 'W-' + it.row.l + 'L' : '', it.row.suffix ? 'name ends “' + it.row.suffix + '”' : '']
      .filter(Boolean).join(' · ')));
    if (!it.match.uid) tip.appendChild(el('div', 'dim', 'No stored player fits these numbers — probably someone new.'));
    it.match.alts.forEach((a, i) => {
      const ap = it.byUid[a.uid]; if (!ap || (a.p < 0.03 && a.uid !== it.match.uid)) return;   // skip hopeless alternatives
      const d = el('div', '');
      d.appendChild(el('b', '', (i === 0 ? '' : 'or ') + (ap.names[0] || a.uid)));
      d.appendChild(doc.createTextNode(' ' + pct(a.p)));
      d.appendChild(el('div', 'dim', playerLine(ap)));
      tip.appendChild(d);
    });
    void p;
    tip.style.display = 'block';
    try { if (tip.showPopover && !tip.matches(':popover-open')) tip.showPopover(); } catch (_) { /* fall back to z-index */ }
    const r = anchor.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left, root.innerWidth - 330)) + 'px';
    tip.style.top = Math.min(r.bottom + 6, root.innerHeight - tip.offsetHeight - 8) + 'px';
  }

  function renderHud(items, settings) {
    hud.textContent = '';
    const collapsed = hudCollapsed == null ? !items.length : hudCollapsed;
    hud.classList.toggle('min', collapsed);
    const hh = el('div', 'hh');
    const matched = items.filter((i) => i.match.uid && i.match.p >= settings.minShow).length;
    hh.appendChild(el('span', '', 'Rivals Rematch'));
    hh.appendChild(el('span', 'sub', items.length ? matched + '/' + items.length + ' hidden players recognised'
      : current.playersCount + ' players saved · ' + statusText));
    hh.appendChild(el('span', 'sp'));
    hh.appendChild(el('span', 'sub', collapsed ? '▲' : '▼'));
    hh.addEventListener('click', () => { hudCollapsed = !collapsed; renderHud(items, settings); });
    hud.appendChild(hh);
    if (collapsed) return;

    items.forEach((it) => {
      const row = el('div', 'r');
      row.appendChild(el('div', 'tm t' + it.row.team, 'T' + it.row.team));
      const who = el('div', 'who');
      if (it.match.uid && it.player.icon) { const av = doc.createElement('img'); av.className = 'av'; av.src = ICON(it.player.icon); av.alt = ''; who.appendChild(av); }
      if (it.match.uid) {
        const a = el('a', '', it.player.names[0] || it.player.uid); a.href = PLAYER(it.match.uid); a.target = '_blank'; a.rel = 'noopener';
        who.appendChild(a);
        who.appendChild(el('span', 'q', '  ' + pct(it.match.p) + (it.match.p < settings.minShow ? ' (low)' : '')));
      } else who.appendChild(el('span', 'q', 'unrecognised · ' + (it.row.rankLabel || 'QP only') + (it.row.suffix ? ' …' + it.row.suffix : '')));
      row.appendChild(who);
      const rc = el('div', 'q'); rc.appendChild(rankSpan(it.row.rankLabel)); row.appendChild(rc);
      if (it.match.uid) {
        const p = it.player, l = p.last || {};
        const meta = el('div', 'meta');
        if (l.heroes && l.heroes.length) {
          const hs = el('span', 'heroes');
          l.heroes.slice(0, 4).forEach((h) => {
            const im = doc.createElement('img'); im.src = HERO(h); im.alt = (l.heroLabels && l.heroLabels[h]) || h; im.title = im.alt; hs.appendChild(im);
          });
          meta.appendChild(hs);
        }
        const rel = [];
        if (p.asTeammate) rel.push('teammate ×' + p.asTeammate);
        if (p.asEnemy) rel.push('enemy ×' + p.asEnemy);
        meta.appendChild(el('span', '', rel.join(' · ') || ('seen ×' + p.seen)));
        meta.appendChild(el('span', '', wlText(l)));
        if (l.party) meta.appendChild(el('span', 'badge', 'was in party'));
        if (p.starred) meta.appendChild(el('span', 'badge star', '★ starred'));
        if (p.tag) meta.appendChild(el('span', 'badge tag', p.tag));
        if (p.note) meta.appendChild(el('span', '', '“' + p.note + '”'));
        row.appendChild(meta);
      }
      hud.appendChild(row);
    });
    if (!items.length) hud.appendChild(el('div', 'foot', 'No hidden players right now. Names get saved automatically whenever they are visible.'));
    if (stats.checked) hud.appendChild(el('div', 'foot',
      'Past guesses verified at reveal: ' + stats.correct + '/' + stats.checked + ' correct' +
      (stats.suffixChecked ? ' · name-suffix rule held ' + stats.suffixOk + '/' + stats.suffixChecked : '')));
  }

  // ------------------------------------------------------------------- logic
  const sigOf = (lobby) => JSON.stringify([lobby.season, lobby.rows.map((r) => [r.uid, r.name, r.rankLabel, r.rs, r.w, r.l,
    r.icon, r.heroes, r.party, r.team])]);

  async function verifyGuesses(lobby) {
    if (!pending.size) return;
    const known = lobby.rows.filter((r) => r.uid);
    const byKey = new Map();
    known.forEach((r) => { const k = r.team + '|' + r.rankIdx + '|' + r.icon; byKey.set(k, byKey.has(k) ? null : r); });
    let checked = 0, correct = 0, sc = 0, so = 0;
    for (const [k, g] of Array.from(pending)) {
      if (Date.now() - g.t > 3600e3) { pending.delete(k); continue; }
      const r = byKey.get(k);
      if (!r) continue;
      pending.delete(k); checked++;
      if (r.uid === g.uid) correct++;
      if (g.suffix) { sc++; if (r.name.toLowerCase().endsWith(g.suffix.toLowerCase())) so++; }
    }
    if (checked) stats = await S.recordOutcome(checked, correct, sc, so);
  }

  async function tick() {
    if (running) { again = true; return; }
    running = true;
    try {
      const lobby = R.scrapeLive(doc);
      if (!lobby) { clearOverlay(); lastSig = ''; lastResult = { noPanel: true }; return lastResult; }
      const sig = sigOf(lobby);
      if (sig === lastSig) { position(); return lastResult; }
      lastSig = sig;

      const settings = await S.getSettings();
      await verifyGuesses(lobby);
      const ing = await S.ingest(lobby, settings);
      const hiddenN = lobby.rows.filter((r) => r.masked).length;
      lastResult = { noPanel: false, total: lobby.rows.length, saved: ing.saved, newGame: ing.newGame, hidden: hiddenN, matched: 0 };
      statusText = ing.saved
        ? 'saved ' + ing.saved + ' from this lobby' + (hiddenN ? ', ' + hiddenN + ' hidden' : '')
        : 'all ' + lobby.rows.length + ' names hidden — saved once revealed';

      const all = await S.loadPlayers();
      const hidden = lobby.rows.filter((r) => r.masked);
      const visible = new Set(lobby.rows.filter((r) => r.uid).map((r) => r.uid));
      const maxAge = R.DEFAULTS.maxAgeDays * 86400e3;
      const pool = all.filter((p) => !visible.has(p.uid) && Date.now() - (p.lastSeen || 0) < maxAge);
      const byUid = {}; pool.forEach((p) => { byUid[p.uid] = p; });
      current = { lobby, items: [], playersCount: all.length };
      if (!settings.overlay) { clearOverlay(); return lastResult; }

      // Avatars count unless the site is clearly masking them (many hidden rows, all one placeholder).
      const hiddenIcons = new Set(hidden.map((r) => r.icon).filter(Boolean));
      const iconsMasked = hidden.length >= 4 && hiddenIcons.size <= 1;
      const iconFreq = {};
      pool.forEach((p) => { if (p.icon) iconFreq[p.icon] = (iconFreq[p.icon] || 0) + 1 / pool.length; });
      stats = (await S.loadAll()).stats;
      const iconSwap = (((stats.iconChecked || 0) - (stats.iconSame || 0)) + 2) / ((stats.iconChecked || 0) + 5); // prior 40 % swap
      const matches = R.matchLobby(hidden.map((r) => ({
        rankIdx: r.rankIdx, abs: r.abs, w: r.w, l: r.l, season: lobby.season, icon: r.icon,
        suffix: r.suffix || null, heroes: r.heroes, qpLobby: r.qpLobby,
      })), pool.map(S.toCandidate), { useSuffix: settings.useSuffix && suffixTrusted(), useIcons: settings.useIcons && !iconsMasked, iconFreq, iconSwap });

      current.items = hidden.map((row, i) => ({ row, match: matches[i], player: byUid[matches[i].uid] || null, byUid }));
      current.items.forEach((it) => {
        if (it.match.uid && it.match.p >= settings.minShow) {
          pending.set(it.row.team + '|' + it.row.rankIdx + '|' + it.row.icon,
            { uid: it.match.uid, suffix: it.row.suffix, t: Date.now() });
        }
      });
      lastResult.matched = current.items.filter((i) => i.match.uid && i.match.p >= settings.minShow).length;
      render(current.items, settings);
      return lastResult;
    } catch (e) {
      console.warn('[Rivals Rematch]', e);
      lastResult = { error: String(e && e.message || e) };
      try { statusText = 'ERROR: ' + (e && e.message || e); ensureHost(); hud.textContent = ''; hudCollapsed = false; hud.classList.remove('min');
        const h = el('div', 'hh'); h.appendChild(el('span', '', 'Rivals Rematch')); h.appendChild(el('span', 'sub', statusText)); hud.appendChild(h); } catch (_) { /* nothing more to do */ }
    } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  }

  // If reveal checks show the "last characters of the name" assumption is wrong, stop using it.
  const suffixTrusted = () => !(stats.suffixChecked >= 6 && stats.suffixOk / stats.suffixChecked < 0.6);

  /** Force a fresh read + save right now (used by the toolbar popup). */
  async function scanNow() {
    for (let i = 0; i < 40 && running; i++) await new Promise((r) => setTimeout(r, 50));
    lastSig = '';
    const r = await tick();
    return r || lastResult;
  }

  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, 250); }

  async function start() {
    try { if (root.chrome.runtime && root.chrome.runtime.getURL) await S.loadSeed(root.chrome.runtime.getURL('data/players.json')); } catch (_) { /* optional */ }
    stats = (await S.loadAll()).stats;
    const mo = new MutationObserver((muts) => {
      if (host && muts.every((m) => host.contains(m.target))) return; // ignore our own overlay
      schedule();
    });
    mo.observe(doc.body, { childList: true, subtree: true, characterData: true });
    root.addEventListener('scroll', () => position(), true);
    root.addEventListener('resize', () => position());
    root.chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.rdt_settings) { lastSig = ''; schedule(); }
    });
    if (root.chrome.runtime && root.chrome.runtime.onMessage) root.chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'rdt-ping') { reply({ ok: true }); return; }
      if (msg && msg.type === 'rdt-scan') { scanNow().then(reply, (e) => reply({ error: String(e) })); return true; }
    });
    schedule();
  }

  root.RDT = Object.assign(root.RDT || {}, { _content: { tick, start } });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
