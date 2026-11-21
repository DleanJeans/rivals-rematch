// End-to-end: real Chromium + real rivalsdata snapshots + mocked chrome.storage.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SCRIPTS = ['lib/shared.js', 'lib/store.js', 'lib/detailui.js', 'content/scrape.js', 'content/content.js'].map(read);
let fail = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fail++; };

const mockChrome = `
  window.chrome = { storage: { local: {
    get: (k, cb) => window.__get(k).then(cb),
    set: (o, cb) => window.__set(o).then(() => cb && cb()),
    remove: (k, cb) => window.__remove(k).then(() => cb && cb()),
    clear: (cb) => window.__clear().then(() => cb && cb()),
  }, onChanged: { addListener() {} } } };`;

(async () => {
  const browser = await chromium.launch();
  const store = new Map();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx.exposeFunction('__get', (k) => {
    const out = {};
    if (k === null) store.forEach((v, key) => { out[key] = JSON.parse(v); });
    else (Array.isArray(k) ? k : [k]).forEach((key) => { if (store.has(key)) out[key] = JSON.parse(store.get(key)); });
    return out;
  });
  await ctx.exposeFunction('__set', (o) => { Object.entries(o).forEach(([k, v]) => store.set(k, JSON.stringify(v))); });
  await ctx.exposeFunction('__remove', (k) => { (Array.isArray(k) ? k : [k]).forEach((x) => store.delete(x)); });
  await ctx.exposeFunction('__clear', () => store.clear());

  async function load(file, mutate) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('Rivals Rematch')) console.log('  WARN', m.text()); });
    let html = read('tests/fixtures/' + file).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*stylesheet[^>]*>/g, '').replace('</head>', '<style>' + read('tests/fixtures/site.css') + '</style></head>');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    if (mutate) await page.evaluate(mutate);
    await page.evaluate('window.__RDT_DEBUG = true'); await page.evaluate(mockChrome);
    for (const s of SCRIPTS) await page.evaluate(s);
    await page.waitForTimeout(900);
    return page;
  }
  const players = () => [...store].filter(([k]) => k.startsWith('p:')).map(([, v]) => JSON.parse(v));
  const byName = (n) => players().find((p) => p.names.includes(n));

  console.log('\n[1] Ingest the three revealed games');
  let page = await load('game1.html'); await page.close();
  ok(players().length === 12, `game 1 saved 12 players (got ${players().length})`);
  page = await load('game2.html'); await page.close();
  ok(players().length === 23, `game 2 adds 11 new + DleanJeans reused -> 23 (got ${players().length})`);
  const dj = byName('DleanJeans');
  ok(dj.seen === 2 && dj.hist.length === 2, `DleanJeans seen 2 games, 2 history points (seen=${dj.seen}, hist=${dj.hist.length})`);
  ok(byName('PlayerA.').last.party === true && byName('PlayerA.').last.w === 4, 'PlayerA. stored as 4W-1L, party=true');
  ok(byName('Plàyer-R'), 'unicode names survive');
  ok(!!dj.last.heroes && dj.last.heroes[0] === 'peni-parker', 'top heroes stored as slugs');
  const rel = byName('PlayerA.');
  ok(rel.asEnemy === 1 && rel.asTeammate === 0, 'PlayerA. recorded as ENEMY (other team than you)');
  ok(byName('PlayerT').asTeammate === 1, 'PlayerT recorded as TEAMMATE');

  console.log('\n[2] Re-scraping the same lobby must not double count');
  page = await load('game2.html'); await page.close();
  ok(byName('PlayerA.').seen === 1 && byName('DleanJeans').seen === 2, `counts unchanged after re-visit (PlayerA seen=${byName('PlayerA.').seen}, DleanJeans=${byName('DleanJeans').seen})`);
  ok(JSON.parse(store.get('rdt_games')).length === 2, 'still only 2 lobbies recorded');

  console.log('\n[3] Game 3 with names/party/heroes MASKED (ranked ban phase: RS + W/L still visible)');
  const maskRanked = () => {
    const panel = document.querySelector('[role=tabpanel][aria-labelledby=live-game]');
    panel.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector('a[href*="/player/"]');
      if (!a || a.getAttribute('aria-current') === 'page') return;   // you stay visible
      const s = document.createElement('span'); s.className = a.className;
      s.textContent = '*****' + a.textContent.slice(-1); a.replaceWith(s);
      li.querySelectorAll('[title="In a party"]').forEach((e) => e.remove());
      li.querySelectorAll('img[src*="/assets/heroes/"], button[aria-controls]').forEach((e) => e.remove());
    });
  };
  page = await load('game3.html', maskRanked);
  const chips = await page.evaluate(() => [...document.querySelector('#rdt-host').shadowRoot.querySelectorAll('.chip')]
    .map((c) => ({ cls: c.className.replace('chip ', ''), text: c.querySelector('.nm').textContent, pc: (c.querySelector('.pc') || {}).textContent })));
  console.log('   chips:', JSON.stringify(chips));
  const want = { 'PlayerA.': 1, 'PlayerB': 1, 'PlayerC42': 1 };
  const got = chips.filter((c) => c.cls !== 'none');
  ok(chips.length === 11, `11 hidden rows got a chip (got ${chips.length})`);
  ok(got.length === 3 && got.every((c) => want[c.text]),
    `exactly the 3 returning players recognised: ${got.map((c) => c.text + ' ' + c.pc).join(', ')}`);
  ok(chips.filter((c) => c.cls === 'none').length === 8, '8 genuinely new players left as "no match" (no false positives)');
  // hover a chip that has "no match" rows underneath its tooltip: the tooltip must be the topmost thing
  await page.hover('#rdt-host >> .chip.hi >> nth=0'); await page.waitForTimeout(200);
  const top = await page.evaluate(() => {
    const sr = document.querySelector('#rdt-host').shadowRoot, tip = sr.querySelector('.tip'), r = tip.getBoundingClientRect();
    tip.style.pointerEvents = 'auto';   // the tooltip ignores the mouse; make it hit-testable for this probe
    const pts = [[0.2, 0.3], [0.5, 0.5], [0.8, 0.8], [0.5, 0.95]].map(([fx, fy]) => sr.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy));
    return { open: tip.matches(':popover-open'), covered: pts.filter((e) => e && !tip.contains(e) && e !== tip).length, text: tip.textContent };
  });
  ok(top.open && top.covered === 0, `tooltip is in the top layer and nothing paints over it (covered points: ${top.covered})`);
  const icons = await page.evaluate(() => [...document.querySelector('#rdt-host').shadowRoot.querySelectorAll('.hud .rk img')].map((i) => i.getAttribute('src')));
  ok(icons.length >= 11 && icons.every((u) => /\/assets\/ranks\/(grandmaster|diamond)\.webp$/.test(u)), `panel shows a rank icon before each rank name (${icons.length} icons)`);
  ok(!/0%/.test(top.text.replace(/\b(9\d|100)%/g, '')), 'tooltip does not list 0% alternatives');
  await page.screenshot({ path: path.join(__dirname, 'out_ranked_masked.png') });
  await page.close();

  console.log('\n[3b] Returning player swapped avatar but their top heroes are still visible; only 2 rows hidden');
  const stats = JSON.parse(store.get('rdt_stats'));
  ok(stats.iconChecked >= 1 && stats.iconSame === stats.iconChecked, `avatar-swap rate is learned from real sightings (${stats.iconSame}/${stats.iconChecked} unchanged)`);
  page = await load('game3.html', () => {
    const panel = document.querySelector('[role=tabpanel][aria-labelledby=live-game]');
    panel.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector('a[href*="/player/"]'); if (!a) return;
      if (!['PlayerA.', 'PlayerC42'].includes(a.textContent)) return;
      const s = document.createElement('span'); s.className = a.className; s.textContent = '*****' + a.textContent.slice(-1); a.replaceWith(s);
      if (a.textContent === 'PlayerC42') li.querySelector('img[src*="/icons/"]').src = 'https://cdn.rivalsdata.com/assets/icons/99999999.webp'; // swapped avatar
    });
  });
  const two = await page.evaluate(() => [...document.querySelector('#rdt-host').shadowRoot.querySelectorAll('.chip')].map((c) => c.querySelector('.nm').textContent + ' ' + ((c.querySelector('.pc') || {}).textContent || '')));
  ok(two.length === 2 && two.every((t) => !t.startsWith('no match')), `both recognised; the swapped-avatar one is carried by its matching top heroes: ${JSON.stringify(two)}`);
  await page.close();

  console.log('\n[4] Real Quick Play ban-phase capture (rank only, partial names) - default: only GM or above are saved');
  const before = players().length;
  page = await load('ban_qp.html');
  const qp = await page.evaluate(() => ({
    host: !!document.querySelector('#rdt-host'),
    mode: RDT.scrapeLive(document).mode, qpLobby: RDT.scrapeLive(document).qpLobby,
    chips: [...document.querySelector('#rdt-host').shadowRoot.querySelectorAll('.chip')].map((c) => c.textContent),
  }));
  ok(qp.host && qp.chips.length === 5, `5 masked rows detected and overlaid (got ${qp.chips.length}): ${JSON.stringify(qp.chips)}`);
  ok(qp.mode === 'quick play' && qp.qpLobby === true, `lobby recognised as Quick Play from the page header (mode="${qp.mode}")`);
  ok(!byName('PlayerM1') && !byName('PlayerX6'), 'Platinum / Gold players in a Quick Play lobby are NOT saved');
  ok(players().filter((p) => p.names.includes('PlayerM1') || p.names.includes('PlayerX6')).length === 0 && players().length === before, `database unchanged: still ${before} players (got ${players().length})`);
  await page.close();

  page = await load('ban_qp.html', () => {   // same lobby, but one visible Gold player is actually Grandmaster
    const li = [...document.querySelectorAll('li')].find((x) => x.textContent.includes('PlayerX6'));
    const im = li.querySelector('img[src*="/ranks/"]'); im.src = 'https://rivalsdata.com/assets/ranks/grandmaster.webp'; im.parentNode.firstChild.nodeType === 3 ? (im.parentNode.firstChild.textContent = 'GM2') : im.parentNode.childNodes.forEach((n) => { if (n.nodeType === 3) n.textContent = 'GM2'; });
  });
  ok(!!byName('PlayerX6') && players().length === before + 1, 'a GM player in the same Quick Play lobby IS saved');
  await page.close();

  // every tier at/above GM is kept; Diamond is not (labels as rivalsdata would render them, incl. "OAA" with a hyphenated image)
  const setTier = (name, label, img) => {
    const li = [...document.querySelectorAll('li')].find((x) => x.textContent.includes(name));
    const im = li.querySelector('img[src*="/ranks/"]'); im.src = 'https://rivalsdata.com/assets/ranks/' + img + '.webp';
    [...im.parentNode.childNodes].find((n) => n.nodeType === 3).textContent = label;
  };
  const before2 = players().length;
  page = await load('ban_qp.html', `(${setTier.toString()})('PlayerM1', 'C2', 'celestial'); (${setTier.toString()})('Player26', 'E3', 'eternity'); (${setTier.toString()})('Player29', 'OAA', 'one-above-all');`);
  ok(players().length === before2 + 3 && !!byName('PlayerM1') && !!byName('Player26') && !!byName('Player29'), `Celestial, Eternity and One Above All are saved in Quick Play (+${players().length - before2})`);
  ok(!byName('Player27') && !byName('Player28'), 'Diamond players (Player27, Player28) still not saved');
  await page.close();

  console.log('\n[4b] Setting off => Quick Play saves everyone, QP rank kept separate');
  store.set('rdt_settings', JSON.stringify({ qpHighRankOnly: false }));
  page = await load('ban_qp.html');
  const mo = byName('PlayerM1');
  ok(!!mo && !!byName('PlayerX6'), 'with the filter off, Platinum / Gold players are saved again');
  ok(mo.last.rs === 50 && mo.last.w == null, `partial row stored without inventing W/L (rs=${mo.last.rs}, w=${mo.last.w})`);
  ok(mo.last.qp && mo.last.qp.label === 'B1', `QP rank kept separate (${mo.last.qp && mo.last.qp.label}) and not mistaken for ranked (${mo.last.rankLabel})`);
  const only = await page.evaluate(() => {   // a player who shows ONLY a (QP) rank, no ranked column
    const li = [...document.querySelectorAll('li')].find((x) => x.textContent.includes('PlayerM1'));
    li.querySelectorAll('img[src*="/ranks/"]')[0].parentElement.remove();
    const r = RDT.scrapeLive(document).rows.find((x) => x.name === 'PlayerM1');
    return r && { rankIdx: r.rankIdx, qp: r.qp && r.qp.label, qpLobby: r.qpLobby };
  });
  ok(only && only.rankIdx === null && only.qp === 'B1' && only.qpLobby === true, `QP-only row is kept (not dropped): ${JSON.stringify(only)}`);
  await page.screenshot({ path: path.join(__dirname, 'out_qp_ban.png') });
  await page.close();

  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
