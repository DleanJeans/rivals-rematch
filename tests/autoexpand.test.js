// Auto Expand in the real extension: the worker walks the saved players one by one, each profile tab reports back and is closed.
// rivalsdata.com is a local HTTPS fixture server (see popup.test.js).
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

  // the lobby page saves 12 players (you + 11 others)
  const site = await ctx.newPage();
  await site.goto('https://rivalsdata.com/player/520435205'); await site.waitForTimeout(2000);
  const popup = await ctx.newPage(); popup.on('pageerror', (e) => { errs.push(e.message); });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForFunction(() => /12 players/.test(document.getElementById('counts').textContent), null, { timeout: 8000 });
  await site.close();                                               // Auto Expand needs no rivalsdata tab open
  ok(/Start Auto Expand/.test(await popup.textContent('#autotoggle')) && (await popup.inputValue('#autodelay')) === '60', 'popup offers "Start Auto Expand" with a conservative 60 s delay');

  const opened = []; ctx.on('page', (p) => { if (/\/player\/\d+/.test(p.url()) || p.url() === 'about:blank') opened.push(p); });
  // fast mode is only for this test (the real minimum is 30 s)
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'rdt-auto-start', delaySec: 1, fast: true }));
  await popup.waitForFunction(() => /Stop Auto Expand/.test(document.getElementById('autotoggle').textContent), null, { timeout: 5000 });
  ok(true, 'the button turns into "Stop Auto Expand"');
  await popup.waitForFunction(() => /Checking /.test(document.getElementById('autostatus').textContent), null, { timeout: 8000 });
  ok(true, 'a status line shows which player is being checked');
  const st = () => popup.evaluate(() => new Promise((r) => chrome.storage.local.get('rdt_auto', (x) => r(x.rdt_auto))));
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < 150000) { s = await st(); if (s.stats.checked >= 11) break; await popup.waitForTimeout(1000); }
  s = await st();
  ok(s.stats.checked >= 11, `every saved player but you was checked (${s.stats.checked})`);
  ok(!(s.checked['520435205']), 'you are never checked');
  ok(s.stats.inGame === 4, `4 of them were in a Competitive game and their lobby was read (${s.stats.inGame})`);
  ok(s.stats.saved >= 4 * 12 && s.stats.newPlayers === 0, `each lobby read saved its players, none new since they were already known (${s.stats.saved} saved, ${s.stats.newPlayers} new)`);
  await popup.waitForTimeout(1500);
  const left = await popup.evaluate(async () => (await chrome.tabs.query({ url: 'https://rivalsdata.com/player/*' })).length);
  ok(left <= 1, `the profile tabs were closed again (${left} still open)`);
  ok(/checked · 4 in Competitive/.test(await popup.textContent('#autostatus')), `the popup shows the totals: "${(await popup.textContent('#autostatus')).replace(/\s+/g, ' ')}"`);

  await popup.click('#autotoggle'); await popup.waitForFunction(() => /Start Auto Expand/.test(document.getElementById('autotoggle').textContent), null, { timeout: 5000 });
  const before = (await st()).stats.checked; await popup.waitForTimeout(5000);
  ok((await st()).running === false && (await st()).stats.checked === before, 'Stop really stops: nothing more is checked');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close(); server.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗', e.message); process.exit(1); });
