// Reloading the extension while a rivalsdata tab is open used to spam "Extension context invalidated".
// Real extension, real reload: the orphaned copy must go quiet, say so, and a fresh copy must not double up.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const repo = fs.realpathSync(path.join(__dirname, '..'));
const extDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-orph-')), 'ext');
fs.cpSync(repo, extDir, { recursive: true, filter: (f) => !['.git', 'node_modules'].some((x) => f.split(path.sep).includes(x)) && path.basename(f) !== 'players.json' });
const ext = fs.realpathSync(extDir);
const id = crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
const fx = (f) => fs.readFileSync(path.join(repo, 'tests/fixtures', f), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*stylesheet[^>]*>/g, '')
  .replace('</head>', '<style>' + fs.readFileSync(path.join(repo, 'tests/fixtures/site.css'), 'utf8') + '</style></head>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-oprof-')), {
    headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await ctx.route('https://rivalsdata.com/player/**', (r) => r.fulfill({ contentType: 'text/html', body: fx('game2.html') }));
  await ctx.route(/\.(webp|png)(\?|$)/, (r) => r.abort());

  const site = await ctx.newPage();
  const noise = [];
  site.on('pageerror', (e) => noise.push('pageerror: ' + e.message));
  site.on('console', (m) => { if (['error', 'warning'].includes(m.type())) noise.push(m.type() + ': ' + m.text()); });
  await site.goto('https://rivalsdata.com/player/520435205');
  await site.waitForFunction(() => document.querySelector('#rdt-host'), null, { timeout: 8000 });
  ok(true, 'content script is running on the open tab (panel present)');

  // --- reload the extension, exactly like the user did
  const bg = await ctx.newPage();
  await bg.goto(`chrome-extension://${id}/db/db.html`);
  await bg.waitForSelector('#fileBtn');
  await bg.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); });
  await sleep(2500);

  // the old copy only notices when something happens on the page
  await site.evaluate(() => { const d = document.createElement('div'); d.id = 'poke'; document.body.appendChild(d); });
  await sleep(900);
  await site.evaluate(() => { document.getElementById('poke').textContent = 'again'; });
  await sleep(700);

  const txt = await site.evaluate(() => { const h = document.querySelector('#rdt-host'); return h ? h.shadowRoot.textContent : null; });
  ok(txt && /was updated/.test(txt) && /reload this page/i.test(txt), `orphaned copy replaces its panel with a notice: "${(txt || '').replace(/\s+/g, ' ').slice(-90)}"`);
  ok(!/ERROR|invalidated/i.test(txt || ''), 'the notice is not an error message');
  const bad = noise.filter((n) => /invalidated|Rivals Rematch/i.test(n));
  ok(bad.length === 0, `no "Extension context invalidated" noise in the page console${bad.length ? ': ' + bad.slice(0, 2).join(' | ') : ''}`);
  ok(noise.filter((n) => n.startsWith('pageerror')).length === 0, 'no uncaught page errors');
  ok(await site.evaluate(() => !!document.querySelector('#rdt-host').shadowRoot.querySelector('button')), 'the notice has a Reload button');

  // (A headless-launched unpacked extension does not come back after chrome.runtime.reload(), so the next two
  //  behaviours are tested on a plain page with a mocked chrome API.)
  await ctx.close();
  const browser = await chromium.launch();
  const store = new Map();
  const bctx = await browser.newContext();
  await bctx.exposeFunction('__get', (k) => { if (global.__invalid) throw new Error('Extension context invalidated.'); const o = {}; if (k === null) store.forEach((v, x) => { o[x] = JSON.parse(v); }); else [].concat(k).forEach((x) => { if (store.has(x)) o[x] = JSON.parse(store.get(x)); }); return o; });
  await bctx.exposeFunction('__set', (o) => { if (global.__invalid) throw new Error('Extension context invalidated.'); Object.entries(o).forEach(([k, v]) => store.set(k, JSON.stringify(v))); });
  const SCRIPTS = ['lib/shared.js', 'lib/store.js', 'lib/detailui.js', 'content/scrape.js', 'content/content.js'].map((f) => fs.readFileSync(path.join(repo, f), 'utf8'));
  const mock = `window.chrome = { runtime: { id: 'abc', onMessage: { addListener() {} } }, storage: { local: {
    get: (k, cb) => { if (window.__invalid) throw new Error('Extension context invalidated.'); window.__get(k).then(cb); },
    set: (o, cb) => { if (window.__invalid) throw new Error('Extension context invalidated.'); window.__set(o).then(() => cb && cb()); },
    remove: (k, cb) => cb && cb(), clear: (cb) => cb && cb() }, onChanged: { addListener() {} } } };`;   // real Chrome throws synchronously once invalidated
  const load = async (pre) => {
    const p = await bctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'warning') errs.push(m.text()); });
    await p.setContent(fx('game2.html'));
    if (pre) await p.evaluate(pre);
    await p.evaluate(mock); for (const sc of SCRIPTS) await p.evaluate(sc);
    await p.waitForTimeout(900);
    return { p, errs };
  };

  // 1. a fresh copy removes a stale panel left by an orphaned one
  let t = await load(`(() => { const h = document.createElement('div'); h.id = 'rdt-host'; h.attachShadow({ mode: 'open' }).innerHTML = '<p>stale panel from an old copy</p>'; document.body.appendChild(h); })()`);
  const hosts = await t.p.evaluate(() => [...document.querySelectorAll('#rdt-host')].map((h) => h.shadowRoot.textContent));
  ok(hosts.length === 1 && !/stale panel/.test(hosts[0]), `a fresh copy removes a stale panel: exactly one panel remains (hosts: ${hosts.length})`);
  await t.p.close();

  // 2. the extension is invalidated in the middle of a read (runtime.id still set, storage throws)
  t = await load();
  await t.p.evaluate(() => { window.__invalid = true; });          // runtime.id is still set: only the storage calls fail, mid-read
  await t.p.evaluate(() => { const a = document.querySelector('[role=tabpanel] li a'); a.textContent = a.textContent + 'x'; });   // a visible change => a new read
  await t.p.waitForTimeout(1200);
  const hud = await t.p.evaluate(() => { const h = document.querySelector('#rdt-host'); return h ? h.shadowRoot.textContent : ''; });
  console.log('   panel text:', JSON.stringify(hud.replace(/\s+/g, ' ').slice(-110)), '| warnings:', JSON.stringify(t.errs));
  ok(/was updated/.test(hud) && !/ERROR/.test(hud) && !t.errs.some((e) => /invalidated|Rivals Rematch/i.test(e)), `an invalidation mid-read becomes the reload notice, not an ERROR, and logs nothing (${t.errs.length} warnings)`);
  await t.p.close();
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
