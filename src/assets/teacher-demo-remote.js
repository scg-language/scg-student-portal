/* Authenticated synthetic demo transport. Never use the live quiz tables. */
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
  if(!preview||typeof preview.setRemoteBlocked!=="function"||typeof api==="undefined")return;
  let roomId="room-a",version=0,ready=false,sending=false,pending=null,scheduled=null,lastSent=0,failed=false,loading=false,generation=0;
  let roomRows=[],roomTimer=null,unsubscribe=null;
  preview.setRemoteBlocked(true);
  function connection(value,error=false){$("demo-connection").textContent=value;$("demo-connected-bar").classList.toggle("error",error);}
  function loginMessage(value){$("demo-login-message").textContent=value;$("demo-login-message").hidden=!value;}
  function teacherAllowed(){return api.profile&&["teacher","master"].includes(api.profile.role);}
  async function teacherRpc(name,args){
    let timeout;
    try{return await Promise.race([api.rpc(name,args),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error("DEMO_TIMEOUT")),20000);})]);}
    finally{clearTimeout(timeout);}
  }
  function stopSending(error){
    failed=true;ready=false;pending=null;clearTimeout(scheduled);scheduled=null;preview.setRemoteBlocked(true);connection(friendly(error),true);
  }
  function scheduleDrain(immediate){
    if(!ready||failed||loading||sending||!pending)return;
    const delay=immediate?0:Math.max(0,5000-(Date.now()-lastSent));
    clearTimeout(scheduled);scheduled=setTimeout(()=>{scheduled=null;drain();},delay);
  }
  async function drain(){
    if(!ready||failed||loading||sending||!pending)return;
    const current=pending;pending=null;sending=true;
    const ticket=generation,currentRoom=roomId;
    connection("教室へ同期しています…");
    try{
      const result=await teacherRpc("teacher_demo_publish",{p_room_id:currentRoom,p_expected_version:version,p_private_state:current.state,p_public_state:current.projection});
      if(ticket!==generation)return;
      if(!result||!Number.isInteger(result.version))throw new Error("INVALID_VERSION");
      version=result.version;lastSent=Date.now();connection("同期しました · "+new Date(lastSent).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"}));
    }catch(error){if(ticket===generation)stopSending(error);}
    finally{sending=false;if(pending&&ready&&!failed)scheduleDrain(pending.immediate);}
  }
  function queue(state,projection,action){
    if(!ready||failed||loading)return;
    if(state.selection.roomId!==roomId&&!state.run){state.selection.roomId=roomId;preview.replaceState(state);state=preview.getState();projection=preview.getProjection();}
    const immediate=action?.type!=="TICK"||Boolean(pending?.immediate);
    pending={state:clone(state),projection:clone(projection),immediate};scheduleDrain(immediate);
  }
  async function refreshRooms(){
    const rows=await teacherRpc("teacher_demo_rooms",{});
    if(!Array.isArray(rows))throw new Error("INVALID_ROOMS");
    roomRows=rows;preview.updateRemoteRooms(rows);
    return rows;
  }
  async function loadRoom(id){
    if(loading)return false;
    loading=true;ready=false;failed=false;pending=null;clearTimeout(scheduled);scheduled=null;preview.setRemoteBlocked(true);connection("保存済みの状態を読み込んでいます…");
    const ticket=++generation;
    try{
      await refreshRooms();
      if(ticket!==generation)return false;
      if(!roomRows.some(room=>room.roomId===id))throw new Error("ROOM_UNAVAILABLE");
      const loaded=await teacherRpc("teacher_demo_load",{p_room_id:id});
      if(ticket!==generation)return false;
      if(!loaded||!Number.isInteger(loaded.version))throw new Error("INVALID_VERSION");
      let state=loaded.private_state||window.TwoDeviceCore.createState();
      state=clone(state);state.selection.roomId=id;
      preview.setTeacherProfile(api.profile);preview.replaceState(state);
      preview.updateRemoteRooms(roomRows);
      roomId=id;version=loaded.version;lastSent=0;failed=false;loading=false;ready=true;preview.setRemoteBlocked(false);
      connection("読み込みました。教室画面へ接続します。");queue(preview.getState(),preview.getProjection(),{type:"LOAD"});return true;
    }catch(error){if(ticket===generation){loading=false;stopSending(error);}return false;}
    finally{if(ticket===generation)loading=false;}
  }
  async function flush(){
    if(pending&&ready&&!failed){clearTimeout(scheduled);scheduled=null;await drain();}
    while(sending)await pause(60);
    if(pending&&ready&&!failed)await drain();
    if(failed)throw new Error("SYNC_FAILED");
  }
  async function switchRoom(id){
    if(loading)return;
    if(!id){const state=preview.getState();preview.replaceState(state);connection("この遠隔検証では、確認用教室を選んでください。",true);return;}
    const run=preview.getState().run;
    if(run&&run.status==="running"){preview.replaceState(preview.getState());connection("実施中は教室を変えられません。先にこの回を終えてください。",true);return;}
    try{if(!failed)await flush();await loadRoom(id);}catch(error){stopSending(error);}
  }
  $("room-select").addEventListener("change",event=>{event.stopImmediatePropagation();switchRoom(event.target.value);},true);
  async function connect(){
    if(!teacherAllowed()){api.logout();throw new Error("TEACHER_REQUIRED");}
    $("demo-login-panel").hidden=true;$("demo-connected-bar").hidden=false;$("teacher-app").hidden=false;
    $("demo-current-teacher").textContent=(api.profile.display_name||api.profile.student_no)+" · 遠隔検証用";
    preview.setTeacherProfile(api.profile);
    if(!unsubscribe)unsubscribe=preview.subscribe(queue);
    await loadRoom(roomId);
    clearInterval(roomTimer);roomTimer=setInterval(()=>{if(ready&&!loading)refreshRooms().catch(()=>{});},15000);
  }
  $("demo-login-form").addEventListener("submit",async event=>{
    event.preventDefault();$("demo-login-button").disabled=true;loginMessage("");
    try{await api.login($("demo-login-id").value,$("demo-login-password").value);$("demo-login-password").value="";await connect();}
    catch(error){api.logout();loginMessage(String(error?.message||"").includes("TEACHER_REQUIRED")?friendly(error):"ログインできませんでした。先生用の番号・パスワード・通信をご確認ください。");}
    finally{$("demo-login-password").value="";$("demo-login-button").disabled=false;}
  });
  $("demo-reload").onclick=async()=>{
    if(loading)return;
    if(sending){connection("直前の同期が終わるまでお待ちください。");return;}
    await loadRoom(roomId);
  };
  $("demo-logout").onclick=()=>{
    ++generation;ready=false;failed=false;pending=null;clearTimeout(scheduled);clearInterval(roomTimer);scheduled=null;preview.setRemoteBlocked(true);api.logout();
    $("teacher-app").hidden=true;$("demo-connected-bar").hidden=true;$("demo-login-panel").hidden=false;loginMessage("ログアウトしました。教室画面は更新が途切れると待ち受けに戻ります。");
  };
  window.addEventListener("pagehide",()=>{ready=false;++generation;clearTimeout(scheduled);clearInterval(roomTimer);});
  window.__teacherDemoRemote={getStatus:()=>({roomId,version,ready,sending,failed,loading,pending:Boolean(pending)}),reload:()=>loadRoom(roomId)};
  if(api.token&&api.profile)connect().catch(()=>{api.logout();loginMessage("ログインし直してください。");$("teacher-app").hidden=true;$("demo-connected-bar").hidden=true;$("demo-login-panel").hidden=false;});
})();
