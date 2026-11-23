/* マスター画面の「アカウントの発行」の通し検査 — 2026-11-23
 * ★通信なし（Supabase への要求は CDP で横取りして見本を返す）。値はすべてダミー（学籍番号は 999 から降順の帯）
 *   A 名簿の読み取り（通信・画面なし）：タブ区切り・CSV・Excel の表・見出し・全角とハイフンを7桁に正す／3つに分ける
 *   B 発行：名簿を貼る → 確認 → 新しく作る・すでにある・形式がおかしい の件数 → 確認ダイアログ → 発行 → 結果
 *           確認するだけでは送らない／やめる なら送らない／20件ずつ送る／断られた理由
 *   C 発行できる権限が無い人（常勤）には出さない
 *   D DB が未適用（RPC が無い）：画面は今までどおり・発行だけ「まだ使えません」（英文を出さない）
 *   F 文言：ひらがな書きが混ざっていない／表・列・RPC の名前を画面に出していない
 *   node tests/run_e2e_accounts.cjs */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
async function main() {
  const repo = path.resolve(__dirname, '..'), out = path.join(repo, '_scratch', 'accounts-qa');
  fs.mkdirSync(out, { recursive: true });
  const checks = [];
  const note = (name, ok) => { checks.push({ name, ok: !!ok }); if (!ok) throw new Error('FAILED: ' + name); };

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-acc-e2e-'));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), exceptions = [];
  const mock = { caps: ['student.read', 'account.manage'], missing: false, issueCalls: [], auths: [], oldCalls: 0 };
  let socket, seq = 0;
  try {
    /* ── A 名簿の読み取り（node で直接） ── */
    const A = require(path.join(repo, 'src', 'assets', 'accounts.js'));
    note('A1 学籍番号：全角・ハイフン・空白を取って7桁に正す', A.normalizeNo('２６-０４９９８') === '2604998' && A.normalizeNo(' 26 04 999 ') === '2604999' && A.normalizeNo('2604999') === '2604999');
    note('A1 学籍番号：7桁の数字でなければ通さない', [ 'abc', '260499', '26049990', 's2604999', '', null ].every(x => A.normalizeNo(x) === null));
    const tsv = A.parseRoster('学籍番号\t氏名\tクラス\r\n2604999\tテスト太郎\tA1クラス\r\n\r\n26-04998\t テスト花子 \tB2クラス\r\n');
    note('A2 タブ区切り：見出しと空行を飛ばし、2人を読む。行番号は元のまま', tsv.length === 2 && tsv[1].line === 4);
    note('A2 入れた文字は変えない（前後の空白だけ取る）', tsv[1].student_no === '26-04998' && tsv[1].display_name === 'テスト花子');
    const csv = A.parseRoster('\uFEFF2604999,"テスト, 太郎",A1クラス\n2604998,テスト花子,B2クラス');
    note('A3 CSV：BOM と引用符の中のカンマ', csv.length === 2 && csv[0].student_no === '2604999' && csv[0].display_name === 'テスト, 太郎');
    const sheet = A.rowsFromSheet([['学籍番号', '氏名', 'クラス'], ['2604999', 'テスト太郎', 'A1クラス'], ['', '', ''], [2604998, 'テスト花子', 'A1クラス']]);
    note('A4 Excel の表：見出しと空行を飛ばす。数として入っていても文字にする', sheet.length === 2 && sheet[1].student_no === '2604998');
    note('A5 形式：番号・氏名なし・クラスなしを断る',
      A.checkRow({ student_no: '9999', display_name: 'a', class_name: 'b' }) === 'bad_student_no'
      && A.checkRow({ student_no: '2604999', display_name: '', class_name: 'b' }) === 'bad_name'
      && A.checkRow({ student_no: '2604999', display_name: 'a', class_name: '' }) === 'bad_class'
      && A.checkRow({ student_no: '２６-０４９９９', display_name: 'a', class_name: 'b' }) === null);
    const cl = A.classify(A.parseRoster('2604999\tA\tC\n2604998\tB\tC\n26-04998\tB\tC\n999\tD\tC'), new Set(['2604999']));
    note('A6 3つに分ける（すでにある1・新しく作る1・形式がおかしい2＝書き方ちがいの重なりと、桁の不足）',
      cl.existing.length === 1 && cl.fresh.length === 1 && cl.fresh[0].no === '2604998' && cl.invalid.length === 2 && cl.invalid[0].reason === 'duplicate_in_list');

    note('A7 断られた理由の文：名簿に入れられなかった／ログインだけ残った／そのほかは符号だけ',
      A.reasonText('error:profile').includes('名簿に入れられなかった') && A.reasonText('error:profile_login_left').includes('ログイン用のアカウントだけ')
      && A.reasonText('error:auth_weak_password').includes('auth_weak_password') && A.reasonText('exists') === 'すでにアカウントがあります');

    /* ── ここからブラウザ ── */
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const H = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, { name: 'Content-Type', value: 'application/json' }];
    const reply = (id, st, b) => cdp('Fetch.fulfillRequest', { requestId: id, responseCode: st, responseHeaders: H, body: Buffer.from(b == null ? '' : JSON.stringify(b)).toString('base64') }).catch(() => {});
    const STUDENT = { id: '00000000-0000-0000-0000-0000000000a1', student_no: '2604999', display_name: 'テスト太郎', class_name: 'A1クラス', role: 'student' };
    function route({ requestId: id, request: rq }) {
      const u = new URL(rq.url), m = rq.method, q = decodeURIComponent(u.search);
      if (m === 'OPTIONS') return reply(id, 204, null);
      if (u.pathname === '/auth/v1/token') return reply(id, 200, { access_token: 'tok', refresh_token: 'rt', user: { id: 'm-id' } });
      if (u.pathname === '/rest/v1/rpc/my_role') return reply(id, 200, 'master');
      if (u.pathname === '/rest/v1/rpc/my_caps') return reply(id, 200, mock.caps);
      if (u.pathname === '/rest/v1/profiles') {
        if (q.includes('id=eq.m-id')) return reply(id, 200, [{ student_no: 'm001', display_name: 'マスター', role: 'master', class_name: null }]);
        if (q.includes('role=eq.student')) return reply(id, 200, [STUDENT]);
        return reply(id, 200, q.includes('offset=0') ? [STUDENT, { student_no: 'm001', class_name: null, role: 'master' }] : []);
      }
      // ログインのあと本体の画面まで進ませる（小テストが1件も無いとログイン画面で止まる）
      if (u.pathname === '/rest/v1/quiz_sets') return reply(id, 200, [{ id: '00000000-0000-0000-0000-0000000000b1', title: '見本のテスト', lesson: '1', is_open: false, created_at: '2026-11-01T00:00:00Z', source_book: null, source_file: null, source_sheet: null, questions: [{ count: 1 }] }]);
      if (u.pathname === '/rest/v1/rpc/quiz_stats') return reply(id, 200, { count: 0, avg: null, attempts: [], questions: [], focus: {} });
      if (u.pathname === '/rest/v1/rpc/issue_student_accounts') { mock.oldCalls = (mock.oldCalls || 0) + 1; return reply(id, 404, { code: 'PGRST202', message: 'gone' }); }
      if (u.pathname === '/functions/v1/issue-accounts') {
        if (mock.missing) return reply(id, 404, { code: 'NOT_FOUND', message: 'Requested function was not found' });
        const body = JSON.parse(rq.postData || '{}'); mock.issueCalls.push({ p_rows: body.rows }); mock.auths.push(rq.headers.Authorization || rq.headers.authorization || '');
        const results = (body.rows || []).map(r => r.student_no === '2604990'
          ? { student_no: r.student_no, status: 'failed', reason: 'error:23502' }
          : { student_no: r.student_no, status: 'created', reason: null });
        return reply(id, 200, { created: results.filter(x => x.status === 'created').length, existing: 0, invalid: 0, failed: results.filter(x => x.status === 'failed').length, results });
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
    const check = async (name, x) => { const ok = typeof x === 'string' ? await ev(x) : await x; checks.push({ name, ok: !!ok }); if (!ok) { await shot('failure.png'); throw new Error('FAILED: ' + name); } };
    const until = async (x, ms = 8000) => { for (let i = 0; i < ms / 80; i++) { try { if (await ev(x)) return true; } catch (e) {} await pause(80); } return false; };
    const click = sel => ev('document.querySelector(' + JSON.stringify(sel) + ').click()').then(() => pause(250));
    const txt = id => 'document.getElementById(' + JSON.stringify(id) + ').textContent';
    const paste = text => ev('(()=>{const t=document.getElementById("ac-text");t.value=' + JSON.stringify(text) + ';t.dispatchEvent(new Event("input"));})()');
    const ready = '(()=>{const b=document.getElementById("btn-login");return b&&typeof b.onclick==="function"})()';
    const open = async () => {
      await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'master.html')).href });
      await until(ready);
      await ev('localStorage.clear();sessionStorage.clear()'); await cdp('Page.reload'); await until(ready);
      await ev('document.getElementById("in-no").value="m001";document.getElementById("in-pw").value="x"');
      await click('#btn-login');
      await until('(()=>{const b=document.querySelector("[data-view=students]");return b&&b.offsetParent!==null})()');
      await click('[data-view=students]');
      await until('!!document.querySelector("#st-table tr[data-i]")');
    };
    const confirmOk = async () => { await until('document.getElementById("cfm-dlg").open'); await click('#cfm-ok'); };
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1400, deviceScaleFactor: 1, mobile: false });

    /* ── B 発行 ── */
    await open();
    await check('B1 発行できる人：「アカウントの発行」の置き場が出る', until('(()=>{const p=document.getElementById("ac-panel");return p&&!p.hidden&&p.offsetParent!==null&&p.querySelector("h2").textContent==="アカウントの発行"&&!!document.getElementById("ac-text")})()'));
    await check('B1 ファイルを選ぶ欄がある（Excel も選べる）。見本を保存するボタンは無い', '(()=>{const f=document.getElementById("ac-file");return f&&f.accept.includes(".xlsx")&&!document.getElementById("ac-template")})()');
    await check('B1 発行のボタンは、確認するまで出ない', 'document.getElementById("ac-issue").hidden');
    const roster = ['学籍番号\t氏名\tクラス', '2604998\tテスト花子\tA1クラス', '26-04997\tテスト次郎\tB2クラス', '２６０４９９６\tテスト三郎\tA1クラス',
      '2604999\tテスト太郎\tA1クラス', '260499\tテスト四郎\tA1クラス', '2604994\t\tA1クラス', '2604998\tテスト花子\tA1クラス'].join('\n');
    await paste(roster); await click('#ac-check');
    await check('B2 照合件数：新しく作る3・すでにある1・形式がおかしい3', until(txt('ac-sum') + '==="名簿 7件 ： 新しく作る 3件 ／ すでにある 1件 ／ 形式がおかしい 3件"'));
    await check('B2 形式がおかしい行に、行番号と理由が出る', '(()=>{const t=' + txt('ac-invalid') + ';return t.includes("6行目")&&t.includes("7桁")&&t.includes("7行目")&&t.includes("氏名")&&t.includes("8行目")&&t.includes("重なって")})()');
    await check('B2 すでにある学籍番号が出る', txt('ac-existing') + '.includes("2604999")');
    await check('B2 いまの名簿に無いクラス名に印が付く', '(()=>{const t=' + txt('ac-cls') + ';return t.includes("B2クラス 1人（新しいクラス名）")&&t.includes("A1クラス 2人")&&!t.includes("A1クラス 2人（新しい")})()');
    await check('B2 発行のボタンに件数が出る', '(()=>{const b=document.getElementById("ac-issue");return !b.hidden&&b.textContent==="3件のアカウントを発行する"})()');
    await check('B2 確認するだけでは送らない', mock.issueCalls.length === 0);
    await shot('issue-preview.png');
    await click('#ac-issue');
    await check('B3 確認ダイアログ（件数と初期パスワードの決まり）', until('document.getElementById("cfm-dlg").open && document.getElementById("cfm-title").textContent.includes("3件") && document.getElementById("cfm-body").textContent.includes("scg＋学籍番号")'));
    await click('#cfm-cancel');
    await check('B3 やめる なら送らない', mock.issueCalls.length === 0);
    await click('#ac-issue'); await confirmOk();
    await check('B4 発行の結果：作った3・断られた0', until(txt('ac-result') + '.includes("作った 3件 ／ 断られた 0件")'));
    await check('B4 送ったのは新しく作る3人だけ・学籍番号は7桁に正して送る', JSON.stringify(mock.issueCalls) === JSON.stringify([{ p_rows: [
      { student_no: '2604998', display_name: 'テスト花子', class_name: 'A1クラス' },
      { student_no: '2604997', display_name: 'テスト次郎', class_name: 'B2クラス' },
      { student_no: '2604996', display_name: 'テスト三郎', class_name: 'A1クラス' }] }]));
    await check('B4 本人への受渡しの案内が出る', txt('ac-result') + '.includes("本人には")');
    await check('B4 発行のあと、ボタンは消える（同じ名簿を2回送らない）', 'document.getElementById("ac-issue").hidden');
    await shot('issue-done.png');
    // 名簿を直したら、確認からやり直し
    await click('#ac-check'); await until('!document.getElementById("ac-issue").hidden');
    await paste(roster + '\n2604993\tテスト五郎\tA1クラス');
    await check('B5 名簿を直したら、発行のボタンと照合の結果は消える', 'document.getElementById("ac-issue").hidden && document.getElementById("ac-preview").children.length===0');
    // 45人＝20件ずつ3回。1人だけ断られる
    await check('B4b 送り先は Edge Function。ログイン中の人のトークンを付ける。前の口（DB の関数）は呼ばない', mock.auths.length >= 1 && mock.auths.every(a => a === 'Bearer tok') && mock.oldCalls === 0);
    mock.issueCalls.length = 0;
    const many = Array.from({ length: 45 }, (_, i) => (2604990 - i) + '\tテスト' + i + '\tA1クラス').join('\n');
    await paste(many); await click('#ac-check');
    await until(txt('ac-sum') + '.includes("新しく作る 45件")');
    await click('#ac-issue'); await confirmOk();
    await check('B6 45人は 20・20・5 件に分けて送る', until('document.getElementById("ac-done")') .then(() => mock.issueCalls.map(c => c.p_rows.length).join() === '20,20,5'));
    await check('B6 断られた1件が、番号と理由つきで出る（英文を出さない）', '(()=>{const t=' + txt('ac-result') + ';return t.includes("作った 44件 ／ 断られた 1件")&&t.includes("2604990")&&t.includes("エラーが起きました")&&!/not null|violat|constraint/i.test(t)})()');

    /* ── D Edge Function がまだ置かれていない ── */
    mock.missing = true; mock.issueCalls.length = 0;
    await paste('2604980\tテスト六郎\tA1クラス'); await click('#ac-check');
    await until('!document.getElementById("ac-issue").hidden');
    await click('#ac-issue'); await confirmOk();
    await check('D 発行の口が無いとき：「まだ使えません」と出す（英文を出さない）', until('(()=>{const t=' + txt('ac-msg') + ';return t.includes("まだ使えません")&&!/schema cache|function|PGRST|not found/i.test(t)})()'));
    await check('D ほかの画面は今までどおり（学生の一覧が出ている）', '!!document.querySelector("#st-table tr[data-i]")');
    mock.missing = false;

    /* ── C 権限が無い人 ── */
    mock.caps = ['student.read'];
    await open(); await pause(600);
    await check('C 発行できる権限が無い人（常勤）には出さない', 'document.getElementById("ac-panel").hidden && !document.getElementById("ac-text")');

    /* ── F 文言 ── */
    const src = fs.readFileSync(path.join(repo, 'src', 'assets', 'accounts.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const leaked = ['もど', 'わすれ', 'はじめ', 'えらぶ', 'ぜんいん', 'しめきり', 'つくる', 'とめる', 'がくせい', 'ていし'].filter(w => src.includes(w));
    if (leaked.length) console.log('ひらがな書きが残っている:', leaked.join('・'));
    note('F 文言：ひらがな書きが混ざっていない', src.length > 0 && leaked.length === 0);
    note('F 文字を HTML として流し込んでいない', !/innerHTML|outerHTML|insertAdjacentHTML/.test(src));
    await check('JS の例外なし', exceptions.length === 0);
  } finally {
    for (const c of checks) console.log((c.ok ? 'OK  ' : 'NG  ') + c.name);
    if (exceptions.length) console.log('exceptions:', exceptions.slice(0, 3));
    const ok = checks.filter(c => c.ok).length;
    console.log(ok + '/' + checks.length + ' passed');
    try { socket && socket.close(); } catch (e) {}
    child.kill();
    if (ok !== checks.length || !checks.length) process.exitCode = 1;
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
