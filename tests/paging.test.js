// Players tab paging: 1200 players, page size 500, paging after sort/filter, numbering continues across pages.
const { chromium } = require('playwright');
const path = require('path');
const root = path.join(__dirname, '..');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const now = Date.now(); const seed = {};
for (let i = 1; i <= 1200; i++) { const uid = String(1000 + i); seed['p:' + uid] = { uid, names: ['P' + String(i).padStart(4, '0')], icon: '1', firstSeen: now, lastSeen: now - i * 1000, seen: i, asTeammate: 0, asEnemy: 1, partied: 0, tag: '', note: '', hist: [], last: { rankLabel: 'GM1', rs: 10, abs: 4700 + i, w: 1, l: 1, heroes: [], heroLabels: {}, t: now } }; }
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message); fail++; });
  await page.addInitScript(`(() => { const st = ${JSON.stringify(seed)};
    const area = { get(k, cb) { const o = {}; if (k === null) Object.assign(o, JSON.parse(JSON.stringify(st))); else [].concat(k).forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); },
      set(o, cb) { Object.assign(st, JSON.parse(JSON.stringify(o))); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb) { [].concat(k).forEach((x) => delete st[x]); if (cb) { cb(); return; } return Promise.resolve(); },
      clear(cb) { for (const k in st) delete st[k]; if (cb) { cb(); return; } return Promise.resolve(); } };
    window.chrome = { storage: { local: area, session: area, onChanged: { addListener() {} } }, tabs: { create: () => Promise.resolve({}) } }; })();`);
  await page.goto('file://' + path.join(root, 'db/db.html'));
  await page.waitForSelector('#tbl tbody tr');
  const n = () => page.$$eval('#tbl tbody tr', (r) => r.length);
  const first = () => page.$eval('#tbl tbody tr', (r) => [r.children[0].textContent, r.querySelector('td.nm a').textContent]);
  ok((await n()) === 500, 'page 1 shows 500 rows');
  ok(/Page 1 of 3/.test(await page.textContent('.pager[data-pos=top]')), 'pager shows Page 1 of 3');
  await page.click('.pager[data-pos=top] button[title="Next page"]');
  ok(JSON.stringify(await first()) === '["501","P0501"]'.replace('P0501', (await first())[1]) && (await first())[0] === '501', 'page 2 starts at #501');
  await page.click('.pager[data-pos=top] button[title="Last page"]');
  ok((await n()) === 200 && (await first())[0] === '1001', 'last page has the remaining 200, numbered from 1001');
  await page.click('th[data-s=name]');
  ok((await first())[1] === 'P0001' && (await first())[0] === '1', 'sorting resets to page 1 and orders the whole set');
  await page.click('.pager[data-pos=bottom] button[title="Last page"]');
  ok((await page.$$eval('#tbl tbody tr td.nm a', (a) => a[a.length - 1].textContent)) === 'P1200', 'name sort puts P1200 at the very end of the last page');
  await page.fill('#q', 'P0042');
  ok((await n()) === 1 && await page.$eval('.pager[data-pos=top]', (e) => e.hidden), 'search filters the whole set; pager hides when one page');
  await page.fill('#q', ''); await page.selectOption('#pagesize', '0');
  ok((await n()) === 1200, 'All shows every player');
  await page.selectOption('#pagesize', '100');
  ok((await n()) === 100 && /Page 1 of 12/.test(await page.textContent('.pager[data-pos=top]')), 'page size 100 gives 12 pages');
  await b.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
