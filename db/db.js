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
      const tr = el('tr'); if (p.starred) tr.className = 'starred';
      const st = el('td', 'st'); const sb = el('button', 'star' + (p.starred ? ' on' : ''), p.starred ? '★' : '☆');
      sb.title = p.starred ? 'Unstar' : 'Star this player'; sb.setAttribute('aria-pressed', String(!!p.starred));
      sb.addEventListener('click', async () => { await S.updatePlayer(p.uid, { starred: !p.starred }); p.starred = !p.starred; renderPlayers(); });
      st.appendChild(sb); tr.appendChild(st);
      tr.appendChild(whoCell({ uid: p.uid, name: p.names[0] || p.uid, icon: p.icon, aka: p.names.slice(1, 4), party: l.party, partyColor: l.partyColor }));
      tr.appendChild(rankCell(l.rankLabel, l.rs));
      tr.appendChild(recordCell(l.w, l.l));
      const hcell = heroesCell(l.heroes, l.heroLabels, p.detail); const chev = chevron(tr, 'P' + p.uid, p.detail, 10); hcell.firstChild.appendChild(chev); tr.appendChild(hcell);
      const seen = el('td'); seen.appendChild(el('div', '', '×' + p.seen));
      const rel = el('div', 'rel');
      if (p.asTeammate) rel.appendChild(el('b', 'm', 'mate ' + p.asTeammate));
      if (p.asTeammate && p.asEnemy) rel.appendChild(document.createTextNode(' · '));
      if (p.asEnemy) rel.appendChild(el('b', 'e', 'enemy ' + p.asEnemy));
      seen.appendChild(rel); tr.appendChild(seen);
      tr.appendChild(el('td', 'dim', ago(p.lastSeen)));
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

  function renderLobbies() {
    const box = $('tab-lobbies'); box.textContent = '';
    const byUid = {}; data.all.forEach((p) => { byUid[p.uid] = p; });       // includes you, unlike the players tab
    if (!data.games.length) { box.appendChild(el('p', 'dim', 'No lobbies recorded yet.')); return; }
    const avg = (rows) => { const v = rows.map((r) => r.abs).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    data.games.slice().reverse().slice(0, 60).forEach((g) => {
      const d = el('div', 'lob');
      const n = Object.keys(g.players).length;
      d.appendChild(el('h4', '', new Date(g.t).toLocaleString() + (g.mode ? ' · ' + g.mode : '') + ' · ' + n + ' players saved'));
      // one record per saved player, older lobbies lack some fields -> fall back to what we know now
      const rows = Object.keys(g.players).map((uid) => {
        const gp = g.players[uid], p = byUid[uid] || { names: [uid], last: {} }, l = p.last || {};
        return { uid, team: gp.team, idx: gp.idx, name: gp.name || p.names[0] || uid, icon: gp.icon || p.icon,
          abs: gp.abs, rankLabel: gp.rankLabel || l.rankLabel, rs: gp.rs != null ? gp.rs : l.rs, w: gp.w, l: gp.l,
          heroes: gp.heroes || l.heroes, heroLabels: l.heroLabels, party: gp.party != null ? gp.party : l.party, partyColor: gp.partyColor || l.partyColor };
      });
      const teams = [1, 2].map((t) => rows.filter((r) => r.team === t).sort((a, b) => (a.idx != null && b.idx != null) ? a.idx - b.idx : (b.abs || 0) - (a.abs || 0)));
      const avgs = teams.map(avg);
      teams.forEach((trs, i) => {
        if (!trs.length) return;
        const tbl = el('table', 'team'); const hd = el('thead').appendChild(el('tr'));
        hd.appendChild(el('th', 'tname', 'Team ' + (i + 1)));
        const th = el('th', 'avg'); th.appendChild(el('span', 'dim', 'Avg: ')); th.appendChild(document.createTextNode(avgs[i] != null ? avgs[i] + ' RS' : '—'));
        const other = avgs[1 - i];
        if (avgs[i] != null && other != null) { const df = avgs[i] - other, sp = el('span', '', ' (' + (df >= 0 ? '+' : '') + df + ')'); sp.style.color = df >= 0 ? GOOD : BAD; th.appendChild(sp); }
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
        tbl.appendChild(hd.parentNode); tbl.appendChild(tb); d.appendChild(tbl);
      });
      box.appendChild(d);
    });
  }

  function renderSettings() {
    const s = data.settings;
    $('sSelf').value = s.selfUid; $('sOverlay').checked = s.overlay;
    $('sIcons').checked = s.useIcons; $('sQp').checked = s.qpHighRankOnly; $('sAuto').checked = s.autoSaveFile; $('sRange').value = s.matchRankRange;
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
      useIcons: $('sIcons').checked, qpHighRankOnly: $('sQp').checked, autoSaveFile: $('sAuto').checked, matchRankRange: Math.max(0, Math.min(24, parseInt($('sRange').value, 10) || 0)), autoDetails: $('sDetails').checked, minShow: Math.min(0.95, Math.max(0.05, (+$('sMin').value || 50) / 100)),
    });
    await S.saveSettings(s); data.settings = s;
  }
  ['sSelf', 'sOverlay', 'sIcons', 'sMin', 'sQp', 'sAuto', 'sDetails', 'sRange'].forEach((id) => $(id).addEventListener('change', saveSettings));

  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) { /* no manifest in tests */ }


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
      if (!h) { setStatus('Not linked: click “Save to data/” and pick the repo\'s data folder.'); return false; }
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
    .then(() => { if (data.settings.autoSaveFile || location.hash === '#save') return saveToFile(); });
})();
