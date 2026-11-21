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
seed.rdt_games = [{ id: 'a', t: now, last: now, season: 11, mode: 'Competitive', players: { 11: { team: 2, w: 6, l: 3, abs: 4770, icon: '1', name: 'PlayerA.', rankLabel: 'GM1', rs: 70, heroes: ['hulk', 'thor'] }, 222: { team: 1, w: 17, l: 14, abs: 4724, icon: '1', name: 'PlayerC42', rankLabel: 'GM1', rs: 24, heroes: ['luna-snow'] } } }];
seed.rdt_stats = { checked: 8, correct: 7, suffixChecked: 8, suffixOk: 8 };

(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(`(() => { const st = ${JSON.stringify(seed)};
    // like real Chrome: every method takes a callback OR returns a promise
    const area = { get(k, cb) { const o = {}; if (k === null) Object.assign(o, JSON.parse(JSON.stringify(st))); else [].concat(k).forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); },
      set(o, cb) { Object.assign(st, JSON.parse(JSON.stringify(o))); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb) { [].concat(k).forEach((x) => delete st[x]); if (cb) { cb(); return; } return Promise.resolve(); },
      clear(cb) { for (const k in st) delete st[k]; if (cb) { cb(); return; } return Promise.resolve(); } };
    window.chrome = { storage: { local: area, session: Object.assign({}, area, { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() }), onChanged: { addListener() {} } }, tabs: { create: (o) => { (window.__tabs = window.__tabs || []).push(o); return Promise.resolve({}); } } }; window.__st = st; })();`);
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
  ok(!(await page.isChecked('#sQpSave')) && await page.isDisabled('#sQp'), 'Quick Play lobbies are NOT saved by default (checkbox off, the GM-only option is greyed out)');
  await page.check('#sQpSave'); await page.dispatchEvent('#sQpSave', 'change'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => window.__st.rdt_settings.saveQuickPlay) === true && !(await page.isDisabled('#sQp')), 'ticking "Save Quick Play lobbies too" is stored and unlocks the GM-only option');
  await page.uncheck('#sQpSave'); await page.dispatchEvent('#sQpSave', 'change'); await page.waitForTimeout(80);
  ok(await page.isChecked('#sSavedHeroes'), 'showing saved heroes over blank hero boxes is on by default');
  await page.uncheck('#sSavedHeroes'); await page.dispatchEvent('#sSavedHeroes', 'change'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => window.__st.rdt_settings.showSavedHeroes) === false, 'unticking it is stored');
  await page.check('#sSavedHeroes'); await page.dispatchEvent('#sSavedHeroes', 'change'); await page.waitForTimeout(80);
  const exp = await page.evaluate(async () => RDT.store.exportAll());
  ok(exp.players.length === 4 && exp.version === 1, 'export has all stored players (incl. your own row)');
  await page.evaluate(() => RDT.store.deletePlayer('11'));
  const n = await page.evaluate(async (e) => RDT.store.importAll(e), exp);
  ok(n === 4 && !(await page.evaluate(() => 'p:11' in window.__st)), 'importing an older file does NOT bring back a player you deleted (the deletion is remembered)');
  const back = Object.assign({}, exp.players.find((p) => p.uid === '11'), { lastSeen: Date.now() + 60000 });
  await page.evaluate(async (r) => RDT.store.importAll({ players: [r] }), back);
  ok(await page.evaluate(() => 'p:11' in window.__st), 'but the same player seen again afterwards is restored (merge)');
  // --- Lobbies tab: a list first, two teams side by side when a lobby is opened
  await page.click('[data-tab=lobbies]');
  const head = await page.textContent('#tab-lobbies .lobhead');
  ok(/2 players saved/.test(head) && /Competitive/.test(head), `lobbies are listed as one line each: "${head.replace(/\s+/g, ' ').trim()}"`);
  ok(/4724 RS/.test(head) && /4770 RS/.test(head) && /\(-46\)/.test(head) && /\(\+46\)/.test(head), 'the line shows both team averages with the difference');
  ok((await page.$$('#tab-lobbies .side.t1 .mini')).length === 1 && (await page.$$('#tab-lobbies .side.t2 .mini')).length === 1, 'and a strip of avatars per team');
  ok(/2 seen before/.test(head), 'and how many players you have seen before');
  ok((await page.$$('#tab-lobbies table.team')).length === 0 && (await page.getAttribute('#tab-lobbies .lobhead', 'aria-expanded')) === 'false', 'collapsed by default: no team tables yet');

  // --- open every player's profile in new tabs
  const tabs = () => page.evaluate(() => (window.__tabs || []).map((t) => t.url + (t.active === false ? ' (background)' : ' (ACTIVE)')));
  ok(/Open 2 profiles/.test(await page.textContent('#tab-lobbies .openall')), 'each lobby line has an "Open N profiles" button');
  await page.click('#tab-lobbies .openall');
  await page.waitForTimeout(100);
  ok(JSON.stringify(await tabs()) === JSON.stringify(['https://rivalsdata.com/player/11#rdt-check (background)', 'https://rivalsdata.com/player/222#rdt-check (background)']), `opens each player's profile in a background tab: ${JSON.stringify(await tabs())}`);
  ok((await page.getAttribute('#tab-lobbies .lobhead', 'aria-expanded')) === 'false', 'and pressing it does not also expand the lobby');
  await page.focus('#tab-lobbies .openall'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  ok((await page.getAttribute('#tab-lobbies .lobhead', 'aria-expanded')) === 'false' && (await tabs()).length === 4, 'keyboard Enter on the button opens the tabs without toggling the lobby either');
  await page.evaluate(() => { window.__tabs = []; });
  await page.click('#tab-lobbies .openall', { modifiers: ['Shift'] }); await page.waitForTimeout(100);
  ok(JSON.stringify(await tabs()) === JSON.stringify(['https://rivalsdata.com/player/11 (background)', 'https://rivalsdata.com/player/222 (background)']), 'Shift-click opens the profiles plainly (no check, nothing closes itself)');
  await page.evaluate(() => { window.__tabs = []; });
  await page.click('[data-tab=settings]'); await page.fill('#sSelf', '222'); await page.dispatchEvent('#sSelf', 'change'); await page.waitForTimeout(80);
  await page.click('[data-tab=lobbies]'); await page.click('#tab-lobbies .openall'); await page.waitForTimeout(100);
  ok(JSON.stringify(await tabs()) === JSON.stringify(['https://rivalsdata.com/player/11#rdt-check (background)']), `your own profile is never opened (you = 222): ${JSON.stringify(await tabs())}`);
  await page.click('[data-tab=settings]'); await page.fill('#sSelf', '520435205'); await page.dispatchEvent('#sSelf', 'change'); await page.waitForTimeout(80);
  await page.click('[data-tab=lobbies]'); await page.evaluate(() => { window.__tabs = []; });
  await page.click('#tab-lobbies .lobhead'); await page.waitForSelector('#tab-lobbies .teamcol');
  ok((await page.$$('#tab-lobbies .teamcol')).length === 2 && (await page.getAttribute('#tab-lobbies .lobhead', 'aria-expanded')) === 'true', 'clicking the lobby opens two team columns');
  const [c1, c2] = await page.$$eval('#tab-lobbies .teamcol', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  ok(c2.x >= c1.x + c1.w - 2 && Math.abs(c2.y - c1.y) < 4, `teams are side by side (team 2 starts at x=${Math.round(c2.x)} right of team 1 which ends at x=${Math.round(c1.x + c1.w)}, same top)`);
  await page.click('#tab-lobbies .teamcol:nth-child(1) .openteam'); await page.waitForTimeout(100);
  ok(JSON.stringify(await tabs()) === JSON.stringify(['https://rivalsdata.com/player/222#rdt-check (background)']), `each team column can open just its own players: ${JSON.stringify(await tabs())}`);
  ok(/Team 1/.test(await page.textContent('#tab-lobbies .teamcol:nth-child(1) thead')) && /PlayerC42/.test(await page.textContent('#tab-lobbies .teamcol:nth-child(1)')) && /PlayerA\./.test(await page.textContent('#tab-lobbies .teamcol:nth-child(2)')), 'each player is in the right column');
  await page.click('#tab-lobbies tr:has(a:text-is("PlayerA.")) .chev'); await page.waitForSelector('#tab-lobbies tr.detail .dp .col');
  ok((await page.$$('#tab-lobbies tr.detail .dp .col')).length === 3, 'players inside still have the Heroes / Proficiency / Match history dropdown');
  await page.click('#tab-lobbies tr:has(a:text-is("PlayerA.")) .chev');
  await page.click('#tab-lobbies .lobhead');
  ok(!(await page.isVisible('#tab-lobbies .lobbody')), 'clicking again collapses it back to the list');
  await page.focus('#tab-lobbies .lobhead'); await page.keyboard.press('Enter');
  ok(await page.isVisible('#tab-lobbies .lobbody'), 'keyboard: Enter on a focused lobby opens it');
  await page.setViewportSize({ width: 800, height: 700 }); await page.waitForTimeout(150);
  const [n1, n2] = await page.$$eval('#tab-lobbies .teamcol', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { y: r.y, h: r.height, x: r.x }; }));
  ok(n2.y >= n1.y + n1.h - 2 && Math.abs(n2.x - n1.x) < 4, 'on a narrow window the teams stack instead, so nothing is squeezed');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: path.join(__dirname, 'out_db.png') });
  await b.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
