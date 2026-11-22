-- issue_student_accounts（学生アカウントの発行）の検査（2026-11-23）。★最後に必ず例外で止める＝何も残らない（ロールバック）
--   流し方（適用前）：db/2026-11-23_account_issue.sql の、begin と commit の「あいだ」を
--           このファイルの上に貼り、全体を begin; … rollback; で包んで1回で流す
--           🔴 貼るときに commit; の行を入れない（入れると取り消されずに残る。流す前に目で見ること）
--   流し方（適用後）：このファイルだけを begin; … rollback; で包んで流す
--   結果は例外の文言 'RESULT ...' に出る。NG が1つでもあれば文言に NG が入る
--   ★学籍番号はダミーの帯（末尾が 999 から降りる）だけを使う。値は出さない（出すのは OK/NG と件数だけ）
do $$
declare
  v_m uuid; v_t uuid; v_s uuid; v_new uuid;
  r text := ''; n int; a0 int; j jsonb; b boolean;
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
  select count(*) into a0 from public.audit_log;

  -- 0 前提：検査に使う番号が、まだ無い
  select count(*) into n from public.profiles where student_no in ('2604999', '2604998', '2604997', '2604996');
  r := r || case when n = 0 then ' 0a:OK' else ' 0a:NG' end;

  -- 1 学生・先生・常勤（マスター）は発行できない
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_student_accounts(v_rows); r := r || ' 1a:NG';
  exception when sqlstate '42501' then r := r || ' 1a:OK'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_student_accounts(v_rows); r := r || ' 1b:NG';
  exception when sqlstate '42501' then r := r || ' 1b:OK'; end;
  execute 'reset role';
  update public.profiles set bundle = null where id = v_m;      -- 束を外して「常勤」にしてから試す（デモの1人目が情報管理者でも成り立つように）
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.issue_student_accounts(v_rows); r := r || ' 1c:NG';
  exception when sqlstate '42501' then r := r || ' 1c:OK'; end;
  execute 'reset role';
  select count(*) into n from public.profiles where student_no in ('2604999', '2604998');
  r := r || case when n = 0 then ' 1d:OK' else ' 1d:NG' end;

  -- 2 情報管理者：発行できる。数が合う。理由が行ごとに返る
  update public.profiles set bundle = 'info_admin' where id = v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.issue_student_accounts(v_rows);
  r := r || case when (j->>'created')::int = 2 and (j->>'invalid')::int = 4 and (j->>'existing')::int = 0 and (j->>'failed')::int = 0
                 then ' 2a:OK' else ' 2a:NG(' || (j->>'created') || '/' || (j->>'invalid') || '/' || (j->>'existing') || '/' || (j->>'failed') || ')' end;
  r := r || case when j->'results'->1->>'student_no' = '2604998' and j->'results'->1->>'status' = 'created' then ' 2b:OK' else ' 2b:NG' end;  -- 全角・ハイフンは取って7桁に
  r := r || case when j->'results'->2->>'reason' = 'bad_student_no' and j->'results'->3->>'reason' = 'duplicate_in_list'
                  and j->'results'->4->>'reason' = 'bad_name' and j->'results'->5->>'reason' = 'bad_class' then ' 2c:OK' else ' 2c:NG' end;
  -- 断るもの：30件より多い・配列でない
  begin perform public.issue_student_accounts((select jsonb_agg(jsonb_build_object('student_no', 'x')) from generate_series(1, 31)));
        r := r || ' 2d:NG';
  exception when sqlstate '22023' then r := r || ' 2d:OK'; end;
  begin perform public.issue_student_accounts('{}'::jsonb); r := r || ' 2e:NG';
  exception when sqlstate '22023' then r := r || ' 2e:OK'; end;
  -- もう1回流す → 2件とも「すでにある」。上書きしない
  j := public.issue_student_accounts(v_rows);
  r := r || case when (j->>'created')::int = 0 and (j->>'existing')::int = 2 then ' 2f:OK' else ' 2f:NG' end;
  execute 'reset role';

  -- 3 できたもの：名簿の行（学生・在籍・クラス）／ログイン用のアカウント／本人確認の行／はじめのパスワード
  select count(*) into n from public.profiles
   where student_no in ('2604999', '2604998') and role = 'student' and status = 'active' and class_name = '検査クラス';
  r := r || case when n = 2 then ' 3a:OK' else ' 3a:NG' end;
  select id into v_new from public.profiles where student_no = '2604999';
  select count(*) into n from auth.users u
   where u.id = v_new and u.email like '2604999@%' and u.email_confirmed_at is not null
     and u.confirmation_token = '' and u.recovery_token = '' and u.email_change_token_new = '' and u.email_change = ''
     and u.encrypted_password = extensions.crypt('scg2604999', u.encrypted_password);
  r := r || case when n = 1 then ' 3b:OK' else ' 3b:NG' end;
  select count(*) into n from auth.identities i where i.user_id = v_new and i.provider = 'email';
  r := r || case when n = 1 then ' 3c:OK' else ' 3c:NG' end;
  select count(*) into n from auth.users u, auth.users me
   where u.id = v_new and me.id = v_m and split_part(u.email, '@', 2) = split_part(me.email, '@', 2);
  r := r || case when n = 1 then ' 3d:OK' else ' 3d:NG' end;                    -- アドレスの後ろは、押した人と同じ

  -- 4 操作の記録：成功した呼び出し2回ぶんで2行。件数だけで、番号・氏名は入っていない
  select count(*) into n from public.audit_log where actor_id = v_m and action = 'account.issue';
  r := r || case when n = 2 then ' 4a:OK' else ' 4a:NG(' || n || ')' end;
  select count(*) into n from public.audit_log;
  r := r || case when n = a0 + 2 then ' 4b:OK' else ' 4b:NG' end;
  select count(*) into n from public.audit_log
   where action = 'account.issue' and (detail::text like '%26049%' or detail::text like '%テスト%' or coalesce(target_id, '') <> '');
  r := r || case when n = 0 then ' 4c:OK' else ' 4c:NG' end;
  select count(*) into n from public.audit_log
   where action = 'account.issue' and (detail->>'created')::int = 2 and (detail->>'invalid')::int = 4;
  r := r || case when n = 1 then ' 4d:OK' else ' 4d:NG' end;

  -- 5 作った学生として：はじめのパスワードのまま、と判定される（＝ログイン直後に決め直しの画面が出る）。自分では発行できない
  perform set_config('request.jwt.claims', json_build_object('sub', v_new, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  b := public.my_password_is_initial();
  r := r || case when b then ' 5a:OK' else ' 5a:NG' end;
  begin perform public.issue_student_accounts(v_rows); r := r || ' 5b:NG';
  exception when sqlstate '42501' then r := r || ' 5b:OK'; end;
  j := public.my_notice_status();
  r := r || case when (j->>'required')::boolean then ' 5c:OK' else ' 5c:NG' end;   -- お知らせも、まだ読んでいない扱い
  execute 'reset role';

  -- 6 ログインなし：呼べない
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.issue_student_accounts(v_rows); r := r || ' 6a:NG';
  exception when sqlstate '42501' then r := r || ' 6a:OK'; end;
  execute 'reset role';

  raise exception 'RESULT%', r;
end $$;
