-- capabilities（できること）の検査（2026-11-21）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-21_capabilities.sql の begin と commit の「あいだ」をこのファイルの上に貼り、
--           全体を begin; … rollback; で包んで1回で流す（Supabase MCP の execute_sql でよい）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミー（role ごとに student_no の若い1人）を使う。値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_t uuid; v_s uuid;
  r text := ''; b boolean; n int; a text[];
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into v_s from public.profiles where role = 'student' order by student_no limit 1;

  -- 0 束の件数（teacher 3 / fulltime 13 / info_admin 17）★11/25 に first_login.check（情報管理者だけ）を足して 16→17
  select count(*) into n from public.cap_bundles where bundle = 'teacher';
  r := r || case when n = 3 then ' 0a:OK' else ' 0a:NG(' || n || ')' end;
  select count(*) into n from public.cap_bundles where bundle = 'fulltime';
  r := r || case when n = 13 then ' 0b:OK' else ' 0b:NG(' || n || ')' end;
  select count(*) into n from public.cap_bundles where bundle = 'info_admin';
  r := r || case when n = 17 then ' 0c:OK' else ' 0c:NG(' || n || ')' end;

  -- 1 学生：何もできない。一覧も束も読めない。直接は書けない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  a := public.my_caps();
  r := r || case when coalesce(array_length(a, 1), 0) = 0 then ' 1a:OK' else ' 1a:NG' end;
  select count(*) into n from public.capabilities;
  r := r || case when n = 0 then ' 1b:OK' else ' 1b:NG' end;
  select count(*) into n from public.cap_bundles;
  r := r || case when n = 0 then ' 1c:OK' else ' 1c:NG' end;
  begin insert into public.staff_caps (profile_id, cap_key, granted) values (v_s, 'caps.manage', true); r := r || ' 1d:NG';
  exception when sqlstate '42501' then r := r || ' 1d:OK'; end;
  execute 'reset role';

  -- 2 先生（bundle が null → teacher）：3つだけ。一覧は読める・束は読めない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  a := public.my_caps();
  r := r || case when a = array['quiz.run', 'retest.run', 'quiz.result.one'] then ' 2a:OK' else ' 2a:NG' end;
  r := r || case when app_hidden.can('quiz.edit') = false and app_hidden.can('quiz.result.export') = false then ' 2b:OK' else ' 2b:NG' end;
  select count(*) into n from public.capabilities;
  r := r || case when n = 17 then ' 2c:OK' else ' 2c:NG' end;
  select count(*) into n from public.cap_bundles;
  r := r || case when n = 0 then ' 2d:OK' else ' 2d:NG' end;
  begin update public.profiles set bundle = 'info_admin' where id = v_t; get diagnostics n = row_count;
        r := r || case when n = 0 then ' 2e:OK' else ' 2e:NG' end;
  exception when sqlstate '42501' then r := r || ' 2e:OK'; end;
  execute 'reset role';

  -- 3 マスター（bundle が null → fulltime）：13。アカウントの管理・操作の記録・権限の変更はできない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  a := public.my_caps();
  r := r || case when array_length(a, 1) = 13 then ' 3a:OK' else ' 3a:NG' end;
  r := r || case when not app_hidden.can('account.manage') and not app_hidden.can('audit.read') and not app_hidden.can('caps.manage')
                 then ' 3b:OK' else ' 3b:NG' end;
  r := r || case when app_hidden.can('quiz.edit') and app_hidden.can('student.pwreset') then ' 3c:OK' else ' 3c:NG' end;
  r := r || case when app_hidden.can('そんな鍵は無い') = false then ' 3d:OK' else ' 3d:NG' end;
  execute 'reset role';

  -- 4 情報管理者の印を付けると 17。束も読める
  update public.profiles set bundle = 'info_admin' where id = v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  a := public.my_caps();
  r := r || case when array_length(a, 1) = 17 then ' 4a:OK' else ' 4a:NG' end;
  select count(*) into n from public.cap_bundles;
  r := r || case when n = 33 then ' 4b:OK' else ' 4b:NG(' || n || ')' end;
  execute 'reset role';
  update public.profiles set bundle = null where id = v_m;

  -- 5 人ごとの足し引き：先生に1つ足す → できる／マスターから1つ外す → できない
  insert into public.staff_caps (profile_id, cap_key, granted) values (v_t, 'survey.read', true), (v_m, 'quiz.edit', false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when app_hidden.can('survey.read') and array_length(public.my_caps(), 1) = 4 then ' 5a:OK' else ' 5a:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when not app_hidden.can('quiz.edit') and array_length(public.my_caps(), 1) = 12 then ' 5b:OK' else ' 5b:NG' end;
  execute 'reset role';

  -- 6 学生に足しても、できるようにならない（職員だけ）
  insert into public.staff_caps (profile_id, cap_key, granted) values (v_s, 'quiz.edit', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when not app_hidden.can('quiz.edit') then ' 6:OK' else ' 6:NG' end;
  execute 'reset role';

  -- 7 学生に束は付けられない（CHECK）
  begin update public.profiles set bundle = 'teacher' where id = v_s; r := r || ' 7:NG';
  exception when check_violation then r := r || ' 7:OK'; end;

  -- 8 未ログイン（anon）は呼べない・読めない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.my_caps(); r := r || ' 8a:NG';
  exception when sqlstate '42501' then r := r || ' 8a:OK'; end;
  begin select count(*) into n from public.capabilities; r := r || ' 8b:NG';
  exception when sqlstate '42501' then r := r || ' 8b:OK'; end;
  execute 'reset role';

  -- 9 既存の判定は変わっていない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when app_hidden.is_teacher() and not app_hidden.is_master() then ' 9:OK' else ' 9:NG' end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
