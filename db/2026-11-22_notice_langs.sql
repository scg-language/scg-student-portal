-- =====================================================================
-- 「よみました」の記録：言語にベトナム語とウズベク語を足す                 2026-11-22
--
-- ■ なぜ
--   学生の言語は9つ（日本語・英語・中国語・ネパール語・ミャンマー語・シンハラ語・ベンガル語・ベトナム語・ウズベク語）。
--   db/2026-11-22_notice_acks.sql は7つしか受け付けない形だった。
--
-- ■ このファイルでやること（受け付ける言語を広げるだけ。狭めない）
--   ① notice_acks の言語の決まりを、9つに付け替える
--   ② public.ack_notice の言語の検査を、9つにする（ほかは同じ）
--
-- ■ 前提：db/2026-11-22_notice_acks.sql を流してあること
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/notice_acks_check.sql（最後に例外で止めて全部ロールバック）
-- =====================================================================

begin;

-- ① 言語の決まり（広げるだけなので、いまある行はそのまま通る）
alter table public.notice_acks drop constraint if exists notice_acks_lang_check;
alter table public.notice_acks add constraint notice_acks_lang_check
  check (lang in ('ja', 'en', 'zh', 'ne', 'my', 'si', 'bn', 'vi', 'uz'));

-- ② 「よみました」。在籍中の学生だけ・いまの版だけ。2回押しても1行のまま（はじめに押した日時を返す）
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
  if p_lang is null or p_lang not in ('ja', 'en', 'zh', 'ne', 'my', 'si', 'bn', 'vi', 'uz') then
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

commit;

-- =====================================================================
-- 巻き戻し（★ベトナム語・ウズベク語で押した行があると、古い決まりには戻せない。先に件数を確かめること）
--   begin;
--   alter table public.notice_acks drop constraint if exists notice_acks_lang_check;
--   alter table public.notice_acks add constraint notice_acks_lang_check
--     check (lang in ('ja', 'en', 'zh', 'ne', 'my', 'si', 'bn'));
--   -- ack_notice は db/2026-11-22_notice_acks.sql の④を流し直す
--   commit;
-- =====================================================================
