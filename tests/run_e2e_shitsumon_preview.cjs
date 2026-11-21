/* 質問箱の見本（src/shitsumon-preview.html）のブラウザ実操作テスト。
 * 通信を全部止めたヘッドレス Chrome で、ダミーだけを使う。資格情報も DB も使わない。
 *   node tests/run_e2e_shitsumon_preview.cjs
 * 画像は _scratch/shitsumon-preview-qa/（git 対象外）。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..'), output = path.join(repo, '_scratch', 'shitsumon-preview-qa');
  fs.mkdirSync(output, { recursive: true });
  // 静的な見張り：innerHTML を使わない・通信の口を持たない・端末に保存しない
  const js = fs.readFileSync(path.join(repo, 'src', 'assets', 'shitsumon-preview.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'src', 'shitsumon-preview.html'), 'utf8');
  const staticChecks = [
    ['No innerHTML/outerHTML/insertAdjacentHTML in the preview script', !/innerHTML|outerHTML|insertAdjacentHTML/.test(js)],
    ['No fetch/XHR/WebSocket/sendBeacon/storage in the preview script', !/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/.test(js)],
    ['Page loads neither api.js nor any external script/style', !/api\.js/.test(html) && !/(src|href)="https?:/.test(html) && !/app\.css|i18n\.js/.test(html)],
  ];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-shitsumon-e2e-'));
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
    const C = no => 'shitsumonPreview.db.consults.find(c=>c.no===' + no + ')';
    const stStatus = no => 'document.querySelector("#st-list li[data-no=\\"' + no + '\\"] .st-status").textContent';
    // 画面に出ている自分の一覧（未対応・対応中・終了の3つを押して全部集める）＝担当でない相談が1件も無いか
    const listAllTabs = async () => {
      const seen = [];
      for (const f of ['new', 'doing', 'done']) { await click('.qb-filter button[data-filter="' + f + '"]'); seen.push(...await evaluate('[...document.querySelectorAll("#sf-list li")].map(li=>({no:+li.dataset.no,assignee:li.dataset.assignee}))')); }
      await click('.qb-filter button[data-filter="new"]');
      return seen;
    };
    const countsShown = '["new","doing","done"].reduce((a,s)=>a+parseInt(document.getElementById("cnt-"+s).textContent,10),0)';
    const asStaff = async who => { await click('#tab-staff'); await select('sf-who', who); };

    for (const [name, ok] of staticChecks) await check(name, ok);
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: pathToFileURL(path.join(repo, 'src', 'shitsumon-preview.html')).href });
    for (let i = 0; i < 100 && !(await evaluate('Boolean(window.shitsumonPreview)')); i++) await pause(60);
    await check('Preview loaded', 'Boolean(window.shitsumonPreview)');

    // --- 見本の表示とダミーデータ ---
    await check('Notice says it is a preview, dummy-only and resets on reload', 'document.getElementById("qb-notice").textContent.includes("これは見本です。ダミーのデータだけで動き、再読み込みで元に戻ります")');
    await check('8 dummy students, numbers descend from 2604999', 'shitsumonPreview.db.students.length===8&&shitsumonPreview.db.students.every((s,i)=>s.id===String(2604999-i))');
    await check('Dummy names are obviously fictional', 'shitsumonPreview.db.students.every(s=>s.name.startsWith("テスト"))');
    await check('Staff are role names only', 'shitsumonPreview.STAFF.map(s=>s.name).join()==="事務の職員A,担任A,担任B,相談窓口の職員,情報管理者"');
    await check('A 4-day-old unhandled consult is seeded', 'shitsumonPreview.db.consults.some(c=>c.status==="new"&&Date.now()-c.at.getTime()>=4*86400000-60000)');

    // --- 学生：開いた時点で自分が出ている・急ぎは電話 ---
    await select('st-who', '2604999');
    await check('Student name, number and class are shown without input', '(()=>{const t=document.getElementById("st-me").textContent;return t.includes("テスト太郎")&&t.includes("2604999")&&t.includes("1A")&&!document.querySelector("#st-me input,#st-me select");})()');
    await check('Urgent-contact line with the dummy phone number is always shown', '(()=>{const u=document.getElementById("st-urgent");return u.offsetParent!==null&&u.textContent.includes("いそぎの ときは がっこうに でんわ して ください")&&u.textContent.includes("000-0000-0000");})()');
    await check('All 8 consult kinds are offered as buttons', 'document.querySelectorAll("#st-kinds .qb-kind").length===8');
    await check('Memo says it is optional and native language is OK', '(()=>{const t=document.getElementById("st-phone").textContent;return t.includes("かかなくても いいです")&&t.includes("じぶんの くにの ことばで")})()');
    await check('Send is disabled before a kind is chosen', 'document.getElementById("st-send").disabled');
    await click('#st-kinds .qb-kind[data-kind="nottannin"]');
    await check('Not-tannin choice says the homeroom teacher cannot see it', 'document.getElementById("st-dest").textContent.includes("たんにんの せんせいには みえません")');
    await click('#st-kinds .qb-kind[data-kind="career"]');
    await check('Career goes to the homeroom teacher', 'document.getElementById("st-dest").textContent==="たんにんの せんせいに とどきます。"');
    await click('#st-kinds .qb-kind[data-kind="address"]');
    await check('Address shows the office as the destination before sending', 'document.getElementById("st-dest").textContent==="じむの ひとに とどきます。"&&!document.getElementById("st-send").disabled');
    await check('Only one kind is selected at a time', 'document.querySelectorAll("#st-kinds .qb-kind[aria-pressed=true]").length===1');
    const memo1 = 'ひっこし します <b id="inj">x</b>';
    await type('st-memo', memo1);
    await click('#st-send');
    const n1 = await evaluate('shitsumonPreview.db.seq');
    await check('Consult was created for the office', `${C(n1)}.assignee==="jimu"&&${C(n1)}.sid==="2604999"`);
    await check('Student list shows うけとりました', `${stStatus(n1)}==="うけとりました"`);

    // 選ぶだけで送れる（メモなし）
    await click('#st-kinds .qb-kind[data-kind="unknown"]');
    await click('#st-send');
    const n2 = await evaluate('shitsumonPreview.db.seq');
    await check('Can send by choosing only (no memo); "unknown" goes to the homeroom teacher', `${C(n2)}.memo===""&&${C(n2)}.assignee==="tanninA"`);
    await evaluate('window.scrollTo(0,0)'); await screenshot('student-desktop.png');

    // --- 職員：行き先どおりに届く・ほかの職員には件数も出ない ---
    await asStaff('jimu');
    await check('Office sees the new consult in 未対応', `!!document.querySelector('#sf-list li[data-no="${n1}"]')`);
    await check('Big unhandled count is shown at the top', '/^未対応 \\d+件$/.test(document.getElementById("sf-open").textContent)&&parseInt(document.getElementById("sf-open").textContent.slice(4),10)===shitsumonPreview.visibleTo("jimu").filter(c=>c.status==="new").length');
    for (const who of ['jimu', 'tanninA', 'tanninB', 'madoguchi']) {
      await select('sf-who', who);
      const seen = await listAllTabs();
      await check(who + ': list shows only consults assigned to them', seen.length > 0 && seen.every(x => x.assignee === who));
      await check(who + ': counts equal their own consults only', `${countsShown}===shitsumonPreview.db.consults.filter(c=>c.assignee===${JSON.stringify(who)}).length&&${countsShown}<shitsumonPreview.db.consults.length`);
    }
    await select('sf-who', 'tanninA');
    await check('Homeroom A does not see the office consult', `!document.querySelector('#sf-list li[data-no="${n1}"]')&&!shitsumonPreview.visibleTo("tanninA").some(c=>c.no===${n1})`);
    await select('sf-who', 'admin');
    await check('Admin sees every consult', `${countsShown}===shitsumonPreview.db.consults.length`);

    // --- 外への知らせ：名前・番号・メモが無い ---
    await check('Notice text for the new consult is exactly the template', `shitsumonPreview.db.notices.some(n=>n.text==="相談が1件届きました（種類：住所・引っ越し）。ポータルで確認してください")`);
    await check('No notice contains any student name, number or memo', '(()=>{const d=shitsumonPreview.db;return d.notices.length===d.consults.length&&d.notices.every(n=>!d.students.some(s=>n.text.includes(s.name)||n.text.includes(s.id))&&!d.consults.some(c=>c.memo&&n.text.includes(c.memo))&&/^相談が1件届きました（種類：[^）]+）。ポータルで確認してください$/.test(n.text));})()');
    await check('Notice panel on screen has no name/number/memo either', '(()=>{const t=document.getElementById("nt-list").textContent,d=shitsumonPreview.db;return t.includes("相談が1件届きました")&&!d.students.some(s=>t.includes(s.name)||t.includes(s.id))&&!t.includes("ひっこし");})()');
    await select('sf-who', 'tanninB');
    await check('Office notice is not shown to homeroom B', '!document.getElementById("nt-list").textContent.includes("住所・引っ越し")');

    // --- 事務：開く→対応を始める→学生側の状態 ---
    await select('sf-who', 'jimu');
    await click(`#sf-list .qb-row[data-no="${n1}"]`);
    await check('Detail opens; memo shown as plain text (no HTML injection)', `!document.getElementById("sf-detail").hidden&&document.getElementById("dt-memo").textContent===${JSON.stringify(memo1)}&&!document.getElementById("inj")`);
    await click('#dt-start');
    await check('Staff sees 対応中', `${C(n1)}.status==="doing"&&document.getElementById("dt-status").textContent.startsWith("対応中")`);
    await click('#tab-student');
    await check('Student sees たんとう：じむの ひと', `${stStatus(n1)}==="たんとう：じむの ひと"`);

    // --- 回す：元の担当から消えて履歴が残る ---
    await asStaff('jimu');
    await click('.qb-filter button[data-filter="doing"]');
    await click(`#sf-list .qb-row[data-no="${n1}"]`);
    await select('dt-to', 'tanninA');
    await click('#dt-forward');
    await check('Forwarding without a reason is refused', `document.getElementById("dt-msg").classList.contains("err")&&${C(n1)}.assignee==="jimu"`);
    const reason = '進学の話もあるため';
    await type('dt-reason', reason);
    await click('#dt-forward');
    await check('Consult now belongs to homeroom A', `${C(n1)}.assignee==="tanninA"&&${C(n1)}.status==="new"`);
    const jimuSeen = await listAllTabs();
    await check('Forwarded consult disappears from the office list in every tab', !jimuSeen.some(x => x.no === n1));
    await check('Office counts no longer include it', `${countsShown}===shitsumonPreview.db.consults.filter(c=>c.assignee==="jimu").length&&document.getElementById("sf-detail").hidden`);
    await check('Forward history records who, when, from and to', `${C(n1)}.history.some(h=>h.text.includes("事務の職員A が回した：事務の職員A → 担任A")&&h.text.includes(${JSON.stringify(reason)})&&h.at instanceof Date)`);
    await click('#tab-student');
    await check('Student sees うけとりました again after forwarding', `${stStatus(n1)}==="うけとりました"`);

    // --- 担任A：届いている→始める→終了（職員用メモは学生に見えない） ---
    await asStaff('tanninA');
    await click(`#sf-list .qb-row[data-no="${n1}"]`);
    await check('Homeroom A sees the forward history in the detail', 'document.getElementById("dt-history").textContent.includes("事務の職員A → 担任A")');
    await click('#dt-start');
    await click('.qb-filter button[data-filter="doing"]');
    await check('Detail stays open after the tab switch', `!document.getElementById("sf-detail").hidden&&!!document.querySelector('#sf-list li[data-no="${n1}"]')`);
    const note = '面談で話した <i id="inj2">y</i>';
    await type('dt-note', note);
    await click('#dt-finish');
    await check('Staff sees 終了 with the staff note', `${C(n1)}.status==="done"&&document.getElementById("dt-note-view").textContent.includes("面談で話した <i id=")&&!document.getElementById("inj2")`);
    await click('#tab-student');
    await check('Student sees おわりました', `${stStatus(n1)}==="おわりました"`);
    await check('Staff note is not on the student screen', '!document.getElementById("st-phone").textContent.includes("面談で話した")');

    // --- 担任以外の相談：担任には届かない・担任へは回せない ---
    await select('st-who', '2604997');
    await click('#st-kinds .qb-kind[data-kind="nottannin"]');
    await type('st-memo', 'クラスの ことで はなしたい');
    await click('#st-send');
    const n3 = await evaluate('shitsumonPreview.db.seq');
    await check('Not-tannin consult goes to the counselling desk', `${C(n3)}.assignee==="madoguchi"`);
    await asStaff('tanninA');
    const aSeen = await listAllTabs();
    await check('Homeroom A (the student\'s homeroom) does not see it, in list or counts', !aSeen.some(x => x.no === n3) && await evaluate(`!shitsumonPreview.visibleTo("tanninA").some(c=>c.kind==="nottannin")&&!document.getElementById("view-staff").textContent.includes("担任以外に相談したい")`));
    await select('sf-who', 'tanninB');
    await check('Homeroom B does not see any not-tannin consult either', `!shitsumonPreview.visibleTo("tanninB").some(c=>c.kind==="nottannin")&&!document.getElementById("view-staff").textContent.includes("担任以外に相談したい")`);
    await select('sf-who', 'madoguchi');
    await click(`#sf-list .qb-row[data-no="${n3}"]`);
    await check('Counselling desk cannot forward it to the homeroom teacher', '(()=>{const v=[...document.getElementById("dt-to").options].map(o=>o.value);return v.includes("jimu")&&!v.includes("tanninA")&&!v.includes("tanninB");})()');

    // --- 3日の印・放置されている相談（情報管理者だけ） ---
    await select('sf-who', 'jimu');
    await check('3-day mark on the old unhandled consult', '(()=>{const st=shitsumonPreview.db.consults.filter(shitsumonPreview.isStale);return st.length===1&&!!document.querySelector("#sf-list li[data-no=\\""+st[0].no+"\\"] .qb-stale");})()');
    await check('Fresh consults have no mark', '[...document.querySelectorAll("#sf-list li")].filter(li=>li.querySelector(".qb-stale")).length===1');
    await check('Non-admin cannot see stale list or operation log', 'document.getElementById("ad-stale").hidden&&document.getElementById("ad-log").hidden&&document.querySelectorAll("#ad-log-list li").length===0');
    await select('sf-who', 'admin');
    await check('Admin sees the neglected consult', '(()=>{const st=shitsumonPreview.db.consults.filter(shitsumonPreview.isStale);return !document.getElementById("ad-stale").hidden&&document.querySelectorAll("#ad-stale-list li").length===st.length&&!!document.querySelector("#ad-stale-list li[data-no=\\""+st[0].no+"\\"]");})()');

    // --- 操作の記録：開いた・回した・終了した。メモ・理由・職員メモは入らない ---
    await check('Log has opened / forwarded / finished entries', '(()=>{const a=shitsumonPreview.db.log.map(l=>l.action).join("|");return a.includes("相談を開いた")&&a.includes("回した")&&a.includes("終了にした");})()');
    await check('Log entries carry who/role/when/what/which only', 'shitsumonPreview.db.log.every(l=>Object.keys(l).sort().join()==="action,at,target,who"&&/^相談 #\\d+$/.test(l.target))');
    await check('Log has no memo, reason or staff note', `(()=>{const d=shitsumonPreview.db,t=JSON.stringify(d.log)+document.getElementById("ad-log-list").textContent;return !d.consults.some(c=>c.memo&&t.includes(c.memo))&&!t.includes(${JSON.stringify(reason)})&&!t.includes("面談で話した")&&!d.students.some(s=>t.includes(s.name));})()`);
    await check('Admin can read the log on screen', 'document.getElementById("ad-log-list").textContent.includes("相談を開いた")');
    await evaluate('window.scrollTo(0,0)'); await screenshot('staff-admin-desktop.png');

    // --- 言葉の線 ---
    await check('Staff view has no student-style hiragana phrases', '(()=>{const t=document.getElementById("view-staff").textContent;return !["うけとりました","たんとう：","おわりました","そうだん","とどきます","たんにん","じむの"].some(w=>t.includes(w));})()');
    await click('#tab-student');
    await check('Student view has no staff terms', '(()=>{const t=document.getElementById("st-phone").textContent;return !["未対応","対応中","終了","相談窓口","事務の職員","担任A","担任B"].some(w=>t.includes(w));})()');
    await check('No internal terms on screen', '!/RLS|Supabase|テーブル|DB|api/i.test(document.body.innerText)');

    // --- 幅 ---
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('window.scrollTo(0,0)'); await pause(150); await screenshot('student-mobile.png');
    await check('Student view does not overflow on a phone', 'document.documentElement.scrollWidth<=window.innerWidth+1');
    await click('#tab-staff');
    await evaluate('window.scrollTo(0,0)'); await pause(150); await screenshot('staff-mobile.png');
    await check('Staff view does not overflow on a phone', 'document.documentElement.scrollWidth<=window.innerWidth+1');

    await check('Nothing was saved to browser storage', 'localStorage.length===0&&sessionStorage.length===0');
    await check('No live HTTP request was attempted', httpBlocked === 0);
    await check('No browser JavaScript exceptions', exceptions.length === 0);
    console.log(JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, exceptions, httpBlocked, output }, null, 2));
  } finally { if (socket) socket.close(); child.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
