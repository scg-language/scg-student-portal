-- はじめてのログインの受付（first_login_board / first_login_mark）の検査（2026-11-25）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-25_first_login_board.sql の begin と commit の「あいだ」をこのファイルの上に貼り、
--           全体を begin; … rollback; で包んで1回で流す（Supabase MCP の execute_sql でよい）
--           🔴 貼るときに commit; の行を入れない（入れると取り消されずに残る。流す前に目で見ること）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミー（学籍番号が7けたの数字でない学生＝s001 など）を使う。値は出さない（出すのは OK/NG と件数だけ）
--   ★ダミー2人のパスワードとログインの時刻・マスターのダミーの束（info_admin）・先生のダミーの足し算を書き換えるが、
--     全体がロールバックされるので本番の値は変わらない
do $$
declare
  v_m uuid; v_t uuid; v_s uuid; v_no text; v_s2 uuid; v_no2 text; v_class text;
  r text := ''; n int; n0 int; j jsonb; h text;
  claims_m text; claims_t text; claims_s text;
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id, student_no, class_name into v_s, v_no, v_class from public.profiles
   where role = 'student' and status = 'active' and class_name is not null and student_no !~ '^\d{7}$'
   order by student_no limit 1;
  select id, student_no into v_s2, v_no2 from public.profiles
   where role = 'student' and status = 'active' and class_name = v_class and id <> v_s and student_no !~ '^\d{7}$'
   order by student_no limit 1;
  select count(*) into n0 from public.profiles where role = 'student' and status = 'active' and class_name = v_class;
  claims_m := json_build_object('sub', v_m, 'role', 'authenticated')::text;
  claims_t := json_build_object('sub', v_t, 'role', 'authenticated')::text;
  claims_s := json_build_object('sub', v_s, 'role', 'authenticated')::text;
  r := r || case when v_m is not null and v_t is not null and v_s is not null and v_s2 is not null then ' 0a:OK' else ' 0a:NG(ダミーが足りない)' end;

  -- 準備：1人目＝今日ログインした・初期パスワードのまま／2人目＝今日ログインした・決め直した
  update auth.users set encrypted_password = extensions.crypt('scg' || lower(v_no), extensions.gen_salt('bf', 4)),
                        last_sign_in_at = now() - interval '3 minutes' where id = v_s;
  update auth.users set encrypted_password = extensions.crypt('Check1234x', extensions.gen_salt('bf', 4)),
                        last_sign_in_at = now() - interval '2 minutes' where id = v_s2;

  -- 1 学生は呼べない
  perform set_config('request.jwt.claims', claims_s, true);
  execute 'set local role authenticated';
  begin perform public.first_login_board(null); r := r || ' 1a:NG';
  exception when sqlstate '42501' then r := r || ' 1a:OK'; end;
  begin perform public.first_login_mark(v_s, true); r := r || ' 1b:NG';
  exception when sqlstate '42501' then r := r || ' 1b:OK'; end;
  execute 'reset role';

  -- 2 先生（名簿を見られない）は呼べない
  perform set_config('request.jwt.claims', claims_t, true);
  execute 'set local role authenticated';
  begin perform public.first_login_board(null); r := r || ' 2a:NG';
  exception when sqlstate '42501' then r := r || ' 2a:OK'; end;
  begin perform public.first_login_mark(v_s2, true); r := r || ' 2b:NG';
  exception when sqlstate '42501' then r := r || ' 2b:OK'; end;
  execute 'reset role';

  -- 3 未ログイン（anon）は呼べない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.first_login_board(null); r := r || ' 3a:NG';
  exception when sqlstate '42501' then r := r || ' 3a:OK'; end;
  begin perform public.first_login_mark(v_s2, true); r := r || ' 3b:NG';
  exception when sqlstate '42501' then r := r || ' 3b:OK'; end;
  execute 'reset role';

  -- 3c できることは1つ増え、情報管理者の束にだけ入っている
  select count(*) into n from public.capabilities where key = 'first_login.check';
  select count(*) into n0 from public.cap_bundles where cap_key = 'first_login.check';
  r := r || case when n = 1 and n0 = 1 and exists (select 1 from public.cap_bundles where cap_key = 'first_login.check' and bundle = 'info_admin')
                  then ' 3c:OK' else ' 3c:NG' end;
  select count(*) into n0 from public.profiles where role = 'student' and status = 'active' and class_name = v_class;   -- 下で使う人数に戻す

  -- 3d 常勤のマスター（束が null → fulltime）は呼べない（2026-11-25 きあ「とりあえず情報管理者だけ」）
  update public.profiles set bundle = null where id = v_m;
  perform set_config('request.jwt.claims', claims_m, true);
  execute 'set local role authenticated';
  begin perform public.first_login_board(null); r := r || ' 3d:NG';
  exception when sqlstate '42501' then r := r || ' 3d:OK'; end;
  begin perform public.first_login_mark(v_s2, true); r := r || ' 3e:NG';
  exception when sqlstate '42501' then r := r || ' 3e:OK'; end;
  r := r || case when not ('first_login.check' = any(public.my_caps())) then ' 3f:OK' else ' 3f:NG' end;
  execute 'reset role';

  -- ここから先のマスターは情報管理者（ロールバックで元に戻る）
  update public.profiles set bundle = 'info_admin' where id = v_m;

  -- 4 マスター（情報管理者）：受付中に2人が出る。1人目は「まだ」、2人目は「決め直した」。ログインの古い順
  perform set_config('request.jwt.claims', claims_m, true);
  execute 'set local role authenticated';
  j := public.first_login_board(null);
  r := r || case when j ? 'today' and jsonb_typeof(j->'classes') = 'array' and jsonb_typeof(j->'active') = 'array'
                  and jsonb_typeof(j->'done') = 'array' and j->'rows' = 'null'::jsonb then ' 4a:OK' else ' 4a:NG' end;
  r := r || case when exists (select 1 from jsonb_array_elements(j->'active') e where e->>'id' = v_s::text and e->>'pw' = 'initial')
                  then ' 4b:OK' else ' 4b:NG' end;
  r := r || case when exists (select 1 from jsonb_array_elements(j->'active') e where e->>'id' = v_s2::text and e->>'pw' = 'changed')
                  then ' 4c:OK' else ' 4c:NG' end;
  r := r || case when (select min(o) from jsonb_array_elements(j->'active') with ordinality x(e, o) where e->>'id' = v_s::text)
                    < (select min(o) from jsonb_array_elements(j->'active') with ordinality x(e, o) where e->>'id' = v_s2::text)
                  then ' 4d:OK' else ' 4d:NG' end;
  -- クラスの一覧は人数だけ（名前・学籍番号を持たない）
  r := r || case when not exists (select 1 from jsonb_array_elements(j->'classes') e where e ? 'name' or e ? 'student_no')
                  and exists (select 1 from jsonb_array_elements(j->'classes') e where e->>'class' = v_class and (e->>'target')::int = n0)
                  then ' 4e:OK' else ' 4e:NG' end;

  -- 5 決め直していない学生は「確認済み」にできない
  begin perform public.first_login_mark(v_s, true); r := r || ' 5:NG';
  exception when sqlstate 'PT409' then r := r || ' 5:OK'; end;

  -- 6 決め直した学生は「確認済み」にできる。受付中から消えて、今日の確認済みに出る
  j := public.first_login_mark(v_s2, true);
  r := r || case when (j->>'changed')::boolean and (j->>'checked')::boolean then ' 6a:OK' else ' 6a:NG' end;
  j := public.first_login_board(null);
  r := r || case when not exists (select 1 from jsonb_array_elements(j->'active') e where e->>'id' = v_s2::text)
                  and exists (select 1 from jsonb_array_elements(j->'done') e where e->>'id' = v_s2::text and e->>'checked_at' is not null)
                  then ' 6b:OK' else ' 6b:NG' end;
  -- 同じ状態をもう一度送っても行は増えない
  j := public.first_login_mark(v_s2, true);
  r := r || case when not (j->>'changed')::boolean then ' 6c:OK' else ' 6c:NG' end;

  -- 7 表を直接は読めない・書けない（マスターでも）。控えの表も見えない
  begin select count(*) into n from public.first_login_checks; r := r || ' 7a:NG';
  exception when sqlstate '42501' then r := r || ' 7a:OK'; end;
  begin insert into public.first_login_checks (student_id, checked, actor_id) values (v_s, true, v_m); r := r || ' 7b:NG';
  exception when sqlstate '42501' then r := r || ' 7b:OK'; end;
  begin select count(*) into n from app_hidden.pw_initial_cache; r := r || ' 7c:NG';
  exception when sqlstate '42501' then r := r || ' 7c:OK'; end;
  execute 'reset role';

  select count(*) into n from public.first_login_checks where student_id = v_s2;
  r := r || case when n = 1 then ' 7d:OK' else ' 7d:NG(' || n || ')' end;

  -- 8 1人目がパスワードを決め直す → 控えが自動で無効になり「決め直した」に変わる。控えには md5 だけ
  update auth.users set encrypted_password = extensions.crypt('Check5678y', extensions.gen_salt('bf', 4)) where id = v_s;
  perform set_config('request.jwt.claims', claims_m, true);
  execute 'set local role authenticated';
  j := public.first_login_board(null);
  r := r || case when exists (select 1 from jsonb_array_elements(j->'active') e where e->>'id' = v_s::text and e->>'pw' = 'changed')
                  then ' 8a:OK' else ' 8a:NG' end;
  execute 'reset role';
  select encrypted_password into h from auth.users where id = v_s;
  select count(*) into n from app_hidden.pw_initial_cache where user_id = v_s and digest = md5(h) and not is_initial;
  r := r || case when n = 1 then ' 8b:OK' else ' 8b:NG' end;

  -- 9 取り消す → 受付中に戻る。記録は消さずに1行足す
  perform set_config('request.jwt.claims', claims_m, true);
  execute 'set local role authenticated';
  j := public.first_login_mark(v_s2, false);
  r := r || case when (j->>'changed')::boolean and not (j->>'checked')::boolean then ' 9a:OK' else ' 9a:NG' end;
  j := public.first_login_board(null);
  r := r || case when exists (select 1 from jsonb_array_elements(j->'active') e where e->>'id' = v_s2::text)
                  and not exists (select 1 from jsonb_array_elements(j->'done') e where e->>'id' = v_s2::text)
                  then ' 9b:OK' else ' 9b:NG' end;
  execute 'reset role';
  select count(*) into n from public.first_login_checks where student_id = v_s2;
  r := r || case when n = 2 then ' 9c:OK' else ' 9c:NG(' || n || ')' end;

  -- 10 クラスを開く：そのクラスの全員が出る。状態も付く
  perform set_config('request.jwt.claims', claims_m, true);
  execute 'set local role authenticated';
  j := public.first_login_board(v_class);
  r := r || case when jsonb_array_length(j->'rows') = n0 then ' 10a:OK' else ' 10a:NG' end;
  r := r || case when exists (select 1 from jsonb_array_elements(j->'rows') e
                               where e->>'id' = v_s::text and e->>'pw' = 'changed' and not (e->>'checked')::boolean and e->>'signed_at' is not null)
                  then ' 10b:OK' else ' 10b:NG' end;

  -- 11 おかしな指定は断る
  begin perform public.first_login_board(''); r := r || ' 11a:NG';
  exception when sqlstate '22023' then r := r || ' 11a:OK'; end;
  begin perform public.first_login_board(repeat('x', 81)); r := r || ' 11b:NG';
  exception when sqlstate '22023' then r := r || ' 11b:OK'; end;
  begin perform public.first_login_mark(v_t, true); r := r || ' 11c:NG';
  exception when sqlstate 'P0002' then r := r || ' 11c:OK'; end;
  begin perform public.first_login_mark(gen_random_uuid(), true); r := r || ' 11d:NG';
  exception when sqlstate 'P0002' then r := r || ' 11d:OK'; end;
  begin perform public.first_login_mark(v_s, null); r := r || ' 11e:NG';
  exception when sqlstate '22023' then r := r || ' 11e:OK'; end;
  execute 'reset role';

  -- 12 開いたことは記録に残る。何度開いても、同じ対象は10分に1行
  select count(*) into n from public.audit_log
   where actor_id = v_m and action = 'view.first_login' and target_type = 'first_login' and target_id = 'all' and at > now() - interval '10 minutes';
  r := r || case when n = 1 then ' 12a:OK' else ' 12a:NG(' || n || ')' end;
  select count(*) into n from public.audit_log
   where actor_id = v_m and action = 'view.first_login' and target_type = 'class' and target_id = v_class and at > now() - interval '10 minutes';
  r := r || case when n = 1 then ' 12b:OK' else ' 12b:NG(' || n || ')' end;

  -- 13 当日もう1人に使わせる：先生に first_login.check だけを足すと使える（発行の権限は付かない）
  insert into public.staff_caps (profile_id, cap_key, granted) values (v_t, 'first_login.check', true);
  perform set_config('request.jwt.claims', claims_t, true);
  execute 'set local role authenticated';
  j := public.first_login_board(null);
  r := r || case when jsonb_typeof(j->'active') = 'array' then ' 13a:OK' else ' 13a:NG' end;
  r := r || case when 'first_login.check' = any(public.my_caps()) and not app_hidden.can('account.manage') then ' 13b:OK' else ' 13b:NG' end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
