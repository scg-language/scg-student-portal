-- =====================================================================
-- アカウントの状態（在籍・卒業生・退学）と担任（3本目）              2026-11-22
--
-- ■ なぜ（docs/yakusoku.md 4章・docs/schema-plan.md 3章）
--   卒業は「停止」ではない。卒業生は、自分の記録を読めるが、受ける・出すはできない。
--   退学は全部止める（ログインできない）。どちらも、回答と点数は残す。
--   担任は学生ごとに1人持つ（お知らせ・アンケート・相談の宛先に使う）。
--
-- ■ このファイルでやること
--   ① profiles に status / status_changed_at / status_changed_by / graduated_on / homeroom_id
--   ② app_hidden.normalize_student_no()   … 学籍番号の形を決める1か所（全角・ハイフンを取って7桁）
--   ③ 在籍でない学生の「書く」を止めるトリガ（attempts / attempt_drafts / attempt_focus / survey_responses）
--   ④ my_open_runs / my_open_survey_rounds … 在籍でない学生には空を返す
--   ⑤ public.set_account_status(...)       … 状態を切り替える（「アカウントの管理」を持つ人だけ・記録に残る）
--   ⑥ public.set_homeroom(...) / public.my_homeroom_name() … 担任を付ける／学生が自分の担任の名前を読む
--
-- ■ 前提：db/2026-11-21_capabilities.sql と db/2026-11-22_audit_log.sql を先に流してあること
--
-- ■ 🔴 1・2本目と違い、この SQL は「今ある動き」に触る
--   ・学生が書く4つの表にトリガを足す。status が 'active' の学生は、今までどおり通る（既定値が 'active'）
--   ・my_open_runs / my_open_survey_rounds を置き換える。差は「在籍でない学生には空」の1条件だけ（★2026-11-22 の印）
--   ・submit_attempt / save_draft / record_away の中身には触らない（書き換えず、表の側で止める）
--   流した直後は全員が 'active' ＝誰の動きも変わらない。変わるのは、状態を切り替えた学生だけ
--
-- ■ 退学で止まるもの／止まらないもの
--   止まる：新しいログイン（auth.users.banned_until）／開いていた端末（セッションを消す）／書くこと（トリガ）
--   ⚠ すでに発行された通行証は、切れるまで（最長1時間）読むことだけはできる。退学は急ぎの操作ではないので許す
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/account_status_check.sql（最後に例外で止めて全部ロールバック）／get_advisors（WARN が3件増える）
-- =====================================================================

begin;

-- ① 状態と担任
alter table public.profiles add column if not exists status            text not null default 'active';
alter table public.profiles add column if not exists status_changed_at timestamptz;
alter table public.profiles add column if not exists status_changed_by uuid;
alter table public.profiles add column if not exists graduated_on      date;
alter table public.profiles add column if not exists homeroom_id       uuid references public.profiles(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add  constraint profiles_status_check
  check (status in ('active', 'graduated', 'withdrawn') and (role = 'student' or status = 'active'));
alter table public.profiles drop constraint if exists profiles_homeroom_check;
alter table public.profiles add  constraint profiles_homeroom_check
  check (homeroom_id is null or role = 'student');

create index if not exists profiles_homeroom_idx on public.profiles (homeroom_id) where homeroom_id is not null;

-- ② 学籍番号の形。🔴 決まりはここ1か所（7桁だけ。全角の数字・ハイフン・空白は取ってから見る）
create or replace function app_hidden.normalize_student_no(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when s ~ '^[0-9]{7}$' then s else null end
    from (select regexp_replace(translate(coalesce(p_raw, ''), '０１２３４５６７８９', '0123456789'),
                                '[-‐‑–—―ー－−\s　]', '', 'g') as s) x
$$;

revoke all     on function app_hidden.normalize_student_no(text) from public, anon, service_role;
grant  execute on function app_hidden.normalize_student_no(text) to authenticated;

-- ③ 在籍でない学生の「書く」を止める
--    ★関数（submit_attempt など）を書き換えず、表の側で止める＝学生が書く口をあとで足しても、同じ表なら効く
create or replace function app_hidden.block_inactive_student_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.profiles p
              where p.id = new.student_id and p.role = 'student' and p.status <> 'active') then
    raise exception 'このアカウントでは、受ける・出すことはできません' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function app_hidden.block_inactive_student_write() from public, anon, authenticated, service_role;

drop trigger if exists block_inactive_student_write on public.attempts;
create trigger block_inactive_student_write before insert or update on public.attempts
  for each row execute function app_hidden.block_inactive_student_write();
drop trigger if exists block_inactive_student_write on public.attempt_drafts;
create trigger block_inactive_student_write before insert or update on public.attempt_drafts
  for each row execute function app_hidden.block_inactive_student_write();
drop trigger if exists block_inactive_student_write on public.attempt_focus;
create trigger block_inactive_student_write before insert or update on public.attempt_focus
  for each row execute function app_hidden.block_inactive_student_write();
drop trigger if exists block_inactive_student_write on public.survey_responses;
create trigger block_inactive_student_write before insert or update on public.survey_responses
  for each row execute function app_hidden.block_inactive_student_write();

-- ④ 開いている回の一覧。差は末尾の1条件だけ（★2026-11-22）
create or replace function public.my_open_runs()
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id', r.id, 'quiz_set_id', r.quiz_set_id,
           'title', s.title, 'lesson', s.lesson, 'closes_at', r.closes_at)
         order by r.closes_at), '[]'::jsonb)
    from public.quiz_runs r
    join public.quiz_sets s on s.id = r.quiz_set_id
   where auth.uid() is not null
     and not r.is_void
     and r.opens_at <= now() and now() < r.closes_at
     and (
       (coalesce(array_length(r.class_names, 1), 0) = 0
        and coalesce(array_length(r.student_ids, 1), 0) = 0)
       or auth.uid() = any (r.student_ids)
       or (select class_name from public.profiles where id = auth.uid()) = any (r.class_names)
     )
     -- ★2026-11-22：在籍でない学生（卒業生・退学）には出さない
     and not exists (select 1 from public.profiles me
                      where me.id = auth.uid() and me.role = 'student' and me.status <> 'active')
$$;

revoke all     on function public.my_open_runs() from public;
revoke execute on function public.my_open_runs() from anon;
grant  execute on function public.my_open_runs() to authenticated;

create or replace function public.my_open_survey_rounds()
returns jsonb
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'round_id', r.id, 'survey_key', r.survey_key, 'title', r.title,
           'opens_at', r.opens_at, 'closes_at', r.closes_at)
         order by r.opens_at), '[]'::jsonb)
    from public.survey_rounds r
   where auth.uid() is not null
     and not r.is_void
     and r.opens_at <= now()
     and (r.closes_at is null or now() < r.closes_at)
     and (
       (coalesce(array_length(r.class_names, 1), 0) = 0
        and coalesce(array_length(r.student_ids, 1), 0) = 0)
       or auth.uid() = any (r.student_ids)
       or (select class_name from public.profiles where id = auth.uid()) = any (r.class_names)
     )
     -- ★2026-11-22：在籍でない学生（卒業生・退学）には出さない
     and not exists (select 1 from public.profiles me
                      where me.id = auth.uid() and me.role = 'student' and me.status <> 'active')
$$;

revoke all     on function public.my_open_survey_rounds() from public;
revoke execute on function public.my_open_survey_rounds() from anon;
grant  execute on function public.my_open_survey_rounds() to authenticated;

-- ⑤ 状態を切り替える。p_status＝'active'（在籍）／'graduated'（卒業生）／'withdrawn'（退学）
create or replace function public.set_account_status(p_student uuid, p_status text, p_graduated_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before text;
begin
  if auth.uid() is null or not app_hidden.can('account.manage') then
    raise exception 'アカウントの状態を変えられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'graduated', 'withdrawn') then
    raise exception 'その状態はありません' using errcode = '22023';
  end if;
  select status into v_before from public.profiles where id = p_student and role = 'student';
  if not found then
    raise exception '学生が見つかりません' using errcode = 'P0002';
  end if;

  update public.profiles
     set status            = p_status,
         status_changed_at = now(),
         status_changed_by = auth.uid(),
         graduated_on      = case when p_status = 'graduated' then coalesce(p_graduated_on, graduated_on, current_date) else null end
   where id = p_student;

  -- 退学＝ログインを止め、開いている端末を切る。それ以外＝止めていたら戻す
  if p_status = 'withdrawn' then
    update auth.users set banned_until = now() + interval '100 years', updated_at = now() where id = p_student;
    delete from auth.sessions       where user_id = p_student;
    delete from auth.refresh_tokens where user_id = p_student::text;
  else
    update auth.users set banned_until = null, updated_at = now() where id = p_student and banned_until is not null;
  end if;

  perform app_hidden.audit('account.status.set', 'student', p_student::text,
                           jsonb_build_object('before', v_before, 'after', p_status));
  return jsonb_build_object('before', v_before, 'after', p_status);
end $$;

revoke all     on function public.set_account_status(uuid, text, date) from public;
revoke execute on function public.set_account_status(uuid, text, date) from anon;
grant  execute on function public.set_account_status(uuid, text, date) to authenticated;

-- ⑥ 担任を付ける。p_staff＝null なら外す。まとめて付けられる（1回500人まで）
create or replace function public.set_homeroom(p_student_ids uuid[], p_staff uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not app_hidden.can('account.manage') then
    raise exception '担任を変えられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_student_ids is null or coalesce(array_length(p_student_ids, 1), 0) = 0 or array_length(p_student_ids, 1) > 500 then
    raise exception '学生は1人から500人までで指定してください' using errcode = '22023';
  end if;
  -- 担任になれるのは常勤（マスターのアカウント）だけ
  if p_staff is not null and not exists (select 1 from public.profiles where id = p_staff and role = 'master') then
    raise exception '担任にできるのは常勤の職員だけです' using errcode = '22023';
  end if;

  update public.profiles set homeroom_id = p_staff
   where id = any (p_student_ids) and role = 'student';
  get diagnostics v_n = row_count;

  -- 記録には人数だけ（学生の id の一覧は入れない）
  perform app_hidden.audit('homeroom.set', 'staff', coalesce(p_staff::text, 'none'), jsonb_build_object('students', v_n));
  return v_n;
end $$;

revoke all     on function public.set_homeroom(uuid[], uuid) from public;
revoke execute on function public.set_homeroom(uuid[], uuid) from anon;
grant  execute on function public.set_homeroom(uuid[], uuid) to authenticated;

-- 学生が、自分の担任の名前だけを読む（職員の名簿は学生から読めないため、この窓口を通す）
create or replace function public.my_homeroom_name()
returns text
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select h.display_name
    from public.profiles me
    join public.profiles h on h.id = me.homeroom_id
   where me.id = auth.uid()
$$;

revoke all     on function public.my_homeroom_name() from public;
revoke execute on function public.my_homeroom_name() from anon;
grant  execute on function public.my_homeroom_name() to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   select status, count(*) from public.profiles group by status;      -- 全員 active のはず
--   tests/sql/account_status_check.sql
--   py -X utf8 tests\test_security.py ／ tests\test_drafts.py --live ／ tests\test_choices.py --live   ← 学生が今までどおり書けること
--
-- 巻き戻し（🔴 この順で。トリガを先に外す＝外す前に関数を消すと、学生の書き込みが全部落ちる）
--   begin;
--   drop trigger if exists block_inactive_student_write on public.attempts;
--   drop trigger if exists block_inactive_student_write on public.attempt_drafts;
--   drop trigger if exists block_inactive_student_write on public.attempt_focus;
--   drop trigger if exists block_inactive_student_write on public.survey_responses;
--   drop function if exists app_hidden.block_inactive_student_write();
--   drop function if exists public.my_homeroom_name();
--   drop function if exists public.set_homeroom(uuid[], uuid);
--   drop function if exists public.set_account_status(uuid, text, date);
--   drop function if exists app_hidden.normalize_student_no(text);
--   -- my_open_runs / my_open_survey_rounds は、★2026-11-22 の3行を消した形で create or replace し直す
--   -- 退学にした学生がいれば、先にログインを戻す： update auth.users set banned_until = null where id in (select id from public.profiles where status = 'withdrawn');
--   alter table public.profiles drop constraint if exists profiles_homeroom_check;
--   alter table public.profiles drop constraint if exists profiles_status_check;
--   -- 列（status・status_changed_at・status_changed_by・graduated_on・homeroom_id）は残してよい。外すなら、中身を書き出してから
--   commit;
-- =====================================================================
