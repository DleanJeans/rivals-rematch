// Delete a lobby: the real database page + confirm dialogs, then try to bring the data back the way a sync would.
const { chromium } = require('playwright');
const path = require('path');
const root = path.join(__dirname, '..');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

const now = Date.now(), H = 3600e3, SELF = '520435205';
const P = (uid, name, o) => Object.assign({ uid, names: [name], icon: '1', firstSeen: now - 1e7, lastSeen: now - 1000, seen: 1, asTeammate: 0, asEnemy: 0, partied: 0, tag: '', note: '', hist: [],
  last: { rankLabel: 'GM1', rs: 40, abs: 4740, w: 10, l: 8, t: now, season: 11 } }, o || {});
const G = (id, ageH, players) => ({ id, t: now - ageH * H, last: now - ageH * H, season: 11, mode: 'Competitive', players });
// You are on team 1 everywhere.  A: you, P1 (mate), P2 (enemy).  B: you, P2 (mate), P3 (enemy).  C: you, P4 (enemy; has a note).
const SEED = {
  ['p:' + SELF]: P(SELF, 'DleanJeans', { seen: 3 }),
  'p:1': P('1', 'P1', { seen: 1, asTeammate: 1 }),
  'p:2': P('2', 'P2', { seen: 2, asTeammate: 1, asEnemy: 1 }),
  'p:3': P('3', 'P3', { seen: 1, asEnemy: 1 }),
  'p:4': P('4', 'P4', { seen: 1, asEnemy: 1, note: 'keep me' }),
  rdt_games: [
    G('A', 3, { [SELF]: { team: 1 }, 1: { team: 1 }, 2: { team: 2 } }),
    G('B', 2, { [SELF]: { team: 1 }, 2: { team: 1 }, 3: { team: 2 } }),
    G('C', 1, { [SELF]: { team: 1 }, 4: { team: 2 } }),
  ],
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [], dialogs = [], answers = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => { dialogs.push(d.message()); (answers.length ? answers.shift() : false) ? d.accept() : d.dismiss(); });
  await page.addInitScript(`(() => {
    const mk = () => { const st = {}; return { _st: st,
      get(k, cb) { const o = {}; const keys = k === null ? Object.keys(st) : [].concat(k); keys.forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); },
      set(o, cb) { Object.entries(o).forEach(([a, b]) => { st[a] = JSON.parse(JSON.stringify(b)); }); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb) { [].concat(k).forEach((x) => { delete st[x]; }); if (cb) { cb(); return; } return Promise.resolve(); },
      clear(cb) { for (const x in st) delete st[x]; if (cb) { cb(); return; } return Promise.resolve(); } }; };
    const local = mk(), session = mk(); Object.assign(local._st, ${JSON.stringify(SEED)});
    window.chrome = { storage: { local, session, onChanged: { addListener() {} } }, runtime: { getURL: (p) => 'chrome-extension://x/' + p, getManifest: () => ({ version: 'test' }) } };
    window.__local = local._st;
  })();`);
  await page.goto('file://' + path.join(root, 'db/db.html'));
  await page.waitForSelector('[data-tab=lobbies]');
  await page.click('[data-tab=lobbies]');
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__local)));
  const lobbies = () => page.locator('#tab-lobbies .lob');
  const gameIds = async () => ((await st()).rdt_games || []).map((g) => g.id).sort().join('');
  const deleteNth = async (n, ...ans) => {                       // newest lobby is index 0
    const before = await lobbies().count();
    answers.length = 0; answers.push(...ans);
    await lobbies().nth(n).locator('.dellobby').click();
    await page.waitForTimeout(400);
    return before;
  };
  const OLD = await page.evaluate(() => RDT.store.exportAll());           // what a repo file from before the deletions looks like

  ok((await lobbies().count()) === 3 && (await page.$$('#tab-lobbies .dellobby')).length === 3, 'every lobby line has a Delete button');

  console.log('\n[1] Delete the oldest lobby (A: you, P1 mate, P2 enemy); decline to forget P1');
  await deleteNth(2, true, false);
  let s = await st();
  ok(dialogs.length === 2 && /3 players saved/.test(dialogs[0]) && /Also forget the 1 player/.test(dialogs[1]), `two prompts: first the lobby, then the player who appears nowhere else ("${dialogs[1].split('\n')[0]}")`);
  ok(await gameIds() === 'BC' && (await lobbies().count()) === 2, 'lobby A is gone from the list and from storage');
  ok(s['p:1'] && s['p:1'].seen === 0 && s['p:1'].asTeammate === 0, 'P1 kept, but the counts A had added were rolled back (seen 0, teammate 0)');
  ok(s['p:2'].seen === 1 && s['p:2'].asEnemy === 0 && s['p:2'].asTeammate === 1, 'P2: A made them an enemy, so only the enemy count went down (seen 1, enemy 0, teammate 1 from B)');
  ok(s['p:' + SELF].seen === 2 && s['p:' + SELF].asTeammate === 0 && s['p:' + SELF].asEnemy === 0, 'you: seen goes down, no teammate/enemy counts invented for yourself');

  console.log('\n[2] Cancelling changes nothing');
  const n0 = dialogs.length;
  await deleteNth(1, false);
  ok(dialogs.length === n0 + 1 && await gameIds() === 'BC' && (await st())['p:3'].seen === 1, 'saying no to the first prompt leaves everything as it was');
  ok((await page.getAttribute('#tab-lobbies .lobhead >> nth=1', 'aria-expanded')) === 'false', 'and pressing Delete did not expand the lobby');

  console.log('\n[3] A player with a note is never forgotten (lobby C: you, P4 who has a note)');
  const n1 = dialogs.length;
  await deleteNth(0, true);
  s = await st();
  ok(dialogs.length === n1 + 1, 'no second prompt: nobody there qualifies to be forgotten');
  ok(await gameIds() === 'B' && s['p:4'] && s['p:4'].note === 'keep me' && s['p:4'].seen === 0 && s['p:4'].asEnemy === 0, 'P4 stays with their note; the lobby is gone and its counts rolled back');

  console.log('\n[4] Delete the last lobby (B) and forget the players seen nowhere else (P2, P3)');
  await deleteNth(0, true, true);
  s = await st();
  ok(/Also forget the 2 players/.test(dialogs[dialogs.length - 1]), `second prompt names 2 players: "${dialogs[dialogs.length - 1].split('\n')[0]}"`);
  ok(!s['p:2'] && !s['p:3'] && s['p:1'] && s['p:4'] && s['p:' + SELF], 'P2 and P3 forgotten; P1, P4 and you kept');
  ok((await page.textContent('#tab-lobbies')).includes('No lobbies recorded yet'), 'the list is empty again');
  ok(s.rdt_deleted && Object.keys(s.rdt_deleted.games).sort().join('') === 'ABC' && Object.keys(s.rdt_deleted.players).sort().join('') === '23', 'the deletions are remembered (3 lobbies, 2 players)');

  console.log('\n[5] A sync / old repo file must not bring them back');
  await page.evaluate(async (o) => { await RDT.store.importAll(o); }, OLD);
  s = await st();
  ok(await gameIds() === '' && !s['p:2'] && !s['p:3'] && s['p:1'], 'merging the old export (which still has all three lobbies and P2/P3) restores nothing that was deleted');
  const again = P('2', 'P2', { lastSeen: now + 10 * 60e3, seen: 5 });
  await page.evaluate(async (r) => { await RDT.store.importAll({ players: [r] }); }, again);
  s = await st();
  ok(s['p:2'] && s['p:2'].seen === 5 && !(s.rdt_deleted.players['2']), 'but a player seen AGAIN after the deletion comes back normally (and is no longer marked deleted)');

  console.log('\n[6] Deletions travel: another machine applies them');
  const E = await page.evaluate(() => RDT.store.exportAll());
  await page.evaluate(async (o) => { await RDT.store.wipe(); await RDT.store.importAll(o); }, OLD);          // a machine that still has everything
  ok(await gameIds() === 'ABC' && !!(await st())['p:3'], 'a machine loaded from the old file still has the three lobbies and P3');
  await page.evaluate(async (o) => { await RDT.store.importAll(o); }, E);                                      // ...then syncs with the newer file
  s = await st();
  ok(await gameIds() === '' && !s['p:3'] && s['p:2'], 'after syncing with the newer file the lobbies and P3 are gone there too, while the returning P2 is kept');

  console.log('\n[7] Deleting a player (✕) is remembered the same way');
  await page.evaluate(async () => { await RDT.store.deletePlayer('1'); });
  await page.evaluate(async (o) => { await RDT.store.importAll(o); }, OLD);
  ok(!(await st())['p:1'], 'a player removed with ✕ is not resurrected by merging an older file either');

  console.log('\n[8] The data file stays stable and consistent');
  await page.evaluate(async () => { await chrome.storage.local.set({ rdt_deleted: { players: { 9: 5, 1: 7 }, games: { Z: 3, A: 1 } } }); });
  const snap = await page.evaluate(() => RDT.store.snapshot());
  ok(snap.sig.includes('"deleted":{"players":{"1":7,"9":5},"games":{"A":1,"Z":3}}'), 'deletions are written with sorted keys, so two machines never produce different files for the same state');
  ok(await page.evaluate((t) => RDT.github.sigOf(t.text) === t.sig, snap), 'Save to GitHub sees its own file as unchanged (no needless commit)');
  ok(JSON.parse(snap.text).deleted.games.Z === 3, 'and the deletions are in the file that gets committed');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
