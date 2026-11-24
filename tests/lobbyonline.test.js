// Ingesting a live Competitive lobby marks every player in it as in-game (online status), not just the one being read.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const mem = {};
const chrome = { storage: { local: {
  get: (k, cb) => { const r = {}; if (k == null) Object.assign(r, mem); else [].concat(k).forEach((x) => { if (x in mem) r[x] = JSON.parse(JSON.stringify(mem[x])); }); cb ? cb(r) : null; return Promise.resolve(r); },
  set: (o, cb) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); cb && cb(); return Promise.resolve(); },
  remove: (k, cb) => { [].concat(k).forEach((x) => delete mem[x]); cb && cb(); return Promise.resolve(); } } } };
global.self = global; global.chrome = chrome; global.window = global;
for (const f of ['lib/shared.js', 'lib/store.js']) { try { eval.call(global, fs.readFileSync(path.join(root, f), 'utf8')); } catch (e) { console.log('load', f, e.message); } }
(async () => {
  const S = Object.values(global).find((v) => v && v.store && v.store.ingest); const St = S && S.store;
  if (!St) { console.log('SKIP: store not exposed'); return; }
  const rows = [1, 2, 3].map((i) => ({ uid: 'u' + i, name: 'P' + i, team: i % 2, idx: i, rs: 100, abs: 100, w: 1, l: 1, rankLabel: 'GM', rankIdx: 20 }));
  await St.ingest({ rows, season: 's', qpLobby: false }, {}, Date.now());
  const ps = await St.loadPlayers();
  const bad = ps.filter((p) => !(p.online && p.online.inGame));
  if (ps.length !== 3 || bad.length) { console.error('FAIL', ps.length, bad.length); process.exit(1); }
  console.log('lobbyonline: ok');
})();
