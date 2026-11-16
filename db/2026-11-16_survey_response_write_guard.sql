-- アンケート回答の保存条件を実施回と同じにする（1E）。
-- 既存回答・実施回は変更しない。学生の INSERT / UPDATE だけを制限する。
begin;

-- SECURITY INVOKER: 呼び出した学生の権限で profiles / survey_rounds を読む。
-- 回の閲覧RLSにも依存するが、保存条件はここに明示して独立に守る。
create function app_hidden.survey_response_writable(
  p_student_id uuid, p_round_id uuid, p_survey_key text
) returns boolean
language sql stable security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.profiles p
      join public.survey_rounds r on r.id = p_round_id
     where p.id = p_student_id
       and p.id = (select auth.uid())
       and p.role = 'student'
       and r.survey_key = p_survey_key
       and not r.is_void
       and r.opens_at <= statement_timestamp()
       and (r.closes_at is null or statement_timestamp() < r.closes_at)
       and (
         (cardinality(r.class_names) = 0 and cardinality(r.student_ids) = 0)
         or p.id = any (r.student_ids)
         or p.class_name = any (r.class_names)
       )
  )
$$;
revoke all on function app_hidden.survey_response_writable(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function app_hidden.survey_response_writable(uuid, uuid, text)
  to authenticated;

-- 既存の「本人のみ」PERMISSIVEポリシーにANDで重ねる。
create policy "insert only into eligible open survey round"
  on public.survey_responses as restrictive for insert to authenticated
  with check (app_hidden.survey_response_writable(student_id, round_id, survey_key));

create policy "update only in eligible open survey round"
  on public.survey_responses as restrictive for update to authenticated
  using (app_hidden.survey_response_writable(student_id, round_id, survey_key))
  with check (app_hidden.survey_response_writable(student_id, round_id, survey_key));

-- 同じ回への再提出は answers / submitted_at を更新できる。
-- 学生が過去回答を別の回・定義へ付け替えることはできない。
create function app_hidden.keep_survey_response_identity() returns trigger
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_user = 'authenticated'
     and (new.student_id is distinct from old.student_id
          or new.round_id is distinct from old.round_id
          or new.survey_key is distinct from old.survey_key) then
    raise exception 'survey response identity cannot change'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app_hidden.keep_survey_response_identity()
  from public, anon, authenticated, service_role;
create trigger keep_survey_response_identity
  before update on public.survey_responses
  for each row execute function app_hidden.keep_survey_response_identity();

commit;

-- 巻き戻し（回答・回は消さない）:
-- begin;
-- drop trigger if exists keep_survey_response_identity on public.survey_responses;
-- drop function if exists app_hidden.keep_survey_response_identity();
-- drop policy if exists "update only in eligible open survey round" on public.survey_responses;
-- drop policy if exists "insert only into eligible open survey round" on public.survey_responses;
-- drop function if exists app_hidden.survey_response_writable(uuid, uuid, text);
-- commit;
