-- パスワードを「はじめに もどす」と、初期パスワードのままかを本人が知る口（2026-11-20）
--
-- ★決めたこと（CLAUDE.md「認証・アカウント」の 11/18 きあ決定どおり）
--   ・初期パスワード＝「scg＋学籍番号」。戻す先もこれ
--   ・戻せるのは マスター（app_hidden.is_master()）だけ。戻せる相手は role='student' だけ
--     （職員のパスワードをこの口で戻させない）
--   ・戻したら、その学生のログイン中の端末をすべてログアウトさせる（auth.sessions を消す）
--     ＝戻す前にだれかが入っていても、そのままにならない
--   ・だれが・いつ・だれを戻したかを password_reset_log に残す。直せない・消せない（表へ直接書かせない）
--   ・「次のログインで決め直し」は、**状態の旗を持たずに**パスワードそのもので判定する：
--     my_password_is_initial() ＝ いまのパスワードが「scg＋学籍番号」と一致するか（本人の分だけ・真偽だけ返す）
--     → 新しく配ったアカウントも、戻したアカウントも、同じ線で決め直しの画面が出る
--     → デモアカウント（初期パスワードでない）は今までどおり＝既存の検査を壊さない
--
-- 🔴 service_role はクライアントに置かない。書き換えはこの SECURITY DEFINER の RPC の中だけ。
-- 🔴 戻すのは本人が目の前にいるときだけ（運用ルール。実装では縛らない）
--
-- 流したあと: py -X utf8 -m unittest discover -s tests -p "test_db_migrations.py" ／ tests/sql/password_reset_check.sql（ロールバックで検査）
--             get_advisors（WARN が2件増える＝下の2 RPC が authenticated に開いている。意図どおり）
begin;

create table if not exists public.password_reset_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid        not null,          -- 戻した職員
  student_id  uuid        not null,          -- ★あえて外部キーを張らない（アカウントを消しても履歴は残す）
  student_no  text        not null
);
create index if not exists password_reset_log_at_idx      on public.password_reset_log (at desc);
create index if not exists password_reset_log_student_idx on public.password_reset_log (student_id, at desc);

alter table public.password_reset_log enable row level security;

-- 職員は読める。書くのは下の RPC だけ（insert/update/delete のポリシーを作らない＝誰にも許されない）
drop policy if exists "staff read password reset log" on public.password_reset_log;
create policy "staff read password reset log"
  on public.password_reset_log for select to authenticated
  using (app_hidden.is_teacher());

revoke all on table public.password_reset_log from anon;
revoke insert, update, delete on table public.password_reset_log from authenticated;
grant  select on table public.password_reset_log to authenticated;


-- マスターが学生のパスワードを「scg＋学籍番号」に戻す
create or replace function public.reset_student_password(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_no  text;
  v_n   int;
  v_at  timestamptz := now();
begin
  if auth.uid() is null or not app_hidden.is_master() then
    raise exception 'マスターだけが パスワードを もどせます' using errcode = '42501';
  end if;

  select p.student_no into v_no
    from public.profiles p
   where p.id = p_student_id and p.role = 'student';
  if v_no is null or btrim(v_no) = '' then
    raise exception '学生が見つかりません' using errcode = 'P0002';
  end if;

  update auth.users u
     set encrypted_password = extensions.crypt('scg' || lower(btrim(v_no)), extensions.gen_salt('bf', 10)),
         updated_at = v_at
   where u.id = p_student_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'ログイン用のアカウントが見つかりません' using errcode = 'P0002';
  end if;

  -- ログイン中の端末をすべて切る（refresh_tokens は sessions に付いて消える）
  delete from auth.sessions s where s.user_id = p_student_id;
  delete from auth.refresh_tokens r where r.user_id = p_student_id::text;

  insert into public.password_reset_log (at, actor_id, student_id, student_no)
  values (v_at, auth.uid(), p_student_id, v_no);

  return jsonb_build_object('student_no', v_no, 'reset_at', v_at);
end;
$$;

revoke all on function public.reset_student_password(uuid) from public;
revoke execute on function public.reset_student_password(uuid) from anon;
grant execute on function public.reset_student_password(uuid) to authenticated;


-- 本人のパスワードが、いま初期パスワード（scg＋学籍番号）のままか。真偽だけ返す
create or replace function public.my_password_is_initial()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_no   text;
  v_hash text;
begin
  if auth.uid() is null then return false; end if;
  select p.student_no into v_no from public.profiles p where p.id = auth.uid() and p.role = 'student';
  if v_no is null then return false; end if;   -- 職員は対象外
  select u.encrypted_password into v_hash from auth.users u where u.id = auth.uid();
  if v_hash is null or v_hash = '' then return false; end if;
  return extensions.crypt('scg' || lower(btrim(v_no)), v_hash) = v_hash;
end;
$$;

revoke all on function public.my_password_is_initial() from public;
revoke execute on function public.my_password_is_initial() from anon;
grant execute on function public.my_password_is_initial() to authenticated;

commit;

-- 巻き戻し:
--   drop function if exists public.my_password_is_initial();
--   drop function if exists public.reset_student_password(uuid);
--   drop table if exists public.password_reset_log;   -- ★履歴が消える。消す前にきあに確認
