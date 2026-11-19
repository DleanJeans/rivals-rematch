const R = require('../lib/shared.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const P1 = R.parseRank('P1', 'platinum'), P3 = R.parseRank('P3', 'platinum'), D3 = R.parseRank('D3', 'diamond');
const cand = (uid, name, rk, rs, extra) => Object.assign({ uid, names: [name], abs: R.absScore(rk, rs), season: 11, w: null, l: null, icon: null, heroes: null }, extra);
const row = (rk, extra) => Object.assign({ rankIdx: R.rankIdx(rk), abs: null, w: null, l: null, season: 11, icon: null, suffix: null, heroes: null }, extra);

console.log('\nQuick-Play style row: rank tier + avatar + name suffix only (no RS, no W/L)');
let m = R.matchLobby([row(P1, { icon: '31053209', suffix: '7' })], [
  cand('a', 'Foo7', P1, 40, { icon: '31053209' }),
  cand('b', 'Bar9', P1, 40, { icon: '31053209' }),
  cand('c', 'Baz7', P3, 40, { icon: '31053209' }),
  cand('d', 'Qux7', P1, 60, { icon: '31000000' })]);
ok(m[0].uid === 'a' && m[0].p > 0.5, `picks the one with same rank + icon + suffix (got ${m[0].uid} ${(m[0].p * 100).toFixed(0)}%)`);

console.log('\nSame rank only, nothing else matches');
m = R.matchLobby([row(P1, { suffix: '7' })], [cand('b', 'Bar9', P1, 40)]);
ok(m[0].uid === null, 'suffix mismatch => not recognised (names do not end in 7)');
m = R.matchLobby([row(P1, { suffix: '7' })], [cand('x', 'Old', P1, 40, { names: ['Old', 'NewName7'] })]);
ok(m[0].uid === null || m[0].uid === 'x', 'name history is consulted for suffix');
m = R.matchLobby([row(P1, { suffix: '7' })], [{ uid: 'x', names: ['Old', 'Prev7'], abs: R.absScore(P1, 40), season: 11 }]);
ok(m[0].uid === 'x', 'a previous name ending in the suffix still matches');

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
m = R.matchLobby([row(GM1, { abs: R.absScore(GM1, 70), w: 6, l: 3, suffix: '.', icon: '30000283' })], [cand('inf', 'PlayerA.', GM1, 70, { w: 4, l: 1, icon: '30000283' })]);
ok(m[0].uid === 'inf' && m[0].p > 0.9, `...plus visible name suffix + avatar: confident, green (${(m[0].p * 100).toFixed(0)}%)`);
m = R.matchLobby([row(GM1, { abs: R.absScore(GM1, 70), w: 6, l: 3 })], [cand('x', 'Other', GM1, 20, { w: 4, l: 1 })]);
ok(m[0].uid === null, 'same W/L change but +50 RS with no net wins => rejected');

console.log('\nAvatars: common vs rare, and players who swap');
const base = { abs: R.absScore(GM1, 70), w: 6, l: 3 };
const same = (icon, freq) => R.matchLobby([row(GM1, Object.assign({ icon }, base))], [cand('inf', 'A', GM1, 70, { w: 4, l: 1, icon })], { iconFreq: freq })[0].p;
const rare = same('rare', { rare: 0.01 }), common = same('common', { common: 0.4 });
ok(rare > common + 0.1, `same RARE avatar is stronger evidence than same COMMON default avatar (${(rare * 100).toFixed(0)}% vs ${(common * 100).toFixed(0)}%)`);
const swapped = R.matchLobby([row(GM1, Object.assign({ icon: 'new', suffix: '.' }, base))], [cand('inf', 'Infexious.', GM1, 70, { w: 4, l: 1, icon: 'old' })])[0];
ok(swapped.uid === 'inf' && swapped.p > 0.5, `avatar swapped since last game still recognised via stats + name end (${(swapped.p * 100).toFixed(0)}%)`);
const sw = (k) => R.matchLobby([row(GM1, Object.assign({ icon: 'new' }, base))], [cand('inf', 'A', GM1, 70, { w: 4, l: 1, icon: 'old' })], { iconSwap: k })[0].p;
ok(sw(0.8) > sw(0.1), 'learned swap rate matters: frequent swappers are penalised less for a changed avatar');
const pick = R.matchLobby([row(GM1, Object.assign({ icon: 'zzz' }, base))], [
  cand('x', 'X', GM1, 70, { w: 4, l: 1, icon: 'old' }), cand('y', 'Y', GM1, -60, { w: 4, l: 1, icon: 'zzz' })], { iconFreq: { zzz: 0.01 } })[0];
ok(pick.uid !== 'y', 'a matching avatar cannot rescue implausible stats (RS +130 with no net wins)');

console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
