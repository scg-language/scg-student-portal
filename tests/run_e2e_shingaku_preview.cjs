/* 進学先情報の見本（src/shingaku-preview.html）のブラウザ実操作テスト。
   通信はすべて遮断する（http/https を1件でも出したら失敗）。ダミーのみ・資格情報なし。
   書き方は tests/run_e2e_career_survey.cjs にそろえた。 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');

async function main(){
 const repo=path.resolve(__dirname,'..'), output=path.join(repo,'_scratch','shingaku-preview-qa');
 fs.mkdirSync(output,{recursive:true});
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'scg-shingaku-e2e-'));
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 if(!chrome)throw new Error('Chrome not found');
 const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const pause=ms=>new Promise(r=>setTimeout(r,ms)), pending=new Map(), checks=[], exceptions=[];
 let socket,sequence=0,httpBlocked=0;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(100);
  if(!fs.existsSync(portFile))throw new Error('DevTools startup failed');
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{
   const packet=JSON.parse(event.data);
   if(packet.id){const p=pending.get(packet.id);if(!p)return;pending.delete(packet.id);packet.error?p.reject(new Error(JSON.stringify(packet.error))):p.resolve(packet.result||{});}
   else if(packet.method==='Runtime.exceptionThrown')exceptions.push(packet.params.exceptionDetails.exception?.description||packet.params.exceptionDetails.text);
   else if(packet.method==='Fetch.requestPaused'){httpBlocked++;cdp('Fetch.failRequest',{requestId:packet.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
  });
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const screenshot=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name),Buffer.from(r.data,'base64'));};
  const check=async(name,expression)=>{const ok=typeof expression==='string'?await evaluate(expression):expression;checks.push({name,ok:Boolean(ok)});if(!ok){await screenshot('failure.png');throw new Error('FAILED: '+name);}};
  // 画面は同期で描き直す（なめらかスクロールなし）。押す前に要素が出ていることを確かめる
  const click=async selector=>{
   const point=await evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');if(!el||!el.getClientRects().length)throw Error("Missing element: "+'+JSON.stringify(selector)+');el.scrollIntoView({block:"center",behavior:"instant"});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
   await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await pause(60);
  };
  const setVal=async(selector,value,ev)=>evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');el.value='+JSON.stringify(value)+';el.dispatchEvent(new Event('+JSON.stringify(ev||'change')+',{bubbles:true}));})()');
  const stuText='document.getElementById("student-root").textContent';
  const staffText='document.getElementById("staff-root").textContent';

  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:pathToFileURL(path.join(repo,'src','shingaku-preview.html')).href});
  for(let i=0;i<100;i++){if(await evaluate('Boolean(window.shingakuPreview&&window.shingakuPreview.ready&&document.querySelector("#st-tab-search"))'))break;await pause(60);}

  // ---- 前提 ----
  await check('見本である旨が出ている','document.getElementById("pv-notice").textContent.includes("これは見本です。ダミーのデータだけで動き、再読み込みで元に戻ります")');
  await check('api.js も外部のスクリプトも読み込まない','Array.from(document.scripts).every(s=>!s.src||(s.src.startsWith("file:")&&!s.src.includes("api.js")))&&!document.querySelector("link[href^=http]")');
  await check('架空の学校は20〜30校','shingakuPreview.schoolCount()>=20&&shingakuPreview.schoolCount()<=30');
  await check('ダミー学生は8人・学籍番号は2604999から降りる帯','JSON.stringify(shingakuPreview.students())===JSON.stringify(["2604999","2604998","2604997","2604996","2604995","2604994","2604993","2604992"])');
  await check('学校のリンクはすべて example.com','shingakuPreview.studentPayload().schools.every(s=>Object.values(s.links).every(u=>u.startsWith("https://example.com/")))');

  // ---- おすすめ ----
  await check('おすすめは10校まで・分野ごとにまとまる','(()=>{const g=document.querySelectorAll(".st-group");const cards=document.querySelectorAll(".st-group .st-card");const ok=Array.from(g).every(x=>Array.from(x.querySelectorAll(".st-card")).length>0);return cards.length>0&&cards.length<=shingakuPreview.REC_GUIDE&&g.length>=2&&ok&&new Set(Array.from(g).map(x=>x.dataset.field)).size===g.length;})()');
  await check('学生の画面に職員向けの列・理由が出ていない','shingakuPreview.staffOnlyTexts().every(t=>!'+stuText+'.includes(t))');
  await evaluate('window.scrollTo(0,0)');await screenshot('student-rec-desktop.png');

  // ---- さがす ----
  await click('#st-tab-search');
  await check('さがす：はじめは全校','document.querySelectorAll("#s-results .st-card").length===shingakuPreview.schoolCount()');
  await setVal('#s-q','ほしなみ','input');
  await check('名前（よみ）で絞れる','document.querySelectorAll("#s-results .st-card").length===1&&document.querySelector("#s-results .st-card").dataset.school==="s01"');
  await setVal('#s-q','専門学校','input');await setVal('#s-field','kaigo');
  await check('分野で絞れる','(()=>{const c=document.querySelectorAll("#s-results .st-card");const p=shingakuPreview.studentPayload().schools;return c.length===p.filter(s=>s.field==="kaigo").length&&Array.from(c).every(x=>p.find(s=>s.id===x.dataset.school).field==="kaigo");})()');
  await setVal('#s-pref','tokyo');
  await check('分野＋場所で絞れる','(()=>{const c=document.querySelectorAll("#s-results .st-card");const p=shingakuPreview.studentPayload().schools;return c.length===p.filter(s=>s.field==="kaigo"&&s.pref==="tokyo").length&&c.length>=1;})()');
  await setVal('#s-q','<img src=x onerror="window.injected=1">','input');
  await check('検索語を HTML として扱わない','!document.querySelector("#student-root img")&&!window.injected&&document.getElementById("s-count").textContent.includes("みつかりませんでした")');
  await setVal('#s-q','','input');await setVal('#s-field','');await setVal('#s-pref','');

  // ---- 詳細 ----
  await click('#s-results .st-card[data-school="s02"]');
  await check('詳細：分野・場所・次のオープンキャンパス・3つのリンク','document.getElementById("d-name").textContent.includes("ことのは情報テクノ専門学校")&&document.getElementById("d-field").textContent.length>0&&document.getElementById("d-pref").textContent.length>0&&/がつ/.test(document.getElementById("d-oc").textContent)&&document.querySelectorAll("#d-links a[href^=\'https://example.com/\']").length===3');
  await click('#st-back');
  await click('#s-results .st-card[data-school="s03"]');
  await check('日程が未定の学校は「まだ きまって いません」','document.getElementById("d-oc").textContent==="まだ きまって いません"');

  // ---- わたしの きぼう：希望が空の学生で3つ入れる ----
  await setVal('#me-select','2604996');
  await check('空の学生は「まだ いれて いません」','document.getElementById("w-updated").textContent==="まだ いれて いません"&&document.querySelectorAll(".w-del").length===0');
  const addFromSearch=async id=>{await click('#st-tab-search');await click('#s-results .st-card[data-school="'+id+'"]');await click('#d-add');};
  await addFromSearch('s04');
  await check('1つ目は第1希望に入る','document.getElementById("st-msg").textContent.includes("だい1")&&shingakuPreview.myWish().choices[0]==="s04"');
  await addFromSearch('s12');await addFromSearch('s21');
  await check('3つ入る','JSON.stringify(shingakuPreview.myWish().choices)===JSON.stringify(["s04","s12","s21"])');
  await addFromSearch('s05');
  await check('4つ目は入らず、理由が出る','JSON.stringify(shingakuPreview.myWish().choices)===JSON.stringify(["s04","s12","s21"])&&document.getElementById("st-msg").classList.contains("ng")&&document.getElementById("st-msg").textContent.includes("3つ まで")');
  await click('#st-tab-wish');
  await check('きぼうの画面に3つと「さいごに かえた ひ」が出る','document.querySelectorAll(".st-slot .wname").length===3&&document.getElementById("w-updated").textContent.startsWith("さいごに かえた ひ")');
  // 変える：第2を消す→第3が繰り上がる、上へ、場所と分野
  await click('.st-slot[data-slot="1"] .w-del');
  await check('消すと繰り上がる','JSON.stringify(shingakuPreview.myWish().choices)===JSON.stringify(["s04","s21",null])');
  await click('.st-slot[data-slot="1"] .w-up');
  await check('上へで順番が入れかわる','JSON.stringify(shingakuPreview.myWish().choices)===JSON.stringify(["s21","s04",null])');
  await setVal('#w-pref','aichi');await setVal('#w-field','car');
  await check('場所と分野の希望がすぐ入る','shingakuPreview.myWish().pref==="aichi"&&shingakuPreview.myWish().field==="car"&&document.getElementById("w-pref").value==="aichi"');
  await evaluate('window.scrollTo(0,0)');await screenshot('student-wish-desktop.png');

  // ---- 職員：履歴と正式な記録 ----
  await click('#mode-staff');
  await check('職員の一覧に8人','document.querySelectorAll("#staff-students tbody tr").length===8');
  await check('食い違いの学生が見分けられる（2人）','document.querySelectorAll("#staff-students tbody .sf-flag.ng").length===2&&document.querySelector("#staff-students tr[data-no=\'2604997\'] .sf-flag").textContent==="食い違いあり"');
  await check('初めの選択は食い違いの学生で、正式な記録と別の欄に出る','document.getElementById("staff-detail").dataset.no==="2604997"&&document.getElementById("staff-current")&&document.getElementById("staff-official").textContent.includes("しろがね町ビジネス専門学校")&&document.querySelectorAll("#staff-current dd.diff").length>=1');
  await click('#staff-students tr[data-no="2604996"] .sf-open');
  await check('変えた学生の「いまの希望」が出る','(()=>{const t=document.querySelector("#staff-students tr[data-no=\'2604996\']").textContent;return t.includes("てっせん自動車専門学校")&&t.includes("銀河坂コンピュータ専門学校")&&t.includes("愛知県")&&t.includes("自動車");})()');
  await check('変更の履歴：いつ・何から何へ（第2希望の削除と並べ替えを含む）','(()=>{const rows=Array.from(document.querySelectorAll("#staff-history tbody tr")).map(r=>Array.from(r.cells).map(c=>c.textContent));return rows.length===shingakuPreview.history("2604996")&&rows.length>=8&&rows.every(r=>/^\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}$/.test(r[0]))&&rows.some(r=>r[1]==="第2希望"&&r[2]==="ことりばし国際ビジネス専門学校"&&r[3]==="てっせん自動車専門学校")&&rows.some(r=>r[1]==="第1希望"&&r[2]==="銀河坂コンピュータ専門学校"&&r[3]==="てっせん自動車専門学校")&&rows.some(r=>r[1]==="場所の希望"&&r[3]==="愛知県");})()');
  await check('正式な記録がない学生は「未確認」','document.getElementById("staff-match").textContent.includes("未確認")&&document.getElementById("staff-official").textContent.includes("まだ確認していません")');
  await check('職員の希望の画面に組み立て漏れの文字が無い','!'+staffText+'.includes("[object")');
  await check('職員の画面にひらがな書きを持ち込まない','["きぼう","がっこう","ばしょ","ぶんや","いれる","かえた"].every(w=>!'+staffText+'.includes(w))');
  await evaluate('window.scrollTo(0,0)');await screenshot('staff-students-desktop.png');

  // ---- 職員：おすすめを付ける（理由は必須・学生には出ない） ----
  await click('#staff-tab-rec');
  const before=await evaluate('document.querySelectorAll("#staff-rec .rec-off").length');
  await check('職員の画面には内部メモと窓口メモが出る','document.querySelectorAll("#staff-rec .staff-memo").length===shingakuPreview.schoolCount()&&'+staffText+'.includes("寮あり")');
  await click('#staff-rec tr[data-id="s04"] .rec-on');
  await click('#staff-rec tr[data-id="s04"] .rec-save');
  await check('理由が空なら付かない','document.querySelector("#staff-rec tr[data-id=\'s04\'] .sf-err").textContent.includes("理由")&&!shingakuPreview.studentPayload().schools.find(s=>s.id==="s04").recommended');
  const reason='<img src=x onerror="window.injected=2">寮があり、留学生の受け入れに慣れている';
  await setVal('#staff-rec tr[data-id="s04"] .rec-reason',reason,'input');
  await click('#staff-rec tr[data-id="s04"] .rec-save');
  await check('おすすめが付き、理由と付けた人が職員にだけ見える','document.querySelectorAll("#staff-rec .rec-off").length==='+(before+1)+'&&document.querySelector("#staff-rec tr[data-id=\'s04\'] .rec-why").textContent.includes("寮があり")&&!document.querySelector("#staff-root img")&&!window.injected&&document.getElementById("rec-log").textContent.includes("銀河坂コンピュータ専門学校")');
  await check('おすすめの数と目安が出る','document.getElementById("rec-count").textContent.includes("おすすめ "+('+(before+1)+')+"校")');
  await evaluate('window.scrollTo(0,0)');await screenshot('staff-rec-desktop.png');
  await click('#mode-student');await click('#st-tab-rec');
  await check('学生のおすすめに出る','Boolean(document.querySelector(".st-group[data-field=\'it\'] .st-card[data-school=\'s04\']"))');
  await check('理由は学生の画面に出ない',`!${stuText}.includes("寮があり")&&!${stuText}.includes("理由")`);
  await check('学生に渡すデータに職員向けの列・理由が無い','(()=>{const p=shingakuPreview.studentPayload();const bad=new Set(shingakuPreview.STAFF_ONLY_KEYS.concat(["reason","by","at"]));const walk=o=>o&&typeof o==="object"?Object.entries(o).every(([k,v])=>!bad.has(k)&&walk(v)):true;const json=JSON.stringify(p);return walk(p)&&shingakuPreview.staffOnlyTexts().every(t=>!json.includes(t));})()');
  await check('学生の画面のどこにも職員向けの値が無い','shingakuPreview.staffOnlyTexts().every(t=>!'+stuText+'.includes(t))');
  await click('.st-card[data-school="s04"]');
  await check('学生の詳細にも理由・メモが出ない','shingakuPreview.staffOnlyTexts().every(t=>!'+stuText+'.includes(t))&&document.getElementById("d-inwish").textContent.includes("だい2")');
  // 外すと学生側から消える
  await click('#mode-staff');await click('#staff-rec tr[data-id="s04"] .rec-off');
  await click('#mode-student');await click('#st-tab-rec');
  await check('外すと学生のおすすめから消える','!document.querySelector(".st-card[data-school=\'s04\']")');

  // ---- スマホ幅 ----
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('window.scrollTo(0,0)');await screenshot('student-rec-mobile.png');
  await check('スマホ幅で学生の画面がはみ出さない','document.documentElement.scrollWidth<=window.innerWidth+1');
  await click('#mode-staff');await evaluate('window.scrollTo(0,0)');await screenshot('staff-mobile.png');
  await check('スマホ幅で職員の画面がページごとはみ出さない（表は枠の中で横に動く）','document.documentElement.scrollWidth<=window.innerWidth+1');

  await check('組み立て漏れの文字（[object …]）が画面に無い','!document.body.textContent.includes("[object")');
  await check('端末に保存していない（localStorage・sessionStorage が空）','localStorage.length===0&&sessionStorage.length===0');
  await check('外部への通信は0件',httpBlocked===0);
  await check('JS の例外は0件',exceptions.length===0);
  console.log(JSON.stringify({passed:checks.filter(c=>c.ok).length,total:checks.length,checks,exceptions,httpBlocked,output},null,2));
 }finally{if(socket)socket.close();child.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
