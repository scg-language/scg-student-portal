/* マスター画面の「パスワードを はじめに もどす」の通し検査 — 2026-11-20
 * ★通信なし（Supabase への要求は CDP で横取りして見本を返す）
 *   1 マスターで学生の詳細を開くと「はじめに もどす」がある
 *   2 押すと確認ダイアログ（本人が目の前に・ログアウトする旨）→ やめる なら送らない
 *   3 もどす → RPC reset_student_password に p_student_id だけを送る → 完了の文言
 *   4 RPC が無い（DB 適用前）→「準備待ち」の文言（英文を出さない）
 *   5 先生（role=teacher）には出さない
 *   node tests/run_e2e_password_master.cjs */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const SID = '00000000-0000-0000-0000-0000000000a1';
async function main() {
  const repo = path.resolve(__dirname, '..'), out = path.join(repo, '_scratch', 'password-qa');
  fs.mkdirSync(out, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-pwm-e2e-'));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), checks = [], exceptions = [];
  const mock = { role: 'master', rpcMissing: false, resets: [], lastBody: null };
  let socket, seq = 0;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const H = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, { name: 'Content-Type', value: 'application/json' }];
    const reply = (id, st, b) => cdp('Fetch.fulfillRequest', { requestId: id, responseCode: st, responseHeaders: H, body: Buffer.from(b == null ? '' : JSON.stringify(b)).toString('base64') }).catch(() => {});
    function route({ requestId: id, request: rq }) {
      const u = new URL(rq.url), m = rq.method, q = decodeURIComponent(u.search);
      if (m === 'OPTIONS') return reply(id, 204, null);
      if (u.pathname === '/auth/v1/token') return reply(id, 200, { access_token: 'tok', refresh_token: 'rt', user: { id: 'm-id' } });
      if (u.pathname === '/rest/v1/rpc/my_role') return reply(id, 200, mock.role);
      if (u.pathname === '/rest/v1/profiles' && q.includes('id=eq.m-id')) return reply(id, 200, [{ student_no: 'm001', display_name: 'マスター', role: mock.role, class_name: null }]);
      if (u.pathname === '/rest/v1/profiles' && q.includes('role=eq.student')) return reply(id, 200, [{ id: SID, student_no: '2604999', display_name: 'AAA BBB', class_name: 'A①クラス' }]);
      if (u.pathname === '/rest/v1/password_reset_log') return mock.rpcMissing ? reply(id, 404, { message: 'relation does not exist' }) : reply(id, 200, mock.resets.slice(-1).map(at => ({ at })));
      if (u.pathname === '/rest/v1/rpc/reset_student_password') {
        if (mock.rpcMissing) return reply(id, 404, { code: 'PGRST202', message: 'Could not find the function public.reset_student_password(p_student_id) in the schema cache' });
        mock.resets.push(new Date().toISOString()); mock.lastBody = JSON.parse(rq.postData || '{}');
        return reply(id, 200, { student_no: '2604999', reset_at: mock.resets[mock.resets.length - 1] });
      }
      return reply(id, 200, []);
    }
    socket.addEventListener('message', e => {
      const k = JSON.parse(e.data);
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
    const check = async (name, x) => { const ok = typeof x === 'string' ? await ev(x) : await x; checks.push({ name, ok: !!ok }); if (!ok) { await shot('failure-master.png'); throw new Error('FAILED: ' + name); } };
    const until = async (x, ms = 8000) => { for (let i = 0; i < ms / 80; i++) { try { if (await ev(x)) return true; } catch (e) {} await pause(80); } return false; };
    const click = sel => ev('document.querySelector(' + JSON.stringify(sel) + ').click()').then(() => pause(250));
    const ready = '(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"})()';
    const open = async role => {
      mock.role = role;
      await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'master.html')).href });
      await until(ready);
      await ev('localStorage.clear()'); await cdp('Page.reload'); await until(ready);
      await ev('document.getElementById("in-no").value="m001";document.getElementById("in-pw").value="x"');
      await click('#btn-login');
      await until('(()=>{const b=document.querySelector("[data-view=students]");return b&&b.offsetParent!==null})()');
      await click('[data-view=students]');
      await until('!!document.querySelector("#st-table tr[data-i]")');
      await click('#st-table tr[data-i]');
    };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

    await open('master');
    await check('1 マスター：もどすボタンがある', until('!!document.getElementById("st-pw-reset")'));
    await check('1 まだ もどしたことは ありません', until('document.body.textContent.includes("まだ もどしたことは")'));
    await click('#st-pw-reset');
    await check('2 確認ダイアログ', until('document.getElementById("cfm-dlg").open && document.getElementById("cfm-body").textContent.includes("目の前") && document.getElementById("cfm-body").textContent.includes("ログアウト")'));
    await shot('master-confirm.png');
    await click('#cfm-cancel');
    await check('2 やめる なら送らない', mock.resets.length === 0);
    await click('#st-pw-reset'); await until('document.getElementById("cfm-dlg").open'); await click('#cfm-ok');
    await check('3 もどした', until('document.getElementById("st-pw-msg").textContent.includes("もどしました")'));
    await check('3 送ったのは p_student_id だけ', JSON.stringify(mock.lastBody) === JSON.stringify({ p_student_id: SID }));
    await check('3 前に もどした日時 が出る', until('document.body.textContent.includes("前に もどした日時")'));
    await shot('master-done.png');

    mock.rpcMissing = true;
    await open('master');
    await until('!!document.getElementById("st-pw-reset")');
    await check('4 記録が読めなくても壊れない', until('document.body.textContent.includes("準備待ち")'));
    await click('#st-pw-reset'); await until('document.getElementById("cfm-dlg").open'); await click('#cfm-ok');
    await check('4 RPC が無い → 準備待ち（英文を出さない）', until('document.getElementById("st-pw-msg").textContent.includes("準備待ち") && !/schema cache/.test(document.getElementById("st-pw-msg").textContent)'));
    mock.rpcMissing = false;

    await open('teacher');
    await pause(1500);
    await check('5 先生には出さない', '!document.getElementById("st-pw-reset")');
    await check('JS の例外なし', exceptions.length === 0);
  } finally {
    for (const c of checks) console.log((c.ok ? 'OK  ' : 'NG  ') + c.name);
    if (exceptions.length) console.log('exceptions:', exceptions.slice(0, 3));
    console.log(checks.filter(c => c.ok).length + '/' + checks.length + ' passed');
    try { socket && socket.close(); } catch (e) {}
    child.kill();
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
