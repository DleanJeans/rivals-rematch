(function () {
  'use strict';
  const S = RDT.store, $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ICON = (s) => 'https://cdn.rivalsdata.com/assets/icons/' + encodeURIComponent(s) + '.webp';
  const HERO = (s) => 'https://rivalsdata.com/assets/heroes/' + encodeURIComponent(s) + '.webp';
  let data = { players: [], games: [], stats: {}, settings: {} };
  let sortKey = 'when', sortDir = -1;

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
    data.players = data.players.filter((p) => p.uid !== data.settings.selfUid);   // you are not a lobby contact
    $('cPlayers').textContent = data.players.length;
    $('cGames').textContent = data.games.length;
    renderPlayers(); renderLobbies(); renderSettings();
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
      const nm = el('td', 'nm');
      const wrap = el('div', 'who');
      if (p.icon) { const av = document.createElement('img'); av.className = 'av'; av.src = ICON(p.icon); av.alt = ''; av.title = 'Last avatar seen'; wrap.appendChild(av); }
      const txt = el('div');
      const a = el('a', '', p.names[0] || p.uid); a.href = 'https://rivalsdata.com/player/' + p.uid; a.target = '_blank'; a.rel = 'noopener';
      txt.appendChild(a);
      if (p.names.length > 1) txt.appendChild(el('small', '', 'aka ' + p.names.slice(1, 4).join(', ')));
      wrap.appendChild(txt); nm.appendChild(wrap);
      tr.appendChild(nm);
      const rk = el('td'); const rkw = el('span', 'rk');
      const ri = l.rankLabel && RDT.rankIconUrl(l.rankLabel);
      if (ri) { const im = document.createElement('img'); im.src = ri; im.alt = ''; rkw.appendChild(im); }
      rkw.appendChild(document.createTextNode(l.rankLabel ? l.rankLabel + (l.rs != null ? ' · ' + l.rs + ' RS' : '') : '—'));
      rk.appendChild(rkw); tr.appendChild(rk);
      tr.appendChild(el('td', '', l.w != null ? l.w + 'W-' + l.l + 'L · ' + Math.round(wr(l) * 100) + '%' : '—'));
      const seen = el('td'); seen.appendChild(el('div', '', '×' + p.seen));
      const rel = el('div', 'rel');
      if (p.asTeammate) rel.appendChild(el('b', 'm', 'mate ' + p.asTeammate));
      if (p.asTeammate && p.asEnemy) rel.appendChild(document.createTextNode(' · '));
      if (p.asEnemy) rel.appendChild(el('b', 'e', 'enemy ' + p.asEnemy));
      seen.appendChild(rel); tr.appendChild(seen);
      tr.appendChild(el('td', '', ago(p.lastSeen)));
      const hs = el('td'); const hw = el('div', 'heroes');
      (l.heroes || []).slice(0, 4).forEach((h) => { const im = document.createElement('img'); im.src = HERO(h); im.title = (l.heroLabels && l.heroLabels[h]) || h; im.alt = im.title; hw.appendChild(im); });
      hs.appendChild(hw); tr.appendChild(hs);
      tr.appendChild(editCell(p, 'tag', 'tag', 'e.g. toxic'));
      tr.appendChild(editCell(p, 'note', '', 'note'));
      const del = el('td'); const x = el('button', 'x', '✕'); x.title = 'Forget this player';
      x.addEventListener('click', async () => { if (confirm('Forget ' + (p.names[0] || p.uid) + '?')) { await S.deletePlayer(p.uid); reload(); } });
      del.appendChild(x); tr.appendChild(del);
      tb.appendChild(tr);
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
    const byUid = {}; data.players.forEach((p) => { byUid[p.uid] = p; });
    if (!data.games.length) { box.appendChild(el('p', 'dim', 'No lobbies recorded yet.')); return; }
    data.games.slice().reverse().slice(0, 60).forEach((g) => {
      const d = el('div', 'lob');
      d.appendChild(el('h4', '', new Date(g.t).toLocaleString() + ' · ' + Object.keys(g.players).length + ' players recorded'));
      const cols = el('div', 'cols');
      [1, 2].forEach((team) => {
        const c = el('div');
        Object.keys(g.players).filter((u) => g.players[u].team === team).forEach((u) => {
          const p = byUid[u]; const row = el('div', 'p');
          row.appendChild(el('span', 't' + team, p ? (p.names[0] || u) : u));
          const gp = g.players[u];
          row.appendChild(el('span', 'r', gp.w != null ? gp.w + 'W-' + gp.l + 'L' : ''));
          c.appendChild(row);
        });
        cols.appendChild(c);
      });
      d.appendChild(cols); box.appendChild(d);
    });
  }

  function renderSettings() {
    const s = data.settings;
    $('sSelf').value = s.selfUid; $('sOverlay').checked = s.overlay; $('sSuffix').checked = s.useSuffix;
    $('sIcons').checked = s.useIcons; $('sQp').checked = s.qpHighRankOnly; $('sMin').value = Math.round(s.minShow * 100);
    const st = data.stats;
    $('accuracy').textContent = st.checked
      ? 'Track record: ' + st.correct + ' of ' + st.checked + ' ban-phase guesses were confirmed correct once names were revealed.' +
        (st.suffixChecked ? ' The visible-name-end rule held ' + st.suffixOk + '/' + st.suffixChecked + ' times.' : '')
      : 'Track record: no ban-phase guesses have been verified yet — it builds up automatically as names get revealed.';
  }
  async function saveSettings() {
    const s = Object.assign({}, data.settings, {
      selfUid: $('sSelf').value.trim(), overlay: $('sOverlay').checked, useSuffix: $('sSuffix').checked,
      useIcons: $('sIcons').checked, qpHighRankOnly: $('sQp').checked, minShow: Math.min(0.95, Math.max(0.05, (+$('sMin').value || 50) / 100)),
    });
    await S.saveSettings(s); data.settings = s;
  }
  ['sSelf', 'sOverlay', 'sSuffix', 'sIcons', 'sMin', 'sQp'].forEach((id) => $(id).addEventListener('change', saveSettings));

  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) { /* no manifest in tests */ }

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
  chrome.storage.onChanged.addListener(() => {
    const a = document.activeElement;           // don't yank focus while a note/tag is being typed
    if (a && a.tagName === 'INPUT' && a.closest('#tbl')) return;
    clearTimeout(reload.t); reload.t = setTimeout(reload, 400);
  });
  // Merge the repo's bundled data first, but never let that step stop the page from rendering.
  Promise.resolve().then(() => S.loadSeed(chrome.runtime.getURL('data/players.json'))).catch(() => 0).then(reload);
})();
