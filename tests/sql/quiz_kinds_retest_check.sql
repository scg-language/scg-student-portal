-- テストの種類・合格の線・再テストの検査（2026-11-22）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-22_quiz_kinds_retest.sql の begin と commit の「あいだ」をこのファイルの上に貼り、
--           全体を begin; … rollback; で包んで1回で流す。🔴 貼るときに commit; の行を入れない（流す前に目で見る）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   前提：1〜3本目が適用済みで、情報管理者の束のマスターが1人・先生が1人・学生が4人以上・まとめテストの回が1つ以上
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミーを使う。値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_t uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  v_qs uuid; v_qs2 uuid; v_origin uuid; v_today_run uuid; v_r1 uuid; v_r2 uuid; v_kset uuid; v_krun uuid;
  v_total int; v_pass jsonb; v_cls text := '検査クラスR';
  r text := ''; n int; j jsonb; t text; ts timestamptz;
begin
  select id into v_m from public.profiles where role = 'master' and bundle = 'info_admin' order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into s1 from public.profiles where role = 'student' order by student_no offset 0 limit 1;
  select id into s2 from public.profiles where role = 'student' order by student_no offset 1 limit 1;
  select id into s3 from public.profiles where role = 'student' order by student_no offset 2 limit 1;
  select id into s4 from public.profiles where role = 'student' order by student_no offset 3 limit 1;
  select s.id into v_qs from public.quiz_sets s where s.kind_key = 'matome'
     and exists (select 1 from public.questions q where q.quiz_set_id = s.id) order by s.title limit 1;
  select s.id into v_qs2 from public.quiz_sets s where s.kind_key = 'daily'
     and exists (select 1 from public.questions q where q.quiz_set_id = s.id) order by s.title limit 1;
  r := r || case when v_m is not null and v_t is not null and s4 is not null and v_qs is not null and v_qs2 is not null
                 then ' pre:OK' else ' pre:NG' end;

  -- K 種類と、今ある回への付き方
  select count(*) into n from public.quiz_kinds;
  r := r || case when n = 3 then ' K1:OK' else ' K1:NG' end;
  select count(*) into n from public.quiz_kinds where has_retest and pass_pct = 80;
  r := r || case when n = 2 then ' K2:OK' else ' K2:NG' end;
  select count(*) into n from public.quiz_sets where kind_key is not null and kind_key <> app_hidden.guess_quiz_kind(source_file);
  r := r || case when n = 0 then ' K3:OK' else ' K3:NG' end;
  -- 今ある回は全部、再テストの対象外
  select count(*) into n from public.quiz_runs where not retest_exempt;
  r := r || case when n = 0 then ' K4:OK' else ' K4:NG(' || n || ')' end;
  -- これから入る回には、ファイル名から種類が付く。回を始めると線が写る
  insert into public.quiz_sets (title, source_book, source_file, source_sheet)
  values ('検査用 漢字', '検査', '検査_どんどんつながる漢字練習帳.xlsx', '検査1') returning id into v_kset;
  select kind_key into t from public.quiz_sets where id = v_kset;
  r := r || case when t = 'kanji' then ' K5:OK' else ' K5:NG' end;
  insert into public.quiz_runs (quiz_set_id, class_names, opens_at, closes_at, duration_min, created_by)
  values (v_kset, array[v_cls || 'X'], now() - interval '3 days', now() - interval '3 days' + interval '10 minutes', 10, v_t)
  returning id into v_krun;
  select pass_pct into n from public.quiz_runs where id = v_krun;
  r := r || case when n = 80 then ' K6:OK' else ' K6:NG' end;
  insert into public.quiz_sets (title) values ('検査用 種類なし') returning id into v_kset;
  select kind_key into t from public.quiz_sets where id = v_kset;
  r := r || case when t is null then ' K7:OK' else ' K7:NG' end;

  -- 準備：4人を検査用のクラスへ。まとめテストを2日前に実施（s1 合格・s2 不合格・s3 と s4 は欠席）
  update public.profiles set class_name = v_cls where id in (s1, s2, s3, s4);
  select count(*) into v_total from public.questions where quiz_set_id = v_qs;
  select jsonb_object_agg(q.id::text, qa.correct_idx::text) into v_pass
    from public.questions q join public.question_answers qa on qa.question_id = q.id where q.quiz_set_id = v_qs;
  insert into public.quiz_runs (quiz_set_id, class_names, opens_at, closes_at, duration_min, created_by)
  values (v_qs, array[v_cls], now() - interval '2 days', now() - interval '2 days' + interval '20 minutes', 20, v_t)
  returning id into v_origin;
  insert into public.attempts (student_id, quiz_set_id, score, total, run_id, submitted_at) values
    (s1, v_qs, v_total, v_total, v_origin, now() - interval '2 days' + interval '5 minutes'),
    (s2, v_qs, 0,       v_total, v_origin, now() - interval '2 days' + interval '6 minutes');
  -- 今日のテスト（もう閉じた）。s2 が不合格。★同じ日には再テストを開けないことを見る
  insert into public.quiz_runs (quiz_set_id, class_names, opens_at, closes_at, duration_min, created_by)
  values (v_qs, array[v_cls], now() - interval '3 minutes', now() - interval '1 minute', 2, v_t)
  returning id into v_today_run;
  insert into public.attempts (student_id, quiz_set_id, score, total, run_id, submitted_at)
  values (s2, v_qs, 0, v_total, v_today_run, now() - interval '2 minutes');
  -- 毎日のテスト（再テストなし）は、不合格でも対象にならない
  insert into public.quiz_runs (quiz_set_id, class_names, opens_at, closes_at, duration_min, created_by)
  values (v_qs2, array[v_cls], now() - interval '2 days', now() - interval '2 days' + interval '20 minutes', 20, v_t);

  -- P 権限：学生と未ログインは、一覧も開くこともできない
  perform set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.retest_targets(v_cls); r := r || ' P1:NG';
  exception when sqlstate '42501' then r := r || ' P1:OK'; end;
  begin perform public.start_retest_run(v_origin, v_cls); r := r || ' P2:NG';
  exception when sqlstate '42501' then r := r || ' P2:OK'; end;
  begin perform public.set_pass_pct('kanji', 70); r := r || ' P3:NG';
  exception when sqlstate '42501' then r := r || ' P3:OK'; end;
  begin perform public.run_pass_stats(30); r := r || ' P4:NG';
  exception when sqlstate '42501' then r := r || ' P4:OK'; end;
  -- S 学生本人へのお知らせ（s2＝2つの回で対象／s1＝今日の回を受けていない1件だけ）
  j := public.my_retests();
  r := r || case when jsonb_array_length(j) = 2 and j @> jsonb_build_array(jsonb_build_object('origin_run', v_origin, 'state', 'retest'))
                 then ' S1:OK' else ' S1:NG' end;
  r := r || case when j::text not like '%score%' then ' S2:OK' else ' S2:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_retests();
  r := r || case when jsonb_array_length(j) = 1 and j @> jsonb_build_array(jsonb_build_object('origin_run', v_today_run, 'state', 'not_taken'))
                 then ' S3:OK' else ' S3:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.retest_targets(null); r := r || ' P5:NG';
  exception when sqlstate '42501' then r := r || ' P5:OK'; end;
  begin perform public.my_retests(); r := r || ' P6:NG';
  exception when sqlstate '42501' then r := r || ' P6:OK'; end;
  execute 'reset role';

  -- T 先生：クラスごとの人数（4人とも、どちらかの回で対象）→ 卒業生にした s4 は消える
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.retest_targets(null);
  r := r || case when j @> jsonb_build_array(jsonb_build_object('class_name', v_cls, 'count', 4)) then ' T1:OK' else ' T1:NG' end;
  execute 'reset role';
  update public.profiles set status = 'graduated' where id = s4;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.retest_targets(null);
  r := r || case when j @> jsonb_build_array(jsonb_build_object('class_name', v_cls, 'count', 3)) then ' T2:OK' else ' T2:NG' end;
  -- クラスを指定：2日前の回＝s2 再テスト・s3 まだ／今日の回＝s1・s3 まだ・s2 再テスト。合格した s1 は2日前の回に出ない
  j := public.retest_targets(v_cls);
  select count(*) into n from jsonb_array_elements(j) e where (e->>'origin_run')::uuid = v_origin;
  r := r || case when n = 2 then ' T3:OK' else ' T3:NG(' || n || ')' end;
  r := r || case when j @> jsonb_build_array(jsonb_build_object('origin_run', v_origin, 'student_id', s2, 'state', 'retest'))
                  and j @> jsonb_build_array(jsonb_build_object('origin_run', v_origin, 'student_id', s3, 'state', 'not_taken'))
                 then ' T4:OK' else ' T4:NG' end;
  -- 🔴 点数を返していない
  r := r || case when j::text not like '%score%' and j::text not like '%total%' then ' T5:OK' else ' T5:NG' end;
  perform public.retest_targets(v_cls);
  -- 同じ日には開けない／いないクラスは開けない／無い回は開けない
  begin perform public.start_retest_run(v_today_run, v_cls); r := r || ' T6:NG';
  exception when sqlstate '22023' then r := r || ' T6:OK'; end;
  begin perform public.start_retest_run(v_origin, 'そんなクラスは無い'); r := r || ' T7:NG';
  exception when sqlstate '22023' then r := r || ' T7:OK'; end;
  begin perform public.start_retest_run(gen_random_uuid(), v_cls); r := r || ' T8:NG';
  exception when sqlstate '22023' then r := r || ' T8:OK'; end;
  -- 開く：対象は s2 と s3 の2人。時間は元の回と同じ20分。その日のうちに閉じる
  j := public.start_retest_run(v_origin, v_cls);
  v_r1 := (j->>'run_id')::uuid;
  r := r || case when (j->>'target_count')::int = 2 then ' T9:OK' else ' T9:NG' end;
  -- 二重には開けない
  begin perform public.start_retest_run(v_origin, v_cls); r := r || ' T10:NG';
  exception when sqlstate '22023' then r := r || ' T10:OK'; end;
  execute 'reset role';
  select count(*) into n from public.quiz_runs
   where id = v_r1 and retest_of = v_origin and pass_pct = 80 and duration_min = 20 and created_by = v_t
     and student_ids @> array[s2, s3] and array_length(student_ids, 1) = 2
     and closes_at <= (((now() at time zone 'Asia/Tokyo')::date + 1)::timestamp at time zone 'Asia/Tokyo');
  r := r || case when n = 1 then ' T11:OK' else ' T11:NG' end;
  select count(*) into n from public.audit_log where actor_id = v_t and action = 'view.retest_list' and target_id = v_cls;
  r := r || case when n = 1 then ' T12:OK' else ' T12:NG(' || n || ')' end;
  select count(*) into n from public.audit_log where actor_id = v_t and action = 'retest.run.start' and (detail->>'students')::int = 2;
  r := r || case when n = 1 then ' T13:OK' else ' T13:NG' end;

  -- R 再テストを受ける：s2 は合格・s3（休んでいた＝1回目）は不合格
  perform set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when public.my_open_runs() @> jsonb_build_array(jsonb_build_object('run_id', v_r1)) then ' R1:OK' else ' R1:NG' end;
  j := public.submit_attempt(v_qs, v_pass, 1000, v_r1);
  r := r || case when (j->>'score')::int = v_total then ' R2:OK' else ' R2:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', s3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.submit_attempt(v_qs, '{}'::jsonb, 1000, v_r1);
  r := r || case when (j->>'score')::int = 0 then ' R3:OK' else ' R3:NG' end;
  execute 'reset role';
  -- s1 は対象ではないので、再テストの回には出せない
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.submit_attempt(v_qs, v_pass, 1000, v_r1); r := r || ' R4:NG';
  exception when sqlstate '42501' then r := r || ' R4:OK'; end;
  execute 'reset role';
  -- 最初の点は、そのまま残っている（s2 の2日前の回＝0点のまま・別の記録が1つ増えただけ）
  select count(*) into n from public.attempts where student_id = s2 and run_id = v_origin and score = 0;
  r := r || case when n = 1 then ' R5:OK' else ' R5:NG' end;
  select count(*) into n from public.attempts where student_id = s2 and run_id = v_r1 and score = v_total;
  r := r || case when n = 1 then ' R6:OK' else ' R6:NG' end;

  -- 再テストの回を閉じたあと：s2＝受けた（合格）・s3＝再テストの対象（1回目で落ちた）
  -- ★検査の中では now() が動かないので、開始を2分前へずらしてから閉じる（closes_at > opens_at の決まりのため）
  update public.quiz_runs set opens_at = now() - interval '2 minutes', closes_at = now() where id = v_r1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.retest_targets(v_cls);
  r := r || case when j @> jsonb_build_array(jsonb_build_object('origin_run', v_origin, 'student_id', s2, 'state', 'retest_passed'))
                  and j @> jsonb_build_array(jsonb_build_object('origin_run', v_origin, 'student_id', s3, 'state', 'retest'))
                 then ' R7:OK' else ' R7:NG' end;
  -- s3 の再テスト（1回だけ）を開く → 対象は1人
  j := public.start_retest_run(v_origin, v_cls, 5);
  v_r2 := (j->>'run_id')::uuid;
  r := r || case when (j->>'target_count')::int = 1 then ' R8:OK' else ' R8:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', s3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.submit_attempt(v_qs, '{}'::jsonb, 1000, v_r2);
  r := r || case when not (public.my_retests() @> jsonb_build_array(jsonb_build_object('origin_run', v_origin))) then ' R9:OK' else ' R9:NG' end;
  execute 'reset role';
  update public.quiz_runs set opens_at = now() - interval '2 minutes', closes_at = now() where id = v_r2;
  -- また不合格 → もう対象にならない。3回目は開けない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.retest_targets(v_cls);
  r := r || case when j @> jsonb_build_array(jsonb_build_object('origin_run', v_origin, 'student_id', s3, 'state', 'retest_failed'))
                 then ' R10:OK' else ' R10:NG' end;
  begin perform public.start_retest_run(v_origin, v_cls); r := r || ' R11:NG';
  exception when sqlstate '22023' then r := r || ' R11:OK'; end;

  -- G 集計：先生も見られる。名前は入っていない。2日前の回＝提出2・線に届かなかった1。再テストの回は別の行
  j := public.run_pass_stats(30);
  r := r || case when j @> jsonb_build_array(jsonb_build_object('run_id', v_origin, 'submitted', 2, 'below', 1, 'is_retest', false))
                  and j @> jsonb_build_array(jsonb_build_object('run_id', v_r1, 'submitted', 2, 'below', 1, 'is_retest', true))
                 then ' G1:OK' else ' G1:NG' end;
  select display_name into t from public.profiles where id = s2;
  r := r || case when position(t in j::text) = 0 and j::text not like '%student%' then ' G2:OK' else ' G2:NG' end;
  -- 先生は線を変えられない
  begin perform public.set_pass_pct('kanji', 70); r := r || ' L1:NG';
  exception when sqlstate '42501' then r := r || ' L1:OK'; end;
  begin perform public.set_quiz_kind(v_kset, 'daily'); r := r || ' L2:NG';
  exception when sqlstate '42501' then r := r || ' L2:OK'; end;
  execute 'reset role';

  -- L 線を変える：次に始める回から効く。終わった回の写しは動かない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.set_pass_pct('kanji', 70);
  r := r || case when (j->>'before')::int = 80 and (j->>'after')::int = 70 then ' L3:OK' else ' L3:NG' end;
  begin perform public.set_pass_pct('kanji', 0); r := r || ' L4:NG';
  exception when sqlstate '22023' then r := r || ' L4:OK'; end;
  begin perform public.set_pass_pct('そんな種類は無い', 70); r := r || ' L5:NG';
  exception when sqlstate '22023' then r := r || ' L5:OK'; end;
  perform public.set_quiz_kind(v_kset, 'kanji');
  execute 'reset role';
  select pass_pct into n from public.quiz_runs where id = v_krun;
  r := r || case when n = 80 then ' L6:OK' else ' L6:NG' end;
  insert into public.quiz_runs (quiz_set_id, class_names, opens_at, closes_at, duration_min, created_by)
  values (v_kset, array[v_cls || 'X'], now(), now() + interval '10 minutes', 10, v_t) returning pass_pct into n;
  r := r || case when n = 70 then ' L7:OK' else ' L7:NG' end;
  select count(*) into n from public.audit_log where action in ('passline.set', 'quiz.kind.set') and actor_id = v_m;
  r := r || case when n = 2 then ' L8:OK' else ' L8:NG' end;

  raise exception 'RESULT%', r;
end $$;
