-- =====================================================================
-- 操作の記録を1つの表に（2本目：足すだけ・何も締めない）              2026-11-22
--
-- ■ なぜ（docs/yakusoku.md 3章・docs/schema-plan.md 2章）
--   記録の残し方が機能ごとにばらばらだと、あとから「だれがいつ何をしたか」を追えない。
--   全機能が同じ形（だれが・どの役割で・いつ・何を・どれに）で、1つの表に書く。
--   残すのは、書き換えの全部＋「学生の名前が並ぶ画面を開いた」こと。
--
-- ■ このファイルでやること
--   ① audit_log（操作の記録）。読めるのは「操作の記録を見る」を持つ人だけ。直せない・消せない
--   ② app_hidden.audit(...)      … ほかの RPC の中から呼ぶ（書き換えの記録）
--   ③ public.log_view(...)       … 画面が「名前の並ぶ画面を開いた」ときに呼ぶ（職員だけ・10分に1行まで）
--   ④ public.set_staff_cap(...)  … 人ごとの足し引き（「権限を変える」を持つ人だけ・承認者を書く・記録に残る）
--   ⑤ public.set_staff_bundle(...) … 束の付け替え（同上）
--
-- ■ 前提：db/2026-11-21_capabilities.sql を先に流してあること（app_hidden.can を使う）
--
-- ■ 🔴 今は誰の権限も変わらない
--   既存の関数・ポリシーには触らない。既存の quiz_edit_log / password_reset_log も、そのまま。
--   新しい機能はこの表に書く。古い2つを寄せるのは、あとで。
--
-- ■ 🔴 記録に入れてよいもの
--   対象の id・件数・種類・できることの鍵・承認者（職員）の名前まで。
--   設問の本文・回答の中身・学生の氏名や学籍番号は入れない。
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/audit_log_check.sql（最後に例外で止めて全部ロールバック）／get_advisors（WARN が3件増える＝下の public の3本）
-- =====================================================================

begin;

-- ① 操作の記録
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid        not null,          -- ★あえて外部キーを張らない（アカウントを消しても記録は残す）
  actor_role  text        not null,          -- そのときの束（teacher / fulltime / info_admin）
  action      text        not null,          -- 何を。名前は docs/schema-plan.md の付録に足してから使う
  target_type text,                          -- どれに（quiz_run / student / class / staff など）
  target_id   text,                          -- その id（クラスならクラス名）
  detail      jsonb       not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx     on public.audit_log (at desc);
create index if not exists audit_log_actor_idx  on public.audit_log (actor_id, at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id, at desc);

alter table public.audit_log enable row level security;

-- 読めるのは「操作の記録を見る」を持つ人だけ。
-- 🔴 insert / update / delete のポリシーは作らない＝誰にも許されない（直せる記録は記録ではない）
drop policy if exists "audit readers read audit log" on public.audit_log;
create policy "audit readers read audit log"
  on public.audit_log for select to authenticated
  using (app_hidden.can('audit.read'));

revoke all on table public.audit_log from anon;
revoke insert, update, delete on table public.audit_log from authenticated;
grant  select on table public.audit_log to authenticated;

-- ② 書き換えの記録。ほかの SECURITY DEFINER の RPC の中からだけ呼ぶ
--    ★authenticated にも execute を与えない（app_hidden は API に出ていないが、念のため二重に閉じる）
create or replace function app_hidden.audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception '記録を書けるのはログイン中の操作だけです' using errcode = '42501';
  end if;
  select coalesce(p.bundle, case p.role when 'master' then 'fulltime' when 'teacher' then 'teacher' else p.role end)
    into v_role from public.profiles p where p.id = auth.uid();
  insert into public.audit_log (actor_id, actor_role, action, target_type, target_id, detail)
  values (auth.uid(), coalesce(v_role, 'unknown'), p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
end $$;

revoke all on function app_hidden.audit(text, text, text, jsonb) from public, anon, authenticated, service_role;

-- ③ 画面が「学生の名前が並ぶ画面を開いた」ときに呼ぶ
--    ・職員だけ　・画面の名前は決まったものだけ　・同じ人・同じ画面・同じ対象は10分に1行まで
create or replace function public.log_view(p_screen text, p_target_type text default null, p_target_id text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  if auth.uid() is null or not app_hidden.is_teacher() then
    raise exception '職員だけが呼べます' using errcode = '42501';
  end if;
  if p_screen is null or p_screen not in ('retest_list', 'run_result', 'student_list', 'student_detail', 'survey_result') then
    raise exception '画面の名前が決まりにありません' using errcode = '22023';
  end if;
  if length(coalesce(p_target_type, '')) > 40 or length(coalesce(p_target_id, '')) > 80 then
    raise exception '対象の指定が長すぎます' using errcode = '22023';
  end if;
  v_action := 'view.' || p_screen;
  if exists (select 1 from public.audit_log a
              where a.actor_id = auth.uid() and a.action = v_action
                and a.target_type is not distinct from p_target_type
                and a.target_id   is not distinct from p_target_id
                and a.at > now() - interval '10 minutes') then
    return;
  end if;
  perform app_hidden.audit(v_action, p_target_type, p_target_id, '{}'::jsonb);
end $$;

revoke all     on function public.log_view(text, text, text) from public;
revoke execute on function public.log_view(text, text, text) from anon;
grant  execute on function public.log_view(text, text, text) to authenticated;

-- ④ 人ごとの足し引き。p_granted＝true 足す／false 外す／null 束どおりに戻す
create or replace function public.set_staff_cap(p_profile uuid, p_cap text, p_granted boolean, p_approver text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not app_hidden.can('caps.manage') then
    raise exception '権限を変えられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if coalesce(btrim(p_approver), '') = '' or length(p_approver) > 60 then
    raise exception '承認者を書いてください' using errcode = '22023';
  end if;
  if not exists (select 1 from public.capabilities where key = p_cap) then
    raise exception 'そのできることは一覧にありません' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and role in ('teacher', 'master')) then
    raise exception '相手は職員だけです' using errcode = '22023';
  end if;
  -- ★自分の「権限を変える」は自分で動かせない（うっかり外して、だれも直せなくなるのを防ぐ）
  if p_profile = auth.uid() and p_cap = 'caps.manage' then
    raise exception '自分の「権限を変える」は、自分では変えられません' using errcode = '22023';
  end if;

  if p_granted is null then
    delete from public.staff_caps where profile_id = p_profile and cap_key = p_cap;
  else
    insert into public.staff_caps (profile_id, cap_key, granted) values (p_profile, p_cap, p_granted)
    on conflict (profile_id, cap_key) do update set granted = excluded.granted;
  end if;

  perform app_hidden.audit('caps.set', 'staff', p_profile::text,
                           jsonb_build_object('cap', p_cap, 'granted', p_granted, 'approver', btrim(p_approver)));
end $$;

revoke all     on function public.set_staff_cap(uuid, text, boolean, text) from public;
revoke execute on function public.set_staff_cap(uuid, text, boolean, text) from anon;
grant  execute on function public.set_staff_cap(uuid, text, boolean, text) to authenticated;

-- ⑤ 束の付け替え。p_bundle＝null なら role から決まる束に戻す
create or replace function public.set_staff_bundle(p_profile uuid, p_bundle text, p_approver text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before text;
begin
  if auth.uid() is null or not app_hidden.can('caps.manage') then
    raise exception '権限を変えられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if coalesce(btrim(p_approver), '') = '' or length(p_approver) > 60 then
    raise exception '承認者を書いてください' using errcode = '22023';
  end if;
  if p_bundle is not null and p_bundle not in ('teacher', 'fulltime', 'info_admin') then
    raise exception 'その束はありません' using errcode = '22023';
  end if;
  if p_profile = auth.uid() then
    raise exception '自分の束は、自分では変えられません' using errcode = '22023';
  end if;
  select bundle into v_before from public.profiles where id = p_profile and role in ('teacher', 'master');
  if not found then
    raise exception '相手は職員だけです' using errcode = '22023';
  end if;

  update public.profiles set bundle = p_bundle where id = p_profile;

  perform app_hidden.audit('caps.bundle.set', 'staff', p_profile::text,
                           jsonb_build_object('before', v_before, 'after', p_bundle, 'approver', btrim(p_approver)));
end $$;

revoke all     on function public.set_staff_bundle(uuid, text, text) from public;
revoke execute on function public.set_staff_bundle(uuid, text, text) from anon;
grant  execute on function public.set_staff_bundle(uuid, text, text) to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   tests/sql/audit_log_check.sql
--   py -X utf8 tests\test_security.py     ← 既存の権限が1つも変わっていないこと
--
-- 巻き戻し（この表に書く機能をあとで足したら、そちらを先に戻す）
--   begin;
--   drop function if exists public.set_staff_bundle(uuid, text, text);
--   drop function if exists public.set_staff_cap(uuid, text, boolean, text);
--   drop function if exists public.log_view(text, text, text);
--   drop function if exists app_hidden.audit(text, text, text, jsonb);
--   drop policy if exists "audit readers read audit log" on public.audit_log;
--   drop table if exists public.audit_log;      -- ★記録そのものが消える。消す前に書き出すこと
--   commit;
-- =====================================================================
