// Settings: "also save only players up to N ranks below mine". Runs the real store against an in-memory chrome.storage.
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const mem = {};
global.chrome = { storage: { local: {
  get: (k, cb) => cb(k == null ? JSON.parse(JSON.stringify(mem)) : (Array.isArray(k) ? k : [k]).reduce((o, x) => { if (x in mem) o[x] = JSON.parse(JSON.stringify(mem[x])); return o; }, {})),
  set: (o, cb) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); cb && cb(); },
  remove: (k, cb) => { [].concat(k).forEach((x) => delete mem[x]); cb && cb(); } } } };
const R = require('../lib/shared.js'); require('../lib/store.js'); const S = globalThis.RDT.store;
const row = (uid, rk, team, idx) => ({ uid, name: 'P' + uid, team, idx, masked: false, rankIdx: R.rankIdx(R.parseRank(rk[0], rk[1])), abs: null, w: 5, l: 5, season: 11, icon: null, heroes: null });
const GM1 = ['GM1', 'grandmaster'], D1 = ['D1', 'diamond'], P1 = ['P1', 'platinum'], B1 = ['B1', 'bronze'];
const lobby = () => ({ season: 11, qpLobby: false, rows: [row('100', GM1, 0, 0), row('1', GM1, 0, 1), row('2', D1, 1, 0), row('3', P1, 1, 1), row('4', B1, 1, 2)], teams: [] });
(async () => {
  await S.saveSettings(Object.assign(await S.getSettings(), { selfUid: '100' }));
  let r = await S.ingest(lobby(), await S.getSettings());
  ok(r.saved === 5 && !r.rankSkipped, `default: everyone is saved (${r.saved})`);
  Object.keys(mem).forEach((k) => delete mem[k]);
  await S.saveSettings(Object.assign(await S.getSettings(), { selfUid: '100', saveRankLimit: true, saveRankRange: 3 }));
  r = await S.ingest(lobby(), await S.getSettings());
  const saved = Object.keys(mem).filter((k) => k.startsWith('p:')).map((k) => k.slice(2)).sort();
  ok(JSON.stringify(saved) === '["1","100","2"]' && r.saved === 3 && r.rankSkipped === 2, `GM1 with a limit of 3 ranks: GM1, GM1 and D1 are saved, P1 and B1 are not (${JSON.stringify(saved)}, skipped ${r.rankSkipped})`);
  ok(r.newPlayers === 3 && r.oldPlayers === 0, 'the new/known counts only count players that were saved');
  await S.saveSettings(Object.assign(await S.getSettings(), { saveRankRange: 0 }));
  Object.keys(mem).filter((k) => k.startsWith('p:') || k === 'rdt_games').forEach((k) => delete mem[k]);
  r = await S.ingest(lobby(), await S.getSettings());
  ok(r.saved === 2 && r.rankSkipped === 3, `limit 0: only players of your own rank and above, plus you (${r.saved} saved)`);
  // own rank: saved from a lobby with you, used when you are absent
  Object.keys(mem).forEach((k) => delete mem[k]);
  await S.saveSettings(Object.assign(await S.getSettings(), { selfUid: '100', saveRankLimit: true, saveRankRange: 3 }));
  { const lb = lobby(); lb.rows.forEach((x) => { x.rankLabel = R.rankLabelOf(x.rankIdx); }); await S.ingest(lb, await S.getSettings()); }
  ok((await S.getSettings()).selfRank === 'GM1', 'a lobby with you in it saves your rank');
  Object.keys(mem).filter((k) => k.startsWith('p:') || k === 'rdt_games').forEach((k) => delete mem[k]);
  { const lb = lobby(); lb.rows = lb.rows.filter((x) => x.uid !== '100'); r = await S.ingest(lb, await S.getSettings()); }
  ok(r.saved === 2 && r.rankSkipped === 2, `without you in the lobby or a stored row, the saved rank still limits (${r.saved} saved)`);
  await S.saveSettings(Object.assign(await S.getSettings(), { selfRank: 'D1' }));
  ok(S.selfRankIdx(await S.getSettings()) === R.rankIdx(R.parseRank('D1', 'diamond')), 'editing the rank in Settings changes the one used');
  // purge below a rank
  Object.keys(mem).forEach((k) => delete mem[k]);
  await S.saveSettings(Object.assign(await S.getSettings(), { selfUid: '100', saveRankLimit: false }));
  { const lb = lobby(); lb.rows.forEach((x) => { x.rs = 50; x.rankLabel = 'x'; }); await S.ingest(lb, await S.getSettings()); }
  await S.updatePlayer('4', { starred: true });
  const D1i = R.rankIdx(R.parseRank('D1', 'diamond'));
  ok(await S.purgeBelow(D1i, true) === 1 && mem['p:3'], 'dry run counts P1 (B1 is starred and kept) without deleting');
  ok(await S.purgeBelow(D1i) === 1 && !mem['p:3'] && mem['p:4'] && mem['p:2'] && mem['p:100'], 'purge removes P1 only; D1, you and the starred B1 stay');
  ok(!!mem.rdt_deleted && mem.rdt_deleted.players['3'], 'purged player is tombstoned so a seed or import does not bring them back');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.stack); process.exit(1); });
