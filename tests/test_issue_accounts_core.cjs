/* Edge Function「issue-accounts」の手順（supabase/functions/issue-accounts/core.mjs）の検査。通信なし。
 *   node tests/test_issue_accounts_core.cjs
 * にせの口（名簿を見る・アカウントを作る・名簿の行を付ける・消す・記録）を渡して、手順だけを確かめる。
 * ★学籍番号はダミーの帯（末尾が 999 から降りる）だけ */
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const core = await import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'issue-accounts', 'core.mjs')).href);
  const checks = [];
  const note = (name, ok) => { checks.push({ name, ok: !!ok }); if (!ok) console.log('NG  ' + name); };
  const rows = [
    { student_no: '2604999', display_name: 'テスト太郎', class_name: 'A1クラス' },
    { student_no: 'abc',     display_name: 'テスト次郎', class_name: 'A1クラス' },
    { student_no: '2604998', display_name: 'テスト花子', class_name: 'A1クラス' },
    { student_no: '2604997', display_name: 'テスト三郎', class_name: 'A1クラス' },
    { student_no: '2604996', display_name: 'テスト桜',   class_name: 'B2クラス' },
    { student_no: '2604995', display_name: 'テスト五郎', class_name: 'B2クラス' },
    { student_no: '2604994', display_name: 'テスト六郎', class_name: 'B2クラス' },
  ];
  const pre = { domain: 'example.invalid', results: [
    { student_no: '2604999', status: 'ok', reason: null },
    { student_no: 'abc', status: 'invalid', reason: 'bad_student_no' },
    { student_no: '2604998', status: 'existing', reason: 'exists' },
    { student_no: '2604997', status: 'ok', reason: null },     // Auth が「もうある」と断る
    { student_no: '2604996', status: 'ok', reason: null },     // Auth がほかの理由で断る
    { student_no: '2604995', status: 'ok', reason: null },     // 名簿の行を付けられない → 消す
    { student_no: '2604994', status: 'ok', reason: null },     // 名簿の行を付けられず、消すのも失敗
  ] };
  const log = { created: [], attached: [], deleted: [], logs: [], order: [] };
  const deps = {
    precheck: async r => { log.order.push('precheck'); log.pre = r; return pre; },
    createUser: async (email, pw) => {
      log.order.push('create'); log.created.push({ email, pw });
      if (email.startsWith('2604997')) return { error: 'exists' };
      if (email.startsWith('2604996')) return { error: 'auth_weak password!' };
      return { id: 'id-' + email.slice(0, 7) };
    },
    attach: async (id, no, name, cls) => {
      log.order.push('attach'); log.attached.push({ id, no, name, cls });
      if (no === '2604995' || no === '2604994') throw new Error('値の入った文 テスト五郎');
    },
    deleteUser: async id => { log.order.push('delete'); log.deleted.push(id); if (id === 'id-2604994') throw new Error('x'); },
    log: async c => { log.order.push('log'); log.logs.push(c); },
  };
  const out = await core.issueAccounts(rows, deps);

  note('1 名簿を見るのが最初。記録は最後に1回', log.order[0] === 'precheck' && log.order[log.order.length - 1] === 'log' && log.logs.length === 1);
  note('2 作ってよい行だけ、Auth に頼む（形がおかしい・すでにある行は頼まない）', log.created.map(c => c.email).join() ===
    ['2604999', '2604997', '2604996', '2604995', '2604994'].map(n => n + '@example.invalid').join());
  note('3 はじめのパスワードは scg＋学籍番号', log.created.every(c => c.pw === 'scg' + c.email.slice(0, 7)) && core.initialPassword('2604999') === 'scg2604999');
  note('4 作れたアカウントにだけ、名簿の行を付ける（氏名・クラスは入れた行のもの）', JSON.stringify(log.attached[0]) ===
    JSON.stringify({ id: 'id-2604999', no: '2604999', name: 'テスト太郎', cls: 'A1クラス' }) && log.attached.length === 3);
  note('5 名簿の行を付けられなかったら、作ったアカウントを消す', log.deleted.join() === 'id-2604995,id-2604994');
  note('6 件数', out.created === 1 && out.existing === 2 && out.invalid === 1 && out.failed === 3 && out.logged === true);
  note('7 記録に渡すのは件数だけ', JSON.stringify(log.logs[0]) === JSON.stringify({ created: 1, existing: 2, invalid: 1, failed: 3 }));
  const st = out.results.map(x => x.status + ':' + x.reason).join(' ');
  note('8 行ごとの結果（入れた順）', st === 'created:null invalid:bad_student_no existing:exists existing:login_exists failed:error:auth_weakpassword failed:error:profile failed:error:profile_login_left');
  note('9 返事に氏名・クラス・文が混ざらない', !/テスト|クラス|値の入った/.test(JSON.stringify(out)));
  note('10 返事の番号は、名簿を見た結果の番号', out.results.map(x => x.student_no).join() === '2604999,abc,2604998,2604997,2604996,2604995,2604994');

  // 断るもの
  const refused = async (r, d) => { try { await core.issueAccounts(r, d || deps); return null; } catch (e) { return e; } };
  let e = await refused('x');
  note('11 配列でない → 断る（400）', e && e.status === 400);
  e = await refused(Array.from({ length: 31 }, () => ({})));
  note('12 30件より多い → 断る（400）', e && e.status === 400);
  const n0 = log.created.length;
  e = await refused(rows, Object.assign({}, deps, { precheck: async () => { const x = new Error('権限がありません'); x.status = 403; throw x; } }));
  note('13 DB が断ったら（権限なし）、そのまま断る。Auth には頼まない', e && e.status === 403 && log.created.length === n0);
  e = await refused(rows, Object.assign({}, deps, { precheck: async () => ({ domain: 'example.invalid', results: [] }) }));
  note('14 名簿を見た結果の行数が合わない → 止める。Auth には頼まない', e && e.status === 500 && log.created.length === n0);
  e = await refused(rows, Object.assign({}, deps, { precheck: async () => ({ domain: '', results: pre.results }) }));
  note('15 アドレスの後ろが分からない → 止める', e && e.status === 500 && log.created.length === n0);
  // 記録が書けなくても、結果は返す
  const out2 = await core.issueAccounts([rows[0]], Object.assign({}, deps, {
    precheck: async () => ({ domain: 'example.invalid', results: [pre.results[0]] }), log: async () => { throw new Error('x'); } }));
  note('16 記録が書けなくても、作った結果は返す（logged=false）', out2.created === 1 && out2.logged === false);
  // Auth の呼び出しそのものが落ちた
  const out3 = await core.issueAccounts([rows[0]], Object.assign({}, deps, {
    precheck: async () => ({ domain: 'example.invalid', results: [pre.results[0]] }), createUser: async () => { throw new Error('net'); } }));
  note('17 Auth の呼び出しが落ちた → その行は failed', out3.failed === 1 && out3.results[0].reason === 'error:auth_call');
  // 空の名簿
  const out4 = await core.issueAccounts([], Object.assign({}, deps, { precheck: async () => ({ domain: 'example.invalid', results: [] }) }));
  note('18 空の名簿 → 0件', out4.created === 0 && out4.results.length === 0);

  const ng = checks.filter(c => !c.ok).length;
  console.log(JSON.stringify({ total: checks.length, ng }));
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
