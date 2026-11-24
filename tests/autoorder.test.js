// Auto Discover picks in the database page's sort order when started from there, and in its default priority otherwise.
// Runs the real background worker in a vm with a fake chrome.
const vm = require('vm'), fs = require('fs'), path = require('path');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const root = path.join(__dirname, '..');
const mem = {}; let created = [], listeners = {};
const sandbox = {
  console, setTimeout, clearTimeout, Date, Math, Promise,
  chrome: {
    storage: { local: {
      get: (k, cb) => cb(k == null ? Object.assign({}, mem) : typeof k === 'string' ? (k in mem ? { [k]: mem[k] } : {}) : {}),
      set: (o, cb) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); cb && cb(); },
      remove: (k, cb) => { delete mem[k]; cb && cb(); } } },
    alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
    tabs: { create: async (o) => { created.push(o.url); return { id: created.length }; }, remove(id, cb) { cb && cb(); } },
    runtime: { id: 'x', lastError: null, onStartup: { addListener() {} }, onMessage: { addListener: (f) => { listeners.msg = f; } } },
  },
};
sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.importScripts = (...fs_) => fs_.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, 'background', f), 'utf8'), ctx, { filename: f }));
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'background/background.js'), 'utf8'), ctx, { filename: 'background.js' });
const now = Date.now();
[['1', now - 1000], ['2', now - 2000], ['3', now - 3000], ['4', now - 4000]].forEach(([u, t]) => { mem['p:' + u] = { uid: u, names: ['n' + u], lastSeen: t }; });
const msg = (m) => new Promise((res) => listeners.msg(Object.assign({}, m), { id: 'x' }, res));
const uidOf = (u) => /player\/(\d+)/.exec(u)[1];
const next = async () => {                                                   // finish whatever is open, then see which profile opens next
  created = []; const st = mem.rdt_auto; await new Promise((r) => setTimeout(r, 50)); return created.map(uidOf);
};
(async () => {
  // default priority: most recently seen first
  await msg({ type: 'rdt-auto-start', delaySec: 0.1, parallel: 1 });
  await new Promise((r) => setTimeout(r, 100));
  ok(uidOf(created[0]) === '1', 'started without an order: default priority (most recently seen first)');
  await msg({ type: 'rdt-auto-stop' });
  created = []; mem.rdt_auto.checked = {};
  // from the page: its order wins
  await msg({ type: 'rdt-auto-start', delaySec: 0.1, parallel: 1, order: ['3', '4', '1', '2'] });
  await new Promise((r) => setTimeout(r, 100));
  ok(uidOf(created[0]) === '3', 'started with the page order: first row of the table opens first');
  // sort changes mid-run: the page rewrites the order, the next pick follows it
  mem.rdt_auto_order = ['2', '1', '4', '3'];
  const tab = Object.keys(mem.rdt_auto.inflight)[0];
  listeners.msg({ type: 'rdt-auto-done', outcome: 'offline' }, { id: 'x', tab: { id: Number(tab) }, url: 'https://rivalsdata.com/player/3' }, () => {});
  await new Promise((r) => setTimeout(r, 1500));
  ok(created.length >= 2 && uidOf(created[1]) === '2', 'after the sort changed mid-run the next pick follows the new order (got ' + created.map(uidOf) + ')');
  await msg({ type: 'rdt-auto-stop' });
  console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
})();
