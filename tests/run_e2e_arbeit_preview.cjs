/* アルバイト情報の見本（src/arbeit-preview.html）のブラウザ実操作テスト。
 * 通信を全部止めたヘッドレス Chrome で、ダミーだけを使う。資格情報も DB も使わない。
 *   node tests/run_e2e_arbeit_preview.cjs
 * 画像は _scratch/arbeit-preview-qa/（git 対象外）。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..'), output = path.join(repo, '_scratch', 'arbeit-preview-qa');
  fs.mkdirSync(output, { recursive: true });
  // 静的な見張り：innerHTML を使わない・通信の口を持たない・端末に保存しない
  const js = fs.readFileSync(path.join(repo, 'src', 'assets', 'arbeit-preview.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'src', 'arbeit-preview.html'), 'utf8');
  const staticChecks = [
    ['No innerHTML/outerHTML/insertAdjacentHTML in the preview script', !/innerHTML|outerHTML|insertAdjacentHTML/.test(js)],
    ['No fetch/XHR/WebSocket/storage in the preview script', !/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/.test(js)],
    ['Page loads neither api.js nor any external script/style', !/api\.js/.test(html) && !/(src|href)="https?:/.test(html)],
  ];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-arbeit-e2e-'));
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
    const type = (id, value) => evaluate('(()=>{const el=document.getElementById(' + JSON.stringify(id) + ');el.value=' + JSON.stringify(value) + ';el.dispatchEvent(new Event("input",{bubbles:true}));})()');
    // 1x1 の PNG を、ブラウザの中で File にして入れる（ディスクのファイルも通信も使わない）
    const pickImage = (id, name) => evaluate('(()=>{const b=atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);const dt=new DataTransfer();dt.items.add(new File([u],' + JSON.stringify(name) + ',{type:"image/png"}));const el=document.getElementById(' + JSON.stringify(id) + ');el.files=dt.files;el.dispatchEvent(new Event("change",{bubbles:true}));return el.files.length;})()');
    const staffCell = (sid, kind, month) => '(()=>{const c=[...document.querySelectorAll("#sf-body .ap-chip")].filter(x=>x.dataset.sid===' + JSON.stringify(sid) + '&&x.dataset.kind===' + JSON.stringify(kind) + '&&x.dataset.month===' + JSON.stringify(month || '') + ');return c.map(x=>x.dataset.state).join(",");})()';
    const studentRow = (kind, month) => '(()=>{const r=[...document.querySelectorAll("#st-docs .ap-row")].find(x=>x.dataset.kind===' + JSON.stringify(kind) + '&&x.dataset.month===' + JSON.stringify(month || '') + ');return r?r.dataset.state:"";})()';

    for (const [name, ok] of staticChecks) await check(name, ok);
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'arbeit-preview.html')).href });
    for (let i = 0; i < 100 && !(await evaluate('Boolean(window.arbeitPreview)')); i++) await pause(60);
    await check('Preview loaded', 'Boolean(window.arbeitPreview)');

    // --- 見本の表示とダミーデータ ---
    await check('Notice says it is a preview, dummy-only and resets on reload', 'document.getElementById("ap-notice").textContent.includes("これは見本です。ダミーのデータだけで動き、再読み込みで元に戻ります")');
    await check('About 10 dummy students, numbers descend from 2604999', 'arbeitPreview.db.students.length===10&&arbeitPreview.db.students.every((s,i)=>s.id===String(2604999-i))');
    await check('Dummy names are obviously fictional', 'arbeitPreview.db.students.every(s=>s.name.startsWith("テスト"))');

    // --- 職員の一覧：状態の区別 ---
    await click('#tab-staff');
    await check('Staff view is shown', '!document.getElementById("view-staff").hidden&&document.getElementById("view-student").hidden');
    await check('All six states appear as separate states in the list', '["missing","submitted","confirmed","returned","exempt","none","unknown"].every(s=>document.querySelector("#sf-body .ap-chip[data-state="+s+"]"))');
    await check('Not-entered student shows 未入力, not アルバイトなし or 0', '(()=>{const t=[...document.querySelectorAll("#sf-body tr[data-sid=\\"2604996\\"] .ap-chip")].map(x=>x.textContent);return t.length>0&&t.every(x=>x==="未入力");})()');
    await check('No-job student shows アルバイトなし', '[...document.querySelectorAll("#sf-body tr[data-sid=\\"2604997\\"] .ap-chip")].every(x=>x.textContent==="アルバイトなし")');
    await check('No cell shows a bare 0', '![...document.querySelectorAll("#sf-body td")].some(td=>td.textContent.trim()==="0")');
    await check('Exempt month is distinct from missing', await evaluate(staffCell('2604994', '', '2026-11')) === 'exempt');
    await check('Paper-received document carries the paper mark', 'document.querySelectorAll("#sf-body tr[data-sid=\\"2604995\\"] .ap-paper").length>=1');
    await check('Two workplaces are listed separately for one student', await evaluate(staffCell('2604998', 'payslip', '2026-10')) === 'submitted,missing');
    await evaluate('window.scrollTo(0,0)'); await screenshot('staff-desktop.png');

    // --- 学生が出す ---
    await click('#tab-student');
    await select('st-who', '2604999');
    await check('Student sees Nov payslip as まだ', `${studentRow('payslip', '2026-11')}==="missing"&&[...document.querySelectorAll("#st-docs .ap-row")].find(x=>x.dataset.month==="2026-11").textContent.includes("まだ")`);
    await click('#st-send');
    await check('Sending without a photo is refused in easy Japanese', '!document.getElementById("st-msg").hidden&&document.getElementById("st-msg").textContent.includes("しゃしん")');
    await check('Picked file is accepted', (await pickImage('st-file', 'payslip.png')) === 1);
    await check('Thumbnail is shown from a local blob URL', '!document.getElementById("st-thumb").hidden&&document.getElementById("st-thumb-img").src.startsWith("blob:")');
    await select('st-kind', 'payslip');
    await check('Confirmed months cannot be chosen', '[...document.getElementById("st-month").options].filter(o=>o.disabled).map(o=>o.value).join()==="2026-09,2026-10"');
    await select('st-month', '2026-11');
    await click('#st-send');
    await check('Student row turns to だした', `${studentRow('payslip', '2026-11')}==="submitted"&&[...document.querySelectorAll("#st-docs .ap-row")].find(x=>x.dataset.month==="2026-11").textContent.includes("だした")`);

    // --- 職員：一覧に出る → 差し戻す ---
    await click('#tab-staff');
    await select('sf-state', 'submitted');
    await check('Unconfirmed filter shows the new submission', await evaluate(staffCell('2604999', 'payslip', '2026-11')) === 'submitted');
    await check('Unconfirmed filter hides students with nothing unconfirmed', '!document.querySelector("#sf-body tr[data-sid=\\"2604997\\"]")&&!document.querySelector("#sf-body tr[data-sid=\\"2604990\\"]")');
    await click('#sf-body .ap-chip[data-sid="2604999"][data-kind="payslip"][data-month="2026-11"]');
    await check('Detail opens with the submitted image', '!document.getElementById("sf-detail").hidden&&document.getElementById("dt-img").src.startsWith("blob:")&&document.getElementById("dt-state-badge").dataset.state==="submitted"');
    await click('#dt-return');
    await check('Returning without a reason is refused', 'document.getElementById("dt-msg").classList.contains("err")&&document.getElementById("dt-state-badge").dataset.state==="submitted"');
    await type('dt-reason', '金額が読めません <b id="inj">x</b>');
    await click('#dt-return');
    await check('Returned state is shown to staff', 'document.getElementById("dt-state-badge").dataset.state==="returned"');
    await select('sf-state', 'returned');
    await check('Returned filter lists the student', await evaluate(staffCell('2604999', 'payslip', '2026-11')) === 'returned');

    // --- 学生に理由が出る → 出し直す ---
    await click('#tab-student');
    await check('Student sees もういちど だして ください', `${studentRow('payslip', '2026-11')}==="returned"&&[...document.querySelectorAll("#st-docs .ap-row")].find(x=>x.dataset.month==="2026-11").textContent.includes("もういちど だして ください")`);
    await check('Reason is shown as plain text (no HTML injection)', 'document.querySelector("#st-docs .st-reason").textContent.includes("<b id=\\"inj\\">x</b>")&&!document.getElementById("inj")');
    await pickImage('st-file', 'payslip2.png');
    await select('st-kind', 'payslip'); await select('st-month', '2026-11');
    await click('#st-send');
    await check('Resubmitted row is だした again', `${studentRow('payslip', '2026-11')}==="submitted"`);

    // --- 職員：確認済みにする ---
    await click('#tab-staff');
    await select('sf-state', 'submitted');
    await click('#sf-body .ap-chip[data-sid="2604999"][data-kind="payslip"][data-month="2026-11"]');
    await check('History keeps both submissions', 'document.querySelectorAll("#dt-history li").length===3&&document.getElementById("dt-history").textContent.includes("2回目")');
    await click('#dt-confirm');
    await check('Staff sees 確認済み', 'document.getElementById("dt-state-badge").dataset.state==="confirmed"');
    await click('#tab-student');
    await check('Student sees かくにん ずみ', `${studentRow('payslip', '2026-11')}==="confirmed"&&[...document.querySelectorAll("#st-docs .ap-row")].find(x=>x.dataset.month==="2026-11").textContent.includes("かくにん ずみ")`);
    await check('Confirmed month can no longer be chosen', '[...document.getElementById("st-month").options].every(o=>o.disabled)');

    // --- 職員：紙で受け取り・提出免除・絞り込み ---
    await click('#tab-staff');
    await select('sf-state', ''); await select('sf-class', '2A');
    await check('Class filter shows only 2A', '[...document.querySelectorAll("#sf-body tr")].map(t=>t.dataset.sid).join()==="2604992,2604991,2604990"');
    await click('#sf-body .ap-chip[data-sid="2604992"][data-kind="contract"]');
    await click('#dt-paper');
    await check('Paper registration becomes unconfirmed with the paper mark', 'document.getElementById("dt-state-badge").dataset.state==="submitted"&&document.querySelector("#sf-body .ap-chip[data-sid=\\"2604992\\"][data-kind=\\"contract\\"] .ap-paper")');
    await click('#tab-student'); await select('st-who', '2604992');
    await check('Student sees the paper registration', `${studentRow('contract', '')}==="submitted"&&[...document.querySelectorAll("#st-docs .ap-row")].find(x=>x.dataset.kind==="contract").textContent.includes("（かみ）")`);
    await click('#tab-staff');
    await select('sf-month', '2026-10');
    await check('Month filter shows a single month column', 'document.querySelectorAll("#sf-head th").length===5&&document.getElementById("sf-head").textContent.includes("2026年10月")');
    await click('#sf-body .ap-chip[data-sid="2604992"][data-kind="payslip"][data-month="2026-10"]');
    await click('#dt-exempt');
    await check('Exempt without reason is refused', 'document.getElementById("dt-msg").classList.contains("err")');
    await type('dt-exempt-reason', '入院のため');
    await click('#dt-exempt');
    await check('Exempt is set for that month', await evaluate(staffCell('2604992', '', '2026-10')) === 'exempt');
    await select('sf-class', ''); await select('sf-month', ''); await select('sf-state', 'missing');
    await check('Missing filter excludes 未入力 and アルバイトなし students', '(()=>{const ids=[...document.querySelectorAll("#sf-body tr")].map(t=>t.dataset.sid);return ids.length>0&&!ids.includes("2604996")&&!ids.includes("2604991")&&!ids.includes("2604997")&&!ids.includes("2604993");})()');
    await check('Missing filter keeps only rows that have a missing document', '[...document.querySelectorAll("#sf-body tr")].every(t=>t.querySelector(".ap-chip[data-state=missing]"))');

    // --- 学生：アルバイトの状態を答える ---
    await click('#tab-student'); await select('st-who', '2604996');
    await check('Not-entered student is asked', 'document.getElementById("st-status").textContent.includes("まだ こたえて いません")');
    await click('#st-say-none');
    await check('Student answers アルバイトを していない', 'document.getElementById("st-status-text").textContent==="アルバイトを していない"');
    await click('#tab-staff'); await select('sf-state', '');
    await check('Staff list now shows アルバイトなし for that student', '[...document.querySelectorAll("#sf-body tr[data-sid=\\"2604996\\"] .ap-chip")].every(x=>x.dataset.state==="none")');

    // --- 言葉の線：職員の画面にひらがな書きを持ち込まない／学生の画面はやさしい日本語 ---
    await check('Staff view has no student-style hiragana phrases', '(()=>{const t=document.getElementById("view-staff").textContent;return !["かくにん ずみ","だした","まだ","もういちど","しょるい","ださなくて"].some(w=>t.includes(w));})()');
    await click('#tab-student'); await select('st-who', '2604998');
    await check('Student view uses easy-Japanese labels, not staff terms', '(()=>{const t=document.getElementById("st-phone").textContent;return !["未提出","確認済み","差し戻し","提出免除","未確認"].some(w=>t.includes(w))&&t.includes("きゅうよ めいさい");})()');
    await check('Student with two workplaces sees both', 'document.querySelectorAll("#st-docs .ap-wp").length===2');
    await check('No internal terms on screen', '!/RLS|Supabase|テーブル|DB|api/i.test(document.body.innerText)');

    // --- 幅 ---
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('window.scrollTo(0,0)'); await pause(150); await screenshot('student-mobile.png');
    await check('Student view does not overflow on a phone', 'document.documentElement.scrollWidth<=window.innerWidth+1');
    await click('#tab-staff');
    await evaluate('window.scrollTo(0,0)'); await pause(150); await screenshot('staff-mobile.png');
    await check('Staff view does not overflow the page on a phone (table scrolls inside)', 'document.documentElement.scrollWidth<=window.innerWidth+1');

    await check('Nothing was saved to browser storage', 'localStorage.length===0&&sessionStorage.length===0');
    await check('No live HTTP request was attempted', httpBlocked === 0);
    await check('No browser JavaScript exceptions', exceptions.length === 0);
    console.log(JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, exceptions, httpBlocked, output }, null, 2));
  } finally { if (socket) socket.close(); child.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
