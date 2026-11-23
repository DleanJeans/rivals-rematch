// Background worker. Two jobs:
//  1. Close a rivalsdata tab when that tab's own page asks for it ("Open all profiles" found that the player is not in a
//     Competitive game). Content scripts cannot close tabs themselves.
//  2. "Auto Discover": walk through the saved players slowly, one at a time. Each player's profile is opened in a background
//     tab; the page checks "In game (Competitive)", opens its Live Game tab and saves the lobby (so new players appear),
//     then reports back and this worker closes the tab and waits before the next one. Work is driven by chrome.alarms and the
//     state lives in chrome.storage.local (key rdt_auto), so it survives the worker being put to sleep.
importScripts('../lib/shared.js', '../lib/store.js');

const S = RDT.store;
const KEY = 'rdt_auto', NEXT = 'rdt-auto-next', LIMIT = 'rdt-auto-timeout';
const DEFAULTS = { delaySec: 1, recheckMin: 20, minDelaySec: 0.1, maxDelaySec: 600, tabTimeoutSec: 75, maxErrors: 6 };

const rd = () => new Promise((res) => chrome.storage.local.get(KEY, (r) => res(Object.assign({ running: false, checked: {}, stats: { checked: 0, inGame: 0, saved: 0, newPlayers: 0 }, errors: 0, delaySec: DEFAULTS.delaySec, parallel: 1, inflight: {} }, r[KEY] || {}))));
const wr = (st) => new Promise((res) => chrome.storage.local.set({ [KEY]: st }, res));
let chain = Promise.resolve();                                   // one step at a time: messages and alarms may overlap
const locked = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
const clampParallel = (n) => Math.min(10, Math.max(1, Math.round(Number(n)) || 1));
const clampDelay = (n) => { n = Number(n); return Math.min(DEFAULTS.maxDelaySec, Math.max(DEFAULTS.minDelaySec, n > 0 ? Math.round(n * 10) / 10 : DEFAULTS.delaySec)); };
const closeTab = (id) => { if (id != null) try { chrome.tabs.remove(id, () => void chrome.runtime.lastError); } catch (_) { /* gone already */ } };
const schedule = (st, sec) => {
  st.nextAt = Date.now() + sec * 1000;
  chrome.alarms.create(NEXT, { when: st.nextAt });                // Chrome rounds alarms up to 30 s in installed extensions ...
  if (sec < 30) setTimeout(step, sec * 1000);                     // ... so short waits use a timer (the alarm stays as the fallback)
};
const waitFor = (st) => {                                        // delay, +-20 % so the rhythm is not mechanical, doubled after each failure
  const base = st.delaySec * Math.pow(2, Math.min(st.errors, 4));
  return Math.min(1800, base * (0.8 + Math.random() * 0.4));
};

async function pick(st, busy) {
  const settings = await S.getSettings();
  const now = Date.now(), fresh = DEFAULTS.recheckMin * 60e3;
  const all = await S.loadAll();
  const inMatch = new Set();                                      // saved players in a lobby from the last while: they are in (or just left) a match we already read
  all.games.filter((g) => now - (g.last || 0) < fresh).forEach((g) => Object.keys(g.players || {}).forEach((u) => inMatch.add(u)));
  const todo = all.players.filter((p) => p.uid && p.uid !== settings.selfUid && !inMatch.has(p.uid) && !(busy && busy.has(p.uid)) && !(st.checked[p.uid] && now - st.checked[p.uid] < fresh));
  todo.sort((a, b) => {
    const ca = st.checked[a.uid] || 0, cb = st.checked[b.uid] || 0;
    const oa = S.onlineOf(a, now), ob = S.onlineOf(b, now);       // stored online status (30 min): known in-game first, known offline last
    const ra = oa === true ? 0 : oa === false ? 2 : 1, rb = ob === true ? 0 : ob === false ? 2 : 1;
    if (ra !== rb) return ra - rb;
    if (!ca !== !cb) return ca ? 1 : -1;                         // never checked first
    if (ca !== cb) return ca - cb;                               // then the one checked longest ago
    return (b.lastSeen || 0) - (a.lastSeen || 0);                // fresh faces first: the ones seen most recently are likeliest to be playing
  });
  return { next: todo[0] || null, left: todo.length };
}

const open = (st) => Object.keys(st.inflight || {});
const active = (st) => open(st).filter((k) => !st.inflight[k].waiting);          // a tab waiting for hidden names does not use up a slot
const MAX_WAITING = 5;
const nameOf = (p) => (p.names && p.names[0]) || p.uid;

function step() {
  return locked(async () => {
    const st = await rd();
    if (!st.running || active(st).length >= st.parallel || open(st).length >= st.parallel + MAX_WAITING) return;
    st.inflight = st.inflight || {};
    // fill every free slot right now (a short stagger between tabs); the wait only applies between one profile finishing and its replacement opening
    let left = 0, opened = 0;
    while (active(st).length < st.parallel && open(st).length < st.parallel + MAX_WAITING) {
      const busy = new Set(open(st).map((k) => st.inflight[k].uid));
      const r = await pick(st, busy); left = r.left;
      if (!r.next) break;
      const tab = await chrome.tabs.create({ url: 'https://rivalsdata.com/player/' + encodeURIComponent(r.next.uid) + '#rdt-auto', active: false });
      st.inflight[tab.id] = { uid: r.next.uid, tabId: tab.id, t: Date.now(), name: nameOf(r.next) }; opened++; left--;
      if (active(st).length < st.parallel) await new Promise((res) => setTimeout(res, 400));
    }
    if (!open(st).length) { st.status = 'Every saved player was checked in the last ' + DEFAULTS.recheckMin + ' min. Waiting…'; schedule(st, Math.max(st.delaySec, 60)); await wr(st); return; }
    if (opened) {
      st.status = 'Checking ' + open(st).map((k) => st.inflight[k].name).join(', ') + ' (' + Math.max(0, left) + ' left to check)';
      st.nextAt = null;
      chrome.alarms.create(LIMIT, { when: Date.now() + DEFAULTS.tabTimeoutSec * 1000 });
    }
    await wr(st);
  });
}

/** One tab reported (or timed out). outcome: offline | competitive | nolive | error */
function finish(tabId, outcome, info) {
  return locked(async () => {
    const st = await rd();
    const cur = st.inflight && st.inflight[tabId];
    if (!cur) return;
    const fresh = DEFAULTS.recheckMin * 60e3;
    delete st.inflight[tabId];
    closeTab(cur.tabId);
    st.checked[cur.uid] = Date.now();
    st.stats.checked++;
    if (outcome === 'error') st.errors++; else st.errors = 0;
    let line;
    if (outcome === 'competitive') {
      st.stats.inGame++; st.stats.saved += (info && info.saved) || 0; st.stats.newPlayers += (info && info.newPlayers) || 0;
      line = cur.name + ': in a Competitive game, read ' + ((info && info.saved) || 0) + ' players, ' + ((info && info.newPlayers) || 0) + ' new';
    } else if (outcome === 'hidden') {
      st.checked[cur.uid] = Date.now() - fresh + 3 * 60e3;                   // names never appeared: look again in 3 minutes
      st.stats.saved += (info && info.saved) || 0; st.stats.newPlayers += (info && info.newPlayers) || 0;
      line = cur.name + ': match still in its ban phase, will look again soon';
    } else if (outcome === 'offline') line = cur.name + ': not in a Competitive game';
    else if (outcome === 'nolive') line = cur.name + ': in a Competitive game but the Live Game never appeared';
    else line = cur.name + ': page did not load (rate limited?)';
    if (st.errors >= DEFAULTS.maxErrors) {
      st.running = false; st.status = 'Stopped: ' + st.errors + ' pages in a row did not load. The site is probably rate limiting you — try again later with a longer delay.';
      Object.keys(st.inflight).forEach((k) => closeTab(Number(k))); st.inflight = {};
      chrome.alarms.clear(NEXT); chrome.alarms.clear(LIMIT); st.nextAt = null;
    } else {
      schedule(st, waitFor(st));
      st.status = line + (st.errors ? ' · slowing down' : '');
    }
    await wr(st);
  });
}

/** A tab that is waiting for hidden names to be revealed says so now and then: give it more time. */
function alive(tabId) {
  return locked(async () => {
    const st = await rd();
    if (!st.inflight || !st.inflight[tabId]) return;
    const first = !st.inflight[tabId].waiting;
    st.inflight[tabId].t = Date.now(); st.inflight[tabId].waiting = true;
    chrome.alarms.create(LIMIT, { when: Date.now() + DEFAULTS.tabTimeoutSec * 1000 });
    if (first && st.running) schedule(st, waitFor(st));                          // a free slot: open the next profile while this one waits
    await wr(st);
  });
}

/** Tabs that never reported back in time count as failed loads. */
async function expire() {
  const st = await rd(), now = Date.now();
  for (const k of open(st)) if (now - st.inflight[k].t >= DEFAULTS.tabTimeoutSec * 1000 - 500) await finish(Number(k), 'error');
  const left = await rd();
  if (left.running && open(left).length) chrome.alarms.create(LIMIT, { when: Date.now() + 5000 });
}

function start(delaySec, parallel) {
  return locked(async () => {
    const st = await rd();
    Object.keys(st.inflight || {}).forEach((k) => closeTab(Number(k))); st.inflight = {};
    st.running = true; st.errors = 0; st.delaySec = clampDelay(delaySec != null ? delaySec : st.delaySec);
    st.parallel = clampParallel(parallel != null ? parallel : st.parallel); st.status = 'Starting…';
    st.stats = { checked: 0, inGame: 0, saved: 0, newPlayers: 0 }; st.startedAt = Date.now();
    await wr(st);
  }).then(step);
}

function stop() {
  return locked(async () => {
    const st = await rd();
    st.running = false; st.status = 'Stopped'; st.nextAt = null;
    Object.keys(st.inflight || {}).forEach((k) => closeTab(Number(k))); st.inflight = {};
    chrome.alarms.clear(NEXT); chrome.alarms.clear(LIMIT);
    await wr(st);
  });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === NEXT) step();
  else if (a.name === LIMIT) expire();
});
chrome.runtime.onStartup.addListener(() => { rd().then((st) => { if (st.running) { st.inflight = {}; return wr(st).then(step); } }); });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return;
  const url = sender.url || (sender.tab && sender.tab.url) || '';
  if (msg.type === 'rdt-close-me' && sender.tab) {
    if (/^https:\/\/(www\.)?rivalsdata\.com\//.test(url)) chrome.tabs.remove(sender.tab.id);
  } else if (msg.type === 'rdt-auto-done' && sender.tab && /^https:\/\/(www\.)?rivalsdata\.com\//.test(url)) {
    finish(sender.tab.id, msg.outcome, msg).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  } else if (msg.type === 'rdt-auto-alive' && sender.tab) {
    alive(sender.tab.id);
  } else if (msg.type === 'rdt-auto-start') { start(msg.delaySec, msg.parallel).then(() => reply({ ok: true })); return true; }
  else if (msg.type === 'rdt-auto-stop') { stop().then(() => reply({ ok: true })); return true; }
});
