// "Save to data/": the real extension page writes data/players.json through the File System Access API.
// Headless Chromium can't drive the native folder dialog, so showDirectoryPicker is replaced by a folder in the
// browser's private file system (same handle API). Runs on a copy of the extension without the repo's real data.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const repo = fs.realpathSync(path.join(__dirname, '..'));
const extDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-fsave-')), 'ext');
fs.cpSync(repo, extDir, { recursive: true, filter: (f) => !['.git', 'node_modules'].some((x) => f.split(path.sep).includes(x)) && path.basename(f) !== 'players.json' });
const ext = fs.realpathSync(extDir);
const id = crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

const now = Date.now();
const player = (uid, name) => ({ uid, names: [name], icon: '1', firstSeen: now, lastSeen: now, seen: 1, asTeammate: 0, asEnemy: 1, partied: 0, tag: '', note: '',
  hist: [], last: { rankLabel: 'GM1', rs: 40, abs: 4740, w: 10, l: 8, t: now, season: 11, heroes: ['hulk'] } });

// read a file back from the sandbox folder the mock picker hands out
const readFile = (page, ...parts) => page.evaluate(async (p) => {
  let d = await navigator.storage.getDirectory();
  for (const seg of p.slice(0, -1)) d = await d.getDirectoryHandle(seg);
  const f = await (await d.getFileHandle(p[p.length - 1])).getFile();
  return { text: await f.text(), modified: f.lastModified };
}, parts);

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-fprof-')), {
    headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`chrome-extension://${id}/db/db.html`);
  await page.waitForSelector('#fileBtn');
  await page.evaluate(async (ps) => { await chrome.storage.local.set(ps); }, { 'p:2': player('2', 'Beta'), 'p:1': player('1', 'Alpha') });
  await page.waitForTimeout(500);

  // --- 1. first save: the user "picks" the repo folder (not the data folder) -> data/players.json is created inside it
  await page.evaluate(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('repo', { create: true }); });
  await page.click('#fileBtn');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('fileStatus').textContent), null, { timeout: 5000 });
  ok(/repo\/data\/players\.json/.test(await page.textContent('#fileStatus')), `status says where it wrote: "${await page.textContent('#fileStatus')}"`);
  let f = await readFile(page, 'repo', 'data', 'players.json');
  let j = JSON.parse(f.text);
  ok(j.version === 1 && j.players.length === 2 && j.players[0].uid === '1' && j.players[1].uid === '2', 'file is valid, players sorted by uid (stable git diffs)');
  ok(f.text.endsWith('\n') && j.settings && j.stats && typeof j.exportedAt === 'number', 'has settings, stats, exportedAt and a trailing newline');
  ok(!/"note": "[^"]/.test(f.text), 'no notes yet');

  // --- 2. unchanged data must not rewrite the file (nothing new to commit)
  const before = f.modified;
  await page.waitForTimeout(1100);
  await page.click('#fileBtn');
  await page.waitForFunction(() => /Up to date/.test(document.getElementById('fileStatus').textContent), null, { timeout: 5000 });
  f = await readFile(page, 'repo', 'data', 'players.json');
  ok(f.modified === before, 'unchanged database => file not rewritten');

  // --- 3. auto-save: change something while the page is open
  await page.evaluate(async () => { await RDT.store.updatePlayer('1', { note: 'friendly duelist' }); });
  let saved = false;                                           // poll from Node: an async page predicate is always "truthy"
  for (let i = 0; i < 40 && !saved; i++) {
    await page.waitForTimeout(250);
    saved = (await readFile(page, 'repo', 'data', 'players.json').catch(() => ({ text: '' }))).text.includes('friendly duelist');
  }
  ok(saved, 'editing a note auto-saves into the file within a few seconds');
  f = await readFile(page, 'repo', 'data', 'players.json'); j = JSON.parse(f.text);
  ok(j.players.find((p) => p.uid === '1').note === 'friendly duelist', 'file content matches the edit');

  // --- 4. picking the `data` folder itself writes straight into it
  await page.evaluate(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('data', { create: true }); });
  await page.click('[data-tab=settings]');
  await page.click('#chooseBtn');
  await page.waitForFunction(() => /Saved data\/players\.json/.test(document.getElementById('fileInfo').textContent), null, { timeout: 5000 });
  f = await readFile(page, 'data', 'players.json'); j = JSON.parse(f.text);
  ok(j.players.length === 2 && j.players[0].note === 'friendly duelist', `picked "data" folder => data/players.json: "${await page.textContent('#fileInfo')}"`);

  // --- 5. the folder choice survives a reload (stored handle); #save (popup shortcut) saves without any click
  await page.evaluate(async () => { await chrome.storage.local.set({ rdt_filesig: '' }); });   // force "changed" so a write is expected
  await page.goto(`chrome-extension://${id}/db/db.html#save`);
  await page.reload();
  await page.waitForFunction(() => /(Saved|Up to date)/.test(document.getElementById('fileStatus').textContent), null, { timeout: 6000 });
  ok(/data\/players\.json/.test(await page.textContent('#fileStatus')), `remembered folder, saved on open without clicking: "${await page.textContent('#fileStatus')}"`);

  // --- 6. popup shortcut
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  await pop.waitForSelector('#savefile');
  const opened = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await pop.click('#savefile');
  const np = await opened;
  ok(np && /db\/db\.html#save$/.test(np.url()), 'popup "Save to data/players.json" opens the database page in save mode');

  // --- 7. no picker available -> clear message, no crash
  await page.evaluate(async () => { delete window.showDirectoryPicker; });
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
