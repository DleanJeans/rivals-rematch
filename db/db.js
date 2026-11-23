(function () {
  'use strict';
  const S = RDT.store, $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ICON = (s) => 'https://cdn.rivalsdata.com/assets/icons/' + encodeURIComponent(s) + '.webp';
  const HERO = (s) => 'https://rivalsdata.com/assets/heroes/' + encodeURIComponent(s) + '.webp';
  let data = { players: [], games: [], stats: {}, settings: {} };
  let sortKey = 'when', sortDir = -1;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: RDT.ui.css }));
  const tip = RDT.ui.makeTip(document.body);          // hero tooltip (name + record / level)
  const openRows = new Set();                          // rows whose dropdown is open (survives redraws)

  const ago = (t) => {
    if (!t) return '';
    const s = (Date.now() - t) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  };
  const wr = (l) => (l && l.w != null && l.w + l.l ? l.w / (l.w + l.l) : -1);
  const key = {
    name: (p) => (p.names[0] || '').toLowerCase(), abs: (p) => (p.last && p.last.abs) || -1e9,
    wr, seen: (p) => p.seen, when: (p) => p.lastSeen,
    online: (p) => { const o = S.onlineOf(p); return o === true ? 2 : o === false ? 1 : 0; },
  };

  async function reload() {
    data = await S.loadAll();
    data.all = data.players;
    data.players = data.players.filter((p) => p.uid !== data.settings.selfUid);   // you are not a lobby contact
    $('cPlayers').textContent = data.players.length;
    $('cGames').textContent = data.games.length;
    renderPlayers(); renderLobbies(); renderSettings();
  }


  // ---- cells that mirror rivalsdata's Live Game rows (avatar, name+party, rank icon+RS, winrate, top heroes)
  const GOOD = '#4AAC4D', BAD = '#f87171';
  const SVGNS = 'http://www.w3.org/2000/svg';
  function partyIcon(color) {
    const svg = document.createElementNS(SVGNS, 'svg');
    ['width', 'height'].forEach((a) => svg.setAttribute(a, '14')); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    svg.setAttribute('class', 'party'); svg.style.color = color || '#60a5fa';
    const t = document.createElementNS(SVGNS, 'title'); t.textContent = 'Was in a party'; svg.appendChild(t);
    const path = document.createElementNS(SVGNS, 'path'); path.setAttribute('d', 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2');
    const c = document.createElementNS(SVGNS, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '7'); c.setAttribute('r', '4');
    svg.appendChild(path); svg.appendChild(c); return svg;
  }
  /** avatar + name (+ party icon) [+ "aka" line]; `href` makes the name a link */
  function whoCell(o) {
    const td = el('td', 'nm'); const wrap = el('div', 'who');
    if (o.icon) { const av = document.createElement('img'); av.className = 'av'; av.src = ICON(o.icon); av.alt = ''; av.title = 'Last avatar seen'; wrap.appendChild(av); }
    const txt = el('div', 'nmtxt'); const line = el('div', 'nmline');
    const a = el('a', o.self ? 'me' : '', o.name); a.href = 'https://rivalsdata.com/player/' + o.uid; a.target = '_blank'; a.rel = 'noopener';
    line.appendChild(a); if (o.party) line.appendChild(partyIcon(o.partyColor));
    txt.appendChild(line);
    if (o.aka && o.aka.length) txt.appendChild(el('small', '', 'aka ' + o.aka.join(', ')));
    wrap.appendChild(txt); td.appendChild(wrap); return td;
  }
  function rankCell(label, rs) {
    const td = el('td'); const w = el('span', 'rk');
    const ri = label && RDT.rankIconUrl(label);
    if (ri) { const im = document.createElement('img'); im.src = ri; im.alt = ''; w.appendChild(im); }
    w.appendChild(el('span', 'rl', label || '—'));
    if (label && rs != null) w.appendChild(el('span', 'rs', rs + ' RS'));
    td.appendChild(w); return td;
  }
  function recordCell(w, l) {
    const td = el('td', 'rec');
    if (w == null) { td.appendChild(el('span', 'dim', '—')); return td; }
    const pc = w + l ? Math.round((100 * w) / (w + l)) : 0;
    td.appendChild(el('div', 'wl', w + 'W - ' + l + 'L'));
    const p = el('div', 'pc', pc + '%'); p.style.color = pc >= 50 ? GOOD : BAD; td.appendChild(p); return td;
  }
  function heroesCell(slugs, labels, detail) {
    const td = el('td'); const hw = el('div', 'heroes');
    (slugs || []).slice(0, 4).forEach((h) => hw.appendChild(RDT.ui.heroTile(h, detail, tip, labels)));
    td.appendChild(hw); return td;
  }
  /** Chevron that opens/closes the Heroes | Proficiency | Match history dropdown under `tr`. */
  function chevron(tr, key, detail, ncols) {
    const b = el('button', 'chev', openRows.has(key) ? '▴' : '▾'); b.title = 'Heroes, proficiency and match history';
    b.setAttribute('aria-expanded', String(openRows.has(key)));
    const draw = () => {
      const nxt = tr.nextElementSibling;
      if (nxt && nxt.classList.contains('detail')) nxt.remove();
      if (openRows.has(key)) {
        const dr = el('tr', 'detail'); const td = el('td'); td.colSpan = ncols; td.appendChild(RDT.ui.detailPanel(detail)); dr.appendChild(td); tr.after(dr);
      }
      b.textContent = openRows.has(key) ? '▴' : '▾'; b.setAttribute('aria-expanded', String(openRows.has(key)));
    };
    b.addEventListener('click', () => { if (openRows.has(key)) openRows.delete(key); else openRows.add(key); draw(); });
    b.restore = () => { if (openRows.has(key)) draw(); };
    return b;
  }

  // the players Auto Discover is checking right now are highlighted (and the first one scrolled to)
  let autoNow = [];
  function markAuto(uids) {
    if (uids.join() === autoNow.join()) return;
    autoNow = uids;
    let hit = null;
    document.querySelectorAll('#tbl tbody tr[data-uid]').forEach((r) => { const on = uids.includes(r.dataset.uid); r.classList.toggle('auto-now', on); if (on && !hit) hit = r; });
    if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  try {
    const cur = (st) => (st && st.running && st.inflight ? Object.keys(st.inflight).map((k) => st.inflight[k].uid).sort() : []);
    chrome.storage.local.get('rdt_auto', (r) => markAuto(cur(r && r.rdt_auto)));
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.rdt_auto) markAuto(cur(ch.rdt_auto.newValue)); });
  } catch (_) { /* tests without the extension APIs */ }

  function renderPlayers() {
    const q = $('q').value.trim().toLowerCase(), role = $('role').value;
    let list = data.players.filter((p) => {
      if (q && ![p.uid, p.tag, p.note].concat(p.names).join(' ').toLowerCase().includes(q)) return false;
      if (role === 'mate' && !p.asTeammate) return false;
      if (role === 'enemy' && !p.asEnemy) return false;
      if (role === 'starred' && !p.starred) return false;
      if (role === 'tagged' && !p.tag && !p.note) return false;
      return true;
    });
    const f = key[sortKey] === wr ? (p) => wr(p.last) : key[sortKey];
    list.sort((a, b) => ((b.starred ? 1 : 0) - (a.starred ? 1 : 0)) || (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * sortDir); // starred first
    $('count').textContent = list.length + ' shown';
    $('empty').hidden = data.players.length > 0;
    $('tbl').hidden = data.players.length === 0;
    const tb = document.querySelector('#tbl tbody'); tb.textContent = '';
    list.slice(0, 500).forEach((p) => {
      const l = p.last || {};
      const tr = el('tr'); if (p.starred) tr.className = 'starred'; tr.dataset.uid = p.uid; if (autoNow.includes(p.uid)) tr.classList.add('auto-now');
      const st = el('td', 'st'); const sb = el('button', 'star' + (p.starred ? ' on' : ''), p.starred ? '★' : '☆');
      sb.title = p.starred ? 'Unstar' : 'Star this player'; sb.setAttribute('aria-pressed', String(!!p.starred));
      sb.addEventListener('click', async () => { await S.updatePlayer(p.uid, { starred: !p.starred }); p.starred = !p.starred; renderPlayers(); });
      st.appendChild(sb); tr.appendChild(st);
      tr.appendChild(whoCell({ uid: p.uid, name: p.names[0] || p.uid, icon: p.icon, aka: p.names.slice(1, 4), party: l.party, partyColor: l.partyColor }));
      tr.appendChild(rankCell(l.rankLabel, l.rs));
      tr.appendChild(recordCell(l.w, l.l));
      const hcell = heroesCell(l.heroes, l.heroLabels, p.detail); const chev = chevron(tr, 'P' + p.uid, p.detail, 11); hcell.firstChild.appendChild(chev); tr.appendChild(hcell);
      const seen = el('td'); seen.appendChild(el('div', '', '×' + p.seen));
      const rel = el('div', 'rel');
      if (p.asTeammate) rel.appendChild(el('b', 'm', 'mate ' + p.asTeammate));
      if (p.asTeammate && p.asEnemy) rel.appendChild(document.createTextNode(' · '));
      if (p.asEnemy) rel.appendChild(el('b', 'e', 'enemy ' + p.asEnemy));
      seen.appendChild(rel); tr.appendChild(seen);
      tr.appendChild(el('td', 'dim', ago(p.lastSeen)));
      const on = S.onlineOf(p), ot = el('td', on === true ? 'online' : 'dim', on === true ? '\u25CF In game' : on === false ? 'Offline' : '\u2014');
      if (on != null) { ot.title = 'Checked ' + ago(p.online.t) + (p.online.mode ? ' (' + p.online.mode + ')' : ''); ot.appendChild(el('div', 'rel', ago(p.online.t))); }
      tr.appendChild(ot);
      tr.appendChild(editCell(p, 'tag', 'tag', 'e.g. toxic'));
      tr.appendChild(editCell(p, 'note', '', 'note'));
      const del = el('td'); const x = el('button', 'x', '✕'); x.title = 'Forget this player';
      x.addEventListener('click', async () => { if (confirm('Forget ' + (p.names[0] || p.uid) + '?')) { await S.deletePlayer(p.uid); reload(); } });
      del.appendChild(x); tr.appendChild(del);
      tb.appendChild(tr); chev.restore();
    });
  }
  function editCell(p, field, cls, ph) {
    const td = el('td', cls); const i = document.createElement('input');
    i.value = p[field] || ''; i.placeholder = ph; i.maxLength = 120;
    i.addEventListener('change', () => { p[field] = i.value; S.updatePlayer(p.uid, { [field]: i.value }); });
    td.appendChild(i); return td;
  }

  // ---- Lobbies tab: a list first; clicking a lobby opens its two teams side by side
  /** Open the rivalsdata profile of each player in new background tabs (never your own). */
  async function openProfiles(uids, check) {
    const list = Array.from(new Set(uids)).filter((u) => u && u !== data.settings.selfUid);
    if (!list.length) return 0;
    if (list.length > 14 && !confirm('Open ' + list.length + ' tabs?')) return 0;
    for (const u of list) await chrome.tabs.create({ url: 'https://rivalsdata.com/player/' + encodeURIComponent(u) + (check ? '#rdt-check' : ''), active: false });
    return list.length;
  }
  /** Delete a lobby record (rolls back its counts); optionally forget players who appear in no other lobby. */
  async function deleteLobby(g, n) {
    const when = new Date(g.t).toLocaleString();
    if (!confirm('Delete the lobby from ' + when + ' (' + n + ' players saved)?\n\nOnly the lobby record and the counts it added are removed; the players stay in your database.')) return;
    const pre = await S.previewDeleteGame(g.id);
    const forget = pre.orphans > 0 && confirm('Also forget the ' + pre.orphans + ' player' + (pre.orphans === 1 ? '' : 's') + ' ' + (pre.orphans === 1 ? 'who appears' : 'who appear') + ' in no other lobby?\n\nStarred, tagged or noted players are always kept.');
    await S.deleteGame(g.id, { forgetOrphans: forget });
    openLobbies.delete(g.id);
    await reload();
  }
  const openLobbies = new Set();                      // lobbies that are expanded (survives redraws)
  const avgOf = (rows) => { const v = rows.map((r) => r.abs).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const signedSpan = (df) => { const sp = el('span', 'df', ' (' + (df >= 0 ? '+' : '') + df + ')'); sp.style.color = df >= 0 ? GOOD : BAD; return sp; };

  /** The two team tables (built only when a lobby is opened). */
  function lobbyBody(g, teams, avgs, byUid) {
    const body = el('div', 'lobbody');
    teams.forEach((trs, i) => {
      const col = el('div', 'teamcol');
      const tbl = el('table', 'team'); const hd = el('thead').appendChild(el('tr'));
      const tn = el('th', 'tname'); tn.appendChild(document.createTextNode('Team ' + (i + 1) + ' '));
      const ot = el('button', 'openteam', '↗'); ot.title = 'Open this team\'s profiles in new tabs (tabs of players not in a Competitive game close themselves; Shift-click: just open)'; ot.setAttribute('aria-label', 'Open team ' + (i + 1) + ' profiles in new tabs');
      ot.addEventListener('click', (e) => openProfiles(trs.map((r) => r.uid), !e.shiftKey));
      tn.appendChild(ot); hd.appendChild(tn);
      const th = el('th', 'avg'); th.appendChild(el('span', 'dim', 'Avg: ')); th.appendChild(document.createTextNode(avgs[i] != null ? avgs[i] + ' RS' : '—'));
      if (avgs[i] != null && avgs[1 - i] != null) th.appendChild(signedSpan(avgs[i] - avgs[1 - i]));
      hd.appendChild(th); hd.appendChild(el('th', '', 'Winrate')); hd.appendChild(el('th', '', 'Top Heroes'));
      const tb = el('tbody');
      trs.forEach((r) => {
        const tr = el('tr');
        tr.appendChild(whoCell({ uid: r.uid, name: r.name, icon: r.icon, party: r.party, partyColor: r.partyColor, self: r.uid === data.settings.selfUid }));
        tr.appendChild(rankCell(r.rankLabel, r.rs)); tr.appendChild(recordCell(r.w, r.l));
        const det = (byUid[r.uid] || {}).detail; const hcell = heroesCell(r.heroes, r.heroLabels, det); const chev = chevron(tr, 'L' + g.id + r.uid, det, 4);
        hcell.firstChild.appendChild(chev); tr.appendChild(hcell);
        tb.appendChild(tr); chev.restore();
      });
      if (!trs.length) { const e = el('tr'); const td = el('td', 'dim', 'nobody saved on this team'); td.colSpan = 4; e.appendChild(td); tb.appendChild(e); }
      tbl.appendChild(hd.parentNode); tbl.appendChild(tb); col.appendChild(tbl); body.appendChild(col);
    });
    return body;
  }

  function renderLobbies() {
    const box = $('tab-lobbies'); box.textContent = '';
    const byUid = {}; data.all.forEach((p) => { byUid[p.uid] = p; });       // includes you, unlike the players tab
    if (!data.games.length) { box.appendChild(el('p', 'dim', 'No lobbies recorded yet.')); return; }
    box.appendChild(el('p', 'dim hint', 'Click a lobby to see both teams.'));
    data.games.slice().reverse().slice(0, 60).forEach((g) => {
      // one record per saved player; older lobbies lack some fields -> fall back to what we know now
      const rows = Object.keys(g.players).map((uid) => {
        const gp = g.players[uid], p = byUid[uid] || { names: [uid], last: {} }, l = p.last || {};
        return { uid, team: gp.team, idx: gp.idx, name: gp.name || p.names[0] || uid, icon: gp.icon || p.icon,
          abs: gp.abs, rankLabel: gp.rankLabel || l.rankLabel, rs: gp.rs != null ? gp.rs : l.rs, w: gp.w, l: gp.l,
          heroes: gp.heroes || l.heroes, heroLabels: l.heroLabels, party: gp.party != null ? gp.party : l.party, partyColor: gp.partyColor || l.partyColor };
      });
      const teams = [1, 2].map((t) => rows.filter((r) => r.team === t).sort((a, b) => (a.idx != null && b.idx != null) ? a.idx - b.idx : (b.abs || 0) - (a.abs || 0)));
      const avgs = teams.map(avgOf);
      const others = rows.filter((r) => r.uid !== data.settings.selfUid);
      const returning = others.filter((r) => (byUid[r.uid] || {}).seen > 1).length;
      const starred = others.filter((r) => (byUid[r.uid] || {}).starred).length;

      const d = el('div', 'lob');
      const head = el('div', 'lobhead'); head.tabIndex = 0; head.setAttribute('role', 'button');
      const arrow = el('span', 'arr', '▸');
      head.appendChild(arrow);
      const when = el('span', 'when'); when.appendChild(el('b', '', new Date(g.t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))); when.appendChild(el('small', 'dim', ' ' + ago(g.t)));
      head.appendChild(when);
      if (g.mode) head.appendChild(el('span', 'mode ' + (/quick/i.test(g.mode) ? 'qp' : 'comp'), g.mode));
      head.appendChild(el('span', 'dim', rows.length + ' players saved'));
      const sides = el('span', 'sides');
      teams.forEach((trs, i) => {
        const side = el('span', 'side t' + (i + 1));
        trs.slice(0, 6).forEach((r) => { if (r.icon) { const im = document.createElement('img'); im.className = 'mini'; im.src = ICON(r.icon); im.alt = ''; im.title = r.name; side.appendChild(im); } });
        const av = el('span', 'savg'); av.appendChild(document.createTextNode(avgs[i] != null ? avgs[i] + ' RS' : '—'));
        if (avgs[i] != null && avgs[1 - i] != null) av.appendChild(signedSpan(avgs[i] - avgs[1 - i]));
        side.appendChild(av); sides.appendChild(side);
        if (i === 0) sides.appendChild(el('span', 'vs', 'vs'));
      });
      head.appendChild(sides);
      if (returning) head.appendChild(el('span', 'badge', returning + ' seen before'));
      if (starred) head.appendChild(el('span', 'badge star', '★ ' + starred));
      if (others.length) {
        const oa = el('button', 'openall', 'Open ' + others.length + ' profiles ↗'); oa.title = 'Open every player in this lobby in new tabs (not you). A tab closes itself if that player is not in a Competitive game right now; otherwise it opens their Live Game. Shift-click: just open them.';
        oa.addEventListener('click', (e) => { e.stopPropagation(); openProfiles(others.map((r) => r.uid), !e.shiftKey); });
        oa.addEventListener('keydown', (e) => e.stopPropagation());
        head.appendChild(oa);
      }
      const del = el('button', 'dellobby', 'Delete'); del.title = 'Delete this lobby record'; del.setAttribute('aria-label', 'Delete this lobby');
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteLobby(g, rows.length); });
      del.addEventListener('keydown', (e) => e.stopPropagation());
      head.appendChild(del);
      d.appendChild(head);

      let body = null;
      const apply = () => {
        const open = openLobbies.has(g.id);
        head.setAttribute('aria-expanded', String(open)); arrow.textContent = open ? '▾' : '▸'; d.classList.toggle('open', open);
        if (open && !body) { body = lobbyBody(g, teams, avgs, byUid); d.appendChild(body); }
        if (body) body.hidden = !open;
      };
      const toggle = () => { if (openLobbies.has(g.id)) openLobbies.delete(g.id); else openLobbies.add(g.id); apply(); };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => { if (e.target !== head) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      apply();
      box.appendChild(d);
    });
  }

  function renderSettings() {
    const s = data.settings;
    $('sSelf').value = s.selfUid; $('sOverlay').checked = s.overlay;
    $('sIcons').checked = s.useIcons; $('sQp').checked = s.qpHighRankOnly; $('sQpSave').checked = s.saveQuickPlay; $('sQp').disabled = !s.saveQuickPlay; $('sSavedHeroes').checked = s.showSavedHeroes !== false; $('sAuto').checked = s.autoSaveFile; $('sRange').value = s.matchRankRange; $('sRankSave').checked = !!s.saveRankLimit; $('sSaveRange').value = s.saveRankRange != null ? s.saveRankRange : 3; $('sSaveRange').disabled = !s.saveRankLimit;
    const me = data.all.find((p) => p.uid === s.selfUid), mi = me && me.last && me.last.rankIdx;
    $('rangeInfo').textContent = mi != null
      ? 'You are ' + me.last.rankLabel + ' → hidden players below ' + RDT.rankLabelOf(RDT.minRankIdx(mi, s.matchRankRange)) + ' are skipped. This follows your rank automatically.'
      : 'Your rank is not known yet (it is saved when you appear in a lobby).'; $('sDetails').checked = s.autoDetails; $('sMin').value = Math.round(s.minShow * 100);
    const st = data.stats;
    $('accuracy').textContent = st.checked
      ? 'Track record: ' + st.correct + ' of ' + st.checked + ' ban-phase guesses were confirmed correct once names were revealed.'
      : 'Track record: no ban-phase guesses have been verified yet — it builds up automatically as names get revealed.';
  }
  async function saveSettings() {
    const s = Object.assign({}, data.settings, {
      selfUid: $('sSelf').value.trim(), overlay: $('sOverlay').checked,
      useIcons: $('sIcons').checked, qpHighRankOnly: $('sQp').checked, saveQuickPlay: $('sQpSave').checked, showSavedHeroes: $('sSavedHeroes').checked, autoSaveFile: $('sAuto').checked, matchRankRange: Math.max(0, Math.min(24, parseInt($('sRange').value, 10) || 0)), saveRankLimit: $('sRankSave').checked, saveRankRange: Math.max(0, Math.min(24, parseInt($('sSaveRange').value, 10) || 0)), autoDetails: $('sDetails').checked, minShow: Math.min(0.95, Math.max(0.05, (+$('sMin').value || 50) / 100)),
    });
    await S.saveSettings(s); data.settings = s; $('sSaveRange').disabled = !s.saveRankLimit;
  }
  ['sSelf', 'sOverlay', 'sIcons', 'sMin', 'sQp', 'sQpSave', 'sSavedHeroes', 'sAuto', 'sDetails', 'sRange', 'sRankSave', 'sSaveRange'].forEach((id) => $(id).addEventListener('change', saveSettings));

  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) { /* no manifest in tests */ }
  try { RDT.autoUI.init({ toggle: $('autotoggle'), delay: $('autodelay'), status: $('autostatus'), parallel: $('autoparallel') }); } catch (_) { /* tests without the extension APIs */ }


  // ---- write the database into <repo>/data/players.json
  const FS = RDT.fs;
  let saving = false, saveTimer = null;
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function setStatus(msg, bad) {
    $('fileStatus').textContent = msg; $('fileStatus').title = msg; $('fileStatus').classList.toggle('bad', !!bad);
    $('fileInfo').textContent = msg;
  }
  /** interactive=true is a click: may open the folder picker / permission prompt. force=true rewrites even if unchanged. */
  async function saveToFile(opt) {
    opt = opt || {};
    if (!FS.supported()) { setStatus('This browser cannot write files — use Export instead.', true); return false; }
    if (saving) return false;
    saving = true;
    try {
      let h = await FS.getHandle();
      if (opt.relink || (!h && opt.interactive)) h = await FS.link();
      if (!h) {                                   // never linked: stay quiet unless the user actually asked to save to a folder
        if (opt.interactive || location.hash === '#save') setStatus('Not linked: click “Save to data/” and pick the repo\'s data folder.');
        return false;
      }
      if (!(await FS.permitted(h, !!opt.interactive))) { setStatus('Click “Save to data/” to allow writing again.', true); return false; }
      const snap = await S.snapshot();
      const m = await chrome.storage.local.get(['rdt_filesig', 'rdt_fsmeta']);
      if (!opt.force && m.rdt_filesig === snap.sig && m.rdt_fsmeta) {
        setStatus('Up to date · ' + m.rdt_fsmeta.where + ' · saved ' + clock(m.rdt_fsmeta.t)); return true;
      }
      const where = await FS.write(h, snap.text);
      const t = Date.now();
      await chrome.storage.local.set({ rdt_filesig: snap.sig, rdt_seed: snap.fp, rdt_fsmeta: { t, count: snap.count, where } });
      setStatus('Saved ' + where + ' · ' + snap.count + ' players · ' + clock(t)); return true;
    } catch (e) {
      setStatus(e && e.name === 'AbortError' ? 'No folder chosen.' : 'Could not save: ' + (e && e.message || e), e && e.name !== 'AbortError');
      return false;
    } finally { saving = false; }
  }
  $('fileBtn').addEventListener('click', () => saveToFile({ interactive: true }));
  $('saveNowBtn').addEventListener('click', () => saveToFile({ interactive: true, force: true }));
  $('chooseBtn').addEventListener('click', () => saveToFile({ interactive: true, relink: true, force: true }));

  // ---- GitHub: merge with the repo's data/players.json, then push
  const GH = RDT.github;
  const tokenArea = () => (chrome.storage.session || chrome.storage.local);       // session = forgotten when the browser closes
  let ghBusy = false;
  function ghStatus(msg, bad) {
    $('ghInfo').textContent = msg; $('fileStatus').textContent = msg; $('fileStatus').title = msg; $('fileStatus').classList.toggle('bad', !!bad);
  }
  async function ghLoad() {
    const c = (await chrome.storage.local.get('rdt_github')).rdt_github || {};
    const t = (await tokenArea().get('rdt_ghtoken')).rdt_ghtoken || (await chrome.storage.local.get('rdt_ghtoken')).rdt_ghtoken || '';
    return { repo: c.repo || 'DleanJeans/rivals-rematch', branch: c.branch || 'main', remember: !!c.remember, token: t };
  }
  async function ghSaveCfg() {
    await chrome.storage.local.set({ rdt_github: { repo: $('sRepo').value.trim(), branch: $('sBranch').value.trim() || 'main', remember: $('sRemember').checked } });
  }
  async function ghSaveToken() {
    const v = $('sToken').value.trim(); if (!v) return;
    await chrome.storage.local.remove('rdt_ghtoken'); await tokenArea().remove('rdt_ghtoken');
    await (($('sRemember').checked ? chrome.storage.local : tokenArea()).set({ rdt_ghtoken: v }));
    $('sToken').value = '';                                                   // never leave it on screen
    ghStatus($('sRemember').checked ? 'Token saved on this browser.' : 'Token saved for this browser session (forgotten when the browser closes).');
  }
  async function ghForget() {
    await chrome.storage.local.remove('rdt_ghtoken'); await tokenArea().remove('rdt_ghtoken'); $('sToken').value = '';
    ghStatus('Token forgotten.');
  }
  async function githubSync() {
    if (ghBusy) return;
    ghBusy = true; $('ghBtn').disabled = true; $('ghSaveBtn').disabled = true;
    try {
      if ($('sToken').value.trim()) { await ghSaveCfg(); await ghSaveToken(); }
      const cfg = await ghLoad();
      if (!cfg.token) {
        document.querySelector('#tabs button[data-tab=settings]').click(); $('sToken').focus();
        ghStatus('Paste a GitHub token first (Settings → Save to GitHub).', true); return;
      }
      ghStatus('Talking to GitHub…');
      const r = await GH.sync(cfg, S);
      const where = GH.parseRepo(cfg.repo).full + '@' + cfg.branch, at = ' · ' + clock(Date.now());
      const merged = r.pulled ? ' · merged ' + r.pulled + ' new player' + (r.pulled === 1 ? '' : 's') + ' from the repo' : '';
      ghStatus(r.action === 'unchanged' ? 'Already up to date with ' + where + merged + at
        : (r.action === 'created' ? 'Created data/players.json in ' + where : 'Pushed ' + r.players + ' players to ' + where) + merged + (r.commit ? ' · commit ' + r.commit : '') + at);
      if (r.pulled) reload();
    } catch (e) {
      ghStatus(e instanceof GH.GhError ? e.message : 'Could not save to GitHub (unexpected error).', true);   // never echo raw errors: keep secrets out of messages
    } finally { ghBusy = false; $('ghBtn').disabled = false; $('ghSaveBtn').disabled = false; }
  }
  $('sQpSave').addEventListener('change', () => { $('sQp').disabled = !$('sQpSave').checked; });
  $('ghBtn').addEventListener('click', githubSync);
  $('ghSaveBtn').addEventListener('click', githubSync);
  $('ghForget').addEventListener('click', ghForget);
  ['sRepo', 'sBranch', 'sRemember'].forEach((id) => $(id).addEventListener('change', ghSaveCfg));
  $('sToken').addEventListener('change', () => { ghSaveCfg().then(ghSaveToken); });
  ghLoad().then((c) => {
    $('sRepo').value = c.repo; $('sBranch').value = c.branch; $('sRemember').checked = c.remember;
    $('ghInfo').textContent = c.token ? 'A token is set (' + (c.remember ? 'remembered on this browser' : 'this browser session only') + ').' : 'No token yet.';
  });

  // ---- wiring
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    ['players', 'lobbies', 'settings'].forEach((t) => { $('tab-' + t).hidden = t !== b.dataset.tab; });
  }));
  $('q').addEventListener('input', renderPlayers); $('role').addEventListener('change', renderPlayers);
  document.querySelectorAll('th[data-s]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.s; sortDir = sortKey === k ? -sortDir : (k === 'name' ? 1 : -1); sortKey = k; renderPlayers();
  }));
  $('exportBtn').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await S.exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'players.json';   // upload as data/players.json in the repo to have it load automatically
     a.click(); URL.revokeObjectURL(a.href);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = await S.importAll(JSON.parse(await f.text())); alert('Imported ' + n + ' players (merged with existing data).'); reload(); }
    catch (err) { alert('Import failed: ' + err.message); }
    e.target.value = '';
  });
  $('wipe').addEventListener('click', async () => {
    if (confirm('Delete ALL saved players, lobbies and stats? Export first if unsure.')) { await S.wipe(); reload(); }
  });
  const OWN_KEYS = ['rdt_filesig', 'rdt_fsmeta', 'rdt_seed'];
  chrome.storage.onChanged.addListener((changes) => {
    if (Object.keys(changes).every((k) => OWN_KEYS.includes(k))) return;   // our own bookkeeping, nothing to redraw or save
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (data.settings.autoSaveFile) saveToFile(); }, 2000);
    const a = document.activeElement;           // don't yank focus while a note/tag is being typed
    if (a && a.tagName === 'INPUT' && a.closest('#tbl')) return;
    clearTimeout(reload.t); reload.t = setTimeout(reload, 400);
  });
  // Merge the repo's bundled data first, but never let that step stop the page from rendering.
  Promise.resolve().then(() => S.loadSeed(chrome.runtime.getURL('data/players.json'))).catch(() => 0).then(reload)
    .then(() => { if (location.hash === '#github') return githubSync(); if (data.settings.autoSaveFile || location.hash === '#save') return saveToFile(); });
})();
