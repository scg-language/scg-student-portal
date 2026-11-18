-- アンケート定義を DB に置き、マスター画面から作れるようにする（2026-11-18 きあ決定）。
--
-- ★決めたこと
--   ・作成・編集・公開できるのは マスター（app_hidden.is_master()）だけ。先生は読むだけ（回の開始は今どおり）
--   ・既存の5本（surveys.js）はコードに残す。この表に入るのは画面で新しく作るものだけ
--   ・survey_key はサーバーが付ける（'u' + 日付 + '_' + 6文字）。コード側のキーと絶対にぶつからない
--   ・🔴 その key で回を1本でもはじめたら、定義は直せない（回答の意味が変わるため）。
--     直したいときは「複製」して新しい key で作る（surveys.js の「意味を変えるなら新しい key」と同じ規則）
--   ・行は消さない。要らなくなったら status='archived'（一覧から隠すだけ）
--
-- ★def の形は surveys.js の1件と同じ（key だけ外す）:
--   { title:{ja,en,...}, desc:{...}, intro:{...}, sb, color, sections?, q:[{k,t,l,o?,ph?,sl?,required?,showWhen?,flag?...}] }
--   画面は def を必ず textContent で描く（intro の <br> は改行に直すだけ）。
--
-- 流したあと: python tests/test_db_migrations.py ／ python tests/test_security.py ／ get_advisors（WARN が3件増える＝下の3 RPC）
begin;

create table if not exists public.survey_defs (
  survey_key   text primary key
               check (survey_key ~ '^u[0-9]{8}_[a-z0-9]{6}$'),
  def          jsonb not null,
  status       text not null default 'draft'
               check (status in ('draft', 'published', 'archived')),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);

alter table public.survey_defs enable row level security;

-- 表へ直接は書かせない（insert/update/delete のポリシーを作らない＝誰にも許されない）。書くのは下の RPC だけ。
revoke all on table public.survey_defs from anon;
revoke insert, update, delete on table public.survey_defs from authenticated;
grant  select on table public.survey_defs to authenticated;

-- 学生: 公開中の定義だけ読める（回に出たときに中身を引くため）
create policy "read published survey defs"
  on public.survey_defs for select to authenticated
  using (status = 'published');

-- 職員（先生・マスター）: 下書き・しまったものも読める（中身の確認のため）
create policy "staff read survey defs"
  on public.survey_defs for select to authenticated
  using (app_hidden.is_teacher());


-- 定義の中身の最低限の検査（画面の検査をすり抜けた値で、学生画面が壊れないため）
create or replace function app_hidden.survey_def_problem(p_def jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_q    jsonb;
  v_keys text[] := '{}';
  v_k    text;
  v_t    text;
begin
  if p_def is null or jsonb_typeof(p_def) <> 'object' then
    return '定義の形が正しくありません';
  end if;
  if octet_length(p_def::text) > 200000 then
    return '定義が大きすぎます';
  end if;
  if coalesce(btrim(p_def #>> '{title,ja}'), '') = '' then
    return 'アンケートの名前（日本語）が空です';
  end if;
  if jsonb_typeof(p_def -> 'q') is distinct from 'array'
     or jsonb_array_length(p_def -> 'q') = 0 then
    return '質問が1つもありません';
  end if;
  if jsonb_array_length(p_def -> 'q') > 200 then
    return '質問が多すぎます（200問まで）';
  end if;
  for v_q in select value from jsonb_array_elements(p_def -> 'q') loop
    v_k := v_q ->> 'k';
    v_t := v_q ->> 't';
    if v_k is null or v_k !~ '^[a-z0-9_]{1,40}$' then
      return '質問の記号が正しくありません: ' || coalesce(v_k, '(なし)');
    end if;
    if v_k = any (v_keys) then
      return '質問の記号が重なっています: ' || v_k;
    end if;
    v_keys := v_keys || v_k;
    if v_t is null or v_t not in ('select', 'multi', 'text', 'date') then
      return '質問の種類が正しくありません: ' || v_k;
    end if;
    if coalesce(btrim(v_q #>> '{l,ja}'), '') = '' then
      return '質問文（日本語）が空です: ' || v_k;
    end if;
    if v_t in ('select', 'multi')
       and (jsonb_typeof(v_q -> 'o') is distinct from 'array'
            or jsonb_array_length(v_q -> 'o') < 2) then
      return '選択肢が2つ未満です: ' || v_k;
    end if;
  end loop;
  return null;
end $$;

revoke all on function app_hidden.survey_def_problem(jsonb) from public, anon, service_role;
grant execute on function app_hidden.survey_def_problem(jsonb) to authenticated;


-- 作る・直す。p_survey_key が null なら新しく作る（key はここで付ける）。
create or replace function public.save_survey_def(p_survey_key text, p_def jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_problem text;
  v_key     text := p_survey_key;
  v_row     survey_defs%rowtype;
begin
  if not app_hidden.is_master() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_problem := app_hidden.survey_def_problem(p_def);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;

  if v_key is null then
    v_key := 'u' || to_char(now() at time zone 'Asia/Tokyo', 'YYYYMMDD')
             || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into public.survey_defs (survey_key, def)
    values (v_key, p_def - 'key')
    returning * into v_row;
  else
    if exists (select 1 from public.survey_rounds where survey_key = v_key) then
      raise exception 'この アンケートは もう回を はじめたので直せません（複製して新しく作ってください）'
        using errcode = '22023';
    end if;
    update public.survey_defs
       set def = p_def - 'key', updated_by = auth.uid(), updated_at = now()
     where survey_key = v_key
    returning * into v_row;
    if v_row.survey_key is null then
      raise exception 'no such survey def' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object('survey_key', v_row.survey_key, 'status', v_row.status,
                            'updated_at', v_row.updated_at);
end $$;

revoke all on function public.save_survey_def(text, jsonb) from public;
revoke execute on function public.save_survey_def(text, jsonb) from anon;
grant execute on function public.save_survey_def(text, jsonb) to authenticated;


-- 公開・下書きに戻す・しまう。回をはじめたあとは「公開」から動かせない（学生の画面から中身が消えるため）。
create or replace function public.set_survey_def_status(p_survey_key text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row survey_defs%rowtype;
begin
  if not app_hidden.is_master() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'status が正しくありません' using errcode = '22023';
  end if;
  if p_status <> 'published'
     and exists (select 1 from public.survey_rounds where survey_key = p_survey_key) then
    raise exception 'この アンケートは もう回を はじめたので、公開をやめられません' using errcode = '22023';
  end if;
  update public.survey_defs
     set status = p_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
         updated_by = auth.uid(), updated_at = now()
   where survey_key = p_survey_key
  returning * into v_row;
  if v_row.survey_key is null then
    raise exception 'no such survey def' using errcode = '22023';
  end if;
  return jsonb_build_object('survey_key', v_row.survey_key, 'status', v_row.status);
end $$;

revoke all on function public.set_survey_def_status(text, text) from public;
revoke execute on function public.set_survey_def_status(text, text) from anon;
grant execute on function public.set_survey_def_status(text, text) to authenticated;


-- 回をはじめるとき、DBの定義は「公開中」でなければ断る（下書きのまま学生に配らない）。
-- ★コード側（surveys.js）の key は表に無いので、今までどおり通る。それ以外は 2026-09-11 版と同じ。
create or replace function public.start_survey_round(
  p_survey_key   text,
  p_title        text,
  p_class_names  text[] default '{}',
  p_student_ids  uuid[] default '{}',
  p_closes_at    timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round survey_rounds%rowtype;
  v_n     integer;
begin
  if not app_hidden.is_teacher() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_survey_key is null or btrim(p_survey_key) = '' then
    raise exception 'survey_key が空です' using errcode = '22023';
  end if;
  if exists (select 1 from public.survey_defs
              where survey_key = p_survey_key and status <> 'published') then
    raise exception 'この アンケートは まだ公開していません（下書きのままでは配れません）'
      using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception '題名が空です（「2026年12月」のように、あとで見分けられる名前を付けてください）'
      using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception '締切が過去です' using errcode = '22023';
  end if;

  insert into public.survey_rounds
        (survey_key, title, class_names, student_ids, opens_at, closes_at, created_by)
  values (p_survey_key, btrim(p_title), coalesce(p_class_names, '{}'), coalesce(p_student_ids, '{}'),
          now(), p_closes_at, auth.uid())
  returning * into v_round;

  v_n := public.run_target_count(v_round.class_names, v_round.student_ids);

  return jsonb_build_object(
    'round_id', v_round.id, 'survey_key', v_round.survey_key, 'title', v_round.title,
    'class_names', to_jsonb(v_round.class_names), 'target_count', v_n,
    'opens_at', v_round.opens_at, 'closes_at', v_round.closes_at);
exception
  when unique_violation then
    raise exception '「%」はもう作ってあります（題名を変えてください）', btrim(p_title)
      using errcode = '23505';
end $$;

revoke all on function public.start_survey_round(text, text, text[], uuid[], timestamptz) from public;
revoke execute on function public.start_survey_round(text, text, text[], uuid[], timestamptz) from anon;
grant execute on function public.start_survey_round(text, text, text[], uuid[], timestamptz) to authenticated;

commit;

-- 巻き戻し（★作った定義の行は残す。表を落とすと、回答の意味を引けなくなる）:
--   begin;
--   drop function if exists public.save_survey_def(text, jsonb);
--   drop function if exists public.set_survey_def_status(text, text);
--   drop function if exists app_hidden.survey_def_problem(jsonb);
--   -- start_survey_round は db/2026-09-11_survey_rounds_phase2.sql の定義を流し直す
--   revoke select on table public.survey_defs from authenticated;
--   commit;
