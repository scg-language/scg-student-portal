/* Live synthetic-demo E2E. Use only after the demo SQL and room keys are ready.
 * Two isolated Chrome profiles represent the teacher phone and classroom PC.
 * Credentials, tokens and keyed classroom URLs never enter the report.
 * Usage: node tests/run_e2e_teacher_demo_remote.cjs [base URL or src directory]
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');

const repo=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=path.join(repo,'_scratch','teacher-demo-remote-qa');
const checks=[];
let currentStep='preparation';

function readCredentials(){
  const program='import json,os,sys;sys.path.insert(0,"tests");from env_creds import _load_dotenv,get_teacher_no,get_teacher_pw;_load_dotenv();print(json.dumps({"no":os.environ.get("SCG_DEMO_TEACHER_NO") or get_teacher_no(),"pw":os.environ.get("SCG_DEMO_TEACHER_PW") or get_teacher_pw()}))';
  const result=spawnSync('py',['-X','utf8','-c',program],{cwd:repo,encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error('QA_CREDENTIALS_UNAVAILABLE');
  let value;try{value=JSON.parse(result.stdout);}catch(_){throw new Error('QA_CREDENTIALS_UNAVAILABLE');}
  if(!value.no||!value.pw)throw new Error('QA_CREDENTIALS_UNAVAILABLE');
  return value;
}
function roomAccessPath(){
  const override=String(process.env.SCG_DEMO_ROOM_ACCESS||'').trim();
  if(override)return path.resolve(repo,override);
  const relative=['マイドライブ','claude作業場','1.3_scratch_codex(PII含む)','学生ポータル_2台デモ','room-access.json'];
  const candidates=[];
  for(const drive of ['I:/','H:/','G:/']){
    try{
      const candidate=path.join(drive,...relative);
      if(fs.statSync(path.join(drive,'マイドライブ')).isDirectory()&&fs.statSync(path.join(drive,'共有ドライブ')).isDirectory()&&fs.statSync(candidate).isFile())candidates.push(candidate);
    }catch(_){}
  }
  if(candidates.length!==1)throw new Error('QA_ROOM_ACCESS_UNAVAILABLE');
  return candidates[0];
}

function readRoomKey(){
  let value;try{value=JSON.parse(fs.readFileSync(roomAccessPath(),'utf8').replace(/^\uFEFF/,''));}catch(_){throw new Error('QA_ROOM_ACCESS_UNAVAILABLE');}
  const room=Array.isArray(value.rooms)?value.rooms.find(item=>String(item.roomId||item.room_id||item.id||'')==='room-a'):null;
  if(!room)throw new Error('QA_ROOM_ACCESS_UNAVAILABLE');
  let key=room.key||room.displayKey||room.display_key||'';
  if(!key){
    const url=room.pcUrl||room.pc_url||room.displayUrl||room.display_url||room.url||'';
    try{key=decodeURIComponent(new URL(url).hash.slice(1));}catch(_){}
  }
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(key))throw new Error('QA_ROOM_ACCESS_UNAVAILABLE');
  return key;
}
function baseURL(argument){
  if(!argument)return pathToFileURL(path.join(repo,'src')+path.sep);
  if(/^(https?:|file:)/.test(argument))return new URL(argument.endsWith('/')||/\.html(?:[?#]|$)/.test(argument)?argument:argument+'/');
  const resolved=path.resolve(argument);return pathToFileURL(fs.statSync(resolved).isDirectory()?resolved+path.sep:resolved);
}
function supabaseOrigin(){
  const source=fs.readFileSync(path.join(repo,'src','assets','api.js'),'utf8');
  const match=source.match(/\b(?:const|let|var)\s+SB_URL\s*=\s*(["'])(.*?)\1/);
  if(!match)throw new Error('QA_API_CONFIGURATION_UNAVAILABLE');
  return new URL(match[2]).origin;
}
function publicShape(value){
  const top=['schemaVersion','mode','roomLabel','statusLabel','testTitle','classLabel','target','submitted','remainingSeconds','showStats','average','correctRate','question'];
  if(!value||Object.keys(value).some(key=>!top.includes(key))||!['waiting','running','review'].includes(value.mode))return false;
  if(value.question){
    if(Object.keys(value.question).some(key=>!['index','total','text','options'].includes(key)))return false;
    if(!Array.isArray(value.question.options)||value.question.options.some(item=>Object.keys(item).some(key=>!['label','count','correct'].includes(key))))return false;
  }
  return !/確認用の学生|demo-student-|private_state|studentId|teacherId|submittedAt/.test(JSON.stringify(value));
}

class Browser{
  constructor(label,base,apiOrigin){this.label=label;this.base=base;this.apiOrigin=apiOrigin;this.pending=new Map();this.contexts=new Map();this.seq=0;this.exceptions=0;this.blocked=0;this.roomStoredTokenUsed=false;this.requestCounts={};}
  async open(){
    this.profile=fs.mkdtempSync(path.join(os.tmpdir(),'scg-teacher-demo-'+this.label+'-'));
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
    if(!chrome)throw new Error('QA_BROWSER_UNAVAILABLE');
    this.child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+this.profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const portFile=path.join(this.profile,'DevToolsActivePort');
    for(let i=0;i<120&&!fs.existsSync(portFile);i++)await pause(100);
    if(!fs.existsSync(portFile))throw new Error('QA_BROWSER_UNAVAILABLE');
    const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
    const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    this.socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{this.socket.addEventListener('open',resolve,{once:true});this.socket.addEventListener('error',()=>reject(new Error('QA_BROWSER_UNAVAILABLE')),{once:true});});
    this.socket.addEventListener('message',event=>{
      const packet=JSON.parse(event.data);
      if(packet.id){const waiter=this.pending.get(packet.id);if(!waiter)return;this.pending.delete(packet.id);packet.error?waiter.reject(new Error('QA_BROWSER_COMMAND_FAILED')):waiter.resolve(packet.result||{});}
      else if(packet.method==='Runtime.exceptionThrown')this.exceptions++;
      else if(packet.method==='Runtime.executionContextCreated'){const item=packet.params.context;this.contexts.set(item.id,item.auxData||{});}
      else if(packet.method==='Runtime.executionContextDestroyed')this.contexts.delete(packet.params.executionContextId);
      else if(packet.method==='Runtime.executionContextsCleared')this.contexts.clear();
      else if(packet.method==='Fetch.requestPaused')this.route(packet.params).catch(()=>{});
    });
    await this.cdp('Page.enable');await this.cdp('Runtime.enable');
    await this.cdp('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
    await this.cdp('Emulation.setDeviceMetricsOverride',{width:this.label==='phone'?390:1440,height:this.label==='phone'?844:1000,deviceScaleFactor:1,mobile:this.label==='phone'});
    if(this.label==='room')await this.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'window.__demoQaStorageReads=[];try{localStorage.setItem("sp_token","demo-qa-inert-marker");localStorage.setItem("sp_profile",JSON.stringify({role:"teacher",display_name:"QA fixture"}));const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){window.__demoQaStorageReads.push(String(key));return get.call(this,key);};}catch(_){}'});
  }
  async route(params){
    const request=params.request,url=new URL(request.url),preflight=request.method==='OPTIONS';let allowed=false,kind='';
    if(url.origin===this.apiOrigin){
      if((request.method==='POST'||preflight)&&url.pathname==='/auth/v1/token'&&['password','refresh_token'].includes(url.searchParams.get('grant_type'))){allowed=this.label==='phone';kind='auth';}
      if((request.method==='GET'||preflight)&&url.pathname==='/rest/v1/profiles'&&/^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get('id')||'')){allowed=this.label==='phone';kind='profile';}
      const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/(teacher_demo_rooms|teacher_demo_load|teacher_demo_publish|get_teacher_demo_display)$/);
      if((request.method==='POST'||preflight)&&rpc){allowed=this.label==='room'?rpc[1]==='get_teacher_demo_display':rpc[1]!=='get_teacher_demo_display';kind=rpc[1];}
      if(this.label==='room'&&String(request.headers.Authorization||request.headers.authorization||'').includes('demo-qa-inert-marker'))this.roomStoredTokenUsed=true;
    }else if(this.base.protocol!=='file:'&&url.origin===this.base.origin){
      const prefix=new URL('.',this.base).pathname;
      allowed=(url.pathname.startsWith(prefix)&&/\.(html|js|css|svg|png|ico)$/.test(url.pathname))||url.pathname==='/favicon.ico';kind='static';
    }
    if(allowed){if(preflight)kind='preflight:'+kind;this.requestCounts[kind]=(this.requestCounts[kind]||0)+1;await this.cdp('Fetch.continueRequest',{requestId:params.requestId});}
    else{this.blocked++;await this.cdp('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'});}
  }
  cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++this.seq;this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression,contextId){const params={expression,returnByValue:true,awaitPromise:true};if(contextId)params.contextId=contextId;const result=await this.cdp('Runtime.evaluate',params);if(result.exceptionDetails)throw new Error('QA_PAGE_EVALUATION_FAILED');return result.result.value;}
  async wait(expression,label,timeout=35000){currentStep=label;const until=Date.now()+timeout;while(Date.now()<until){try{if(await this.evaluate(expression))return;}catch(_){}await pause(150);}throw new Error('QA_WAIT_FAILED');}
  async navigate(url){await this.cdp('Page.navigate',{url});}
  async click(selector){
    const point=await this.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled)throw Error("CONTROL_NOT_READY");e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
    await this.cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await this.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await pause(120);
  }
  async screenshot(name){const result=await this.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name),Buffer.from(result.data,'base64'));}
  async frameCheck(){
    const tree=await this.cdp('Page.getFrameTree');const id=tree.frameTree.childFrames?.[0]?.frame?.id;
    const context=[...this.contexts].find(([,aux])=>aux.frameId===id&&aux.isDefault);
    if(!context)return false;
    return this.evaluate('typeof api==="undefined"&&typeof window.__twoDevicePreview?.getState==="undefined"&&!/確認用の学生|demo-student-/.test(document.body.textContent)',context[0]);
  }
  async close(){
    if(this.socket)this.socket.close();if(this.child){this.child.kill();await pause(500);}
    if(this.profile){
      const root=path.resolve(os.tmpdir())+path.sep,resolved=path.resolve(this.profile);
      if(resolved.startsWith(root)&&path.basename(resolved).startsWith('scg-teacher-demo-'+this.label+'-')){try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:200});}catch(_){}}
    }
  }
}

async function main(){
  fs.mkdirSync(output,{recursive:true});
  const credentials=readCredentials(),key=readRoomKey(),base=baseURL(process.argv.slice(2).find(value=>!value.startsWith('--'))),origin=supabaseOrigin();
  const phone=new Browser('phone',base,origin),room=new Browser('room',base,origin);
  let teacherReady=false,complete=false;
  const check=(name,ok)=>{currentStep=name;checks.push({name,passed:Boolean(ok)});if(!ok)throw new Error('QA_CHECK_FAILED');};
  try{
    await Promise.all([phone.open(),room.open()]);
    const phoneURL=new URL('teacher-two-device-demo.html',base),roomURL=new URL('teacher-two-device-demo-room.html',base);roomURL.hash=key;
    await Promise.all([phone.navigate(phoneURL.href),room.navigate(roomURL.href)]);
    await phone.wait('Boolean(window.__teacherDemoRemote)','teacher page ready');
    await room.wait('Boolean(window.__teacherDemoDisplay)','room page ready');
    check('Teacher login is separate',await phone.evaluate('!document.getElementById("demo-login-panel").hidden&&document.getElementById("teacher-app").hidden'));
    await phone.evaluate('document.getElementById("demo-login-id").value='+JSON.stringify(credentials.no)+';document.getElementById("demo-login-password").value='+JSON.stringify(credentials.pw));
    await phone.click('#demo-login-button');
    await phone.wait('__teacherDemoRemote.getStatus().ready&&__teacherDemoRemote.getStatus().version>=1&&!__teacherDemoRemote.getStatus().sending','teacher login and room load');teacherReady=true;
    check('Teacher role is required',await phone.evaluate('["teacher","master"].includes(api.profile.role)&&document.getElementById("demo-login-panel").hidden'));
    await phone.click('#reset-preview');await phone.click('#confirm-action');
    await phone.wait('__teacherDemoRemote.getStatus().ready&&!__teacherDemoRemote.getStatus().sending&&__twoDevicePreview.getState().run===null','reset synthetic state');
    await room.wait('__teacherDemoDisplay.getProjection().mode==="waiting"','initial classroom waiting');
    check('PC has no teacher session',await room.evaluate('api.token===null&&api.profile===null&&window.__demoQaStorageReads.length===0'));
    check('PC never sends stored teacher token',!room.roomStoredTokenUsed);
    await phone.click('#start-run');
    await room.wait('__teacherDemoDisplay.getProjection().mode==="running"','classroom sees start');
    check('Separate profiles share the started run',await room.evaluate('__teacherDemoDisplay.getProjection().target===20&&__teacherDemoDisplay.getProjection().submitted===0'));
    await phone.click('#simulate-five');
    await room.wait('__teacherDemoDisplay.getProjection().submitted===5','classroom sees five submissions');
    check('Stats and answers are initially hidden',await room.evaluate('__teacherDemoDisplay.getProjection().average===null&&__teacherDemoDisplay.getProjection().question===null'));
    const before=await room.evaluate('__teacherDemoDisplay.getProjection().remainingSeconds');
    await phone.click('#extend-run');
    await room.wait('__teacherDemoDisplay.getProjection().remainingSeconds>'+Math.max(0,before+250),'classroom sees extension');
    await phone.click('#toggle-stats');
    await room.wait('__teacherDemoDisplay.getProjection().showStats&&__teacherDemoDisplay.getProjection().average!==null','classroom sees permitted statistics');
    check('Running mode has no answer options',await room.evaluate('__teacherDemoDisplay.getProjection().question===null'));
    check('Public response is a whitelist',publicShape(await room.evaluate('__teacherDemoDisplay.getProjection()')));
    check('Phone width has no page overflow',await phone.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));
    await phone.click('#end-run');await phone.click('#confirm-action');
    await room.wait('__teacherDemoDisplay.getProjection().mode==="review"&&Boolean(__teacherDemoDisplay.getProjection().question)','classroom sees ended review');
    const question=await room.evaluate('__teacherDemoDisplay.getProjection().question.index');
    await phone.click('#next-question');
    await room.wait('__teacherDemoDisplay.getProjection().question.index==='+String(question+1),'classroom sees next question');
    check('Review contains only aggregate options',publicShape(await room.evaluate('__teacherDemoDisplay.getProjection()')));
    await phone.click('#prev-question');await room.wait('__teacherDemoDisplay.getProjection().question.index==='+String(question),'classroom sees previous question');
    await phone.click('#hardest-question');
    const expectedIndex=await phone.evaluate('__twoDevicePreview.getState().run.questionIndex');
    await room.wait('__teacherDemoDisplay.getProjection().question.index==='+String(expectedIndex),'classroom sees hardest question');
    check('Classroom renderer has no private API or student names',await room.frameCheck());
    await room.screenshot('classroom-review-desktop.png');
    await room.cdp('Page.reload',{ignoreCache:true});
    await room.wait('Boolean(window.__teacherDemoDisplay)&&__teacherDemoDisplay.getProjection().mode==="review"&&__teacherDemoDisplay.getProjection().submitted===5','classroom reload restores review');
    check('PC reload still has no teacher session',await room.evaluate('api.token===null&&api.profile===null&&window.__demoQaStorageReads.length===0'));
    const runId=await phone.evaluate('__twoDevicePreview.getState().run.id');
    await phone.wait('!__teacherDemoRemote.getStatus().sending','teacher sync completes before reload');
    await phone.cdp('Page.reload',{ignoreCache:true});
    await phone.wait('Boolean(window.__teacherDemoRemote)&&__teacherDemoRemote.getStatus().ready&&!__teacherDemoRemote.getStatus().sending&&Boolean(__twoDevicePreview.getState().run)','teacher reload restores state');
    check('Phone reload restores submitted state',await phone.evaluate('__twoDevicePreview.getState().run.id==='+JSON.stringify(runId)+'&&__twoDevicePreview.getState().run.submittedCount===5&&__twoDevicePreview.getState().run.status==="ended"'));
    await room.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    check('Classroom width has no page overflow',await room.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));await room.screenshot('classroom-review-mobile.png');
    await phone.click('#stop-projection');await room.wait('__teacherDemoDisplay.getProjection().mode==="waiting"','stop projection returns classroom to waiting');
    check('Projection stop clears aggregate values',await room.evaluate('__teacherDemoDisplay.getProjection().submitted===null&&__teacherDemoDisplay.getProjection().average===null&&__teacherDemoDisplay.getProjection().question===null'));
    check('Only approved request paths were used',phone.blocked===0&&room.blocked===0);
    check('No JavaScript exceptions',phone.exceptions===0&&room.exceptions===0);
    check('Classroom never used a stored teacher token',!room.roomStoredTokenUsed);
    complete=true;
    const report={success:true,checks,phoneRequests:phone.requestCounts,roomRequests:room.requestCounts,phoneExceptions:phone.exceptions,roomExceptions:room.exceptions,unauthorizedRequestsBlocked:phone.blocked+room.blocked};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{
    if(!complete){
      if(teacherReady){try{await phone.evaluate('if(window.__twoDevicePreview?.getState().run?.projectionActive)window.__twoDevicePreview.dispatch({type:"STOP_PROJECTION"})');await pause(3000);}catch(_){}}
      try{await room.screenshot('classroom-failure.png');}catch(_){}
      const report={success:false,failedStep:currentStep,checks,phoneExceptions:phone.exceptions,roomExceptions:room.exceptions,unauthorizedRequestsBlocked:phone.blocked+room.blocked};
      fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }
    await Promise.all([phone.close(),room.close()]);
  }
}
main().catch(()=>{console.error('Remote demo QA did not complete. Check the named step in the sanitized report.');process.exitCode=1;});
