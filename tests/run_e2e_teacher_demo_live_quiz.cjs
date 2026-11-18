/* Opt-in live fixture E2E: teacher phone + classroom PC + existing student portal.
 * Uses only s001..s040 and the dedicated three-question fixture, never sample-submit.
 * No credentials, keys, URLs, response bodies, or identifiers enter reports.
 * Requires SP_DEMO_LIVE=1 and the live fixture SQL. Root controls when to run it.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');

const repo=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=path.join(repo,'_scratch','teacher-demo-live-qa');
const checks=[];
let currentStep='preparation';

function readCredentials(){
  const program='import json,os,sys;sys.path.insert(0,"tests");from env_creds import _load_dotenv,get_teacher_no,get_teacher_pw,get_student_no,get_student_pw;_load_dotenv();print(json.dumps({"teacher":{"no":os.environ.get("SCG_DEMO_TEACHER_NO") or get_teacher_no(),"pw":os.environ.get("SCG_DEMO_TEACHER_PW") or get_teacher_pw()},"student":{"no":os.environ.get("SCG_DEMO_STUDENT_NO") or get_student_no(),"pw":os.environ.get("SCG_DEMO_STUDENT_PW") or get_student_pw()}}))';
  const result=spawnSync('py',['-X','utf8','-c',program],{cwd:repo,encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error('QA_CREDENTIALS_UNAVAILABLE');
  let value;try{value=JSON.parse(result.stdout);}catch(_){throw new Error('QA_CREDENTIALS_UNAVAILABLE');}
  if(!value.teacher?.no||!value.teacher?.pw||!value.student?.no||!value.student?.pw)throw new Error('QA_CREDENTIALS_UNAVAILABLE');
  const allowed=new Set(Array.from({length:40},(_,i)=>'s'+String(i+1).padStart(3,'0')));
  if(!allowed.has(String(value.student.no)))throw new Error('QA_EXPLICIT_DUMMY_REQUIRED');
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
  return !/確認用の学生|demo-student-|成基太郎|private_state|studentId|teacherId|submittedAt/.test(JSON.stringify(value));
}

class Browser{
  constructor(label,base,apiOrigin){this.label=label;this.base=base;this.apiOrigin=apiOrigin;this.pending=new Map();this.contexts=new Map();this.seq=0;this.exceptions=0;this.blocked=0;this.roomStoredTokenUsed=false;this.requestCounts={};}
  async open(){
    this.profile=fs.mkdtempSync(path.join(os.tmpdir(),'scg-teacher-live-'+this.label+'-'));
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
    await this.cdp('Emulation.setDeviceMetricsOverride',{width:this.label==='room'?1440:390,height:this.label==='room'?1000:844,deviceScaleFactor:1,mobile:this.label!=='room'});
    if(this.label==='room')await this.cdp('Page.addScriptToEvaluateOnNewDocument',{source:'window.__demoQaStorageReads=[];try{localStorage.setItem("sp_token","demo-qa-inert-marker");localStorage.setItem("sp_profile",JSON.stringify({role:"teacher",display_name:"QA fixture"}));const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){window.__demoQaStorageReads.push(String(key));return get.call(this,key);};}catch(_){}'});
  }
  async route(params){
    const request=params.request,url=new URL(request.url),preflight=request.method==='OPTIONS';
    let allowed=false,kind='';
    let body=null;
    if(request.postData){try{body=JSON.parse(request.postData);}catch(_){}}
    if(url.origin===this.apiOrigin){
      if((request.method==='POST'||preflight)&&url.pathname==='/auth/v1/token'&&['password','refresh_token'].includes(url.searchParams.get('grant_type'))){allowed=this.label!=='room';kind='auth';}
      if((request.method==='GET'||preflight)&&url.pathname==='/rest/v1/profiles'&&/^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get('id')||'')){allowed=this.label!=='room';kind='profile';}
      const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if((request.method==='POST'||preflight)&&rpc){
        const name=rpc[1];kind=name;
        if(this.label==='room')allowed=name==='get_teacher_demo_display'&&(preflight||body?.p_key===this.displayKey);
        else if(this.label==='phone'){
          allowed=name==='teacher_demo_rooms'||(['teacher_demo_live_load','teacher_demo_live_action'].includes(name)&&(preflight||body?.p_room_id==='room-a'));
        }else{
          const readOnly=['my_open_runs','my_open_survey_rounds'];
          const fixtureWrites=['save_draft','discard_drafts','record_away','submit_attempt'];
          allowed=readOnly.includes(name);
          if(fixtureWrites.includes(name)){
            allowed=preflight||Boolean(this.quizId&&body?.p_quiz_set_id===this.quizId&&
              (!['save_draft','submit_attempt'].includes(name)||body?.p_run_id===this.runId));
            if(allowed&&!preflight&&name==='submit_attempt'){this.submitCount=(this.submitCount||0)+1;this.submittedToExpectedRun=true;}
          }
        }
      }
      if(this.label==='student'&&(request.method==='GET'||preflight)){
        const table=url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
        if(['quiz_sets','attempts','survey_responses'].includes(table)){allowed=true;kind='read:'+table;}
        if(['questions','attempt_drafts'].includes(table)){allowed=Boolean(this.quizId&&url.searchParams.get('quiz_set_id')==='eq.'+this.quizId);kind='read:'+table;}
      }
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
      if(resolved.startsWith(root)&&path.basename(resolved).startsWith('scg-teacher-live-'+this.label+'-')){try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:200});}catch(_){}}
    }
  }
}


async function main(){
  if(process.env.SP_DEMO_LIVE!=='1'){console.log(JSON.stringify({success:false,skipped:true,reason:'SP_DEMO_LIVE is not enabled'}));return;}
  fs.mkdirSync(output,{recursive:true});
  const credentials=readCredentials(),key=readRoomKey(),base=baseURL(process.argv.slice(2).find(value=>!value.startsWith('--'))),origin=supabaseOrigin();
  const phone=new Browser('phone',base,origin),room=new Browser('room',base,origin),student=new Browser('student',base,origin);
  room.displayKey=key;
  let teacherReady=false,complete=false;
  const check=(name,ok)=>{currentStep=name;checks.push({name,passed:Boolean(ok)});if(!ok)throw new Error('QA_CHECK_FAILED');};
  const confirm=async browser=>{await browser.wait('Boolean(document.getElementById("confirm-action")?.getClientRects().length)','confirmation is visible');await pause(250);await browser.click('#confirm-action');};
  try{
    await Promise.all([phone.open(),room.open(),student.open()]);
    const phoneURL=new URL('teacher-two-device-demo.html',base),roomURL=new URL('teacher-two-device-demo-room.html',base),studentURL=new URL('index.html',base);roomURL.hash=key;
    await Promise.all([phone.navigate(phoneURL.href),room.navigate(roomURL.href),student.navigate(studentURL.href)]);
    await phone.wait('Boolean(window.__teacherDemoRemote)','teacher live page ready');
    await room.wait('Boolean(window.__teacherDemoDisplay)','classroom display ready');
    await student.wait('typeof api!=="undefined"&&Boolean(document.getElementById("btn-login"))','existing student portal ready');
    await phone.evaluate('document.getElementById("demo-login-id").value='+JSON.stringify(credentials.teacher.no)+';document.getElementById("demo-login-password").value='+JSON.stringify(credentials.teacher.pw));
    await phone.click('#demo-login-button');
    await phone.wait('__teacherDemoRemote.getStatus().ready&&!__teacherDemoRemote.getStatus().sending&&!__teacherDemoRemote.getStatus().loading','teacher authenticated live state');teacherReady=true;
    check('Teacher uses server live load, not synthetic publish',Boolean(phone.requestCounts.teacher_demo_live_load)&&!phone.requestCounts.teacher_demo_publish&&!phone.requestCounts.teacher_demo_load);
    check('Synthetic submission controls are unavailable',await phone.evaluate('["simulate-one","simulate-five"].every(id=>{const element=document.getElementById(id);return !element||!element.getClientRects().length||element.disabled;})'));
    await phone.click('#reset-preview');await confirm(phone);
    await phone.wait('__teacherDemoRemote.getStatus().ready&&!__teacherDemoRemote.getStatus().sending&&__twoDevicePreview.getState().run===null','server reset prepares the fixture');
    await room.wait('__teacherDemoDisplay.getProjection().mode==="waiting"','classroom initial waiting');
    check('Classroom has no teacher authentication or storage reads',await room.evaluate('api.token===null&&api.profile===null&&window.__demoQaStorageReads.length===0')&&!room.roomStoredTokenUsed);
    await phone.click('#start-run');
    await phone.wait('Boolean(__twoDevicePreview.getState().run)&&__twoDevicePreview.getState().run.status==="running"&&!__teacherDemoRemote.getStatus().sending','server starts a real fixture run');
    await room.wait('__teacherDemoDisplay.getProjection().mode==="running"&&__teacherDemoDisplay.getProjection().target===40','classroom receives the forty-dummy target');
    const ids=await phone.evaluate('({runId:__twoDevicePreview.getState().run.id,quizId:__twoDevicePreview.getState().run.testId})');
    if(!/^[0-9a-f-]{36}$/i.test(ids.runId||'')||!/^[0-9a-f-]{36}$/i.test(ids.quizId||''))throw new Error('QA_REAL_FIXTURE_IDS_REQUIRED');
    student.runId=ids.runId;student.quizId=ids.quizId;
    check('A real run starts with zero of forty submissions',await room.evaluate('__teacherDemoDisplay.getProjection().submitted===0&&__teacherDemoDisplay.getProjection().target===40'));
    await student.evaluate('document.documentElement.style.scrollBehavior="auto";document.getElementById("in-no").value='+JSON.stringify(credentials.student.no)+';document.getElementById("in-pw").value='+JSON.stringify(credentials.student.pw));
    await student.click('#btn-login');
    await student.wait('!document.getElementById("scr-mypage").hidden&&api.profile?.role==="student"','dummy student logs into the existing portal');
    check('Existing student session is within the explicit dummy range',await student.evaluate('/^s(?:00[1-9]|0[12][0-9]|03[0-9]|040)$/.test(String(api.profile.student_no))'));
    await student.click('#btn-gotest');
    await student.wait('!document.getElementById("scr-quizlist").hidden&&Array.from(document.querySelectorAll("#quiz-list .row")).some(row=>row.querySelector(".nm")?.textContent==="2台運用 動作確認テスト")','fixture appears in the ordinary quiz list');
    await student.evaluate('Array.from(document.querySelectorAll("#quiz-list .row")).find(row=>row.querySelector(".nm")?.textContent==="2台運用 動作確認テスト").setAttribute("data-live-qa","fixture")');
    await student.click('#quiz-list [data-live-qa="fixture"]');
    await student.wait('!document.getElementById("scr-quiz").hidden&&document.querySelectorAll("#choices .choice").length>=2','the ordinary quiz UI opens');
    check('Student UI is bound to the exact teacher run and three questions',await student.evaluate('questions.length===3&&quizSet.id==='+JSON.stringify(ids.quizId)+'&&quizSet.run_id==='+JSON.stringify(ids.runId)));
    while(await student.evaluate('cur>0'))await student.click('#btn-prev');
    for(let index=0;index<3;index++){
      await student.wait('document.querySelectorAll("#choices .choice").length>=2','question choices are ready');
      await student.click('#choices .choice:first-child');
      await student.wait('!document.getElementById("btn-next").disabled','answer selection is recorded');
      await student.click('#btn-next');
    }
    await student.wait('!document.getElementById("sheet").hidden&&Boolean(document.getElementById("sheet-submit"))','student submission confirmation opens');
    check('The ordinary confirmation sheet includes all three questions',await student.evaluate('document.querySelectorAll("#sheet-body .qz-dot").length===3'));
    await pause(400);await student.click('#sheet-submit');
    await student.wait('!document.getElementById("scr-result").hidden','the server grades the real submission');
    check('Only one real submit RPC was sent to the expected fixture run',student.submitCount===1&&student.submittedToExpectedRun===true);
    // 2026-11-18: the student sees only the score; per-question marks would reveal two-choice answers.
    check('Student result shows only the score (no per-question marks)',await student.evaluate('(document.getElementById("r-score").textContent.trim()!==""&&Number.isInteger(Number(document.getElementById("r-score").textContent)))&&document.querySelectorAll(".rmk").length===0'));
    // 2026-11-18: one submission per run. The list marks it as submitted with the score, and tapping it
    // shows the score again instead of reopening the quiz.
    await student.evaluate('document.getElementById("btn-gotest").click()');
    await student.wait('Array.from(document.querySelectorAll("#quiz-list .row")).some(row=>row.querySelector(".nm")?.textContent==="2台運用 動作確認テスト"&&row.dataset.done==="1")','the submitted quiz is marked as done in the list');
    await student.evaluate('Array.from(document.querySelectorAll("#quiz-list .row")).find(row=>row.querySelector(".nm")?.textContent==="2台運用 動作確認テスト").click()');
    await student.wait('!document.getElementById("scr-result").hidden','tapping a submitted quiz shows its score');
    check('A submitted quiz cannot be reopened from the list',await student.evaluate('document.getElementById("scr-quiz").hidden&&(document.getElementById("r-score").textContent.trim()!==""&&Number.isInteger(Number(document.getElementById("r-score").textContent)))'));
    await phone.wait('__twoDevicePreview.getState().run.submittedCount===1','teacher receives the real student submission',50000);
    await room.wait('__teacherDemoDisplay.getProjection().submitted===1&&__teacherDemoDisplay.getProjection().target===40','classroom receives one of forty real submissions',50000);
    check('Teacher and classroom both show one real submission',await phone.evaluate('__twoDevicePreview.getState().run.submittedCount===1')&&await room.evaluate('__teacherDemoDisplay.getProjection().submitted===1'));
    check('Scores and answer choices remain hidden until permitted',await room.evaluate('__teacherDemoDisplay.getProjection().average===null&&__teacherDemoDisplay.getProjection().question===null'));
    const before=await room.evaluate('__teacherDemoDisplay.getProjection().remainingSeconds');
    const originalDeadline=await phone.evaluate('__twoDevicePreview.getState().run.originalClosesAt');
    await phone.click('#extend-run');
    await room.wait('__teacherDemoDisplay.getProjection().remainingSeconds>'+Math.max(0,before+250),'server extension reaches the classroom');
    check('Extension preserves the original server deadline',await phone.evaluate('__twoDevicePreview.getState().run.originalClosesAt==='+JSON.stringify(originalDeadline)));
    await phone.click('#toggle-stats');
    await room.wait('__teacherDemoDisplay.getProjection().showStats&&__teacherDemoDisplay.getProjection().average!==null','permitted real aggregate reaches the classroom');
    check('Running statistics do not disclose the correct answer',await room.evaluate('__teacherDemoDisplay.getProjection().question===null'));
    await phone.click('#end-run');await confirm(phone);
    await room.wait('__teacherDemoDisplay.getProjection().mode==="review"&&Boolean(__teacherDemoDisplay.getProjection().question)','server end exposes review aggregates');
    check('Review contains one aggregated answer per question',await room.evaluate('__teacherDemoDisplay.getProjection().submitted===1&&__teacherDemoDisplay.getProjection().question.options.reduce((n,item)=>n+item.count,0)===1'));
    check('Public response remains a projection whitelist',publicShape(await room.evaluate('__teacherDemoDisplay.getProjection()')));
    const first=await room.evaluate('__teacherDemoDisplay.getProjection().question.index');
    await phone.click('#next-question');await room.wait('__teacherDemoDisplay.getProjection().question.index==='+String(first+1),'review question changes remotely');
    await phone.click('#prev-question');await room.wait('__teacherDemoDisplay.getProjection().question.index==='+String(first),'previous review question is restored');
    await phone.click('#hardest-question');
    const hardest=await phone.evaluate('__twoDevicePreview.getState().run.questionIndex');
    await room.wait('__teacherDemoDisplay.getProjection().question.index==='+String(hardest),'lowest-rate real question is projected');
    check('Classroom iframe has no private API or student names',await room.frameCheck());
    await room.screenshot('real-submission-review.png');
    await room.cdp('Page.reload',{ignoreCache:true});
    await room.wait('Boolean(window.__teacherDemoDisplay)&&__teacherDemoDisplay.getProjection().mode==="review"&&__teacherDemoDisplay.getProjection().submitted===1','classroom reload restores real review');
    check('PC reload still uses no teacher session',await room.evaluate('api.token===null&&api.profile===null&&window.__demoQaStorageReads.length===0'));
    await phone.wait('!__teacherDemoRemote.getStatus().sending','teacher action completes before reload');
    await phone.cdp('Page.reload',{ignoreCache:true});
    await phone.wait('Boolean(window.__teacherDemoRemote)&&__teacherDemoRemote.getStatus().ready&&!__teacherDemoRemote.getStatus().sending&&Boolean(__twoDevicePreview.getState().run)','teacher reload restores the real run');
    check('Phone reload preserves the same real run and submission',await phone.evaluate('__twoDevicePreview.getState().run.id==='+JSON.stringify(ids.runId)+'&&__twoDevicePreview.getState().run.submittedCount===1&&__twoDevicePreview.getState().run.status==="ended"'));
    check('Phone and student layouts have no horizontal overflow',await phone.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')&&await student.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));
    await phone.click('#stop-projection');await room.wait('__teacherDemoDisplay.getProjection().mode==="waiting"','stop returns classroom to waiting');
    check('Stopping projection removes public submission and answer values',await room.evaluate('!__teacherDemoDisplay.getProjection().submitted&&__teacherDemoDisplay.getProjection().question===null&&__teacherDemoDisplay.getProjection().average===null'));
    await phone.click('#reset-preview');await confirm(phone);
    await phone.wait('__teacherDemoRemote.getStatus().ready&&!__teacherDemoRemote.getStatus().sending&&__twoDevicePreview.getState().run===null','prepare the next real fixture run');
    await room.wait('__teacherDemoDisplay.getProjection().mode==="waiting"','the classroom remains waiting for the next trial');
    check('Next-trial preparation clears the active run',await phone.evaluate('__twoDevicePreview.getState().run===null'));
    check('No synthetic publish RPC was used',!phone.requestCounts.teacher_demo_publish&&!phone.requestCounts.teacher_demo_load);
    check('Only approved request paths were used',phone.blocked===0&&room.blocked===0&&student.blocked===0);
    check('No browser JavaScript exceptions',phone.exceptions===0&&room.exceptions===0&&student.exceptions===0);
    complete=true;
    const report={success:true,checks,phoneRequests:phone.requestCounts,roomRequests:room.requestCounts,studentRequests:student.requestCounts,studentSubmitRequests:student.submitCount||0,exceptions:phone.exceptions+room.exceptions+student.exceptions,unauthorizedRequestsBlocked:phone.blocked+room.blocked+student.blocked};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{
    if(!complete){
      if(teacherReady){try{await phone.evaluate('if(window.__twoDevicePreview?.getState().run?.status==="running")window.__twoDevicePreview.dispatch({type:"END"})');await pause(2500);await phone.evaluate('if(window.__twoDevicePreview?.getState().run?.projectionActive)window.__twoDevicePreview.dispatch({type:"STOP_PROJECTION"})');await pause(2500);}catch(_){}}
      try{await room.screenshot('classroom-failure.png');}catch(_){}
      const report={success:false,failedStep:currentStep,checks,studentSubmitRequests:student.submitCount||0,exceptions:phone.exceptions+room.exceptions+student.exceptions,unauthorizedRequestsBlocked:phone.blocked+room.blocked+student.blocked,requestCounts:{phone:phone.requestCounts,room:room.requestCounts,student:student.requestCounts}};
      fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }
    await Promise.all([phone.close(),room.close(),student.close()]);
  }
}
main().catch(()=>{console.error('Live fixture QA did not complete. Check the named step in the sanitized report.');process.exitCode=1;});
