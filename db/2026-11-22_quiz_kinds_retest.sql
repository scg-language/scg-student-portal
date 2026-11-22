-- =====================================================================
-- テストの種類・合格の線・再テスト（4本目）                            2026-11-22
--
-- ■ なぜ（docs/yakusoku.md 5章・docs/schema-plan.md 4章）
--   合格＝正解率 80% 以上。線はテストの種類ごとに1本。漢字・まとめは再テストあり、毎日の課のテストはなし。
--   再テストは自動では開かない。先生が教室で開いて、監督して、閉じる。受けなかった学生は、受けるまで一覧に残る。
--   再テストは1回だけ。テストの日に休んだ学生は、次の日に1回目を受ける。
--
-- ■ このファイルでやること
--   ① quiz_kinds（種類：daily / kanji / matome・再テストの有無・合格の線）
--   ② quiz_sets.kind_key（種類）。今ある回は、取り込んだ教材のファイル名から付ける。これから入る回も同じ決まりで自動
--   ③ quiz_runs.pass_pct（始めた瞬間の線の写し）・retest_of（再テストなら元の回）・retest_exempt（再テストの対象にしない回）
--   ④ app_hidden.retest_states() … 「だれが、どの回の再テストの対象か」を決める1か所
--   ⑤ public.retest_targets()    … 先生に返す一覧（名前と対象テストだけ。点数は返さない）
--   ⑥ public.start_retest_run()  … 再テストを開く（翌日以降だけ・その日のうちに閉じる・対象はサーバーが決める）
--   ⑦ public.my_retests()        … 学生本人へのお知らせ
--   ⑧ public.set_pass_pct() / public.set_quiz_kind() … 線と種類を変える（記録に残る）
--   ⑨ public.run_pass_stats()    … 回ごとの平均と「線に届かなかった人数」（名前は返さない）
--
-- ■ 前提：1〜3本目（capabilities / audit_log / account_status）を先に流してあること
--
-- ■ 🔴 今ある動きへの触り方
--   ・submit_attempt / start_quiz_run / close_quiz_run の中身には触らない
--   ・quiz_sets と quiz_runs に「入れるときに空なら埋める」トリガを1つずつ足す（種類／線の写し）
--   ・🔴 今ある実施回（この SQL を流す前に作られた回）は、全部 retest_exempt=true にする
--     ＝流した瞬間に、過去のダミーの回から再テストの対象がどっと出ることはない。対象になるのは、これから始める回だけ
--   ・合否は保存しない。score * 100 >= pass_pct * total で、そのつど計算する（attempts は今のまま）
--
-- ■ 種類の見分け方（取り込んだ教材のファイル名）
--   「漢字」を含む → kanji ／「まとめテスト」を含む → matome ／「文法チェック」を含む → daily ／ それ以外 → 付けない（合否を出さない）
--   ⚠ 漢字の決まりは仮（2026-11-22 時点で、漢字テストはまだ1問も入っていない）。取り込むときに見直す
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/quiz_kinds_retest_check.sql（最後に例外で止めて全部ロールバック）／get_advisors（WARN が6件増える）
-- =====================================================================

begin;

-- ① テストの種類
create table if not exists public.quiz_kinds (
  key        text primary key,
  label      text    not null,
  has_retest boolean not null,
  pass_pct   integer not null,
  sort       integer not null default 0,
  constraint quiz_kinds_pass_pct_check check (pass_pct between 1 and 100)
);

insert into public.quiz_kinds (key, label, has_retest, pass_pct, sort) values
  ('daily',  '毎日のテスト', false, 80, 10),
  ('kanji',  '漢字テスト',   true,  80, 20),
  ('matome', 'まとめテスト', true,  80, 30)
on conflict (key) do update set label = excluded.label, has_retest = excluded.has_retest, sort = excluded.sort;
-- ★pass_pct は上書きしない（流し直したときに、変えた線が 80 に戻らないように）

alter table public.quiz_kinds enable row level security;
drop policy if exists "staff read quiz kinds" on public.quiz_kinds;
create policy "staff read quiz kinds"
  on public.quiz_kinds for select to authenticated
  using (app_hidden.is_teacher());
revoke all on table public.quiz_kinds from anon;
revoke insert, update, delete on table public.quiz_kinds from authenticated;
grant  select on table public.quiz_kinds to authenticated;

-- ② 回に種類を持たせる
alter table public.quiz_sets add column if not exists kind_key text references public.quiz_kinds(key);

create or replace function app_hidden.guess_quiz_kind(p_source_file text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_source_file ilike '%漢字%'         then 'kanji'
    when p_source_file ilike '%まとめテスト%' then 'matome'
    when p_source_file ilike '%文法チェック%' then 'daily'
    else null
  end
$$;
revoke all     on function app_hidden.guess_quiz_kind(text) from public, anon, service_role;
grant  execute on function app_hidden.guess_quiz_kind(text) to authenticated;

update public.quiz_sets set kind_key = app_hidden.guess_quiz_kind(source_file)
 where kind_key is null and source_file is not null;

create or replace function app_hidden.quiz_sets_fill_kind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind_key is null then
    new.kind_key := app_hidden.guess_quiz_kind(new.source_file);
  end if;
  return new;
end $$;
revoke all on function app_hidden.quiz_sets_fill_kind() from public, anon, authenticated, service_role;

drop trigger if exists quiz_sets_fill_kind on public.quiz_sets;
create trigger quiz_sets_fill_kind before insert on public.quiz_sets
  for each row execute function app_hidden.quiz_sets_fill_kind();

-- ③ 実施回に、線の写し・元の回・対象外の印
alter table public.quiz_runs add column if not exists pass_pct      integer;
alter table public.quiz_runs add column if not exists retest_of     uuid references public.quiz_runs(id) on delete set null;
alter table public.quiz_runs add column if not exists retest_exempt boolean not null default false;
alter table public.quiz_runs drop constraint if exists quiz_runs_pass_pct_check;
alter table public.quiz_runs add  constraint quiz_runs_pass_pct_check check (pass_pct is null or pass_pct between 1 and 100);
create index if not exists quiz_runs_retest_of_idx on public.quiz_runs (retest_of) where retest_of is not null;
create index if not exists attempts_run_student_idx on public.attempts (run_id, student_id) where run_id is not null;

-- 🔴 今ある回は、再テストの対象にしない（線の写しは入れておく＝集計には使える）
update public.quiz_runs set retest_exempt = true;
update public.quiz_runs r set pass_pct = k.pass_pct
  from public.quiz_sets s join public.quiz_kinds k on k.key = s.kind_key
 where s.id = r.quiz_set_id and r.pass_pct is null;

-- 回を始めた瞬間に、その種類の線を写す（start_quiz_run を書き換えずに済ませる）
create or replace function app_hidden.quiz_runs_fill_pass_pct()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.pass_pct is null then
    select k.pass_pct into new.pass_pct
      from public.quiz_sets s join public.quiz_kinds k on k.key = s.kind_key
     where s.id = new.quiz_set_id;
  end if;
  return new;
end $$;
revoke all on function app_hidden.quiz_runs_fill_pass_pct() from public, anon, authenticated, service_role;

drop trigger if exists quiz_runs_fill_pass_pct on public.quiz_runs;
create trigger quiz_runs_fill_pass_pct before insert on public.quiz_runs
  for each row execute function app_hidden.quiz_runs_fill_pass_pct();

-- ④ 再テストの対象を決める1か所
--    元の回と、その再テストの回（retest_of）を「ひとつながり」と見て、学生ごとに提出を古い順に数える
--      提出なし                → not_taken     （まだ受けていない・1回目）
--      提出1つ・不合格         → retest        （再テストの対象）
--      提出1つ・合格           → passed        （終わり）
--      提出2つ・2つ目が合格    → retest_passed （終わり）
--      提出2つ・2つ目も不合格  → retest_failed （終わり。再テストは1回だけ）
--    在籍でない学生は、どこにも出さない。元の回がまだ開いているあいだは出さない
create or replace function app_hidden.retest_states(p_class text default null, p_origin uuid default null)
returns table (origin_run uuid, quiz_set_id uuid, origin_at timestamptz, student_id uuid, state text, last_at timestamptz)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  with origins as (
    select r.id, r.quiz_set_id, r.opens_at, r.pass_pct, r.class_names, r.student_ids
      from public.quiz_runs r
      join public.quiz_sets  s on s.id = r.quiz_set_id
      join public.quiz_kinds k on k.key = s.kind_key and k.has_retest
     where r.retest_of is null and not r.is_void and not r.retest_exempt
       and r.pass_pct is not null and r.closes_at <= now()
       and (p_origin is null or r.id = p_origin)
  ), targets as (
    select o.id as origin_run, o.quiz_set_id, o.opens_at, o.pass_pct, p.id as student_id
      from origins o
      join public.profiles p
        on p.role = 'student' and p.status = 'active'
       and (p_class is null or p.class_name = p_class)
       and ( (coalesce(array_length(o.class_names, 1), 0) = 0 and coalesce(array_length(o.student_ids, 1), 0) = 0)
             or p.id = any (o.student_ids)
             or p.class_name = any (o.class_names) )
  ), tries as (
    select t.origin_run, t.student_id, a.score, a.total, a.submitted_at,
           row_number() over (partition by t.origin_run, t.student_id order by a.submitted_at, a.id) as k
      from targets t
      join public.quiz_runs r on (r.id = t.origin_run or r.retest_of = t.origin_run) and not r.is_void
      join public.attempts  a on a.run_id = r.id and a.student_id = t.student_id
  )
  select t.origin_run, t.quiz_set_id, t.opens_at, t.student_id,
         case
           when f.k is null                                   then 'not_taken'
           when l.k is null and f.score * 100 <  t.pass_pct * f.total then 'retest'
           when l.k is null                                   then 'passed'
           when l.score * 100 >= t.pass_pct * l.total         then 'retest_passed'
           else 'retest_failed'
         end,
         coalesce(l.submitted_at, f.submitted_at)
    from targets t
    left join tries f on f.origin_run = t.origin_run and f.student_id = t.student_id and f.k = 1
    left join tries l on l.origin_run = t.origin_run and l.student_id = t.student_id and l.k = 2
$$;
revoke all on function app_hidden.retest_states(text, uuid) from public, anon, authenticated, service_role;

-- ⑤ 先生に返す一覧
--    クラスを指定しない → クラスごとの人数だけ（ホームの「再テストの学生が◯名います」）
--    クラスを指定する   → そのクラスの学生（名前・対象テスト・元の日付・状態）。🔴 点数は返さない
--    名前を返したときは、操作の記録に1行（同じ人・同じクラスは10分に1行まで）
create or replace function public.retest_targets(p_class_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or not app_hidden.can('retest.run') then
    raise exception '再テストの一覧を見られるのは、その権限を持つ職員だけです' using errcode = '42501';
  end if;

  if p_class_name is null then
    select coalesce(jsonb_agg(jsonb_build_object('class_name', x.class_name, 'count', x.n) order by x.class_name), '[]'::jsonb)
      into v_out
      from (select p.class_name, count(distinct st.student_id) as n
              from app_hidden.retest_states(null, null) st
              join public.profiles p on p.id = st.student_id
             where st.state in ('not_taken', 'retest')
             group by p.class_name) x;
    return v_out;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'origin_run', st.origin_run, 'quiz_set_id', st.quiz_set_id,
           'title', s.title, 'lesson', s.lesson, 'origin_at', st.origin_at,
           'student_id', p.id, 'student_no', p.student_no, 'display_name', p.display_name,
           'state', st.state)
         order by st.origin_at, s.title, p.student_no), '[]'::jsonb)
    into v_out
    from app_hidden.retest_states(p_class_name, null) st
    join public.profiles  p on p.id = st.student_id
    join public.quiz_sets s on s.id = st.quiz_set_id
   where st.state in ('not_taken', 'retest')
      -- 受け終わった人は、1週間だけ見せる（「受けたか」まで見えることが、引き継ぎの要）
      or (st.state in ('retest_passed', 'retest_failed') and st.last_at > now() - interval '7 days');

  if not exists (select 1 from public.audit_log a
                  where a.actor_id = auth.uid() and a.action = 'view.retest_list'
                    and a.target_type = 'class' and a.target_id = p_class_name
                    and a.at > now() - interval '10 minutes') then
    perform app_hidden.audit('view.retest_list', 'class', p_class_name, jsonb_build_object('rows', jsonb_array_length(v_out)));
  end if;
  return v_out;
end $$;

revoke all     on function public.retest_targets(text) from public;
revoke execute on function public.retest_targets(text) from anon;
grant  execute on function public.retest_targets(text) to authenticated;

-- ⑥ 再テストを開く
--    ・元の回の翌日以降だけ（日付は日本時間）　・対象はサーバーが決める（画面から名簿を渡さない）
--    ・時間は元の回と同じ分数が既定。その日の終わりをまたがない　・同じ学生に、同じ元の回の再テストを二重に開かない
create or replace function public.start_retest_run(p_origin_run uuid, p_class_name text, p_minutes integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.quiz_runs%rowtype;
  v_ids    uuid[];
  v_min    integer;
  v_close  timestamptz;
  v_run    public.quiz_runs%rowtype;
  v_today  date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if auth.uid() is null or not app_hidden.can('retest.run') then
    raise exception '再テストを開けるのは、その権限を持つ職員だけです' using errcode = '42501';
  end if;
  if p_class_name is null or btrim(p_class_name) = '' then
    raise exception 'クラスを選んでください' using errcode = '22023';
  end if;
  select * into o from public.quiz_runs where id = p_origin_run and retest_of is null and not is_void;
  if o.id is null then
    raise exception '元のテストが見つかりません' using errcode = '22023';
  end if;
  if (o.opens_at at time zone 'Asia/Tokyo')::date >= v_today then
    raise exception '再テストは、テストの次の日から開けます' using errcode = '22023';
  end if;

  select array_agg(st.student_id order by st.student_id) into v_ids
    from app_hidden.retest_states(p_class_name, p_origin_run) st
   where st.state in ('not_taken', 'retest');
  if v_ids is null then
    raise exception 'このクラスに、このテストの対象の学生はいません' using errcode = '22023';
  end if;
  if exists (select 1 from public.quiz_runs r
              where r.retest_of = p_origin_run and not r.is_void and now() < r.closes_at
                and r.student_ids && v_ids) then
    raise exception 'この学生たちの再テストは、もう開いています' using errcode = '22023';
  end if;

  v_min := coalesce(p_minutes, o.duration_min, 20);
  if v_min < 1 or v_min > 480 then
    raise exception '時間は1分から480分までです' using errcode = '22023';
  end if;
  -- 閉じ忘れても、その日（日本時間）のうちに閉じる
  v_close := least(now() + make_interval(mins => v_min),
                   ((v_today + 1)::timestamp at time zone 'Asia/Tokyo'));

  insert into public.quiz_runs (quiz_set_id, class_names, student_ids, opens_at, closes_at, duration_min,
                                created_by, retest_of, pass_pct)
  values (o.quiz_set_id, '{}', v_ids, now(), v_close, v_min, auth.uid(), o.id, o.pass_pct)
  returning * into v_run;

  perform app_hidden.audit('retest.run.start', 'quiz_run', v_run.id::text,
                           jsonb_build_object('origin_run', o.id, 'class', p_class_name, 'students', array_length(v_ids, 1)));
  return jsonb_build_object('run_id', v_run.id, 'quiz_set_id', v_run.quiz_set_id, 'origin_run', o.id,
                            'target_count', array_length(v_ids, 1), 'opens_at', v_run.opens_at, 'closes_at', v_run.closes_at);
end $$;

revoke all     on function public.start_retest_run(uuid, text, integer) from public;
revoke execute on function public.start_retest_run(uuid, text, integer) from anon;
grant  execute on function public.start_retest_run(uuid, text, integer) to authenticated;

-- ⑦ 学生本人へのお知らせ（自分の分だけ。点数は返さない＝点数は今までどおり attempts から本人が読める）
create or replace function public.my_retests()
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'origin_run', st.origin_run, 'quiz_set_id', st.quiz_set_id,
           'title', s.title, 'lesson', s.lesson, 'origin_at', st.origin_at, 'state', st.state)
         order by st.origin_at), '[]'::jsonb)
    from app_hidden.retest_states(null, null) st
    join public.quiz_sets s on s.id = st.quiz_set_id
   where st.student_id = auth.uid()
     and st.state in ('not_taken', 'retest')
$$;

revoke all     on function public.my_retests() from public;
revoke execute on function public.my_retests() from anon;
grant  execute on function public.my_retests() to authenticated;

-- ⑧ 線を変える（次に始める回から効く。終わった回の合否は、その回の写しのまま動かない）
create or replace function public.set_pass_pct(p_kind text, p_pct integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before integer;
begin
  if auth.uid() is null or not app_hidden.can('quiz.passline') then
    raise exception '合格の線を変えられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_pct is null or p_pct < 1 or p_pct > 100 then
    raise exception '合格の線は 1 から 100 までです' using errcode = '22023';
  end if;
  select pass_pct into v_before from public.quiz_kinds where key = p_kind;
  if not found then
    raise exception 'そのテストの種類はありません' using errcode = '22023';
  end if;
  update public.quiz_kinds set pass_pct = p_pct where key = p_kind;
  perform app_hidden.audit('passline.set', 'quiz_kind', p_kind, jsonb_build_object('before', v_before, 'after', p_pct));
  return jsonb_build_object('kind', p_kind, 'before', v_before, 'after', p_pct);
end $$;

revoke all     on function public.set_pass_pct(text, integer) from public;
revoke execute on function public.set_pass_pct(text, integer) from anon;
grant  execute on function public.set_pass_pct(text, integer) to authenticated;

-- 回の種類を手で変える（自動で付いた種類が違うとき。p_kind＝null で「種類なし」）
create or replace function public.set_quiz_kind(p_quiz_set_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before text;
begin
  if auth.uid() is null or not app_hidden.can('quiz.edit') then
    raise exception 'テストの種類を変えられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_kind is not null and not exists (select 1 from public.quiz_kinds where key = p_kind) then
    raise exception 'そのテストの種類はありません' using errcode = '22023';
  end if;
  select kind_key into v_before from public.quiz_sets where id = p_quiz_set_id;
  if not found then
    raise exception 'テストが見つかりません' using errcode = '22023';
  end if;
  update public.quiz_sets set kind_key = p_kind where id = p_quiz_set_id;
  perform app_hidden.audit('quiz.kind.set', 'quiz_set', p_quiz_set_id::text, jsonb_build_object('before', v_before, 'after', p_kind));
end $$;

revoke all     on function public.set_quiz_kind(uuid, text) from public;
revoke execute on function public.set_quiz_kind(uuid, text) from anon;
grant  execute on function public.set_quiz_kind(uuid, text) to authenticated;

-- ⑨ 回ごとの集計：提出した人数・平均の正解率・線に届かなかった人数。🔴 名前も個人の点も返さない
create or replace function public.run_pass_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or not app_hidden.can('quiz.result.one') then
    raise exception '集計を見られるのは職員だけです' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id', r.id, 'quiz_set_id', r.quiz_set_id, 'title', s.title, 'lesson', s.lesson, 'kind', s.kind_key,
           'class_names', to_jsonb(r.class_names), 'opens_at', r.opens_at, 'is_retest', r.retest_of is not null,
           'pass_pct', r.pass_pct, 'submitted', x.n, 'avg_pct', x.avg_pct,
           'below', case when r.pass_pct is null then null else x.below end)
         order by r.opens_at desc), '[]'::jsonb)
    into v_out
    from public.quiz_runs r
    join public.quiz_sets s on s.id = r.quiz_set_id
    left join lateral (
      select count(*) as n,
             round(avg(a.score * 100.0 / nullif(a.total, 0)), 1) as avg_pct,
             count(*) filter (where a.score * 100 < r.pass_pct * a.total) as below
        from public.attempts a where a.run_id = r.id
    ) x on true
   where not r.is_void
     and r.opens_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
  return v_out;
end $$;

revoke all     on function public.run_pass_stats(integer) from public;
revoke execute on function public.run_pass_stats(integer) from anon;
grant  execute on function public.run_pass_stats(integer) to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   select kind_key, count(*) from public.quiz_sets group by 1;         -- matome 10 / daily 77 / null 6（2026-11-22 のデモ DB）
--   select count(*) from public.quiz_runs where not retest_exempt;      -- 0（今ある回は全部、対象外）
--   tests/sql/quiz_kinds_retest_check.sql
--
-- 巻き戻し（🔴 トリガを先に外す）
--   begin;
--   drop trigger if exists quiz_runs_fill_pass_pct on public.quiz_runs;
--   drop trigger if exists quiz_sets_fill_kind     on public.quiz_sets;
--   drop function if exists app_hidden.quiz_runs_fill_pass_pct();
--   drop function if exists app_hidden.quiz_sets_fill_kind();
--   drop function if exists public.run_pass_stats(integer);
--   drop function if exists public.set_quiz_kind(uuid, text);
--   drop function if exists public.set_pass_pct(text, integer);
--   drop function if exists public.my_retests();
--   drop function if exists public.start_retest_run(uuid, text, integer);
--   drop function if exists public.retest_targets(text);
--   drop function if exists app_hidden.retest_states(text, uuid);
--   drop function if exists app_hidden.guess_quiz_kind(text);
--   -- 再テストの回（retest_of が入っている回）と、その提出は消さない。列を残せば、あとで読み直せる
--   -- 列（quiz_sets.kind_key／quiz_runs.pass_pct・retest_of・retest_exempt）と表 quiz_kinds は残してよい
--   commit;
-- =====================================================================
