-- Supabase applied migration: 20261115194731
-- Existing student portal / teacher phone / anonymous classroom display.
-- Adds a three-question fixture set; runs target exactly the existing s001-s040
-- profiles by UUID. Never opens a set globally, changes a real class, or deletes answers.
begin;

do $$
declare sid uuid; qid uuid; n integer; j integer;
begin
  select count(*) into n from public.quiz_sets where source_file='teacher-demo-live-v1' and source_book='SCG 動作確認';
  if n > 1 then raise exception 'DEMO_FIXTURE_AMBIGUOUS'; end if;
  if n = 0 then
    insert into public.quiz_sets(title,lesson,is_open,source_book,source_file)
    values('2台運用 動作確認テスト','動作確認',false,'SCG 動作確認','teacher-demo-live-v1') returning id into sid;
    for j in 1..3 loop
      insert into public.questions(quiz_set_id,seq,prompt,points)
      values(sid,j,case j when 1 then '「あした」の意味はどれですか？' when 2 then '「午前」は、いつですか？' else '「少し待ってください」は、何をお願いしますか？' end,1)
      returning id into qid;
      insert into public.question_choices(question_id,idx,label)
      select qid,a.ord::smallint,a.label from unnest(case j
        when 1 then array['今日の次の日','今日の前の日','今日と同じ日']
        when 2 then array['正午から夜','0時から正午','夜だけ']
        else array['早く帰る','今すぐ話す','短い時間待つ'] end) with ordinality a(label,ord);
      insert into public.question_answers(question_id,correct_idx) values(qid,j::smallint);
    end loop;
  end if;
end $$;

create function app_hidden.teacher_demo_fixture_ids() returns uuid[]
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare ids uuid[];
begin
  select array_agg(id order by student_no) into ids from public.profiles
  where role='student' and student_no=any(array(select 's'||lpad(i::text,3,'0') from generate_series(1,40) i));
  if coalesce(cardinality(ids),0) <> 40 then raise exception using errcode='22023',message='DEMO_FIXTURE_UNAVAILABLE'; end if;
  return ids;
end $$;

create function app_hidden.teacher_demo_fixture_set() returns uuid
language plpgsql stable set search_path=pg_catalog,public,pg_temp as $$
declare sid uuid; n integer;
begin
  select count(*),(array_agg(id))[1] into n,sid from public.quiz_sets
  where source_file='teacher-demo-live-v1' and source_book='SCG 動作確認' and not is_open;
  if n<>1 or (select count(*) from public.questions where quiz_set_id=sid)<>3 then
    raise exception using errcode='22023',message='DEMO_FIXTURE_UNAVAILABLE';
  end if;
  return sid;
end $$;

create function app_hidden.teacher_demo_live_state(p_room_id text,p_old jsonb,p_caller uuid,p_now timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare
  sid uuid := app_hidden.teacher_demo_fixture_set();
  ids uuid[] := app_hidden.teacher_demo_fixture_ids();
  qs jsonb; students jsonb; rooms jsonb; history_value jsonb; state jsonb;
  r jsonb; qr public.quiz_runs%rowtype; attempt_ids uuid[]; submitted integer;
  submissions jsonb; stats jsonb := '[]'::jsonb; question jsonb; counts jsonb; opts jsonb;
  correct_index integer; option_index integer; option_count integer; answered integer; correct_count integer;
  question_index integer := 0; average_value numeric; duration_value integer; now_ms numeric;
  ended boolean; show_stats boolean; projection boolean; title_value text; teacher_label text;
begin
  now_ms := floor(extract(epoch from p_now)*1000);
  select title into title_value from public.quiz_sets where id=sid;
  select display_name into teacher_label from public.profiles where id=p_caller;
  select jsonb_agg(jsonb_build_object('id',q.id::text,'text',q.prompt,'options',
    (select jsonb_agg(c.label order by c.idx) from public.question_choices c where c.question_id=q.id),
    'correctIndex',a.correct_idx-1) order by q.seq) into qs
  from public.questions q join public.question_answers a on a.question_id=q.id where q.quiz_set_id=sid;
  if jsonb_array_length(qs)<>3 then raise exception using errcode='22023',message='DEMO_FIXTURE_UNAVAILABLE'; end if;
  select jsonb_agg(jsonb_build_object('id',id::text,'name',display_name) order by student_no) into students
    from public.profiles where id=any(ids);
  duration_value := app_hidden.teacher_demo_integer(p_old#>'{selection,durationMinutes}',10,30,10);
  if duration_value not in (10,15,20,30) then duration_value:=10; end if;
  history_value := case when jsonb_typeof(p_old->'history')='array' then p_old->'history' else '[]'::jsonb end;
  r := case when p_old->>'source'='existing-dummy-quiz' and jsonb_typeof(p_old->'run')='object' then p_old->'run' else null end;
  if r is not null then
    if coalesce(r->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='DEMO_RUN_UNAVAILABLE'; end if;
    select * into qr from public.quiz_runs where id=(r->>'id')::uuid;
    if not found or qr.created_by is distinct from p_caller or qr.quiz_set_id<>sid
       or cardinality(qr.class_names)<>0 or cardinality(qr.student_ids)<>40
       or not (qr.student_ids <@ ids and ids <@ qr.student_ids) or r->>'roomId' is distinct from p_room_id then
      raise exception using errcode='42501',message='DEMO_RUN_UNAVAILABLE';
    end if;
    -- The existing submit endpoint accepts retries. Count each student once,
    -- consistently using their most recently submitted attempt for this run.
    select coalesce(array_agg(latest.id),'{}'::uuid[]) into attempt_ids from (
      select distinct on(a.student_id) a.id from public.attempts a
      where a.run_id=qr.id and a.student_id=any(qr.student_ids)
      order by a.student_id,a.submitted_at desc,a.id desc
    ) latest;
    submitted:=cardinality(attempt_ids);
    select coalesce(jsonb_agg(jsonb_build_object('studentId',a.student_id::text,'name',p.display_name,
      'submittedAt',floor(extract(epoch from a.submitted_at)*1000),'score',a.score,
      'percentage',round(100.0*a.score/nullif(a.total,0),1),'answers',
      (select jsonb_agg(coalesce(aa.chosen-1,-1) order by q.seq) from public.questions q
       left join public.attempt_answers aa on aa.question_id=q.id and aa.attempt_id=a.id where q.quiz_set_id=sid)
    ) order by p.student_no),'[]'::jsonb),round(avg(100.0*a.score/nullif(a.total,0)),1)
      into submissions,average_value from public.attempts a join public.profiles p on p.id=a.student_id where a.id=any(attempt_ids);
    for question in select value from jsonb_array_elements(qs) loop
      counts:='[]'::jsonb; opts:=question->'options'; answered:=0;
      correct_index:=(question->>'correctIndex')::integer;
      for option_index in 0..jsonb_array_length(opts)-1 loop
        select count(*) into option_count from public.attempt_answers aa
          where aa.attempt_id=any(attempt_ids) and aa.question_id=(question->>'id')::uuid and aa.chosen=option_index+1;
        counts:=counts||jsonb_build_array(option_count); answered:=answered+option_count;
      end loop;
      correct_count:=(counts->>correct_index)::integer;
      if answered<submitted then opts:=opts||jsonb_build_array('未回答'); counts:=counts||jsonb_build_array(submitted-answered); end if;
      stats:=stats||jsonb_build_array(jsonb_build_object('index',question_index,'text',question->>'text',
        'options',opts,'correctIndex',correct_index,'counts',counts,'correctCount',correct_count,
        'correctRate',case when submitted>0 then round(100.0*correct_count/submitted,1) else null end));
      question_index:=question_index+1;
    end loop;
    ended:=qr.is_void or qr.closes_at<=p_now;
    projection:=coalesce((r->>'projectionActive')::boolean,true) and not qr.is_void;
    show_stats:=coalesce((r->>'showStats')::boolean,false);
    question_index:=app_hidden.teacher_demo_integer(r->'questionIndex',0,jsonb_array_length(qs)-1,0);
    r:=jsonb_build_object('id',qr.id::text,'testId',sid::text,'testTitle',title_value,
      'classId','fixture-class','classLabel','ダミー生徒（40人）','target',cardinality(qr.student_ids),
      'roomId',p_room_id,'teacherId',p_caller::text,'teacherName',coalesce(teacher_label,'先生'),
      'startedAt',floor(extract(epoch from qr.opens_at)*1000),
      'originalClosesAt',coalesce(p_old#>'{run,originalClosesAt}',to_jsonb(floor(extract(epoch from qr.opens_at+make_interval(mins=>coalesce(qr.duration_min,10)))*1000))),
      'closesAt',floor(extract(epoch from qr.closes_at)*1000),'durationMinutes',coalesce(qr.duration_min,10),
      'endedAt',case when ended then to_jsonb(floor(extract(epoch from qr.closes_at)*1000)) else 'null'::jsonb end,
      'endedBy',p_old#>'{run,endedBy}','endedReason',case when qr.is_void then 'void' when ended then coalesce(p_old#>>'{run,endedReason}','deadline') else null end,
      'status',case when ended then 'ended' else 'running' end,'showStats',show_stats,'questionIndex',question_index,
      'projectionActive',projection,'submissions',submissions,'submittedCount',submitted,'average',average_value,'questionStats',stats,
      'events',case when jsonb_typeof(p_old#>'{run,events}')='array' then p_old#>'{run,events}' else '[]'::jsonb end);
  end if;
  select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'online',coalesce(d.last_seen_at>p_now-interval '45 seconds',false),
    'occupiedByRunId',case when d.id=p_room_id and coalesce((r->>'projectionActive')::boolean,false) then r->>'id'
      when x.owner_id is distinct from p_caller and x.updated_at>p_now-interval '120 seconds' then 'remote-other' else null end) order by d.id)
    into rooms from public.demo_classrooms d left join public.teacher_demo_sessions x on x.room_id=d.id where d.enabled;
  state:=jsonb_build_object('schemaVersion',1,'source','existing-dummy-quiz',
    'createdAt',coalesce(p_old->'createdAt',to_jsonb(now_ms)),'updatedAt',now_ms,'nextRunNumber',1,
    'teacher',jsonb_build_object('id',p_caller::text,'name',coalesce(teacher_label,'先生')),
    'classes',jsonb_build_array(jsonb_build_object('id','fixture-class','label','ダミー生徒（40人）','target',40)),
    'rooms',rooms,'durations',jsonb_build_array(10,15,20,30),
    'tests',jsonb_build_array(jsonb_build_object('id',sid::text,'title',title_value,'questions',qs)),'students',students,
    'selection',jsonb_build_object('testId',sid::text,'classId','fixture-class','roomId',p_room_id,'durationMinutes',duration_value),
    'run',coalesce(r,'null'::jsonb),'history',history_value);
  return state;
end $$;

create function app_hidden.teacher_demo_live_projection(p_state jsonb,p_room_id text,p_now timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare r jsonb:=p_state->'run'; q jsonb; opts jsonb:='[]'::jsonb; i integer; dto jsonb; room_label text; ended boolean;
begin
  select label into room_label from public.demo_classrooms where id=p_room_id;
  ended:=r->>'status'='ended';
  if ended and jsonb_typeof(r->'questionStats')='array' then
    q:=r->'questionStats'->((r->>'questionIndex')::integer);
    for i in 0..jsonb_array_length(q->'options')-1 loop
      opts:=opts||jsonb_build_array(jsonb_build_object('label',q->'options'->>i,'count',(q->'counts'->>i)::integer,'correct',i=(q->>'correctIndex')::integer));
    end loop;
    q:=jsonb_build_object('index',(r->>'questionIndex')::integer,'total',jsonb_array_length(r->'questionStats'),'text',q->>'text','options',opts);
  else q:=null; end if;
  dto:=jsonb_build_object('mode',case when ended then 'review' else 'running' end,'testTitle',r->>'testTitle','classLabel',r->>'classLabel',
    'average',r->'average','correctRate',r->'average','question',q);
  return app_hidden.teacher_demo_public_dto(dto,p_state,room_label,p_room_id,p_now);
end $$;

create function public.teacher_demo_live_load(p_room_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare s public.teacher_demo_sessions%rowtype; now_value timestamptz; st jsonb; v bigint;
begin
  if auth.uid() is null or not coalesce(app_hidden.is_teacher(),false) then raise exception using errcode='42501',message='DEMO_TEACHER_REQUIRED'; end if;
  perform 1 from public.demo_classrooms where id=p_room_id and enabled for update;
  if not found then raise exception using errcode='22023',message='DEMO_ROOM_UNAVAILABLE'; end if;
  now_value:=clock_timestamp();
  select * into s from public.teacher_demo_sessions where room_id=p_room_id for update;
  if found and s.owner_id<>auth.uid() and s.updated_at>now_value-interval '120 seconds' then raise exception using errcode='42501',message='DEMO_ROOM_OCCUPIED'; end if;
  if s.room_id is not null and s.owner_id<>auth.uid() and s.private_state->>'source'='existing-dummy-quiz'
    and exists(select 1 from public.quiz_runs where id=(s.private_state#>>'{run,id}')::uuid and not is_void and closes_at>now_value) then
    raise exception using errcode='42501',message='DEMO_ROOM_OCCUPIED';
  end if;
  v:=coalesce(s.version,0);
  if s.room_id is null or s.owner_id<>auth.uid() or s.private_state->>'source' is distinct from 'existing-dummy-quiz' then
    st:=app_hidden.teacher_demo_live_state(p_room_id,null,auth.uid(),now_value); v:=v+1;
  else st:=app_hidden.teacher_demo_live_state(p_room_id,s.private_state,auth.uid(),now_value); end if;
  insert into public.teacher_demo_sessions(room_id,owner_id,private_state,public_state,version,updated_at)
  values(p_room_id,auth.uid(),st,app_hidden.teacher_demo_live_projection(st,p_room_id,now_value),v,now_value)
  on conflict(room_id) do update set owner_id=excluded.owner_id,private_state=excluded.private_state,public_state=excluded.public_state,version=excluded.version,updated_at=excluded.updated_at;
  return jsonb_build_object('roomId',p_room_id,'version',v,'private_state',st);
end $$;

create function public.teacher_demo_live_action(p_room_id text,p_expected_version bigint,p_action jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare s public.teacher_demo_sessions%rowtype; st jsonb; r jsonb; now_value timestamptz; now_ms numeric;
  action_type text:=p_action->>'type'; sid uuid; ids uuid[]; created jsonb; active boolean; ix integer; ev jsonb; v bigint;
begin
  if auth.uid() is null or not coalesce(app_hidden.is_teacher(),false) then raise exception using errcode='42501',message='DEMO_TEACHER_REQUIRED'; end if;
  if jsonb_typeof(p_action) is distinct from 'object' or coalesce(action_type,'') not in ('SELECT','START','EXTEND','END','TOGGLE_STATS','NEXT_QUESTION','PREV_QUESTION','HARDEST_QUESTION','STOP_PROJECTION','RESET') then
    raise exception using errcode='22023',message='DEMO_INVALID_ACTION';
  end if;
  -- Serializes fixture starts across both rooms; ordinary classroom runs are untouched.
  perform pg_advisory_xact_lock(hashtext('SCG teacher fixture quiz live'));
  perform 1 from public.demo_classrooms where id=p_room_id and enabled for update;
  if not found then raise exception using errcode='22023',message='DEMO_ROOM_UNAVAILABLE'; end if;
  now_value:=clock_timestamp();now_ms:=floor(extract(epoch from now_value)*1000);
  select * into s from public.teacher_demo_sessions where room_id=p_room_id for update;
  if not found or s.owner_id<>auth.uid() or s.private_state->>'source' is distinct from 'existing-dummy-quiz' then
    raise exception using errcode='42501',message='DEMO_ROOM_OCCUPIED';
  end if;
  if p_expected_version is null or p_expected_version<>s.version then raise exception using errcode='PT409',message='DEMO_VERSION_CONFLICT'; end if;
  st:=app_hidden.teacher_demo_live_state(p_room_id,s.private_state,auth.uid(),now_value); r:=st->'run';
  sid:=app_hidden.teacher_demo_fixture_set();ids:=app_hidden.teacher_demo_fixture_ids();active:=r->>'status'='running';
  if action_type='SELECT' then
    if coalesce(active,false) then raise exception using errcode='22023',message='DEMO_RUN_ACTIVE'; end if;
    if (p_action ? 'testId' and p_action->>'testId'<>sid::text) or (p_action ? 'classId' and p_action->>'classId'<>'fixture-class')
       or (p_action ? 'roomId' and p_action->>'roomId'<>p_room_id) then raise exception using errcode='22023',message='DEMO_FIXTURE_ONLY'; end if;
    if p_action ? 'durationMinutes' then
      ix:=app_hidden.teacher_demo_integer(p_action->'durationMinutes',10,30,-1);
      if ix not in (10,15,20,30) then raise exception using errcode='22023',message='DEMO_INVALID_DURATION'; end if;
      st:=jsonb_set(st,'{selection,durationMinutes}',to_jsonb(ix));
    end if;
  elsif action_type='START' then
    if coalesce(active,false) then raise exception using errcode='22023',message='DEMO_RUN_ACTIVE'; end if;
    if exists(select 1 from public.quiz_runs where quiz_set_id=sid and not is_void and closes_at>now_value and student_ids && ids) then
      raise exception using errcode='22023',message='DEMO_STUDENTS_BUSY';
    end if;
    if jsonb_typeof(r)='object' then st:=jsonb_set(st,'{history}',(st->'history')||jsonb_build_array(r-'submissions'-'questionStats')); end if;
    created:=public.start_quiz_run(sid,'{}'::text[],ids,(st#>>'{selection,durationMinutes}')::integer);
    r:=jsonb_build_object('id',created->>'run_id','roomId',p_room_id,'projectionActive',true,'showStats',false,'questionIndex',0,
      'originalClosesAt',floor(extract(epoch from (created->>'closes_at')::timestamptz)*1000),'events','[]'::jsonb);
    st:=jsonb_set(st,'{run}',r);
  else
    if jsonb_typeof(r) is distinct from 'object' then
      if action_type<>'RESET' then raise exception using errcode='22023',message='DEMO_NO_RUN'; end if;
    else
      if action_type='EXTEND' then
        if not active then raise exception using errcode='22023',message='DEMO_RUN_ENDED'; end if;
        update public.quiz_runs set closes_at=closes_at+interval '5 minutes',duration_min=coalesce(duration_min,10)+5 where id=(r->>'id')::uuid and created_by=auth.uid() and not is_void and closes_at>clock_timestamp();
        if not found then raise exception using errcode='22023',message='DEMO_RUN_ENDED'; end if;
      elsif action_type='END' then
        if active then perform public.close_quiz_run((r->>'id')::uuid); end if;
        r:=r||jsonb_build_object('endedBy',auth.uid()::text,'endedReason','manual');
      elsif action_type='TOGGLE_STATS' then
        if not active then raise exception using errcode='22023',message='DEMO_RUN_ENDED'; end if;
        if p_action ? 'value' and jsonb_typeof(p_action->'value') is distinct from 'boolean' then raise exception using errcode='22023',message='DEMO_INVALID_ACTION'; end if;
        r:=jsonb_set(r,'{showStats}',coalesce(p_action->'value',to_jsonb(not (r->>'showStats')::boolean)));
      elsif action_type in ('NEXT_QUESTION','PREV_QUESTION','HARDEST_QUESTION') then
        if active then raise exception using errcode='22023',message='DEMO_RUN_ACTIVE'; end if;
        ix:=(r->>'questionIndex')::integer;
        if action_type='HARDEST_QUESTION' then
          if (r->>'submittedCount')::integer=0 then raise exception using errcode='22023',message='DEMO_NO_SUBMISSIONS'; end if;
          select (value->>'index')::integer into ix from jsonb_array_elements(r->'questionStats') order by (value->>'correctRate')::numeric nulls last,(value->>'index')::integer limit 1;
        elsif action_type='NEXT_QUESTION' then ix:=least(2,ix+1); else ix:=greatest(0,ix-1); end if;
        r:=jsonb_set(r,'{questionIndex}',to_jsonb(ix));
      elsif action_type='STOP_PROJECTION' then r:=jsonb_set(r,'{projectionActive}','false'::jsonb);
      elsif action_type='RESET' then
        if active then raise exception using errcode='22023',message='DEMO_END_FIRST'; end if;
        st:=jsonb_set(st,'{history}',(st->'history')||jsonb_build_array(r-'submissions'-'questionStats'));r:='null'::jsonb;
      end if;
      st:=jsonb_set(st,'{run}',r);
    end if;
  end if;
  if jsonb_typeof(st->'run')='object' then
    ev:=jsonb_build_object('type',action_type,'at',now_ms,'actorId',auth.uid()::text,'details',jsonb_build_object('index',coalesce(ix,0)));
    st:=jsonb_set(st,'{run,events}',coalesce(st#>'{run,events}','[]'::jsonb)||jsonb_build_array(ev));
  end if;
  st:=app_hidden.teacher_demo_live_state(p_room_id,st,auth.uid(),now_value);v:=s.version+1;
  update public.teacher_demo_sessions set private_state=st,public_state=app_hidden.teacher_demo_live_projection(st,p_room_id,now_value),version=v,updated_at=now_value where room_id=p_room_id;
  return jsonb_build_object('roomId',p_room_id,'version',v,'private_state',st);
end $$;

revoke all on function app_hidden.teacher_demo_fixture_ids() from public,anon,authenticated,service_role;
revoke all on function app_hidden.teacher_demo_fixture_set() from public,anon,authenticated,service_role;
revoke all on function app_hidden.teacher_demo_live_state(text,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app_hidden.teacher_demo_live_projection(jsonb,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.teacher_demo_live_load(text) from public,anon,authenticated,service_role;
revoke all on function public.teacher_demo_live_action(text,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.teacher_demo_live_load(text) to authenticated;
grant execute on function public.teacher_demo_live_action(text,bigint,jsonb) to authenticated;
-- Retire arbitrary client snapshots once a room is linked to real fixture runs.
create or replace function public.teacher_demo_publish(
  p_room_id text, p_expected_version bigint, p_private_state jsonb, p_public_state jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  room_row public.demo_classrooms%rowtype;
  s public.teacher_demo_sessions%rowtype;
  existed boolean;
  now_value timestamptz;
  new_version bigint;
  safe_public jsonb;
  caller uuid := auth.uid();
begin
  if caller is null or not coalesce(app_hidden.is_teacher(), false) then
    raise exception using errcode = '42501', message = 'DEMO_TEACHER_REQUIRED';
  end if;
  if p_expected_version is null or p_expected_version < 0 or p_expected_version >= 9007199254740991 then
    raise exception using errcode = '22023', message = 'DEMO_INVALID_VERSION';
  end if;
  if jsonb_typeof(p_private_state) is distinct from 'object'
     or jsonb_typeof(p_public_state) is distinct from 'object'
     or octet_length(p_private_state::text) > 262144
     or octet_length(p_public_state::text) > 65536
     or app_hidden.teacher_demo_integer(p_private_state->'schemaVersion',1,1,0) <> 1 then
    raise exception using errcode = '22023', message = 'DEMO_INVALID_STATE';
  end if;
  -- Lock the existing room row, not only the session row. This also serializes
  -- concurrent attempts to create the first session for a room.
  select * into room_row from public.demo_classrooms
    where id = p_room_id and enabled for update;
  if not found then raise exception using errcode = '22023', message = 'DEMO_ROOM_UNAVAILABLE'; end if;
  now_value := clock_timestamp();
  select * into s from public.teacher_demo_sessions where room_id = p_room_id for update;
  existed := found;
  if p_private_state->>'source'='existing-dummy-quiz' or (existed and s.private_state->>'source'='existing-dummy-quiz') then
    raise exception using errcode='42501',message='DEMO_LIVE_MODE';
  end if;
  if not existed then
    if p_expected_version <> 0 then raise exception using errcode = 'PT409', message = 'DEMO_VERSION_CONFLICT'; end if;
    new_version := 1;
  elsif s.owner_id = caller then
    if p_expected_version <> s.version then raise exception using errcode = 'PT409', message = 'DEMO_VERSION_CONFLICT'; end if;
    new_version := s.version + 1;
  else
    if s.updated_at > now_value - interval '120 seconds' then
      raise exception using errcode = '42501', message = 'DEMO_ROOM_OCCUPIED';
    end if;
    if p_expected_version <> 0 then raise exception using errcode = 'PT409', message = 'DEMO_VERSION_CONFLICT'; end if;
    new_version := s.version + 1;
  end if;
  if new_version > 9007199254740991 then raise exception using errcode = '22023', message = 'DEMO_VERSION_EXHAUSTED'; end if;
  safe_public := app_hidden.teacher_demo_public_dto(p_public_state, p_private_state, room_row.label, room_row.id, now_value);
  if existed then
    update public.teacher_demo_sessions set owner_id = caller, private_state = p_private_state,
      public_state = safe_public, version = new_version, updated_at = now_value where room_id = p_room_id;
  else
    insert into public.teacher_demo_sessions(room_id,owner_id,private_state,public_state,version,updated_at)
      values(p_room_id,caller,p_private_state,safe_public,new_version,now_value);
  end if;
  return jsonb_build_object('roomId',p_room_id,'version',new_version,'updatedAt',now_value);
end;
$$;
revoke all on function public.teacher_demo_publish(text,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.teacher_demo_publish(text,bigint,jsonb,jsonb) to authenticated;
commit;

-- 巻き戻し: 新live_load/live_actionの実行権限を外し、前のteacher_demo_publish関数定義のみを復元する。
-- 新RPCと内部live/fixtureヘルパーだけを削除できる。fixtureセット・実施回・回答は削除せず保持し、
-- 対象UUID40件を確認した回だけ締め切る。既存の教室表・表示鍵・他の小テストを変更しない。
