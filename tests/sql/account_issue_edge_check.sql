-- 発行を Edge Function に移す SQL（db/2026-11-24_account_issue_edge.sql）の検査（2026-11-24）。
-- ★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-24_account_issue_edge.sql の、begin と commit の「あいだ」を
--           このファイルの上に貼り、全体を begin; … rollback; で包んで1回で流す
--           🔴 貼るときに commit; の行を入れない（入れると取り消されずに残る。流す前に目で見ること）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★学籍番号はダミーの帯（末尾が 999 から降りる）だけを使う。値は出さない（出すのは OK/NG と件数だけ）
--   ★「Edge Function が Auth の管理用 API で作ったアカウント」の代わりに、この検査の中でだけ auth.users に1行を置く
--     （取り消されるので残らない。本物の発行の道では、DB から auth の表には書かない）
do $$
declare
  v_m uuid; v_t uuid; v_s uuid; v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid(); v_u3 uuid := gen_random_uuid();
  v_dom text; v_inst uuid;
  r text := ''; n int; a0 int; j jsonb; t text;
  v_rows jsonb := jsonb_build_array(
    jsonb_build_object('student_no', '2604999',     'display_name', 'テスト太郎', 'class_name', '検査クラス'),
    jsonb_build_object('student_no', '２６-０４９９８', 'display_name', 'テスト花子', 'class_name', '検査クラス'),   -- 全角とハイフン＝取ってから見る
    jsonb_build_object('student_no', 'abc',         'display_name', 'テスト次郎', 'class_name', '検査クラス'),   -- 形がおかしい
    jsonb_build_object('student_no', '26-04999',    'display_name', 'テスト三郎', 'class_name', '検査クラス'),   -- 1行目と同じ番号
    jsonb_build_object('student_no', '2604997',     'display_name', '',           'class_name', '検査クラス'),   -- 氏名が空
    jsonb_build_object('student_no', '2604996',     'display_name', 'テスト桜',   'class_name', ''));            -- クラスが空
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id into v_s from public.profiles where role = 'student' and status = 'active' order by student_no limit 1;
  select split_part(email, '@', 2), instance_id into v_dom, v_inst from auth.users where id = v_m;
  select count(*) into a0 from public.audit_log;

  -- 0 前提：検査に使う番号が、まだ無い／前の口（auth の表へ直接書く関数）が無くなっている
  select count(*) into n from public.profiles where student_no in ('2604999', '2604998', '2604997', '2604996', '2604995');
  r := r || case when n = 0 then ' 0a:OK' else ' 0a:NG' end;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'issue_student_accounts';
  r := r || case when n = 0 then ' 0b:OK' else ' 0b:NG' end;
  -- 新しい3つは、auth の表に書かない（定義の中に insert into auth / update auth / delete from auth が無い）
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('issue_precheck', 'issue_attach_profile', 'issue_log')
     and pg_get_functiondef(p.oid) ~* '(insert\s+into|update|delete\s+from)\s+auth\.';
  r := r || case when n = 0 then ' 0c:OK' else ' 0c:NG' end;

  -- 1 学生・先生・常勤（マスター）は、3つとも呼べない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_precheck(v_rows); r := r || ' 1a:NG';
  exception when sqlstate '42501' then r := r || ' 1a:OK'; end;
  begin perform public.issue_attach_profile(v_u1, '2604999', 'テスト太郎', '検査クラス'); r := r || ' 1b:NG';
  exception when sqlstate '42501' then r := r || ' 1b:OK'; end;
  begin perform public.issue_log(1, 0, 0, 0); r := r || ' 1c:NG';
  exception when sqlstate '42501' then r := r || ' 1c:OK'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_precheck(v_rows); r := r || ' 1d:NG';
  exception when sqlstate '42501' then r := r || ' 1d:OK'; end;
  begin perform public.issue_log(1, 0, 0, 0); r := r || ' 1e:NG';
  exception when sqlstate '42501' then r := r || ' 1e:OK'; end;
  execute 'reset role';
  update public.profiles set bundle = null where id = v_m;      -- 束を外して「常勤」にしてから試す
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_precheck(v_rows); r := r || ' 1f:NG';
  exception when sqlstate '42501' then r := r || ' 1f:OK'; end;
  begin perform public.issue_attach_profile(v_u1, '2604999', 'テスト太郎', '検査クラス'); r := r || ' 1g:NG';
  exception when sqlstate '42501' then r := r || ' 1g:OK'; end;
  execute 'reset role';

  -- 2 情報管理者：名簿の行を分ける（何も書かない）
  update public.profiles set bundle = 'info_admin' where id = v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.issue_precheck(v_rows);
  r := r || case when j->>'domain' = v_dom and jsonb_array_length(j->'results') = 6 then ' 2a:OK' else ' 2a:NG' end;
  r := r || case when j->'results'->0->>'status' = 'ok' and j->'results'->1->>'status' = 'ok'
                  and j->'results'->1->>'student_no' = '2604998' then ' 2b:OK' else ' 2b:NG' end;   -- 全角・ハイフンは取って7桁に
  r := r || case when j->'results'->2->>'reason' = 'bad_student_no' and j->'results'->3->>'reason' = 'duplicate_in_list'
                  and j->'results'->4->>'reason' = 'bad_name' and j->'results'->5->>'reason' = 'bad_class' then ' 2c:OK' else ' 2c:NG' end;
  begin perform public.issue_precheck((select jsonb_agg(jsonb_build_object('student_no', 'x')) from generate_series(1, 31)));
        r := r || ' 2d:NG';
  exception when sqlstate '22023' then r := r || ' 2d:OK'; end;
  begin perform public.issue_precheck('{}'::jsonb); r := r || ' 2e:NG';
  exception when sqlstate '22023' then r := r || ' 2e:OK'; end;
  -- いまいる学生の番号は「作ってよい」にならない（デモの学生は番号が7桁でないので「形がおかしい」でもよい。「すでにある」は 3i で見る）
  select student_no into t from public.profiles where id = v_s;
  j := public.issue_precheck(jsonb_build_array(jsonb_build_object('student_no', t, 'display_name', 'テスト', 'class_name', '検査クラス')));
  r := r || case when j->'results'->0->>'status' in ('existing', 'invalid') then ' 2f:OK' else ' 2f:NG' end;
  execute 'reset role';
  select count(*) into n from public.profiles where student_no in ('2604999', '2604998');
  r := r || case when n = 0 then ' 2g:OK' else ' 2g:NG' end;                       -- 見るだけで、名簿は増えない
  select count(*) into n from public.audit_log;
  r := r || case when n = a0 then ' 2h:OK' else ' 2h:NG' end;                      -- 見るだけでは、記録も増えない

  -- 3 名簿の行を付ける（Edge Function が作ったアカウントの代わりを、ここでだけ置く）
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (v_inst, v_u1, 'authenticated', 'authenticated', '2604999@' || v_dom, now(), now(), now()),
         (v_inst, v_u2, 'authenticated', 'authenticated', '2604995@' || v_dom, now(), now() - interval '11 minutes', now()),
         (v_inst, v_u3, 'authenticated', 'authenticated', '2604998@' || v_dom, now(), now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- ログイン用のアカウントだけある番号は「すでにある（ログインだけ残っている）」
  j := public.issue_precheck(jsonb_build_array(jsonb_build_object('student_no', '2604995', 'display_name', 'テスト', 'class_name', '検査クラス')));
  r := r || case when j->'results'->0->>'reason' = 'login_exists' then ' 3a:OK' else ' 3a:NG' end;
  -- 断るもの：番号とアカウントが合わない／10分より前に作られた／アカウントが無い／形がおかしい
  begin perform public.issue_attach_profile(v_u1, '2604998', 'テスト花子', '検査クラス'); r := r || ' 3b:NG';
  exception when sqlstate '22023' then r := r || ' 3b:OK'; end;
  begin perform public.issue_attach_profile(v_u2, '2604995', 'テスト五郎', '検査クラス'); r := r || ' 3c:NG';
  exception when sqlstate '22023' then r := r || ' 3c:OK'; end;
  begin perform public.issue_attach_profile(gen_random_uuid(), '2604999', 'テスト太郎', '検査クラス'); r := r || ' 3d:NG';
  exception when sqlstate 'P0002' then r := r || ' 3d:OK'; end;
  begin perform public.issue_attach_profile(v_u1, '2604999', '', '検査クラス'); r := r || ' 3e:NG';
  exception when sqlstate '22023' then r := r || ' 3e:OK'; end;
  begin perform public.issue_attach_profile(v_s, t, 'テスト', '検査クラス'); r := r || ' 3f:NG';   -- 前からいる学生には付けられない
  exception when sqlstate '22023' or sqlstate '23505' then r := r || ' 3f:OK'; end;
  -- 通るもの（全角・ハイフンつきの番号でも同じ行になる）
  t := public.issue_attach_profile(v_u1, '26-04999', ' テスト太郎 ', '検査クラス');
  r := r || case when t = 'created' then ' 3g:OK' else ' 3g:NG' end;
  -- 2回目は断る（上書きしない）
  begin perform public.issue_attach_profile(v_u1, '2604999', 'べつの名前', 'べつのクラス'); r := r || ' 3h:NG';
  exception when sqlstate '23505' then r := r || ' 3h:OK'; end;
  perform public.issue_attach_profile(v_u3, '2604998', 'テスト花子', '検査クラス');
  -- 付けたあとは「すでにある」
  j := public.issue_precheck(v_rows);
  r := r || case when j->'results'->0->>'status' = 'existing' and j->'results'->1->>'status' = 'existing' then ' 3i:OK' else ' 3i:NG' end;
  execute 'reset role';
  select count(*) into n from public.profiles
   where student_no in ('2604999', '2604998') and role = 'student' and status = 'active' and class_name = '検査クラス'
     and display_name in ('テスト太郎', 'テスト花子');
  r := r || case when n = 2 then ' 3j:OK' else ' 3j:NG' end;

  -- 4 操作の記録：1回につき1行。件数だけ
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.issue_log(2, 0, 4, 0);
  begin perform public.issue_log(31, 0, 0, 0); r := r || ' 4a:NG';
  exception when sqlstate '22023' then r := r || ' 4a:OK'; end;
  begin perform public.issue_log(-1, 0, 0, 0); r := r || ' 4b:NG';
  exception when sqlstate '22023' then r := r || ' 4b:OK'; end;
  begin perform public.issue_log(1, null, 0, 0); r := r || ' 4c:NG';
  exception when sqlstate '22023' then r := r || ' 4c:OK'; end;
  execute 'reset role';
  select count(*) into n from public.audit_log;
  r := r || case when n = a0 + 1 then ' 4d:OK' else ' 4d:NG(' || (n - a0) || ')' end;
  select count(*) into n from public.audit_log
   where actor_id = v_m and action = 'account.issue' and (detail->>'created')::int = 2 and (detail->>'invalid')::int = 4
     and coalesce(target_id, '') = '' and detail::text not like '%26049%' and detail::text not like '%テスト%';
  r := r || case when n = 1 then ' 4e:OK' else ' 4e:NG' end;

  -- 5 付けた学生として：自分では呼べない。お知らせは、まだ読んでいない扱い
  perform set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_precheck(v_rows); r := r || ' 5a:NG';
  exception when sqlstate '42501' then r := r || ' 5a:OK'; end;
  j := public.my_notice_status();
  r := r || case when (j->>'required')::boolean then ' 5b:OK' else ' 5b:NG' end;
  execute 'reset role';

  -- 6 ログインなし：3つとも呼べない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.issue_precheck(v_rows); r := r || ' 6a:NG';
  exception when sqlstate '42501' then r := r || ' 6a:OK'; end;
  begin perform public.issue_attach_profile(v_u1, '2604999', 'テスト太郎', '検査クラス'); r := r || ' 6b:NG';
  exception when sqlstate '42501' then r := r || ' 6b:OK'; end;
  begin perform public.issue_log(1, 0, 0, 0); r := r || ' 6c:NG';
  exception when sqlstate '42501' then r := r || ' 6c:OK'; end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
