-- =====================================================================
-- 既存の関数の締め直し（docs/schema-plan.md 6章の5本目）                    2026-11-24
--
-- ■ なぜ（docs/yakusoku.md 2章・docs/schema-plan.md 1-4）
--   いまは「職員ならだれでも」通る関数が残っている。「できること」の表（app_hidden.can）で見るように替える。
--   先生（非常勤）に残るのは「始める・自分の回を閉じる／取り消す・再テスト・回を1つ開いて結果を見る」。
--
-- ■ このファイルで替えるもの（中の動きは変えない。入口の検査だけ替える）
--   | 関数                                   | いま       | これから                                                   |
--   | delete_quiz_set                        | 職員       | quiz.edit（問題の登録・編集・公開・削除）                    |
--   | start_survey_round / close_survey_round| 職員       | survey.manage（アンケートを作る・回を始める・閉じる）         |
--   | close_quiz_run / void_quiz_run         | 職員       | 自分が始めた回＝quiz.run／ほかの人の回＝quiz.run.any          |
--   | reset_student_password                 | マスター   | student.pwreset（パスワードを初期値に戻す）                   |
--   あわせて：
--   ・close_quiz_run / void_quiz_run / reset_student_password は、操作の記録に1行書く
--     （quiz.run.close / quiz.run.void / password.reset。名前は schema-plan の付録にあるもの）
--   ・テストの種類（quiz_sets.kind_key）を、画面から直接は書き換えられないようにする（set_quiz_kind を通す）
--     ＝schema-plan「4本目で決めたこと」の最後の ⚠
--
-- ■ このファイルで替えないもの
--   ・quiz_stats（回を指定＝quiz.result.one／横断＝quiz.result.export）
--     先生の画面（teacher.html）は、回を開いていないときに「回を指定しない」形で呼んでいる。
--     そのまま締めると、先生のライブ画面が止まる。画面の直し方を決めてから、別の SQL で締める。
--
-- 🔴 今ある動きに触る：先生（非常勤）は、次のことができなくなる
--   ・ほかの人が始めた回を閉じる・取り消す（teacher.html の「今日の回」の一覧のボタン。断られた理由が画面に出る）
--   ・問題のセットを消す／アンケートの回を始める・閉じる（どちらも、ボタンは master.html にしか無い）
--   常勤（マスター）・情報管理者は、今までどおり全部できる。
--
-- ■ 前提：db/2026-11-21_capabilities.sql・db/2026-11-22_audit_log.sql・db/2026-11-22_quiz_kinds_retest.sql を流してあること
--
-- 流す前: python tests/test_db_migrations.py
-- 流したあと: tests/sql/tighten_existing_check.sql（最後に例外で止めて全部ロールバック）／get_advisors
--            （関数の数は変わらない＝WARN の件数は変わらない見込み）
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 問題のセットを消す ＝ quiz.edit
-- ---------------------------------------------------------------------
create or replace function public.delete_quiz_set(p_quiz_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_attempts integer;
  v_questions integer;
begin
  if auth.uid() is null or not app_hidden.can('quiz.edit') then
    raise exception '問題を消せるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;

  select title into v_title from public.quiz_sets where id = p_quiz_set_id;
  if v_title is null then
    raise exception 'no such quiz set' using errcode = '22023';
  end if;

  select count(*) into v_attempts from public.attempts where quiz_set_id = p_quiz_set_id;
  if v_attempts > 0 then
    raise exception '受験記録が % 件あるので消せません（停止にしてください）', v_attempts
      using errcode = '23503';
  end if;

  select count(*) into v_questions from public.questions where quiz_set_id = p_quiz_set_id;

  delete from public.quiz_sets where id = p_quiz_set_id;

  return jsonb_build_object('ok', true, 'title', v_title, 'questions', v_questions);
end $$;

-- ---------------------------------------------------------------------
-- 2. アンケートの回を始める・閉じる ＝ survey.manage
-- ---------------------------------------------------------------------
create or replace function public.start_survey_round(
  p_survey_key text, p_title text,
  p_class_names text[] default '{}'::text[], p_student_ids uuid[] default '{}'::uuid[],
  p_closes_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round survey_rounds%rowtype;
  v_n     integer;
begin
  if auth.uid() is null or not app_hidden.can('survey.manage') then
    raise exception 'アンケートの回を始められるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  if p_survey_key is null or btrim(p_survey_key) = '' then
    raise exception 'survey_key が空です' using errcode = '22023';
  end if;
  if exists (select 1 from public.survey_defs
              where survey_key = p_survey_key and status <> 'published') then
    raise exception 'この アンケートは まだ公開していません（下書きのままでは配れません）'
      using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception '題名が空です（「2026年12月」のように、あとで見分けられる名前を付けてください）'
      using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception '締切が過去です' using errcode = '22023';
  end if;

  insert into public.survey_rounds
        (survey_key, title, class_names, student_ids, opens_at, closes_at, created_by)
  values (p_survey_key, btrim(p_title), coalesce(p_class_names, '{}'), coalesce(p_student_ids, '{}'),
          now(), p_closes_at, auth.uid())
  returning * into v_round;

  v_n := public.run_target_count(v_round.class_names, v_round.student_ids);

  return jsonb_build_object(
    'round_id', v_round.id, 'survey_key', v_round.survey_key, 'title', v_round.title,
    'class_names', to_jsonb(v_round.class_names), 'target_count', v_n,
    'opens_at', v_round.opens_at, 'closes_at', v_round.closes_at);
exception
  when unique_violation then
    raise exception '「%」はもう作ってあります（題名を変えてください）', btrim(p_title)
      using errcode = '23505';
end $$;

create or replace function public.close_survey_round(p_round_id uuid, p_void boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_round survey_rounds%rowtype;
begin
  if auth.uid() is null or not app_hidden.can('survey.manage') then
    raise exception 'アンケートの回を閉じられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  update public.survey_rounds
     set closes_at = least(coalesce(closes_at, now()), now()),
         is_void   = is_void or coalesce(p_void, false)
   where id = p_round_id
  returning * into v_round;
  if v_round.id is null then
    raise exception 'no such round' using errcode = '22023';
  end if;
  return jsonb_build_object('round_id', v_round.id, 'closes_at', v_round.closes_at,
                            'is_void', v_round.is_void);
end $$;

-- ---------------------------------------------------------------------
-- 3. 小テストの回を閉じる・取り消す ＝ 自分が始めた回なら quiz.run／ほかの人の回なら quiz.run.any
--    ★「始めた人」が入っていない古い回は、ほかの人の回として扱う
--    🔴 空との比較は「不明」になり、そのままだと断る条件をすり抜ける。必ず coalesce(…, false) で包む（2026-11-24 に検査で見つけた）
-- ---------------------------------------------------------------------
create or replace function public.close_quiz_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_run quiz_runs%rowtype;
begin
  if auth.uid() is null or not (app_hidden.can('quiz.run') or app_hidden.can('quiz.run.any')) then
    raise exception '回を閉じられるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  select * into v_run from public.quiz_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'no such run' using errcode = '22023';
  end if;
  if not (app_hidden.can('quiz.run.any')
          or (coalesce(v_run.created_by = auth.uid(), false) and app_hidden.can('quiz.run'))) then
    raise exception 'ほかの人が始めた回は、閉じられません（始めた人か、常勤の職員に頼んでください）' using errcode = '42501';
  end if;
  update public.quiz_runs
     set closes_at = least(closes_at, now())
   where id = p_run_id
  returning * into v_run;
  perform app_hidden.audit('quiz.run.close', 'quiz_run', p_run_id::text, '{}'::jsonb);
  return jsonb_build_object('run_id', v_run.id, 'closes_at', v_run.closes_at);
end $$;

create or replace function public.void_quiz_run(p_run_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_run quiz_runs%rowtype;
begin
  if auth.uid() is null or not (app_hidden.can('quiz.run') or app_hidden.can('quiz.run.any')) then
    raise exception '回を取り消せるのは、その権限を持つ人だけです' using errcode = '42501';
  end if;
  select * into v_run from public.quiz_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'no such run' using errcode = '22023';
  end if;
  if not (app_hidden.can('quiz.run.any')
          or (coalesce(v_run.created_by = auth.uid(), false) and app_hidden.can('quiz.run'))) then
    raise exception 'ほかの人が始めた回は、取り消せません（始めた人か、常勤の職員に頼んでください）' using errcode = '42501';
  end if;
  update public.quiz_runs
     set is_void = true, void_reason = p_reason,
         voided_by = auth.uid(), voided_at = now(),
         closes_at = least(closes_at, now())
   where id = p_run_id
  returning * into v_run;
  -- 理由の文は記録に写さない（自由に書ける欄なので、名前が混ざりうる）。あったかどうかだけ
  perform app_hidden.audit('quiz.run.void', 'quiz_run', p_run_id::text,
                           jsonb_build_object('has_reason', coalesce(btrim(p_reason), '') <> ''));
  return jsonb_build_object('run_id', v_run.id, 'is_void', true, 'voided_at', v_run.voided_at);
end $$;

-- ---------------------------------------------------------------------
-- 4. パスワードを初期値に戻す ＝ student.pwreset
--    ★前からある記録（password_reset_log）はそのまま書く。共通の操作の記録にも1行（学籍番号は入れない）
-- ---------------------------------------------------------------------
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
  if auth.uid() is null or not app_hidden.can('student.pwreset') then
    raise exception 'パスワードを初期値に戻せるのは、その権限を持つ人だけです' using errcode = '42501';
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
  delete from auth.sessions s where s.user_id = p_student_id;
  delete from auth.refresh_tokens r where r.user_id = p_student_id::text;
  insert into public.password_reset_log (at, actor_id, student_id, student_no)
  values (v_at, auth.uid(), p_student_id, v_no);
  perform app_hidden.audit('password.reset', 'student', p_student_id::text, '{}'::jsonb);
  return jsonb_build_object('student_no', v_no, 'reset_at', v_at);
end $$;

-- ---------------------------------------------------------------------
-- 5. テストの種類は、画面から直接は書き換えられない（set_quiz_kind を通す）
--    ★関数（security definer）の中からの書き換えは current_user が持ち主になるので通る。
--      画面からの直接の書き換えは current_user が authenticated なので止まる。
--    ★入れるとき（insert）は止めない＝取り込みのときに種類が自動で入る仕組み（quiz_sets_fill_kind）を邪魔しない
-- ---------------------------------------------------------------------
create or replace function app_hidden.quiz_sets_guard_kind()
returns trigger
language plpgsql
as $$
begin
  if new.kind_key is distinct from old.kind_key and current_user in ('authenticated', 'anon') then
    raise exception 'テストの種類は、ここからは変えられません' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function app_hidden.quiz_sets_guard_kind() from public, anon, authenticated;

drop trigger if exists quiz_sets_guard_kind on public.quiz_sets;
create trigger quiz_sets_guard_kind
  before update of kind_key on public.quiz_sets
  for each row execute function app_hidden.quiz_sets_guard_kind();

-- 権限（create or replace は付け直さないが、流し直しても同じになるように書いておく）
revoke execute on function public.delete_quiz_set(uuid) from anon;
grant  execute on function public.delete_quiz_set(uuid) to authenticated;
revoke execute on function public.start_survey_round(text, text, text[], uuid[], timestamptz) from anon;
grant  execute on function public.start_survey_round(text, text, text[], uuid[], timestamptz) to authenticated;
revoke execute on function public.close_survey_round(uuid, boolean) from anon;
grant  execute on function public.close_survey_round(uuid, boolean) to authenticated;
revoke execute on function public.close_quiz_run(uuid) from anon;
grant  execute on function public.close_quiz_run(uuid) to authenticated;
revoke execute on function public.void_quiz_run(uuid, text) from anon;
grant  execute on function public.void_quiz_run(uuid, text) to authenticated;
revoke execute on function public.reset_student_password(uuid) from anon;
grant  execute on function public.reset_student_password(uuid) to authenticated;

commit;

-- =====================================================================
-- 流したあとの確認
--   tests/sql/tighten_existing_check.sql
--   py -X utf8 tests\test_security.py
--
-- 巻き戻し（入口の検査を、前の「職員なら可」に戻す）
--   1〜4 は、前の定義を流し直す：
--     delete_quiz_set            … db/2026-09-11_delete_quiz_set.sql
--     start/close_survey_round   … db/2026-11-18_survey_defs.sql（start）・db/2026-09-11_survey_rounds_phase2.sql（close）
--     close/void_quiz_run        … db/2026-09-10_four_layers.sql
--     reset_student_password     … db/2026-11-20_password_reset.sql
--   5 は：
--     begin;
--     drop trigger if exists quiz_sets_guard_kind on public.quiz_sets;
--     drop function if exists app_hidden.quiz_sets_guard_kind();
--     commit;
-- =====================================================================
