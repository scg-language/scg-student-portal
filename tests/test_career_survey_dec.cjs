/* 進路アンケート（2026年12月・shinro_2026_dec_v1）と、フォームの新しい部品（数字の欄・やさしい日本語とルビ）の検査。
 *   node tests/test_career_survey_dec.cjs        通信なし・ブラウザなし
 * 確かめること：
 *   ・点数は範囲の中の数字か「おぼえていない」だけ通る／選んだ試験のぶんだけ欄が出る／JLPT 以外の試験は任意
 *   ・学生に見せる文（jy）に、ルビの無い漢字が残っていない・記法が崩れていない
 *   ・職員に見せる文（ja）には、ルビの記法が混ざっていない
 *   ・1月の版（shinro_2027_jan_v1）は変わっていない */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/assets/surveys.js'), 'utf8') + ';globalThis.S=SURVEYS;globalThis.OL=optLabel;', ctx);
const F = require(path.join(root, 'src/assets/survey-form.js'));
const d = ctx.S.find(s => s.key === 'shinro_2026_dec_v1'), jan = ctx.S.find(s => s.key === 'shinro_2027_jan_v1');
const checks = [];
const note = (name, ok, more) => { checks.push(!!ok); if (!ok) console.log('NG  ' + name + (more ? '\n    ' + more : '')); };
const q = k => d.q.find(x => x.k === k);
const v = (a, lang) => F.validate(d, a, { lang: lang || 'ja' });

const base = {
  jlpt_level: 'n5', other_tests: ['jpt', 'nat', 'jtest'], nat_level: 'k5', jtest_kind: 'fg', jtest_score: 'unknown', jpt_score: '５２０',
  education: 'high_school', job: ['it_engineer', 'care'], field_first: 'it', field_second: 'unknown',
  path_1: 'university', path_2: 'vocational_school', schools_status: 'undecided', areas: ['kyoto', 'osaka'], oc_status: 'no',
  funding: ['family'], family_status: 'agree', concerns: ['none'], interview_preference: 'regular',
};

// 1 定義の形
note('1 定義がある・質問のキーが重ならない', d && new Set(d.q.map(x => x.k)).size === d.q.length && d.q.every(x => x.k && x.t && x.l && x.sl));
note('1 どの質問も、4つの大項目のどれかに入っている', d.q.every(x => d.sections.some(s => s.key === x.section)));
note('1 JLPT に N5 がある', q('jlpt_level').o.some(o => o.v === 'n5'));
note('1 JLPT 以外の試験の順番＝JPT・NAT・J.TEST・JFT・J-cert・JLCT・TOPJ', q('other_tests').o.map(o => o.v).join() === 'jpt,nat,jtest,jft,jcert,jlct,topj,none');
const cur = d.q.filter(x => x.section === 'current').map(x => x.k);
note('1 級・点数の欄も、同じ順番で並ぶ', cur.slice(2, 10).join() === 'jpt_score,nat_level,jtest_kind,jtest_score,jft_score,jcert_level,jlct_level,topj_level');
note('1 JLPT 以外の試験と、その級・点数は任意', !q('other_tests').required && cur.slice(2, 10).every(k => !q(k).required));
note('1 次の JLPT で受けたい級は聞かない（11/26 きあ：合格していないと次の級は受けさせない＝答えると約束に読める）', !q('next_jlpt'));
note('1 ほかに受けたい試験は任意', !q('other_exams').required && q('other_exams').t === 'multi');
const plans = d.q.filter(x => x.section === 'plans').map(x => x.k), pos = k => plans.indexOf(k);
note('1 ②の順番＝仕事 → 分野 → 進路 → 学校', pos('job') === 0 && pos('job') < pos('field_first') && pos('field_second') < pos('path_1')
  && pos('path_1') < pos('path_2') && pos('path_2') < pos('schools_status'));
note('1 進路は第2希望まで（11/26：3つだと全部になる）・第1希望だけが必須', q('path_1').required === true && !q('path_2').required && !q('path_3'));
note('1 仕事と分野に、建築・電気CAD がある', ['job'].concat(['field_first', 'field_second']).every(k => ['architecture', 'electric_cad'].every(v => q(k).o.some(o => o.v === v))));
note('1 「その他」は選択肢のいちばん下（記入の欄がすぐ下に来る）', ['job', 'field_first', 'field_second', 'other_exams', 'education'].every(k => q(k).o[q(k).o.length - 1].v === 'other'));
note('1 「その他」の記入と、見学した学校の名前は任意。気になっている学校の第1希望は必須のまま',
  ['job_other', 'field_first_other', 'field_second_other', 'other_exams_other', 'education_other', 'oc_school'].every(k => q(k).required === false) && q('school_1').required === true);
note('1 場所の選択肢は12（11/26 に福島・広島・福岡・沖縄を足した）',
  q('areas').o.map(o => o.v).join() === 'kyoto,osaka,kansai_other,tokyo,near_tokyo,nagoya,fukushima,hiroshima,fukuoka,okinawa,commutable,anywhere');
const flags = d.q.flatMap(x => (x.o || []).filter(o => o.flag).map(o => x.k + ':' + o.v + ':' + o.flag)).sort().join('|');
const janFlags = jan.q.flatMap(x => (x.o || []).filter(o => o.flag).map(o => (x.k === 'path' ? 'path_1' : x.k) + ':' + o.v + ':' + o.flag)).sort().join('|');
note('1 面談候補の印は、1月の版と同じ8つ', flags === janFlags && flags.split('|').length === 8, flags);
note('1 1月の版は変わっていない（24問・仕事は1つ選ぶ・やさしい日本語の印なし）', jan.q.length === 24 && jan.q.find(x => x.k === 'job').t === 'select' && !jan.easy);

// 2 文：学生に見せる文（jy）と、職員に見せる文（ja）
const KANJI = /[一-鿿々]/, RUBY = /\$\{[^}]*\}\([^)]*\)/g;
const noJy = [], badJy = [], badJa = [], badRead = [];
const walk = (x, where) => {
  if (!x || typeof x !== 'object') return;
  if (typeof x.ja === 'string' && typeof x.en === 'string') {
    if (RUBY.test(x.ja) || /[${}]/.test(x.ja)) badJa.push(where + ': ' + x.ja);
    RUBY.lastIndex = 0;
    if (x.jy == null) { if (KANJI.test(x.ja)) noJy.push(where + ': ' + x.ja); }
    else {
      if (KANJI.test(x.jy.replace(RUBY, '')) || /[${}]/.test(x.jy.replace(RUBY, ''))) badJy.push(where + ': ' + x.jy);
      for (const m of x.jy.matchAll(RUBY)) { const [, base, read] = m[0].match(/\$\{([^}]*)\}\(([^)]*)\)/); if (!KANJI.test(base) || !/^[ぁ-ゖー]+$/.test(read)) badRead.push(where + ': ' + m[0]); }
    }
  }
  for (const k of Object.keys(x)) if (k !== 'ja' && k !== 'jy' && k !== 'en') walk(x[k], where + '.' + k);
};
walk({ sections: d.sections, q: d.q }, '');
note('2 漢字のある文には、やさしい日本語の文（jy）がある', !noJy.length, noJy.join('\n    '));
note('2 jy に、ルビの無い漢字・崩れた記法が無い', !badJy.length, badJy.join('\n    '));
note('2 ルビは「漢字に、ひらがなの読み」になっている', !badRead.length, badRead.join('\n    '));
note('2 職員に見せる文（ja）に、ルビの記法が混ざっていない', !badJa.length, badJa.join('\n    '));
note('2 題・説明・前置きは、ルビを出せない所にも出るので漢字なし（年・月を除く）',
  !KANJI.test((d.title.ja + d.desc.ja + d.intro.ja).replace(/[年月]/g, '')) && !/[${}]/.test(d.title.ja + d.desc.ja + d.intro.ja));
note('2 ルビを外す関数', F.plain('${今}(いま) ${持}(も)っている JLPTの ${級}(きゅう)') === '今 持っている JLPTの 級' && F.plain('ABC') === 'ABC');

// 3 答えの検査
let r = v(base);
note('3 ふつうの答えが通る', r.ok, JSON.stringify(r.errors));
note('3 全角の数字は半角にそろえる', r.answers.jpt_score === '520');
note('3 「おぼえていない」は unknown で入る', r.answers.jtest_score === 'unknown');
note('3 選んでいない試験の欄は、送らない', !('jft_score' in r.answers) && !('jcert_level' in r.answers) && !('topj_level' in r.answers));
for (const [bad, why] of [['991', '満点より大きい'], ['abc', '数字でない'], ['-5', '負の数'], ['5.5', '小数']]) {
  r = v({ ...base, jpt_score: bad });
  note('3 JPT の点数 ' + JSON.stringify(bad) + '（' + why + '）は断る', !r.ok && r.errors.some(e => e.key === 'jpt_score'));
}
note('3 満点ちょうど・0 は通る', v({ ...base, jpt_score: '990' }).ok && v({ ...base, jpt_score: '0' }).ok);
note('3 JFT-Basic は 250 まで', v({ ...base, other_tests: ['jft'], jft_score: '250' }).ok && !v({ ...base, other_tests: ['jft'], jft_score: '251' }).ok);
note('3 J.TEST は 1000 まで', !v({ ...base, jtest_score: '1001' }).ok && v({ ...base, jtest_score: '1000' }).ok);
r = v({ ...base, jpt_score: '991' });
note('3 断る文は、やさしい日本語・範囲つき・漢字なし', r.errors[0].message.includes('990') && !KANJI.test(r.errors[0].message));
r = v({ ...base, jpt_score: '991' }, 'en');
note('3 英語のときは英語で断る', /number/i.test(r.errors[0].message) && r.errors[0].message.includes('990'));
note('4 試験を選んで、級・点数を空のままでも通る（任意）', v({ ...base, jpt_score: '', nat_level: '', jtest_kind: '', jtest_score: '' }).ok);
note('4 JLPT 以外の試験を何も選ばなくても通る', v({ ...base, other_tests: [] }).ok);
note('4 「持っていない」は、ほかと一緒に選べない', !v({ ...base, other_tests: ['none', 'jpt'] }).ok);
note('4 ほかに受けたい試験：選ばなくても通る・「その他」の名前は書かなくても通る',
  v({ ...base, other_exams: ['eju'] }).ok && v({ ...base, other_exams: ['other'] }).ok && v({ ...base, other_exams: ['other'], other_exams_other: 'BJT' }).answers.other_exams_other === 'BJT');
note('5 仕事は複数選べる', v(base).answers.job.length === 2);
note('5 仕事の「まだ決まっていない」は、ほかと一緒に選べない', !v({ ...base, job: ['undecided', 'care'] }).ok && v({ ...base, job: ['undecided'] }).ok);
note('5 仕事の「その他」は、書かなくても通る・書けば送る', v({ ...base, job: ['other'] }).ok && v({ ...base, job: ['other'], job_other: '日本語の先生' }).answers.job_other === '日本語の先生');
note('5 見学に行った学校の名前は、書かなくても通る', v({ ...base, oc_status: 'yes' }).ok);
note('5 気になっている学校が「ある」なら、第1希望の名前は要る', !v({ ...base, schools_status: 'decided' }).ok && v({ ...base, schools_status: 'decided', school_1: 'A校' }).ok);
note('5 進路の第2希望は、空でも通る', v({ ...base, path_2: '' }).ok);
note('5 場所：「どこでもいい」は、ほかと一緒に選べない', !v({ ...base, areas: ['anywhere', 'kyoto'] }).ok && v({ ...base, areas: ['anywhere'] }).ok);

// 5b 地図（場所の質問）
const MAP = require(path.join(root, 'src/assets/japan-map-data.js')), am = q('areas').map;
note('5b 地図のデータ：47都道府県・コードは 01〜47・形がある', MAP.pref.length === 47 && MAP.pref.every((p, i) => p.c === String(i + 1).padStart(2, '0') && /^M[\d.,LMZ-]+Z$/.test(p.d) && p.ja));
note('5b 沖縄は、左上の枠の中にある', (() => { const o = MAP.pref.find(p => p.c === '47'), n = MAP.inset; return o.b[0] >= n.x && o.b[1] >= n.y && o.b[2] <= n.x + n.w && o.b[3] <= n.y + n.h; })());
note('5b 地図にある選択肢は10で、どれも一覧にもある', Object.keys(am).join() === 'kyoto,osaka,kansai_other,tokyo,near_tokyo,nagoya,fukushima,hiroshima,fukuoka,okinawa' && Object.keys(am).every(k => q('areas').o.some(o => o.v === k)));
note('5b 福島＝07・広島＝34・福岡＝40・沖縄＝47', am.fukushima.codes.join() === '07' && am.hiroshima.codes.join() === '34' && am.fukuoka.codes.join() === '40' && am.okinawa.codes.join() === '47');
note('5b 札どうしが重ならない（まん中が横60・縦34より近くない）', Object.values(am).every((a, i, all) => all.every((b, j) => j <= i || Math.abs(a.at[0] - b.at[0]) >= 60 || Math.abs(a.at[1] - b.at[1]) >= 34)),
  Object.entries(am).map(([k, g]) => k + ':' + g.at).join(' '));
const codes = Object.values(am).flatMap(g => g.codes);
note('5b 都道府県は実在し、2つの選択肢に重ならない', codes.every(c => MAP.pref.some(p => p.c === c)) && new Set(codes).size === codes.length);
note('5b 京都＝26・大阪＝27・東京＝13', am.kyoto.codes.join() === '26' && am.osaka.codes.join() === '27' && am.tokyo.codes.join() === '13');
note('5b 札は地図の中に置く・文は3つの言語ぶん', Object.values(am).every(g => g.at[0] > 20 && g.at[0] < MAP.w - 20 && g.at[1] > 20 && g.at[1] < MAP.h - 20 && g.label.ja && g.label.jy && g.label.en));
note('5b 「どこでも」で地図の全部に色を付ける', q('areas').mapAll.join() === 'anywhere');

// 6 控えと、職員の画面での表示
const rec = F.describe(d, base, 'ja');
note('6 控え（日本語）：ルビの記法は外れて、読める形で出る', rec.find(x => x.key === 'jtest_score').value === 'おぼえていない'
  && rec.find(x => x.key === 'jpt_score').value === '520' && rec.find(x => x.key === 'job').value === 'ITエンジニア、介護'
  && rec.every(x => !/[${}]/.test(x.label + x.value + x.section)));
note('6 控え（英語）', F.describe(d, base, 'en').find(x => x.key === 'jtest_score').value === 'I do not remember');
note('6 職員の画面：ふつうの日本語で出る', ctx.OL(q('jtest_score'), 'unknown') === 'おぼえていない' && ctx.OL(q('jpt_score'), '520') === '520'
  && ctx.OL(q('job'), ['it_engineer', 'care']) === 'ITエンジニア／介護' && ctx.OL(q('areas'), ['kyoto', 'kansai_other']) === '京都／その他の関西（兵庫・奈良・滋賀など）');

// 7 ほかのアンケートの動きを変えていない
const old = ctx.S.find(s => s.key === 'shinro_2026');
note('7 古いアンケートは今までどおり通る', F.validate(old, { job: 'x', field: 'it', town: 'y' }, { lang: 'ja' }).ok);
r = F.validate(jan, {}, { lang: 'ja' });
note('7 1月の版の断る文は、ふつうの日本語のまま', r.errors.some(e => e.message === '回答してください。'));

const ng = checks.filter(x => !x).length;
console.log(JSON.stringify({ total: checks.length, ng }));
process.exit(ng ? 1 : 0);
