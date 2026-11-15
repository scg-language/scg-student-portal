-- Supabase applied migration: 20261115194853
-- Guard legacy synthetic IDs before any UUID cast.
begin;
create or replace function public.teacher_demo_live_load(p_room_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare s public.teacher_demo_sessions%rowtype; now_value timestamptz; st jsonb; v bigint;
begin
  if auth.uid() is null or not coalesce(app_hidden.is_teacher(),false) then raise exception using errcode='42501',message='DEMO_TEACHER_REQUIRED'; end if;
  perform 1 from public.demo_classrooms where id=p_room_id and enabled for update;
  if not found then raise exception using errcode='22023',message='DEMO_ROOM_UNAVAILABLE'; end if;
  now_value:=clock_timestamp();
  select * into s from public.teacher_demo_sessions where room_id=p_room_id for update;
  if found and s.owner_id<>auth.uid() and s.updated_at>now_value-interval '120 seconds' then raise exception using errcode='42501',message='DEMO_ROOM_OCCUPIED'; end if;
  if s.room_id is not null and s.owner_id<>auth.uid() and s.private_state->>'source'='existing-dummy-quiz' then
    -- SQL boolean predicates may be reordered: never cast a legacy mock ID
    -- in the same AND expression as the live-source guard.
    if coalesce(s.private_state#>>'{run,id}','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      if exists(select 1 from public.quiz_runs where id=(s.private_state#>>'{run,id}')::uuid and not is_void and closes_at>now_value) then
        raise exception using errcode='42501',message='DEMO_ROOM_OCCUPIED';
      end if;
    end if;
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
revoke all on function public.teacher_demo_live_load(text) from public,anon,authenticated,service_role;
grant execute on function public.teacher_demo_live_load(text) to authenticated;
commit;

-- 巻き戻し: 必要なら直前のlive_quiz SQLにあるlive_load関数の定義だけを復元する。
-- 旧mock IDとの互換性修正なので通常は保持する。教室・問題・実施回・回答は変更しない。
