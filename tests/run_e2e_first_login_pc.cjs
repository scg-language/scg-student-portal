/* PC のマスター画面「はじめてのログイン」（受付）の通し検査 — 2026-11-25
 * ★通信なし（Supabase への要求は CDP で横取りして見本を返す）。値はすべてダミー（学籍番号は 26049xx の帯）
 *   A 権限（first_login.check）が無い人には左のメニューに出さない
 *   B 権限がある人：受付中・確認できる人・今日の確認済みの数／受付中の表（決め直した人だけに「確認済みにする」）
 *   C 押す → DB の口に（その学生, true）を送る・下に名前と「取り消す」・数が変わる／「取り消す」で（その学生, false）
 *   D 今日の確認済みの「取り消す」は、確かめてから送る
 *   E クラス別は人数だけ → 開くと、そのクラスの「まだログインしていない」名前（DB にクラスを渡して読む）
 *   F ほかの画面へ移ると、10秒ごとの取り直しが止まる／横にはみ出さない／innerHTML を使っていない
 *   node tests/run_e2e_first_login_pc.cjs */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..'), out = path.join(repo, 'tmp', 'shots', 'first-login-pc');
  fs.mkdirSync(out, { recursive: true });
  const checks = [], exceptions = [];
  const flSrc = fs.readFileSync(path.join(repo, 'src', 'assets', 'first-login.js'), 'utf8');
  const record = (name, ok) => { checks.push({ name, ok: !!ok }); console.log((ok ? 'OK   ' : 'FAIL ') + name); };
  record('F innerHTML を使っていない（名前は textContent）', !/\.innerHTML\s*=/.test(flSrc));
  const code = flSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const leaked = ['えらぶ', 'ぜんいん', 'しめきり', 'おわった', 'とじる', 'もどる', 'よみこみ', 'かくにん', 'とりけす'].filter(w => code.includes(w));
  record('F 文言：学生画面の言い回し（ひらがな書き）が混ざっていない', leaked.length === 0);

  /* ── 見本の DB（first_login_board / first_login_mark と同じ形） ── */
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const S = [
    ['A1クラス', 'changed', ago(50), ago(46)], ['A1クラス', 'changed', ago(9), null], ['A1クラス', 'initial', ago(7), null], ['A1クラス', null, null, null], ['A1クラス', null, null, null],
    ['A2クラス', 'changed', ago(40), ago(38)], ['A2クラス', 'unknown', ago(3), null], ['A2クラス', null, null, null], ['A2クラス', null, null, null],
    ['B1クラス', null, null, null], ['B1クラス', null, null, null], ['B1クラス', null, null, null],
  ].map(([cls, pw, signed, checked], i) => ({ id: '00000000-0000-0000-0000-0000000009' + String(i + 10), student_no: '26049' + String(80 + i),
    name: '見本 学生' + String(i + 1).padStart(2, '0'), cls, pw, signed_at: signed, checked_at: checked }));
  const mock = { caps: ['student.read'], marks: [], boards: [] };
  const pwOf = s => s.pw === 'changed' ? 'changed' : s.pw === 'initial' ? 'initial' : null;
  function board(c) {
    const g = {};
    S.forEach(s => { const x = g[s.cls] = g[s.cls] || { class: s.cls, target: 0, not_yet: 0, checked: 0 }; x.target++; if (!s.signed_at) x.not_yet++; if (s.checked_at) x.checked++; });
    return {
      today: new Date().toISOString().slice(0, 10), classes: Object.values(g),
      active: S.filter(s => s.signed_at && !s.checked_at).sort((a, b) => a.signed_at.localeCompare(b.signed_at))
        .map(s => ({ id: s.id, student_no: s.student_no, name: s.name, class: s.cls, signed_at: s.signed_at, pw: pwOf(s) })),
      done: S.filter(s => s.checked_at).sort((a, b) => b.checked_at.localeCompare(a.checked_at))
        .map(s => ({ id: s.id, student_no: s.student_no, name: s.name, class: s.cls, checked_at: s.checked_at })),
      rows: c == null ? null : S.filter(s => s.cls === c).map(s => ({ id: s.id, student_no: s.student_no, name: s.name,
        signed_at: s.signed_at, pw: s.checked_at ? null : pwOf(s), checked: !!s.checked_at, checked_at: s.checked_at })),
    };
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-fl-pc-'));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms)), pending = new Map();
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
      if (u.pathname === '/rest/v1/rpc/my_role') return reply(id, 200, 'master');
      if (u.pathname === '/rest/v1/rpc/my_caps') return reply(id, 200, mock.caps);
      if (u.pathname === '/rest/v1/profiles') {
        if (q.includes('id=eq.m-id')) return reply(id, 200, [{ student_no: 'm001', display_name: 'マスター', role: 'master', class_name: null }]);
        return reply(id, 200, []);
      }
      if (u.pathname === '/rest/v1/quiz_sets') return reply(id, 200, [{ id: '00000000-0000-0000-0000-0000000000b1', title: '見本のテスト', lesson: '1', is_open: false, created_at: '2026-11-01T00:00:00Z', source_book: null, source_file: null, source_sheet: null, questions: [{ count: 1 }] }]);
      if (u.pathname === '/rest/v1/rpc/quiz_stats') return reply(id, 200, { count: 0, avg: null, attempts: [], questions: [], focus: {} });
      if (u.pathname === '/rest/v1/rpc/first_login_board') {
        const b = JSON.parse(rq.postData || '{}'); mock.boards.push(b.p_class === undefined ? 'undefined' : b.p_class);
        return reply(id, 200, board(b.p_class == null ? null : b.p_class));
      }
      if (u.pathname === '/rest/v1/rpc/first_login_mark') {
        const b = JSON.parse(rq.postData || '{}'); mock.marks.push([b.p_student_id, b.p_checked]);
        const s = S.find(x => x.id === b.p_student_id);
        if (!s) return reply(id, 404, { code: 'P0002', message: '学生が見つかりません' });
        if (b.p_checked && s.pw !== 'changed') return reply(id, 409, { code: 'PT409', message: 'この学生は、まだパスワードを決め直していません' });
        const was = !!s.checked_at;
        if (b.p_checked && !was) s.checked_at = new Date().toISOString(); else if (!b.p_checked) s.checked_at = null;
        return reply(id, 200, { student_id: s.id, checked: !!b.p_checked, changed: was !== !!b.p_checked });
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
    const shot = async n => { const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(out, n), Buffer.from(r.data, 'base64')); };
    const check = async (name, x) => { let ok = false; try { ok = typeof x === 'string' ? await ev(x) : await x; } catch (e) { ok = false; } record(name, ok); };
    const until = async (x, ms = 8000) => { for (let i = 0; i < ms / 80; i++) { try { if (await ev(x)) return true; } catch (e) {} await pause(80); } return false; };
    const click = sel => ev('(' + sel + ').click()').then(() => pause(250));
    const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';
    const ready = '(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"})()';
    const navBtn = q('[data-view=firstlogin]');
    const open = async () => {
      await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'master.html')).href });
      await until(ready);
      await ev('localStorage.clear();sessionStorage.clear()'); await cdp('Page.reload'); await until(ready);
      await ev('document.getElementById("in-no").value="m001";document.getElementById("in-pw").value="x"');
      await click(q('#btn-login'));
      await until('(()=>{const b=document.querySelector("[data-view=students]");return b&&b.offsetParent!==null})()');
      await pause(400);   // my_caps の返事を待つ（待たずに出し分けている）
    };
    const noOverflow = () => ev('document.documentElement.scrollWidth <= window.innerWidth');
    const kpi = 'document.getElementById("fl-kpi").innerText.replace(/\\s+/g," ")';

    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false });

    /* A 権限が無い人（常勤）には出さない */
    await open();
    await check('A 権限が無い常勤：左のメニューに「はじめてのログイン」を出さない', '!!' + navBtn + ' && ' + navBtn + '.hidden === true');
    await check('A 受付の DB の口を読みに行かない', mock.boards.length === 0);

    /* B 権限がある人 */
    mock.caps = ['student.read', 'account.manage', 'first_login.check'];
    await open();
    await check('B 権限がある人：左のメニューに出る（「学生」の下）', navBtn + '.hidden === false && ' + navBtn + '.previousElementSibling.dataset.view === "students"');
    await click(navBtn);
    await until('!!document.querySelector("#fl-act table")');
    await check('B 開くと全体を読む（クラスを渡さない）', mock.boards[0] === null);
    await check('B 数：受付中 3・確認できる人 1・今日の確認済み 2', '(()=>{const t=' + kpi + ';return /3 受付中/.test(t)&&/1 確認できる人/.test(t)&&/2 今日の確認済み/.test(t)})()');
    await check('B 受付中の表：3行・ログインした順（先頭は A1 の見本 学生02）', 'document.querySelectorAll("#fl-act tbody tr").length===3 && document.querySelector("#fl-act tbody tr b").textContent==="見本 学生02"');
    await check('B 決め直した人だけに「確認済みにする」（1つ）・ほかは「パスワードまだ」「照合中」', 'document.querySelectorAll("#fl-act .abtn.pri").length===1 && /パスワードまだ/.test(document.getElementById("fl-act").innerText) && /照合中/.test(document.getElementById("fl-act").innerText)');
    await check('B 今日の確認済み：2行・どの行にも「取り消す」', 'document.querySelectorAll("#fl-done tbody tr").length===2 && document.querySelectorAll("#fl-done .abtn").length===2');
    await check('B クラス別：3クラス・名前を出さない', 'document.querySelectorAll("#fl-cls tbody tr").length===3 && !/見本 学生/.test(document.getElementById("fl-cls").innerText)');
    await check('B 横にはみ出さない（1400px）', noOverflow());
    await shot('1_board.png');

    /* C 押す → 取り消す */
    await click(q('#fl-act .abtn.pri'));
    await until('!!document.getElementById("fl-toast") && !document.getElementById("fl-toast").hidden');
    await check('C DB の口に（見本 学生02, true）を送る', mock.marks.length === 1 && mock.marks[0][0] === S[1].id && mock.marks[0][1] === true);
    await check('C 下に「見本 学生02 さんを確認済みにしました」と「取り消す」', 'document.querySelector("#fl-toast .t").textContent==="見本 学生02 さんを確認済みにしました" && !!document.querySelector("#fl-toast button")');
    await until('/2 受付中/.test(' + kpi + ')');
    await check('C 数が変わる：受付中 2・今日の確認済み 3', '(()=>{const t=' + kpi + ';return /2 受付中/.test(t)&&/3 今日の確認済み/.test(t)})()');
    await shot('2_marked.png');
    await click(q('#fl-toast button'));
    await until('/3 受付中/.test(' + kpi + ')');
    await check('C 「取り消す」で（見本 学生02, false）を送り、受付中 3 に戻る', mock.marks.length === 2 && mock.marks[1][0] === S[1].id && mock.marks[1][1] === false);

    /* D 今日の確認済みの「取り消す」は確かめてから */
    const before = mock.marks.length;
    await click(q('#fl-done tbody .abtn'));
    await until('document.getElementById("cfm-dlg").open');
    await check('D 確かめる窓が出る（まだ送らない）', mock.marks.length === before);
    await click(q('#cfm-ok'));
    await until('document.querySelectorAll("#fl-done tbody tr").length===1');
    await check('D 「取り消す」を押すと送り、確認済みが1行になる', mock.marks.length === before + 1 && mock.marks[before][1] === false);

    /* E クラスを開く */
    await click('[...document.querySelectorAll("#fl-cls tbody tr")].find(e=>e.dataset.cls==="A1クラス")');
    await until('!document.getElementById("fl-one").hidden && !!document.getElementById("fl-one-notyet")');
    await check('E A1 を開くと DB にクラスを渡して読む', mock.boards.includes('A1クラス'));
    await check('E まだログインしていない 2人の名前＋学籍番号', 'document.querySelectorAll("#fl-one-notyet .fl-name").length===2 && [...document.querySelectorAll("#fl-one-notyet .fl-name span")].every(e=>/^\\s?26049\\d\\d$/.test(e.textContent))');
    await check('E 受付中（このクラス）2人', '/受付中（2人）/.test(document.getElementById("fl-one").innerText)');
    await check('E 横にはみ出さない（1400px）', noOverflow());
    await shot('3_class.png');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(200);
    await check('E 横にはみ出さない（1024px）', noOverflow());
    await shot('3_class_1024.png');
    await click(q('#fl-one .a-head .abtn'));
    await check('E 「閉じる」でクラスの欄が消える', 'document.getElementById("fl-one").hidden');

    /* F ほかの画面へ移ると取り直しを止める */
    await check('F 受付を開いている間は取り直しが動いている', 'FirstLogin.pc._state.timer !== null');
    await click(q('[data-view=today]'));
    await check('F ほかの画面へ移ると止まる', 'FirstLogin.pc._state.timer === null');
    await check('F JS の例外 0件', exceptions.length === 0);
    if (exceptions.length) console.log('  例外: ' + exceptions.join(' / '));
  } finally {
    try { socket && socket.close(); } catch (e) {}
    child.kill();
  }
  const ng = checks.filter(c => !c.ok).length;
  console.log('\n' + (checks.length - ng) + ' / ' + checks.length + ' OK  画像: ' + out);
  process.exit(ng ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
