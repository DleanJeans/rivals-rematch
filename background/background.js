// Background worker. Two jobs:
//  1. Close a rivalsdata tab when that tab's own page asks for it ("Open all profiles" found that the player is not in a
//     Competitive game). Content scripts cannot close tabs themselves.
//  2. "Auto Expand": walk through the saved players slowly, one at a time. Each player's profile is opened in a background
//     tab; the page checks "In game (Competitive)", opens its Live Game tab and saves the lobby (so new players appear),
//     then reports back and this worker closes the tab and waits before the next one. Work is driven by chrome.alarms and the
//     state lives in chrome.storage.local (key rdt_auto), so it survives the worker being put to sleep.
importScripts('../lib/shared.js', '../lib/store.js');

const S = RDT.store;
const KEY = 'rdt_auto', NEXT = 'rdt-auto-next', LIMIT = 'rdt-auto-timeout';
const DEFAULTS = { delaySec: 60, recheckMin: 30, minDelaySec: 0.1, maxDelaySec: 600, tabTimeoutSec: 75, maxErrors: 6 };

const rd = () => new Promise((res) => chrome.storage.local.get(KEY, (r) => res(Object.assign({ running: false, checked: {}, stats: { checked: 0, inGame: 0, saved: 0, newPlayers: 0 }, errors: 0, delaySec: DEFAULTS.delaySec }, r[KEY] || {}))));
const wr = (st) => new Promise((res) => chrome.storage.local.set({ [KEY]: st }, res));
let chain = Promise.resolve();                                   // one step at a time: messages and alarms may overlap
const locked = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
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

async function pick(st) {
  const settings = await S.getSettings();
  const now = Date.now(), fresh = DEFAULTS.recheckMin * 60e3;
  const todo = (await S.loadPlayers()).filter((p) => p.uid && p.uid !== settings.selfUid && !(st.checked[p.uid] && now - st.checked[p.uid] < fresh));
  todo.sort((a, b) => {
    const ca = st.checked[a.uid] || 0, cb = st.checked[b.uid] || 0;
    if (!ca !== !cb) return ca ? 1 : -1;                         // never checked first
    if (ca !== cb) return ca - cb;                               // then the one checked longest ago
    return (b.lastSeen || 0) - (a.lastSeen || 0);                // fresh faces first: the ones seen most recently are likeliest to be playing
  });
  return { next: todo[0] || null, left: todo.length };
}

function step() {
  return locked(async () => {
    const st = await rd();
    if (!st.running || st.current) return;
    const { next, left } = await pick(st);
    if (!next) { st.status = 'Every saved player was checked in the last ' + DEFAULTS.recheckMin + ' min. Waiting…'; schedule(st, Math.max(st.delaySec, 60)); await wr(st); return; }
    const tab = await chrome.tabs.create({ url: 'https://rivalsdata.com/player/' + encodeURIComponent(next.uid) + '#rdt-auto', active: false });
    st.current = { uid: next.uid, tabId: tab.id, t: Date.now() };
    st.status = 'Checking ' + ((next.names && next.names[0]) || next.uid) + ' (' + left + ' left to check)';
    st.nextAt = null;
    chrome.alarms.create(LIMIT, { when: Date.now() + DEFAULTS.tabTimeoutSec * 1000 });
    await wr(st);
  });
}

/** The tab reported (or timed out). outcome: offline | competitive | nolive | error */
function finish(tabId, outcome, info) {
  return locked(async () => {
    const st = await rd();
    if (!st.current || (tabId != null && st.current.tabId !== tabId)) return;
    const cur = st.current; st.current = null;
    chrome.alarms.clear(LIMIT);
    closeTab(cur.tabId);
    st.checked[cur.uid] = Date.now();
    st.stats.checked++;
    if (outcome === 'error') st.errors++; else st.errors = 0;
    let line;
    if (outcome === 'competitive') {
      st.stats.inGame++; st.stats.saved += (info && info.saved) || 0; st.stats.newPlayers += (info && info.newPlayers) || 0;
      line = 'In a Competitive game: read ' + ((info && info.saved) || 0) + ' players, ' + ((info && info.newPlayers) || 0) + ' new';
    } else if (outcome === 'offline') line = 'Not in a Competitive game';
    else if (outcome === 'nolive') line = 'In a Competitive game but the Live Game never appeared';
    else line = 'Page did not load (rate limited?)';
    if (st.errors >= DEFAULTS.maxErrors) {
      st.running = false; st.status = 'Stopped: ' + st.errors + ' pages in a row did not load. The site is probably rate limiting you — try again later with a longer delay.';
      chrome.alarms.clear(NEXT); st.nextAt = null;
    } else {
      const sec = waitFor(st); schedule(st, sec);
      st.status = line + (st.errors ? ' · slowing down' : '');
    }
    await wr(st);
  });
}

function start(delaySec) {
  return locked(async () => {
    const st = await rd();
    st.running = true; st.errors = 0; st.delaySec = clampDelay(delaySec != null ? delaySec : st.delaySec); st.status = 'Starting…';
    st.stats = { checked: 0, inGame: 0, saved: 0, newPlayers: 0 }; st.startedAt = Date.now();
    if (st.current) { closeTab(st.current.tabId); st.current = null; }
    await wr(st);
  }).then(step);
}

function stop() {
  return locked(async () => {
    const st = await rd();
    st.running = false; st.status = 'Stopped'; st.nextAt = null;
    if (st.current) { closeTab(st.current.tabId); st.current = null; }
    chrome.alarms.clear(NEXT); chrome.alarms.clear(LIMIT);
    await wr(st);
  });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === NEXT) step();
  else if (a.name === LIMIT) finish(null, 'error');
});
chrome.runtime.onStartup.addListener(() => { rd().then((st) => { if (st.running) { st.current = null; return wr(st).then(step); } }); });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.id !== chrome.runtime.id) return;
  const url = sender.url || (sender.tab && sender.tab.url) || '';
  if (msg.type === 'rdt-close-me' && sender.tab) {
    if (/^https:\/\/(www\.)?rivalsdata\.com\//.test(url)) chrome.tabs.remove(sender.tab.id);
  } else if (msg.type === 'rdt-auto-done' && sender.tab && /^https:\/\/(www\.)?rivalsdata\.com\//.test(url)) {
    finish(sender.tab.id, msg.outcome, msg).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  } else if (msg.type === 'rdt-auto-start') { start(msg.delaySec).then(() => reply({ ok: true })); return true; }
  else if (msg.type === 'rdt-auto-stop') { stop().then(() => reply({ ok: true })); return true; }
});
