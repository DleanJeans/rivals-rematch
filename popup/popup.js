(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const URLS = ['https://rivalsdata.com/*', 'https://www.rivalsdata.com/*'];
  const FILES = ['lib/shared.js', 'lib/store.js', 'lib/detailui.js', 'content/scrape.js', 'content/content.js'];
  let tab = null;

  async function findTab() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && /^https:\/\/(www\.)?rivalsdata\.com\//.test(active.url || '')) return active;
    const [any] = await chrome.tabs.query({ url: URLS, lastFocusedWindow: true });
    return any || null;
  }

  async function refreshCounts() {
    const a = await RDT.store.loadAll();
    $('counts').textContent = a.players.length + ' players · ' + a.games.length + ' lobbies';
  }

  // The page may have been opened before the extension was installed/reloaded: inject on demand.
  async function send(tabId, msg) {
    try { return await chrome.tabs.sendMessage(tabId, msg); }
    catch (_) {
      await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
      await new Promise((r) => setTimeout(r, 400));
      return chrome.tabs.sendMessage(tabId, msg);
    }
  }

  function show(cls, lines) {
    const r = $('result'); r.className = 'show ' + cls; r.textContent = '';
    lines.forEach((l, i) => {
      const d = document.createElement('div');
      if (i === 0) { const b = document.createElement('b'); b.textContent = l; d.appendChild(b); } else d.textContent = l;
      r.appendChild(d);
    });
  }

  async function scan() {
    $('scan').disabled = true; $('scan').textContent = 'Reading…';
    try {
      const r = await send(tab.id, { type: 'rdt-scan' });
      if (!r) show('err', ['No response from the page. Reload the tab and try again.']);
      else if (r.error) show('err', ['Error: ' + r.error]);
      else if (r.noPanel) show('err', ['No Live Game found on this page.', 'Open the “Live Game” tab of a player who is in a match.']);
      else {
        const lines = [(r.saved ? 'Saved ' + r.saved + ' player' + (r.saved === 1 ? '' : 's') : 'Nothing saved yet')];
        lines.push(r.total + ' in the lobby' + (r.newGame ? ' · new lobby' : '') + (r.hidden ? ' · ' + r.hidden + ' names hidden' : ''));
        if (r.hidden) lines.push(r.matched + ' of ' + r.hidden + ' hidden players recognised (see the panel on the page)');
        if (r.skipped) lines.push(r.skipped + ' Quick Play player' + (r.skipped === 1 ? '' : 's') + ' below GM not saved');
        if (!r.saved && r.hidden) lines.push('Names are hidden during the ban phase — press again once the match starts.');
        show('ok', lines);
      }
    } catch (e) {
      show('err', ['Could not reach the page: ' + (e && e.message || e)]);
    }
    $('scan').disabled = false; $('scan').textContent = 'Read & save this lobby';
    refreshCounts();
  }

  async function details() {
    const b = $('details'); b.disabled = true; $('scan').disabled = true; b.textContent = 'Reading… (about 1 s per player)';
    try {
      const r = await send(tab.id, { type: 'rdt-detail' });
      if (!r) show('err', ['No response from the page. Reload the tab and try again.']);
      else if (r.error) show('err', ['Error: ' + r.error]);
      else if (r.noPanel) show('err', ['No Live Game found on this page.']);
      else if (r.busy) show('err', ['Already reading — wait a moment.']);
      else show(r.read ? 'ok' : 'err', [r.read ? 'Read ' + r.read + ' of ' + r.total + ' players' : 'Could not read any player panel',
        r.failed ? r.failed + ' could not be read (panel did not open or has no data yet).' : 'Hover a hero in the database to see their stats.']);
    } catch (e) { show('err', ['Could not reach the page: ' + (e && e.message || e)]); }
    b.disabled = false; $('scan').disabled = false; b.textContent = 'Read hero details'; refreshCounts();
  }

  async function init() {
    try { $('ver').textContent = 'Version ' + chrome.runtime.getManifest().version; } catch (_) { /* optional */ }
    try { await RDT.store.loadSeed(chrome.runtime.getURL('data/players.json')); } catch (_) { /* optional */ }
    refreshCounts();
    $('savefile').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('db/db.html#save') }); window.close(); });
    $('open').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('db/db.html') }); window.close(); });
    tab = await findTab();
    if (!tab) { $('where').textContent = 'Open a rivalsdata.com player page with the Live Game tab to read a lobby.'; return; }
    $('where').textContent = 'Ready: ' + (tab.title || 'rivalsdata.com').slice(0, 60);
    $('scan').disabled = false; $('details').disabled = false;
    $('scan').addEventListener('click', scan);
    $('details').addEventListener('click', details);
  }
  init();
})();
