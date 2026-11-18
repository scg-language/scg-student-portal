-- 2026-11-18 小テストは「実施回ごとに1回だけ」提出できる＋提出の返事に正解を入れない
--
-- なぜ（2026-11-18 2台運用デモの実機確認で、校長らから）:
--   1. 「時間内なら再提出できるが、ミニテストでそれはいらない。再提出はしない」
--      → 同じ学生が同じ実施回（run_id）へ2回目を出したら断る。
--   2. 「学生に見せるのはスコアだけでいい」（きあ: 初級は2択が多く、○×を見せた時点で答えになる）
--      → 返事から問題ごとの正誤・正解・解説（results）を外す。点数と問題数だけ返す。
--      ★画面で隠すだけでは足りない。返事に入っていれば、開発者ツールで読める＝まだ受けている友だちに回る。
--      正解・解説は「宿題モード」（その日の16時半から・期限は半年）で見せる予定＝中身は未決。
--
-- 変えないこと:
--   - 実施回なし（quiz_sets.is_open で臨時に全員へ開いた回）の提出は今までどおり何度でも通る。
--     tests/test_security.py の test_04_scoring がこの経路で2回出している。
--   - 採点・attempt_answers への記録（先生の集計・CSV が使う）はそのまま。
--   - results のキーは空配列で残す（古い画面が r.results.slice() で落ちないように）。
--
-- 二重送信（同時に2回押した・2台から同時）は、学生×実施回の勧告ロックで1本ずつにしてから数える。
-- ★一意索引にしなかったのは、デモで再提出を試した既存の行が同じ実施回に2件ずつあり、索引を張れないため。
--
-- 🔴 順番：画面（src/index.html）を先に push して Pages に出てから、この SQL を流す。
--    新しい画面は results が空でも動く。古い画面のままこの SQL を流しても落ちはしない（結果の○×が空になるだけ）。
--
-- 巻き戻し: db/2026-09-10_four_layers.sql の「submit_attempt」の節（create or replace function から grant まで）
--          をそのまま流し直す。表・列は触っていないので、関数を戻すだけで元に戻る。

begin;

create or replace function public.submit_attempt(
  p_quiz_set_id uuid,
  p_answers     jsonb,
  p_duration_ms integer default null,
  p_run_id      uuid    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt_id uuid;
  v_score int := 0;
  v_total int;
  q record;
  v_raw text;
  v_chosen smallint;
  v_n smallint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if p_run_id is not null then
    -- ★実施回つきの提出は、実施回の窓で判定する（quiz_sets.is_open は見ない）
    perform app_hidden.assert_run_open(p_run_id, p_quiz_set_id);
    -- 同じ学生×同じ実施回の提出を1本ずつにする（同時の二重送信で2件入らないように）
    perform pg_advisory_xact_lock(hashtext('submit_attempt:' || auth.uid()::text || ':' || p_run_id::text));
    if exists (select 1 from attempts a
                where a.student_id = auth.uid() and a.run_id = p_run_id) then
      -- PT409 → HTTP 409。画面は「already submitted」の文字で見分ける
      raise exception 'already submitted' using errcode = 'PT409';
    end if;
  elsif not exists(select 1 from quiz_sets where id = p_quiz_set_id and is_open) then
    raise exception 'quiz not open';
  end if;

  -- ⚠ 読み手は questions.quiz_set_id のまま（2026-09-10_four_layers.sql「やらないこと (1)」）
  select count(*) into v_total from questions where quiz_set_id = p_quiz_set_id;
  insert into attempts(student_id, quiz_set_id, score, total, duration_ms, run_id)
    values (auth.uid(), p_quiz_set_id, 0, v_total, p_duration_ms, p_run_id)
    returning id into v_attempt_id;

  for q in
    select qq.id, qa.correct_idx
    from questions qq join question_answers qa on qa.question_id = qq.id
    where qq.quiz_set_id = p_quiz_set_id order by qq.seq
  loop
    select count(*) into v_n from question_choices c where c.question_id = q.id;

    v_raw := p_answers->>(q.id::text);
    v_chosen := null;
    -- 数字でないもの・範囲外は「未回答」として扱う（例外にしない＝1問のミスで提出全体を落とさない）
    if v_raw ~ '^[0-9]{1,2}$' then
      v_chosen := v_raw::smallint;
      if v_chosen < 1 or v_chosen > v_n then v_chosen := null; end if;
    end if;

    if v_chosen is not null then
      insert into attempt_answers(attempt_id, question_id, chosen, is_correct)
        values (v_attempt_id, q.id, v_chosen, v_chosen = q.correct_idx);
      if v_chosen = q.correct_idx then v_score := v_score + 1; end if;
    end if;
  end loop;

  update attempts set score = v_score where id = v_attempt_id;
  -- 🔴 正誤・正解・解説は返さない（点数と問題数だけ）
  return jsonb_build_object('attempt_id', v_attempt_id, 'score', v_score,
                            'total', v_total, 'results', '[]'::jsonb);
end $$;

revoke all on function public.submit_attempt(uuid, jsonb, integer, uuid) from public;
revoke execute on function public.submit_attempt(uuid, jsonb, integer, uuid) from anon;
grant execute on function public.submit_attempt(uuid, jsonb, integer, uuid) to authenticated;

commit;
