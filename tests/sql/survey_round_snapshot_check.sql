-- 回の「設問の写し」の検査（2026-11-24・db/2026-11-24_survey_round_snapshot.sql）。
-- ★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-24_survey_round_snapshot.sql の begin と commit の「あいだ」をこのファイルの上に貼り、
--           全体を begin; … rollback; で包んで1回で流す（Supabase MCP の execute_sql でよい）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミー（role ごとに student_no の若い1人）を使う。作る回・定義は全部ロールバックされる。
--     回の題名は時刻つき＝(survey_key, title) の一意にぶつからない
do $$
declare
  v_m uuid; v_t uuid; v_s uuid;
  r text := ''; n int; j jsonb; d jsonb; ts timestamptz;
  v_a uuid; v_b uuid; v_c uuid; v_key text;
  v_tag text := to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS.US');
  v_def  jsonb := '{"key":"test_ui","title":{"ja":"写しの検査"},"q":[{"k":"q1","t":"select","l":{"ja":"質問"},"o":[{"v":"a","ja":"はい"},{"v":"b","ja":"いいえ"}]}]}';
  v_def2 jsonb := '{"title":{"ja":"書き換え"},"q":[{"k":"q1","t":"select","l":{"ja":"質問"},"o":[{"v":"a","ja":"ちがう名前"},{"v":"b","ja":"いいえ"}]}]}';
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into v_s from public.profiles where role = 'student' order by student_no limit 1;

  update public.profiles set bundle = null where id in (v_m, v_t);     -- マスター＝常勤／先生＝先生、の素の形で試す

  -- 1 常勤：コードの定義（表に無い key）の回をはじめる → 写しはまだ空
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.start_survey_round('test_ui', '写しの検査A ' || v_tag, '{}', array[v_s], now() + interval '20 minutes');
  v_a := (j->>'round_id')::uuid;
  select def_snapshot into d from public.survey_rounds where id = v_a;
  r := r || case when d is null then ' 1:OK' else ' 1:NG' end;

  -- 2 常勤：壊れた形は断る（配列・質問なし）／無い回は断る
  begin perform public.save_survey_round_def(v_a, '[1,2]'::jsonb); r := r || ' 2a:NG';
  exception when sqlstate '22023' then r := r || ' 2a:OK'; end;
  begin perform public.save_survey_round_def(v_a, '{"title":{"ja":"x"},"q":[]}'::jsonb); r := r || ' 2b:NG';
  exception when sqlstate '22023' then r := r || ' 2b:OK'; end;
  begin perform public.save_survey_round_def(gen_random_uuid(), v_def); r := r || ' 2c:NG';
  exception when sqlstate '22023' then r := r || ' 2c:OK'; end;

  -- 3 常勤：写しは表へ直接は書けない（権限が無くて断られても、番人に断られてもよい）
  begin update public.survey_rounds set def_snapshot = v_def2 where id = v_a; r := r || ' 3:NG';
  exception when sqlstate '42501' then r := r || ' 3:OK'; end;
  execute 'reset role';

  -- 4 学生・先生（非常勤）：写しを保存できない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.save_survey_round_def(v_a, v_def); r := r || ' 4:NG';
  exception when sqlstate '42501' then r := r || ' 4:OK'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.save_survey_round_def(v_a, v_def); r := r || ' 4b:NG';
  exception when sqlstate '42501' then r := r || ' 4b:OK'; end;
  execute 'reset role';
  select count(*) into n from public.survey_rounds where id = v_a and def_snapshot is null;
  r := r || case when n = 1 then ' 4c:OK' else ' 4c:NG' end;

  -- 5 常勤：写しを保存できる（key は外れる・時刻が入る）
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.save_survey_round_def(v_a, v_def);
  select def_snapshot, def_snapshot_at into d, ts from public.survey_rounds where id = v_a;
  r := r || case when (j->>'saved')::boolean and d = v_def - 'key' and ts is not null then ' 5:OK' else ' 5:NG' end;

  -- 6 常勤：2回目は何も変えない（saved=false・中身はそのまま）
  j := public.save_survey_round_def(v_a, v_def2);
  select def_snapshot into d from public.survey_rounds where id = v_a;
  r := r || case when (j->>'saved')::boolean = false and d = v_def - 'key' then ' 6:OK' else ' 6:NG' end;

  -- 7 常勤：入った写しは表へ直接でも変えられない・空に戻せない
  begin update public.survey_rounds set def_snapshot = v_def2 where id = v_a; r := r || ' 7a:NG';
  exception when sqlstate '23514' or sqlstate '42501' then r := r || ' 7a:OK'; end;
  begin update public.survey_rounds set def_snapshot = null where id = v_a; r := r || ' 7b:NG';
  exception when sqlstate '23514' or sqlstate '42501' then r := r || ' 7b:OK'; end;

  -- 8 常勤：表へ直接 insert しても写しは入らない（insert 自体が断られてもよい）
  begin
    insert into public.survey_rounds (survey_key, title, student_ids, def_snapshot)
    values ('test_ui', '写しの検査B ' || v_tag, array[v_s], v_def2)
    returning id into v_b;
    select def_snapshot into d from public.survey_rounds where id = v_b;
    r := r || case when d is null then ' 8:OK' else ' 8:NG' end;
  exception when sqlstate '42501' then r := r || ' 8:OK(insert不可)'; end;

  -- 9 常勤：写しがあっても、回を閉じる・取り消すは今までどおり通る（写しは変わらない）
  -- ★同じ取引の中では now() が動かないので、始めた時刻を1時間前にずらしてから閉じる（「締切は開始より後」の決まりに当たらないように）
  execute 'reset role';
  update public.survey_rounds set opens_at = opens_at - interval '1 hour' where id = v_a;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.close_survey_round(v_a, true);
  select count(*) into n from public.survey_rounds where id = v_a and is_void and def_snapshot = v_def - 'key';
  r := r || case when n = 1 then ' 9:OK' else ' 9:NG' end;
  execute 'reset role';

  -- 10 管理者の権限（SQL エディタ）でも、入った写しは変えられない
  begin update public.survey_rounds set def_snapshot = v_def2 where id = v_a; r := r || ' 10:NG';
  exception when sqlstate '23514' then r := r || ' 10:OK'; end;

  -- 11 画面で作った定義：回をはじめた瞬間にサーバーが写す（画面は何も送らない）
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.save_survey_def(null, v_def);
  v_key := j->>'survey_key';
  perform public.set_survey_def_status(v_key, 'published');
  j := public.start_survey_round(v_key, '写しの検査C ' || v_tag, '{}', array[v_s], now() + interval '20 minutes');
  v_c := (j->>'round_id')::uuid;
  select def_snapshot, def_snapshot_at into d, ts from public.survey_rounds where id = v_c;
  r := r || case when d = (select def from public.survey_defs where survey_key = v_key) and ts is not null
                 then ' 11:OK' else ' 11:NG' end;
  -- 12 その回へ別の中身を送っても変わらない
  j := public.save_survey_round_def(v_c, v_def2);
  select def_snapshot into d from public.survey_rounds where id = v_c;
  r := r || case when (j->>'saved')::boolean = false and d = v_def - 'key' then ' 12:OK' else ' 12:NG' end;
  execute 'reset role';

  -- 13 学生：自分に開いている回の一覧（RPC）は今までどおり＝写しを含まない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_open_survey_rounds();
  select count(*) into n from jsonb_array_elements(j) e where e ? 'def_snapshot';
  r := r || case when n = 0 and j @> jsonb_build_array(jsonb_build_object('round_id', v_c)) then ' 13:OK' else ' 13:NG' end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
