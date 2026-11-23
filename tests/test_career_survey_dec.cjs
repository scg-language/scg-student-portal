/* 進路アンケート（2026年12月・shinro_2026_dec_v1）と、数字の欄（number）の検査。通信なし・ブラウザなし。
 *   node tests/test_career_survey_dec.cjs
 * 確かめること：点数は範囲の中の数字か「おぼえていない」だけ通る／選んだ試験のぶんだけ欄が出る／
 *               仕事は複数・「まだ決まっていない」は単独／1月の版（shinro_2027_jan_v1）は変わっていない */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/assets/surveys.js'), 'utf8') + ';globalThis.S=SURVEYS;globalThis.OL=optLabel;', ctx);
const F = require(path.join(root, 'src/assets/survey-form.js'));
const d = ctx.S.find(s => s.key === 'shinro_2026_dec_v1'), jan = ctx.S.find(s => s.key === 'shinro_2027_jan_v1');
const checks = [];
const note = (name, ok) => { checks.push(!!ok); if (!ok) console.log('NG  ' + name); };
const q = k => d.q.find(x => x.k === k);
const v = (a, lang) => F.validate(d, a, { lang: lang || 'ja' });

const base = {
  jlpt_level: 'n5', other_tests: ['jpt', 'nat', 'jtest'], nat_level: 'k5', jtest_kind: 'fg', jtest_score: 'unknown', jpt_score: '５２０',
  future_exams: ['undecided'], education: 'high_school', job: ['it_engineer', 'care'], field_first: 'it', field_second: 'unknown',
  path_1: 'university', path_2: 'vocational_school', schools_status: 'undecided', areas: ['anywhere'], oc_status: 'no',
  funding: ['family'], family_status: 'agree', concerns: ['none'], interview_preference: 'regular',
};

// 定義の形
note('1 定義がある・質問のキーが重ならない', d && new Set(d.q.map(x => x.k)).size === d.q.length && d.q.every(x => x.k && x.t && x.l && x.sl));
note('1 どの質問も、4つの大項目のどれかに入っている', d.q.every(x => d.sections.some(s => s.key === x.section)));
note('1 JLPT に N5 がある', q('jlpt_level').o.some(o => o.v === 'n5'));
note('1 JLPT 以外の試験は7つ＋「持っていない」', q('other_tests').o.map(o => o.v).join() === 'jcert,jlct,topj,nat,jtest,jpt,jft,none');
const plans = d.q.filter(x => x.section === 'plans').map(x => x.k);
const pos = k => plans.indexOf(k);
note('1 ②の順番＝仕事 → 分野 → 進路 → 学校', pos('job') === 0 && pos('job') < pos('field_first') && pos('field_second') < pos('path_1')
  && pos('path_1') < pos('path_2') && pos('path_2') < pos('path_3') && pos('path_3') < pos('schools_status'));
note('1 進路の第1希望だけが必須', q('path_1').required === true && !q('path_2').required && !q('path_3').required);
note('1 面談候補の印「進路未定」は、第1希望に付いている', q('path_1').o.some(o => o.v === 'undecided' && o.flag === '進路未定'));
note('1 1月の版は変わっていない（24問・仕事は1つ選ぶ）', jan.q.length === 24 && jan.q.find(x => x.k === 'job').t === 'select' && !jan.q.find(x => x.k === 'job').exclusive);

// 答えの検査
let r = v(base);
note('2 ふつうの答えが通る', r.ok);
note('2 全角の数字は半角にそろえる', r.answers.jpt_score === '520');
note('2 「おぼえていない」は unknown で入る', r.answers.jtest_score === 'unknown');
note('2 選んでいない試験の欄は、送らない', !('jft_score' in r.answers) && !('jcert_level' in r.answers) && !('topj_level' in r.answers));
for (const [bad, why] of [['991', '満点より大きい'], ['abc', '数字でない'], ['-5', '負の数'], ['5.5', '小数'], ['', '空']]) {
  r = v({ ...base, jpt_score: bad });
  note('3 JPT の点数 ' + JSON.stringify(bad) + '（' + why + '）は断る', !r.ok && r.errors.some(e => e.key === 'jpt_score'));
}
note('3 満点ちょうど・0 は通る', v({ ...base, jpt_score: '990' }).ok && v({ ...base, jpt_score: '0' }).ok);
note('3 JFT-Basic は 250 まで', v({ ...base, other_tests: ['jft'], jft_score: '250' }).ok && !v({ ...base, other_tests: ['jft'], jft_score: '251' }).ok);
note('3 J.TEST は 1000 まで', !v({ ...base, jtest_score: '1001' }).ok && v({ ...base, jtest_score: '1000' }).ok);
r = v({ ...base, jpt_score: '991' }, 'en');
note('3 断る文は、その言語で・範囲つき', r.errors[0].message.includes('990') && /number/i.test(r.errors[0].message));
note('4 「持っていない」は、ほかと一緒に選べない', !v({ ...base, other_tests: ['none', 'jpt'] }).ok);
r = v({ ...base, other_tests: ['none'] });
note('4 「持っていない」だけなら、級・点数の欄なしで通る', r.ok && !Object.keys(r.answers).some(k => /_score$|_level$|_kind$/.test(k) && k !== 'jlpt_level'));
note('4 選んだ試験の級を選ばないと断る', !v({ ...base, nat_level: '' }).ok);
note('5 仕事は複数選べる', v(base).answers.job.length === 2);
note('5 仕事の「まだ決まっていない」は、ほかと一緒に選べない', !v({ ...base, job: ['undecided', 'care'] }).ok && v({ ...base, job: ['undecided'] }).ok);
note('5 仕事の「その他」を選んだら、記入が要る', !v({ ...base, job: ['other'] }).ok && v({ ...base, job: ['other'], job_other: '日本語の先生' }).ok);
note('5 進路の第2・第3希望は、空でも通る', v({ ...base, path_2: '', path_3: '' }).ok);

// 控えと、職員の画面での表示
const rec = F.describe(d, base, 'ja');
note('6 控え：おぼえていない・点数・複数の仕事が、読める形で出る', rec.find(x => x.key === 'jtest_score').value === 'おぼえていない'
  && rec.find(x => x.key === 'jpt_score').value === '520' && rec.find(x => x.key === 'job').value === 'ITエンジニア、介護');
note('6 控え（英語）', F.describe(d, base, 'en').find(x => x.key === 'jtest_score').value === 'I do not remember');
note('6 職員の画面：unknown を「おぼえていない」に戻す', ctx.OL(q('jtest_score'), 'unknown') === 'おぼえていない' && ctx.OL(q('jpt_score'), '520') === '520');
note('6 職員の画面：複数の仕事', ctx.OL(q('job'), ['it_engineer', 'care']) === 'ITエンジニア／介護');

// 数字の欄は、ほかのアンケートの動きを変えていない
const old = ctx.S.find(s => s.key === 'shinro_2026');
note('7 古いアンケートは今までどおり通る', F.validate(old, { job: 'x', field: 'it', town: 'y' }, { lang: 'ja' }).ok);

const ng = checks.filter(x => !x).length;
console.log(JSON.stringify({ total: checks.length, ng }));
process.exit(ng ? 1 : 0);
