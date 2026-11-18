/* Two-device preview. Synthetic data only; no auth, storage, fetch or live API. */
(function(){
  "use strict";
  const MESSAGE = "scg-two-device-preview";
  const CHANNEL = "scg-two-device-preview:";
  const params = new URLSearchParams(location.search);
  const roomMode = params.get("view") === "room";
  const remoteRoom = roomMode && params.get("remote") === "1";
  const requestedSession = params.get("session") || "";
  const session = /^[a-zA-Z0-9_-]{1,90}$/.test(requestedSession) ? requestedSession : "preview_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,10);
  const targetOrigin = location.protocol === "file:" ? "*" : location.origin;
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const text = (value,limit=200) => typeof value === "string" ? value.slice(0,limit) : "";
  const number = (value, fallback=0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  let channel = null;
  try { if(typeof BroadcastChannel === "function") channel = new BroadcastChannel(CHANNEL+session); } catch(_) {}

  // Copy only the public contract. Never retain unknown fields received by a room.
  function cleanProjection(input){
    if(!input || typeof input !== "object" || !["waiting","running","review"].includes(input.mode)) return null;
    const dto = {
      schemaVersion:1,
      mode:input.mode,
      roomLabel:text(input.roomLabel,80),
      statusLabel:text(input.statusLabel,80),
      testTitle:text(input.testTitle,120),
      classLabel:text(input.classLabel,80),
      target:input.target == null ? null : Math.max(0,Math.trunc(number(input.target))),
      submitted:input.submitted == null ? null : Math.max(0,Math.trunc(number(input.submitted))),
      remainingSeconds:Math.max(0,Math.trunc(number(input.remainingSeconds))),
      showStats:Boolean(input.showStats),
      average:input.average == null ? null : Math.max(0,Math.min(100,number(input.average))),
      correctRate:input.correctRate == null ? null : Math.max(0,Math.min(100,number(input.correctRate))),
      question:null,
    };
    if(dto.mode === "waiting"){
      dto.testTitle="";dto.classLabel="";dto.target=null;dto.submitted=null;
      dto.showStats=false;dto.average=null;dto.correctRate=null;dto.remainingSeconds=0;
    }else if(dto.mode === "running"){
      if(!dto.showStats){dto.average=null;dto.correctRate=null;}
    }else if(input.question && typeof input.question === "object"){
      const q=input.question;
      dto.question={index:Math.max(0,Math.trunc(number(q.index))),total:Math.max(1,Math.trunc(number(q.total,1))),text:text(q.text,1000),options:[]};
      if(Array.isArray(q.options)) dto.question.options=q.options.slice(0,10).map(option=>({label:text(option.label,500),count:Math.max(0,Math.trunc(number(option.count))),correct:Boolean(option.correct)}));
    }
    return dto;
  }

  function timeLabel(seconds){
    const n=Math.max(0,Math.ceil(number(seconds)));
    return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");
  }
  function svg(paths,viewBox="0 0 24 24"){
    const node=document.createElementNS("http://www.w3.org/2000/svg","svg");
    node.setAttribute("viewBox",viewBox);node.setAttribute("aria-hidden","true");
    paths.forEach(d=>{const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",d);node.append(path);});
    return node;
  }
  function el(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!=null)node.textContent=String(content);return node;}

  if(roomMode){
    $("teacher-app").remove();$("help-dialog").remove();$("confirm-dialog").remove();
    document.body.classList.add("room-only");
    const root=$("room-app");root.hidden=false;
    const view=el("main","room-view");
    const top=el("div","room-top");
    const title=el("div","room-title","確認用の教室画面");title.id="room-title";
    top.append(title,el("span","room-badge","動作確認用"));
    const intro=el("p","room-intro","架空データの表示です。先生の操作を待っています。");
    const content=el("section","room-content");content.id="room-content";
    const footer=el("footer","room-footer",remoteRoom?"既存の学生ポータルで受験するダミー生徒の検証用です。実在の学生は対象にしません。":"同じブラウザ内で連動する見本です。接続先を区別する番号は認証用の鍵ではありません。別端末間の通信・保存は未対応です。");
    view.append(top,intro,content,footer);root.append(view);
    let lastProjection=null;

    function renderRoom(dto){
      lastProjection=dto;document.body.dataset.roomMode=dto.mode;
      title.textContent=dto.roomLabel || "確認用の教室画面";
      intro.textContent=dto.mode === "waiting" ? "検証用の待ち受けです。先生の操作を待っています。" : remoteRoom?"ダミー生徒の受験結果を、集計だけで表示しています。":"架空データの集計だけを表示しています。";
      content.replaceChildren();
      if(dto.mode === "waiting"){
        const wait=el("div","room-wait");
        wait.append(svg(["M3 4h18v13H3zM8 21h8m-4-4v4"]),el("h1",null,"先生の開始を待っています"),el("p",null,"名前・個人の点数・順位は、この画面へ送りません。"));
        content.append(wait);return;
      }
      const meta=el("div","room-meta");meta.append(el("span","room-chip",dto.classLabel || "検証クラス"),el("span","room-chip",dto.mode === "review" ? "答え合わせ" : "実施中"));
      const h1=el("h1","room-test-title",dto.testTitle || "操作確認テスト");
      content.append(meta,h1);
      const metrics=el("div","room-metrics");metrics.style.margin="20px 0";
      const submitted=el("div","room-metric");submitted.append(el("small",null,"提出／対象"));
      const count=el("strong",null,(dto.submitted||0)+" / "+(dto.target||0));count.id="room-submitted";submitted.append(count);
      const track=el("div","room-track"),fill=el("i");fill.style.width=Math.min(100,(dto.submitted||0)/Math.max(1,dto.target||0)*100)+"%";track.append(fill);submitted.append(track);
      const remaining=el("div","room-metric");remaining.append(el("small",null,dto.mode === "review" ? "受付は終了しました" : "残り時間"));
      const time=el("strong",null,dto.mode === "review" ? "終了" : timeLabel(dto.remainingSeconds));time.id="room-remaining";remaining.append(time);metrics.append(submitted,remaining);content.append(metrics);
      if(dto.average != null){const average=el("p","room-average","クラス平均正答率 "+Math.round(dto.average)+"%");average.id="room-average";content.append(average);}
      if(dto.mode === "running"){
        const center=el("div","room-center");center.style.marginTop="20px";
        const qr=el("div","qr-placeholder");qr.append(svg(["M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h-3zM21 15v6h-3"]),el("span",null,remoteRoom?"ダミー生徒は":"学生用QRは"),el("b",null,remoteRoom?"学生ポータルから":"本番接続後"));
        const guide=el("div");guide.append(el("p",null,remoteRoom?"ダミー生徒が、いつもの学生ポータルからこの小テストを受けます。":"この画面では、架空の提出で動きを確認します。"),el("small",null,dto.showStats ? "先生が正答率の表示を許可しています。" : "正答率は終了後に表示します。"));center.append(qr,guide);content.append(center);
      }else if(dto.question){
        const q=dto.question,card=el("div","room-question-wrap");card.style.marginTop="20px";
        card.append(el("div","room-question-label","問題 "+(q.index+1)+" / "+q.total));
        const question=el("h2","room-question",q.text);question.id="room-question";
        const options=el("div","room-options");options.id="room-options";
        q.options.forEach((o,i)=>{const row=el("div","option"+(o.correct?" correct":""));row.append(el("span","option-code",String.fromCharCode(65+i)),el("span",null,o.label+(o.correct?"　正解":"")),el("span","option-count",o.count+"人"));const bar=el("div","option-bar"),barFill=el("i");barFill.style.width=Math.min(100,o.count/Math.max(1,dto.submitted||0)*100)+"%";bar.append(barFill);row.append(bar);options.append(row);});
        card.append(question,options);content.append(card);
      }
    }
    function receive(payload){
      if(!payload || payload.type!==MESSAGE || payload.session!==session) return;
      const dto=cleanProjection(payload.projection);if(dto)renderRoom(dto);
    }
    window.addEventListener("message",event=>{
      const sourceOk=(window.parent!==window && event.source===window.parent) || (window.opener && event.source===window.opener);
      const originOk=location.protocol === "file:" ? event.origin === "null" : event.origin === location.origin;
      if(sourceOk && originOk)receive(event.data);
    });
    if(channel)channel.addEventListener("message",event=>receive(event.data));
    renderRoom({schemaVersion:1,mode:"waiting",roomLabel:"確認用の教室画面"});
    const ready={type:MESSAGE+":ready",session};
    if(window.parent!==window)window.parent.postMessage(ready,targetOrigin);
    else if(window.opener)window.opener.postMessage(ready,targetOrigin);
    if(channel)channel.postMessage(ready);
    window.__twoDevicePreview={getProjection:()=>clone(lastProjection)};
    return;
  }

  const Core=window.TwoDeviceCore;
  if(!Core){$("preview-message").textContent="確認用の部品を読み込めませんでした。ページを開き直してください。";$("preview-message").hidden=false;return;}
  let state=Core.createState();
  let lastPublicMessage=null;
  let lastError=null;
  let confirmAction=null;
  let mobileView="teacher";
  let remoteBlocked=false;
  let remoteProfile=null;
  let commandHandler=null;
  let remoteRoomSelectionAllowed=true;
  let testCatalogSignature="";
  let classCatalogSignature="";
  let disposed=false;
  const subscribers=new Set();
  const actionControls=["test-select","class-select","room-select","duration-select","start-run","simulate-one","simulate-five","extend-run","end-run","toggle-stats","prev-question","next-question","hardest-question","stop-projection","reset-preview"];
  function blockRemoteControls(){actionControls.forEach(id=>{$(id).disabled=!(id==="room-select"&&remoteProfile&&remoteRoomSelectionAllowed);});}
  function applyRemoteIdentity(){
    if(!remoteProfile)return;
    const previous=state.teacher.id;
    state.teacher={id:remoteProfile.student_no,name:remoteProfile.display_name||remoteProfile.student_no};
    if(state.run && state.run.teacherId===previous)state.run.teacherId=state.teacher.id;
  }
  const frame=$("projection-frame"),popups=new Set();
  const roomUrl=new URL(window.SCG_TWO_DEVICE_REMOTE?"teacher-two-device-preview.html":location.href,location.href);roomUrl.search="";roomUrl.hash="";roomUrl.searchParams.set("view","room");roomUrl.searchParams.set("session",session);if(window.SCG_TWO_DEVICE_REMOTE)roomUrl.searchParams.set("remote","1");
  frame.src=roomUrl.href;

  function message(content,isError=false){const box=$("preview-message");box.textContent=content;box.classList.toggle("error",isError);box.hidden=!content;}
  /* 2026-11-18: 先生のスマホの残り時間が教室PCより約20秒ずれた（校長らの実機確認）。
     教室PCはサーバーが計算した残り秒を出すが、こちらは端末の時計で引き算していた。
     遠隔デモでは teacher-demo-remote.js がサーバー時刻との差（ミリ秒）を
     window.__twoDeviceClockOffset に置くので、それで補正した「サーバーの今」を使う。
     ★締切の判定はサーバー側。ここは表示だけ。 */
  function nowMs(){const off=window.__twoDeviceClockOffset;return Date.now()+(Number.isFinite(off)?off:0);}
  function projectCurrent(){
    const run=state.run;
    if(commandHandler&&run?.status==="running"){
      if(!Number.isFinite(run.closesAt)||run.closesAt<=0)return cleanProjection({schemaVersion:1,mode:"waiting",roomLabel:"確認用の教室画面"});
      // The database decides when a real run has ended. A fast phone clock must
      // not release correct answers to its embedded classroom display.
      return cleanProjection(Core.project(state,{now:Math.min(nowMs(),run.closesAt-1)}));
    }
    return cleanProjection(Core.project(state));
  }
  function publish(){
    if(disposed)return;
    const projection=projectCurrent();
    if(!projection)return;
    const payload={type:MESSAGE,session,projection};lastPublicMessage=clone(payload);
    if(frame.contentWindow)frame.contentWindow.postMessage(payload,targetOrigin);
    popups.forEach(popup=>{if(popup.closed)popups.delete(popup);else popup.postMessage(payload,targetOrigin);});
    if(channel)channel.postMessage(payload);
  }
  window.addEventListener("message",event=>{
    const trusted=event.source===frame.contentWindow || popups.has(event.source);
    const originOk=location.protocol === "file:" ? event.origin === "null" : event.origin === location.origin;
    if(trusted && originOk && event.data?.type===MESSAGE+":ready" && event.data?.session===session)publish();
  });
  if(channel)channel.addEventListener("message",event=>{if(event.data?.type===MESSAGE+":ready" && event.data?.session===session)publish();});
  frame.addEventListener("load",publish);

  function populate(select,rows,label){rows.forEach(row=>{const option=document.createElement("option");option.value=row.id;option.textContent=label(row);select.append(option);});}
  function syncCatalog(){
    const tests=JSON.stringify(state.tests.map(row=>[row.id,row.title]));
    const classes=JSON.stringify(state.classes.map(row=>[row.id,row.label,row.target]));
    if(tests!==testCatalogSignature){$("test-select").replaceChildren();populate($("test-select"),state.tests,row=>row.title);testCatalogSignature=tests;}
    if(classes!==classCatalogSignature){$("class-select").replaceChildren();populate($("class-select"),state.classes,row=>row.label+"（対象"+row.target+"人）");classCatalogSignature=classes;}
  }
  populate($("test-select"),state.tests,row=>row.title);
  populate($("class-select"),state.classes,row=>row.label+"（対象"+row.target+"人）");
  populate($("room-select"),state.rooms,row=>row.label+(row.online?" · 接続中の見本":" · 未接続の見本"));
  const none=document.createElement("option");none.value="";none.textContent="映さない（スマホだけ）";$("room-select").append(none);

  const errorText={
    RUN_ACTIVE:"確認中のテストがあります。最初に戻してから、別の設定を選んでください。",
    NO_ACTIVE_RUN:"先に小テストをはじめてください。",
    RUN_ENDED:"この回は終了しています。延長や提出はできません。",
    RUN_NOT_ENDED:"答え合わせは、小テストが終わってから操作できます。",
    FORBIDDEN:"この操作を実行できる先生ではありません。",
    ROOM_OCCUPIED:"この教室は別の実施回で使用中です。別の教室を選んでください。",
  };
  function dispatch(action,options){
    if(remoteBlocked && action.type!=="TICK"){message("接続を確認中です。画面上部の状態をご確認ください。",true);return null;}
    if(commandHandler){
      if(action.type==="TICK"){render();publish();return clone(state);}
      if(action.type==="SUBMIT_SAMPLE"){message("この画面では提出を増やしません。ダミー生徒が学生ポータルから受験してください。",true);return null;}
      try{
        const result=commandHandler(clone(action));
        return Promise.resolve(result).catch(error=>{lastError={code:error.code||"ERROR",message:error.message};message(errorText[error.code]||error.message||"操作を確認してください。",true);return null;});
      }catch(error){lastError={code:error.code||"ERROR",message:error.message};message(errorText[error.code]||error.message||"操作を確認してください。",true);return null;}
    }
    try{state=Core.reduce(state,action,options);applyRemoteIdentity();if(action.type!=="TICK"){lastError=null;message("");}render();publish();subscribers.forEach(listener=>listener(clone(state),clone(cleanProjection(Core.project(state))),action));return clone(state);}
    catch(error){lastError={code:error.code||"ERROR",message:error.message};message(errorText[error.code]||error.message||"操作を確認してください。",true);return null;}
  }
  function ask(title,body,action){
    confirmAction=action;$("confirm-title").textContent=title;$("confirm-body").textContent=body;
    $("confirm-action").textContent=title;
    if(typeof $("confirm-dialog").showModal==="function")$("confirm-dialog").showModal();else{dispatch(action);confirmAction=null;}
  }
  $("confirm-action").onclick=()=>{const action=confirmAction;confirmAction=null;$("confirm-dialog").close();if(action)dispatch(action);};
  $("cancel-action").onclick=()=>{confirmAction=null;$("confirm-dialog").close();};
  $("confirm-dialog").addEventListener("cancel",()=>{confirmAction=null;});
  function select(){dispatch({type:"SELECT",testId:$("test-select").value,classId:$("class-select").value,roomId:$("room-select").value||null,durationMinutes:Number($("duration-select").value)});}
  ["test-select","class-select","room-select","duration-select"].forEach(id=>$(id).addEventListener("change",select));
  $("start-run").onclick=()=>dispatch({type:"START"});
  $("simulate-one").onclick=()=>dispatch({type:"SUBMIT_SAMPLE",count:1});
  $("simulate-five").onclick=()=>dispatch({type:"SUBMIT_SAMPLE",count:5});
  $("extend-run").onclick=()=>dispatch({type:"EXTEND"});
  $("end-run").onclick=()=>ask("いま終える",commandHandler?"ダミー生徒向けのこの回の受付を終了して、答え合わせへ進みます。":"架空のテストの受付を終了して、答え合わせへ進みます。",{type:"END"});
  $("toggle-stats").onchange=()=>dispatch({type:"TOGGLE_STATS",value:$("toggle-stats").checked});
  $("prev-question").onclick=()=>dispatch({type:"PREV_QUESTION"});
  $("next-question").onclick=()=>dispatch({type:"NEXT_QUESTION"});
  $("hardest-question").onclick=()=>dispatch({type:"HARDEST_QUESTION"});
  $("stop-projection").onclick=()=>dispatch({type:"STOP_PROJECTION"});
  $("reset-preview").onclick=()=>ask(commandHandler?"次の確認を準備する":"最初に戻す",commandHandler?"終了した回の記録は残し、教室表示を止めて設定画面へ戻ります。受験中の場合は、先にこの回を終えてください。":"このページ内の架空の回答と操作を消して、確認をやり直します。実際の学生データには触れません。",{type:"RESET"});
  $("open-projection").onclick=()=>{
    const popup=window.open(roomUrl.href,"scg_projection_"+session,"width=1180,height=780");
    if(popup){popups.add(popup);message("投影画面を別ウィンドウで開きました。同じブラウザ内で連動します。");setTimeout(publish,200);}
    else message("別ウィンドウを開けませんでした。ブラウザのポップアップ設定をご確認ください。右側の投影画面でも同じ確認ができます。",true);
  };
  $("preview-help-button").onclick=()=>$("help-dialog").showModal();
  $("close-help").onclick=()=>$("help-dialog").close();
  function showView(view){
    mobileView=view === "room" ? "room" : "teacher";
    $("teacher-pane").dataset.mobileHidden=String(mobileView!=="teacher");$("room-pane").dataset.mobileHidden=String(mobileView!=="room");
    $("view-teacher").setAttribute("aria-pressed",String(mobileView==="teacher"));$("view-room").setAttribute("aria-pressed",String(mobileView==="room"));
  }
  $("view-teacher").onclick=()=>showView("teacher");$("view-room").onclick=()=>showView("room");

  function render(){
    const run=state.run,selected=state.selection;
    syncCatalog();
    actionControls.forEach(id=>{$(id).disabled=false;});
    if(remoteProfile)document.querySelector(".phone-head small").textContent=(remoteProfile.display_name||remoteProfile.student_no)+" · 遠隔検証用";
    $("test-select").value=selected.testId;$("class-select").value=selected.classId;$("room-select").value=selected.roomId||"";$("duration-select").value=String(selected.durationMinutes);
    $("setup-panel").hidden=Boolean(run);$("run-panel").hidden=!run;
    if(!run){$("phone-heading").textContent="小テストをはじめる";$("projection-state").hidden=true;if(remoteBlocked)blockRemoteControls();return;}
    const ended=run.endedAt!=null || run.status!=="running";
    const test=state.tests.find(row=>row.id===run.testId),classroom=state.classes.find(row=>row.id===run.classId),room=state.rooms.find(row=>row.id===run.roomId);
    $("phone-heading").textContent=ended ? "小テストが終わりました" : "小テストを実施中";
    $("run-summary").textContent=(test?.title||"操作確認テスト")+" · "+(classroom?.label||"検証クラス")+" · "+(room?.label||"スマホだけ");
    $("teacher-submitted").textContent=run.submittedCount+" / "+(classroom?.target||20);
    $("teacher-remaining").textContent=ended ? "終了" : timeLabel((run.closesAt-nowMs())/1000);
    $("teacher-average").textContent=run.average==null ? "まだ提出はありません。" : "手元のクラス平均正答率 "+Math.round(run.average)+"%";
    $("demo-submissions").hidden=Boolean(commandHandler)||ended;$("running-controls").hidden=ended;$("review-controls").hidden=!ended;
    if(commandHandler)$("reset-preview").disabled=!ended;
    $("simulate-one").disabled=run.submittedCount >= (classroom?.target||20);$("simulate-five").disabled=$("simulate-one").disabled;
    $("toggle-stats").checked=Boolean(run.showStats);
    $("stop-projection").disabled=!run.projectionActive || !run.roomId;
    $("projection-state").hidden=Boolean(run.projectionActive && run.roomId);
    $("projection-state").textContent=!run.roomId?"スマホだけで実施しています。":ended?"教室への投影は止まっています。回答は先生の手元で確認できます。":"教室への投影は止まっています。テストの受付は続いています。";
    const count=test?.questions?.length||1;
    $("question-position").textContent="問題 "+(run.questionIndex+1)+" / "+count;
    $("prev-question").disabled=run.questionIndex<=0;$("next-question").disabled=run.questionIndex>=count-1;
    const rows=$("student-rows");rows.replaceChildren();
    if(!run.submissions.length){rows.append(el("div","empty",commandHandler?"学生ポータルからの提出を待っています。":"架空の提出を増やすと、ここへ表示されます。"));}
    else{
      const table=el("table","small-table"),head=el("thead"),tr=el("tr");tr.append(el("th",null,"確認用の学生"),el("th",null,"正答率"));head.append(tr);table.append(head);const body=el("tbody");
      run.submissions.forEach(row=>{const item=el("tr");item.append(el("td",null,row.name),el("td",null,Math.round(number(row.percentage))+"%"));body.append(item);});table.append(body);rows.append(table);
    }
    const list=$("event-list");list.replaceChildren();
    const labels={START:"はじめました",started:"はじめました",SUBMIT_SAMPLE:"架空の提出を追加しました",sample_submitted:"架空の提出を追加しました",submitted:"架空の提出を追加しました",EXTEND:"5分延長しました",extended:"5分延長しました",END:"終了しました",ended:"終了しました",TOGGLE_STATS:"正答率の表示を切り替えました",stats_toggled:"正答率の表示を切り替えました",NEXT_QUESTION:"映す問題を変えました",PREV_QUESTION:"映す問題を変えました",HARDEST_QUESTION:"難しかった問題を選びました",question_changed:"映す問題を変えました",STOP_PROJECTION:"教室への投影を止めました",projection_stopped:"教室への投影を止めました"};
    labels.stats_shown="正答率を教室に映しました";labels.stats_hidden="正答率を教室から隠しました";
    if(commandHandler){labels.submitted="学生ポータルから提出されました";labels.sample_submitted="提出を確認しました";}
    (run.events||[]).slice(-12).forEach(event=>{const date=new Date(event.at ?? event.timestamp ?? Date.now());const prefix=Number.isFinite(date.getTime())?date.toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"})+"　":"";const label=event.type==="question_changed" && Number.isInteger(event.details?.index)?"問題"+(event.details.index+1)+"を映しました":event.label||labels[event.type]||"操作を記録しました";list.append(el("li",null,prefix+label));});
    if(remoteBlocked)blockRemoteControls();
  }
  const timer=setInterval(()=>{dispatch({type:"TICK"});},1000);
  window.addEventListener("pagehide",()=>{disposed=true;clearInterval(timer);if(channel)channel.close();});
  window.__twoDevicePreview={getState:()=>clone(state),getProjection:()=>clone(projectCurrent()),getLastPublicMessage:()=>clone(lastPublicMessage),getLastError:()=>lastError?clone(lastError):null,dispatch,showView,session,
    subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);},
    replaceState(next){state=commandHandler?clone(next):Core.reduce(clone(next),{type:"TICK"});applyRemoteIdentity();render();publish();},
    setCommandHandler(handler){commandHandler=typeof handler==="function"?handler:null;$("reset-preview").textContent=commandHandler?"次の確認を準備する":"最初に戻す";render();publish();},
    setTeacherProfile(profile){remoteProfile=profile?{student_no:String(profile.student_no),display_name:String(profile.display_name||profile.student_no)}:null;applyRemoteIdentity();render();publish();},
    setRemoteBlocked(value,options){remoteBlocked=Boolean(value);remoteRoomSelectionAllowed=options?.allowRoomSelection!==false;render();},
    updateRemoteRooms(rows){state.rooms=state.rooms.map(room=>{const match=rows.find(item=>item.roomId===room.id);const mine=state.run&&state.run.roomId===room.id&&state.run.projectionActive?state.run.id:null;return match?Object.assign({},room,{label:String(match.label||room.label),online:Boolean(match.online),occupiedByRunId:match.occupied&&!match.ownedByMe?"remote-other":match.ownedByMe?mine:room.occupiedByRunId}):room;}).sort((a,b)=>Number(b.online)-Number(a.online)||a.label.localeCompare(b.label,"ja"));$("room-select").replaceChildren();populate($("room-select"),state.rooms,row=>(row.online?"接続中 · ":"未接続 · ")+row.label+(row.occupiedByRunId&&row.occupiedByRunId!==state.run?.id?"（別の先生が使用中）":""));const option=document.createElement("option");option.value="";option.textContent="映さない（この遠隔検証では選べません）";option.disabled=true;$("room-select").append(option);render();publish();},
  };
  render();publish();showView(mobileView);
})();
