/* Dummy-data preview only. All API requests are blocked, including in URL mode. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');

async function main(){
 const repo=path.resolve(__dirname,'..');
 const input=process.argv[2]||path.join(repo,'src','teacher-two-device-preview.html');
 const url=/^https?:/.test(input)?input:pathToFileURL(path.resolve(input)).href;
 const output=path.join(repo,'_scratch','20261116-two-device-preview-qa',/^https?:/.test(url)?'pages':'local');
 fs.mkdirSync(output,{recursive:true});
 const allowed=new Set();
 if(/^https?:/.test(url))for(const u of [new URL(url),new URL('assets/teacher-two-device-core.js',url),new URL('assets/teacher-two-device-preview.js',url)])allowed.add(u.origin+u.pathname);
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
 if(!chrome)throw Error('Chrome not found');
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'scg-two-device-'));
 const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const pending=new Map(),contexts=new Map(),checks=[],exceptions=[],blocked=[];
 let socket,sequence=0;
 try{
  const active=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(active);i++)await pause(80);
  if(!fs.existsSync(active))throw Error('DevTools startup failed');
  const port=fs.readFileSync(active,'utf8').split(/\r?\n/)[0];
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',e=>{
   const packet=JSON.parse(e.data);
   if(packet.id){const p=pending.get(packet.id);if(!p)return;pending.delete(packet.id);packet.error?p.reject(Error(JSON.stringify(packet.error))):p.resolve(packet.result||{});}
   else if(packet.method==='Runtime.exceptionThrown')exceptions.push(packet.params.exceptionDetails.text);
   else if(packet.method==='Runtime.executionContextCreated'){const c=packet.params.context;if(c.auxData?.isDefault)contexts.set(c.auxData.frameId,c.id);}
   else if(packet.method==='Runtime.executionContextsCleared')contexts.clear();
   else if(packet.method==='Fetch.requestPaused'){
    const r=packet.params;let ok=false;try{const u=new URL(r.request.url);ok=allowed.has(u.origin+u.pathname);}catch{}
    if(!ok)blocked.push(r.request.url.split('?')[0]);
    cdp(ok?'Fetch.continueRequest':'Fetch.failRequest',ok?{requestId:r.requestId}:{requestId:r.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
   }
  });
  const evaluate=async(expression,contextId)=>{const r=await cdp('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  const roomEval=async expression=>{const r=await cdp('Page.getFrameTree');const f=r.frameTree.childFrames?.find(x=>x.frame.url.includes('view=room'));if(!f||!contexts.has(f.frame.id))return null;return evaluate(expression,contexts.get(f.frame.id));};
  const wait=async(fn,label)=>{for(let i=0;i<100;i++){try{if(await fn())return;}catch{}await pause(50);}throw Error('Timed out: '+label);};
  const capture=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name),Buffer.from(r.data,'base64'));};
  const check=async(name,fn)=>{const ok=await fn();checks.push({name,ok:!!ok});if(!ok){await capture('failure.png');throw Error('FAILED: '+name);}};
  const click=async selector=>{
   await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled)throw Error("Missing or disabled control");e.scrollIntoView({block:"center",behavior:"instant"});return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()');
   const point=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
   await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url});
  await wait(()=>evaluate('Boolean(window.__twoDevicePreview?.getProjection)'), 'preview ready');
  await wait(()=>roomEval('Boolean(window.__twoDevicePreview?.getProjection)'), 'projection iframe ready');
  await check('Explicit dummy-data and browser-only scope',()=>evaluate('/架空|見本/.test(document.body.textContent)&&/別端末|同じブラウザ/.test(document.body.textContent)'));
  await check('Projection starts in waiting mode',()=>roomEval('__twoDevicePreview.getProjection()?.mode==="waiting"'));
  await click('#start-run');
  await wait(()=>roomEval('__twoDevicePreview.getProjection()?.mode==="running"'), 'start reaches room');
  await check('Start reaches the separate projection frame',()=>roomEval('__twoDevicePreview.getProjection().mode==="running"'));
  await check('Correct answers and options are not released by default',()=>roomEval('(()=>{const p=__twoDevicePreview.getProjection();return !p.question&&!p.average&&!p.options;})()'));
  await click('#simulate-five');
  await wait(()=>roomEval('__twoDevicePreview.getProjection()?.submitted===5'), 'submission count reaches room');
  await check('Simulated submissions reach projection as aggregate',()=>roomEval('__twoDevicePreview.getProjection().submitted===5'));
  const before=await evaluate('__twoDevicePreview.getProjection().remainingSeconds');
  await click('#extend-run');
  await check('Five-minute extension changes remaining time',async()=>await evaluate('__twoDevicePreview.getProjection().remainingSeconds')>=before+295);
  await click('#toggle-stats');
  await wait(()=>roomEval('Boolean(__twoDevicePreview.getProjection()?.showStats)'), 'stats enabled');
  await check('Explicit stats switch releases aggregate live rates',()=>roomEval('(()=>{const p=__twoDevicePreview.getProjection();return p.showStats&&p.average!==null&&p.question===null;})()'));
  await evaluate('window.scrollTo(0,0)');await capture('desktop-running.png');
  await click('#end-run');
  await wait(()=>evaluate('document.getElementById("confirm-dialog").open'), 'end confirmation');
  await click('#cancel-action');
  await check('Cancelling end keeps the test running',()=>evaluate('__twoDevicePreview.getProjection().mode==="running"'));
  await click('#end-run');await click('#confirm-action');
  await wait(()=>roomEval('__twoDevicePreview.getProjection()?.mode==="review"'), 'review reaches room');
  await check('Ending keeps projection in answer-review mode',()=>roomEval('__twoDevicePreview.getProjection().mode==="review"'));
  const first=await roomEval('JSON.stringify(__twoDevicePreview.getProjection().question)');
  await click('#next-question');
  await check('Question navigation changes the projected question',async()=>await roomEval('JSON.stringify(__twoDevicePreview.getProjection().question)')!==first);
  await click('#hardest-question');
  await check('Hardest question action remains in review',()=>roomEval('__twoDevicePreview.getProjection().mode==="review"&&Boolean(__twoDevicePreview.getProjection().question)'));
  await check('Projection message contains no private record fields',()=>roomEval('(()=>{const denied=new Set(["studentId","student_id","display_name","teacherId","teacher_id","runId","run_id","students","answers","history","events","score"]);function walk(x){return !x||typeof x!=="object"||Object.entries(x).every(([k,v])=>!denied.has(k)&&walk(v));}return walk(__twoDevicePreview.getProjection());})()'));
  await check('Projection frame displays no individual student names',()=>roomEval('!/確認用の学生|検証学生|student-[0-9]|生徒[0-9]/.test(document.body.textContent)'));
  await click('#stop-projection');
  await wait(()=>roomEval('__twoDevicePreview.getProjection()?.mode==="waiting"'), 'projection stopped');
  await check('Stop projection returns the room to waiting',()=>roomEval('__twoDevicePreview.getProjection().mode==="waiting"'));
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('window.scrollTo(0,0)');
  await check('Mobile preview has no page overflow',()=>evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  await capture('mobile-controls.png');
  await click('#view-room');
  await check('Mobile projection tab opens the room pane',()=>evaluate('document.getElementById("view-room").getAttribute("aria-pressed")==="true"&&document.getElementById("room-pane").dataset.mobileHidden==="false"'));
  await evaluate('window.scrollTo(0,0)');await capture('mobile-projection.png');
  await click('#view-teacher');
  await check('Mobile control tab retains the completed run',()=>evaluate('document.getElementById("view-teacher").getAttribute("aria-pressed")==="true"&&Boolean(__twoDevicePreview.getState().run)'));
  await check('No unexpected network/API request',async()=>blocked.length===0);
  await check('No browser JavaScript exceptions',async()=>exceptions.length===0);
  const result={url,checks,blockedRequests:blocked.length,exceptions,output};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
 }finally{if(socket)socket.close();child.kill();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
