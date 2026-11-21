// Hero details: the reader (rows told apart by content, not class names) and the content-script flow that opens
// each row's chevron, reads Heroes / Proficiency / Match history, saves it and closes the row again.
// The expanded-row markup of the real site is NOT in any capture, so two different plausible structures are used.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SCRIPTS = ['lib/shared.js', 'lib/store.js', 'lib/detailui.js', 'content/scrape.js', 'content/content.js'].map(read);
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

const H = (slug) => `<img alt="${slug}" src="https://rivalsdata.com/assets/heroes/${slug}.webp">`;
const HEROES = [['peni-parker', 12, '67%'], ['groot', 3, '33%'], ['magneto', 3, '67%'], ['venom', 2, '50%'], ['ultron', 1, '100%']];
const PROF = [['peni-parker', 51], ['magneto', 37], ['groot', 28], ['venom', 26], ['ultron', 24]];
const MATCHES = [['peni-parker', 'W', '+14'], ['magneto', 'W', '+15'], ['venom', 'L', '−22'], ['peni-parker', 'W', '+18'], ['groot', 'L', '+0'], ['ultron', 'W', '+13']];

// structure A: three column wrappers, each with its own heading
const panelA = `<div class="panel"><div class="c"><div class="hd"><span>Heroes</span><button>Season 11</button></div>
  ${HEROES.map(([s, g, w]) => `<div class="row">${H(s)}<span>${s}</span><span>${g}</span><span>${w}</span></div>`).join('')}</div>
  <div class="c"><div class="hd"><span>Proficiency</span></div>
  ${PROF.map(([s, l]) => `<div class="row">${H(s)}<div class="bar"><i></i></div><span>Lv ${l}</span></div>`).join('')}</div>
  <div class="c"><div class="hd"><span>Match History</span></div>
  ${MATCHES.map(([s, r, d]) => `<div class="row">${H(s)}<b>${r}</b><span>${d}</span></div>`).join('')}</div></div>`;
// structure B: headings in one separate header row, tables underneath, extra wrapper divs, "Level" wording
const panelB = `<section><div class="titles"><p>HEROES</p><p>PROFICIENCY</p><p>MATCH HISTORY</p></div><div class="grid">
  <table><tbody>${HEROES.map(([s, g, w]) => `<tr><td><div>${H(s)}</div></td><td><div><span>${g}</span> <em>${w}</em></div></td></tr>`).join('')}</tbody></table>
  <table><tbody>${PROF.map(([s, l]) => `<tr><td>${H(s)}</td><td><i></i></td><td>Level ${l}</td></tr>`).join('')}</tbody></table>
  <table><tbody>${MATCHES.map(([s, r, d]) => `<tr><td>${H(s)}</td><td>${r}</td><td>${d}</td></tr>`).join('')}</tbody></table></div></section>`;

const mock = `window.chrome = { runtime: { onMessage: { addListener(fn) { window.__msg = fn; } } }, storage: { local: {
  get: (k, cb) => window.__get(k).then(cb), set: (o, cb) => window.__set(o).then(() => cb && cb()),
  remove: (k, cb) => window.__remove(k).then(() => cb && cb()), clear: (cb) => window.__clear().then(() => cb && cb()) }, onChanged: { addListener() {} } } };`;

(async () => {
  const browser = await chromium.launch();
  const store = new Map();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.exposeFunction('__get', (k) => { const o = {}; if (k === null) store.forEach((v, x) => { o[x] = JSON.parse(v); }); else [].concat(k).forEach((x) => { if (store.has(x)) o[x] = JSON.parse(store.get(x)); }); return o; });
  await ctx.exposeFunction('__set', (o) => { Object.entries(o).forEach(([k, v]) => store.set(k, JSON.stringify(v))); });
  await ctx.exposeFunction('__remove', (k) => { [].concat(k).forEach((x) => store.delete(x)); });
  await ctx.exposeFunction('__clear', () => store.clear());
  const errs = [];

  const page = async (html, mutateAfterScripts) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.setContent(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*stylesheet[^>]*>/g, ''));
    await p.evaluate(mock);
    for (const s of SCRIPTS) await p.evaluate(s);
    if (mutateAfterScripts) await p.evaluate(mutateAfterScripts);
    return p;
  };

  console.log('\n[1] Reader on two different panel structures');
  for (const [name, panel] of [['A (column wrappers)', panelA], ['B (separate heading row, tables, "Level")', panelB]]) {
    const p = await page(`<html><body><div id="scope"><div class="top">${['hulk', 'thor', 'venom', 'groot'].map(H).join('')}</div>${panel}</div></body></html>`);
    const d = await p.evaluate(() => RDT.scrapeDetail([document.getElementById('scope')]));
    ok(d && d.heroes.length === 5 && d.heroes[0].slug === 'peni-parker' && d.heroes[0].games === 12 && d.heroes[0].wr === 67, `${name}: hero records (12 games, 67%) read; the 4 plain Top-Hero tiles ignored`);
    ok(d.proficiency.length === 5 && d.proficiency[0].level === 51 && d.proficiency[4].level === 24, `${name}: proficiency levels 51…24 read`);
    ok(d.matches.length === 6 && d.matches[2].result === 'L' && d.matches[2].rs === -22 && d.matches[4].rs === 0 && d.matches[3].rs === 18, `${name}: match history incl. a unicode minus (−22) and +0`);
    ok(d.heroes.every((h) => !/^\d+$/.test(h.slug)) && d.heroes[1].games === 3 && d.heroes[1].wr === 33, `${name}: games and win% not mixed up`);
    await p.close();
  }
  const e = await (await page('<html><body><div id="x"><img src="https://rivalsdata.com/assets/heroes/hulk.webp"></div></body></html>')).evaluate(() => RDT.scrapeDetail([document.getElementById('x')]));
  ok(e === null, 'nothing but plain hero tiles => null (no fake data)');

  console.log('\n[2] Content-script flow: open every row, read, save, close again (simulated site behaviour)');
  const fx = read('tests/fixtures/game2.html');
  const sim = `(() => {   // behave like the site: chevron click loads the panel after a delay, a second click removes it
    const PANEL = ${JSON.stringify(panelA)};
    document.querySelectorAll('[role=tabpanel][aria-labelledby=live-game] li').forEach((li) => {
      const b = li.querySelector('button[aria-label^="Toggle details"]'); if (!b) return;
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-expanded') === 'true') { b.setAttribute('aria-expanded', 'false'); const d = li.querySelector('.panel'); if (d) d.remove(); }
        else { (window.__opened = window.__opened || []).push(b.getAttribute('aria-label')); b.setAttribute('aria-expanded', 'true'); setTimeout(() => { const w = document.createElement('div'); w.innerHTML = PANEL; li.appendChild(w.firstElementChild); }, 250); }
      });
    }); })()`;
  const p2 = await page(fx, sim);
  await p2.waitForTimeout(900);                                         // automatic save of the lobby
  const t0 = Date.now();
  const reply = await p2.evaluate(() => new Promise((res) => window.__msg({ type: 'rdt-detail' }, null, res)));
  const secs = (Date.now() - t0) / 1000;
  ok(reply.total === 11 && reply.read === 11 && reply.failed === 0, `read 11/11 other players (not you) in ${secs.toFixed(1)} s: ${JSON.stringify(reply)}`);
  const saved = [...store].filter(([k]) => k.startsWith('p:')).map(([, v]) => JSON.parse(v));
  const others = saved.filter((pl) => pl.uid !== '520435205');
  ok(saved.length === 12 && others.length === 11 && others.every((pl) => pl.detail && pl.detail.heroes.length === 5 && pl.detail.matches.length === 6 && pl.detail.season === 11), 'every other player has heroes / proficiency / matches / season stored');
  ok(!saved.find((pl) => pl.uid === '520435205').detail, 'your own row was ignored: no hero details stored for you');
  const opened = await p2.evaluate(() => window.__opened || []);
  ok(opened.length === 11 && !opened.some((n) => /DleanJeans/.test(n)), `only the 11 other players' rows were opened, yours never was (${opened.length} opened)`);
  ok(await p2.evaluate(() => document.querySelectorAll('.panel').length === 0 && [...document.querySelectorAll('button[aria-expanded]')].every((b) => b.getAttribute('aria-expanded') !== 'true')), 'all rows closed again: the page is left as it was found');
  const ask = (page, force) => page.evaluate((f) => new Promise((res) => window.__msg({ type: 'rdt-detail', force: f }, null, res)), !!force);
  const openedCount = () => p2.evaluate(() => (window.__opened || []).length);

  console.log('\n[2b] Pressing again in the same match skips players already read');
  const again = await ask(p2);
  ok(again.read === 0 && again.already === 11 && again.failed === 0, `second press: nothing to read, 11 already saved for this match (${JSON.stringify(again)})`);
  ok((await openedCount()) === 11, 'and not a single row was opened again');
  const uids = saved.filter((pl) => pl.uid !== '520435205').slice(0, 2).map((pl) => pl.uid);
  uids.forEach((u) => { const pl = JSON.parse(store.get('p:' + u)); delete pl.detail; store.set('p:' + u, JSON.stringify(pl)); });
  const part = await ask(p2);
  ok(part.read === 2 && part.already === 9 && (await openedCount()) === 13, `two players missing their details: only those 2 are read (${JSON.stringify(part)}, ${await openedCount()} rows opened in total)`);
  const forced = await ask(p2, true);
  ok(forced.read === 11 && forced.already === 0 && (await openedCount()) === 24, `force (Shift-click) reads everyone again (${JSON.stringify(forced)})`);
  const busy = await Promise.all([ask(p2, true), ask(p2, true)]);
  ok(busy.filter((r) => r.busy).length === 1 && busy.filter((r) => r.read === 11).length === 1, `two simultaneous requests: one runs, the other is told it is busy (${JSON.stringify(busy)})`);
  await p2.close();

  console.log('\n[2c] A new match: details are read again');
  const p2b = await page(read('tests/fixtures/game3.html'), sim);
  await p2b.waitForTimeout(900);
  const next = await ask(p2b);
  ok(next.total === 11 && next.read === 11 && next.already === 0, `different lobby => everyone is read again, even players who were in the previous match (${JSON.stringify(next)})`);
  const stamps = [...store].filter(([k]) => k.startsWith('p:')).map(([, v]) => JSON.parse(v)).filter((pl) => pl.detail && pl.uid !== '520435205').map((pl) => pl.detail.gameId);
  ok(new Set(stamps).size === 2, `details carry the id of the match they were read in (${new Set(stamps).size} different matches stored)`);
  await p2b.close();

  console.log('\n[3] A row whose panel never appears is reported, not faked (and is tried again next time, not skipped)');
  [...store].filter(([k]) => k.startsWith('p:')).forEach(([k, v]) => { const pl = JSON.parse(v); delete pl.detail; store.set(k, JSON.stringify(pl)); });   // start from nothing read
  const p3 = await page(fx, `document.querySelectorAll('button[aria-label^="Toggle details"]').forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') === 'true' ? 'false' : 'true')))`);
  await p3.waitForTimeout(900);
  const r3 = await p3.evaluate(() => new Promise((res) => window.__msg({ type: 'rdt-detail' }, null, res)));
  ok(r3.read === 0 && r3.failed === 11, `no panel => 0 read, 11 failed (${JSON.stringify(r3)})`);
  await p3.close();

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
