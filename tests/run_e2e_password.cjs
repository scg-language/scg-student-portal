/* パスワードを かえる（学生画面）の通し検査 — 2026-11-20
 * ★通信なし：Supabase への要求はすべて CDP の Fetch で横取りして、見本の返事を返す（本物の DB・資格情報は使わない）
 * 見ること
 *   1 初期パスワードのまま（my_password_is_initial=true）でログイン → ホームでなく決め直しの画面。もどるボタンなし・タブなし
 *   2 手元の検査：短い／えいごだけ／全角／初期パスワードと同じ／2つが違う は送らずに理由を出す
 *   3 サーバーが weak_password(pwned) で断る → 英文でなく学生の言葉
 *   4 通る → ホームへ・「かえました」のシート・保存のすすめ
 *   5 マイから開く → もどるボタンあり・もどれる
 *   6 初期でない（false）ならホームへ直行／RPC が無い（404）でもホームへ直行（DB 適用前でもログインを止めない）
 *   7 送ったパスワードがサーバーへ届いた形（PUT /auth/v1/user の password）
 *   node tests/run_e2e_password.cjs */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..'), out = path.join(repo, '_scratch', 'password-qa');
  fs.mkdirSync(out, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-pw-e2e-'));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), checks = [], exceptions = [];
  let socket, seq = 0;
  // 見本の返事を切り替えるつまみ
  const mock = { initial: true, rpcMissing: false, putQueue: [], puts: [], other: 0 };
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
      if (u.pathname === '/rest/v1/rpc/my_password_is_initial') return mock.rpcMissing ? reply(id, 404, { code: 'PGRST202', message: 'Could not find the function' }) : reply(id, 200, mock.initial);
      if (u.pathname === '/auth/v1/user' && m === 'PUT') {
        mock.puts.push(JSON.parse(rq.postData || '{}'));
        const r = mock.putQueue.shift() || [200, { id: 'x' }];
        return reply(id, r[0], r[1]);
      }
      mock.other++;
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
    const shot = async n => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, n), Buffer.from(r.data, 'base64')); };
    const check = async (name, x) => { const ok = typeof x === 'string' ? await ev(x) : await x; checks.push({ name, ok: !!ok }); if (!ok) { await shot('failure.png'); throw new Error('FAILED: ' + name); } };
    const until = async (x, ms = 6000) => { for (let i = 0; i < ms / 60; i++) { if (await ev(x)) return true; await pause(60); } return false; };
    const click = async sel => {
      const pt = await ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)throw Error("missing "+' + JSON.stringify(sel) + ');e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...pt });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...pt }); await pause(150);
    };
    const val = (id, v) => ev('document.getElementById(' + JSON.stringify(id) + ').value=' + JSON.stringify(v));
    const tryPw = async (a, b) => { await val('pw-new', a); await val('pw-new2', b); await click('#btn-pw-save'); await pause(200); return ev('document.getElementById("pw-msg").textContent'); };
    const fresh = async () => {
      await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'index.html')).href });
      await until('(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"})()');
      await ev('localStorage.clear();sessionStorage.clear()');
      await cdp('Page.reload');      // ★前の検査のログインが残っていると、ログイン欄が出ないまま押してしまう
      await until('(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"&&!document.getElementById("scr-login").hidden})()');
    };
    const login = async () => { await val('in-no', 's039'); await val('in-pw', 'scgs039'); await click('#btn-login'); };

    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    // 1
    await fresh(); mock.initial = true; await login();
    await check('1 初期パスワードなら決め直しの画面', until('!document.getElementById("scr-password").hidden'));
    await check('1 ホームは出ない・タブは隠れる', '!!document.getElementById("scr-mypage").hidden && !!document.getElementById("tabbar").hidden');
    await check('1 もどるボタンなし・ログアウトあり', '!!document.getElementById("btn-pw-back").hidden && !document.getElementById("btn-pw-logout").hidden');
    await check('1 決まりを先に見せる', 'document.querySelector("#scr-password .pw-rules").textContent.includes("8もじ")');
    await check('1 目のボタンが付く', '!!document.querySelector("#scr-password .pwbtn") || !!document.querySelector("#scr-password [data-pw-eye]")');
    await check('1 ブラウザ保存用の番号', 'document.getElementById("pw-user").value==="s039"');
    await shot('forced.png');
    // 2
    const n0 = mock.puts.length;
    await check('2 短い', (await tryPw('abc123', 'abc123')).includes('8もじ'));
    await check('2 えいごだけ', (await tryPw('abcdefghij', 'abcdefghij')).includes('すうじ'));
    await check('2 全角', (await tryPw('ａｂｃ１２３４５６', 'ａｂｃ１２３４５６')).includes('にほんご'));
    await check('2 初期パスワード（8字以上の番号）', (await (async () => { await ev('api.profile.student_no="2604999"'); const m = await tryPw('scg2604999', 'scg2604999'); await ev('api.profile.student_no="s039"'); return m; })()).includes('はじめの'));
    await check('2 2つが違う', (await tryPw('abcd1234', 'abcd1235')).includes('ちがいます'));
    await check('2 ここまでサーバーへ送っていない', mock.puts.length === n0);
    // 3
    mock.putQueue.push([422, { code: 422, error_code: 'weak_password', msg: 'Password is known to be weak and easy to guess', weak_password: { reasons: ['pwned'] } }]);
    const m3 = await tryPw('password123', 'password123');
    await check('3 pwned を学生の言葉で', m3.includes('よく つかわれて') && !/weak|guess/i.test(m3));
    mock.putQueue.push([422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }]);
    await check('3 same_password', (await tryPw('abcd1234', 'abcd1234')).includes('おなじ'));
    await check('3 まだ決め直しの画面のまま', '!document.getElementById("scr-password").hidden');
    // 4・7
    await val('pw-new', 'kiwi2026x'); await val('pw-new2', 'kiwi2026x'); await click('#btn-pw-save');
    await check('4 通ったらホームへ', until('!document.getElementById("scr-mypage").hidden'));
    await check('4 かえましたのシート', until('!document.getElementById("sheet").hidden && document.getElementById("sheet-body").textContent.includes("かえました") && document.getElementById("sheet-body").textContent.includes("ほぞん")'));
    await check('4 入力欄は空に戻る', 'document.getElementById("pw-new").value==="" && document.getElementById("pw-new2").value===""');
    await check('7 送った形', mock.puts.at(-1).password === 'kiwi2026x' && Object.keys(mock.puts.at(-1)).length === 1);
    await shot('done.png');
    // 5
    await ev('sheet.close(true)'); await ev('goSettings()');
    await click('#set-pw');
    await check('5 マイから開ける・もどるあり', '!document.getElementById("scr-password").hidden && !document.getElementById("btn-pw-back").hidden && !!document.getElementById("btn-pw-logout").hidden');
    await check('5 題名が「かえる」', 'document.getElementById("pw-title").textContent==="パスワードを かえる"');
    await click('#btn-pw-back');
    await check('5 もどるでマイへ', '!document.getElementById("scr-settings").hidden');
    // 6
    await fresh(); mock.initial = false; await login();
    await check('6 初期でなければホームへ直行', until('!document.getElementById("scr-mypage").hidden'));
    await fresh(); mock.rpcMissing = true; await login();
    await check('6 RPC が無くてもホームへ直行', until('!document.getElementById("scr-mypage").hidden'));
    // 再読み込み（保存済みのログインで開く）でも初期なら決め直し
    mock.rpcMissing = false; mock.initial = true;
    await cdp('Page.reload');
    // ★再読み込みの直後は、まだ要素が無い瞬間がある（null の .hidden を読んで例外＝約1/8で落ちていた・2026-11-21）。
    //   待ち時間は延ばさず、「要素があって、出ている」を条件にする
    await check('6 再読み込みでも初期なら決め直し', until('(()=>{const e=document.getElementById("scr-password");return !!e&&!e.hidden})()'));
    // 英語
    await ev('setLang && setLang("en")').catch(() => {});
    await check('英語の題名', until('/Set your new password|あたらしい/.test(document.getElementById("pw-title").textContent)'));

    await check('JS の例外なし', exceptions.length === 0);
  } finally {
    const ok = checks.filter(c => c.ok).length;
    for (const c of checks) console.log((c.ok ? 'OK  ' : 'NG  ') + c.name);
    if (exceptions.length) console.log('exceptions:', exceptions.slice(0, 3));
    console.log(ok + '/' + checks.length + ' passed');
    try { socket && socket.close(); } catch (e) {}
    child.kill();
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
