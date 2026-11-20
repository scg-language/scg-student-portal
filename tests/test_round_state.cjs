/* アンケートの回の状態（src/assets/round-state.js）の検査 — 2026-11-20
 *   node tests/test_round_state.cjs
 * スマホ（master-phone.html）と PC（admin.js）が同じ線を引くための部品。DB もブラウザも使わない。 */
const RS = require('../src/assets/round-state.js');
const DAY = 86400000, NOW = Date.parse('2026-12-10T03:00:00Z');
const at = d => new Date(NOW + d * DAY).toISOString();
const checks = [];
const check = (name, ok) => { checks.push(ok); console.log((ok ? 'OK   ' : 'FAIL ') + name); };

check('取り消した回は void', RS.state({ is_void: true, closes_at: at(3), opens_at: at(-1) }, NOW) === 'void');
check('締切前は now', RS.state({ closes_at: at(3), opens_at: at(-40) }, NOW) === 'now');
check('締切をすぎたら past', RS.state({ closes_at: at(-1), opens_at: at(-5) }, NOW) === 'past');
check('締切ちょうどは past（しめきった）', RS.state({ closes_at: new Date(NOW).toISOString(), opens_at: at(-5) }, NOW) === 'past');
check('締切なし・はじめて5日は now', RS.state({ closes_at: null, opens_at: at(-5) }, NOW) === 'now');
check('締切なし・はじめて30日ちょうどは now', RS.state({ closes_at: null, opens_at: at(-30) }, NOW) === 'now');
check('締切なし・はじめて31日は past', RS.state({ closes_at: null, opens_at: at(-31) }, NOW) === 'past');
check('締切なし・はじめた日が無いなら now（欠けたデータで黙ってしまわない）', RS.state({ closes_at: null, opens_at: null }, NOW) === 'now');
check('締切なしで past でも「しめきった」ではない（学生は答えられる）', RS.isClosed({ closes_at: null, opens_at: at(-31) }, NOW) === false);
check('しまう日数は30日（HR は月1回）', RS.ARCHIVE_DAYS === 30);
const list = [{ id: 'a', closes_at: at(-20), opens_at: at(-27) }, { id: 'b', closes_at: null, opens_at: at(-40) }, { id: 'c', closes_at: at(-2), opens_at: at(-9) }];
check('おわった回は新しい順（しめきり、無ければ はじめた日）', list.slice().sort(RS.pastOrder).map(x => x.id).join('') === 'cab');

const ng = checks.filter(x => !x).length;
console.log('\n' + (checks.length - ng) + ' / ' + checks.length + ' OK');
process.exit(ng ? 1 : 0);
