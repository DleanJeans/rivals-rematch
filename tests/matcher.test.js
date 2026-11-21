const R = require('../lib/shared.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const P1 = R.parseRank('P1', 'platinum'), P3 = R.parseRank('P3', 'platinum'), D3 = R.parseRank('D3', 'diamond');
const cand = (uid, name, rk, rs, extra) => Object.assign({ uid, names: [name], abs: R.absScore(rk, rs), rankIdx: R.rankIdx(rk), season: 11, w: null, l: null, icon: null, heroes: null }, extra);
const row = (rk, extra) => Object.assign({ rankIdx: R.rankIdx(rk), abs: null, w: null, l: null, season: 11, icon: null, suffix: null, heroes: null }, extra);

console.log('\nQuick-Play style row: rank tier + avatar only (no RS, no W/L). The "*****7" is a match slot number, NOT part of the name.');
let m = R.matchLobby([row(P1, { icon: '31053209' })], [
  cand('a', 'Foo', P1, 40, { icon: '31053209' }),
  cand('b', 'Bar', P1, 40, { icon: '31000001' }),
  cand('c', 'Baz', P3, 40, { icon: '31053209' }),
  cand('d', 'Qux', P1, 60, { icon: '31000002' })], { iconFreq: { 31053209: 0.02 } });
ok(m[0].uid === 'a' && m[0].p > 0.5, `picks the one with same rank + rare avatar (got ${m[0].uid} ${(m[0].p * 100).toFixed(0)}%)`);
m = R.matchLobby([row(P1, { icon: '31053209' })], [cand('c', 'Baz', P3, 40, { icon: '31053209' })]);
ok(m[0].uid === null, 'same avatar but two divisions away => not recognised');
m = R.matchLobby([row(P1, {})], [cand('b', 'Bar', P1, 40)]);
ok(m[0].uid === null || m[0].p < 0.9, `rank alone is never a confident match (${m[0].uid ? (m[0].p * 100).toFixed(0) + '%' : 'no match'})`);
ok(!('suffix' in R.DEFAULTS) && R.pairCost(row(P1, { suffix: '7' }), cand('b', 'Bar9', P1, 40), Object.assign({}, R.DEFAULTS)) === R.pairCost(row(P1, {}), cand('b', 'Bar9', P1, 40), Object.assign({}, R.DEFAULTS)),
  'a "name ends in 7" hint no longer influences anything (names are NOT matched on)');

console.log('\nHard rules');
m = R.matchLobby([row(P1, { abs: R.absScore(P1, 40), w: 5, l: 5 })], [cand('a', 'A', P1, 40, { w: 9, l: 3 })]);
ok(m[0].uid === null, 'W/L can never decrease => rejected');
m = R.matchLobby([row(P1, { abs: R.absScore(P1, 40), w: 5, l: 5, season: 12 })], [cand('a', 'A', P1, 40, { w: 5, l: 5 })]);
ok(m[0].uid === null, 'different season => rejected');

console.log('\nOne person cannot be two rows');
m = R.matchLobby([row(D3, { abs: R.absScore(D3, 35), w: 34, l: 7 }), row(D3, { abs: R.absScore(D3, 35), w: 34, l: 7 })],
  [cand('a', 'A', D3, 35, { w: 33, l: 7 })]);
ok(m.filter((x) => x.uid === 'a').length === 1, 'only one of two identical rows gets the candidate');

console.log('\nTop-hero overlap helps when heroes are visible');
m = R.matchLobby([row(P3, { heroes: ['hulk', 'thor', 'venom', 'groot'], abs: R.absScore(P3, 50) })], [
  cand('a', 'A', P3, 50, { heroes: ['hulk', 'thor', 'venom', 'groot'] }),
  cand('b', 'B', P3, 50, { heroes: ['luna-snow', 'mantis', 'rocket-raccoon', 'jeff-the-land-shark'] })]);
ok(m[0].uid === 'a' && m[0].alts[0].p > m[0].alts[1].p * 5, 'same heroes strongly preferred over different heroes');

console.log('\nRS drift model (your real observations: net-win-based change)');
const GM1 = R.parseRank('GM1', 'grandmaster');
m = R.matchLobby([row(GM1, { abs: R.absScore(GM1, 70), w: 6, l: 3 })], [cand('inf', 'PlayerA.', GM1, 70, { w: 4, l: 1 })]);
const bare = m[0].p;
ok(m[0].uid === 'inf' && bare > 0.6 && bare < 0.85, `RS+W/L alone: recognised but only moderately sure, amber (${(bare * 100).toFixed(0)}%)`);
const H = ['emma-frost', 'magneto', 'devil-dinosaur', 'peni-parker'];
m = R.matchLobby([row(GM1, { abs: R.absScore(GM1, 70), w: 6, l: 3, icon: '30000283', heroes: H })], [cand('inf', 'Infexious.', GM1, 70, { w: 4, l: 1, icon: '30000283', heroes: H })], { iconFreq: { 30000283: 0.05 } });
ok(m[0].uid === 'inf' && m[0].p > 0.9, `...plus a visible avatar and top heroes: confident, green (${(m[0].p * 100).toFixed(0)}%)`);
m = R.matchLobby([row(GM1, { abs: R.absScore(GM1, 70), w: 6, l: 3 })], [cand('x', 'Other', GM1, 20, { w: 4, l: 1 })]);
ok(m[0].uid === null, 'same W/L change but +50 RS with no net wins => rejected');

console.log('\nAvatars: common vs rare, and players who swap');
const base = { abs: R.absScore(GM1, 70), w: 6, l: 3 };
const same = (icon, freq) => R.matchLobby([row(GM1, Object.assign({ icon }, base))], [cand('inf', 'A', GM1, 70, { w: 4, l: 1, icon })], { iconFreq: freq })[0].p;
const rare = same('rare', { rare: 0.01 }), common = same('common', { common: 0.4 });
ok(rare > common + 0.1, `same RARE avatar is stronger evidence than same COMMON default avatar (${(rare * 100).toFixed(0)}% vs ${(common * 100).toFixed(0)}%)`);
const swapped = R.matchLobby([row(GM1, Object.assign({ icon: 'new', heroes: ['hulk', 'thor', 'venom', 'groot'] }, base))], [cand('inf', 'Infexious.', GM1, 70, { w: 4, l: 1, icon: 'old', heroes: ['hulk', 'thor', 'venom', 'groot'] })])[0];
ok(swapped.uid === 'inf' && swapped.p > 0.5, `avatar swapped since last game still recognised via stats + heroes (${(swapped.p * 100).toFixed(0)}%)`);
const sw = (k) => R.matchLobby([row(GM1, Object.assign({ icon: 'new' }, base))], [cand('inf', 'A', GM1, 70, { w: 4, l: 1, icon: 'old' })], { iconSwap: k })[0].p;
ok(sw(0.8) > sw(0.1), 'learned swap rate matters: frequent swappers are penalised less for a changed avatar');
const pick = R.matchLobby([row(GM1, Object.assign({ icon: 'zzz' }, base))], [
  cand('x', 'X', GM1, 70, { w: 4, l: 1, icon: 'old' }), cand('y', 'Y', GM1, -60, { w: 4, l: 1, icon: 'zzz' })], { iconFreq: { zzz: 0.01 } })[0];
ok(pick.uid !== 'y', 'a matching avatar cannot rescue implausible stats (RS +130 with no net wins)');

console.log('\nRS bounds (win <= +20, loss >= -25 at GM; RS shows -20..99 per division)');
const one = (rsNow, w, l, was) => R.matchLobby([row(GM1, { abs: R.absScore(GM1, rsNow), w, l })], [cand('p', 'P', GM1, was, { w: 14, l: 6 })])[0];
ok(one(57, 15, 6, 37).p > 0.5, `your DleanJeans: 14-6 @37 -> 15-6 @57 (+20 for a win) accepted (${(one(57, 15, 6, 37).p * 100).toFixed(0)}%)`);
ok(one(75, 15, 6, 37).uid === null, 'one win cannot add +38 RS => rejected');
ok(one(40, 14, 7, 55).p > 0.5 && one(10, 14, 7, 55).uid === null, 'one loss: -15 fine, -45 far exceeds the -25 cap => rejected');
ok(one(60, 14, 7, 37).uid === null, 'a LOSS cannot raise RS => rejected');

console.log('\nRank-only row: RS is only known to be in -20..99 of that division');
const win = (candRank, candRs, extra) => R.matchLobby([row(GM1, {})], [cand('c', 'C', candRank, candRs, extra)])[0];
const GM2 = R.parseRank('GM2', 'grandmaster'), GM3 = R.parseRank('GM3', 'grandmaster');
ok(win(GM1, 50).p > win(GM3, 50).p && win(GM3, 50).uid === null, 'GM1 row: a GM1 player fits, a GM3 player (200 RS below) does not');
ok(win(GM2, 85, { w: 5, l: 5 }) && R.matchLobby([row(GM1, {})], [cand('c', 'C', GM2, 85)])[0].p > 0.3, 'GM2 85 RS can be promoted into GM1 (within a game or two)');
ok(R.matchLobby([row(GM1, { w: 6, l: 5 })], [cand('c', 'C', GM2, 85, { w: 5, l: 5 })])[0].uid === 'c', 'promotion GM2 85 -> GM1 after exactly 1 win accepted');
ok(R.matchLobby([row(GM1, { w: 5, l: 6 })], [cand('c', 'C', GM2, 85, { w: 5, l: 5 })])[0].uid === null, 'but after a LOSS it cannot have been promoted => rejected');

console.log('\nQuick Play lobbies (two rank columns: ranked + QP)');
const S3 = R.parseRank('S3', 'silver');
const qpCand = cand('q', 'Foo7', D3, 35, { qp: { abs: R.absScore(S3, 40), rankIdx: R.rankIdx(S3) } });
const hidden = (qpLobby) => R.matchLobby([row(S3, { icon: 'av', qpLobby })], [Object.assign({}, qpCand, { icon: 'av' })], { iconFreq: { av: 0.02 } })[0];
ok(hidden(false).uid === null, 'S3 hidden row does NOT match a D3-ranked player when the column is ranked');
ok(hidden(true).uid === 'q', 'in a QP lobby the unlabelled S3 may be the QP rank => matches via the stored QP rank');
ok(R.matchLobby([row(D3, { icon: 'av', qpLobby: true })], [Object.assign({}, qpCand, { icon: 'av' })], { iconFreq: { av: 0.02 } })[0].p > hidden(true).p, 'but the ranked-column reading is preferred when it fits');
ok(R.matchLobby([row(null === 0 ? D3 : D3, { qpLobby: true })], [cand('z', 'Z', D3, 35)])[0].uid !== undefined, 'players with no stored QP rank are unaffected');
const noRank = R.matchLobby([{ rankIdx: null, abs: null, w: null, l: null, season: 11, icon: null, heroes: null }], [qpCand])[0];
ok(noRank.uid === null || noRank.uid === 'q', 'a row with NO readable rank does not crash the matcher');

console.log('\nRank range: only try to recognise players up to N ranks below you');
const lab = (self, n) => R.rankLabelOf(R.minRankIdx(R.rankIdx(R.parseRank(self)), n));
ok(lab('GM1', 3) === 'D1', 'GM1 with a range of 3 -> minimum D1 (as requested)');
ok(lab('GM3', 3) === 'D3', 'GM3 -> D3: it follows your rank when you drop');
ok(lab('C3', 3) === 'GM3', 'Celestial 3 -> GM3 (GM1, GM2, GM3 are the 3 ranks below it): and it follows you when you climb');
ok(lab('GM1', 0) === 'GM1' && lab('B3', 3) === 'B3', 'range 0 = your own division only; never goes below Bronze 3');
ok(R.minRankIdx(null, 3) === null && R.minRankIdx(17, null) === null, 'unknown own rank => no limit (nothing is wrongly skipped)');
const idxOf = (l) => R.rankIdx(R.parseRank(l));
ok(idxOf('D1') >= R.minRankIdx(idxOf('GM1'), 3) && idxOf('D2') < R.minRankIdx(idxOf('GM1'), 3) && idxOf('P3') < R.minRankIdx(idxOf('GM1'), 3), 'D1 is in range; D2, Platinum and below are out');
ok(['B3', 'B1', 'S2', 'G3', 'P1', 'P3', 'D3', 'D2'].every((l) => idxOf(l) < R.minRankIdx(idxOf('GM1'), 3)), 'every rank below D1 is out');
ok(['D1', 'GM3', 'GM2', 'GM1', 'C3', 'E1'].every((l) => idxOf(l) >= R.minRankIdx(idxOf('GM1'), 3)), 'D1 and everything above it is in');

console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
