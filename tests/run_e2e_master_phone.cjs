/* マスターのスマホ画面（src/master-phone.html）を見本データ（?demo=1）で通す — 2026-11-19
 *
 *   node tests/run_e2e_master_phone.cjs
 *
 * ★通信は全部止める（http/https は1本も通さない）＝ログインもDBも使わない。見本の名前だけで動く。
 * 撮った画像は tmp/shots/master-phone/（.gitignore 済み）。
 * 見ること：4画面がスマホ幅（390px）で横にはみ出さない／画面の行き来と「戻る」／しぼりこみ／
 *          回答の中身を読む書き方（answers）と innerHTML が無いこと */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function main() {
  const repo = path.resolve(__dirname, '..');
  const file = path.join(repo, 'src', 'master-phone.html');
  const url = pathToFileURL(file).href + '?demo=1';
  const out = path.join(repo, 'tmp', 'shots', 'master-phone');
  fs.mkdirSync(out, { recursive: true });
  const checks = [], exceptions = [], blocked = [];
  const check = (name, ok) => { checks.push({ name, ok: !!ok }); console.log((ok ? 'OK   ' : 'FAIL ') + name); };

  // ── ソースの見張り（ブラウザ不要） ──
  const src = fs.readFileSync(file, 'utf8');
  check('回答の中身（answers）を select していない', !/select=[^"']*answers/.test(src));
  check('innerHTML を使っていない（名前は textContent）', !/\.innerHTML\s*=/.test(src));

  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
  if (!chrome) throw Error('Chrome not found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scg-master-phone-'));
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const pending = new Map();
  let socket, seq = 0;
  try {
    const active = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(active); i++) await pause(80);
    const port = fs.readFileSync(active, 'utf8').split(/\r?\n/)[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    socket.addEventListener('message', e => {
      const p = JSON.parse(e.data);
      if (p.id) { const q = pending.get(p.id); if (!q) return; pending.delete(p.id); p.error ? q.reject(Error(JSON.stringify(p.error))) : q.resolve(p.result || {}); }
      else if (p.method === 'Runtime.exceptionThrown') exceptions.push(p.params.exceptionDetails.text);
      else if (p.method === 'Fetch.requestPaused') { blocked.push(p.params.request.url.split('?')[0]); cdp('Fetch.failRequest', { requestId: p.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
    });
    const ev = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
    const wait = async (expr, label) => { for (let i = 0; i < 100; i++) { try { if (await ev(expr)) return; } catch (e) {} await pause(50); } throw Error('Timed out: ' + label); };
    const shot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64')); };
    const click = async sel => {
      const pt = await ev('(()=>{const e=' + sel + ';if(!e)throw Error("no element");e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...pt });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...pt });
      await pause(120);
    };
    const noOverflow = () => ev('document.documentElement.scrollWidth <= window.innerWidth');
    const byText = t => '[...document.querySelectorAll("button,a")].find(e=>e.textContent.includes(' + JSON.stringify(t) + '))';

    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp('Page.navigate', { url });
    await wait('document.querySelector(".card")', 'home');

    // ① ホーム
    check('見本データの帯が出ている', await ev('!document.getElementById("demo-bar").hidden'));
    check('ホーム：提出 205 / 256人', await ev('/205/.test(document.querySelector(".cnt").textContent) && /256人/.test(document.querySelector(".cnt").textContent)'));
    check('ホーム：横にはみ出さない', await noOverflow());
    await shot('1_home.png');

    // ② クラスをえらぶ
    await click(byText('クラスを えらんで'));
    await wait('location.hash.startsWith("#/pick/")', 'pick');
    check('えらぶ：クラスが10個', await ev('document.querySelectorAll(".cls").length === 10'));
    check('えらぶ：名前を出さない（数だけ）', await ev('!/見本 学生/.test(document.querySelector(".app").innerText)'));
    check('えらぶ：横にはみ出さない', await noOverflow());
    await shot('2_pick.png');

    // ③ A3 を開く
    await click('[...document.querySelectorAll(".cls")].find(e=>e.querySelector(".c").textContent==="A3")');
    await wait('location.hash.startsWith("#/class/")', 'class');
    check('クラス：まだ 7人の名前', await ev('document.querySelectorAll(".list li").length === 7'));
    check('クラス：「10秒ごと」の表示', await ev('/10秒ごと/.test(document.getElementById("live").textContent)'));
    check('クラス：横にはみ出さない', await noOverflow());
    await shot('3_class_rest.png');
    await click(byText('出した'));
    check('しぼりこみ「出した」：18人・時刻つき', await ev('document.querySelectorAll(".list li.done").length === 18 && [...document.querySelectorAll(".list .tm")].every(e=>/\\d:\\d\\d/.test(e.textContent))'));
    check('しぼりこみ「出した」：横にはみ出さない', await noOverflow());
    await shot('3_class_done.png');
    await click(byText('ぜんいん'));
    check('しぼりこみ「ぜんいん」：7＋18行', await ev('document.querySelectorAll(".list li").length === 25'));

    // 戻る（スマホの戻る＝history.back）
    await ev('history.back()'); await pause(200);
    check('戻る：クラスをえらぶ に戻る', await ev('location.hash.startsWith("#/pick/")'));
    await ev('history.back()'); await pause(200);
    check('戻る：ホームに戻る', await ev('!!document.querySelector(".card .go")'));

    // ④ ぜんたい
    await click(byText('ぜんたいの すすみ'));
    await wait('location.hash.startsWith("#/all/")', 'all');
    check('ぜんたい：まだが多い順（先頭 C3＝まだ14）', await ev('document.querySelector(".rows .c").textContent==="C3" && /14/.test(document.querySelector(".rows .l").textContent)'));
    check('ぜんたい：名前を出さない（数だけ）', await ev('!/見本 学生/.test(document.querySelector(".app").innerText)'));
    check('ぜんたい：横にはみ出さない', await noOverflow());
    await shot('4_all.png');

    check('JS の例外 0件', exceptions.length === 0);
    if (exceptions.length) console.log('  例外: ' + exceptions.join(' / '));
    check('外への通信を試みていない', blocked.length === 0);
    if (blocked.length) console.log('  止めた通信: ' + [...new Set(blocked)].join(' / '));
  } finally {
    try { socket && socket.close(); } catch (e) {}
    child.kill();
  }
  const ng = checks.filter(c => !c.ok).length;
  console.log('\n' + (checks.length - ng) + ' / ' + checks.length + ' OK  画像: ' + out);
  process.exit(ng ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
