-- =====================================================================
-- 学生アカウントの発行を、Supabase の正規の口（Edge Function）に移す        2026-11-24
--
-- ■ なぜ（docs/schema-plan.md 5章の3・2026-11-21 きあ）
--   「アカウントの発行は、Supabase の正規の口を通す小さなプログラムをサーバー側に置く。
--     DB から auth の表へ直接は入れない」と決まっていた。
--   2026-11-23 の db/2026-11-23_account_issue.sql は、これに反して auth.users / auth.identities へ
--   直接 insert していた（Auth の版が上がると壊れうる・パスワードの決まりを通らない）。作り直す。
--
-- ■ 分担（作り直したあと）
--   Edge Function「issue-accounts」（supabase/functions/issue-accounts/）
--     ・ログイン用のアカウントを作る／作りかけを消す ＝ Auth の管理用 API だけを使う
--   この SQL の3つの関数（どれも「アカウントの発行・停止・再開」account.manage を持つ人だけ）
--     ・issue_precheck        … 名簿の行を見て、作ってよい・すでにある・形がおかしい に分ける（何も書かない）
--     ・issue_attach_profile  … Edge Function が作ったログイン用のアカウントに、名簿の行を付ける
--     ・issue_log             … 操作の記録に1行（件数だけ）
--   ★3つとも、Edge Function が「押した人本人の資格」で呼ぶ。発行できる人かどうかは、今までどおり DB が見る。
--     Edge Function が強い鍵を使うのは、Auth の管理用 API を呼ぶときだけ。
--   ★学籍番号の決まりは、今までどおり app_hidden.normalize_student_no の1か所。
--
-- ■ このファイルでやること
--   1. 上の3つの関数を足す
--   2. public.issue_student_accounts(jsonb) を外す（auth の表へ直接書く口を残さない）
--
-- 🔴 順番：①この SQL を流す → ②Edge Function を置く → ③画面（src/）を出す
--   ①のあと③までの間、サイトに出ている前の画面の発行は「まだ使えません」と出る（ほかは今までどおり）。
--   2026-11-24 の時点で、発行はまだ1件もしていない（操作の記録 account.issue は0件）。
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/account_issue_edge_check.sql（最後に例外で止めて全部ロールバック）／get_advisors
--            （ログイン中の人が呼べる関数は 1本減って3本増える＝WARN は差し引き2件増える見込み）
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 名簿の行を見る（何も書かない）
--    返事 = {"domain":"…", "results":[{"student_no":"…","status":"ok|invalid|existing","reason":…}, …]}（入れた行の順）
--    domain＝ログイン用のアドレスの @ より後ろ。押した人自身のアドレスから取る（値を SQL に書き写さない）
-- ---------------------------------------------------------------------
create or replace function public.issue_precheck(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid := auth.uid();
  v_domain  text;
  v_row     jsonb;
  v_raw     text;
  v_no      text;
  v_name    text;
  v_class   text;
  v_status  text;
  v_reason  text;
  v_seen    text[] := '{}';
  v_results jsonb := '[]'::jsonb;
begin
  if v_actor is null or not app_hidden.can('account.manage') then
    raise exception 'アカウントを発行できるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception '名簿の形が正しくありません' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 30 then
    raise exception '一度に発行できるのは30件までです' using errcode = '22023';
  end if;

  select split_part(u.email, '@', 2) into v_domain from auth.users u where u.id = v_actor;
  if v_domain is null or v_domain = '' then
    raise exception 'ログイン用のアドレスの形を確認できませんでした' using errcode = 'P0002';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_raw   := btrim(coalesce(case when jsonb_typeof(v_row) = 'object' then v_row->>'student_no'   end, ''));
    v_name  := btrim(coalesce(case when jsonb_typeof(v_row) = 'object' then v_row->>'display_name' end, ''));
    v_class := btrim(coalesce(case when jsonb_typeof(v_row) = 'object' then v_row->>'class_name'   end, ''));
    v_no    := app_hidden.normalize_student_no(v_raw);       -- 7桁の数字だけ。それ以外は null
    v_status := 'ok'; v_reason := null;

    if v_no is null then
      v_status := 'invalid'; v_reason := 'bad_student_no';
    elsif v_name = '' or char_length(v_name) > 100 then
      v_status := 'invalid'; v_reason := 'bad_name';
    elsif v_class = '' or char_length(v_class) > 50 then
      v_status := 'invalid'; v_reason := 'bad_class';
    elsif v_no = any (v_seen) then
      v_status := 'invalid'; v_reason := 'duplicate_in_list';
    elsif exists (select 1 from public.profiles p where p.student_no = v_no) then
      v_status := 'existing'; v_reason := 'exists';
    elsif exists (select 1 from auth.users u where lower(u.email) = v_no || '@' || v_domain) then
      -- 名簿には無いのにログイン用のアカウントだけある（作りかけ・消し残し）。勝手に上書きしない
      v_status := 'existing'; v_reason := 'login_exists';
    end if;

    if v_no is not null then v_seen := v_seen || v_no; end if;
    -- 返すのは、形が通った行は7桁の番号、通らなかった行は入れたままの文字（どの行かを画面が示すため）
    v_results := v_results || jsonb_build_object('student_no', coalesce(v_no, v_raw), 'status', v_status, 'reason', v_reason);
  end loop;

  return jsonb_build_object('domain', v_domain, 'results', v_results);
end $$;

revoke all     on function public.issue_precheck(jsonb) from public;
revoke execute on function public.issue_precheck(jsonb) from anon;
grant  execute on function public.issue_precheck(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 作ったばかりのログイン用のアカウントに、名簿の行を付ける
--    ・付けられるのは「学籍番号＠（押した人と同じ後ろ）」のアドレスで、10分以内に作られたアカウントだけ
--      ＝前からあるアカウントに、あとから学生の行を付ける口にはしない
--    ・すでに名簿の行がある（同じ人・同じ学籍番号）ときは断る。上書きしない
-- ---------------------------------------------------------------------
create or replace function public.issue_attach_profile(
  p_user uuid, p_student_no text, p_display_name text, p_class_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid := auth.uid();
  v_no      text := app_hidden.normalize_student_no(p_student_no);
  v_name    text := btrim(coalesce(p_display_name, ''));
  v_class   text := btrim(coalesce(p_class_name, ''));
  v_domain  text;
  v_email   text;
  v_created timestamptz;
begin
  if v_actor is null or not app_hidden.can('account.manage') then
    raise exception 'アカウントを発行できるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_user is null or v_no is null
     or v_name = '' or char_length(v_name) > 100
     or v_class = '' or char_length(v_class) > 50 then
    raise exception '名簿の行の形が正しくありません' using errcode = '22023';
  end if;

  select split_part(u.email, '@', 2) into v_domain from auth.users u where u.id = v_actor;
  select lower(u.email), u.created_at into v_email, v_created from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'ログイン用のアカウントが見つかりません' using errcode = 'P0002';
  end if;
  if v_email <> v_no || '@' || coalesce(v_domain, '') then
    raise exception '学籍番号と、ログイン用のアカウントが合いません' using errcode = '22023';
  end if;
  if v_created is null or v_created < now() - interval '10 minutes' then
    raise exception '作ったばかりのアカウントではありません' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user or p.student_no = v_no) then
    raise exception 'すでに名簿の行があります' using errcode = '23505';
  end if;

  insert into public.profiles (id, student_no, display_name, role, class_name)
  values (p_user, v_no, v_name, 'student', v_class);
  return 'created';
end $$;

revoke all     on function public.issue_attach_profile(uuid, text, text, text) from public;
revoke execute on function public.issue_attach_profile(uuid, text, text, text) from anon;
grant  execute on function public.issue_attach_profile(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 操作の記録に1行（1回の送信につき1行・件数だけ。学籍番号・氏名は入れない）
-- ---------------------------------------------------------------------
create or replace function public.issue_log(p_created int, p_existing int, p_invalid int, p_failed int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not app_hidden.can('account.manage') then
    raise exception 'アカウントを発行できるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  -- ★least() は null を飛ばすので、null は1つずつ見る
  if p_created is null or p_existing is null or p_invalid is null or p_failed is null
     or least(p_created, p_existing, p_invalid, p_failed) < 0
     or p_created + p_existing + p_invalid + p_failed > 30 then
    raise exception '件数の形が正しくありません' using errcode = '22023';
  end if;
  perform app_hidden.audit('account.issue', 'student', null,
                           jsonb_build_object('created', p_created, 'existing', p_existing,
                                              'invalid', p_invalid, 'failed', p_failed));
end $$;

revoke all     on function public.issue_log(int, int, int, int) from public;
revoke execute on function public.issue_log(int, int, int, int) from anon;
grant  execute on function public.issue_log(int, int, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 4. auth の表へ直接書く口を外す
-- ---------------------------------------------------------------------
drop function if exists public.issue_student_accounts(jsonb);

commit;

-- =====================================================================
-- 流したあとの確認
--   tests/sql/account_issue_edge_check.sql
--   py -X utf8 tests\test_security.py     ← 既存の権限が1つも変わっていないこと
--
-- 巻き戻し
--   begin;
--   drop function if exists public.issue_precheck(jsonb);
--   drop function if exists public.issue_attach_profile(uuid, text, text, text);
--   drop function if exists public.issue_log(int, int, int, int);
--   commit;
--   ※ 前の口（issue_student_accounts）を戻すなら db/2026-11-23_account_issue.sql を流し直す
--   ※ 発行したアカウントそのものは、この巻き戻しでは消えない。
--     止めるなら public.set_account_status（退学＝ログイン不可）を使う
-- =====================================================================
