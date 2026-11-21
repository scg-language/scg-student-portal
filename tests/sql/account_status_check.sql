-- アカウントの状態と担任の検査（2026-11-22）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-22_account_status.sql の begin と commit の「あいだ」をこのファイルの上に貼り、
--           全体を begin; … rollback; で包んで1回で流す。🔴 貼るときに commit; の行を入れない（流す前に目で見る）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   前提：1本目・2本目が適用済みで、「アカウントの管理」を持つマスターが1人いること（情報管理者の束）
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミーを使う。値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_t uuid; v_s uuid; v_s2 uuid; v_qs uuid; v_run uuid;
  r text := ''; n int; j jsonb; t text; t2 text; d date; ts timestamptz;
begin
  select id into v_m from public.profiles where role = 'master' and bundle = 'info_admin' order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into v_s  from public.profiles where role = 'student' order by student_no limit 1;
  select id into v_s2 from public.profiles where role = 'student' order by student_no offset 1 limit 1;
  select quiz_set_id into v_qs from public.questions group by quiz_set_id order by count(*) limit 1;
  r := r || case when v_m is not null and v_qs is not null then ' pre:OK' else ' pre:NG' end;

  -- N 学籍番号の形（7桁だけ。全角・ハイフンは取る。9桁・6桁・文字は通さない）
  r := r || case when app_hidden.normalize_student_no('2604999') = '2604999'
                  and app_hidden.normalize_student_no('２６０４９９９') = '2604999'
                  and app_hidden.normalize_student_no(' 26-04999 ') = '2604999'
                  and app_hidden.normalize_student_no('26－04999') = '2604999' then ' N1:OK' else ' N1:NG' end;
  r := r || case when app_hidden.normalize_student_no('250401999') is null
                  and app_hidden.normalize_student_no('260499') is null
                  and app_hidden.normalize_student_no('s001') is null
                  and app_hidden.normalize_student_no(null) is null then ' N2:OK' else ' N2:NG' end;

  -- A 流した直後は全員が在籍
  select count(*) into n from public.profiles where status <> 'active';
  r := r || case when n = 0 then ' A:OK' else ' A:NG' end;

  -- B 在籍の学生は、今までどおり受けて出せる（実施回を1つ作って、本物の提出の関数を通す）
  insert into public.quiz_runs (quiz_set_id, student_ids, opens_at, closes_at, duration_min, created_by)
  values (v_qs, array[v_s, v_s2], now() - interval '1 minute', now() + interval '10 minutes', 10, v_m)
  returning id into v_run;
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_open_runs();
  r := r || case when j @> jsonb_build_array(jsonb_build_object('run_id', v_run)) then ' B1:OK' else ' B1:NG' end;
  j := public.submit_attempt(v_qs, '{}'::jsonb, 1000, v_run);
  r := r || case when j ? 'attempt_id' then ' B2:OK' else ' B2:NG' end;
  r := r || case when jsonb_typeof(public.my_open_survey_rounds()) = 'array' then ' B3:OK' else ' B3:NG' end;
  execute 'reset role';
  select count(*) into n from public.attempts where student_id = v_s and run_id = v_run;
  r := r || case when n = 1 then ' B4:OK' else ' B4:NG' end;
  insert into public.attempt_focus (student_id, quiz_set_id, away_count, away_ms) values (v_s, v_qs, 0, 0)
  on conflict do nothing;
  r := r || ' B5:OK';

  -- C 権限：学生・先生・未ログインは状態を変えられない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.set_account_status(v_s2, 'graduated'); r := r || ' C1:NG';
  exception when sqlstate '42501' then r := r || ' C1:OK'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.set_account_status(v_s2, 'graduated'); r := r || ' C2:NG';
  exception when sqlstate '42501' then r := r || ' C2:OK'; end;
  begin perform public.set_homeroom(array[v_s], v_m); r := r || ' C3:NG';
  exception when sqlstate '42501' then r := r || ' C3:OK'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.set_account_status(v_s2, 'graduated'); r := r || ' C4:NG';
  exception when sqlstate '42501' then r := r || ' C4:OK'; end;
  begin perform public.my_homeroom_name(); r := r || ' C5:NG';
  exception when sqlstate '42501' then r := r || ' C5:OK'; end;
  execute 'reset role';

  -- D 卒業生にする → 記録は読めるが、開いている回は出ず、受ける・出すは通らない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.set_account_status(v_s2, 'graduated');
  r := r || case when j->>'before' = 'active' and j->>'after' = 'graduated' then ' D1:OK' else ' D1:NG' end;
  begin perform public.set_account_status(v_s2, 'そんな状態は無い'); r := r || ' D2:NG';
  exception when sqlstate '22023' then r := r || ' D2:OK'; end;
  begin perform public.set_account_status(v_t, 'graduated'); r := r || ' D3:NG';
  exception when sqlstate 'P0002' then r := r || ' D3:OK'; end;
  execute 'reset role';
  select status, graduated_on into t, d from public.profiles where id = v_s2;
  r := r || case when t = 'graduated' and d = current_date then ' D4:OK' else ' D4:NG' end;
  select count(*) into n from public.audit_log
   where action = 'account.status.set' and target_id = v_s2::text and detail->>'after' = 'graduated';
  r := r || case when n = 1 then ' D5:OK' else ' D5:NG' end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when public.my_open_runs() = '[]'::jsonb then ' D6:OK' else ' D6:NG' end;
  r := r || case when public.my_open_survey_rounds() = '[]'::jsonb then ' D7:OK' else ' D7:NG' end;
  begin perform public.submit_attempt(v_qs, '{}'::jsonb, 1000, v_run); r := r || ' D8:NG';
  exception when sqlstate '42501' then r := r || ' D8:OK'; end;
  select count(*) into n from public.profiles where id = v_s2;
  r := r || case when n = 1 then ' D9:OK' else ' D9:NG' end;
  execute 'reset role';
  begin insert into public.attempt_focus (student_id, quiz_set_id, away_count, away_ms) values (v_s2, v_qs, 0, 0); r := r || ' D10:NG';
  exception when sqlstate '42501' then r := r || ' D10:OK'; end;
  begin insert into public.survey_responses (student_id, survey_key, answers) values (v_s2, 'check_only', '{}'::jsonb); r := r || ' D11:NG';
  exception when sqlstate '42501' then r := r || ' D11:OK'; end;

  -- E 退学にする → ログインが止まる。在籍に戻す → 止めが外れ、また出せる
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_account_status(v_s2, 'withdrawn');
  execute 'reset role';
  select banned_until into ts from auth.users where id = v_s2;
  select status, graduated_on into t, d from public.profiles where id = v_s2;
  r := r || case when ts > now() + interval '50 years' and t = 'withdrawn' and d is null then ' E1:OK' else ' E1:NG' end;
  select count(*) into n from auth.sessions where user_id = v_s2;
  r := r || case when n = 0 then ' E2:OK' else ' E2:NG' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_account_status(v_s2, 'active');
  execute 'reset role';
  select banned_until into ts from auth.users where id = v_s2;
  r := r || case when ts is null then ' E3:OK' else ' E3:NG' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.submit_attempt(v_qs, '{}'::jsonb, 1000, v_run);
  r := r || case when j ? 'attempt_id' then ' E4:OK' else ' E4:NG' end;
  execute 'reset role';

  -- F 決まり：職員は在籍のまま・担任は学生にだけ付く
  begin update public.profiles set status = 'graduated' where id = v_t; r := r || ' F1:NG';
  exception when check_violation then r := r || ' F1:OK'; end;
  begin update public.profiles set homeroom_id = v_m where id = v_t; r := r || ' F2:NG';
  exception when check_violation then r := r || ' F2:OK'; end;

  -- H 担任：付ける → 学生は担任の名前だけ読める → 外す。先生（非常勤）は担任にできない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.set_homeroom(array[v_s, v_s2], v_m);
  r := r || case when n = 2 then ' H1:OK' else ' H1:NG' end;
  begin perform public.set_homeroom(array[v_s], v_t); r := r || ' H2:NG';
  exception when sqlstate '22023' then r := r || ' H2:OK'; end;
  begin perform public.set_homeroom('{}'::uuid[], v_m); r := r || ' H3:NG';
  exception when sqlstate '22023' then r := r || ' H3:OK'; end;
  execute 'reset role';
  select display_name into t2 from public.profiles where id = v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  t := public.my_homeroom_name();
  r := r || case when t = t2 then ' H4:OK' else ' H4:NG' end;
  -- 学生は、担任の行そのもの（職員の名簿）は読めないまま
  select count(*) into n from public.profiles where id = v_m;
  r := r || case when n = 0 then ' H5:OK' else ' H5:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := public.set_homeroom(array[v_s, v_s2], null);
  r := r || case when n = 2 then ' H6:OK' else ' H6:NG' end;
  execute 'reset role';
  select count(*) into n from public.audit_log where action = 'homeroom.set' and (detail->>'students')::int = 2;
  r := r || case when n = 2 then ' H7:OK' else ' H7:NG' end;
  select count(*) into n from public.profiles where homeroom_id is not null;
  r := r || case when n = 0 then ' H8:OK' else ' H8:NG' end;

  raise exception 'RESULT%', r;
end $$;
