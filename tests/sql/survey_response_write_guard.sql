-- Supabase execute_sql で実行する1Eの受入試験。
-- s001/s002 は既存ダミー。作る回と回答は最後に全て ROLLBACK する。
begin;

do $$
begin
  if (select count(*) from public.profiles where student_no in ('s001', 's002') and role = 'student') <> 2 then
    raise exception 'dummy students s001/s002 are required';
  end if;
end $$;

select set_config('request.jwt.claim.sub',
                  (select id::text from public.profiles where student_no = 's001'), true);
select set_config('test.guard_s002',
                  (select id::text from public.profiles where student_no = 's002'), true);

with r as (
  insert into public.survey_rounds (survey_key, title, student_ids, opens_at, closes_at)
  values ('test_ui', 'write guard test open A',
          array[(select id from public.profiles where student_no = 's001')],
          now() - interval '1 hour', now() + interval '1 hour')
  returning id
) select set_config('test.guard_open', (select id::text from r), true);
with r as (
  insert into public.survey_rounds (survey_key, title, student_ids, opens_at, closes_at)
  values ('test_ui', 'write guard test open B',
          array[(select id from public.profiles where student_no = 's001')],
          now() - interval '1 hour', now() + interval '1 hour')
  returning id
) select set_config('test.guard_open_b', (select id::text from r), true);
with r as (
  insert into public.survey_rounds (survey_key, title, student_ids, opens_at, closes_at)
  values ('test_ui', 'write guard test other target',
          array[(select id from public.profiles where student_no = 's002')],
          now() - interval '1 hour', now() + interval '1 hour')
  returning id
) select set_config('test.guard_other', (select id::text from r), true);
with r as (
  insert into public.survey_rounds (survey_key, title, student_ids, opens_at, closes_at)
  values ('test_ui', 'write guard test future',
          array[(select id from public.profiles where student_no = 's001')],
          now() + interval '1 hour', now() + interval '2 hours')
  returning id
) select set_config('test.guard_future', (select id::text from r), true);
with r as (
  insert into public.survey_rounds (survey_key, title, student_ids, opens_at, closes_at)
  values ('test_ui', 'write guard test closed',
          array[(select id from public.profiles where student_no = 's001')],
          now() - interval '2 hours', now() - interval '1 hour')
  returning id
) select set_config('test.guard_closed', (select id::text from r), true);
with r as (
  insert into public.survey_rounds (survey_key, title, student_ids, opens_at, closes_at, is_void)
  values ('test_ui', 'write guard test void',
          array[(select id from public.profiles where student_no = 's001')],
          now() - interval '1 hour', now() + interval '1 hour', true)
  returning id
) select set_config('test.guard_void', (select id::text from r), true);

-- 過去回答を模した行。学生による変更は拒否されるが、読み取りは残る。
with r as (
  insert into public.survey_responses (student_id, round_id, survey_key, answers)
  values ((select id from public.profiles where student_no = 's001'),
          current_setting('test.guard_closed')::uuid, 'test_ui', '{}'::jsonb)
  returning id
) select set_config('test.guard_closed_response', (select id::text from r), true);

set local role authenticated;

do $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'dummy JWT was not set'; end if;

  -- 正常提出と同じ回への再提出。
  insert into public.survey_responses (round_id, survey_key, answers)
  values (current_setting('test.guard_open')::uuid, 'test_ui', '{"answer":1}'::jsonb);
  insert into public.survey_responses (round_id, survey_key, answers)
  values (current_setting('test.guard_open')::uuid, 'test_ui', '{"answer":2}'::jsonb)
  on conflict (student_id, round_id) do update
    set survey_key = excluded.survey_key,
        answers = excluded.answers,
        submitted_at = excluded.submitted_at;
  select count(*) into n from public.survey_responses
   where round_id = current_setting('test.guard_open')::uuid
     and student_id = auth.uid() and answers = '{"answer":2}'::jsonb;
  if n <> 1 then raise exception 'same-round resubmission failed'; end if;

  begin
    insert into public.survey_responses (student_id, round_id, survey_key, answers)
    values (current_setting('test.guard_s002')::uuid,
            current_setting('test.guard_open')::uuid, 'test_ui', '{}'::jsonb);
    raise exception 'other student accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.survey_responses (round_id, survey_key, answers)
    values (current_setting('test.guard_other')::uuid, 'test_ui', '{}'::jsonb);
    raise exception 'non-target student accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.survey_responses (round_id, survey_key, answers)
    values (current_setting('test.guard_future')::uuid, 'test_ui', '{}'::jsonb);
    raise exception 'not-yet-open round accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.survey_responses (round_id, survey_key, answers)
    values (current_setting('test.guard_closed')::uuid, 'test_ui', '{}'::jsonb)
    on conflict (student_id, round_id) do update set answers = excluded.answers;
    raise exception 'closed round accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.survey_responses (round_id, survey_key, answers)
    values (current_setting('test.guard_void')::uuid, 'test_ui', '{}'::jsonb);
    raise exception 'void round accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.survey_responses (round_id, survey_key, answers)
    values (current_setting('test.guard_open_b')::uuid, 'shinro_2026', '{}'::jsonb);
    raise exception 'mismatched survey key accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.survey_responses (round_id, survey_key, answers)
    values (null, 'test_ui', '{}'::jsonb);
    raise exception 'missing round accepted';
  exception when insufficient_privilege then null; end;

  update public.survey_responses set answers = '{"late":true}'::jsonb
   where id = current_setting('test.guard_closed_response')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'closed answer was updated'; end if;

  begin
    update public.survey_responses
       set round_id = current_setting('test.guard_open_b')::uuid
     where round_id = current_setting('test.guard_open')::uuid
       and student_id = auth.uid();
    raise exception 'response was moved to another round';
  exception when check_violation then null; end;
end $$;

rollback;
select 'PASS: 11 survey write cases; test rows rolled back' as result;
