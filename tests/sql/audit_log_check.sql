-- audit_log（操作の記録）と、権限を変える RPC の検査（2026-11-22）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-21_capabilities.sql と db/2026-11-22_audit_log.sql の、begin と commit の「あいだ」を
--           この順でこのファイルの上に貼り、全体を begin; … rollback; で包んで1回で流す
--           🔴 貼るときに commit; の行を入れない（入れると取り消されずに残る。流す前に目で見ること）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミー（role ごとに student_no の若い1人）を使う。値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_m2 uuid; v_t uuid; v_s uuid;
  r text := ''; n int; n0 int; t text;
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into v_s from public.profiles where role = 'student' order by student_no limit 1;
  select count(*) into n0 from public.audit_log;

  -- 1 学生：開いた記録を書けない・読めない・直接も書けない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_view('student_list'); r := r || ' 1a:NG';
  exception when sqlstate '42501' then r := r || ' 1a:OK'; end;
  select count(*) into n from public.audit_log;
  r := r || case when n = 0 then ' 1b:OK' else ' 1b:NG' end;
  begin insert into public.audit_log (actor_id, actor_role, action) values (v_s, 'x', 'x'); r := r || ' 1c:NG';
  exception when sqlstate '42501' then r := r || ' 1c:OK'; end;
  begin perform public.set_staff_cap(v_t, 'survey.read', true, '検査'); r := r || ' 1d:NG';
  exception when sqlstate '42501' then r := r || ' 1d:OK'; end;
  execute 'reset role';

  -- 2 先生：開いた記録は残る（同じものは10分に1行）。決まりに無い画面は断る。記録は読めない。権限は変えられない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.log_view('retest_list', 'class', '検査クラス');
  perform public.log_view('retest_list', 'class', '検査クラス');
  perform public.log_view('retest_list', 'class', '別の検査クラス');
  begin perform public.log_view('そんな画面は無い'); r := r || ' 2a:NG';
  exception when sqlstate '22023' then r := r || ' 2a:OK'; end;
  select count(*) into n from public.audit_log;
  r := r || case when n = 0 then ' 2b:OK' else ' 2b:NG' end;
  begin perform public.set_staff_cap(v_t, 'survey.read', true, '検査'); r := r || ' 2c:NG';
  exception when sqlstate '42501' then r := r || ' 2c:OK'; end;
  begin perform public.set_staff_bundle(v_t, 'info_admin', '検査'); r := r || ' 2d:NG';
  exception when sqlstate '42501' then r := r || ' 2d:OK'; end;
  execute 'reset role';
  select count(*) into n from public.audit_log where actor_id = v_t and action = 'view.retest_list';
  r := r || case when n = 2 then ' 2e:OK' else ' 2e:NG(' || n || ')' end;
  select count(*) into n from public.audit_log where actor_id = v_t and actor_role = 'teacher';
  r := r || case when n = 2 then ' 2f:OK' else ' 2f:NG' end;

  -- 3 マスター（常勤）：記録は読めない・権限は変えられない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.audit_log;
  r := r || case when n = 0 then ' 3a:OK' else ' 3a:NG' end;
  begin perform public.set_staff_cap(v_t, 'survey.read', true, '検査'); r := r || ' 3b:NG';
  exception when sqlstate '42501' then r := r || ' 3b:OK'; end;
  execute 'reset role';

  -- 4 情報管理者：足す → できる・記録に残る
  update public.profiles set bundle = 'info_admin' where id = v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_staff_cap(v_t, 'survey.read', true, '検査の承認者');
  select count(*) into n from public.staff_caps where profile_id = v_t and cap_key = 'survey.read' and granted;
  r := r || case when n = 1 then ' 4a:OK' else ' 4a:NG' end;
  select count(*) into n from public.audit_log
   where action = 'caps.set' and target_id = v_t::text and detail->>'cap' = 'survey.read' and detail->>'approver' = '検査の承認者';
  r := r || case when n = 1 then ' 4b:OK' else ' 4b:NG' end;
  -- 外す → 束どおりに戻す
  perform public.set_staff_cap(v_t, 'quiz.run', false, '検査の承認者');
  perform public.set_staff_cap(v_t, 'quiz.run', null, '検査の承認者');
  select count(*) into n from public.staff_caps where profile_id = v_t and cap_key = 'quiz.run';
  r := r || case when n = 0 then ' 4c:OK' else ' 4c:NG' end;
  -- 断るもの：承認者なし／一覧に無い鍵／相手が学生／自分の「権限を変える」
  begin perform public.set_staff_cap(v_t, 'survey.read', true, '  '); r := r || ' 4d:NG';
  exception when sqlstate '22023' then r := r || ' 4d:OK'; end;
  begin perform public.set_staff_cap(v_t, 'そんな鍵は無い', true, '検査'); r := r || ' 4e:NG';
  exception when sqlstate '22023' then r := r || ' 4e:OK'; end;
  begin perform public.set_staff_cap(v_s, 'survey.read', true, '検査'); r := r || ' 4f:NG';
  exception when sqlstate '22023' then r := r || ' 4f:OK'; end;
  begin perform public.set_staff_cap(v_m, 'caps.manage', false, '検査'); r := r || ' 4g:NG';
  exception when sqlstate '22023' then r := r || ' 4g:OK'; end;

  -- 5 束の付け替え：先生を常勤に → 記録に前後が残る。自分の束・学生・無い束は断る
  perform public.set_staff_bundle(v_t, 'fulltime', '検査の承認者');
  select bundle into t from public.profiles where id = v_t;
  r := r || case when t = 'fulltime' then ' 5a:OK' else ' 5a:NG' end;
  select count(*) into n from public.audit_log
   where action = 'caps.bundle.set' and target_id = v_t::text and detail->>'after' = 'fulltime' and detail->'before' = 'null'::jsonb;
  r := r || case when n = 1 then ' 5b:OK' else ' 5b:NG' end;
  begin perform public.set_staff_bundle(v_m, 'teacher', '検査'); r := r || ' 5c:NG';
  exception when sqlstate '22023' then r := r || ' 5c:OK'; end;
  begin perform public.set_staff_bundle(v_s, 'teacher', '検査'); r := r || ' 5d:NG';
  exception when sqlstate '22023' then r := r || ' 5d:OK'; end;
  begin perform public.set_staff_bundle(v_t, 'そんな束は無い', '検査'); r := r || ' 5e:NG';
  exception when sqlstate '22023' then r := r || ' 5e:OK'; end;
  perform public.set_staff_bundle(v_t, null, '検査の承認者');

  -- 6 情報管理者は記録を読める。ただし直せない・消せない
  select count(*) into n from public.audit_log;
  r := r || case when n = n0 + 7 then ' 6a:OK' else ' 6a:NG(' || (n - n0) || ')' end;
  begin update public.audit_log set action = 'x'; r := r || ' 6b:NG';
  exception when sqlstate '42501' then r := r || ' 6b:OK'; end;
  begin delete from public.audit_log; r := r || ' 6c:NG';
  exception when sqlstate '42501' then r := r || ' 6c:OK'; end;
  -- 記録の actor_role は、そのときの束
  select count(*) into n from public.audit_log where actor_id = v_m and actor_role = 'info_admin';
  r := r || case when n = 5 then ' 6d:OK' else ' 6d:NG(' || n || ')' end;
  execute 'reset role';

  -- 7 未ログイン（anon）は呼べない・読めない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.log_view('student_list'); r := r || ' 7a:NG';
  exception when sqlstate '42501' then r := r || ' 7a:OK'; end;
  begin perform public.set_staff_cap(v_t, 'survey.read', true, '検査'); r := r || ' 7b:NG';
  exception when sqlstate '42501' then r := r || ' 7b:OK'; end;
  begin select count(*) into n from public.audit_log; r := r || ' 7c:NG';
  exception when sqlstate '42501' then r := r || ' 7c:OK'; end;
  execute 'reset role';

  -- 8 記録を書く口（app_hidden.audit）は、ログイン中の人が直接は呼べない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform app_hidden.audit('x', null, null, '{}'::jsonb); r := r || ' 8:NG';
  exception when sqlstate '42501' then r := r || ' 8:OK'; end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
