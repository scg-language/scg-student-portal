/* はじめのお知らせ（個人情報のあつかい・学生画面）の通し検査 — 2026-11-22
 * ★通信なし：Supabase への要求はすべて CDP の Fetch で横取りして、見本の返事を返す（本物の DB・資格情報は使わない）
 * 見ること
 *   0 文に【　】が残っている間は ready=false。そのままなら、まだ読んでいなくてもホームへ直行（お知らせを出さない）
 *   1 ready=true・まだ読んでいない → ログインのあと、ホームでなくお知らせ。もどるボタンなし・タブなし・ボタンは「よみました」1つ
 *   2 言語を英語にすると文も英語になる
 *   3 「よみました」→ サーバーへ届く形（鍵・版・言語）→ ホームへ
 *   4 読んだあとはホームへ直行。マイから読み直せる（読むだけ・もどれる・送らない）
 *   5 文が新しくなっていた（409）→ 読み込み直しの案内。ホームへ進まない
 *   6 RPC が無い（404）／画面と DB の版が違う → ホームへ直行（ログインを止めない）
 *   7 初期パスワードのとき：パスワード → お知らせ → ホームの順
 *   8 前の版を読んだ学生には「かわった ところが あります」が出る
 *   node tests/run_e2e_notice.cjs */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..'), out = path.join(repo, '_scratch', 'notice-qa');
  fs.mkdirSync(out, { recursive: true });
  const src = fs.readFileSync(path.join(repo, 'src', 'assets', 'policy-notice.js'), 'utf8');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-notice-e2e-'));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), checks = [], exceptions = [];
  let socket, seq = 0;
  // 見本の返事を切り替えるつまみ
  const mock = { initial: false, rpcMissing: false, version: 1, read: false, readBefore: false, ackQueue: [], acks: [], statusCalls: 0 };
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, { name: 'Content-Type', value: 'application/json' }];
    const reply = (id, status, body) => cdp('Fetch.fulfillRequest', { requestId: id, responseCode: status, responseHeaders: CORS, body: Buffer.from(body == null ? '' : JSON.stringify(body)).toString('base64') }).catch(() => {});
    function route(p) {
      const { requestId: id, request: rq } = p, u = new URL(rq.url), m = rq.method;
      if (m === 'OPTIONS') return reply(id, 204, null);
      if (u.pathname === '/auth/v1/token') return reply(id, 200, { access_token: 'tok', refresh_token: 'rt', user: { id: '00000000-0000-0000-0000-000000000039' } });
      if (u.pathname === '/rest/v1/profiles') return reply(id, 200, [{ student_no: 's039', display_name: 'テスト太郎', role: 'student', class_name: 'A①クラス' }]);
      if (u.pathname === '/rest/v1/rpc/my_password_is_initial') return reply(id, 200, mock.initial);
      if (u.pathname === '/auth/v1/user' && m === 'PUT') { mock.initial = false; return reply(id, 200, { id: 'x' }); }
      if (u.pathname === '/rest/v1/rpc/my_notice_status') {
        mock.statusCalls++;
        if (mock.rpcMissing) return reply(id, 404, { code: 'PGRST202', message: 'Could not find the function' });
        return reply(id, 200, { key: 'student_privacy', version: mock.version, read: mock.read, read_at: mock.read ? '2026-12-15T01:00:00Z' : null, read_before: mock.readBefore, required: !mock.read });
      }
      if (u.pathname === '/rest/v1/rpc/ack_notice') {
        mock.acks.push(JSON.parse(rq.postData || '{}'));
        const r = mock.ackQueue.shift();
        if (r) return reply(id, r[0], r[1]);
        mock.read = true;
        return reply(id, 200, '2026-12-15T01:00:00Z');
      }
      return reply(id, 200, []);    // それ以外（アンケートの回・テストの数など）は空
    }
    socket.addEventListener('message', ev => {
      const k = JSON.parse(ev.data);
      if (k.id) { const p = pending.get(k.id); if (!p) return; pending.delete(k.id); k.error ? p.reject(new Error(JSON.stringify(k.error))) : p.resolve(k.result || {}); }
      else if (k.method === 'Runtime.exceptionThrown') exceptions.push(k.params.exceptionDetails.exception?.description || k.params.exceptionDetails.text);
      else if (k.method === 'Fetch.requestPaused') {
        const u = k.params.request.url;
        if (u.startsWith('file:')) cdp('Fetch.continueRequest', { requestId: k.params.requestId }).catch(() => {});
        else if (u.includes('.supabase.co')) route(k.params);
        else cdp('Fetch.failRequest', { requestId: k.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    });
    const ev = async x => { const r = await cdp('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const shot = async n => { const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(out, n), Buffer.from(r.data, 'base64')); };
    const check = async (name, x) => { const ok = typeof x === 'string' ? await ev(x) : await x; checks.push({ name, ok: !!ok }); if (!ok) { await shot('failure.png'); throw new Error('FAILED: ' + name); } };
    const until = async (x, ms = 6000) => { for (let i = 0; i < ms / 60; i++) { if (await ev(x)) return true; await pause(60); } return false; };
    const click = async sel => {
      const pt = await ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)throw Error("missing "+' + JSON.stringify(sel) + ');e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...pt });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...pt }); await pause(150);
    };
    const val = (id, v) => ev('document.getElementById(' + JSON.stringify(id) + ').value=' + JSON.stringify(v));
    const shown = id => '(()=>{const e=document.getElementById(' + JSON.stringify(id) + ');return !!e&&!e.hidden})()';
    // ready＝文が決まったことにするか（本物のファイルは、【　】が残っている間 false）
    const fresh = async ready => {
      await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'index.html')).href });
      await until('(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"})()');
      await ev('localStorage.clear()');
      await cdp('Page.reload');      // ★前の検査のログインが残っていると、ログイン欄が出ないまま押してしまう
      await until('(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"&&!document.getElementById("scr-login").hidden})()');
      if (ready) await ev('window.POLICY_NOTICE.ready=true, document.getElementById("set-notice").hidden=false, true');
    };
    const login = async () => { await val('in-no', 's039'); await val('in-pw', 'scgs039'); await click('#btn-login'); };

    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    // 0 文が決まるまで出さない
    await check('0 【　】が残っている間は ready が false（ファイル）', !/【/.test(src) || /ready:\s*false/.test(src));
    await fresh(false);
    await check('0 【　】の有無と ready が食い違っていない（画面）', '!(window.POLICY_NOTICE.hasTodo() && window.POLICY_NOTICE.ready)');
    await check('0 文の中に書き込み用の HTML が無い', '!/[<>]/.test(JSON.stringify(window.POLICY_NOTICE.sections))');
    await login();
    await check('0 ready=false なら、まだ読んでいなくてもホームへ直行', until(shown('scr-mypage')));
    await check('0 ready=false の間はサーバーに聞かない・マイにも出さない', mock.statusCalls === 0 && (await ev('document.getElementById("set-notice").hidden')));

    // 1 まだ読んでいない → お知らせ
    await fresh(true); await login();
    await check('1 ログインのあと、お知らせが出る', until(shown('scr-notice')));
    await check('1 ホームは出ない・タブは隠れる', '!!document.getElementById("scr-mypage").hidden && !!document.getElementById("tabbar").hidden');
    await check('1 もどるボタンなし・ログアウトあり', '!!document.getElementById("btn-nt-back").hidden && !document.getElementById("btn-nt-logout").hidden');
    await check('1 8つの節が出る', 'document.querySelectorAll("#nt-body .pn-h").length===8');
    await check('1 ボタンは「よみました」1つ（同意・不同意のボタンは無い）', 'document.querySelectorAll("#scr-notice .btn").length===1 && document.getElementById("btn-nt-read").textContent==="よみました" && !/同意 します|同意 しません/.test(document.getElementById("scr-notice").textContent)');
    await check('1 AI の2つの約束が入っている', '(()=>{const t=document.getElementById("nt-body").textContent;return t.includes("AI だけで")&&t.includes("AI の 学習に つかいません")})()');
    await check('1 横にはみ出さない', 'document.documentElement.scrollWidth<=window.innerWidth+1');
    await shot('gate.png');

    // 2 言語
    await click('#btn-nt-lang');
    await check('2 言語のシートが出る', until('!document.getElementById("sheet").hidden'));
    await ev('setLang("en"); sheet.close(true); true');
    await check('2 英語にすると文も英語', until('document.getElementById("nt-title").textContent.includes("Important notice") && document.getElementById("btn-nt-read").textContent==="I have read this" && document.querySelector("#nt-body .pn-h").textContent.includes("Information")'));

    // 5 文が新しくなっていた（先に試す：まだ読んでいない状態が要る）
    mock.ackQueue.push([409, { code: 'PT409', message: 'お知らせが新しくなりました。読み込み直してください' }]);
    await click('#btn-nt-read');
    await check('5 409 なら読み込み直しの案内（サーバーの文は出さない）', until('/reload/i.test(document.getElementById("nt-msg").textContent)'));
    await check('5 ホームへ進まない', shown('scr-notice'));
    mock.ackQueue.push([500, { message: 'x' }], [500, { message: 'x' }], [500, { message: 'x' }], [500, { message: 'x' }]);
    await ev('setLang("ja"); true');

    // 3 よみました
    const before = mock.acks.length;
    await ev('document.getElementById("btn-nt-read").click(), true');
    await check('3 通信に失敗したら、もういちど押す案内', until('document.getElementById("nt-msg").textContent.includes("もういちど")', 20000));
    await click('#btn-nt-read');
    await check('3 押すとホームへ', until(shown('scr-mypage')));
    const last = mock.acks.at(-1);
    await check('3 サーバーへ届く形（鍵・版・言語だけ）', last.p_key === 'student_privacy' && last.p_version === 1 && last.p_lang === 'ja' && Object.keys(last).length === 3 && mock.acks.length > before);

    // 4 読んだあと
    await cdp('Page.reload');
    await check('4 読んだあとの再読み込みはホームへ直行', until(shown('scr-mypage')));
    await ev('window.POLICY_NOTICE.ready=true, document.getElementById("set-notice").hidden=false, goSettings(), true');
    const acks4 = mock.acks.length;
    await click('#set-notice');
    await check('4 マイから読み直せる', until(shown('scr-notice')));
    await check('4 読むだけ：よみましたは無い・もどるあり・読んだ日が出る', '!!document.getElementById("btn-nt-read").hidden && !document.getElementById("btn-nt-back").hidden && !!document.getElementById("btn-nt-logout").hidden && document.getElementById("nt-readon").textContent.includes("よみました")');
    await shot('reread.png');
    await click('#btn-nt-back');
    await check('4 もどるでマイへ・何も送っていない', (await until(shown('scr-settings'))) && mock.acks.length === acks4);

    // 6 止めない
    await fresh(true); mock.read = false; mock.rpcMissing = true; await login();
    await check('6 RPC が無くてもホームへ直行', until(shown('scr-mypage')));
    await fresh(true); mock.rpcMissing = false; mock.version = 2; await login();
    await check('6 画面と DB の版が違うときは出さない（ホームへ直行）', until(shown('scr-mypage')));
    mock.version = 1;

    // 7 初期パスワード → お知らせ → ホーム
    await fresh(true); mock.initial = true; mock.read = false; await login();
    await check('7 先にパスワードの決め直し', until(shown('scr-password')));
    await val('pw-new', 'kiwi2026x'); await val('pw-new2', 'kiwi2026x'); await click('#btn-pw-save');
    await check('7 つぎにお知らせ（ホームではない）', (await until(shown('scr-notice'))) && (await ev('!!document.getElementById("scr-mypage").hidden')));
    await ev('sheet.close(true), true');
    await click('#btn-nt-read');
    await check('7 さいごにホーム', until(shown('scr-mypage')));

    // 8 前の版を読んだ学生
    await fresh(true); mock.read = false; mock.readBefore = true; await login();
    await check('8 かわった ところの案内が出る', (await until(shown('scr-notice'))) && (await ev('!document.getElementById("nt-changed").hidden && document.getElementById("nt-changed").textContent.includes("かわった")')));

    await check('JS の例外なし', exceptions.length === 0);
  } finally {
    const ok = checks.filter(c => c.ok).length;
    for (const c of checks) console.log((c.ok ? 'OK  ' : 'NG  ') + c.name);
    if (exceptions.length) console.log('exceptions:', exceptions.slice(0, 3));
    console.log(ok + '/' + checks.length + ' passed');
    try { socket && socket.close(); } catch (e) {}
    child.kill();
    if (ok !== checks.length || !checks.length) process.exitCode = 1;
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
