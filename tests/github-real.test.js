// Save to GitHub in the REAL extension: real chrome.storage.session, real cross-origin fetch (host permission),
// real popup shortcut. GitHub itself is simulated (page-level routes); the repo's own data file is not used.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const repo = fs.realpathSync(path.join(__dirname, '..'));
const extDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-ghr-')), 'ext');
fs.cpSync(repo, extDir, { recursive: true, filter: (f) => !['.git', 'node_modules'].some((x) => f.split(path.sep).includes(x)) && path.basename(f) !== 'players.json' });
const ext = fs.realpathSync(extDir);
const id = crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
const TOKEN = 'github_pat_REALTEST_abcdef1234567890';
const now = Date.now();
const player = (uid, name) => ({ uid, names: [name], icon: '1', firstSeen: now, lastSeen: now, seen: 1, asTeammate: 0, asEnemy: 1, partied: 0, tag: '', note: '', hist: [],
  last: { rankLabel: 'GM1', rs: 40, abs: 4740, w: 10, l: 8, t: now, season: 11 } });

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-ghp-')), {
    headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const seen = [];
  let file = null;
  await ctx.route('https://api.github.com/**', async (route) => {
    const req = route.request(), h = req.headers();
    seen.push({ m: req.method(), auth: h.authorization });
    const hdr = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: Object.assign({}, hdr, { 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }) });
    if (h.authorization !== 'Bearer ' + TOKEN) return route.fulfill({ status: 401, headers: hdr, body: '{}' });
    if (req.method() === 'GET') return file ? route.fulfill({ status: 200, headers: hdr, body: JSON.stringify({ sha: 's1', encoding: 'base64', content: Buffer.from(file).toString('base64') }) }) : route.fulfill({ status: 404, headers: hdr, body: '{}' });
    const b = JSON.parse(req.postData()); file = Buffer.from(b.content, 'base64').toString('utf8');
    return route.fulfill({ status: 201, headers: hdr, body: JSON.stringify({ content: { sha: 's1' }, commit: { sha: 'abc1234def' } }) });
  });

  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`chrome-extension://${id}/db/db.html`);
  await page.waitForSelector('#ghBtn');
  await page.evaluate(async (ps) => { await chrome.storage.local.set(ps); }, { 'p:1': player('1', 'Alpha'), 'p:2': player('2', 'Beta') });
  await page.waitForTimeout(400);

  await page.click('[data-tab=settings]');
  await page.fill('#sToken', TOKEN); await page.dispatchEvent('#sToken', 'change');
  await page.waitForTimeout(300);
  const where = await page.evaluate(async () => ({ session: !!(await chrome.storage.session.get('rdt_ghtoken')).rdt_ghtoken, local: !!(await chrome.storage.local.get('rdt_ghtoken')).rdt_ghtoken }));
  ok(where.session && !where.local, 'real chrome.storage.session holds the token (and chrome.storage.local does not)');

  await page.click('#ghSaveBtn');
  await page.waitForFunction(() => /Created|Pushed|Could not|rejected|not found/.test(document.getElementById('fileStatus').textContent), null, { timeout: 10000 });
  const st = await page.textContent('#fileStatus');
  ok(/Created data\/players\.json in DleanJeans\/rivals-rematch@main/.test(st), `real extension pushed through its own fetch: "${st}"`);
  ok(file && JSON.parse(file).players.length === 2, 'the file that reached "GitHub" is the database (2 players)');
  ok(seen.length > 0 && seen.filter((s) => s.m !== 'OPTIONS').every((s) => s.auth === 'Bearer ' + TOKEN), 'requests carried the token');
  ok(!file.includes(TOKEN) && !(await page.evaluate(() => document.documentElement.innerText)).includes(TOKEN), 'the token is not in the pushed file or on the page');

  // popup shortcut opens the database page in GitHub mode
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  await pop.waitForSelector('#savegh');
  const opened = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await pop.click('#savegh');
  const np = await opened;
  ok(np && /db\/db\.html#github$/.test(np.url()), 'popup "Save to GitHub" opens the database page and starts the sync');
  if (np) {
    await np.waitForFunction(() => /Already up to date|Pushed|Created|Paste a GitHub token/.test(document.getElementById('fileStatus').textContent), null, { timeout: 10000 });
    const t2 = await np.textContent('#fileStatus');
    ok(/Already up to date|Pushed|Created/.test(t2) || /Paste a GitHub token/.test(t2), `it ran on open: "${t2}"`);
  }

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
