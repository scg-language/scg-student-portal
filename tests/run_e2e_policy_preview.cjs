/* はじめのお知らせの見本（src/policy-preview.html）のブラウザ実操作テスト。
 * 通信を全部止めたヘッドレス Chrome で、ダミーだけを使う。資格情報も DB も使わない。
 *   node tests/run_e2e_arbeit_preview.cjs
 * 画像は _scratch/policy-preview-qa/（git 対象外）。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..'), output = path.join(repo, '_scratch', 'policy-preview-qa');
  fs.mkdirSync(output, { recursive: true });
  // 静的な見張り：innerHTML を使わない・通信の口を持たない・端末に保存しない
  const js = fs.readFileSync(path.join(repo, 'src', 'assets', 'policy-preview.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'src', 'policy-preview.html'), 'utf8');
  const staticChecks = [
    ['No innerHTML/outerHTML/insertAdjacentHTML in the preview script', !/innerHTML|outerHTML|insertAdjacentHTML/.test(js)],
    ['No fetch/XHR/WebSocket/storage in the preview script', !/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(js)],
    ['Page loads neither api.js nor any external script/style', !/assets\/api\.js/.test(html) && !/(src|href)="https?:/.test(html)],
  ];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-policy-e2e-'));
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), checks = [], exceptions = [];
  let socket, sequence = 0, httpBlocked = 0;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await pause(100);
    if (!fs.existsSync(portFile)) throw new Error('DevTools startup failed');
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      if (packet.id) { const p = pending.get(packet.id); if (!p) return; pending.delete(packet.id); packet.error ? p.reject(new Error(JSON.stringify(packet.error))) : p.resolve(packet.result || {}); }
      else if (packet.method === 'Runtime.exceptionThrown') exceptions.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text);
      else if (packet.method === 'Fetch.requestPaused') { httpBlocked++; cdp('Fetch.failRequest', { requestId: packet.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
    });
    const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const screenshot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(output, name), Buffer.from(r.data, 'base64')); };
    const check = async (name, expression) => { const ok = typeof expression === 'string' ? await evaluate(expression) : expression; checks.push({ name, ok: Boolean(ok) }); if (!ok) { await screenshot('failure.png'); throw new Error('FAILED: ' + name); } };
    // 動いている要素を押さない：位置が3回続けて同じで、その点に目当ての部品があるのを待ってから押す
    const click = async selector => {
      const sel = JSON.stringify(selector);
      await evaluate('(()=>{const el=document.querySelector(' + sel + ');if(!el)throw Error("Missing element "+' + sel + ');el.scrollIntoView({block:"center",behavior:"instant"});})()');
      let last = '', same = 0, point;
      for (let i = 0; i < 60 && same < 3; i++) {
        point = await evaluate('(()=>{const el=document.querySelector(' + sel + ');const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return{x,y,ok:!!hit&&(hit===el||el.contains(hit))};})()');
        const key = point.x + ',' + point.y + ',' + point.ok;
        same = key === last && point.ok ? same + 1 : 0; last = key; if (same < 3) await pause(30);
      }
      if (!point.ok) throw new Error('Element not clickable: ' + selector);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
      await pause(80);
    };
    const select = (id, value) => evaluate('(()=>{const el=document.getElementById(' + JSON.stringify(id) + ');el.value=' + JSON.stringify(value) + ';el.dispatchEvent(new Event("change",{bubbles:true}));return el.value;})()');
    const text = sel => evaluate('(document.querySelector(' + JSON.stringify(sel) + ')||{textContent:""}).textContent');
    const logCount = action => evaluate('window.policyPreview.log.filter(r=>r.action===' + JSON.stringify(action) + ').length');
    const screen = () => evaluate('document.getElementById("st-phone").dataset.screen');

    for (const [name, ok] of staticChecks) await check(name, ok);
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'policy-preview.html')).href });
    for (let i = 0; i < 100 && !(await evaluate('Boolean(window.policyPreview)')); i++) await pause(60);
    await check('Preview loaded', 'Boolean(window.policyPreview)');

    // --- お知らせだけの形：ログイン → お知らせ → よみました → ホーム ---
    await check('Starts at the login screen', (await screen()) === 'login');
    await click('#st-login');
    await check('Unread student is stopped at the notice before home', (await screen()) === 'gate');
    await check('Notice has only two sections (storage place and AI)', 'document.querySelectorAll("#st-phone h3").length===2');
    await check('No undecided parts remain in the text', 'document.querySelectorAll("#st-phone .pn-todo").length===0');
    await check('There is one button only: no agree/decline choice anywhere', '!document.getElementById("st-agree")&&!document.getElementById("st-decline")&&!document.getElementById("ctl-mode")');
    await check('AI uses are written as examples, with a way to ask', (await text('#st-phone')).includes('たとえば') && (await text('#st-phone')).includes('しんぱいな'));
    await check('AI-only-decides promise is in the notice', (await text('#st-phone')).includes('AI だけで'));
    await screenshot('gate-desktop.png');
    const readBefore = await logCount('read');
    await click('#st-read');
    await check('Pressing read goes to home', (await screen()) === 'home');
    await check('Pressing read adds exactly one record', (await logCount('read')) === readBefore + 1);
    await check('Home shows when it was read', (await text('#st-done')).includes('よみました'));

    // --- 1回だけ：ログインし直しても出ない／読み直しはできる（記録は増えない） ---
    await click('#st-logout'); await click('#st-login');
    await check('Second login skips the notice', (await screen()) === 'home');
    await click('#st-again');
    await check('Read-again view has no read button', (await screen()) === 'reread' && !(await evaluate('Boolean(document.getElementById("st-read"))')));
    await click('#st-back');
    await check('Read-again adds no record', (await logCount('read')) === readBefore + 1);

    // --- 言語 ---
    await click('#st-logout'); await select('ctl-who', '2604996'); await click('#st-login');
    await click('#lang-en');
    await check('English shows the English heading and button', (await text('#st-phone h2')).includes('Important notice') && (await text('#st-read')) === 'I have read this');
    await check('Only languages that have a translation are listed', '(()=>{const b=[...document.querySelectorAll("#st-langs button")].map(x=>x.id.slice(5));return b.join()===window.POLICY_NOTICE.langs().map(l=>l[0]).join()})()');
    await click('#st-read');
    await check('Record keeps the language that was on screen', 'window.policyPreview.log[window.policyPreview.log.length-1].lang==="en"');

    // --- 先生のスマホ：まだの学生だけ名前が出る ---
    await click('#tab-teacher');
    await check('Teacher sees the count of students who have not read', (await text('#tc-count')).includes('0名'));
    await select('tc-class', '1B');
    await check('Other class shows its own unread student by name', (await text('#tc-count')).includes('1名') && (await text('#tc-list')).includes('テスト一郎'));
    await check('Teacher view uses ordinary Japanese', '(()=>{const t=document.getElementById("view-teacher").textContent;return !["よみました","きめます","もういちど"].some(w=>t.includes(w));})()');
    await screenshot('teacher-desktop.png');

    // --- 版を上げる：読んだ学生にも、もう1回出る ---
    await click('#ctl-bump'); await click('#tab-student'); await select('ctl-who', '2604998'); await click('#st-login');
    await check('After a new version, a student who read v1 is stopped again', (await screen()) === 'gate');
    await check('The changed-part note and the highlighted line are shown', 'Boolean(document.getElementById("st-changed"))&&Boolean(document.querySelector("#st-phone .pn-new"))');
    await click('#st-read');
    await check('The new record carries version 2', 'window.policyPreview.log[window.policyPreview.log.length-1].version===2');
    await click('#tab-teacher'); await select('tc-class', '1A');
    await check('Teacher count resets for the new version', (await text('#tc-count')).includes('3名'));

    // --- 残る記録 ---
    await check('Only read presses are recorded', 'window.policyPreview.log.every(r=>r.action==="read")');
    await click('#tab-log');
    await check('Record tab lists every press', 'document.querySelectorAll("#lg-body tr").length===window.policyPreview.log.length');
    await check('No internal terms on screen', '!/RLS|Supabase|テーブル|DB|api/i.test(document.body.innerText)');
    await screenshot('log-desktop.png');

    // --- 幅 ---
    await click('#tab-student'); await select('ctl-who', '2604994'); await click('#st-login');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('window.scrollTo(0,0)'); await pause(150); await screenshot('gate-mobile.png');
    await check('Notice does not overflow on a phone', 'document.documentElement.scrollWidth<=window.innerWidth+1');
    await click('#tab-teacher'); await evaluate('window.scrollTo(0,0)'); await pause(150); await screenshot('teacher-mobile.png');
    await check('Teacher view does not overflow on a phone', 'document.documentElement.scrollWidth<=window.innerWidth+1');

    await check('Nothing was saved to browser storage', 'localStorage.length===0&&sessionStorage.length===0');
    await check('No live HTTP request was attempted', httpBlocked === 0);
    await check('No browser JavaScript exceptions', exceptions.length === 0);
    console.log(JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, exceptions, httpBlocked, output }, null, 2));
  } finally { if (socket) socket.close(); child.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
