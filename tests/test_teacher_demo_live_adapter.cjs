'use strict';
// No application credentials or network: exercise the live transport contract in a VM.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../src/assets/teacher-two-device-core.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const script=fs.readFileSync(path.join(__dirname,'../src/assets/teacher-demo-remote.js'),'utf8');

async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await pause(5);}assert.fail('Adapter did not reach the expected state.');}

async function fixture(){
  const elements=new Map(),intervals=new Map(),pageHandlers=new Map(),calls=[];
  let state=Core.createState(),currentState=clone(state),handler,blocked=true,intervalId=0;
  state.source='existing-dummy-quiz';
  state.tests[0].id='10000000-0000-0000-0000-000000000001';
  state.classes[0].id='fixture-class';state.classes[0].target=40;
  state.selection.testId=state.tests[0].id;state.selection.classId=state.classes[0].id;
  const server={version:1,state,conflict:false,badSnapshot:false,inflight:0,maxInflight:0};
  function element(id){
    if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,disabled:false,textContent:'',handlers:new Map(),classList:{toggle(){}},addEventListener(name,fn){this.handlers.set(name,fn);}});
    return elements.get(id);
  }
  const preview={
    getState:()=>clone(currentState),
    replaceState(next){currentState=clone(next);},
    setCommandHandler(fn){handler=fn;},
    setRemoteBlocked(value){blocked=Boolean(value);},
    setTeacherProfile(){},updateRemoteRooms(){},
    subscribe(){throw new Error('The legacy publish subscription must not be used.');},
  };
  const api={
    token:true,profile:{role:'teacher',student_no:'teacher_a',display_name:'先生A'},
    logout(){this.token=null;this.profile=null;},
    async rpc(name,args){
      calls.push({name,args:clone(args)});server.inflight++;server.maxInflight=Math.max(server.maxInflight,server.inflight);
      try{
        await pause(name==='teacher_demo_live_action'?20:5);
        if(name==='teacher_demo_rooms')return ['room-a','room-b'].map((roomId,index)=>({roomId,label:'確認用教室'+(index?'B':'A'),online:index===0,occupied:roomId==='room-a',ownedByMe:roomId==='room-a'}));
        if(name==='teacher_demo_live_load'){
          const result=clone(server.state);result.selection.roomId=args.p_room_id;
          if(server.badSnapshot)result.source='legacy-synthetic-state';
          return {roomId:args.p_room_id,version:server.version,private_state:result};
        }
        if(name==='teacher_demo_live_action'){
          if(server.conflict||args.p_expected_version!==server.version)throw new Error('DEMO_VERSION_CONFLICT');
          server.state=Core.reduce(server.state,args.p_action);
          if(args.p_action.type==='START'){
            const previous=server.state.run.id;
            server.state.run.id='20000000-0000-0000-0000-000000000001';
            server.state.rooms.forEach(room=>{if(room.occupiedByRunId===previous)room.occupiedByRunId=server.state.run.id;});
          }
          server.version++;
          return {roomId:args.p_room_id,version:server.version,private_state:clone(server.state)};
        }
        throw new Error('A forbidden RPC was called.');
      }finally{server.inflight--;}
    },
  };
  const context={
    console,Date,URL,Promise,JSON,Number,Set,Error,Boolean,Array,Math,
    location:{protocol:'https:',origin:'https://example.invalid'},
    document:{body:{dataset:{}},getElementById:element},
    api,TwoDeviceCore:Core,__twoDevicePreview:preview,
    setTimeout,clearTimeout,
    setInterval(fn,ms){const id=++intervalId;intervals.set(id,{fn,ms});return id;},
    clearInterval(id){intervals.delete(id);},
    addEventListener(name,fn){pageHandlers.set(name,fn);},
  };
  context.window=context;
  vm.runInNewContext(script,context,{filename:'teacher-demo-remote.js'});
  await until(()=>context.__teacherDemoRemote?.getStatus().ready&&!context.__teacherDemoRemote.getStatus().sending);
  return {
    server,calls,elements,context,preview,
    dispatch:action=>handler(action),
    blocked:()=>blocked,
    poll(){const timer=[...intervals.values()].find(row=>row.ms===5000);assert.ok(timer,'Five-second snapshot poll is installed.');timer.fn();},
    async idle(){await context.__teacherDemoRemote.whenIdle();await until(()=>!context.__teacherDemoRemote.getStatus().sending);},
    close(){pageHandlers.get('pagehide')?.();},
  };
}

test('Connect uses only the live snapshot contract, never a legacy state publisher',async()=>{
  const f=await fixture();try{
    assert.equal(f.preview.getState().source,'existing-dummy-quiz');
    assert.equal(f.preview.getState().classes[0].target,40);
    assert.equal(f.blocked(),false);
    assert.deepEqual(f.calls.map(row=>row.name),['teacher_demo_rooms','teacher_demo_live_load']);
  }finally{f.close();}
});

test('Commands and polling are serialized; actual submissions refresh without changing version',async()=>{
  const f=await fixture();try{
    const operation=f.dispatch({type:'START'});
    assert.equal(f.blocked(),true);
    const before=f.calls.length;f.poll();
    await operation;await f.idle();
    assert.equal(f.calls.length,before+1);
    assert.equal(f.server.version,2);
    assert.equal(f.preview.getState().run.id,'20000000-0000-0000-0000-000000000001');
    // Only the simulated SERVER receives this fixture submission; the adapter
    // must discover it through a read instead of manufacturing a client answer.
    f.server.state=Core.reduce(f.server.state,{type:'SUBMIT_SAMPLE',count:1});
    f.poll();await f.idle();
    assert.equal(f.preview.getState().run.submittedCount,1);
    assert.equal(f.context.__teacherDemoRemote.getStatus().version,2);
    assert.equal(f.server.maxInflight,1);
    assert.ok(f.calls.every(row=>!['teacher_demo_publish','teacher_demo_load'].includes(row.name)));
    assert.ok(f.calls.every(row=>!Object.hasOwn(row.args,'p_private_state')));
  }finally{f.close();}
});

test('Synthetic submission commands are rejected before any RPC',async()=>{
  const f=await fixture();try{
    const count=f.calls.length;
    await assert.rejects(f.dispatch({type:'SUBMIT_SAMPLE',count:5}));
    assert.equal(f.calls.length,count);
  }finally{f.close();}
});

test('Version conflict stops writes and polling; an explicit reload restores the server snapshot',async()=>{
  const f=await fixture();try{
    f.server.conflict=true;
    await assert.rejects(f.dispatch({type:'START'}));await f.idle();
    assert.equal(f.context.__teacherDemoRemote.getStatus().failed,true);
    assert.equal(f.blocked(),true);
    const count=f.calls.length;f.poll();await pause(10);
    assert.equal(f.calls.length,count);
    f.server.conflict=false;
    await f.context.__teacherDemoRemote.reload();await f.idle();
    assert.equal(f.context.__teacherDemoRemote.getStatus().ready,true);
    assert.equal(f.context.__teacherDemoRemote.getStatus().failed,false);
    assert.equal(f.server.version,1);
  }finally{f.close();}
});

test('An invalid or legacy snapshot fails closed instead of falling back to local fixtures',async()=>{
  const f=await fixture();try{
    const before=f.preview.getState();f.server.badSnapshot=true;
    await assert.rejects(f.context.__teacherDemoRemote.reload());await f.idle();
    assert.equal(f.context.__teacherDemoRemote.getStatus().failed,true);
    assert.deepEqual(f.preview.getState(),before);
    assert.equal(f.calls.filter(row=>row.name==='teacher_demo_live_action').length,0);
  }finally{f.close();}
});
