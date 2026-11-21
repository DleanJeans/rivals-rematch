// "Save to GitHub": the real database page against a simulated GitHub contents API.
const { chromium } = require('playwright');
const path = require('path');
const root = path.join(__dirname, '..');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

const TOKEN = 'github_pat_TESTTOKEN_1234567890abcdef';
const now = Date.now();
const player = (uid, name, extra) => Object.assign({ uid, names: [name], icon: '1', firstSeen: now, lastSeen: now, seen: 1, asTeammate: 0, asEnemy: 1, partied: 0,
  tag: '', note: '', hist: [], last: { rankLabel: 'GM1', rs: 40, abs: 4740, w: 10, l: 8, t: now, season: 11 } }, extra || {});
const SEED = { 'p:1': player('1', 'Alphá 猫'), 'p:2': player('2', 'Beta') };

// ---- a tiny GitHub: GET/PUT /repos/DleanJeans/rivals-rematch/contents/data/players.json
const gh = { file: null, n: 0, calls: [], mode: null, raceOnce: false, big: false };
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const unb64 = (t) => Buffer.from(t, 'base64').toString('utf8');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-github-api-version,accept', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
const reply = (route, status, body, extra) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, CORS, extra || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
async function githubRoute(route) {
  const req = route.request(), url = new URL(req.url()), h = req.headers();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  gh.calls.push({ method: req.method(), auth: h.authorization, accept: h.accept, repo: url.pathname.split('/').slice(2, 4).join('/') });
  if (gh.mode === '401') return reply(route, 401, { message: 'Bad credentials' });
  if (gh.mode === '403') return reply(route, 403, { message: 'Resource not accessible by personal access token' });
  if (h.authorization !== 'Bearer ' + TOKEN) return reply(route, 401, { message: 'Bad credentials' });
  if (!url.pathname.startsWith('/repos/DleanJeans/rivals-rematch/contents/data/players.json')) return reply(route, 404, { message: 'Not Found' });
  if (req.method() === 'GET') {
    if (!gh.file) return reply(route, 404, { message: 'Not Found' });
    if ((h.accept || '').includes('raw')) return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/plain' }, CORS), body: gh.file.text });
    return reply(route, 200, gh.big ? { sha: gh.file.sha, encoding: 'none', content: '' } : { sha: gh.file.sha, encoding: 'base64', content: b64(gh.file.text) });
  }
  const body = JSON.parse(req.postData());
  if (gh.raceOnce) { gh.raceOnce = false; gh.file.sha = 'raced' + (++gh.n); return reply(route, 409, { message: 'does not match' }); }
  if (gh.file && !body.sha) return reply(route, 422, { message: 'sha wasn\'t supplied' });
  if (gh.file && body.sha !== gh.file.sha) return reply(route, 409, { message: 'does not match' });
  const created = !gh.file;
  gh.file = { text: unb64(body.content), sha: 'sha' + (++gh.n), message: body.message, branch: body.branch };
  return reply(route, created ? 201 : 200, { content: { sha: gh.file.sha }, commit: { sha: 'c0ffee1234567890' } });
}
const putCount = () => gh.calls.filter((c) => c.method === 'PUT').length;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('https://api.github.com/**', githubRoute);
  await page.addInitScript(`(() => {
    const mk = () => { const st = {}; return { _st: st,
      get(k, cb) { const o = {}; const keys = k === null ? Object.keys(st) : [].concat(k); keys.forEach((x) => { if (x in st) o[x] = JSON.parse(JSON.stringify(st[x])); }); if (cb) { cb(o); return; } return Promise.resolve(o); },
      set(o, cb) { Object.entries(o).forEach(([a, b]) => { st[a] = JSON.parse(JSON.stringify(b)); }); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb) { [].concat(k).forEach((x) => { delete st[x]; }); if (cb) { cb(); return; } return Promise.resolve(); },
      clear(cb) { for (const x in st) delete st[x]; if (cb) { cb(); return; } return Promise.resolve(); } }; };
    const local = mk(), session = mk(); Object.assign(local._st, ${JSON.stringify(SEED)});
    window.chrome = { storage: { local, session, onChanged: { addListener() {} } }, runtime: { getURL: (p) => 'chrome-extension://x/' + p, getManifest: () => ({ version: 'test' }) } };
    window.__local = local._st; window.__session = session._st;
  })();`);
  await page.goto('file://' + path.join(root, 'db/db.html'));
  await page.waitForSelector('#tbl tbody tr');
  const status = () => page.textContent('#fileStatus');
  const run = async (sel) => {                       // click, wait until the sync is over, return the status line
    await page.click(sel || '#ghBtn');
    await page.waitForFunction(() => !document.getElementById('ghBtn').disabled && !/Talking to GitHub/.test(document.getElementById('fileStatus').textContent), null, { timeout: 10000 });
    await page.waitForTimeout(150);
    return status();
  };
  const settings = async () => { await page.click('[data-tab=settings]'); };
  const enter = async (token, repo, branch) => {
    await settings();
    if (repo != null) { await page.fill('#sRepo', repo); await page.dispatchEvent('#sRepo', 'change'); }
    if (branch != null) { await page.fill('#sBranch', branch); await page.dispatchEvent('#sBranch', 'change'); }
    if (token) { await page.fill('#sToken', token); await page.dispatchEvent('#sToken', 'change'); }
    await page.waitForTimeout(150);
  };

  console.log('\n[1] No token yet');
  let s = await run('#ghBtn');
  ok(/Paste a GitHub token first/.test(s) && gh.calls.length === 0, `asks for a token and sends nothing: "${s}"`);
  ok(await page.isVisible('#sToken'), 'jumps to the settings field for it');

  console.log('\n[2] Token handling');
  await enter(TOKEN, 'DleanJeans/rivals-rematch', 'main');
  ok(/session/.test(await page.textContent('#ghInfo')), `token kept for this browser session: "${await page.textContent('#ghInfo')}"`);
  ok((await page.inputValue('#sToken')) === '', 'the field is emptied: the token never stays on screen');
  ok(await page.evaluate((t) => !('rdt_ghtoken' in window.__local) && window.__session.rdt_ghtoken === t, TOKEN), 'stored in session storage only (not persisted) by default');

  console.log('\n[3] First push: the repo has no data file yet');
  s = await run('#ghSaveBtn');
  ok(/Created data\/players\.json in DleanJeans\/rivals-rematch@main/.test(s) && /commit c0ffee1/.test(s), `created: "${s}"`);
  let remote = JSON.parse(gh.file.text);
  ok(remote.version === 1 && remote.players.length === 2 && remote.players[0].names[0] === 'Alphá 猫', 'file has both players; accents and Japanese survive the UTF-8 / base64 round trip');
  ok(gh.file.branch === 'main' && /Update players\.json \(2 players\)/.test(gh.file.message), `one commit, message "${gh.file.message}"`);
  ok(gh.calls.every((c) => c.auth === 'Bearer ' + TOKEN && c.repo === 'DleanJeans/rivals-rematch'), 'every request carried the token and targeted only the chosen repo');

  console.log('\n[4] Nothing changed: no commit');
  const puts = putCount();
  s = await run();
  ok(/Already up to date/.test(s) && putCount() === puts, `no needless commit: "${s}"`);

  console.log('\n[5] Local change is pushed');
  await page.evaluate(async () => { await RDT.store.updatePlayer('1', { note: 'friendly duelist' }); });
  s = await run();
  ok(/Pushed 2 players/.test(s) && JSON.parse(gh.file.text).players.find((p) => p.uid === '1').note === 'friendly duelist', `pushed with the right sha: "${s}"`);

  console.log('\n[6] Another machine added a player: merged, not overwritten');
  const rr = JSON.parse(gh.file.text);
  rr.players.push(player('3', 'Gamma', { lastSeen: now + 1000 }));
  gh.file = { text: JSON.stringify(rr, null, 1), sha: 'sha' + (++gh.n) };
  s = await run();
  ok(/merged 1 new player from the repo/.test(s), `pulled it in first: "${s}"`);
  ok(await page.evaluate(() => 'p:3' in window.__local), 'Gamma is now in the local database');
  const after = JSON.parse(gh.file.text);
  ok(after.players.length === 3 && after.players.find((p) => p.uid === '1').note === 'friendly duelist', 'the pushed file has all three players and still has the local note');
  await page.click('[data-tab=players]');
  ok((await page.$$eval('#tbl tbody tr td.nm a', (a) => a.map((x) => x.textContent))).includes('Gamma'), 'and the list shows it');

  console.log('\n[7] The file changes between reading and pushing (race)');
  await page.evaluate(async () => { await RDT.store.updatePlayer('2', { note: 'raced' }); });
  gh.raceOnce = true; const before = putCount();
  s = await run();
  ok(/Pushed|Pushed 3 players/.test(s) && putCount() === before + 2 && JSON.parse(gh.file.text).players.find((p) => p.uid === '2').note === 'raced', `409 handled by re-reading and retrying once: "${s}"`);

  console.log('\n[8] Files over 1 MB (GitHub omits the content in the JSON form)');
  gh.big = true; gh.calls.length = 0;
  await page.evaluate(async () => { await RDT.store.updatePlayer('2', { note: 'big file' }); });
  s = await run();
  ok(/Pushed/.test(s) && gh.calls.some((c) => (c.accept || '').includes('raw')) && JSON.parse(gh.file.text).players.find((p) => p.uid === '2').note === 'big file', `falls back to the raw download: "${s}"`);
  gh.big = false;

  console.log('\n[9] Errors are explained, never leak the token');
  const messages = [];
  gh.mode = '401'; messages.push(s = await run()); ok(/rejected the token/.test(s), `401 -> "${s}"`);
  gh.mode = '403'; messages.push(s = await run()); ok(/Contents: Read and write/.test(s), `403 -> "${s}"`);
  gh.mode = null;
  await enter(null, 'DleanJeans/not-a-repo'); messages.push(s = await run()); ok(/not found/.test(s) && /not-a-repo/.test(s), `wrong repo -> "${s}"`);
  await enter(null, 'foo'); messages.push(s = await run()); ok(/owner\/name/.test(s), `bad repo format -> "${s}"`);
  await enter(null, 'DleanJeans/rivals-rematch');
  await page.unroute('https://api.github.com/**'); await page.route('https://api.github.com/**', (r) => r.abort());
  messages.push(s = await run()); ok(/Could not reach GitHub/.test(s), `offline -> "${s}"`);
  await page.unroute('https://api.github.com/**'); await page.route('https://api.github.com/**', githubRoute);
  ok(messages.every((m) => !m.includes(TOKEN)), 'no message ever contains the token');

  console.log('\n[10] The token is not in the data');
  const exp = JSON.stringify(await page.evaluate(() => RDT.store.exportAll()));
  const snap = (await page.evaluate(() => RDT.store.snapshot())).text;
  const dom = await page.evaluate(() => document.documentElement.innerText + [...document.querySelectorAll('input')].map((i) => i.value).join(' '));
  ok(![exp, snap, gh.file.text, dom].some((t) => t.includes(TOKEN)), 'not in the export, the snapshot, the pushed file, or anywhere on the page');

  console.log('\n[11] Forget / remember');
  await settings(); await page.click('#ghForget'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => !('rdt_ghtoken' in window.__session) && !('rdt_ghtoken' in window.__local)), 'Forget token now removes it everywhere');
  s = await run(); ok(/Paste a GitHub token first/.test(s), 'and the next save asks for one again');
  await settings(); await page.check('#sRemember'); await page.dispatchEvent('#sRemember', 'change');
  await enter(TOKEN);
  ok(await page.evaluate((t) => window.__local.rdt_ghtoken === t && !('rdt_ghtoken' in window.__session), TOKEN), '"Remember" keeps it in persistent storage instead');
  s = await run(); ok(/Already up to date|Pushed/.test(s), `still works after remembering: "${s}"`);

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
