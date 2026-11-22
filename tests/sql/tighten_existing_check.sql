-- 既存の関数の締め直し（db/2026-11-24_tighten_existing.sql）の検査（2026-11-24）。
-- ★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-24_tighten_existing.sql の、begin と commit の「あいだ」を
--           このファイルの上に貼り、全体を begin; … rollback; で包んで1回で流す
--           🔴 貼るときに commit; の行を入れない（入れると取り消されずに残る。流す前に目で見ること）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_t uuid; v_s uuid;
  v_set uuid; v_set2 uuid; v_run_m uuid; v_run_t uuid; v_run_old uuid; v_round uuid;
  r text := ''; n int; a0 int; j jsonb;
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into v_s from public.profiles where role = 'student' and status = 'active' order by student_no limit 1;
  update public.profiles set bundle = null where id in (v_m, v_t);     -- マスター＝常勤／先生＝先生、の素の形で試す
  select count(*) into n from public.staff_caps where profile_id in (v_m, v_t);
  r := r || case when n = 0 then ' 0a:OK' else ' 0a:NG' end;          -- 前提：この2人に、人ごとの足し引きが無い

  -- 下ごしらえ：検査用のセット2つ（片方は種類なし）と、回3つ（常勤が始めた・先生が始めた・始めた人が空）
  insert into public.quiz_sets (title) values ('検査用のセット') returning id into v_set;
  insert into public.quiz_sets (title) values ('検査用のセット2') returning id into v_set2;
  insert into public.quiz_runs (quiz_set_id, closes_at, created_by) values (v_set, now() + interval '1 hour', v_m) returning id into v_run_m;
  insert into public.quiz_runs (quiz_set_id, closes_at, created_by) values (v_set, now() + interval '1 hour', v_t) returning id into v_run_t;
  insert into public.quiz_runs (quiz_set_id, closes_at, created_by) values (v_set, now() + interval '1 hour', null) returning id into v_run_old;
  select count(*) into a0 from public.audit_log;

  -- 1 学生：どれも呼べない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.delete_quiz_set(v_set2); r := r || ' 1a:NG'; exception when sqlstate '42501' then r := r || ' 1a:OK'; end;
  begin perform public.start_survey_round('test_tighten_check', '検査の回'); r := r || ' 1b:NG'; exception when sqlstate '42501' then r := r || ' 1b:OK'; end;
  begin perform public.close_quiz_run(v_run_m); r := r || ' 1c:NG'; exception when sqlstate '42501' then r := r || ' 1c:OK'; end;
  begin perform public.void_quiz_run(v_run_m); r := r || ' 1d:NG'; exception when sqlstate '42501' then r := r || ' 1d:OK'; end;
  begin perform public.reset_student_password(v_s); r := r || ' 1e:NG'; exception when sqlstate '42501' then r := r || ' 1e:OK'; end;
  execute 'reset role';

  -- 2 先生（非常勤）：自分の回は閉じる・取り消すができる。ほかの人の回・古い回はできない。消す・アンケート・パスワードはできない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.delete_quiz_set(v_set2); r := r || ' 2a:NG'; exception when sqlstate '42501' then r := r || ' 2a:OK'; end;
  begin perform public.start_survey_round('test_tighten_check', '検査の回'); r := r || ' 2b:NG'; exception when sqlstate '42501' then r := r || ' 2b:OK'; end;
  begin perform public.close_quiz_run(v_run_m); r := r || ' 2c:NG'; exception when sqlstate '42501' then r := r || ' 2c:OK'; end;
  begin perform public.void_quiz_run(v_run_m); r := r || ' 2d:NG'; exception when sqlstate '42501' then r := r || ' 2d:OK'; end;
  begin perform public.close_quiz_run(v_run_old); r := r || ' 2e:NG'; exception when sqlstate '42501' then r := r || ' 2e:OK'; end;
  begin perform public.reset_student_password(v_s); r := r || ' 2f:NG'; exception when sqlstate '42501' then r := r || ' 2f:OK'; end;
  begin perform public.close_quiz_run(gen_random_uuid()); r := r || ' 2g:NG'; exception when sqlstate '22023' then r := r || ' 2g:OK'; end;   -- 無い回
  j := public.close_quiz_run(v_run_t);
  r := r || case when (j->>'closes_at')::timestamptz <= now() then ' 2h:OK' else ' 2h:NG' end;
  j := public.void_quiz_run(v_run_t, 'クラスを間違えた テスト太郎');
  r := r || case when (j->>'is_void')::boolean then ' 2i:OK' else ' 2i:NG' end;
  -- テストの種類を、直接は書き換えられない。ほかの列（題名）は今までどおり書ける
  begin update public.quiz_sets set kind_key = 'kanji' where id = v_set; r := r || ' 2j:NG';
  exception when sqlstate '42501' then r := r || ' 2j:OK'; end;
  begin update public.quiz_sets set title = '検査用のセット（直した）' where id = v_set; r := r || ' 2k:OK';
  exception when others then r := r || ' 2k:NG'; end;
  begin perform public.set_quiz_kind(v_set, 'kanji'); r := r || ' 2l:NG'; exception when sqlstate '42501' then r := r || ' 2l:OK'; end;   -- 先生は種類も変えられない
  execute 'reset role';
  select count(*) into n from public.quiz_runs where id = v_run_m and not is_void and closes_at > now();
  r := r || case when n = 1 then ' 2m:OK' else ' 2m:NG' end;                         -- 断られた回は、そのまま

  -- 3 常勤（マスター）：全部できる。ほかの人の回・古い回も閉じられる
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.close_quiz_run(v_run_old);
  r := r || case when (j->>'closes_at')::timestamptz <= now() then ' 3a:OK' else ' 3a:NG' end;
  j := public.void_quiz_run(v_run_m);
  r := r || case when (j->>'is_void')::boolean then ' 3b:OK' else ' 3b:NG' end;
  j := public.start_survey_round('test_tighten_check', '検査の回');
  v_round := (j->>'round_id')::uuid;
  r := r || case when v_round is not null then ' 3c:OK' else ' 3c:NG' end;
  j := public.close_survey_round(v_round, true);
  r := r || case when (j->>'is_void')::boolean then ' 3d:OK' else ' 3d:NG' end;
  j := public.reset_student_password(v_s);
  r := r || case when j ? 'reset_at' then ' 3e:OK' else ' 3e:NG' end;
  perform public.set_quiz_kind(v_set, 'kanji');                                     -- 決まった口からなら、種類を変えられる
  j := public.delete_quiz_set(v_set2);
  r := r || case when (j->>'ok')::boolean then ' 3f:OK' else ' 3f:NG' end;
  execute 'reset role';
  select count(*) into n from public.quiz_sets where id = v_set and kind_key = 'kanji';
  r := r || case when n = 1 then ' 3g:OK' else ' 3g:NG' end;

  -- 4 操作の記録：閉じた2回・取り消した2回・パスワード1回・種類1回。理由の文と学籍番号は入っていない
  select count(*) into n from public.audit_log where action = 'quiz.run.close' and target_id in (v_run_t::text, v_run_old::text);
  r := r || case when n = 2 then ' 4a:OK' else ' 4a:NG(' || n || ')' end;
  select count(*) into n from public.audit_log where action = 'quiz.run.void' and target_id in (v_run_t::text, v_run_m::text);
  r := r || case when n = 2 then ' 4b:OK' else ' 4b:NG(' || n || ')' end;
  select count(*) into n from public.audit_log where action = 'quiz.run.void' and target_id = v_run_t::text
     and (detail->>'has_reason')::boolean and detail::text not like '%テスト太郎%';
  r := r || case when n = 1 then ' 4c:OK' else ' 4c:NG' end;
  select count(*) into n from public.audit_log a, public.profiles p
   where a.action = 'password.reset' and a.actor_id = v_m and a.target_id = v_s::text and p.id = v_s
     and a.detail::text not like '%' || p.student_no || '%';
  r := r || case when n = 1 then ' 4d:OK' else ' 4d:NG' end;
  select count(*) into n from public.password_reset_log where student_id = v_s and actor_id = v_m and at >= now() - interval '1 minute';
  r := r || case when n >= 1 then ' 4e:OK' else ' 4e:NG' end;                        -- 前からある記録も、今までどおり書く
  select count(*) into n from public.audit_log;
  r := r || case when n = a0 + 6 then ' 4f:OK' else ' 4f:NG(' || (n - a0) || ')' end;  -- 断られた呼び出しは、記録を増やさない

  -- 5 人ごとの足し引きが効く：先生に「問題の登録・編集」を足すと消せる／常勤から「他の人の回」を外すと閉じられない
  insert into public.quiz_sets (title) values ('検査用のセット3') returning id into v_set2;
  insert into public.quiz_runs (quiz_set_id, closes_at, created_by) values (v_set, now() + interval '1 hour', v_t) returning id into v_run_t;
  insert into public.staff_caps (profile_id, cap_key, granted) values (v_t, 'quiz.edit', true), (v_m, 'quiz.run.any', false)
  on conflict (profile_id, cap_key) do update set granted = excluded.granted;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.delete_quiz_set(v_set2);
  r := r || case when (j->>'ok')::boolean then ' 5a:OK' else ' 5a:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.close_quiz_run(v_run_t); r := r || ' 5b:NG'; exception when sqlstate '42501' then r := r || ' 5b:OK'; end;
  execute 'reset role';

  -- 6 ログインなし：呼べない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.close_quiz_run(v_run_t); r := r || ' 6a:NG'; exception when sqlstate '42501' then r := r || ' 6a:OK'; end;
  begin perform public.reset_student_password(v_s); r := r || ' 6b:NG'; exception when sqlstate '42501' then r := r || ' 6b:OK'; end;
  begin perform public.delete_quiz_set(v_set); r := r || ' 6c:NG'; exception when sqlstate '42501' then r := r || ' 6c:OK'; end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
