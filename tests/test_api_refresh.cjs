/* ログインの自動更新（src/assets/api.js の _refresh / _authed / login）の検査。通信なし・ブラウザなし。
 *   node tests/test_api_refresh.cjs
 * なぜ：自動更新には「同じ場所から何回まで」の制限がある。教室で全員が一斉に開くと断られることがある（429）。
 *       そのときにログイン画面へ戻すと、全員がパスワードを入れ直して、今度はログインの制限に当たる。
 * 確かめること：混んでいるだけならログアウトしない／1人の画面から更新を同時に2本送らない／本当に断られたらログアウトする */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'api.js'), 'utf8');

function boot(handler) {
  const store = new Map([['sp_token', 'old'], ['sp_refresh', 'rt1'], ['sp_profile', '{"student_no":"2604999","role":"student"}']]);
  const calls = [];
  const env = { reloads: 0, calls, store };
  const ctx = {
    window: {}, console,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { reload: () => { env.reloads++; } },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },     // 待ち時間を飛ばす
    clearTimeout() {}, AbortController, JSON, Math, Promise, Object, Error, String,
    fetch: async (url, opts) => {
      const u = new URL(url);
      const call = { path: u.pathname + u.search, auth: (opts.headers || {}).Authorization || '', body: opts.body };
      calls.push(call);
      const [status, body] = await handler(call, env);
      return { status, ok: status >= 200 && status < 300, json: async () => body };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__api = api;', ctx);
  env.api = ctx.__api;
  return env;
}
const isRefresh = c => c.path.includes('grant_type=refresh_token');
const isData = c => c.path.startsWith('/rest/v1/');

(async () => {
  const checks = [];
  const note = (name, ok) => { checks.push({ name, ok: !!ok }); if (!ok) console.log('NG  ' + name); };

  // 1 トークンが切れている → 更新が通る → 新しいトークンでやり直す
  let e = boot(async (c) => {
    if (isRefresh(c)) return [200, { access_token: 'new', refresh_token: 'rt2' }];
    return c.auth === 'Bearer new' ? [200, [{ ok: 1 }]] : [401, {}];
  });
  let rows = await e.api.get('/rest/v1/quiz_sets?select=id');
  note('1 更新が通れば、新しいトークンでやり直して読める', rows.length === 1 && e.api.token === 'new' && e.store.get('sp_refresh') === 'rt2' && e.reloads === 0);
  note('1 更新は1回だけ送る', e.calls.filter(isRefresh).length === 1);

  // 2 更新が、ずっと「混んでいる」（429） → ログアウトしない。ログインの控えも消さない
  e = boot(async (c) => (isRefresh(c) ? [429, {}] : [401, {}]));
  let err = null;
  try { await e.api.get('/rest/v1/quiz_sets?select=id'); } catch (x) { err = x; }
  note('2 混んでいるときは、ログアウトしない・読み込み直さない', e.reloads === 0 && e.api.token === 'old' && e.store.get('sp_refresh') === 'rt1' && e.store.has('sp_profile'));
  note('2 学生の言葉で「こんでいます」と出す（英文を出さない）', err && err.message.includes('こんでいます') && !/busy|429|server/i.test(err.message));
  note('2 更新は6回までやり直す', e.calls.filter(isRefresh).length === 6);

  // 3 更新を、サーバーがはっきり断った（400） → ログアウトして読み込み直す
  e = boot(async (c) => (isRefresh(c) ? [400, { error_code: 'refresh_token_not_found' }] : [401, {}]));
  err = null;
  try { await e.api.get('/rest/v1/quiz_sets?select=id'); } catch (x) { err = x; }
  note('3 断られたら、ログアウトして読み込み直す', e.reloads === 1 && e.api.token === null && !e.store.has('sp_refresh') && err && err.message.includes('再ログイン'));
  note('3 断られたら、やり直さない（1回だけ）', e.calls.filter(isRefresh).length === 1);

  // 4 1人の画面が、読み込みを3本同時に送る → 更新は1本だけ
  e = boot(async (c) => {
    if (isRefresh(c)) { await new Promise(r => setImmediate(r)); return [200, { access_token: 'new', refresh_token: 'rt2' }]; }
    return c.auth === 'Bearer new' ? [200, []] : [401, {}];
  });
  await Promise.all([e.api.get('/rest/v1/a?x=1'), e.api.get('/rest/v1/b?x=1'), e.api.rpc('my_role', {})]);
  note('4 同時に3本送っても、更新は1本だけ', e.calls.filter(isRefresh).length === 1 && e.reloads === 0);
  note('4 3本とも、新しいトークンでやり直している', e.calls.filter(c => isData(c) && c.auth === 'Bearer new').length === 3);

  // 5 更新が2回「混んでいる」→ 3回目で通る
  let n = 0;
  e = boot(async (c) => {
    if (isRefresh(c)) return ++n < 3 ? [429, {}] : [200, { access_token: 'new', refresh_token: 'rt2' }];
    return c.auth === 'Bearer new' ? [200, [{ ok: 1 }]] : [401, {}];
  });
  rows = await e.api.get('/rest/v1/quiz_sets?select=id');
  note('5 少し待って通れば、そのまま読める', rows.length === 1 && e.calls.filter(isRefresh).length === 3 && e.reloads === 0);

  // 6 更新のあと、つぎの更新もふつうに送れる（1本にまとめる仕組みが、終わったあとに残らない）
  e = boot(async (c) => {
    if (isRefresh(c)) return [200, { access_token: 'new' + e.calls.filter(isRefresh).length, refresh_token: 'rt' }];
    return /^Bearer new/.test(c.auth) && c.auth !== 'Bearer stale' ? [200, []] : [401, {}];
  });
  await e.api.get('/rest/v1/a?x=1');
  e.api.token = 'stale';
  await e.api.get('/rest/v1/a?x=1');
  note('6 更新が終わったら、つぎの更新も送れる', e.calls.filter(isRefresh).length === 2);

  // 7 ログインが「混んでいる」（429） → 学生の言葉で出す
  e = boot(async () => [429, {}]);
  err = null;
  try { await e.api.login('2604999', 'x'); } catch (x) { err = x; }
  note('7 ログインが混んでいるとき：「こんでいます」と出す（英文・番号を出さない）', err && err.message.includes('こんでいます') && !/busy|429|server/i.test(err.message));

  // 8 ログインの番号ちがいは、今までどおり
  e = boot(async () => [400, { error_code: 'invalid_credentials' }]);
  err = null;
  try { await e.api.login('2604999', 'x'); } catch (x) { err = x; }
  note('8 番号かパスワードがちがう、は今までどおり', err && err.message.includes('ちがいます'));

  // 9 Edge Function の呼び出し（発行）も、混んでいるだけならログアウトしない
  e = boot(async (c) => (isRefresh(c) ? [429, {}] : [401, { message: 'x' }]));
  err = null;
  try { await e.api.fn('issue-accounts', { rows: [] }); } catch (x) { err = x; }
  note('9 発行の呼び出しも、混んでいるだけならログアウトしない', e.reloads === 0 && e.api.token === 'old' && err && err.status === 401);

  // 10 マスターの画面（window.SCG_SESSION_ONLY）：ログインを localStorage に残さない・localStorage の控えを読まない
  {
    const local = new Map([['sp_token', 'left-by-teacher-page'], ['sp_profile', '{"role":"teacher"}']]), sess = new Map();
    const mk = m => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
    const ctx = {
      window: { SCG_SESSION_ONLY: true }, console, localStorage: mk(local), sessionStorage: mk(sess),
      location: { reload() {} }, setTimeout: (fn) => { Promise.resolve().then(fn); return 0; }, clearTimeout() {}, AbortController,
      fetch: async (url) => (String(url).includes('/auth/v1/token')
        ? { status: 200, ok: true, json: async () => ({ access_token: 'm-tok', refresh_token: 'm-rt', user: { id: 'm-id' } }) }
        : { status: 200, ok: true, json: async () => [{ student_no: 'm001', display_name: 'マスター', role: 'master', class_name: null }] }),
    };
    vm.createContext(ctx);
    vm.runInContext(code + '\n;globalThis.__api = api;', ctx);
    note('10 マスターの画面は、先生の画面が残したログインを使わない', ctx.__api.token === null && ctx.__api.profile === null);
    await ctx.__api.login('m001', 'x');
    note('10 マスターのログインは、タブの中だけに置く（ブラウザには残さない）', sess.get('sp_token') === 'm-tok' && sess.has('sp_refresh') && local.get('sp_token') === 'left-by-teacher-page' && !local.has('sp_refresh'));
    ctx.__api.logout();
    note('10 マスターのログアウトは、先生の画面のログインを消さない', !sess.has('sp_token') && local.get('sp_token') === 'left-by-teacher-page');
  }

  // 11 はじめのパスワードを SCG… や Scg… と打った人を通す。自分で決めたパスワードの大文字・小文字は区別したまま
  {
    const pwOf = c => JSON.parse(c.body).password;
    const server = async (c) => {
      if (c.path.includes('grant_type=password')) return pwOf(c) === 'scg2604999' ? [200, { access_token: 't', refresh_token: 'r', user: { id: 'u' } }] : [400, { error_code: 'invalid_credentials' }];
      return [200, [{ student_no: '2604999', display_name: 'テスト太郎', role: 'student', class_name: 'A1' }]];
    };
    for (const typed of ['SCG2604999', 'Scg2604999']) {
      e = boot(server);
      let ok = false; try { await e.api.login('2604999', typed); ok = true; } catch (x) {}
      const sent = e.calls.filter(c => c.path.includes('grant_type=password')).map(pwOf);
      note('11 ' + typed + ' で入れる（打ったまま → 小文字、の順に1回ずつ）', ok && sent.join() === typed + ',scg2604999');
    }
    e = boot(server);
    await e.api.login('2604999', 'scg2604999');
    note('11 小文字で打った人は、1回で入る', e.calls.filter(c => c.path.includes('grant_type=password')).length === 1);
    for (const typed of ['Kiwi2026x', 'SCG260499', 'SCG2604999x', 'scg2604998']) {
      e = boot(server); err = null;
      try { await e.api.login('2604999', typed); } catch (x) { err = x; }
      note('11 ' + typed + ' は、直さずに1回で断る', err && err.message.includes('ちがいます') && e.calls.filter(c => c.path.includes('grant_type=password')).length === 1);
    }
    // 自分で決めたパスワードが、たまたま「SCG＋数字7けた」の形でも入れる（打ったままを先に試すため）
    e = boot(async (c) => {
      if (c.path.includes('grant_type=password')) return pwOf(c) === 'SCG1234567' ? [200, { access_token: 't', refresh_token: 'r', user: { id: 'u' } }] : [400, { error_code: 'invalid_credentials' }];
      return [200, [{ student_no: '2604999', display_name: 'テスト太郎', role: 'student', class_name: 'A1' }]];
    });
    let ok2 = false; try { await e.api.login('2604999', 'SCG1234567'); ok2 = true; } catch (x) {}
    note('11 自分で決めた大文字のパスワードは、打ったままで入れる', ok2 && e.calls.filter(c => c.path.includes('grant_type=password')).length === 1);
  }

  const ng = checks.filter(c => !c.ok).length;
  console.log(JSON.stringify({ total: checks.length, ng }));
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
