/* Authenticated transport: server commands and snapshots for dummy students only. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const isRoom=document.body.dataset.demoRole==="room";
  const targetOrigin=location.protocol==="file:"?"*":location.origin;
  const MESSAGE="scg-two-device-preview";
  function friendly(error){
    const value=String(error?.message||"");
    if(value.includes("VERSION_CONFLICT"))return "別の画面から更新されています。勝手に上書きせず停止しました。保存済みの状態を読み直してください。";
    if(value.includes("ROOM_OCCUPIED"))return "この教室は別の先生が検証中です。別の教室を選ぶか、担当の先生に確認してください。";
    if(value.includes("TEACHER_REQUIRED"))return "先生・マスターのアカウントでログインしてください。";
    if(value.includes("ROOM_UNAVAILABLE"))return "この教室は利用できません。別の教室を選んでください。";
    if(value.includes("INVALID_STATE"))return "保存データの形式を確認できませんでした。操作を止めて担当者に確認してください。";
    return "通信を確認できませんでした。操作を止めました。接続を確認し、保存済みの状態を読み直してください。";
  }

  if(isRoom){
    const frame=$("remote-room-frame");
    const session="remote_display_"+Math.random().toString(36).slice(2)+Date.now().toString(36);
    const url=new URL("teacher-two-device-preview.html",location.href);
    url.searchParams.set("view","room");url.searchParams.set("remote","1");url.searchParams.set("session",session);
    frame.src=url.href;
    let key="";
    try{key=decodeURIComponent(location.hash.slice(1));}catch(_){}
    let projection={schemaVersion:1,mode:"waiting",roomLabel:"確認用の教室画面",statusLabel:"接続を確認中",testTitle:"",classLabel:"",target:null,submitted:null,remainingSeconds:0,showStats:false,average:null,correctRate:null,question:null};
    let status="接続を確認中",busy=false,stopped=false,lastAt=0,timer=null;
    function push(){if(frame.contentWindow)frame.contentWindow.postMessage({type:MESSAGE,session,projection},targetOrigin);}
    function setStatus(value,error=false){status=value;$("room-connection").textContent=value;$("room-connection").classList.toggle("error",error);}
    function waiting(){projection={schemaVersion:1,mode:"waiting",roomLabel:"確認用の教室画面",statusLabel:"接続待ち",testTitle:"",classLabel:"",target:null,submitted:null,remainingSeconds:0,showStats:false,average:null,correctRate:null,question:null};push();}
    function clean(input){
      if(!input||!["waiting","running","review"].includes(input.mode))throw new Error("INVALID_DISPLAY");
      const str=value=>typeof value==="string"?value.slice(0,1000):"";
      const num=value=>typeof value==="number"&&Number.isFinite(value)?Math.max(0,value):0;
      const dto={schemaVersion:1,mode:input.mode,roomLabel:str(input.roomLabel),statusLabel:str(input.statusLabel),testTitle:str(input.testTitle),classLabel:str(input.classLabel),target:input.target==null?null:num(input.target),submitted:input.submitted==null?null:num(input.submitted),remainingSeconds:num(input.remainingSeconds),showStats:Boolean(input.showStats),average:input.average==null?null:num(input.average),correctRate:input.correctRate==null?null:num(input.correctRate),question:null};
      if(dto.mode==="waiting"){dto.testTitle="";dto.classLabel="";dto.target=null;dto.submitted=null;dto.remainingSeconds=0;dto.showStats=false;dto.average=null;dto.correctRate=null;}
      else if(dto.mode==="running"&&!dto.showStats){dto.average=null;dto.correctRate=null;}
      if(dto.mode==="review"&&input.question&&Array.isArray(input.question.options))dto.question={index:num(input.question.index),total:num(input.question.total),text:str(input.question.text),options:input.question.options.slice(0,10).map(option=>({label:str(option.label),count:num(option.count),correct:Boolean(option.correct)}))};
      return dto;
    }
    async function poll(){
      if(stopped||busy)return;
      if(!/^[A-Za-z0-9_-]{43,128}$/.test(key)){setStatus("教室専用URLの設定を確認してください。",true);waiting();return;}
      busy=true;
      try{
        const result=await api.publicRpc("get_teacher_demo_display",{p_key:key});
        if(stopped)return;
        projection=clean(result);lastAt=Date.now();push();setStatus("接続中 · 約2秒ごとに確認");
      }catch(_){waiting();setStatus("接続できないため待ち受けに戻しました。URLと通信を確認してください。",true);}
      finally{busy=false;}
    }
    window.addEventListener("message",event=>{
      const originOk=location.protocol==="file:"?event.origin==="null":event.origin===location.origin;
      if(event.source===frame.contentWindow&&originOk&&event.data?.type===MESSAGE+":ready"&&event.data?.session===session)push();
    });
    frame.addEventListener("load",push);
    $("room-retry").onclick=poll;
    timer=setInterval(poll,2000);
    window.addEventListener("pagehide",()=>{stopped=true;clearInterval(timer);});
    window.__teacherDemoDisplay={getProjection:()=>clone(projection),getStatus:()=>({text:status,lastAt,busy})};
    poll();return;
  }

  const preview=window.__twoDevicePreview;
  if(!preview||typeof preview.setCommandHandler!=="function"||typeof api==="undefined")return;
  const allowedActions=new Set(["SELECT","START","EXTEND","END","TOGGLE_STATS","NEXT_QUESTION","PREV_QUESTION","HARDEST_QUESTION","STOP_PROJECTION","RESET"]);
  let roomId="room-a",version=0,ready=false,failed=false,loading=false,generation=0,queued=0;
  let roomRows=[],roomTimer=null,lastRoomsRead=0,queue=Promise.resolve();

  function connection(value,error=false){$("demo-connection").textContent=value;$("demo-connected-bar").classList.toggle("error",error);}
  function loginMessage(value){$("demo-login-message").textContent=value;$("demo-login-message").hidden=!value;}
  function teacherAllowed(){return api.profile&&["teacher","master"].includes(api.profile.role);}
  function lockControls(){preview.setRemoteBlocked(!ready||failed||queued>0,{allowRoomSelection:failed&&queued===0&&teacherAllowed()});}
  // 端末の時計とサーバーの時計の差。返ってきた状態の updatedAt（サーバーの今・ミリ秒）と、
  // 送った時刻と受け取った時刻のまん中を比べる。往復が遅すぎた回（3秒以上）は当てにしない。
  function noteServerClock(result,sentAt,receivedAt){
    const at=result?.private_state?.updatedAt;
    if(!Number.isFinite(at)||receivedAt-sentAt>3000)return;
    window.__twoDeviceClockOffset=Math.round(at-(sentAt+receivedAt)/2);
  }
  async function teacherRpc(name,args){
    let timeout;const sentAt=Date.now();
    try{
      const result=await Promise.race([api.rpc(name,args),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error("DEMO_TIMEOUT")),20000);})]);
      noteServerClock(result,sentAt,Date.now());
      return result;
    }
    finally{clearTimeout(timeout);}
  }
  function stopSending(error){failed=true;ready=false;connection(friendly(error),true);lockControls();}
  function validateSnapshot(result){
    const state=result?.private_state;
    if(!result||!Number.isSafeInteger(result.version)||result.version<0||!state||state.schemaVersion!==1||state.source!=="existing-dummy-quiz"||!Array.isArray(state.tests)||!Array.isArray(state.classes)||!Array.isArray(state.rooms)||!state.selection){
      throw new Error("DEMO_INVALID_STATE");
    }
    if(state.run&&(!Array.isArray(state.run.submissions)||!Array.isArray(state.run.questionStats)||!["running","ended"].includes(state.run.status)))throw new Error("DEMO_INVALID_STATE");
    return state;
  }
  function applySnapshot(result,id){
    const state=validateSnapshot(result);
    if(result.roomId!==id||state.selection.roomId!==id)throw new Error("DEMO_INVALID_STATE");
    roomId=id;version=result.version;
    preview.replaceState(state);
    if(roomRows.length)preview.updateRemoteRooms(roomRows);
  }
  async function refreshRooms(ticket){
    const rows=await teacherRpc("teacher_demo_rooms",{});
    if(ticket!==generation)return;
    if(!Array.isArray(rows))throw new Error("DEMO_INVALID_STATE");
    roomRows=rows;lastRoomsRead=Date.now();preview.updateRemoteRooms(rows);
  }

  // Commands, reloads and polling share one queue. A read never races a command
  // and no client-produced state is ever published back to the database.
  function enqueue(work,kind,allowFailed=false){
    const ticket=generation;
    queued++;if(kind==="load")loading=true;lockControls();
    const operation=queue.then(async()=>{
      if(ticket!==generation)return null;
      if(failed&&!allowFailed)throw new Error("DEMO_SYNC_HALTED");
      return await work(ticket);
    });
    queue=operation.catch(()=>null);
    return operation.catch(error=>{
      if(ticket===generation)stopSending(error);
      const safe=new Error(friendly(error));safe.code="REMOTE_COMMAND_FAILED";throw safe;
    }).finally(()=>{
      queued=Math.max(0,queued-1);
      if(ticket===generation){if(kind==="load")loading=false;lockControls();}
    });
  }
  async function readSnapshot(id,ticket,refresh){
    if(refresh||Date.now()-lastRoomsRead>=15000)await refreshRooms(ticket);
    if(ticket!==generation)return null;
    if(!roomRows.some(room=>room.roomId===id))throw new Error("DEMO_ROOM_UNAVAILABLE");
    const result=await teacherRpc("teacher_demo_live_load",{p_room_id:id});
    if(ticket!==generation)return null;
    applySnapshot(result,id);ready=true;failed=false;
    connection("学生ポータルの提出を確認中 · "+new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"}));
    return preview.getState();
  }
  function loadRoom(id){
    if(loading||queued>0){connection("直前の操作が終わるまでお待ちください。");return Promise.resolve(null);}
    connection("保存済みの実施回と提出を読み込んでいます…");
    return enqueue(ticket=>readSnapshot(id,ticket,true),"load",true);
  }
  function executeAction(action){
    if(!allowedActions.has(action?.type))return Promise.reject(new Error("この遠隔検証では、学生ポータルから実際に受験してください。"));
    if(!ready||failed||queued>0)return Promise.reject(new Error("接続または直前の操作を確認してください。"));
    return enqueue(async ticket=>{
      connection("操作を反映しています…");
      const result=await teacherRpc("teacher_demo_live_action",{p_room_id:roomId,p_expected_version:version,p_action:clone(action)});
      if(ticket!==generation)return null;
      applySnapshot(result,roomId);
      connection("操作を反映しました。学生ポータルからの提出を確認します。");
      return preview.getState();
    },"action");
  }
  preview.setCommandHandler(executeAction);
  preview.setRemoteBlocked(true,{allowRoomSelection:false});

  async function switchRoom(id){
    if(loading||queued>0){connection("直前の操作が終わるまでお待ちください。");return;}
    const state=preview.getState();
    if(!id||state.run?.status==="running"){
      preview.replaceState(state);
      connection(!id?"確認用教室を選んでください。":"実施中は教室を変えられません。先にこの回を終えてください。",true);
      return;
    }
    try{await loadRoom(id);}catch(_){}
  }
  $("room-select").addEventListener("change",event=>{event.stopImmediatePropagation();switchRoom(event.target.value);},true);

  async function connect(){
    if(!teacherAllowed()){api.logout();throw new Error("DEMO_TEACHER_REQUIRED");}
    ++generation;failed=false;ready=false;loading=false;lockControls();
    $("demo-login-panel").hidden=true;$("demo-connected-bar").hidden=false;$("teacher-app").hidden=false;
    $("demo-current-teacher").textContent=(api.profile.display_name||api.profile.student_no)+" · ダミー生徒での受験検証";
    preview.setTeacherProfile(api.profile);
    await loadRoom(roomId);
    clearInterval(roomTimer);
    roomTimer=setInterval(()=>{
      if(!ready||failed||loading||queued>0||!teacherAllowed())return;
      enqueue(ticket=>readSnapshot(roomId,ticket,false),"poll").catch(()=>{});
    },5000);
  }
  $("demo-login-form").addEventListener("submit",async event=>{
    event.preventDefault();$("demo-login-button").disabled=true;loginMessage("");
    try{await api.login($("demo-login-id").value,$("demo-login-password").value);$("demo-login-password").value="";await connect();}
    catch(error){
      if(teacherAllowed()){loginMessage("");connection(friendly(error),true);}
      else{api.logout();loginMessage("ログインできませんでした。先生用の番号・パスワード・通信をご確認ください。");}
    }
    finally{$("demo-login-password").value="";$("demo-login-button").disabled=false;}
  });
  $("demo-reload").onclick=()=>loadRoom(roomId).catch(()=>{});
  $("demo-logout").onclick=()=>{
    ++generation;ready=false;failed=false;loading=false;clearInterval(roomTimer);preview.setRemoteBlocked(true,{allowRoomSelection:false});api.logout();
    preview.setTeacherProfile(null);preview.replaceState(window.TwoDeviceCore.createState());
    $("teacher-app").hidden=true;$("demo-connected-bar").hidden=true;$("demo-login-panel").hidden=false;
    loginMessage("ログアウトしました。教室画面は更新が途切れると待ち受けに戻ります。");
  };
  window.addEventListener("pagehide",()=>{ready=false;++generation;clearInterval(roomTimer);});
  window.__teacherDemoRemote={
    getStatus:()=>({roomId,version,ready,sending:queued>0,failed,loading,pending:queued>0,source:"existing-dummy-quiz"}),
    reload:()=>loadRoom(roomId),whenIdle:()=>queue,
  };
  if(api.token&&api.profile)connect().catch(error=>{
    if(teacherAllowed()){connection(friendly(error),true);return;}
    api.logout();loginMessage("ログインし直してください。");$("teacher-app").hidden=true;$("demo-connected-bar").hidden=true;$("demo-login-panel").hidden=false;
  });
})();
