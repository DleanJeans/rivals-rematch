// The DB page in real Chromium (file://) with an in-memory chrome.storage.
const { chromium } = require('playwright');
const path = require('path');
const root = path.join(__dirname, '..');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const now = Date.now();
const seed = {};
const mk = (uid, name, rk, rs, abs, w, l, mate, enemy, heroes) => { seed['p:' + uid] = { uid, names: [name], icon: '1', firstSeen: now, lastSeen: now - 3600e3 * uid.length, seen: mate + enemy,
  asTeammate: mate, asEnemy: enemy, partied: 0, tag: '', note: '', hist: [], last: { rankLabel: rk, rs, abs, w, l, heroes, heroLabels: { hulk: 'Hulk' }, t: now } }; };
mk('11', 'PlayerA.', 'GM1', 70, 4770, 6, 3, 0, 2, ['hulk', 'thor']); mk('222', 'PlayerC42', 'GM1', 24, 4724, 17, 14, 1, 1, ['luna-snow']); mk('3333', 'PlayerT', 'GM1', 92, 4792, 36, 21, 4, 0, []);
seed['p:11'].detail = { t: now, season: 11,
  heroes: [{ slug: 'hulk', name: 'Hulk', games: 12, wr: 67 }, { slug: 'groot', name: 'Groot', games: 3, wr: 33 }],
  proficiency: [{ slug: 'hulk', name: 'Hulk', level: 44 }, { slug: 'thor', name: 'Thor', level: 30 }, { slug: 'groot', name: 'Groot', level: 28 }],
  matches: [{ slug: 'hulk', name: 'Hulk', result: 'W', rs: 14 }, { slug: 'groot', name: 'Groot', result: 'L', rs: -22 }, { slug: 'hulk', name: 'Hulk', result: 'W', rs: 0 }] };
mk('520435205', 'DleanJeans', 'GM1', 32, 4732, 15, 7, 0, 0, []);
seed.rdt_games = [{ id: 'a', t: now, last: now, season: 11, players: { 11: { team: 2, w: 6, l: 3 }, 222: { team: 1, w: 17, l: 14 } } }];
seed.rdt_stats = { checked: 8, correct: 7, suffixChecked: 8, suffixOk: 8 };

(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(`(() => { const st = ${JSON.stringify(seed)};
    window.chrome = { storage: { local: {
      get: (k, cb) => { const o = {}; if (k === null) Object.assign(o, JSON.parse(JSON.stringify(st))); else [].concat(k).forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); cb(o); },
      set: (o, cb) => { Object.assign(st, JSON.parse(JSON.stringify(o))); cb && cb(); },
      remove: (k, cb) => { [].concat(k).forEach((x) => delete st[x]); cb && cb(); },
      clear: (cb) => { for (const k in st) delete st[k]; cb && cb(); } },
      onChanged: { addListener() {} } } }; window.__st = st; })();`);
  await page.goto('file://' + path.join(root, 'db/db.html'));
  await page.waitForSelector('#tbl tbody tr');
  const rows = () => page.$$eval('#tbl tbody tr', (r) => r.map((x) => x.querySelector('td.nm a').textContent));
  ok((await rows()).length === 3 && !(await rows()).includes('DleanJeans'), '3 players rendered, your own row (DleanJeans) is hidden');
  ok((await page.$$eval('#tbl tbody tr td.nm img.av', (i) => i.map((x) => x.getAttribute('src')))).every((u) => u === 'https://cdn.rivalsdata.com/assets/icons/1.webp'), 'last avatar shown left of each name');
  ok((await page.$$eval('#tbl tbody tr td .rk img', (i) => i.map((x) => x.getAttribute('src')))).every((u) => u === 'https://rivalsdata.com/assets/ranks/grandmaster.webp'), 'rank icon shown before the rank name');
  ok((await page.textContent('#cPlayers')) === '3' && (await page.textContent('#cGames')) === '1', 'tab counters');
  await page.fill('#q', 'playerc'); ok(JSON.stringify(await rows()) === '["PlayerC42"]', 'search by name');
  await page.fill('#q', ''); await page.selectOption('#role', 'enemy');
  ok((await rows()).length === 2, 'role filter: enemies (PlayerA + PlayerC42)');
  await page.selectOption('#role', '');
  await page.click('th[data-s=seen]'); ok((await rows())[0] === 'PlayerT', 'sort by times seen (desc)');
  await page.fill('#tbl tbody tr:first-child td.tag input', 'good teammate'); await page.dispatchEvent('#tbl tbody tr:first-child td.tag input', 'change');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__st['p:3333'].tag) === 'good teammate', 'tag edit persisted to storage');
  // --- hero tiles: tooltip + dropdown (Heroes / Proficiency / Match history)
  const rowOf = (n) => `#tbl tbody tr:has(td.nm a:text-is("${n}"))`;
  await page.hover(`${rowOf('PlayerA.')} .dtile >> nth=0`); await page.waitForTimeout(150);
  let tp = await page.textContent('.dtip');
  ok(/Hulk/.test(tp) && /8W 4L/.test(tp) && /Lv 44/.test(tp), `hover a hero tile: tooltip shows name, record (12 games x 67% = 8W 4L) and level: "${tp.trim()}"`);
  ok(await page.isVisible('.dtip'), 'tooltip is visible while hovering');
  await page.hover(`${rowOf('PlayerA.')} .dtile >> nth=1`); await page.waitForTimeout(150);
  tp = await page.textContent('.dtip');
  ok(/Thor/.test(tp) && /Level 30/.test(tp) && !/\dW /.test(tp), `hero with no season record shows just its level, like the site: "${tp.trim()}"`);
  await page.hover(`${rowOf('PlayerC42')} .dtile >> nth=0`); await page.waitForTimeout(150);
  ok(/no stats saved yet/.test(await page.textContent('.dtip')), 'hero without saved stats says so instead of inventing numbers');
  await page.mouse.move(5, 5); await page.waitForTimeout(100);
  ok(!(await page.isVisible('.dtip')), 'tooltip hides when the pointer leaves');
  await page.click(`${rowOf('PlayerA.')} .chev`); await page.waitForSelector('tr.detail .dp');
  ok((await page.$$('tr.detail .dp .col')).length === 3, 'chevron opens the dropdown with three panels');
  const heads = await page.$$eval('tr.detail .dp h5', (h) => h.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(heads[0].startsWith('HEROES') && heads[0].includes('Season 11') && heads[1] === 'PROFICIENCY' && heads[2] === 'MATCH HISTORY', `panel titles: ${JSON.stringify(heads)}`);
  ok((await page.$$('tr.detail .dp .hr')).length === 2 && (await page.$$('tr.detail .dp .pr')).length === 3 && (await page.$$('tr.detail .dp .mr')).length === 3, 'rows: 2 heroes, 3 proficiency bars, 3 matches');
  ok(/Lv 44/.test(await page.textContent('tr.detail .dp .pr')) && (await page.$$eval('tr.detail .dp .mr.l', (r) => r.length)) === 1, 'proficiency level and loss row rendered');
  await page.fill('#q', 'PlayerA'); await page.waitForTimeout(100);           // a redraw must keep the dropdown open
  ok(await page.isVisible('tr.detail .dp'), 'dropdown stays open after the list redraws');
  await page.fill('#q', ''); await page.click(`${rowOf('PlayerA.')} .chev`);
  ok((await page.$$('tr.detail')).length === 0, 'chevron closes it again');
  await page.click(`${rowOf('PlayerC42')} .chev`);
  ok(/No hero details saved/.test(await page.textContent('tr.detail .dp')), 'player without details gets a helpful empty state');
  await page.click(`${rowOf('PlayerC42')} .chev`);
  await page.click('#tbl tbody tr:nth-child(2) .star'); await page.waitForTimeout(100);
  const starredUid = await page.evaluate(() => Object.values(window.__st).find((p) => p && p.starred)?.uid);
  ok(!!starredUid, 'star button persists to storage');
  ok((await page.$$eval('#tbl tbody tr', (r) => r[0].classList.contains('starred'))), 'starred player is pinned to the top and highlighted');
  await page.selectOption('#role', 'starred'); ok((await rows()).length === 1, 'Starred filter shows only starred players'); await page.selectOption('#role', '');
  await page.click('#tbl tbody tr:first-child .star'); await page.waitForTimeout(100);
  ok(!(await page.evaluate(() => Object.values(window.__st).some((p) => p && p.starred))), 'unstar works');
  await page.click('[data-tab=settings]');
  ok((await page.textContent('#accuracy')).includes('7 of 8'), 'accuracy track record shown');
  await page.fill('#sMin', '70'); await page.dispatchEvent('#sMin', 'change'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => window.__st.rdt_settings.minShow) === 0.7, 'settings persisted');
  const exp = await page.evaluate(async () => RDT.store.exportAll());
  ok(exp.players.length === 4 && exp.version === 1, 'export has all stored players (incl. your own row)');
  await page.evaluate(() => RDT.store.deletePlayer('11'));
  const n = await page.evaluate(async (e) => RDT.store.importAll(e), exp);
  ok(n === 4 && await page.evaluate(() => 'p:11' in window.__st), 'import restores a deleted player (merge)');
  await page.click('[data-tab=lobbies]'); ok((await page.textContent('#tab-lobbies')).includes('2 players saved'), 'lobby log renders');
  await page.click('#tab-lobbies tr:has(a:text-is("PlayerA.")) .chev'); await page.waitForSelector('#tab-lobbies tr.detail .dp .col');
  ok((await page.$$('#tab-lobbies tr.detail .dp .col')).length === 3, 'lobby rows have the same dropdown');
  await page.screenshot({ path: path.join(__dirname, 'out_db.png') });
  await b.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
