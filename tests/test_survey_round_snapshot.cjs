/* 回の「配ったときの設問の写し」を読む・保存する部品（src/assets/survey-db.js）の検査 — 2026-11-21
 *   node tests/test_survey_round_snapshot.cjs
 * DB もブラウザも使わない（api をにせものに差し替える）。見ていること:
 *   ・DB がまだ変わっていない（列・RPC が無い）ときに、今までどおり動く＝例外を出さず、写しなしで返す
 *   ・写しがある回は、surveys.js をあとで書き換えても、配ったときの選択肢の名前で読める
 *   ・写しの無い回がコードの定義のものなら、その場で保存しに行く（1回だけ）
 * 学籍番号・氏名は使わない（回の id はにせものの UUID）。 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src', 'assets');
const checks = [];
const check = (name, ok) => { checks.push(!!ok); console.log((ok ? 'OK   ' : 'FAIL ') + name); };
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* にせものの api。handler(path, opts) が { status, body } を返す。throw すれば通信の失敗 */
function boot(handler) {
  const calls = [];
  const ctx = { console, JSON, Object, Array, String, Set, Date, encodeURIComponent };
  ctx.window = ctx;
  ctx.api = {
    async _authed(p, opts) {
      calls.push({ path: p, body: opts && opts.body ? JSON.parse(opts.body) : null });
      const r = await handler(p, opts);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    },
    async get() { throw new Error('この検査では api.get を使わない'); },
    async rpc() { throw new Error('この検査では api.rpc を使わない'); },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'surveys.js'), 'utf8'), ctx, { filename: 'surveys.js' });
  vm.runInContext(fs.readFileSync(path.join(SRC, 'survey-db.js'), 'utf8'), ctx, { filename: 'survey-db.js' });
  const get = expr => vm.runInContext(expr, ctx);
  return { DB: ctx.SurveyDB, calls, get, SURVEYS: get('SURVEYS'), optLabel: get('optLabel') };
}
const isRounds = p => p.startsWith('/rest/v1/survey_rounds?');
const isRpc = p => p === '/rest/v1/rpc/save_survey_round_def';

(async () => {
  /* 1. DB 適用前：列が無い（PostgREST は 400・42703） */
  {
    const t = boot(async () => ({ status: 400, body: { code: '42703', message: 'column survey_rounds.def_snapshot does not exist' } }));
    let threw = false;
    try { await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2026' }]); } catch (e) { threw = true; }
    check('列が無い DB でも例外を出さない', !threw);
    check('列が無い DB では写しなし（今までどおり いまの定義で読む）', t.DB.roundDef(uuid(1)) === null);
    await t.DB.loadRoundDefs([{ id: uuid(2), survey_key: 'shinro_2026' }]);
    check('列が無いと分かったら、以後はたずねない', t.calls.length === 1);
    check('列が無いときは保存も試さない', !t.calls.some(c => isRpc(c.path)));
  }

  /* 2. 列はあるが RPC が無い（404・PGRST202） */
  {
    const t = boot(async p => isRounds(p)
      ? { status: 200, body: [{ id: uuid(1), survey_key: 'shinro_2026', def_snapshot: null }, { id: uuid(2), survey_key: 'shinro_2026', def_snapshot: null }] }
      : { status: 404, body: { code: 'PGRST202' } });
    let threw = false;
    try { await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2026' }, { id: uuid(2), survey_key: 'shinro_2026' }]); } catch (e) { threw = true; }
    check('保存の口が無い DB でも例外を出さない', !threw && t.DB.roundDef(uuid(1)) === null);
    check('保存の口が無いと分かったら、2本目からは送らない', t.calls.filter(c => isRpc(c.path)).length === 1);
    check('回をはじめた直後の保存も、黙って false を返す', (await t.DB.saveRoundDef(uuid(3), 'shinro_2026')) === false);
  }

  /* 3. 写しがある回：surveys.js をあとで書き換えても、配ったときの名前で読める */
  {
    const t = boot(async () => ({ status: 500, body: {} }));
    const cur = t.SURVEYS.find(s => s.key === 'shinro_2026');
    const snapshot = JSON.parse(JSON.stringify(cur)); delete snapshot.key;
    const q0 = cur.q.find(q => q.t === 'select'), kept = q0.o[0].v, oldLabel = q0.o[0].ja;
    const t2 = boot(async p => isRounds(p)
      ? { status: 200, body: [{ id: uuid(1), survey_key: 'shinro_2026', def_snapshot: snapshot }] }
      : { status: 500, body: {} });
    const cur2 = t2.SURVEYS.find(s => s.key === 'shinro_2026'), q2 = cur2.q.find(q => q.k === q0.k);
    q2.o[0].ja = '書き換えたあとの名前';            // 配ったあとで surveys.js を書き換えた、という想定
    q2.o.splice(1, 1);                               // 2つ目の選択肢は消した、という想定
    await t2.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2026' }]);
    const def = t2.DB.roundDef(uuid(1));
    const sq = def && def.q.find(q => q.k === q0.k);
    check('写しのある回は roundDef が定義を返す（key は回の survey_key）', !!def && def.key === 'shinro_2026' && def._snapshot === true);
    check('いまの定義で読むと、書き換えたあとの名前になる（＝これが抜け）', t2.optLabel(q2, kept) === '書き換えたあとの名前');
    check('写しで読むと、配ったときの名前のまま', !!sq && t2.optLabel(sq, kept) === oldLabel);
    check('消した選択肢も、写しなら名前に戻せる', !!sq && t2.optLabel(sq, q0.o[1].v) === q0.o[1].ja && t2.optLabel(q2, q0.o[1].v) === q0.o[1].v);
    check('写しのある回には保存を送らない', !t2.calls.some(c => isRpc(c.path)));
    await t2.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2026' }]);
    check('同じ回は2度読まない', t2.calls.filter(c => isRounds(c.path)).length === 1);
    check('写しは SURVEYS（学生画面・回をはじめる一覧が読む配列）を書き換えない', t2.SURVEYS.find(s => s.key === 'shinro_2026') === cur2 && !cur2._snapshot);
    void t;
  }

  /* 4. 写しの無い回：コードの定義ならその場で保存する。定義の無い key（検査用）は送らない */
  {
    const t = boot(async (p, opts) => isRounds(p)
      ? { status: 200, body: [{ id: uuid(1), survey_key: 'shinro_2027_jan_v1', def_snapshot: null }, { id: uuid(2), survey_key: 'test_ui', def_snapshot: null }] }
      : { status: 200, body: { round_id: JSON.parse(opts.body).p_round_id, saved: true } });
    await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2027_jan_v1' }, { id: uuid(2), survey_key: 'test_ui' }, { id: 'demo1', survey_key: 'shinro_2026' }, null]);
    const rpcs = t.calls.filter(c => isRpc(c.path));
    check('コードの定義の回だけ保存を送る（定義の無い key は送らない）', rpcs.length === 1 && rpcs[0].body.p_round_id === uuid(1));
    const sent = rpcs[0] ? rpcs[0].body.p_def : {};
    const src = t.SURVEYS.find(s => s.key === 'shinro_2027_jan_v1');
    check('送る写しは定義そのまま（key だけ外す）', !('key' in sent) && !('_db' in sent) && JSON.stringify(sent.q) === JSON.stringify(src.q) && JSON.stringify(sent.sections) === JSON.stringify(src.sections));
    check('保存できたら、その回はすぐ写しで読める', !!t.DB.roundDef(uuid(1)) && t.DB.roundDef(uuid(1)).q.length === src.q.length);
    check('UUID でない id（見本データ）は問い合わせに入れない', !t.calls.some(c => isRounds(c.path) && c.path.includes('demo1')));
    check('定義の無い key の回は写しなしのまま', t.DB.roundDef(uuid(2)) === null);
    check('保存ずみの回へは もう送らない', (await t.DB.saveRoundDef(uuid(1), 'shinro_2027_jan_v1')) === false && t.calls.filter(c => isRpc(c.path)).length === 1);
  }

  /* 5. 通信の失敗は「写しなし」と決めつけない＝次の読み込みでもう一度たずねる */
  {
    let n = 0;
    const t = boot(async p => {
      if (isRounds(p) && n++ === 0) throw new Error('network');
      return { status: 200, body: [{ id: uuid(1), survey_key: 'x_unknown', def_snapshot: { title: { ja: '写し' }, q: [{ k: 'a', t: 'text', l: { ja: 'しつもん' } }, null, 'こわれた行'] } }] };
    });
    let threw = false;
    try { await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'x_unknown' }]); } catch (e) { threw = true; }
    check('通信の失敗でも例外を出さない', !threw && t.DB.roundDef(uuid(1)) === null);
    await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'x_unknown' }]);
    const def = t.DB.roundDef(uuid(1));
    check('次の読み込みで取り直す', !!def && def.title.ja === '写し');
    check('いまは定義が消えた key でも、写しがあれば読める', !t.SURVEYS.some(s => s.key === 'x_unknown') && !!def);
    check('写しの中の壊れた行は落とす（画面を止めない）', !!def && def.q.length === 1 && def.q[0].k === 'a');
  }

  /* 6. 先にだれかが保存していた（saved=false）→ 次の読み込みでその写しを取りに行く */
  {
    let stored = null;
    const t = boot(async p => {
      if (isRounds(p)) return { status: 200, body: [{ id: uuid(1), survey_key: 'shinro_2026', def_snapshot: stored }] };
      stored = { title: { ja: '先に保存された写し' }, q: [{ k: 'job', t: 'text', l: { ja: 'しごと' } }] };
      return { status: 200, body: { round_id: uuid(1), saved: false } };
    });
    await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2026' }]);
    check('saved=false のとき、手元の定義を写しあつかいしない', t.DB.roundDef(uuid(1)) === null);
    await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'shinro_2026' }]);
    check('次の読み込みで、先に保存された写しを使う', !!t.DB.roundDef(uuid(1)) && t.DB.roundDef(uuid(1)).title.ja === '先に保存された写し');
  }

  /* 7. 形の壊れた写し（配列・文字）は写しなしあつかい */
  {
    const t = boot(async () => ({ status: 200, body: [{ id: uuid(1), survey_key: 'x1', def_snapshot: [1, 2] }, { id: uuid(2), survey_key: 'x2', def_snapshot: 'abc' }] }));
    await t.DB.loadRoundDefs([{ id: uuid(1), survey_key: 'x1' }, { id: uuid(2), survey_key: 'x2' }]);
    check('形の壊れた写しは使わない', t.DB.roundDef(uuid(1)) === null && t.DB.roundDef(uuid(2)) === null);
  }

  /* 8. コードの定義は全部、サーバーの受け入れ条件（オブジェクト・質問が1つ以上・200,000バイト以下）を満たす */
  {
    const t = boot(async () => ({ status: 500, body: {} }));
    const bad = t.SURVEYS.filter(s => {
      const body = JSON.parse(JSON.stringify(s)); delete body.key;
      return !(Array.isArray(body.q) && body.q.length > 0 && Buffer.byteLength(JSON.stringify(body), 'utf8') <= 200000);
    }).map(s => s.key);
    check('surveys.js の定義はどれも写しとして保存できる形（' + t.SURVEYS.length + '本）', t.SURVEYS.length > 0 && bad.length === 0);
    check('写しにしても中身が欠けない（関数など JSON にできない値が無い）', t.SURVEYS.every(s => JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s)));
  }

  const ng = checks.filter(x => !x).length;
  console.log('\n' + (checks.length - ng) + ' / ' + checks.length + ' OK');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
