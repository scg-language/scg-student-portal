-- はじめてのログインの受付（2026-11-25 きあ決定）
-- ※ エラーの文はマスターのスマホ画面に出る＝ふつうの日本語で書く（やさしい日本語は学生画面だけ）
--
-- ★なぜ要るか
--   12/12（会話テストの日）に、はじめてのログインをする。8クラスが同時に会話テストをして、
--   終わった学生から5分に8人ずつ、きあ ともう1人のところへ来る（五月雨式）。
--   クラス単位で一斉にやるのと違い、「だれが来て・どこまで済んで・だれがまだか」を目で追えない。
--   → マスターのスマホで、3つの状態を自動で出し、最後の1つだけを人が押す：
--      ① ログインしたか           … auth.users.last_sign_in_at（サーバーが知っている）
--      ② パスワードを決め直したか … いまのパスワードが「scg＋学籍番号」のままか（サーバーで照合する）
--      ③ ホーム画面に入れたか     … サーバーには分からない。きあが目で見て「確認済み」を押す（この表に残る）
--
-- 足すもの
--   ⓪ できること first_login.check（はじめてのログインの受付）… 2026-11-25 きあ「とりあえず情報管理者（私）だけ」＝束 info_admin だけに入れる。
--                                           当日もう1人に使わせるときは、その人だけに足す（下の「人に足す」。発行の権限は渡さない）
--   ① public.first_login_checks          … 「確認済み」の記録。押す・取り消すのたびに1行足す（直さない・消さない）。
--                                           いまの状態＝その学生の最後の行
--   ② app_hidden.pw_initial_cache         … ②の照合の結果の控え（下の「照合が重い」）。API からは見えない場所
--   ③ public.first_login_board(p_class)  … 受付の画面が10秒ごとに読む。人数・受付中の人・今日確認した人・クラスの一覧
--   ④ public.first_login_mark(id, on)    … 「確認済み」にする／取り消す
--
-- 🔴 決めたこと
--   ・使えるのは first_login.check を持つ職員だけ（いまは情報管理者だけ）。常勤（fulltime）・先生・学生は呼べない
--   ・画面はスマホ（master-phone.html ⑦）と PC（master.html「はじめてのログイン」）の2つ。判定は assets/first-login.js の1か所
--   ・名前を返すのは、受付中の人（今日ログインして、まだ確認していない人）・今日確認した人・開いたクラスの人だけ。
--     クラスの一覧は人数だけ
--   ・パスワードを決め直していない学生は「確認済み」にできない（押し間違いを1つ減らす）
--   ・表を直接は、だれも読めない・書けない（ポリシーを作らない）。読むのも書くのも ③④ だけ
--   ・開いたことは操作の記録（audit_log）に残す。同じ人・同じ対象は10分に1行まで（notice_unread と同じ）
--
-- ⚠ 照合が重い
--   パスワードの照合（bcrypt）は1人 0.1秒ほどかかる。10秒ごとに全員を照合すると重いので、
--   照合の結果を「いまのパスワードの記録の指紋（md5）」と組にして控える。パスワードが変わると指紋が変わる＝控えは自動で無効になる
--   （＝「旗を持たずにパスワードそのもので判定する」2026-11-20 の線は守っている）。
--   1回の呼び出しで新しく照合するのは25人まで。残りは「確認中」で返し、次の10秒で照合する
--
-- 流したあと: tests/sql/first_login_check.sql（最後に例外で止めて全部ロールバック）／
--             py -X utf8 -m unittest discover -s tests -p "test_db_migrations.py"／get_advisors（WARN が2件増える＝③④）
begin;

-- ⓪ できること（2026-11-21_capabilities.sql の表に1つ足す）。束は info_admin だけ
insert into public.capabilities (key, label, sort) values
  ('first_login.check', 'はじめてのログインの受付（確認済みを押す）', 125)
on conflict (key) do nothing;
insert into public.cap_bundles (bundle, cap_key) values ('info_admin', 'first_login.check')
on conflict (bundle, cap_key) do nothing;

-- ① 「確認済み」の記録
create table if not exists public.first_login_checks (
  id          bigint generated always as identity primary key,
  student_id  uuid        not null,          -- ★あえて外部キーを張らない（アカウントを消しても記録は残す）
  checked     boolean     not null,          -- true＝確認済みにした／false＝取り消した
  at          timestamptz not null default now(),
  actor_id    uuid        not null           -- 押した職員
);
create index if not exists first_login_checks_student_idx on public.first_login_checks (student_id, id desc);
create index if not exists first_login_checks_at_idx      on public.first_login_checks (at desc);

alter table public.first_login_checks enable row level security;
-- ポリシーを作らない＝表を直接は誰も読めない・書けない
revoke all on table public.first_login_checks from anon, authenticated;


-- ② 照合の結果の控え。パスワードも、その記録（ハッシュ）も持たない。持つのは記録の md5 だけ
create table if not exists app_hidden.pw_initial_cache (
  user_id     uuid        primary key,
  digest      text        not null,          -- md5(auth.users.encrypted_password)
  is_initial  boolean     not null,
  at          timestamptz not null default now()
);
alter table app_hidden.pw_initial_cache enable row level security;
revoke all on table app_hidden.pw_initial_cache from public, anon, authenticated;


-- ③ 受付の画面が読む
--   返すもの：
--     today   … 今日の日付（日本時間）
--     classes … [{class, target, not_yet, checked}]  在籍中の学生のクラスごとの人数（名前なし）
--     active  … [{id, student_no, name, class, signed_at, pw}]  今日ログインして、まだ確認していない人（ログインの古い順）
--     done    … [{id, student_no, name, class, checked_at}]      今日「確認済み」にした人（新しい順）
--     rows    … p_class を渡したときだけ。そのクラスの全員 [{id, student_no, name, signed_at, pw, checked, checked_at}]
--   pw … "initial"（まだ決め直していない）／"changed"（決め直した）／null（まだ照合していない・ログインしていない）
create or replace function public.first_login_board(p_class text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today  date    := (now() at time zone 'Asia/Tokyo')::date;
  v_budget integer := 25;          -- 1回で新しく照合する上限
  v_pw     jsonb   := '{}'::jsonb; -- 学生の id → "initial" / "changed"
  v_init   boolean;
  v_dig    text;
  v_out    jsonb;
  v_tt     text    := case when p_class is null then 'first_login' else 'class' end;
  v_tid    text    := coalesce(p_class, 'all');
  r        record;
begin
  if auth.uid() is null or not app_hidden.can('first_login.check') then
    raise exception 'はじめてのログインの受付を使える人だけが開けます' using errcode = '42501';
  end if;
  if p_class is not null and (btrim(p_class) = '' or length(p_class) > 80) then
    raise exception 'クラスを選んでください' using errcode = '22023';
  end if;

  -- 照合する人＝ログインしたことがあり、まだ確認していない人のうち、今日ログインした人か、開いたクラスの人
  for r in
    select p.id, p.student_no, u.encrypted_password as h
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role = 'student' and p.status = 'active'
       and u.last_sign_in_at is not null
       and ((u.last_sign_in_at at time zone 'Asia/Tokyo')::date = v_today or p.class_name = p_class)
       and coalesce((select c.checked from public.first_login_checks c
                      where c.student_id = p.id order by c.id desc limit 1), false) = false
     order by u.last_sign_in_at desc
  loop
    continue when r.h is null or r.h = '' or coalesce(btrim(r.student_no), '') = '';
    v_dig  := md5(r.h);
    v_init := null;
    select c.is_initial into v_init from app_hidden.pw_initial_cache c where c.user_id = r.id and c.digest = v_dig;
    if v_init is null and v_budget > 0 then
      v_init   := extensions.crypt('scg' || lower(btrim(r.student_no)), r.h) = r.h;
      v_budget := v_budget - 1;
      insert into app_hidden.pw_initial_cache (user_id, digest, is_initial, at)
      values (r.id, v_dig, v_init, now())
      on conflict (user_id) do update set digest = excluded.digest, is_initial = excluded.is_initial, at = excluded.at;
    end if;
    if v_init is not null then
      v_pw := v_pw || jsonb_build_object(r.id::text, case when v_init then 'initial' else 'changed' end);
    end if;
  end loop;

  with st as (
    select p.id, p.student_no, p.display_name as name, coalesce(p.class_name, '') as cls,
           u.last_sign_in_at as signed_at,
           coalesce(lc.checked, false) as checked,
           case when lc.checked then lc.at end as checked_at
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join lateral (select c.checked, c.at from public.first_login_checks c
                          where c.student_id = p.id order by c.id desc limit 1) lc on true
     where p.role = 'student' and p.status = 'active'
  )
  select jsonb_build_object(
    'today', v_today,
    'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', g.cls, 'target', g.n, 'not_yet', g.n0, 'checked', g.nc) order by g.cls)
          from (select cls, count(*) as n,
                       count(*) filter (where signed_at is null) as n0,
                       count(*) filter (where checked) as nc
                  from st group by cls) g), '[]'::jsonb),
    'active', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'student_no', s.student_no, 'name', s.name, 'class', s.cls,
                                            'signed_at', s.signed_at, 'pw', v_pw ->> (s.id::text)) order by s.signed_at, s.student_no)
          from st s
         where not s.checked and s.signed_at is not null
           and (s.signed_at at time zone 'Asia/Tokyo')::date = v_today), '[]'::jsonb),
    'done', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'student_no', s.student_no, 'name', s.name, 'class', s.cls,
                                            'checked_at', s.checked_at) order by s.checked_at desc)
          from st s
         where s.checked and (s.checked_at at time zone 'Asia/Tokyo')::date = v_today), '[]'::jsonb),
    'rows', case when p_class is null then null else coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'student_no', s.student_no, 'name', s.name,
                                            'signed_at', s.signed_at, 'pw', v_pw ->> (s.id::text),
                                            'checked', s.checked, 'checked_at', s.checked_at) order by s.student_no)
          from st s where s.cls = p_class), '[]'::jsonb) end
  ) into v_out;

  if not exists (select 1 from public.audit_log l
                  where l.actor_id = auth.uid() and l.action = 'view.first_login'
                    and l.target_type = v_tt and l.target_id = v_tid
                    and l.at > now() - interval '10 minutes') then
    perform app_hidden.audit('view.first_login', v_tt, v_tid,
                             jsonb_build_object('active', jsonb_array_length(v_out->'active'),
                                                'done', jsonb_array_length(v_out->'done')));
  end if;

  return v_out;
end $$;

revoke all     on function public.first_login_board(text) from public;
revoke execute on function public.first_login_board(text) from anon;
grant  execute on function public.first_login_board(text) to authenticated;


-- ④ 「確認済み」にする（p_checked=true）／取り消す（false）。同じ状態をもう一度送っても行は増えない
create or replace function public.first_login_mark(p_student_id uuid, p_checked boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_no   text;
  v_hash text;
  v_cur  boolean;
  v_at   timestamptz := now();
begin
  if auth.uid() is null or not app_hidden.can('first_login.check') then
    raise exception 'はじめてのログインの受付を使える人だけが使えます' using errcode = '42501';
  end if;
  if p_student_id is null or p_checked is null then
    raise exception '学生と、確認済みにするか取り消すかを選んでください' using errcode = '22023';
  end if;
  select p.student_no into v_no from public.profiles p
   where p.id = p_student_id and p.role = 'student' and p.status = 'active';
  if v_no is null or btrim(v_no) = '' then
    raise exception '学生が見つかりません' using errcode = 'P0002';
  end if;

  -- 2人で同じ学生を同時に押しても、行は1つだけ増える
  perform pg_advisory_xact_lock(hashtext('first_login_mark:' || p_student_id::text));

  select c.checked into v_cur from public.first_login_checks c
   where c.student_id = p_student_id order by c.id desc limit 1;
  if coalesce(v_cur, false) = p_checked then
    return jsonb_build_object('student_id', p_student_id, 'checked', p_checked, 'changed', false);
  end if;

  if p_checked then
    select u.encrypted_password into v_hash from auth.users u where u.id = p_student_id;
    if v_hash is null or v_hash = '' or extensions.crypt('scg' || lower(btrim(v_no)), v_hash) = v_hash then
      raise exception 'この学生は、まだパスワードを決め直していません' using errcode = 'PT409';
    end if;
  end if;

  insert into public.first_login_checks (student_id, checked, at, actor_id)
  values (p_student_id, p_checked, v_at, auth.uid());

  return jsonb_build_object('student_id', p_student_id, 'checked', p_checked, 'changed', true, 'at', v_at);
end $$;

revoke all     on function public.first_login_mark(uuid, boolean) from public;
revoke execute on function public.first_login_mark(uuid, boolean) from anon;
grant  execute on function public.first_login_mark(uuid, boolean) to authenticated;

commit;

-- =====================================================================
-- 人に足す（当日、きあ以外の1人にも使わせるとき。ログインIDは実物に置き換える。発行などほかの権限は渡らない）
--   insert into public.staff_caps (profile_id, cap_key, granted)
--   select id, 'first_login.check', true from public.profiles where student_no = '（ログインID）' and role in ('teacher', 'master');
-- 外す：delete from public.staff_caps where cap_key = 'first_login.check' and profile_id = (select id from public.profiles where student_no = '（ログインID）');
--
-- 巻き戻し
--   begin;
--   drop function if exists public.first_login_mark(uuid, boolean);
--   drop function if exists public.first_login_board(text);
--   delete from public.staff_caps   where cap_key = 'first_login.check';
--   delete from public.cap_bundles  where cap_key = 'first_login.check';
--   delete from public.capabilities where key = 'first_login.check';
--   drop table if exists app_hidden.pw_initial_cache;     -- 控えだけ。消しても次の呼び出しで作り直る
--   drop table if exists public.first_login_checks;       -- ★「確認済み」の記録が消える。消す前に書き出すこと
--   commit;
-- =====================================================================
