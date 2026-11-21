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

  // Lines describing a hero-details run; shared by the combined button and the details-only button.
  function detailLines(r) {
    if (!r) return { cls: 'err', lines: ['No response from the page. Reload the tab and try again.'] };
    if (r.error) return { cls: 'err', lines: ['Error: ' + r.error] };
    if (r.noPanel) return { cls: 'err', lines: ['No Live Game found on this page.'] };
    if (r.busy) return { cls: 'err', lines: ['Already reading hero details — wait a moment.'] };
    return {
      cls: r.read ? 'ok' : 'err',
      lines: [r.read ? 'Hero details: read ' + r.read + ' of ' + r.total + ' players' : 'Hero details: could not read any player panel']
        .concat(r.failed ? [r.failed + ' could not be read (panel did not open or has no data yet).'] : []),
    };
  }

  const setBusy = (text) => { $('scan').disabled = true; $('details').disabled = true; $('scan').textContent = text; };
  const setIdle = () => { $('scan').disabled = false; $('details').disabled = false; $('scan').textContent = 'Read & save this lobby'; $('details').textContent = 'Read hero details'; refreshCounts(); };

  /** Read & save the lobby, then (if anyone was saved) read every player's hero details too. */
  async function scan() {
    setBusy('Reading…');
    let lines = null, cls = 'err', withDetails = false;
    try {
      const r = await send(tab.id, { type: 'rdt-scan' });
      if (!r) lines = ['No response from the page. Reload the tab and try again.'];
      else if (r.error) lines = ['Error: ' + r.error];
      else if (r.noPanel) lines = ['No Live Game found on this page.', 'Open the “Live Game” tab of a player who is in a match.'];
      else {
        cls = 'ok';
        lines = [(r.saved ? 'Saved ' + r.saved + ' player' + (r.saved === 1 ? '' : 's') : 'Nothing saved yet')];
        lines.push(r.total + ' in the lobby' + (r.newGame ? ' · new lobby' : '') + (r.hidden ? ' · ' + r.hidden + ' names hidden' : ''));
        if (r.hidden - (r.belowRange || 0) > 0) lines.push(r.matched + ' of ' + (r.hidden - (r.belowRange || 0)) + ' hidden players recognised (see the panel on the page)');
        if (r.belowRange) lines.push(r.belowRange + ' hidden player' + (r.belowRange === 1 ? '' : 's') + ' below ' + r.minLabel + ' not matched');
        if (r.skipped) lines.push(r.skipped + ' Quick Play player' + (r.skipped === 1 ? '' : 's') + ' below GM not saved');
        if (!r.saved && r.hidden) lines.push('Names are hidden during the ban phase — press again once the match starts.');
        withDetails = r.saved > 0;
      }
    } catch (e) {
      lines = ['Could not reach the page: ' + (e && e.message || e)];
    }
    show(cls, lines);                                            // the save result is shown immediately
    if (withDetails) {
      setBusy('Reading hero details… (about 1 s per player)');
      try {
        const d = detailLines(await send(tab.id, { type: 'rdt-detail' }));
        show(cls, lines.concat(d.lines));
      } catch (e) { show(cls, lines.concat(['Hero details: ' + (e && e.message || e)])); }
    }
    setIdle();
  }

  /** Only the hero details (no save), e.g. to refresh them. */
  async function details() {
    setBusy('Reading hero details… (about 1 s per player)');
    try { const d = detailLines(await send(tab.id, { type: 'rdt-detail' })); show(d.cls, d.lines); }
    catch (e) { show('err', ['Could not reach the page: ' + (e && e.message || e)]); }
    setIdle();
  }

  async function init() {
    try { $('ver').textContent = 'Version ' + chrome.runtime.getManifest().version; } catch (_) { /* optional */ }
    try { await RDT.store.loadSeed(chrome.runtime.getURL('data/players.json')); } catch (_) { /* optional */ }
    refreshCounts();
    $('savegh').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('db/db.html#github') }); window.close(); });
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
