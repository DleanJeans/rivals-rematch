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
const H = (slug) => `<img alt="${slug}" src="https://rivalsdata.com/assets/heroes/${slug}.webp">`;
const PANEL = `<div class="panel"><div><span>Heroes</span>${[['peni-parker', 12, '67%'], ['groot', 3, '33%']].map(([s, g, w]) => `<div>${H(s)}<span>${s}</span><span>${g}</span><span>${w}</span></div>`).join('')}</div>
  <div><span>Proficiency</span>${[['peni-parker', 51], ['groot', 28]].map(([s, l]) => `<div>${H(s)}<i></i><span>Lv ${l}</span></div>`).join('')}</div>
  <div><span>Match History</span>${[['peni-parker', 'W', '+14'], ['groot', 'L', '-22']].map(([s, r, d]) => `<div>${H(s)}<b>${r}</b><span>${d}</span></div>`).join('')}</div></div>`;
const SIM = `<script>document.querySelectorAll('[role=tabpanel][aria-labelledby=live-game] li').forEach((li) => {
  const b = li.querySelector('button[aria-label^="Toggle details"]'); if (!b) return;
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-expanded') === 'true') { b.setAttribute('aria-expanded', 'false'); const d = li.querySelector('.panel'); if (d) d.remove(); }
    else { b.setAttribute('aria-expanded', 'true'); setTimeout(() => { const w = document.createElement('div'); w.innerHTML = ${JSON.stringify(PANEL)}; li.appendChild(w.firstElementChild); }, 200); }
  }); });</script>`;
// Tabs the extension opens itself start loading before a test framework could intercept them, so the fixtures are served by a
// real local HTTPS server and Chrome is told that rivalsdata.com lives there (host-resolver-rules + a self-signed certificate).
const https = require('https'); const { execFileSync } = require('child_process');
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certDir + '/k.pem', '-out', certDir + '/c.pem', '-days', '1', '-subj', '/CN=rivalsdata.com', '-addext', 'subjectAltName=DNS:rivalsdata.com'], { stdio: 'ignore' });
// Three kinds of player: Competitive (uid % 3 == 0, and you), Quick Play (== 1), offline (== 2)
const kind = (uid) => (uid === '520435205' || Number(uid) % 3 === 0 ? 'competitive' : Number(uid) % 3 === 1 ? 'quickplay' : 'offline');
const fx = (f) => fs.readFileSync(path.join(ext, 'tests/fixtures', f), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*stylesheet[^>]*>/g, '')
  .replace('</head>', '<style>' + fs.readFileSync(path.join(ext, 'tests/fixtures/site.css'), 'utf8') + '</style></head>').replace('</body>', SIM + '</body>');

(async () => {
  const server = https.createServer({ key: fs.readFileSync(certDir + '/k.pem'), cert: fs.readFileSync(certDir + '/c.pem') }, (req, res) => {
    const m = /^\/player\/(\d+)/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    const k = kind(m[1]);
    const body = k === 'quickplay' ? fx('ban_qp.html') : k === 'offline' ? fx('game2.html').replace('In game (Competitive)', 'Offline') : fx('game2.html');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
  });
  await new Promise((r) => server.listen(8443, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdt-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP rivalsdata.com 127.0.0.1:8443', '--ignore-certificate-errors', '--no-proxy-server'] });
  await ctx.route('https://cdn.rivalsdata.com/**', (r) => r.abort());
  const errs = []; ctx.on('weberror', (e) => errs.push(e.error().message));

  const site = await ctx.newPage();
  await site.goto('https://rivalsdata.com/player/520435205'); await site.waitForTimeout(1500);
  const chip = await site.evaluate(() => !!document.querySelector('#rdt-host'));
  ok(chip, 'real content script injected by Chrome and the HUD is on the page');

  const popup = await ctx.newPage(); popup.on('pageerror', (e) => { errs.push(e.message); });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('scan').disabled, null, { timeout: 5000 });
  ok(/Version 0\.18\.0/.test(await popup.textContent('#ver')), 'popup shows the installed version');
  ok(/Ready/.test(await popup.textContent('#where')), 'popup finds the rivalsdata tab and enables the button');
  ok(/12 players/.test(await popup.textContent('#counts')), `automatic save already stored the lobby: "${await popup.textContent('#counts')}"`);

  await popup.click('#scan'); await popup.waitForSelector('#result.show');
  const res = await popup.textContent('#result');
  ok(/Saved 12 players/.test(res) && /12 in the lobby/.test(res), `button reports the save straight away: "${res}"`);
  ok(/12 new players · 0 already known/.test(res), `first save: all 12 are new: "${res}"`);
  ok(await popup.isDisabled('#scan'), 'the button stays busy while it goes on to read hero details');
  await popup.waitForFunction(() => !document.getElementById('scan').disabled, null, { timeout: 40000 });
  const both = (await popup.textContent('#result')).replace(/\s+/g, ' ');
  ok(/Saved 12 players/.test(both) && /Hero details: read 11 of 11 players/.test(both), `the same message then adds the hero details (11 others, not you): "${both}"`);
  const stored = await popup.evaluate(async () => (await RDT.store.loadPlayers()).filter((p) => p.detail).length);
  ok(stored === 11, `hero details were actually stored for ${stored} players (all but you)`);
  ok((await site.evaluate(() => document.querySelectorAll('.panel').length)) === 0, 'rows were closed again afterwards');
  ok(/12 players · 1 lobbies/.test(await popup.textContent('#counts')), 'pressing again does not duplicate players or lobbies');

  // pressing the buttons again in the same match skips what was already read
  const idle = () => popup.waitForFunction(() => !document.getElementById('scan').disabled, null, { timeout: 40000 });
  const t0 = Date.now();
  await popup.click('#scan'); await idle();
  const again = (await popup.textContent('#result')).replace(/\s+/g, ' ');
  ok(/Saved 12 players/.test(again) && /Hero details: already saved for this match \(11 players\)/.test(again) && Date.now() - t0 < 4000, `"Read & save" again: saves, then skips the hero details already read (${Math.round((Date.now() - t0) / 100) / 10} s): "${again}"`);
  ok(/12 new players · 0 already known/.test(again), `saving the same lobby again still counts its players as new: "${again}"`);
  await popup.click('#details'); await idle();
  const only = (await popup.textContent('#result')).replace(/\s+/g, ' ');
  ok(/already saved for this match \(11 players\)/.test(only) && !/Saved 12/.test(only), `"Read hero details" alone also skips, and says how to force it: "${only}"`);
  await popup.click('#details', { modifiers: ['Shift'] }); await idle();
  const forced = (await popup.textContent('#result')).replace(/\s+/g, ' ');
  ok(/Hero details: read 11 of 11 players/.test(forced), `Shift-click reads everyone again: "${forced}"`);

  // injecting a second copy must be harmless (popup injects when the page predates the install)
  await popup.evaluate(async () => { const [t] = await chrome.tabs.query({ url: 'https://rivalsdata.com/*' });
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['lib/shared.js', 'lib/store.js', 'lib/detailui.js', 'content/scrape.js', 'content/content.js'] }); });
  await popup.click('#scan'); await popup.waitForFunction(() => !document.getElementById('scan').disabled, null, { timeout: 40000 });
  ok(await site.evaluate(() => document.querySelectorAll('#rdt-host').length) === 1, 'double injection leaves exactly one overlay');

  // open every player's profile: each tab checks itself, tabs whose player is not in a Competitive game close
  const created = []; ctx.on('page', (p) => created.push(p));
  await popup.click('#openall');
  await popup.waitForFunction(() => /Opened \d+ profile/.test(document.getElementById('result').textContent), null, { timeout: 15000 });
  ok(/Opened 11 profiles/.test(await popup.textContent('#result')) && /close themselves/.test(await popup.textContent('#result')), `the popup says so: "${(await popup.textContent('#result')).replace(/\s+/g, ' ')}"`);
  await site.waitForTimeout(11000);                                   // offline pages wait ~6 s for a status before they close
  const profiles = created.filter((p) => /\/player\/\d+/.test(p.url()));
  const uidOf = (p) => /\/player\/(\d+)/.exec(p.url())[1];
  const want = { competitive: [], quickplay: [], offline: [] }; profiles.forEach((p) => want[kind(uidOf(p))].push(p));
  ok(profiles.length === 11 && new Set(profiles.map(uidOf)).size === 11 && !profiles.some((p) => uidOf(p) === '520435205'), `11 profile tabs were opened, one per other player, not you (${want.competitive.length} Competitive, ${want.quickplay.length} Quick Play, ${want.offline.length} offline)`);
  ok(want.quickplay.length > 0 && want.offline.length > 0 && want.quickplay.concat(want.offline).every((p) => p.isClosed()), `every tab whose player is NOT in a Competitive game closed itself (${want.quickplay.length} Quick Play + ${want.offline.length} offline)`);
  ok(want.competitive.length > 0 && want.competitive.every((p) => !p.isClosed()), `every Competitive tab stayed open (${want.competitive.length})`);
  const live = await Promise.all(want.competitive.map((p) => p.evaluate(() => ({ sel: document.getElementById('live-game').getAttribute('aria-selected'), hud: !!document.querySelector('#rdt-host'), vis: document.visibilityState }))));
  ok(live.every((x) => x.sel === 'true' && x.hud), 'those tabs show their Live Game and the extension is running on them');
  const act = await popup.evaluate(async () => (await chrome.tabs.query({ url: 'https://rivalsdata.com/player/*' })).filter((t) => !/520435205/.test(t.url)).map((t) => t.active));
  ok(act.length === want.competitive.length && act.every((x) => x === false), `they opened in the background: Chrome reports none of the ${act.length} tabs as active, so the tab you are on keeps focus`);
  for (const p of want.competitive) await p.close();

  // Shift-click: open them plainly, nothing closes itself
  created.length = 0;
  await popup.click('#openall', { modifiers: ['Shift'] });
  await popup.waitForFunction(() => /Opened 11 profiles/.test(document.getElementById('result').textContent), null, { timeout: 15000 });
  await site.waitForTimeout(9000);
  const plain = created.filter((p) => /\/player\/\d+/.test(p.url()));
  ok(plain.length === 11 && plain.every((p) => !p.isClosed()) && !/close themselves/.test(await popup.textContent('#result')), `Shift-click opened 11 profiles and none closed (${plain.filter((p) => !p.isClosed()).length} still open)`);
  for (const p of plain) await p.close();

  // a tab without a live game
  await site.evaluate(() => document.querySelector('[role=tabpanel][aria-labelledby=live-game]').remove());
  await popup.click('#scan'); await popup.waitForFunction(() => !document.getElementById('scan').disabled, null, { timeout: 40000 });
  const nolive = await popup.textContent('#result');
  ok(/No Live Game found/.test(nolive) && !/Hero details/.test(nolive), 'clear message when the page has no Live Game, and no hero-details attempt');

  await popup.screenshot({ path: path.join(__dirname, 'out_popup.png') });
  await popup.click('#open'); await site.waitForTimeout(700);     // the popup closes itself, like a real one
  ok(ctx.pages().some((p) => p.url().endsWith('/db/db.html')), '"Open database" opens the database page');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close(); server.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
