-- Isolated, fixture-only two-device demo. No real quiz/student tables are changed.
-- Apply once as the database owner. Classroom display keys are provisioned
-- separately: store sha256(convert_to(key, 'UTF8')), never the plain key.
-- PostgreSQL 17 provides sha256(bytea); no pgcrypto/search-path dependency.
--
-- 巻き戻し（実行前にデモ状態の控えと承認を確認。このコメントは実行しない）:
--   drop function public.get_teacher_demo_display(text);
--   drop function public.teacher_demo_publish(text,bigint,jsonb,jsonb);
--   drop function public.teacher_demo_load(text);
--   drop function public.teacher_demo_rooms();
--   drop function app_hidden.teacher_demo_public_dto(jsonb,jsonb,text,text,timestamptz);
--   drop function app_hidden.teacher_demo_text(jsonb,integer,text);
--   drop function app_hidden.teacher_demo_integer(jsonb,integer,integer,integer);
--   drop function app_hidden.teacher_demo_number(jsonb,numeric,numeric,numeric);
--   drop table public.teacher_demo_sessions;
--   drop table public.demo_classrooms;
-- Existing auth/profile/quiz/student objects are not part of the rollback.
begin;

create table public.demo_classrooms (
  id text primary key check (id ~ '^room-[a-z0-9][a-z0-9_-]{0,30}$'),
  label text not null check (char_length(btrim(label)) between 1 and 64),
  key_hash bytea not null unique check (octet_length(key_hash) = 32),
  enabled boolean not null default true,
  last_seen_at timestamptz
);

create table public.teacher_demo_sessions (
  room_id text primary key references public.demo_classrooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  private_state jsonb not null check (jsonb_typeof(private_state) = 'object'),
  public_state jsonb not null check (jsonb_typeof(public_state) = 'object'),
  version bigint not null check (version between 1 and 9007199254740991),
  updated_at timestamptz not null default clock_timestamp(),
  check (octet_length(private_state::text) <= 262144),
  check (octet_length(public_state::text) <= 65536)
);

alter table public.demo_classrooms enable row level security;
alter table public.teacher_demo_sessions enable row level security;
-- No table policies: browser roles have neither table privileges nor an RLS path.
revoke all on table public.demo_classrooms from anon, authenticated, public, service_role;
revoke all on table public.teacher_demo_sessions from anon, authenticated, public, service_role;

create function app_hidden.teacher_demo_number(
  p_value jsonb, p_min numeric, p_max numeric, p_default numeric default null
) returns numeric
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare n numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then return p_default; end if;
  n := (p_value #>> '{}')::numeric;
  if n < p_min or n > p_max then return p_default; end if;
  return n;
end;
$$;

create function app_hidden.teacher_demo_integer(
  p_value jsonb, p_min integer, p_max integer, p_default integer default 0
) returns integer
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare n numeric;
begin
  n := app_hidden.teacher_demo_number(p_value, p_min, p_max, null);
  if n is null or trunc(n) <> n then return p_default; end if;
  return n::integer;
end;
$$;

create function app_hidden.teacher_demo_text(p_value jsonb, p_max integer, p_default text default '')
returns text
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare v text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return p_default; end if;
  v := left(regexp_replace(p_value #>> '{}', '[[:cntrl:]]', '', 'g'), p_max);
  if char_length(btrim(v)) = 0 then return p_default; end if;
  return v;
end;
$$;

-- Complete projection contract. Rebuild this on both publish AND display read.
-- Never merge, spread, or return a session/private_state/public_state wholesale.
create function app_hidden.teacher_demo_public_dto(
  p_public jsonb, p_private jsonb, p_room_label text, p_room_id text, p_now timestamptz
) returns jsonb
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
  r jsonb;
  mode_value text;
  closes_ms numeric;
  now_ms numeric := extract(epoch from p_now) * 1000;
  count_target integer;
  count_submitted integer := 0;
  remaining integer := 0;
  stats_allowed boolean := false;
  mean_value numeric;
  rate_value numeric;
  q jsonb;
  q_options jsonb := '[]'::jsonb;
  safe_question jsonb := null;
  opt jsonb;
  q_index integer;
  q_total integer;
  option_count integer;
  total_option_count integer := 0;
  correct_options integer := 0;
begin
  result := jsonb_build_object(
    'schemaVersion', 1, 'mode', 'waiting', 'roomLabel', left(coalesce(p_room_label, '確認用教室'), 64),
    'statusLabel', '待ち受け', 'testTitle', '', 'classLabel', '',
    'target', 0, 'submitted', 0, 'remainingSeconds', 0,
    'showStats', false, 'average', null, 'correctRate', null, 'question', null
  );
  if jsonb_typeof(p_private) is distinct from 'object'
     or app_hidden.teacher_demo_integer(p_private->'schemaVersion', 1, 1, 0) <> 1
     or jsonb_typeof(p_public) is distinct from 'object' then return result; end if;
  r := p_private->'run';
  if jsonb_typeof(r) is distinct from 'object'
     or r->'projectionActive' is distinct from 'true'::jsonb
     or r->>'roomId' is distinct from p_room_id
     or coalesce(r->>'status', '') not in ('running', 'ended') then return result; end if;
  closes_ms := app_hidden.teacher_demo_number(r->'closesAt', 0, 8640000000000000, null);
  if closes_ms is null then return result; end if;
  if r->>'status' = 'ended' or closes_ms <= now_ms then mode_value := 'review';
  else mode_value := 'running'; end if;

  count_target := app_hidden.teacher_demo_integer(r->'target', 1, 500, 0);
  if count_target = 0 then return result; end if;
  if jsonb_typeof(r->'submissions') = 'array' then
    count_submitted := least(jsonb_array_length(r->'submissions'), count_target);
  end if;
  if mode_value = 'running' then
    remaining := least(86400::numeric, greatest(0::numeric, ceil((closes_ms - now_ms) / 1000)))::integer;
  end if;
  stats_allowed := mode_value = 'review' or coalesce(r->'showStats' = 'true'::jsonb, false);
  if stats_allowed then
    mean_value := app_hidden.teacher_demo_number(p_public->'average', 0, 100, null);
    rate_value := app_hidden.teacher_demo_number(p_public->'correctRate', 0, 100, null);
  end if;

  -- Options and correct answers are never disclosed during a running quiz,
  -- including when the teacher has enabled the class-average display.
  if mode_value = 'review' and p_public->>'mode' = 'review'
     and jsonb_typeof(p_public->'question') = 'object' then
    q := p_public->'question';
    q_total := app_hidden.teacher_demo_integer(q->'total', 1, 100, 0);
    q_index := app_hidden.teacher_demo_integer(q->'index', 0, 99, -1);
    if jsonb_typeof(q->'options') = 'array' then
    if q_total > 0 and q_index >= 0 and q_index < q_total
       and jsonb_typeof(q->'text') = 'string'
       and jsonb_array_length(q->'options') between 2 and 8 then
      for opt in select value from jsonb_array_elements(q->'options') loop
        option_count := app_hidden.teacher_demo_integer(opt->'count', 0, count_submitted, -1);
        if jsonb_typeof(opt) is distinct from 'object'
           or jsonb_typeof(opt->'label') is distinct from 'string'
           or jsonb_typeof(opt->'correct') is distinct from 'boolean'
           or option_count < 0 then
          q_options := '[]'::jsonb;
          exit;
        end if;
        if opt->'correct' = 'true'::jsonb then correct_options := correct_options + 1; end if;
        total_option_count := total_option_count + option_count;
        q_options := q_options || jsonb_build_array(jsonb_build_object(
          'label', app_hidden.teacher_demo_text(opt->'label', 200, '選択肢'),
          'count', option_count, 'correct', opt->'correct' = 'true'::jsonb
        ));
      end loop;
      if jsonb_array_length(q_options) between 2 and 8
         and total_option_count = count_submitted and correct_options = 1 then
        safe_question := jsonb_build_object(
          'index', q_index, 'total', q_total,
          'text', app_hidden.teacher_demo_text(q->'text', 500, '確認用の問題'), 'options', q_options
        );
      end if;
    end if;
    end if;
  end if;
  return jsonb_build_object(
    'schemaVersion', 1, 'mode', mode_value, 'roomLabel', left(coalesce(p_room_label, '確認用教室'), 64),
    'statusLabel', case when mode_value = 'review' then '答え合わせ' else 'テスト受付中' end,
    'testTitle', app_hidden.teacher_demo_text(p_public->'testTitle', 120, '操作確認テスト'),
    'classLabel', app_hidden.teacher_demo_text(p_public->'classLabel', 80, '検証クラス'),
    'target', count_target, 'submitted', count_submitted, 'remainingSeconds', remaining,
    'showStats', stats_allowed, 'average', mean_value, 'correctRate', rate_value, 'question', safe_question
  );
end;
$$;

revoke all on function app_hidden.teacher_demo_number(jsonb,numeric,numeric,numeric) from public, anon, authenticated, service_role;
revoke all on function app_hidden.teacher_demo_integer(jsonb,integer,integer,integer) from public, anon, authenticated, service_role;
revoke all on function app_hidden.teacher_demo_text(jsonb,integer,text) from public, anon, authenticated, service_role;
revoke all on function app_hidden.teacher_demo_public_dto(jsonb,jsonb,text,text,timestamptz) from public, anon, authenticated, service_role;

create function public.teacher_demo_rooms()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not coalesce(app_hidden.is_teacher(), false) then
    raise exception using errcode = '42501', message = 'DEMO_TEACHER_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roomId', r.id, 'label', r.label,
    'online', coalesce(r.last_seen_at > statement_timestamp() - interval '45 seconds', false),
    'ownedByMe', coalesce(s.owner_id = auth.uid(), false),
    'occupied', coalesce(s.updated_at > statement_timestamp() - interval '120 seconds', false)
  ) order by r.id), '[]'::jsonb) into result
  from public.demo_classrooms r
  left join public.teacher_demo_sessions s on s.room_id = r.id
  where r.enabled;
  return result;
end;
$$;

create function public.teacher_demo_load(p_room_id text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare s public.teacher_demo_sessions%rowtype;
begin
  if auth.uid() is null or not coalesce(app_hidden.is_teacher(), false) then
    raise exception using errcode = '42501', message = 'DEMO_TEACHER_REQUIRED';
  end if;
  if not exists(select 1 from public.demo_classrooms where id = p_room_id and enabled) then
    raise exception using errcode = '22023', message = 'DEMO_ROOM_UNAVAILABLE';
  end if;
  select * into s from public.teacher_demo_sessions where room_id = p_room_id;
  if not found then return jsonb_build_object('roomId', p_room_id, 'version', 0, 'private_state', null); end if;
  if s.owner_id is distinct from auth.uid() then
    if s.updated_at > clock_timestamp() - interval '120 seconds' then
      raise exception using errcode = '42501', message = 'DEMO_ROOM_OCCUPIED';
    end if;
    -- Do not expose another teacher's state, even after its lease has expired.
    return jsonb_build_object('roomId', p_room_id, 'version', 0, 'private_state', null);
  end if;
  return jsonb_build_object('roomId', p_room_id, 'version', s.version, 'private_state', s.private_state);
end;
$$;

create function public.teacher_demo_publish(
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

create function public.get_teacher_demo_display(p_key text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  room_row public.demo_classrooms%rowtype;
  s public.teacher_demo_sessions%rowtype;
  now_value timestamptz := clock_timestamp();
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception using errcode = '28000', message = 'DEMO_INVALID_DISPLAY_KEY';
  end if;
  select * into room_row from public.demo_classrooms
    where enabled and key_hash = pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8'));
  if not found then raise exception using errcode = '28000', message = 'DEMO_INVALID_DISPLAY_KEY'; end if;
  update public.demo_classrooms set last_seen_at = now_value
    where id = room_row.id and (last_seen_at is null or last_seen_at <= now_value - interval '15 seconds');
  select * into s from public.teacher_demo_sessions where room_id = room_row.id;
  if not found or s.updated_at <= now_value - interval '120 seconds' then
    return app_hidden.teacher_demo_public_dto('{}'::jsonb,'{}'::jsonb,room_row.label,room_row.id,now_value);
  end if;
  return app_hidden.teacher_demo_public_dto(s.public_state,s.private_state,room_row.label,room_row.id,now_value);
end;
$$;

revoke all on function public.teacher_demo_rooms() from public, anon, service_role;
revoke all on function public.teacher_demo_load(text) from public, anon, service_role;
revoke all on function public.teacher_demo_publish(text,bigint,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.teacher_demo_rooms() to authenticated;
grant execute on function public.teacher_demo_load(text) to authenticated;
grant execute on function public.teacher_demo_publish(text,bigint,jsonb,jsonb) to authenticated;

-- Narrow exception: a high-entropy classroom key can read only the rebuilt DTO.
-- Unlike every teacher RPC, this display-only RPC intentionally permits anon.
revoke all on function public.get_teacher_demo_display(text) from public, anon, authenticated, service_role;
grant execute on function public.get_teacher_demo_display(text) to anon, authenticated;

comment on table public.demo_classrooms is 'Fixture-only two-device demo classrooms; display keys are hashed and never exposed by a teacher RPC.';
comment on table public.teacher_demo_sessions is 'Isolated demo states. Browser access is RPC-only; no real quiz_runs, attempts, or student records are changed.';
notify pgrst, 'reload schema';
commit;
