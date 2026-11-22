-- =====================================================================
-- 学生アカウントの発行（名簿からまとめて作る）                              2026-11-23
--
-- ■ なぜ（docs/yakusoku.md 2章・4章）
--   学生のアカウントを作る口が無かった。12月の配布までに要る。
--   名簿（学籍番号・氏名・クラス）の行から、ログイン用のアカウントと名簿の行を作る。
--   2026-11-21 の自走ぶん（work/2026-11-21-jisou）の作りを、約束事に合わせて作り直したもの。
--
-- ■ このファイルでやること（足すだけ・何も締めない）
--   public.issue_student_accounts(p_rows jsonb)
--     ・呼べるのは「アカウントの発行・停止・再開」（account.manage）を持つ人だけ＝情報管理者
--     ・学籍番号は、全角・ハイフン・空白を取ってから7桁の数字だけを通す（決まりは app_hidden.normalize_student_no の1か所）
--     ・はじめのパスワードは「scg＋学籍番号」（reset_student_password / my_password_is_initial と同じ式）
--       → 配った直後のログインで、パスワードの決め直しの画面が必ず出る
--     ・すでにある番号・形のおかしい行は、作らずに理由を返す（上書きしない）
--     ・1回30件まで（パスワードの計算に1件あたり数十ミリ秒かかる。画面が20件ずつに分けて送る）
--     ・操作の記録に、1回の呼び出しにつき1行（件数だけ。学籍番号・氏名は入れない）
--
-- ■ 前提：db/2026-11-21_capabilities.sql・db/2026-11-22_audit_log.sql・db/2026-11-22_account_status.sql を流してあること
--
-- 🔴 auth の表を直接さわっている（Supabase Auth の版が上がると壊れうる箇所）
--   a. auth.users への insert の列。トークンの4列（confirmation_token, recovery_token, email_change_token_new, email_change）は
--      null だとログイン時に Auth が落ちる版がある → 必ず '' を入れる
--   b. auth.identities への insert（provider_id, user_id, identity_data, provider）。行が無いと、版によってはログインできない
--   c. パスワードのハッシュ＝extensions.crypt(…, gen_salt('bf', 10))。Auth が bcrypt をやめたら合わなくなる（11/20 と同じ前提）
--   ★ Supabase の版を上げたら、tests/sql/account_issue_check.sql をロールバックで流して確かめる
--
-- ⚠ ログイン用のアドレスの @ より後ろは、押した人自身のアドレスから取る
--   （assets/api.js の MAIL_DOMAIN と同じ値を SQL に書き写さない＝2か所に持たない）
-- ⚠ 「漏れたパスワードを使わせない」「8字以上・英字と数字」は Auth の API が見る決まりで、この insert は通らない。
--   学籍番号が7桁の数字なので、「scg＋学籍番号」は必ず10字・英字と数字になる
--
-- 🔴 順番：画面（src/）を先に出してから、この SQL を流す。画面は RPC が無くても今までどおり動く
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/account_issue_check.sql（最後に例外で止めて全部ロールバック）／get_advisors（WARN が1件増える）
-- =====================================================================

begin;

-- 返事 = {"created":n, "existing":n, "invalid":n, "failed":n,
--         "results":[{"student_no":"…","status":"created|existing|invalid|failed","reason":…}, …]}（入れた行の順）
create or replace function public.issue_student_accounts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    uuid := auth.uid();
  v_at       timestamptz := now();
  v_domain   text;
  v_instance uuid;
  v_row      jsonb;
  v_raw      text;
  v_no       text;
  v_name     text;
  v_class    text;
  v_email    text;
  v_id       uuid;
  v_status   text;
  v_reason   text;
  v_seen     text[] := '{}';
  v_results  jsonb := '[]'::jsonb;
  v_created  int := 0;
  v_existing int := 0;
  v_invalid  int := 0;
  v_failed   int := 0;
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

  -- ログイン用のアドレスの形は、押した人自身のものに合わせる
  select split_part(u.email, '@', 2), u.instance_id into v_domain, v_instance
    from auth.users u where u.id = v_actor;
  if v_domain is null or v_domain = '' then
    raise exception 'ログイン用のアドレスの形を確認できませんでした' using errcode = 'P0002';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_raw   := btrim(coalesce(case when jsonb_typeof(v_row) = 'object' then v_row->>'student_no'   end, ''));
    v_name  := btrim(coalesce(case when jsonb_typeof(v_row) = 'object' then v_row->>'display_name' end, ''));
    v_class := btrim(coalesce(case when jsonb_typeof(v_row) = 'object' then v_row->>'class_name'   end, ''));
    v_no    := app_hidden.normalize_student_no(v_raw);       -- 7桁の数字だけ。それ以外は null
    v_email := v_no || '@' || v_domain;
    v_status := null; v_reason := null;

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
    elsif exists (select 1 from auth.users u where lower(u.email) = v_email) then
      -- 名簿には無いのにログイン用のアカウントだけある（作りかけ・消し残し）。勝手に上書きしない
      v_status := 'existing'; v_reason := 'login_exists';
    else
      begin
        v_id := gen_random_uuid();
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change_token_new, email_change)
        values (
          coalesce(v_instance, '00000000-0000-0000-0000-000000000000'::uuid), v_id,
          'authenticated', 'authenticated', v_email,
          extensions.crypt('scg' || v_no, extensions.gen_salt('bf', 10)), v_at,
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_at, v_at,
          '', '', '', '');

        insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
        values (
          v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', v_at, v_at);

        -- ★auth.users に「名簿の行を自動で作る」トリガがあっても、ここの値で確定させる
        insert into public.profiles (id, student_no, display_name, role, class_name)
        values (v_id, v_no, v_name, 'student', v_class)
        on conflict (id) do update
          set student_no = excluded.student_no, display_name = excluded.display_name,
              role = 'student', class_name = excluded.class_name;

        v_status := 'created';
      exception when others then
        -- この行の分はすべて巻き戻る。理由は番号だけ返す（文には値が混ざりうるので返さない）
        v_status := 'failed'; v_reason := 'error:' || sqlstate;
      end;
    end if;

    if v_no is not null then v_seen := v_seen || v_no; end if;
    if    v_status = 'created'  then v_created  := v_created  + 1;
    elsif v_status = 'existing' then v_existing := v_existing + 1;
    elsif v_status = 'invalid'  then v_invalid  := v_invalid  + 1;
    else                             v_failed   := v_failed   + 1;
    end if;
    -- 返すのは、形が通った行は7桁の番号、通らなかった行は入れたままの文字（どの行かを画面が示すため）
    v_results := v_results || jsonb_build_object('student_no', coalesce(v_no, v_raw), 'status', v_status, 'reason', v_reason);
  end loop;

  -- 操作の記録は、1回の呼び出しにつき1行。件数だけ（学籍番号・氏名は入れない）
  perform app_hidden.audit('account.issue', 'student', null,
                           jsonb_build_object('created', v_created, 'existing', v_existing,
                                              'invalid', v_invalid, 'failed', v_failed));

  return jsonb_build_object('created', v_created, 'existing', v_existing,
                            'invalid', v_invalid, 'failed', v_failed, 'results', v_results);
end $$;

revoke all     on function public.issue_student_accounts(jsonb) from public;
revoke execute on function public.issue_student_accounts(jsonb) from anon;
grant  execute on function public.issue_student_accounts(jsonb) to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   tests/sql/account_issue_check.sql
--   py -X utf8 tests\test_security.py     ← 既存の権限が1つも変わっていないこと
--
-- 巻き戻し
--   begin;
--   drop function if exists public.issue_student_accounts(jsonb);
--   commit;
--   ※ 発行したアカウントそのもの（auth.users / auth.identities / profiles）は、この巻き戻しでは消えない。
--     止めるなら public.set_account_status（退学＝ログイン不可）を使う
-- =====================================================================
