-- =====================================================================
-- 権限を「できること」で持つ（1本目：足すだけ・何も締めない）        2026-11-21
--
-- ■ なぜ（docs/yakusoku.md 2章・docs/schema-plan.md 1章）
--   役職（先生／マスター）で分岐すると、兼務や異動のたびに合わなくなる。
--   各機能は「この操作ができるか」だけを聞き、役職はその束（ひな型）にする。
--   最初の束は3つ＝teacher（非常勤）／fulltime（常勤）／info_admin（情報管理者）。
--
-- ■ このファイルでやること
--   ① capabilities（できることの一覧）・cap_bundles（束）・staff_caps（人ごとの足し引き）
--   ② profiles.bundle（職員だけ。null なら role から決める）
--   ③ app_hidden.can(cap)   … 権限の判定（サーバー側）
--   ④ public.my_caps()      … 画面が出し分けに使う（★案内であって権限ではない）
--
-- ■ 🔴 今は誰の権限も変わらない
--   既存の is_teacher() / is_master() と、それを呼ぶポリシー・関数には触らない。
--   can() を呼ぶものは、まだ1つも無い。＝この SQL だけでは何も壊れず、何も締まらない。
--   既存の関数を can() に替えるのは、あとの SQL で1本ずつ（schema-plan 1-4）。
--   bundle が null の職員は role から決まる（teacher→teacher／master→fulltime）
--   ＝いまの職員は、何もしなくても今までどおりの範囲に入る。
--
-- ■ このファイルに入れていないもの
--   人ごとの足し引きを書く RPC（set_staff_cap）と、束を付け替える RPC。
--   どちらも「操作の記録」に1行残す決まりなので、記録の表を作る次の SQL に入れる。
--   それまで staff_caps は空のまま（＝束どおり）。情報管理者の印は、流したあとに手で1行入れる（末尾）。
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/capabilities_check.sql（最後に例外で止めて全部ロールバック）／get_advisors（WARN が1件増える＝my_caps）
-- =====================================================================

begin;

-- ① できることの一覧（固定。画面からは増やせない＝増やすときは SQL を足す）
create table if not exists public.capabilities (
  key   text primary key,
  label text not null,
  sort  integer not null default 0
);

create table if not exists public.cap_bundles (
  bundle  text not null,
  cap_key text not null references public.capabilities(key) on delete cascade,
  primary key (bundle, cap_key),
  constraint cap_bundles_bundle_check check (bundle in ('teacher', 'fulltime', 'info_admin'))
);

-- 人ごとの足し引き。束との差だけを持つ（granted=true＝足す／false＝外す）
create table if not exists public.staff_caps (
  profile_id uuid    not null references public.profiles(id) on delete cascade,
  cap_key    text    not null references public.capabilities(key) on delete cascade,
  granted    boolean not null,
  primary key (profile_id, cap_key)
);

-- ② 職員の束。null＝role から決める
alter table public.profiles add column if not exists bundle text;
alter table public.profiles drop constraint if exists profiles_bundle_check;
alter table public.profiles add  constraint profiles_bundle_check
  check (bundle is null or (role in ('teacher', 'master') and bundle in ('teacher', 'fulltime', 'info_admin')));

-- 中身（何度流しても同じになる）
insert into public.capabilities (key, label, sort) values
  ('quiz.run',           'テストを始める。自分が始めた回を閉じる・取り消す',  10),
  ('quiz.run.any',       '他の人が始めた回を閉じる・取り消す',                20),
  ('retest.run',         '再テストの一覧を見る。再テストを開く',              30),
  ('quiz.result.one',    '回を1つ開いて、名前と点数を見る',                   40),
  ('quiz.result.export', '結果をまとめて見る・書き出す',                      50),
  ('quiz.edit',          '問題の登録・編集・公開・削除',                      60),
  ('quiz.passline',      '合格の線を変える',                                  70),
  ('survey.manage',      'アンケートを作る。回を始める・閉じる',              80),
  ('survey.read',        'アンケートの回答と提出の状況を見る',                90),
  ('student.read',       '名簿と学生の詳細を見る',                           100),
  ('student.pwreset',    'パスワードを初期値に戻す',                         110),
  ('account.manage',     'アカウントの発行・停止・再開、卒業生への切り替え', 120),
  ('notice.send',        'お知らせを作る・出す',                             130),
  ('quiz.editlog.read',  '問題の変更の履歴を見る',                           140),
  ('audit.read',         '操作の記録を見る',                                 150),
  ('caps.manage',        '権限を変える',                                     160)
on conflict (key) do update set label = excluded.label, sort = excluded.sort;

insert into public.cap_bundles (bundle, cap_key)
select b.bundle, c.key
  from (values ('teacher'), ('fulltime'), ('info_admin')) as b(bundle)
  join public.capabilities c on
       -- 先生（非常勤）＝授業中に使う3つだけ
       (b.bundle = 'teacher'    and c.key in ('quiz.run', 'retest.run', 'quiz.result.one'))
       -- 常勤＝アカウントの管理・操作の記録・権限の変更を除く全部
    or (b.bundle = 'fulltime'   and c.key not in ('account.manage', 'audit.read', 'caps.manage'))
       -- 情報管理者＝全部
    or (b.bundle = 'info_admin')
on conflict do nothing;

-- 権限：表は RLS を有効にし、直接は誰も書けない
alter table public.capabilities enable row level security;
alter table public.cap_bundles  enable row level security;
alter table public.staff_caps   enable row level security;

-- ★表ごとに1行ずつ書く（tests/test_db_migrations.py が、表の名前ごとに anon からの revoke を探すため）
revoke all on table public.capabilities from anon;
revoke all on table public.cap_bundles  from anon;
revoke all on table public.staff_caps   from anon;
revoke insert, update, delete on table public.capabilities from authenticated;
revoke insert, update, delete on table public.cap_bundles  from authenticated;
revoke insert, update, delete on table public.staff_caps   from authenticated;
grant  select on table public.capabilities to authenticated;
grant  select on table public.cap_bundles  to authenticated;
grant  select on table public.staff_caps   to authenticated;

-- ③ 権限の判定。🔴 守っているのはこの関数（画面の出し分けではない）
--    職員で、（束に入っている または 足されている）かつ 外されていない
create or replace function app_hidden.can(p_cap text)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role in ('teacher', 'master')
       and not exists (select 1 from public.staff_caps s
                        where s.profile_id = p.id and s.cap_key = p_cap and s.granted = false)
       and (
            exists (select 1 from public.cap_bundles b
                     where b.cap_key = p_cap
                       and b.bundle = coalesce(p.bundle, case p.role when 'master' then 'fulltime' else 'teacher' end))
         or exists (select 1 from public.staff_caps s
                     where s.profile_id = p.id and s.cap_key = p_cap and s.granted = true)
       )
  )
$$;

revoke all     on function app_hidden.can(text) from public, anon, service_role;
grant  execute on function app_hidden.can(text) to authenticated;

-- 読めるのは：一覧＝職員全員／束と人ごとの足し引き＝「権限を変える」を持つ人だけ
drop policy if exists "staff read capabilities" on public.capabilities;
create policy "staff read capabilities"
  on public.capabilities for select to authenticated
  using (app_hidden.is_teacher());

drop policy if exists "caps manager read bundles" on public.cap_bundles;
create policy "caps manager read bundles"
  on public.cap_bundles for select to authenticated
  using (app_hidden.can('caps.manage'));

drop policy if exists "caps manager read staff caps" on public.staff_caps;
create policy "caps manager read staff caps"
  on public.staff_caps for select to authenticated
  using (app_hidden.can('caps.manage'));

-- ④ 画面が「どのボタンを出すか」を決めるための窓口。★案内であって権限ではない（my_role と同じ位置づけ）
create or replace function public.my_caps()
returns text[]
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(c.key order by c.sort), '{}')
    from public.capabilities c
   where app_hidden.can(c.key)
$$;

revoke all     on function public.my_caps() from public;
revoke execute on function public.my_caps() from anon;
grant  execute on function public.my_caps() to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   select bundle, count(*) from public.cap_bundles group by bundle order by 1;   -- teacher 3 / fulltime 13 / info_admin 16
--   tests/sql/capabilities_check.sql
--   py -X utf8 tests\test_security.py     ← 既存の権限が1つも変わっていないこと
--
-- 情報管理者の印（流したあと、きあが1人ぶんだけ手で入れる。ログインIDは実物に置き換える）
--   update public.profiles set bundle = 'info_admin' where student_no = '（マスターのログインID）' and role = 'master';
--
-- 巻き戻し（can() を呼ぶものがまだ無いので、順番を気にせず外せる。あとの SQL を流したあとは、そちらを先に戻す）
--   begin;
--   drop function if exists public.my_caps();
--   drop policy if exists "staff read capabilities"     on public.capabilities;
--   drop policy if exists "caps manager read bundles"   on public.cap_bundles;
--   drop policy if exists "caps manager read staff caps" on public.staff_caps;
--   drop function if exists app_hidden.can(text);
--   drop table if exists public.staff_caps;
--   drop table if exists public.cap_bundles;
--   drop table if exists public.capabilities;
--   alter table public.profiles drop constraint if exists profiles_bundle_check;
--   alter table public.profiles drop column if exists bundle;
--   commit;
-- =====================================================================
