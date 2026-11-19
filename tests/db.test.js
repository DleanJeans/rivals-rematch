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
  ok((await page.textContent('#cPlayers')) === '3' && (await page.textContent('#cGames')) === '1', 'tab counters');
  await page.fill('#q', 'playerc'); ok(JSON.stringify(await rows()) === '["PlayerC42"]', 'search by name');
  await page.fill('#q', ''); await page.selectOption('#role', 'enemy');
  ok((await rows()).length === 2, 'role filter: enemies (PlayerA + PlayerC42)');
  await page.selectOption('#role', '');
  await page.click('th[data-s=seen]'); ok((await rows())[0] === 'PlayerT', 'sort by times seen (desc)');
  await page.fill('#tbl tbody tr:first-child td.tag input', 'good teammate'); await page.dispatchEvent('#tbl tbody tr:first-child td.tag input', 'change');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__st['p:3333'].tag) === 'good teammate', 'tag edit persisted to storage');
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
  await page.click('[data-tab=lobbies]'); ok((await page.textContent('#tab-lobbies')).includes('2 players recorded'), 'lobby log renders');
  await page.screenshot({ path: path.join(__dirname, 'out_db.png') });
  await b.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
