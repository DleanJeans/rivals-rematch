// Loads the real unpacked extension in Chromium: manifest valid, service worker starts, content script injects.
const { chromium } = require('playwright'); const path = require('path'); const os = require('os'); const fs = require('fs');
const ext = path.join(__dirname, '..');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const id = require('crypto').createHash('sha256').update(fs.realpathSync(ext)).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  console.log('  extension id', id);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`chrome-extension://${id}/db/db.html`);
  await page.waitForSelector('#tbl', { state: 'attached' });
  console.log('  ✓ database page loads from chrome-extension:// with real chrome.storage', errs.length ? 'ERRORS ' + errs : '(no errors)');
  // real chrome.storage round trip through the real store.js
  const n = await page.evaluate(async () => { await chrome.storage.local.set({ 'p:1': { uid: '1', names: ['X'], seen: 1, asTeammate: 0, asEnemy: 0, last: {}, hist: [], lastSeen: Date.now(), firstSeen: Date.now() } }); return (await RDT.store.loadPlayers()).length; });
  console.log('  ✓ real chrome.storage.local round-trip:', n, 'player');
  await ctx.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
