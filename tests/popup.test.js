// Real extension in Chromium. rivalsdata.com is served from a fixture so Chrome injects the REAL content script,
// then the REAL popup page is driven: click "Read & save this lobby".
const { chromium } = require('playwright'); const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
// Run against a COPY of the extension without data/players.json, so the repo's real data never leaks into the test profile.
const repo = fs.realpathSync(path.join(__dirname, '..'));
const extDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-popup-')), 'ext');
fs.cpSync(repo, extDir, { recursive: true, filter: (f) => !['.git', 'node_modules'].some((x) => f.split(path.sep).includes(x)) && path.basename(f) !== 'players.json' });
const ext = fs.realpathSync(extDir);
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
// Unpacked extension id = first 32 hex chars of sha256(path), mapped 0-f -> a-p.
const extId = crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
const fx = (f) => fs.readFileSync(path.join(ext, 'tests/fixtures', f), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*stylesheet[^>]*>/g, '')
  .replace('</head>', '<style>' + fs.readFileSync(path.join(ext, 'tests/fixtures/site.css'), 'utf8') + '</style></head>');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await ctx.route('https://rivalsdata.com/**', (r) => r.request().url().includes('/player/') ? r.fulfill({ contentType: 'text/html', body: fx('game2.html') }) : r.fulfill({ status: 204, body: '' }));
  await ctx.route('https://cdn.rivalsdata.com/**', (r) => r.abort());
  const errs = []; ctx.on('weberror', (e) => errs.push(e.error().message));

  const site = await ctx.newPage();
  await site.goto('https://rivalsdata.com/player/520435205'); await site.waitForTimeout(1500);
  const chip = await site.evaluate(() => !!document.querySelector('#rdt-host'));
  ok(chip, 'real content script injected by Chrome and the HUD is on the page');

  const popup = await ctx.newPage(); popup.on('pageerror', (e) => { errs.push(e.message); });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('scan').disabled, null, { timeout: 5000 });
  ok(/Version 0\.3\.3/.test(await popup.textContent('#ver')), 'popup shows the installed version');
  ok(/Ready/.test(await popup.textContent('#where')), 'popup finds the rivalsdata tab and enables the button');
  ok(/12 players/.test(await popup.textContent('#counts')), `automatic save already stored the lobby: "${await popup.textContent('#counts')}"`);

  await popup.click('#scan'); await popup.waitForSelector('#result.show');
  const res = await popup.textContent('#result');
  ok(/Saved 12 players/.test(res) && /12 in the lobby/.test(res), `button reports the read: "${res}"`);
  ok(/12 players · 1 lobbies/.test(await popup.textContent('#counts')), 'pressing again does not duplicate players or lobbies');

  // injecting a second copy must be harmless (popup injects when the page predates the install)
  await popup.evaluate(async () => { const [t] = await chrome.tabs.query({ url: 'https://rivalsdata.com/*' });
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['lib/shared.js', 'lib/store.js', 'lib/detailui.js', 'content/scrape.js', 'content/content.js'] }); });
  await popup.click('#scan'); await popup.waitForTimeout(600);
  ok(await site.evaluate(() => document.querySelectorAll('#rdt-host').length) === 1, 'double injection leaves exactly one overlay');

  // a tab without a live game
  await site.evaluate(() => document.querySelector('[role=tabpanel][aria-labelledby=live-game]').remove());
  await popup.click('#scan'); await popup.waitForTimeout(600);
  ok(/No Live Game found/.test(await popup.textContent('#result')), 'clear message when the page has no Live Game');

  await popup.screenshot({ path: path.join(__dirname, 'out_popup.png') });
  await popup.click('#open'); await site.waitForTimeout(700);     // the popup closes itself, like a real one
  ok(ctx.pages().some((p) => p.url().endsWith('/db/db.html')), '"Open database" opens the database page');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
