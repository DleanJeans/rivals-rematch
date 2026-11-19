// "Gaming-cafe" scenario: fresh browser profile + repo that ships data/players.json => data is there at once.
const { chromium } = require('playwright'); const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const src = fs.realpathSync(path.join(__dirname, '..'));
const id = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
const now = Date.now();
const pl = (uid, name, tag) => ({ uid, names: [name], icon: '1', firstSeen: now, lastSeen: now, seen: 3, asTeammate: 1, asEnemy: 2, partied: 0, tag: tag || '', note: '', starred: uid === '2', hist: [],
  last: { rankLabel: 'GM2', rs: 40, abs: 4640, w: 10, l: 8, t: now, season: 11 } });
(async () => {
  // a copy of the extension "as downloaded from the repo", with data (temp dirs are left for the OS to clean up)
  const ext = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-ext-')), 'rivals-rematch');
  fs.cpSync(src, ext, { recursive: true, filter: (f) => !/[\\/](\.git|tests|node_modules)([\\/]|$)/.test(f) });
  fs.writeFileSync(path.join(ext, 'data/players.json'), JSON.stringify({ version: 1, exportedAt: 111, players: [pl('1', 'SeedOne', 'avoid'), pl('2', 'SeedTwo')], games: [],
    stats: { checked: 9, correct: 8, suffixChecked: 0, suffixOk: 0, iconChecked: 0, iconSame: 0 }, settings: { selfUid: '777', overlay: true, minShow: 0.6, useSuffix: true, useIcons: true } }));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-prof-'));
  const launch = () => chromium.launchPersistentContext(profile, { headless: false, acceptDownloads: true,
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const EID = id(fs.realpathSync(ext));

  let ctx = await launch(); const errs = [];
  let p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`chrome-extension://${EID}/db/db.html`); await p.waitForSelector('#tbl tbody tr', { timeout: 6000 });
  const names = await p.$$eval('#tbl tbody tr td.nm a', (a) => a.map((x) => x.textContent));
  ok(names.length === 2 && names.includes('SeedOne') && names.includes('SeedTwo'), `fresh profile opens with the repo's data already loaded: ${JSON.stringify(names)}`);
  ok(names[0] === 'SeedTwo', 'starred player from the file comes first');
  ok((await p.inputValue('#tbl tbody tr:nth-child(2) td.tag input')) === 'avoid', 'tags/notes come through');
  await p.click('[data-tab=settings]');
  ok((await p.inputValue('#sSelf')) === '777' && (await p.inputValue('#sMin')) === '60', 'settings restored on a fresh profile');
  ok((await p.textContent('#accuracy')).includes('8 of 9'), 'accuracy track record restored');

  await p.reload(); await p.waitForSelector('#tbl tbody tr');
  ok((await p.$$('#tbl tbody tr')).length === 2, 'reloading does not duplicate (seed applied once)');

  // user keeps playing: edit a note, restart the browser -> own changes survive, seed not re-applied over them
  await p.fill('#tbl tbody tr:nth-child(2) td:nth-last-child(2) input', 'my note');
  await p.dispatchEvent('#tbl tbody tr:nth-child(2) td:nth-last-child(2) input', 'change'); await p.waitForTimeout(200);
  await ctx.close(); ctx = await launch();
  p = await ctx.newPage(); await p.goto(`chrome-extension://${EID}/db/db.html`); await p.waitForSelector('#tbl tbody tr');
  ok((await p.$$eval('#tbl tbody tr td:nth-last-child(2) input', (i) => i.map((x) => x.value))).includes('my note'), 'edits made after loading the seed survive a browser restart');

  // Export button really downloads players.json
  const dl = p.waitForEvent('download'); await p.click('#exportBtn'); const d = await dl;
  const j = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
  ok(d.suggestedFilename() === 'players.json' && j.players.length === 2, `Export downloads "${d.suggestedFilename()}" with ${j.players.length} players (ready to drop into data/)`);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
