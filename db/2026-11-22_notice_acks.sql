-- =====================================================================
-- はじめのお知らせ（個人情報のあつかい）を「読みました」の記録            2026-11-22
--
-- ■ なぜ
--   学校が学生の情報をどうあつかうか（保存先・見る人・AI の利用など）を、学生に母語で知らせる。
--   同意を取るものではなく、お知らせ。全員が読んで「よみました」を押す。
--   押したことを「だれが・いつ・どの版の・何語の文で」残す。
--   学生の画面は、ログインした直後に1回だけ出す。文の版を上げたときだけ、もう1回出る。
--   見本＝src/policy-preview.html
--
-- ■ このファイルでやること（足すだけ・何も締めない）
--   ① notice_versions … お知らせの版。SQL で入れる（画面からは増やせない）。文そのものは画面側に置く
--   ② notice_acks     … 「よみました」の記録。1人・1つの版に1行。直せない・消せない
--   ③ public.my_notice_status(p_key)            … 学生の画面が「出すかどうか」を決めるために呼ぶ
--   ④ public.ack_notice(p_key, p_version, p_lang) … 「よみました」。在籍中の学生だけ・いまの版だけ
--   ⑤ public.notice_unread(p_key, p_class)      … 職員が、クラスの「まだ読んでいない学生」を見る
--                                                 （「名簿と学生の詳細を見る」を持つ人だけ・開いたことは操作の記録に残る）
--
-- ■ 前提：db/2026-11-21_capabilities.sql・db/2026-11-22_audit_log.sql・db/2026-11-22_account_status.sql を流してあること
--
-- ■ 🔴 版を上げるとき
--   画面側の文を直す → この表に次の版を1行足す SQL を db/ に置く → 画面を先に出してから流す。
--   版を上げると、在籍中の学生の全員に、もう1回出る。誤字の直しでは上げない。
--
-- ■ 🔴 記録に入れるもの
--   学生の id・お知らせの鍵・版・言語・日時だけ。文の本文は入れない。
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/notice_acks_check.sql（最後に例外で止めて全部ロールバック）／get_advisors（WARN が3件増える＝下の public の3本）
-- =====================================================================

begin;

-- ① お知らせの版
create table if not exists public.notice_versions (
  notice_key   text        not null,
  version      integer     not null check (version >= 1),
  published_at timestamptz not null default now(),
  note         text,                               -- 何を変えたか（職員向けの1行。本文は入れない）
  primary key (notice_key, version)
);

alter table public.notice_versions enable row level security;

-- 版の番号は、ログイン中の人ならだれでも読める（本文は入っていない）。
-- 🔴 insert / update / delete のポリシーは作らない＝版は SQL でだけ足す
drop policy if exists "signed-in users read notice versions" on public.notice_versions;
create policy "signed-in users read notice versions"
  on public.notice_versions for select to authenticated
  using (true);

revoke all on table public.notice_versions from anon;
revoke insert, update, delete on table public.notice_versions from authenticated;
grant  select on table public.notice_versions to authenticated;

insert into public.notice_versions (notice_key, version, note)
values ('student_privacy', 1, 'はじめの版')
on conflict (notice_key, version) do nothing;

-- ② 「よみました」の記録
create table if not exists public.notice_acks (
  id         bigint generated always as identity primary key,
  student_id uuid        not null,                 -- ★あえて外部キーを張らない（アカウントを消しても、読んだ記録は残す）
  notice_key text        not null,
  version    integer     not null,
  lang       text        not null,                 -- そのとき画面に出ていた言語
  at         timestamptz not null default now(),
  constraint notice_acks_one_per_version unique (student_id, notice_key, version),
  constraint notice_acks_version_fkey foreign key (notice_key, version) references public.notice_versions (notice_key, version),
  constraint notice_acks_lang_check check (lang in ('ja', 'en', 'zh', 'ne', 'my', 'si', 'bn'))
);
create index if not exists notice_acks_key_idx on public.notice_acks (notice_key, version);

alter table public.notice_acks enable row level security;

-- 読めるのは、本人と「名簿と学生の詳細を見る」を持つ職員。
-- 🔴 insert / update / delete のポリシーは作らない＝書けるのは ack_notice だけ。直せない・消せない
drop policy if exists "student reads own notice acks" on public.notice_acks;
create policy "student reads own notice acks"
  on public.notice_acks for select to authenticated
  using (student_id = auth.uid() or app_hidden.can('student.read'));

revoke all on table public.notice_acks from anon;
revoke insert, update, delete on table public.notice_acks from authenticated;
grant  select on table public.notice_acks to authenticated;

-- ③ 学生の画面が「出すかどうか」を決めるために呼ぶ。★案内であって権限ではない
--    required＝在籍中の学生で、いまの版をまだ読んでいない
create or replace function public.my_notice_status(p_key text default 'student_privacy')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_version integer;
  v_at      timestamptz;
  v_student boolean;
  v_before  boolean;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;
  select max(version) into v_version from public.notice_versions where notice_key = p_key;
  if v_version is null then
    raise exception 'そのお知らせはありません' using errcode = '22023';
  end if;
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'student' and status = 'active') into v_student;
  select at into v_at from public.notice_acks where student_id = auth.uid() and notice_key = p_key and version = v_version;
  select exists (select 1 from public.notice_acks where student_id = auth.uid() and notice_key = p_key and version < v_version) into v_before;
  return jsonb_build_object(
    'key', p_key, 'version', v_version,
    'read', v_at is not null, 'read_at', v_at,
    'read_before', v_before,
    'required', v_student and v_at is null);
end $$;

revoke all     on function public.my_notice_status(text) from public;
revoke execute on function public.my_notice_status(text) from anon;
grant  execute on function public.my_notice_status(text) to authenticated;

-- ④ 「よみました」。在籍中の学生だけ・いまの版だけ。2回押しても1行のまま（はじめに押した日時を返す）
create or replace function public.ack_notice(p_key text, p_version integer, p_lang text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version integer;
  v_at      timestamptz;
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid() and role = 'student' and status = 'active') then
    raise exception '在籍中の学生だけが押せます' using errcode = '42501';
  end if;
  select max(version) into v_version from public.notice_versions where notice_key = p_key;
  if v_version is null then
    raise exception 'そのお知らせはありません' using errcode = '22023';
  end if;
  -- 古い画面を開いたまま押したとき。新しい文を読んでいないので、受け付けない
  if p_version is distinct from v_version then
    raise exception 'お知らせが新しくなりました。読み込み直してください' using errcode = 'PT409';
  end if;
  if p_lang is null or p_lang not in ('ja', 'en', 'zh', 'ne', 'my', 'si', 'bn') then
    raise exception '言語の指定が決まりにありません' using errcode = '22023';
  end if;
  insert into public.notice_acks (student_id, notice_key, version, lang)
  values (auth.uid(), p_key, v_version, p_lang)
  on conflict on constraint notice_acks_one_per_version do nothing;
  select at into v_at from public.notice_acks where student_id = auth.uid() and notice_key = p_key and version = v_version;
  return v_at;
end $$;

revoke all     on function public.ack_notice(text, integer, text) from public;
revoke execute on function public.ack_notice(text, integer, text) from anon;
grant  execute on function public.ack_notice(text, integer, text) to authenticated;

-- ⑤ 職員が、クラスの「まだ読んでいない学生」を見る。
--    ・「名簿と学生の詳細を見る」を持つ人だけ　・在籍中の学生だけを数える
--    ・名前が並ぶので、開いたことを操作の記録に残す（同じ人・同じクラスは10分に1行まで。記録には人数だけ）
create or replace function public.notice_unread(p_key text, p_class text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version integer;
  v_target  integer;
  v_unread  jsonb;
  v_n       integer;
begin
  if auth.uid() is null or not app_hidden.can('student.read') then
    raise exception '名簿を見られる人だけが開けます' using errcode = '42501';
  end if;
  if coalesce(btrim(p_class), '') = '' or length(p_class) > 80 then
    raise exception 'クラスを選んでください' using errcode = '22023';
  end if;
  select max(version) into v_version from public.notice_versions where notice_key = p_key;
  if v_version is null then
    raise exception 'そのお知らせはありません' using errcode = '22023';
  end if;

  select count(*) into v_target
    from public.profiles p where p.role = 'student' and p.status = 'active' and p.class_name = p_class;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'student_no', p.student_no, 'name', p.display_name) order by p.student_no), '[]'::jsonb),
         count(*)
    into v_unread, v_n
    from public.profiles p
   where p.role = 'student' and p.status = 'active' and p.class_name = p_class
     and not exists (select 1 from public.notice_acks a
                      where a.student_id = p.id and a.notice_key = p_key and a.version = v_version);

  if not exists (select 1 from public.audit_log l
                  where l.actor_id = auth.uid() and l.action = 'view.notice_unread'
                    and l.target_type = 'class' and l.target_id = p_class
                    and l.at > now() - interval '10 minutes') then
    perform app_hidden.audit('view.notice_unread', 'class', p_class,
                             jsonb_build_object('notice', p_key, 'version', v_version, 'unread', v_n));
  end if;

  return jsonb_build_object('key', p_key, 'version', v_version,
                            'target', v_target, 'read', v_target - v_n, 'unread', v_unread);
end $$;

revoke all     on function public.notice_unread(text, text) from public;
revoke execute on function public.notice_unread(text, text) from anon;
grant  execute on function public.notice_unread(text, text) to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   tests/sql/notice_acks_check.sql
--   py -X utf8 tests\test_security.py     ← 既存の権限が1つも変わっていないこと
--
-- 巻き戻し
--   begin;
--   drop function if exists public.notice_unread(text, text);
--   drop function if exists public.ack_notice(text, integer, text);
--   drop function if exists public.my_notice_status(text);
--   drop policy if exists "student reads own notice acks" on public.notice_acks;
--   drop table if exists public.notice_acks;       -- ★読んだ記録そのものが消える。消す前に書き出すこと
--   drop policy if exists "signed-in users read notice versions" on public.notice_versions;
--   drop table if exists public.notice_versions;
--   commit;
-- =====================================================================
