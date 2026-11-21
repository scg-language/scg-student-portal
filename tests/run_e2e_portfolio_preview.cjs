/* 成績ポートフォリオの見本（src/portfolio-preview.html）のブラウザ実操作テスト。
 * 通信なし（http/https はすべて遮断して数える）・ダミーのみ・ログイン情報なし。
 *   node tests/run_e2e_portfolio_preview.cjs
 * 画像は _scratch/portfolio-preview-qa/（git 対象外）。 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');

async function main(){
 const repo=path.resolve(__dirname,'..'), output=path.join(repo,'_scratch','portfolio-preview-qa');
 fs.mkdirSync(output,{recursive:true});
 const checks=[], exceptions=[];
 const record=(name,ok)=>{checks.push({name,ok:Boolean(ok)});if(!ok)throw new Error('FAILED: '+name);};

 // 静的な見張り：innerHTML・端末への保存・通信を書いていない
 const js=fs.readFileSync(path.join(repo,'src','assets','portfolio-preview.js'),'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/\s\/\/ .*$/gm,'');  // コメントは見ない
 const html=fs.readFileSync(path.join(repo,'src','portfolio-preview.html'),'utf8');
 record('No innerHTML / insertAdjacentHTML in the preview script',!/innerHTML|outerHTML\s*=|insertAdjacentHTML|document\.write/.test(js));
 record('No browser storage in the preview script',!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(js));
 record('No network calls in the preview script',!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(js));
 record('Page does not load api.js or any external script',!/api\.js/.test(html)&&!/src="https?:/.test(html)&&!/href="https?:/.test(html));

 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'scg-portfolio-e2e-'));
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 if(!chrome)throw new Error('Chrome not found');
 const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const pause=ms=>new Promise(r=>setTimeout(r,ms)), pending=new Map();
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
  const screenshot=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,name),Buffer.from(r.data,'base64'));};
  const check=async(name,expression)=>{let ok;try{ok=await evaluate(expression);}catch(e){ok=false;}checks.push({name,ok:Boolean(ok)});if(!ok){await screenshot('failure.png');throw new Error('FAILED: '+name);}};
  // 押す前に「その点に目当ての部品がある」ことを確かめる（なめらかスクロールは使っていない）
  const click=async selector=>{
   const point=await evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');if(!el)throw Error("Missing element");el.scrollIntoView({block:"center",behavior:"instant"});const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!hit||!el.contains(hit))throw Error("Covered");return{x,y};})()');
   await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await pause(80);
  };
  const ready='Boolean(window.portfolioPreview)&&document.querySelectorAll("#pf-samples button").length===4&&typeof document.querySelector("#pf-samples button").onclick==="function"&&document.querySelectorAll("#pf-root [data-section]").length===4';
  const navigate=async()=>{
   await cdp('Page.navigate',{url:pathToFileURL(path.join(repo,'src','portfolio-preview.html')).href});
   for(let i=0;i<100;i++){if(await evaluate(ready).catch(()=>false))return;await pause(60);}throw new Error('Page did not become ready');
  };
  const KEY={'2604999':'A','2604998':'B','2604997':'C','2604996':'D'};
  const pick=async id=>{await click('#pf-samples button[data-sample="'+KEY[id]+'"]');
   await check('Switched to '+id,'portfolioPreview.current()==='+JSON.stringify(id)+'&&document.querySelector("#pf-samples button[data-sample=\\"'+KEY[id]+'\\"]").getAttribute("aria-pressed")==="true"&&document.querySelectorAll("#pf-samples [aria-pressed=true]").length===1');};
  // 選んでいない学生の値が、画面（属性を含む）のどこにも無い
  const noOthers=async id=>check('No values of other samples on screen while '+id+' is selected',`(()=>{
    const dom=document.documentElement.outerHTML, text=document.body.innerText;
    for(const other of portfolioPreview.samples()){ if(other===${JSON.stringify(id)})continue;
      const pf=portfolioPreview.portfolioFor(other);
      if(text.includes(pf.profile.name)||dom.includes(pf.profile.name))return false;
      if(dom.includes(pf.profile.no))return false;
      if(dom.includes('data-current="'+(Math.round(pf.attendance.current*10)/10).toFixed(1)+'"'))return false;
      for(const r of pf.jlpt.results){const t=r.sections.reduce((s,x)=>s+r.scores[x.key],0);if(dom.includes('data-total="'+t+'"'))return false;}
    }
    const me=portfolioPreview.portfolioFor(${JSON.stringify(id)});
    return text.includes(me.profile.name)&&text.includes(me.profile.no);
  })()`);
  const ids=['2604999','2604998','2604997','2604996'];

  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate();

  await check('Preview notice is shown','document.getElementById("pf-banner").textContent.includes("これは見本です。ダミーのデータだけで動き、再読み込みで元に戻ります")');
  await check('Sample buttons do not show names or student numbers','(()=>{const t=document.getElementById("pf-samples").textContent;return portfolioPreview.samples().every(id=>{const p=portfolioPreview.portfolioFor(id).profile;return !t.includes(p.name)&&!t.includes(p.no);});})()');
  await check('Dummy numbers use the 2604999-down band','portfolioPreview.samples().every(id=>/^2604\\d{3}$/.test(id)&&Number(id)>=2604990)');
  await check('portfolioFor returns a copy (changing it does not change the next result)','(()=>{const a=portfolioPreview.portfolioFor("2604999");a.attendance.current=1;a.quizzes.records.length=0;const b=portfolioPreview.portfolioFor("2604999");return b.attendance.current!==1&&b.quizzes.records.length>0;})()');

  // ── A：在籍・記録が多い
  await check('A is selected first','portfolioPreview.current()==="2604999"');
  for(const id of ids){
   await pick(id);
   await check(id+': four sections in order','[...document.querySelectorAll("#pf-root [data-section]")].map(s=>s.dataset.section).join()==="quiz,attendance,exam,jlpt"');
   await check(id+': every section shows the as-of date','[...document.querySelectorAll("#pf-root [data-section]")].every(s=>{const a=s.querySelector(":scope > .pf-asof");return a&&/^\\d{4}-\\d{2}-\\d{2}$/.test(a.dataset.asof)&&a.textContent.includes("じてん");})');
   await check(id+': quiz section has three types','[...document.querySelectorAll("[data-quiztype]")].map(x=>x.dataset.quiztype).join()==="daily,kanji,matome"');
   await check(id+': each quiz type is its own chart (no line across types)','[...document.querySelectorAll("[data-quiztype]")].every(b=>b.querySelectorAll("svg").length<=1&&b.querySelectorAll("polyline").length<=1)&&document.querySelectorAll("#pf-quiz svg").length===[...document.querySelectorAll("[data-quiztype]")].filter(b=>!b.querySelector("[data-empty]")).length');
   await check(id+': line joins only first attempts (retests are separate dots)','[...document.querySelectorAll("[data-quiztype]")].every(b=>{const pl=b.querySelector("polyline");const firsts=b.querySelectorAll(".pf-rec:not(.is-retest)").length;const pts=pl?pl.getAttribute("points").trim().split(/\\s+/).length:0;return firsts<2?!pl:pts===firsts;})');
   await check(id+': scores are said as "Nもん中 Mもん"','[...document.querySelectorAll(".pf-rec-score")].every(x=>/^\\d+もん中 \\d+もん$/.test(x.textContent))');
   await check(id+': daily tests have no pass mark; pass line only on kanji/matome','!document.querySelector("[data-quiztype=daily] .pf-badge")&&!document.querySelector("[data-quiztype=daily] .pf-passline")&&[...document.querySelectorAll("[data-quiztype=kanji],[data-quiztype=matome]")].every(b=>b.querySelector("[data-empty]")||(b.querySelector(".pf-passline[data-passline=\\"0.8\\"]")&&b.querySelectorAll(".pf-badge").length===b.querySelectorAll(".pf-rec").length))');
   await check(id+': pass marks follow 80% of questions','[...document.querySelectorAll("[data-quiztype=kanji] .pf-rec,[data-quiztype=matome] .pf-rec")].every(r=>{const m=r.querySelector(".pf-rec-score").textContent.match(/(\\d+)もん中 (\\d+)もん/);return (Number(m[2])/Number(m[1])>=0.8)===(r.querySelector(".pf-badge").dataset.pass==="1");})');
   await check(id+': no rank, comparison, points, deviation or away count','!/じゅんい|順位|へいきん|平均|偏差|へんさ|はなれ|離れ|配点|はいてん|クラス の なか/.test(document.getElementById("pf-root").innerText)&&!/(?<!じ)てん/.test(document.getElementById("pf-quiz").innerText)');
   await check(id+': no internal words on screen','!/RLS|attempts|quiz_|profiles|student_id|Supabase|null|undefined|NaN/.test(document.body.innerText)');
   await noOthers(id);
   await evaluate('window.scrollTo(0,0)');await screenshot(id+'-mobile.png');
   await check(id+': no horizontal overflow on phone width','document.documentElement.scrollWidth<=window.innerWidth+1');
  }

  // 種類ごとの更新日が違ってよい（A＝小テスト今日・出席率先週）
  await pick('2604999');
  await check('A: quiz is as of today, attendance as of last week','document.querySelector("#pf-quiz > .pf-asof").dataset.asof==="2026-11-21"&&document.querySelector("#pf-attendance > .pf-asof").dataset.asof==="2026-11-14"');
  await check('A: retest is a separate record marked （再） and the first score stays','(()=>{const rows=[...document.querySelectorAll("[data-quiztype=kanji] .pf-rec")];const first=rows.find(r=>r.dataset.title==="かんじ L15-16");const re=rows.find(r=>r.dataset.title==="かんじ L15-16（再）");return first&&re&&re.dataset.retest==="1"&&first.querySelector(".pf-rec-score").textContent==="10もん中 7もん"&&re.querySelector(".pf-rec-score").textContent==="10もん中 9もん"&&first.querySelector(".pf-badge").dataset.pass==="0"&&re.querySelector(".pf-badge").dataset.pass==="1";})()');
  await check('A: retest dot is drawn hollow and off the line','document.querySelectorAll("[data-quiztype=kanji] .pf-dot-retest").length===1&&document.querySelector("[data-quiztype=kanji] .pf-legend")');
  await check('A: not-reached wording is neutral (no warning color words)','document.querySelector("[data-quiztype=kanji] .pf-badge[data-pass=\\"0\\"]").textContent==="80% に とどかなかった"&&!/ふごうかく|だめ|ダメ|わるい|注意/.test(document.getElementById("pf-quiz").innerText)');
  await check('A: attendance shows current value and the 90% / 80% guide lines','document.querySelector("[data-current]").dataset.current==="96.4"&&document.querySelectorAll("#pf-attendance .pf-guide").length===2&&document.querySelector(".pf-guide[data-guide=\\"90\\"]")&&document.querySelector(".pf-guide[data-guide=\\"80\\"]")&&document.querySelectorAll("#pf-attendance .pf-bar").length===6');
  await check('A: regular exams by term and subject','document.querySelectorAll("#pf-exam [data-term]").length===2&&document.querySelectorAll("#pf-exam [data-term] tr").length===10');
  await check('A: JLPT rows have level, result, section scores and total','document.querySelectorAll("#pf-jlpt [data-jlpt]").length===2&&document.getElementById("pf-jlpt").innerText.includes("N3")&&document.getElementById("pf-jlpt").innerText.includes("N4")&&document.querySelector("#pf-jlpt [data-total=\\"112\\"]")&&document.querySelector("#pf-jlpt [data-total=\\"88\\"]")');
  await check('A: no "days until next exam" countdown','!/あと\\s*\\d+\\s*にち|あと\\s*\\d+\\s*日/.test(document.body.innerText)');
  await check('A (enrolled): action buttons exist and no graduate label','document.querySelectorAll("[data-action]").length===2&&!document.querySelector("[data-graduated]")');
  await click('[data-action="quiz"]');
  await check('A: action button only says it is a preview','!document.querySelector(".pf-actmsg").hidden&&portfolioPreview.current()==="2604999"');

  // B：JLPT まだ
  await pick('2604998');
  await check('B: JLPT says "まだ ありません", others have data','document.querySelector("#pf-jlpt [data-empty]")&&document.querySelector("#pf-jlpt [data-empty]").textContent.includes("まだ ありません")&&!document.querySelector("#pf-quiz > [data-empty]")&&!document.querySelector("#pf-exam [data-empty]")&&!document.querySelector("#pf-attendance [data-empty]")');
  await check('B: retest record also separate','document.querySelector("[data-quiztype=kanji] .pf-rec[data-title=\\"かんじ L5-6（再）\\"]")&&document.querySelector("[data-quiztype=kanji] .pf-rec[data-title=\\"かんじ L5-6\\"]")');

  // C：入学直後
  await pick('2604997');
  await check('C: almost empty — kanji, matome, exams, JLPT say "まだ ありません"','["kanji","matome"].every(k=>document.querySelector("[data-quiztype="+k+"] [data-empty]"))&&document.querySelector("#pf-exam [data-empty]")&&document.querySelector("#pf-jlpt [data-empty]")&&[...document.querySelectorAll("[data-empty]")].every(e=>e.textContent.includes("まだ ありません"))');
  await check('C: daily tests and one month of attendance are shown','document.querySelectorAll("[data-quiztype=daily] .pf-rec").length===2&&document.querySelectorAll("#pf-attendance .pf-bar").length===1');

  // D：卒業生
  await pick('2604996');
  await check('D: graduate label is on top and there are no action buttons','document.querySelector(".pf-head [data-graduated]")&&document.querySelector(".pf-head").firstElementChild.dataset.graduated==="1"&&document.querySelector("[data-graduated]").textContent.includes("そつぎょうせい")&&document.querySelectorAll("[data-action]").length===0&&document.querySelectorAll("#pf-root button").length===0');
  await check('D: graduate can still read all four records','document.querySelectorAll("#pf-quiz .pf-rec").length>0&&document.querySelectorAll("#pf-attendance .pf-bar").length>0&&document.querySelectorAll("#pf-exam [data-term]").length===2&&document.querySelectorAll("#pf-jlpt [data-jlpt]").length===2');

  // 広い画面でも崩れない
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('window.scrollTo(0,0)');await screenshot('2604996-desktop.png');
  await check('Desktop width has no horizontal overflow','document.documentElement.scrollWidth<=window.innerWidth+1');

  // 再読み込みで元に戻る（保存しない）
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate();
  await check('Reload returns to the first sample and keeps nothing','portfolioPreview.current()==="2604999"&&document.querySelector(".pf-actmsg").hidden&&localStorage.length===0&&sessionStorage.length===0');

  record('No live HTTP request was attempted',httpBlocked===0);
  record('No browser JavaScript exceptions',exceptions.length===0);
  console.log(JSON.stringify({passed:checks.filter(c=>c.ok).length,total:checks.length,exceptions,httpBlocked,output},null,2));
 }finally{if(socket)socket.close();child.kill();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
