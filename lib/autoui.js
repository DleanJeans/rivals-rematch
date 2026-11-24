/*
 * Auto Discover controls, shared by the toolbar popup and the database page. The background worker does the walking
 * (background/background.js); this only starts/stops it and paints its state (chrome.storage.local key rdt_auto).
 * RDT.autoUI.init({ toggle, delay, status, parallel?, order? }) takes the elements. order() (database page only) returns the
 * player uids in the order the table shows them; Auto Discover then follows that order instead of its default priority.
 */
(function (root) {
  'use strict';
  function init(el) {
    let state = null, delayShown = false;
    const paint = () => {
      const st = state || {}, sx = st.stats || {};
      el.toggle.textContent = st.running ? 'Stop Auto Discover' : 'Start Auto Discover';
      el.delay.disabled = !!st.running; if (el.parallel) el.parallel.disabled = !!st.running;
      if (st.delaySec && (st.running || !delayShown)) { el.delay.value = st.delaySec; if (el.parallel && st.parallel) el.parallel.value = st.parallel; delayShown = true; }   // never overwrite what the user is typing
      const lines = [];
      if (st.status) lines.push(st.status + (st.running && st.nextAt && !Object.keys(st.inflight || {}).length ? ' \u00b7 next in ' + Math.max(0, (st.nextAt - Date.now()) / 1000).toFixed(st.delaySec < 10 ? 1 : 0) + ' s' : ''));
      if (sx.checked) lines.push(sx.checked + ' checked \u00b7 ' + sx.inGame + ' in Competitive \u00b7 ' + sx.newPlayers + ' new players found');
      el.status.textContent = lines.join('\n'); el.status.style.whiteSpace = 'pre-line';
    };
    root.chrome.storage.local.get('rdt_auto', (r) => { state = (r && r.rdt_auto) || null; paint(); });
    root.chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.rdt_auto) { state = ch.rdt_auto.newValue || null; paint(); } });
    setInterval(paint, 1000);
    el.toggle.addEventListener('click', () => {
      root.chrome.runtime.sendMessage(state && state.running ? { type: 'rdt-auto-stop' } : { type: 'rdt-auto-start', delaySec: Number(el.delay.value), parallel: el.parallel ? Number(el.parallel.value) : 1, order: el.order ? el.order() : undefined });
    });
  }
  root.RDT = Object.assign(root.RDT || {}, { autoUI: { init } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
