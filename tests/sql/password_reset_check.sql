-- password_reset の検査（2026-11-20）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-20_password_reset.sql の begin と commit の「あいだ」をこのファイルの上に貼り、
--           全体を begin; … rollback; で包んで1回で流す（Supabase MCP の execute_sql でよい）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミー（role ごとに student_no の若い1人）を使う。パスワードは戻した後に元のハッシュへ戻すが、
--     そもそも全体がロールバックされるので本番の値は変わらない
do $$
declare
  v_m uuid; v_t uuid; v_s uuid; v_no text;
  r text := ''; b boolean; n int; j jsonb; h text;
  v_sess uuid := gen_random_uuid();
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id, student_no into v_s, v_no from public.profiles where role = 'student' order by student_no limit 1;

  -- 戻す前の端末を1つ作っておく（戻したら消えることを見る）
  begin
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sess, v_s, now(), now());
    r := r || ' 0:session-made';
  exception when others then r := r || ' 0:session-skip(' || sqlstate || ')'; end;

  -- 1 学生：デモのパスワードは初期パスワードではない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  b := public.my_password_is_initial();
  r := r || case when b = false then ' 1:OK' else ' 1:NG' end;

  -- 2 学生は戻せない
  begin perform public.reset_student_password(v_s); r := r || ' 2:NG';
  exception when sqlstate '42501' then r := r || ' 2:OK'; end;

  -- 3 学生は履歴を書けない・読めない
  begin insert into public.password_reset_log (actor_id, student_id, student_no) values (v_s, v_s, 'x'); r := r || ' 3a:NG';
  exception when sqlstate '42501' then r := r || ' 3a:OK'; end;
  select count(*) into n from public.password_reset_log;
  r := r || case when n = 0 then ' 3b:OK' else ' 3b:NG' end;
  execute 'reset role';

  -- 4 先生は戻せない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.reset_student_password(v_s); r := r || ' 4:NG';
  exception when sqlstate '42501' then r := r || ' 4:OK'; end;
  execute 'reset role';

  -- 5 未ログイン（anon）は呼べない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.reset_student_password(v_s); r := r || ' 5a:NG';
  exception when sqlstate '42501' then r := r || ' 5a:OK'; end;
  begin perform public.my_password_is_initial(); r := r || ' 5b:NG';
  exception when sqlstate '42501' then r := r || ' 5b:OK'; end;
  execute 'reset role';

  -- 6 マスター：職員は戻せない／いない人は戻せない
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.reset_student_password(v_t); r := r || ' 6a:NG';
  exception when sqlstate 'P0002' then r := r || ' 6a:OK'; end;
  begin perform public.reset_student_password(gen_random_uuid()); r := r || ' 6b:NG';
  exception when sqlstate 'P0002' then r := r || ' 6b:OK'; end;
  -- 7 マスター：学生を戻せる
  j := public.reset_student_password(v_s);
  r := r || case when j->>'student_no' = v_no then ' 7:OK' else ' 7:NG' end;
  -- 8 マスター本人は対象外＝false
  b := public.my_password_is_initial();
  r := r || case when b = false then ' 8:OK' else ' 8:NG' end;
  execute 'reset role';

  -- 9 中身：ハッシュが scg＋番号 になった・端末が消えた・履歴が1行
  select encrypted_password into h from auth.users where id = v_s;
  r := r || case when extensions.crypt('scg' || lower(v_no), h) = h then ' 9a:OK' else ' 9a:NG' end;
  select count(*) into n from auth.sessions where user_id = v_s;
  r := r || case when n = 0 then ' 9b:OK' else ' 9b:NG' end;
  select count(*) into n from public.password_reset_log where student_id = v_s and actor_id = v_m;
  r := r || case when n = 1 then ' 9c:OK' else ' 9c:NG' end;

  -- 10 学生：いまは初期パスワード＝決め直しの画面が出る側
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  b := public.my_password_is_initial();
  r := r || case when b = true then ' 10:OK' else ' 10:NG' end;
  execute 'reset role';

  -- 11 先生は履歴を読める・直せない・消せない
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.password_reset_log where student_id = v_s;
  r := r || case when n = 1 then ' 11a:OK' else ' 11a:NG' end;
  begin update public.password_reset_log set student_no = 'x' where student_id = v_s; r := r || ' 11b:NG';
  exception when sqlstate '42501' then r := r || ' 11b:OK'; end;
  begin delete from public.password_reset_log where student_id = v_s; r := r || ' 11c:NG';
  exception when sqlstate '42501' then r := r || ' 11c:OK'; end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
