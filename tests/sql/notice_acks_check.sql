-- notice_versions / notice_acks（「よみました」の記録）の検査（2026-11-22）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-22_notice_acks.sql の、begin と commit の「あいだ」を
--           このファイルの上に貼り、全体を begin; … rollback; で包んで1回で流す
--           🔴 貼るときに commit; の行を入れない（入れると取り消されずに残る。流す前に目で見ること）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★既存のダミー（role ごとに student_no の若い人）を使う。値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_t uuid; v_s uuid; v_s2 uuid; v_class text;
  r text := ''; n int; n0 int; a0 int; j jsonb; t1 timestamptz; t2 timestamptz;
begin
  select id into v_m from public.profiles where role = 'master'  order by student_no limit 1;
  select id into v_t from public.profiles where role = 'teacher' order by student_no limit 1;
  select id, class_name into v_s, v_class from public.profiles
   where role = 'student' and status = 'active' and class_name is not null order by student_no limit 1;
  select id into v_s2 from public.profiles
   where role = 'student' and status = 'active' and class_name = v_class and id <> v_s order by student_no limit 1;
  select count(*) into n0 from public.profiles where role = 'student' and status = 'active' and class_name = v_class;
  select count(*) into a0 from public.audit_log;

  -- 0 はじめの版が1つ入っている
  select count(*) into n from public.notice_versions where notice_key = 'student_privacy' and version = 1;
  r := r || case when n = 1 then ' 0a:OK' else ' 0a:NG' end;

  -- 1 学生：はじめは「出す」。押すと「出さない」。2回押しても1行。日時は変わらない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_notice_status();
  r := r || case when (j->>'required')::boolean and not (j->>'read')::boolean and (j->>'version')::int = 1 then ' 1a:OK' else ' 1a:NG' end;
  t1 := public.ack_notice('student_privacy', 1, 'en');
  t2 := public.ack_notice('student_privacy', 1, 'ja');
  r := r || case when t1 is not null and t1 = t2 then ' 1b:OK' else ' 1b:NG' end;
  j := public.my_notice_status();
  r := r || case when not (j->>'required')::boolean and (j->>'read')::boolean and not (j->>'read_before')::boolean then ' 1c:OK' else ' 1c:NG' end;
  select count(*) into n from public.notice_acks;                       -- 自分の行だけ見える
  r := r || case when n = 1 then ' 1d:OK' else ' 1d:NG(' || n || ')' end;
  select count(*) into n from public.notice_acks where lang = 'en';     -- はじめに押したときの言語のまま
  r := r || case when n = 1 then ' 1e:OK' else ' 1e:NG' end;
  -- 断るもの：無い版・決まりに無い言語・無いお知らせ・直接の書き込み・直し・消し・職員用の一覧
  begin perform public.ack_notice('student_privacy', 2, 'ja'); r := r || ' 1f:NG';
  exception when sqlstate 'PT409' then r := r || ' 1f:OK'; end;
  begin perform public.ack_notice('student_privacy', 1, 'xx'); r := r || ' 1g:NG';
  exception when sqlstate '22023' then r := r || ' 1g:OK'; end;
  begin perform public.ack_notice('そんなお知らせは無い', 1, 'ja'); r := r || ' 1h:NG';
  exception when sqlstate '22023' then r := r || ' 1h:OK'; end;
  begin insert into public.notice_acks (student_id, notice_key, version, lang) values (v_s, 'student_privacy', 1, 'ja'); r := r || ' 1i:NG';
  exception when sqlstate '42501' then r := r || ' 1i:OK'; end;
  begin update public.notice_acks set lang = 'ja' where student_id = v_s; r := r || ' 1j:NG';
  exception when sqlstate '42501' then r := r || ' 1j:OK'; end;
  begin delete from public.notice_acks where student_id = v_s; r := r || ' 1k:NG';
  exception when sqlstate '42501' then r := r || ' 1k:OK'; end;
  begin insert into public.notice_versions (notice_key, version) values ('student_privacy', 9); r := r || ' 1l:NG';
  exception when sqlstate '42501' then r := r || ' 1l:OK'; end;
  begin perform public.notice_unread('student_privacy', v_class); r := r || ' 1m:NG';
  exception when sqlstate '42501' then r := r || ' 1m:OK'; end;
  execute 'reset role';

  -- 2 別の学生：ほかの人の行は見えない。まだ「出す」のまま
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.notice_acks;
  r := r || case when n = 0 then ' 2a:OK' else ' 2a:NG' end;
  j := public.my_notice_status();
  r := r || case when (j->>'required')::boolean then ' 2b:OK' else ' 2b:NG' end;
  execute 'reset role';

  -- 3 先生（非常勤）：押せない。一覧は開けない。記録の行も見えない。自分には「出さない」
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.ack_notice('student_privacy', 1, 'ja'); r := r || ' 3a:NG';
  exception when sqlstate '42501' then r := r || ' 3a:OK'; end;
  begin perform public.notice_unread('student_privacy', v_class); r := r || ' 3b:NG';
  exception when sqlstate '42501' then r := r || ' 3b:OK'; end;
  select count(*) into n from public.notice_acks;
  r := r || case when n = 0 then ' 3c:OK' else ' 3c:NG' end;
  j := public.my_notice_status();
  r := r || case when not (j->>'required')::boolean then ' 3d:OK' else ' 3d:NG' end;
  execute 'reset role';

  -- 4 マスター（常勤）：一覧を開ける。数が合う。読んだ学生は「まだ」に出ない。押せない。開いたことは10分に1行
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.notice_unread('student_privacy', v_class);
  j := public.notice_unread('student_privacy', v_class);
  r := r || case when (j->>'target')::int = n0 and (j->>'read')::int = 1 and jsonb_array_length(j->'unread') = n0 - 1 then ' 4a:OK' else ' 4a:NG' end;
  r := r || case when not exists (select 1 from jsonb_array_elements(j->'unread') e where (e->>'id')::uuid = v_s) then ' 4b:OK' else ' 4b:NG' end;
  r := r || case when exists (select 1 from jsonb_array_elements(j->'unread') e where (e->>'id')::uuid = v_s2) then ' 4c:OK' else ' 4c:NG' end;
  begin perform public.ack_notice('student_privacy', 1, 'ja'); r := r || ' 4d:NG';
  exception when sqlstate '42501' then r := r || ' 4d:OK'; end;
  begin perform public.notice_unread('student_privacy', ''); r := r || ' 4e:NG';
  exception when sqlstate '22023' then r := r || ' 4e:OK'; end;
  select count(*) into n from public.notice_acks;                       -- 名簿を見られる人は、読んだ記録も読める
  r := r || case when n = 1 then ' 4f:OK' else ' 4f:NG' end;
  execute 'reset role';
  select count(*) into n from public.audit_log where actor_id = v_m and action = 'view.notice_unread' and target_id = v_class;
  r := r || case when n = 1 then ' 4g:OK' else ' 4g:NG(' || n || ')' end;
  select count(*) into n from public.audit_log;                         -- 学生が押したことは、操作の記録には書かない
  r := r || case when n = a0 + 1 then ' 4h:OK' else ' 4h:NG' end;
  select count(*) into n from public.audit_log
   where action = 'view.notice_unread' and (detail ? 'name' or detail ? 'student_no' or detail::text like '%' || v_s::text || '%');
  r := r || case when n = 0 then ' 4i:OK' else ' 4i:NG' end;

  -- 5 版を上げる：読んだ学生にも、もう1回「出す」。前に読んだことは分かる。古い版では押せない。新しい版で押すと2行になる
  insert into public.notice_versions (notice_key, version, note) values ('student_privacy', 2, '検査');
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.my_notice_status();
  r := r || case when (j->>'required')::boolean and (j->>'read_before')::boolean and (j->>'version')::int = 2 then ' 5a:OK' else ' 5a:NG' end;
  begin perform public.ack_notice('student_privacy', 1, 'ja'); r := r || ' 5b:NG';
  exception when sqlstate 'PT409' then r := r || ' 5b:OK'; end;
  perform public.ack_notice('student_privacy', 2, 'ja');
  select count(*) into n from public.notice_acks;
  r := r || case when n = 2 then ' 5c:OK' else ' 5c:NG' end;
  execute 'reset role';

  -- 6 在籍していない学生：押せない。「出さない」。クラスの数にも入らない
  update public.profiles set status = 'withdrawn' where id = v_s2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_s2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.ack_notice('student_privacy', 2, 'ja'); r := r || ' 6a:NG';
  exception when sqlstate '42501' then r := r || ' 6a:OK'; end;
  j := public.my_notice_status();
  r := r || case when not (j->>'required')::boolean then ' 6b:OK' else ' 6b:NG' end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.notice_unread('student_privacy', v_class);
  r := r || case when (j->>'target')::int = n0 - 1 and (j->>'read')::int = 1 then ' 6c:OK' else ' 6c:NG' end;
  execute 'reset role';

  -- 7 ログインなし：何も呼べない・読めない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.my_notice_status(); r := r || ' 7a:NG';
  exception when sqlstate '42501' then r := r || ' 7a:OK'; end;
  begin perform public.ack_notice('student_privacy', 2, 'ja'); r := r || ' 7b:NG';
  exception when sqlstate '42501' then r := r || ' 7b:OK'; end;
  begin perform public.notice_unread('student_privacy', v_class); r := r || ' 7c:NG';
  exception when sqlstate '42501' then r := r || ' 7c:OK'; end;
  begin select count(*) into n from public.notice_acks; r := r || ' 7d:NG';
  exception when sqlstate '42501' then r := r || ' 7d:OK'; end;
  begin select count(*) into n from public.notice_versions; r := r || ' 7e:NG';
  exception when sqlstate '42501' then r := r || ' 7e:OK'; end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
