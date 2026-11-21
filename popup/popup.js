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
    if (r.qpSkipped) return { cls: 'ok', lines: ['Quick Play lobby: hero details not read (Quick Play lobbies are not saved).'] };
    if (r.busy) return { cls: 'err', lines: ['Already reading hero details — wait a moment.'] };
    if (!r.read && !r.failed && r.already) {
      return { cls: 'ok', lines: ['Hero details: already saved for this match (' + r.already + ' player' + (r.already === 1 ? '' : 's') + ')', 'Nothing to read. Shift-click “Read hero details” to read them again.'] };
    }
    return {
      cls: r.read || r.already ? 'ok' : 'err',
      lines: [r.read ? 'Hero details: read ' + r.read + ' of ' + (r.total - (r.already || 0)) + ' players' : 'Hero details: could not read any player panel']
        .concat(r.already ? [r.already + ' already saved for this match, skipped.'] : [])
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
        lines = [r.qpNotSaved ? 'Quick Play lobby: not saved' : (r.saved ? 'Saved ' + r.saved + ' player' + (r.saved === 1 ? '' : 's') : 'Nothing saved yet')];
        lines.push(r.total + ' in the lobby' + (r.newGame ? ' · new lobby' : '') + (r.hidden ? ' · ' + r.hidden + ' names hidden' : ''));
        if (r.saved && typeof r.newPlayers === 'number' && typeof r.oldPlayers === 'number') lines.push(r.newPlayers + ' new player' + (r.newPlayers === 1 ? '' : 's') + ' · ' + r.oldPlayers + ' already known');
        if (r.hidden - (r.belowRange || 0) > 0) lines.push(r.matched + ' of ' + (r.hidden - (r.belowRange || 0)) + ' hidden players recognised (see the panel on the page)');
        if (r.belowRange) lines.push(r.belowRange + ' hidden player' + (r.belowRange === 1 ? '' : 's') + ' below ' + r.minLabel + ' not matched');
        if (r.qpNotSaved) lines.push('Turn on “Save Quick Play lobbies” in Settings → What gets saved if you want them.');
        else if (r.skipped) lines.push(r.skipped + ' Quick Play player' + (r.skipped === 1 ? '' : 's') + ' below GM not saved');
        if (!r.saved && r.hidden) lines.push('Names are hidden during the ban phase — press again once the match starts.');
        withDetails = r.saved > 0;
      }
    } catch (e) {
      lines = ['Could not reach the page: ' + (e && e.message || e)];
    }
    show(cls, lines);                                            // the save result is shown immediately
    if (withDetails) {
      setBusy('Reading hero details… (a few seconds)');
      try {
        const d = detailLines(await send(tab.id, { type: 'rdt-detail' }));
        show(cls, lines.concat(d.lines));
      } catch (e) { show(cls, lines.concat(['Hero details: ' + (e && e.message || e)])); }
    }
    setIdle();
  }

  /** Only the hero details (no save), e.g. to refresh them. */
  async function details(ev) {
    const force = !!(ev && ev.shiftKey);                       // Shift-click = read everyone again
    setBusy('Reading hero details… (a few seconds)');
    try { const d = detailLines(await send(tab.id, { type: 'rdt-detail', force })); show(d.cls, d.lines); }
    catch (e) { show('err', ['Could not reach the page: ' + (e && e.message || e)]); }
    setIdle();
  }

  async function openAll(ev) {
    const check = !(ev && ev.shiftKey);                          // Shift-click = just open the profiles, no checking
    $('openall').disabled = true;
    try {
      const r = await send(tab.id, { type: 'rdt-profiles' });
      if (!r) show('err', ['No response from the page. Reload the tab and try again.']);
      else if (r.error) show('err', ['Error: ' + r.error]);
      else if (r.noPanel) show('err', ['No Live Game found on this page.']);
      else if (!r.uids.length) show('err', ['No player profiles to open.', r.hidden ? 'All ' + r.hidden + ' names are hidden right now (ban phase).' : '']);
      else {
        for (const u of r.uids) await chrome.tabs.create({ url: 'https://rivalsdata.com/player/' + encodeURIComponent(u) + (check ? '#rdt-check' : ''), active: false });
        show('ok', ['Opened ' + r.uids.length + ' profile' + (r.uids.length === 1 ? '' : 's') + ' in new tabs'].concat(check ? ['Tabs of players not in a Competitive game close themselves; the others open their Live Game.'] : []).concat(r.hidden ? [r.hidden + ' hidden player' + (r.hidden === 1 ? '' : 's') + ' skipped (names not visible yet).'] : []));
      }
    } catch (e) { show('err', ['Could not reach the page: ' + (e && e.message || e)]); }
    $('openall').disabled = false;
  }

  async function init() {
    RDT.autoUI.init({ toggle: $('autotoggle'), delay: $('autodelay'), status: $('autostatus'), parallel: $('autoparallel') });
    try { $('ver').textContent = 'Version ' + chrome.runtime.getManifest().version; } catch (_) { /* optional */ }
    try { await RDT.store.loadSeed(chrome.runtime.getURL('data/players.json')); } catch (_) { /* optional */ }
    refreshCounts();
    $('savegh').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('db/db.html#github') }); window.close(); });
    $('savefile').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('db/db.html#save') }); window.close(); });
    $('open').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('db/db.html') }); window.close(); });
    tab = await findTab();
    if (!tab) { $('where').textContent = 'Open a rivalsdata.com player page with the Live Game tab to read a lobby.'; return; }
    $('where').textContent = 'Ready: ' + (tab.title || 'rivalsdata.com').slice(0, 60);
    $('scan').disabled = false; $('details').disabled = false; $('openall').disabled = false;
    $('openall').addEventListener('click', openAll);
    $('scan').addEventListener('click', scan);
    $('details').addEventListener('click', details);
  }
  init();
})();
