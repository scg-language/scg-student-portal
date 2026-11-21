/* アンケート結果の「回ごとの集計・未回答・面談候補」を、意地悪なダミーで照合する（進捗ボード 1G）— 2026-11-21
 *
 *   node tests/run_e2e_survey_rounds.cjs
 *
 * ★通信なし。Supabase への要求は CDP で横取りし、このファイルの中の「偽の PostgREST」が
 *   ダミーの表から返す（.env・ログイン情報・本物のDBは使わない）。それ以外の http/https は1本も通さない。
 * ★偽サーバーは URL の条件（round_id=eq.… / survey_key=eq.… / is_void=eq.false …）を**実際に解釈して**絞る。
 *   画面が条件を付け忘れると、他の回の行がそのまま返る＝数字が合わなくなって落ちる。
 *   知らない条件が来たら黙って全件返さず 400 にして、最後の検査で落とす。
 *
 * 見る画面：PC の管理画面（src/master.html ＋ src/assets/admin.js）と、スマホ画面（src/master-phone.html）。
 *
 * ダミーの組合せ（全部 架空。学籍番号は 999 から降順）:
 *   学生10人 … A①クラス4人・B①クラス3人・C①クラス3人
 *   回（進路アンケート 2027年1月 shinro_2027_jan_v1）
 *     今回       「検証2027年1月」   対象＝A①・B①クラス＋指定学生1人（C①） → 対象8人
 *     取り消し   「検証 取り消し」   今回より新しい。今回の未提出者(996)と太郎の「別の答え」が入っている
 *     取り消し2  「検証 取り消し2」  今回と前回のあいだ（前回比較が飛ばすべき回）
 *     前回       「検証2026年12月」  締切済み。対象＝A①・B①クラス
 *     常設       「常設」            締切なし・40日前から（＝終了した回にしまわれる）。対象＝全員
 *   回（別の定義 seikatsu_kenko_2026）「検証 別定義」 対象＝指定学生2人（今回の未提出者 996・993）。2人とも提出済み
 *   回なし（round_id が null の古い検査行）… 996 の行が1つ
 *   今回の回答：999(再提出＝あとの答えが正)・998・997・995・994・992(指定学生)＋ 991(対象外＝C①で指定なし)
 *   今回の未提出：996・993
 *
 * 🔴「既知の不具合」の印（XFAIL）について
 *   落ちると分かっている式は known() で書いてある。いまは落ちても全体は成功（exit 0）。
 *   src が直って通るようになったら「XPASS」として**失敗にする**＝印を外し忘れないため。
 *   そのときは known( を check( に書き換えること（理由の文は消してよい）。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

/* ════════ ダミーの表 ════════ */
const DAY = 86400000, HOUR = 3600000;
const sid = n => '00000000-0000-4000-8000-0000000009' + String(n).padStart(2, '0');
const rid = n => '10000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const JAN = 'shinro_2027_jan_v1', OTHER = 'seikatsu_kenko_2026';
const A = 'A①クラス', B = 'B①クラス', C = 'C①クラス';
const R = { cur: rid(1), void1: rid(2), void2: rid(3), prev: rid(4), standing: rid(5), other: rid(6) };
const T = { cur: '検証2027年1月', void1: '検証 取り消し', void2: '検証 取り消し2', prev: '検証2026年12月', standing: '常設', other: '検証 別定義' };
/* 長い記述：改行・カンマ・二重引用符・タグの形の文字を含む（CSV と画面でそのまま読めること） */
const LONG = 'テスト国際専門学校（架空）, "国際ビジネス科" の説明会に行きました。\n2行目：<b>太字ではない</b> & 記号、カンマ, も入る。\n'
  + '3行目：' + '見学では校舎と寮を回り、先輩の話を聞きました。'.repeat(9) + '（おわり）';
const BASE = { jlpt_level: 'n4', future_exams: ['undecided'], education: 'high_school', path: 'vocational_school', job: 'it_engineer',
  field_first: 'it', field_second: 'unknown', schools_status: 'undecided', areas: ['tokyo', 'near_tokyo'], oc_status: 'no',
  funding: ['family', 'savings'], family_status: 'agree', concerns: ['none'], interview_preference: 'regular' };
const ans = over => Object.assign({}, BASE, over || {});
/* 太郎（999）の「あとの答え」＝面談候補の理由が4つ（学費は2問で付くが札は1つ） */
const TARO_FINAL = ans({ path: 'university', future_exams: ['jlpt_n2', 'eju', 'other'], future_exams_other: 'テスト検定（架空）',
  oc_status: 'yes', oc_school: LONG, funding: ['part_time_installments', 'scholarship_needed'],
  family_status: 'not_yet', family_talk_by: '2027-02-15', concerns: ['money', 'attendance', 'japanese'], interview_preference: 'soon' });

function makeDb(now) {
  const iso = ms => new Date(ms).toISOString();
  const stu = (n, no, name, cls) => ({ id: sid(n), student_no: no, display_name: name, class_name: cls, role: 'student' });
  const profiles = [
    { id: 'm-id', student_no: 'm001', display_name: 'ダミー マスター', class_name: null, role: 'master' },
    stu(99, '2604999', 'テスト太郎', A), stu(98, '2604998', 'テスト花子', A), stu(97, '2604997', 'テスト三郎', A), stu(96, '2604996', 'テスト四郎', A),
    stu(95, '2604995', 'テスト五月', B), stu(94, '2604994', 'テスト六花', B), stu(93, '2604993', 'テスト七海', B),
    stu(92, '2604992', 'テスト八重', C), stu(91, '2604991', 'テスト九郎', C), stu(90, '2604990', 'テスト十和', C),
  ];
  const round = (id, key, title, cls, ids, open, close, isVoid) => ({ id, survey_key: key, title, class_names: cls, student_ids: ids,
    opens_at: iso(now + open * DAY), closes_at: close == null ? null : iso(now + close * DAY), is_void: !!isVoid, created_at: iso(now + open * DAY) });
  const survey_rounds = [
    round(R.cur, JAN, T.cur, [A, B], [sid(92)], -2, 5, false),
    round(R.void1, JAN, T.void1, [A, B], [], -1, 5, true),
    round(R.void2, JAN, T.void2, [A, B], [], -10, 5, true),
    round(R.prev, JAN, T.prev, [A, B], [], -35, -28, false),
    round(R.standing, JAN, T.standing, [], [], -40, null, false),
    round(R.other, OTHER, T.other, [], [sid(96), sid(93)], -3, 6, false),
  ];
  const survey_responses = [];
  /* ★本物と同じ決まり＝(student_id, round_id) で1行。再提出は上書き（行は増えない） */
  const upsert = (n, round_id, key, answers, at) => {
    const row = { student_id: sid(n), round_id, survey_key: key, answers, submitted_at: iso(at) };
    const i = round_id == null ? -1 : survey_responses.findIndex(x => x.student_id === row.student_id && x.round_id === round_id);
    if (i >= 0) survey_responses[i] = row; else survey_responses.push(row);
  };
  // 今回
  upsert(99, R.cur, JAN, ans(), now - 30 * HOUR);                       // 太郎の1回目（旗なし）
  upsert(99, R.cur, JAN, TARO_FINAL, now - 1 * HOUR);                   // 太郎の再提出（これが正）
  upsert(98, R.cur, JAN, ans(), now - 20 * HOUR);
  upsert(97, R.cur, JAN, ans({ path: 'undecided' }), now - 19 * HOUR);
  upsert(95, R.cur, JAN, ans({ concerns: ['family_opposes'] }), now - 18 * HOUR);
  upsert(94, R.cur, JAN, ans(), now - 17 * HOUR);
  upsert(92, R.cur, JAN, ans({ funding: ['unknown'] }), now - 16 * HOUR);   // 指定学生（C①）
  upsert(91, R.cur, JAN, ans({ concerns: ['money'], interview_preference: 'soon' }), now - 15 * HOUR);   // 対象外（C①・指定なし）
  // 取り消した回（今回の数に入ってはいけない）
  upsert(96, R.void1, JAN, ans({ interview_preference: 'soon' }), now - 12 * HOUR);
  upsert(99, R.void1, JAN, ans({ path: 'undecided' }), now - 11 * HOUR);
  upsert(98, R.void2, JAN, ans({ path: 'undecided' }), now - 9 * DAY);
  // 前回
  upsert(99, R.prev, JAN, ans({ path: 'undecided' }), now - 30 * DAY);
  upsert(98, R.prev, JAN, ans(), now - 30 * DAY - HOUR);
  upsert(95, R.prev, JAN, ans(), now - 30 * DAY - 2 * HOUR);
  upsert(96, R.prev, JAN, ans({ path: 'undecided' }), now - 30 * DAY - 3 * HOUR);
  // 常設・別の定義・回なし
  upsert(93, R.standing, JAN, ans({ interview_preference: 'soon' }), now - 38 * DAY);
  upsert(96, R.other, OTHER, { sumai: 'テスト' }, now - 2 * DAY);
  upsert(93, R.other, OTHER, { sumai: 'テスト' }, now - 2 * DAY - HOUR);
  upsert(96, null, JAN, ans({ interview_preference: 'soon' }), now - 60 * DAY);
  return { profiles, survey_rounds, survey_responses };
}

/* 期待値（手で数えた正解。admin.js の関数は使わない） */
const EXPECT = {
  cur: { targets: ['2604999', '2604998', '2604997', '2604996', '2604995', '2604994', '2604993', '2604992'],
    done: ['2604999', '2604998', '2604997', '2604995', '2604994', '2604992'], rest: ['2604996', '2604993'], outsider: '2604991',
    flags: { '2604999': ['学費', '家族にまだ話していない', '出席率', '早く相談したい'], '2604997': ['進路未定'], '2604995': ['家族に反対'], '2604992': ['学費'] } },
  prev: { targets: 7, done: ['2604999', '2604998', '2604996', '2604995'], rest: 3 },
  standing: { targets: 10, done: ['2604993'] },
  other: { targets: 2, done: ['2604996', '2604993'] },
};

/* ════════ 偽の PostgREST（条件を実際に解釈する） ════════ */
function makeServer(db, log) {
  const STRICT = new Set(['profiles', 'survey_rounds', 'survey_responses']);
  const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
  function rest(table, params) {
    if (table === 'quiz_sets') return [{ id: '20000000-0000-4000-8000-000000000001', title: 'ダミー小テスト', lesson: '1-1' }];
    if (!STRICT.has(table)) return [];   // 小テスト・履歴などは空（この検査の対象外）
    let rows = db[table].slice();
    for (const [k, v] of params) {
      if (k === 'select' || k === 'order' || k === 'limit' || k === 'offset') continue;
      const m = /^(eq|in|is)\.([\s\S]*)$/.exec(v);
      if (!m) { log.unknown.push(table + '?' + k + '=' + v); return null; }
      const val = m[2];
      if (m[1] === 'eq') rows = rows.filter(r => String(r[k]) === val);
      else if (m[1] === 'in') { const set = new Set(val.replace(/^\(|\)$/g, '').split(',')); rows = rows.filter(r => set.has(String(r[k]))); }
      else rows = rows.filter(r => (val === 'null' ? r[k] == null : String(r[k]) === val));
    }
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map(o => { const p = o.split('.'); return { f: p[0], desc: p[1] === 'desc', nullsLast: p.includes('nullslast') ? true : p.includes('nullsfirst') ? false : p[1] !== 'desc' }; });
      rows.sort((a, b) => { for (const o of keys) { const x = a[o.f], y = b[o.f];
        if (x == null && y == null) continue; if (x == null) return o.nullsLast ? 1 : -1; if (y == null) return o.nullsLast ? -1 : 1;
        if (x !== y) return (x < y ? -1 : 1) * (o.desc ? -1 : 1); } return 0; });
    }
    const limit = params.get('limit'); if (limit) rows = rows.slice(0, Number(limit));
    const cols = splitTop(params.get('select') || '*');
    return rows.map(r => {
      if (cols.includes('*')) return Object.assign({}, r);
      const o = {};
      cols.forEach(c => {
        const e = /^(\w+)\((.*)\)$/.exec(c);
        if (!e) { o[c] = r[c] === undefined ? null : r[c]; return; }
        const src = e[1] === 'profiles' ? db.profiles.find(p => p.id === r.student_id) : e[1] === 'survey_rounds' ? db.survey_rounds.find(x => x.id === r.round_id) : null;
        o[e[1]] = src ? Object.fromEntries(e[2].split(',').map(f => [f, src[f] === undefined ? null : src[f]])) : null;
      });
      return o;
    });
  }
  return function handle(method, url, who) {
    const u = new URL(url), p = u.pathname;
    if (method === 'OPTIONS') return { status: 204, body: null };
    if (p === '/auth/v1/token') return { status: 200, body: { access_token: 'dummy-token', refresh_token: 'dummy-refresh', user: { id: 'm-id' } } };
    if (p === '/rest/v1/rpc/my_role') return { status: 200, body: 'master' };
    if (p.startsWith('/rest/v1/rpc/')) return { status: 200, body: [] };
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length);
      if (method !== 'GET') { log.writes.push(method + ' ' + table); return { status: 403, body: { message: 'この検査では書き込まない' } }; }
      log.gets.push({ who, table, query: decodeURIComponent(u.search) });
      const rows = rest(table, u.searchParams);
      return rows ? { status: 200, body: rows } : { status: 400, body: { message: '偽サーバーが知らない条件' } };
    }
    return { status: 404, body: { message: 'not found' } };
  };
}

/* CSV（RFC 4180）を読む。引用符の中の改行・カンマ・"" を戻す */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  const repo = path.resolve(__dirname, '..');
  /* 別の作業ツリーの src を見たいとき（直しを合流前に確かめる）: SP_E2E_SRC=<src フォルダ> node tests/run_e2e_survey_rounds.cjs */
  const srcDir = process.env.SP_E2E_SRC ? path.resolve(process.env.SP_E2E_SRC) : path.join(repo, 'src');
  const out = path.join(repo, 'tmp', 'shots', 'survey-rounds');
  fs.mkdirSync(out, { recursive: true });
  const now = Date.now();
  const db = makeDb(now);
  const log = { gets: [], unknown: [], writes: [], blocked: [] };
  const serve = makeServer(db, log);
  const results = [], exceptions = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sorted = a => a.slice().sort();
  const show = v => (typeof v === 'string' ? v : JSON.stringify(v));
  /* 期待と実際を並べて出す。exp を省くと ok（真偽）だけで見る */
  const record = (kind, name, actual, expected, why) => {
    const ok = expected === undefined ? !!actual : same(actual, expected);
    let mark;
    if (kind === 'check') mark = ok ? 'OK   ' : 'FAIL ';
    else mark = ok ? 'XPASS' : 'XFAIL';
    results.push({ kind, name, ok });
    console.log(mark + ' ' + name);
    if (!ok && expected !== undefined) console.log('        期待: ' + show(expected) + '\n        実際: ' + show(actual));
    if (kind === 'known' && !ok) console.log('        既知の不具合: ' + why);
    if (kind === 'known' && ok) console.log('        ★通るようになりました。known( を check( に書き換えてください（' + why + '）');
    return ok;
  };
  const check = (name, actual, expected) => record('check', name, actual, expected);
  const known = (why, name, actual, expected) => record('known', name, actual, expected, why);

  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw Error('Chrome not found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-survey-rounds-'));
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const pending = new Map();
  let socket, seq = 0, who = 'pc';
  try {
    const active = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !fs.existsSync(active); i++) await pause(80);
    const port = fs.readFileSync(active, 'utf8').split(/\r?\n/)[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const H = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, { name: 'Access-Control-Expose-Headers', value: 'Content-Range' },
      { name: 'Content-Range', value: '0-0/1' }, { name: 'Content-Type', value: 'application/json' }];
    socket.addEventListener('message', e => {
      const k = JSON.parse(e.data);
      if (k.id) { const q = pending.get(k.id); if (!q) return; pending.delete(k.id); k.error ? q.reject(Error(JSON.stringify(k.error))) : q.resolve(k.result || {}); }
      else if (k.method === 'Runtime.exceptionThrown') exceptions.push(k.params.exceptionDetails.exception?.description || k.params.exceptionDetails.text);
      else if (k.method === 'Fetch.requestPaused') {
        const id = k.params.requestId, rq = k.params.request;
        if (rq.url.startsWith('file:') || rq.url.startsWith('blob:') || rq.url.startsWith('data:')) cdp('Fetch.continueRequest', { requestId: id }).catch(() => {});
        else if (new URL(rq.url).hostname.endsWith('.supabase.co')) {
          const r = serve(rq.method, rq.url, who);
          cdp('Fetch.fulfillRequest', { requestId: id, responseCode: r.status, responseHeaders: H, body: Buffer.from(r.body == null ? '' : JSON.stringify(r.body)).toString('base64') }).catch(() => {});
        } else { log.blocked.push(new URL(rq.url).hostname); cdp('Fetch.failRequest', { requestId: id, errorReason: 'BlockedByClient' }).catch(() => {}); }
      }
    });
    const ev = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    /* 条件を待つ。★時間ではなく「画面がその状態になったこと」を待つ。なれなければ label を出して止める */
    const until = async (expr, label) => { for (let i = 0; i < 150; i++) { try { if (await ev(expr)) return; } catch (e) {} await pause(60); } throw Error('その状態になりませんでした: ' + label); };
    const shot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64')); };
    const J = JSON.stringify;

    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    // CSV の保存は一時フォルダへ（利用者のダウンロード先を汚さない）
    const dl = path.join(profile, 'dl'); fs.mkdirSync(dl, { recursive: true });
    await cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => {});
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    /* ════════ PC：管理画面 ════════ */
    const loginReady = '(()=>{const b=document.getElementById("btn-login");return !!b&&typeof b.onclick==="function"})()';
    await cdp('Page.navigate', { url: pathToFileURL(path.join(srcDir, 'master.html')).href });
    await until(loginReady, 'ログインのボタンにハンドラが付く');
    await ev('localStorage.clear()'); await cdp('Page.reload'); await until(loginReady, 'ログインのボタンにハンドラが付く（読み直し後）');
    await ev('document.getElementById("in-no").value="m001";document.getElementById("in-pw").value="dummy";document.getElementById("btn-login").click()');
    await until('!document.getElementById("scr-dash").hidden', '管理画面が開く');
    // CSV の中身を横取りする口（保存そのものは止めない）
    await ev('(()=>{window.__csv=[];const o=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{window.__csv.push({blob:b});return o(b);};'
      + 'const c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&window.__csv.length)window.__csv[window.__csv.length-1].name=this.download;return c.call(this);};})()');
    const chipSel = t => '[...document.querySelectorAll("#sv-chips .chip")].find(c=>c.textContent.trim()===' + J(t) + ')';
    const chipOn = t => '(()=>{const c=' + chipSel(t) + ';return !!c&&c.getAttribute("aria-selected")==="true"})()';
    await ev('document.querySelector("[data-view=survey]").click()');
    await until('!document.getElementById("view-survey").hidden', 'アンケート結果の画面');
    await ev('(()=>{const s=document.getElementById("sv-pick");s.value=' + J(JAN) + ';s.dispatchEvent(new Event("change"));})()');
    await until(chipOn(T.cur), '今回の回のチップが選ばれる');

    const read = () => ev(`(()=>{const t=id=>document.getElementById(id).textContent.trim();
      const no=tr=>tr.querySelector("td .muted").textContent.trim();
      return {count:t("sv-count"),of:t("sv-of"),rest:t("sv-rest"),flag:t("sv-flagn"),bycls:t("sv-bycls"),dueS:t("sv-due-s"),
        tnEach:t("sv-tn-each"),tnRest:t("sv-tn-rest"),tnFlag:t("sv-tn-flag"),
        chips:[...document.querySelectorAll("#sv-chips .chip")].map(c=>c.textContent.trim()),
        eachNos:[...document.querySelectorAll("#sv-list tbody tr")].map(no),
        eachCells:[...document.querySelectorAll("#sv-list tbody tr")].map(tr=>[...tr.children].map(td=>td.textContent.trim())),
        eachHead:[...document.querySelectorAll("#sv-list thead th")].map(th=>th.textContent.trim()),
        restTags:[...document.querySelectorAll("#sv-rest-box .tag")].map(e=>e.textContent.trim()),
        flagRows:[...document.querySelectorAll("#sv-flag-box tbody tr")].map(tr=>({no:no(tr),reasons:[...tr.querySelectorAll(".tag")].map(e=>e.textContent)})),
        compareTitle:document.getElementById("sv-compare").parentElement.title,compareOff:document.getElementById("sv-compare").disabled}})()`);
    /* 集計のカード（短い見出しで探す）：答えた人の数と、選択肢ごとの数 */
    const card = sl => ev(`(()=>{const c=[...document.querySelectorAll("#sv-tab-sum .qcard")].find(c=>c.querySelector("h3").textContent===${J(sl)});if(!c)return null;
      return {meta:c.querySelector(".qm").textContent,bars:Object.fromEntries([...c.querySelectorAll(".bar")].map(b=>[b.querySelector(".bl").textContent,{n:b.querySelector(".bn").childNodes[0].textContent,small:b.querySelector(".bn small").textContent}])),
        texts:[...c.querySelectorAll(".texts span")].map(s=>s.textContent)}})()`);
    const nosOf = tags => tags.map(s => (/（(\d{7})）$/.exec(s) || [])[1]);
    const E = EXPECT.cur;
    const WHY = '対象外の学生の回答を「提出」に数えている＝src/assets/admin.js:165-173 svScope() が S.resp を対象（targets）で絞っていない';

    const s1 = await read();
    await shot('pc_1_current.png');
    console.log('── PC ①今回の回：対象数＝回答済み＋未回答 ──');
    check('ダミーの前提：対象8人＝提出6人＋未提出2人', E.done.length + E.rest.length, E.targets.length);
    check('対象数（分母）は 8人', (/\/ (\d+)人/.exec(s1.of) || [])[1], '8');
    check('未提出は 2人（数字とタブの数が同じ）', [s1.rest, s1.tnRest], ['2', '2']);
    check('未提出の名前は 996・993 だけ（取り消した回・別の定義・回なしの回答で「提出済み」にならない）', sorted(nosOf(s1.restTags)), sorted(E.rest));
    known(WHY, '提出は 6人（対象外 991 を数えない）', s1.count, '6');
    known(WHY, '式：提出＋未提出＝対象数', Number(s1.count) + Number(s1.rest), 8);
    known(WHY, 'クラス別の内訳が 対象の人数を超えない（C① は 1/1）', s1.bycls, 'A① 3/4 ・ B① 2/3 ・ C① 1/1');
    console.log('── PC ②他の回・取り消した回・別の定義が混ざらない ──');
    check('回のチップに取り消した回が出ない', s1.chips.filter(c => c.includes('取り消し')), []);
    check('チップ＝今回＋「終了した回（2）」（前回と常設をしまう）', s1.chips, [T.cur, '終了した回（2） ▸']);
    check('一人ずつ＝この回に入っている行だけ（他の回・取り消し・別定義・回なしの行は0件）', s1.eachNos.filter(no => !E.done.concat(E.outsider).includes(no)), []);
    check('一人ずつ：この回の対象者の回答は全員ぶん出ている（重複なし）', sorted(s1.eachNos.filter(no => E.done.includes(no))), sorted(E.done));
    known(WHY, '一人ずつに対象外（991）が出ない', sorted(s1.eachNos), sorted(E.done));
    check('一人ずつの行数＝「提出」の数＝タブの数（画面の中で食い違わない）', [String(s1.eachNos.length), s1.tnEach], [s1.count, s1.count]);
    console.log('── PC ③面談候補の旗と理由 ──');
    const flagMap = Object.fromEntries(s1.flagRows.map(r => [r.no, r.reasons]));
    Object.keys(E.flags).forEach(no => check('面談候補 ' + no + ' の理由（重複なし）', sorted(flagMap[no] || []), sorted(E.flags[no])));
    check('再提出：太郎(999)は「あとの答え」で判定（1回目は旗なし・取り消した回の「進路未定」は付かない）', (flagMap['2604999'] || []).includes('進路未定'), false);
    check('旗の無い人（998・994）は面談候補に出ない', ['2604998', '2604994'].filter(no => flagMap[no]), []);
    check('未提出者（996）は取り消した回・回なしの「早く相談したい」で候補にならない', !!flagMap['2604996'], false);
    known(WHY, '面談候補は 4人（対象外 991 を入れない）', [s1.flag, s1.tnFlag, String(s1.flagRows.length)], ['4', '4', '4']);
    check('面談候補の数字＝タブの数＝行数（画面の中で食い違わない）', [s1.tnFlag, String(s1.flagRows.length)], [s1.flag, s1.flag]);

    console.log('── PC ④集計（選ぶ質問・複数選択・記述・日付） ──');
    const cPath = await card('希望進路'), cTalk = await card('面談の希望'), cExam = await card('今後の受験予定'), cOc = await card('見学した学校'), cDate = await card('家族と話す予定日');
    check('希望進路「まだ決まっていない」＝1人（997 だけ。取り消した回の太郎・花子を数えない）', cPath.bars['まだ決まっていない・悩んでいる'].n, '1');
    check('希望進路「大学」＝1人（太郎の再提出）', cPath.bars['大学'].n, '1');
    known(WHY, '希望進路の「答えた人」は 6人', (/答えた人 (\d+)人/.exec(cPath.meta) || [])[1], '6');
    known(WHY, '面談の希望「できるだけ早く」＝1人（太郎だけ）', cTalk.bars['できるだけ早く相談したい'].n, '1');
    check('複数選択：太郎の3つが別々に1人ずつ数えられる', [cExam.bars['7月のJLPT N2'].n, cExam.bars['EJU（日本留学試験）'].n, cExam.bars['その他'].n], ['1', '1', '1']);
    check('長い記述：集計のカードに全文が出る（途中で切れない・タグにならない）', cOc && cOc.texts, [LONG.trim()]);
    check('日付：「2027年2月15日」と読める', cDate && cDate.texts, ['2027年2月15日']);
    check('画面にタグが作られていない（<b> は文字のまま）', await ev('document.querySelectorAll("#view-survey .qcard b, #sv-list td b b").length'), 0);

    console.log('── PC ⑤一人ずつ・個人詳細 ──');
    const taroRow = s1.eachCells.find(c => c[0].includes('2604999'));
    check('一人ずつ：複数選択は「、」で並ぶ', taroRow[s1.eachHead.indexOf('今後の受験予定')], '7月のJLPT N2、EJU（日本留学試験）、その他');
    check('一人ずつ：提出の時刻は再提出の時刻', taroRow[2], await ev(`(()=>{const d=new Date(${J(new Date(now - HOUR).toISOString())});return (d.getMonth()+1)+"/"+d.getDate()+" "+d.getHours()+":"+String(d.getMinutes()).padStart(2,"0")})()`));
    await ev('[...document.querySelectorAll("#sv-list tbody tr")].find(tr=>tr.textContent.includes("2604999")).click()');
    await until('(()=>{const d=document.querySelector(".drawer");return !!d&&!d.hidden&&d.querySelector("h2").textContent==="テスト太郎"})()', '太郎の個人詳細が開く');
    const person = await ev(`(()=>{const d=document.querySelector(".drawer");return {sub:d.querySelector(".ds").textContent,tags:[...d.querySelectorAll(".db > .tags .tag")].map(e=>e.textContent),
      notes:[...d.querySelectorAll(".db > .note")].map(e=>e.textContent),
      rows:Object.fromEntries([...d.querySelectorAll(".db > .arow")].map(r=>[r.querySelector(".q").textContent,{a:r.querySelector(".a").textContent,pv:(r.querySelector(".pv")||{}).textContent||null,flag:r.classList.contains("flag"),els:r.querySelector(".a").children.length}]))}})()`);
    await shot('pc_2_person.png');
    check('個人詳細：理由の札が4つ', sorted(person.tags), sorted(E.flags['2604999']));
    check('個人詳細：長い記述が全文そのまま（改行・カンマ・引用符・<b> を文字として）', [person.rows['見学した学校'].a, person.rows['見学した学校'].els], [LONG, 0]);
    check('個人詳細：複数選択と日付', [person.rows['学費の準備方法'].a, person.rows['家族と話す予定日'].a], ['アルバイト代で分けて払いたい、奨学金がないと払えない', '2027年2月15日']);
    check('個人詳細：旗の付いた答えの行に印（学費・家族・心配・面談の4行）', Object.keys(person.rows).filter(k => person.rows[k].flag).sort(), ['学費の準備方法', '家族の同意', '心配なこと', '面談の希望'].sort());
    check('前回比較：くらべる相手は「検証2026年12月」（あいだの取り消した回を飛ばす）', person.notes.some(n => n.includes('前の回「' + T.prev + '」')), true);
    check('前回比較：変わった答えは前回の答えを出す／同じ答えは「同じ」', [person.rows['希望進路'].pv, person.rows['JLPT保有資格'].pv], ['前の回：まだ決まっていない・悩んでいる', '前の回と同じ']);
    await ev('document.querySelector(".drawer .x").click()');
    await until('document.querySelector(".drawer").hidden', '個人詳細が閉じる');

    console.log('── PC ⑥前の回とくらべる ──');
    check('くらべる相手の表示は前回の回', [s1.compareOff, s1.compareTitle.includes('「' + T.prev + '」')], [false, true]);
    await ev('document.getElementById("sv-compare").click()');
    const cPath2 = await card('希望進路');
    check('前回の割合は前回の4人で出す（未定 2/4＝50%。取り消し2の花子を入れると60%になる）', /前50%$/.test(cPath2.bars['まだ決まっていない・悩んでいる'].small), true);
    await ev('document.getElementById("sv-compare").click()');

    console.log('── PC ⑦CSV（画面の数・値と一致） ──');
    const grabCsv = async () => {
      const before = await ev('window.__csv.length');
      await ev('document.getElementById("sv-csv").click()');
      await until('window.__csv.length>' + before, 'CSV が作られる');
      const b64 = await ev('(async()=>{const b=new Uint8Array(await window.__csv[window.__csv.length-1].blob.arrayBuffer());let s="";b.forEach(x=>s+=String.fromCharCode(x));return btoa(s);})()');
      const buf = Buffer.from(b64, 'base64');
      return { bom: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, rows: parseCsv(buf.slice(3).toString('utf8')), name: await ev('window.__csv[window.__csv.length-1].name') };
    };
    const csv = await grabCsv();
    const head = csv.rows[0], body = csv.rows.slice(1), col = n => head.indexOf(n);
    const taroCsv = body.find(r => r[0] === '2604999') || [];
    check('CSV：BOM 付き UTF-8・ファイル名にアンケート名と回の名前', [csv.bom, csv.name], [true, '進路アンケート（2027年1月）_' + T.cur + '.csv']);
    check('CSV：見出しに重複が無く、全部の行が同じ列数', [new Set(head).size === head.length, body.every(r => r.length === head.length)], [true, true]);
    check('CSV：行数＝画面の「提出」の数、学籍番号の集合＝「一人ずつ」', [String(body.length), sorted(body.map(r => r[0]))], [s1.count, sorted(s1.eachNos)]);
    known(WHY, 'CSV：対象外（991）の行が無い（6行）', sorted(body.map(r => r[0])), sorted(E.done));
    check('CSV：面談候補の理由＝画面の面談候補と同じ（全員ぶん）', Object.fromEntries(body.filter(r => r[col('面談候補の理由')]).map(r => [r[0], r[col('面談候補の理由')]])), Object.fromEntries(s1.flagRows.map(r => [r.no, r.reasons.join('・')])));
    check('CSV：太郎の氏名・クラス・提出日時（再提出の時刻）', [taroCsv[1], taroCsv[2], taroCsv[3]], ['テスト太郎', A, await ev('new Date(' + J(new Date(now - HOUR).toISOString()) + ').toLocaleString("ja-JP")')]);
    check('CSV：長い記述が1文字も変わらない', taroCsv[col('見学した学校')], LONG);
    check('CSV：複数選択・日付・出し分けの記述', [taroCsv[col('今後の受験予定')], taroCsv[col('家族と話す予定日')], taroCsv[col('その他の受験予定')], taroCsv[col('心配なこと')]],
      ['7月のJLPT N2、EJU（日本留学試験）、その他', '2027年2月15日', 'テスト検定（架空）', '学費や生活費が払えるか心配、出席率が足りるか心配、日本語（面接や作文）に自信がない']);
    check('CSV：答えていない出し分けの質問は空欄（花子の「見学した学校」）', (body.find(r => r[0] === '2604998') || [])[col('見学した学校')], '');
    check('CSV：一人ずつの表の値と同じ（希望進路・全員ぶん）', Object.fromEntries(body.map(r => [r[0], r[col('希望進路')]])), Object.fromEntries(s1.eachCells.map(c => [(/\d{7}/.exec(c[0]) || [])[0], c[s1.eachHead.indexOf('希望進路')]])));

    console.log('── PC ⑧クラスでしぼる ──');
    await ev('(()=>{const s=document.getElementById("sv-class");s.value=' + J(A) + ';s.dispatchEvent(new Event("change"));})()');
    const sA = await read(), csvA = await grabCsv();
    check('A①クラス：提出3＋未提出1＝対象4・面談候補2', [sA.count, sA.rest, (/\/ (\d+)人/.exec(sA.of) || [])[1], sA.flag], ['3', '1', '4', '2']);
    check('A①クラス：CSV も3行・全部 A①クラス', [csvA.rows.length - 1, csvA.rows.slice(1).every(r => r[2] === A)], [3, true]);
    await ev('(()=>{const s=document.getElementById("sv-class");s.value=' + J(C) + ';s.dispatchEvent(new Event("change"));})()');
    const sC = await read();
    known(WHY, 'C①クラス：提出1＋未提出0＝対象1（指定学生 992 だけ）', [sC.count, sC.rest, (/\/ (\d+)人/.exec(sC.of) || [])[1]], ['1', '0', '1']);
    await ev('(()=>{const s=document.getElementById("sv-class");s.value="";s.dispatchEvent(new Event("change"));})()');

    console.log('── PC ⑨回を切り替える（前回・常設）・別の定義 ──');
    await ev('document.getElementById("sv-past-toggle").click()');
    await until('!!' + chipSel(T.prev), '終了した回が開く');
    check('終了した回の中にも取り消した回は無い', (await read()).chips.filter(c => c.includes('取り消し')), []);
    await ev(chipSel(T.prev) + '.click()'); await until(chipOn(T.prev), '前回の回が選ばれる');
    const sP = await read();
    check('前回：提出4＋未提出3＝対象7、名前は前回の4人', [sP.count, sP.rest, (/\/ (\d+)人/.exec(sP.of) || [])[1], sorted(sP.eachNos)], ['4', '3', '7', sorted(EXPECT.prev.done)]);
    check('前回：締切済みと出る', sP.dueS, '締め切りました');
    await ev(chipSel(T.standing) + '.click()'); await until(chipOn(T.standing), '常設の回が選ばれる');
    const sS = await read();
    check('常設：対象は全員10人・提出は 993 の1人だけ（今回の回答が混ざらない）', [(/\/ (\d+)人/.exec(sS.of) || [])[1], sS.eachNos, sS.rest], ['10', EXPECT.standing.done, '9']);
    await ev('(()=>{const s=document.getElementById("sv-pick");s.value=' + J(OTHER) + ';s.dispatchEvent(new Event("change"));})()');
    await until(chipOn(T.other), '別の定義の回が選ばれる');
    const sO = await read();
    check('別の定義：指定学生2人だけが対象・2人とも提出・進路の回の行は0件', [sO.count, sO.rest, (/\/ (\d+)人/.exec(sO.of) || [])[1], sorted(sO.eachNos)], ['2', '0', '2', sorted(EXPECT.other.done)]);
    check('別の定義：回のチップに進路の回が出ない', sO.chips, [T.other]);

    console.log('── PC ⑩今日（対応すること） ──');
    await ev('document.querySelector("[data-view=today]").click()');
    await until('!!document.querySelector("#td-todo .todo .tn")', '今日の「対応すること」が出る');
    const todo = await ev('[...document.querySelectorAll("#td-todo .todo")].map(r=>({n:r.querySelector(".tn").textContent,title:r.querySelector(".tt b").textContent,sub:r.querySelector(".tt span").textContent}))');
    const tRest = todo.find(x => x.title.includes('未提出') && x.title.includes(T.cur)) || {}, tFlag = todo.find(x => x.title.startsWith('面談候補') && x.sub.includes(T.cur)) || {};
    await shot('pc_3_today.png');
    check('今日：対応することは今回の回の2件だけ（取り消し・常設・終了・全員提出の回は出ない）', todo.length, 2);
    check('今日：未提出 2人', tRest.n, '2');
    const WHY2 = '「今日」も同じ＝src/assets/admin.js:413-418 todayTodo() が回答を対象で絞らずに数えている';
    known(WHY2, '今日：未提出の行の内訳は「提出 6 / 8」', (/提出 (\d+ \/ \d+)/.exec(tRest.sub || '') || [])[1], '6 / 8');
    known(WHY2, '今日：面談候補 4人', tFlag.n, '4');

    console.log('── PC ⑪学生（一覧と個人詳細） ──');
    await ev('document.querySelector("[data-view=students]").click()');
    await until('!!document.querySelector("#st-table tbody tr")', '学生の一覧が出る');
    const st = await ev('Object.fromEntries([...document.querySelectorAll("#st-table tbody tr")].map(tr=>[tr.children[0].textContent,tr.children[5].textContent.trim()]))');
    check('学生：受付中の回だけで数える（999=提出済み／996・993=今回が未提出1／991・990=対象の回なし）',
      [st['2604999'], st['2604996'], st['2604993'], st['2604991'], st['2604990'], st['2604992']], ['提出済み', '未提出 1', '未提出 1', '—', '—', '提出済み']);
    await ev('[...document.querySelectorAll("#st-table tbody tr")].find(tr=>tr.children[0].textContent==="2604999").click()');
    await until('(()=>{const d=document.querySelector(".drawer");return !!d&&!d.hidden&&d.querySelector("h2").textContent==="テスト太郎"&&!!d.querySelector(".db .arow")})()', '太郎の学生詳細にアンケートが出る');
    const heads = await ev('[...document.querySelectorAll(".drawer .db .arow")].filter(r=>[...r.children].some(c=>c.tagName==="BUTTON")).map(r=>({when:r.querySelector(".q").textContent,tags:[...r.querySelectorAll(":scope > .tags .tag")].map(e=>e.textContent)}))');
    await shot('pc_4_student.png');
    check('学生詳細：今回と前回の回答が、回の名前つきで出る', [heads.some(x => x.when.endsWith('・ ' + T.cur)), heads.some(x => x.when.endsWith('・ ' + T.prev))], [true, true]);
    known('学生の詳細が取り消した回の回答を、ふつうの回答と同じ見た目で並べる＝src/assets/admin.js:712-730 stOpen() が is_void を読んでおらず、絞っても印を付けてもいない',
      '学生詳細：取り消した回の回答が出ない（または取り消しと分かる）', heads.filter(x => x.when.includes('取り消し')).map(x => x.when.replace(/^.*・ /, '')), []);
    await ev('document.querySelector(".drawer .x").click()');

    /* ════════ スマホ：master-phone.html（同じダミー・同じ線） ════════ */
    console.log('── スマホ ⑫同じダミーで同じ数になる ──');
    who = 'phone';
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const phoneUrl = pathToFileURL(path.join(srcDir, 'master-phone.html')).href;
    await cdp('Page.navigate', { url: phoneUrl });
    await until('document.readyState==="complete"', 'スマホ画面の読み込み');
    await ev('localStorage.setItem("sp_token","dummy-token");localStorage.setItem("sp_profile",JSON.stringify({student_no:"m001",display_name:"ダミー マスター",role:"master",class_name:null}))');
    await cdp('Page.reload');
    const cardSel = 'document.querySelector(' + J('section.card[aria-label="進路アンケート（2027年1月） ' + T.cur + '"]') + ')';
    await until('!!' + cardSel, 'スマホのホームに今回の回のカード');
    const ph = await ev(`(()=>{const c=${cardSel};return {n:c.querySelector(".cnt .n").textContent,of:c.querySelector(".cnt .of").textContent,svs:c.querySelector(".svs").textContent,
      cards:[...document.querySelectorAll("section.card")].map(x=>x.getAttribute("aria-label")),text:document.querySelector(".app").innerText}})()`);
    await shot('phone_1_home.png');
    check('スマホ ホーム：提出 6 / 8人・対象 8人（3クラス）', [ph.n, ph.of, ph.svs], ['6', '/ 8人 提出', '対象 8人（3クラス）']);
    check('スマホ ホーム：カードは受付中の2本だけ（取り消した回・終了した回は出ない）・「終了したアンケート（2）」',
      [sorted(ph.cards), ph.text.includes('終了したアンケート（2）')], [sorted(['進路アンケート（2027年1月） ' + T.cur, await ev('SURVEYS.find(s=>s.key===' + J(OTHER) + ').title.ja') + ' ' + T.other]), true]);
    const goHash = async (h, readySel, label) => { await ev('location.hash=' + J(h)); await until('location.hash===' + J(h) + '&&!!document.querySelector(' + J(readySel) + ')', label); };
    await goHash('#/all/' + R.cur, '.cnt .r', 'スマホ 全体の提出状況');
    const phAll = await ev('({n:document.querySelector(".cnt .n").textContent,of:document.querySelector(".cnt .of").textContent,r:document.querySelector(".cnt .r").textContent,rows:[...document.querySelectorAll(".rows li")].map(li=>li.querySelector(".c").textContent+" "+li.querySelector(".l").textContent)})');
    check('スマホ 全体：6 / 8人・未提出 2人（6＋2＝8）', [phAll.n, phAll.of, phAll.r], ['6', '/ 8人', '未提出 2人']);
    check('スマホ 全体：クラス別（C① は指定学生の1人だけ＝全員提出）', sorted(phAll.rows), sorted(['A① 未提出 1', 'B① 未提出 1', 'C① 全員提出']));
    await goHash('#/class/' + R.cur + '/' + encodeURIComponent(A), '.hd-big', 'スマホ A①クラス');
    const phA = await ev('({rest:document.querySelector(".hd-big .v b").textContent,of:document.querySelector(".hd-big .of b").textContent,names:[...document.querySelectorAll(".list.rest .nm")].map(e=>e.querySelector("b").textContent+" "+e.querySelector("span").textContent)})');
    await shot('phone_2_class.png');
    check('スマホ A①：未提出 1人（テスト四郎 2604996）・3 / 4人 提出', [phA.rest, phA.of, phA.names], ['1', '3 / 4人 提出', ['テスト四郎 2604996']]);
    known('PC とスマホで「提出」の数が違う（PC 7・スマホ 6）＝スマホ master-phone.html:259-266 scope() は対象で絞るが、PC admin.js:165-173 svScope() は絞らない。「基本の機能はスマホと PC で同じ」に反する',
      'PC とスマホで今回の「提出」の数が同じ', s1.count, ph.n);
    check('スマホは回答の中身（answers）を1度も取りに行かない', log.gets.filter(g => g.who === 'phone' && g.table === 'survey_responses' && /answers/.test(g.query)).length, 0);

    console.log('── 全体 ──');
    check('回答を読む要求は必ず回で絞っている（round_id か student_id の条件つき）', log.gets.filter(g => g.table === 'survey_responses' && !/round_id=(eq|in)\./.test(g.query) && !/student_id=eq\./.test(g.query)).map(g => g.query), []);
    check('偽サーバーが知らない条件は来ていない（黙って全件を返していない）', log.unknown, []);
    check('書き込みの要求は0件', log.writes, []);
    check('外への通信は CDN のライブラリ2つだけで、それも止めた', sorted([...new Set(log.blocked)]).filter(h => h !== 'cdnjs.cloudflare.com'), []);
    check('JS の例外 0件', exceptions, []);
  } finally {
    try { socket && socket.close(); } catch (e) {}
    child.kill();
  }
  const fail = results.filter(r => r.kind === 'check' && !r.ok).length;
  const xfail = results.filter(r => r.kind === 'known' && !r.ok).length, xpass = results.filter(r => r.kind === 'known' && r.ok).length;
  const ok = results.filter(r => r.kind === 'check' && r.ok).length;
  console.log('\n' + ok + ' / ' + results.filter(r => r.kind === 'check').length + ' OK ・ 既知の不具合（XFAIL） ' + xfail + '件' + (xpass ? ' ・ 直った印（XPASS） ' + xpass + '件＝known を check に書き換える' : '') + '  画像: ' + out);
  process.exit(fail || xpass ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
