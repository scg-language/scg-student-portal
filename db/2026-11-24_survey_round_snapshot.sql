-- アンケートの回に「配ったときの設問・選択肢の写し」を持たせる（1E の残り）。            2026-11-24
--   2026-11-21 の自走ぶん（work/2026-11-21-jisou）を、約束事（docs/yakusoku.md 2章）に合わせて拾い直したもの。
--   変えた所は1つ：写しを保存できる人を「職員ならだれでも」から、
--   「アンケートを作る・回を始める（survey.manage）」か「回答を見る（survey.read）」を持つ人にした。
--
-- ★なぜ要るか
--   回答（survey_responses.answers）には選択肢の値（v）だけが入り、設問文・選択肢の名前は入っていない。
--   読むときは survey_key で「いまの定義」を引いて名前に戻している。
--   ・画面で作った定義（survey_defs）は、回をはじめたあと直せない（2026-11-18）＝実質そのまま残る
--   ・コードの定義（src/assets/surveys.js）には守りが無い。書き換えると、過去の回答が
--     「いまの文言」で読まれてしまう（選択肢を消すと、保存された記号がそのまま画面に出る）
--   → 回ごとに、配ったときの定義の写しを1つ持つ。職員が過去の回答を読むときは写しを先に使う。
--
-- ★決めたこと
--   ・列を足すだけ（survey_rounds.def_snapshot / def_snapshot_at）。既存の行・回答は変えない
--   ・画面で作った定義の回 …… 回を作った瞬間に、サーバーが survey_defs から写す（トリガ。画面は何もしない）
--   ・コードの定義の回 …… サーバーは surveys.js を知らないので、職員の画面が回をはじめた直後に
--     save_survey_round_def で写しを送る。まだ写しの無い昔の回も、職員が結果を開いたときに同じ口で埋まる
--     （def_snapshot_at が opens_at より大きく後ろなら「あとから取った写し」と分かる）
--   ・🔴 写しは1回だけ書ける。入ったあとは誰も直せない・空に戻せない（直せる写しは写しではない）
--   ・表へ直接は書かせない（職員が表を直接 PATCH しても写しは入らない＝入口は上の2つだけ）
--   ・列が増えるだけなので、画面が古いままでも動く。画面が先に出ていても動く（列・RPC が無ければ今までどおり読む）
--
-- 流す前: py -X utf8 tests/test_db_migrations.py
-- 流したあと: tests/sql/survey_round_snapshot_check.sql（全部ロールバックする検査）／python tests/test_security.py ／
--            get_advisors（WARN が1件増える＝save_survey_round_def。中で権限を見ている・仕様）
begin;

alter table public.survey_rounds add column if not exists def_snapshot    jsonb;
alter table public.survey_rounds add column if not exists def_snapshot_at timestamptz;

comment on column public.survey_rounds.def_snapshot is
  '配ったときのアンケート定義の写し（surveys.js の1件と同じ形・key なし）。1回だけ書ける。null＝写しなし（いまの定義で読む）';
comment on column public.survey_rounds.def_snapshot_at is
  '写しを取った時刻。opens_at とほぼ同じ＝配布時の写し／大きく後ろ＝あとから取った写し';

-- いままでに はじめた回のうち、画面で作った定義（survey_defs）のものを埋める。
-- ★この定義は回をはじめたあと直せないので、いまの中身＝配ったときの中身。
update public.survey_rounds r
   set def_snapshot = d.def, def_snapshot_at = now()
  from public.survey_defs d
 where d.survey_key = r.survey_key
   and r.def_snapshot is null;


-- 写しの番人。
--   insert: 画面で作った定義の回なら、ここで survey_defs から写す（送られてきた値は使わない）。
--           それ以外の回で、表へ直接 insert された写しは受け取らない（入口は save_survey_round_def だけ）。
--   update: 入っている写しは変えられない。空の写しを表へ直接 PATCH で入れることもできない。
-- SECURITY INVOKER: current_user で「表へ直接（authenticated）」か「RPC の中（関数の持ち主）」かを見分ける
--   （db/2026-11-16_survey_response_write_guard.sql の keep_survey_response_identity と同じ見分け方）。
create or replace function app_hidden.keep_survey_round_def() returns trigger
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_def jsonb;
begin
  if tg_op = 'INSERT' then
    select d.def into v_def from public.survey_defs d where d.survey_key = new.survey_key;
    if found then
      new.def_snapshot    := v_def;
      new.def_snapshot_at := now();
    elsif current_user = 'authenticated' then
      new.def_snapshot    := null;
      new.def_snapshot_at := null;
    elsif new.def_snapshot is not null and new.def_snapshot_at is null then
      new.def_snapshot_at := now();
    end if;
    return new;
  end if;

  if old.def_snapshot is not null then
    if new.def_snapshot is distinct from old.def_snapshot
       or new.def_snapshot_at is distinct from old.def_snapshot_at then
      raise exception 'この回の設問の写しは変えられません' using errcode = '23514';
    end if;
  elsif (new.def_snapshot is not null or new.def_snapshot_at is not null)
        and current_user = 'authenticated' then
    raise exception '設問の写しは表へ直接書けません' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function app_hidden.keep_survey_round_def()
  from public, anon, authenticated, service_role;

drop trigger if exists keep_survey_round_def on public.survey_rounds;
create trigger keep_survey_round_def
  before insert or update on public.survey_rounds
  for each row execute function app_hidden.keep_survey_round_def();


-- 写しを保存する（アンケートを扱える職員だけ・1回だけ）。
--   もう写しがある回 → 何もしないで saved=false を返す（同じ画面が2回送っても壊れない）
--   画面で作った定義の回 → p_def は使わず survey_defs から写す
--   コードの定義の回 → p_def（surveys.js の1件。key は外す）を写す
-- ★中身の検査は「壊れた形を入れない」だけ（オブジェクト・大きさ・質問が1つ以上）。
--   survey_def_problem ほど細かく見ない＝目的は残すことで、細かい検査で写しを断ると残らないほうが困る。
create or replace function public.save_survey_round_def(p_round_id uuid, p_def jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round survey_rounds%rowtype;
  v_def   jsonb;
  v_at    timestamptz := now();
begin
  if auth.uid() is null or not (app_hidden.can('survey.manage') or app_hidden.can('survey.read')) then
    raise exception '設問の写しを保存できるのは、アンケートを扱う権限を持つ人だけです' using errcode = '42501';
  end if;

  select * into v_round from public.survey_rounds where id = p_round_id for update;
  if v_round.id is null then
    raise exception 'no such survey round' using errcode = '22023';
  end if;
  if v_round.def_snapshot is not null then
    return jsonb_build_object('round_id', v_round.id, 'saved', false,
                              'def_snapshot_at', v_round.def_snapshot_at);
  end if;

  select d.def into v_def from public.survey_defs d where d.survey_key = v_round.survey_key;
  if not found then
    if p_def is null or jsonb_typeof(p_def) <> 'object' then
      raise exception '定義の形が正しくありません' using errcode = '22023';
    end if;
    if octet_length(p_def::text) > 200000 then
      raise exception '定義が大きすぎます' using errcode = '22023';
    end if;
    if jsonb_typeof(p_def -> 'q') is distinct from 'array'
       or jsonb_array_length(p_def -> 'q') = 0 then
      raise exception '質問が1つもありません' using errcode = '22023';
    end if;
    v_def := p_def - 'key' - '_db';
  end if;

  update public.survey_rounds
     set def_snapshot = v_def, def_snapshot_at = v_at
   where id = v_round.id;

  return jsonb_build_object('round_id', v_round.id, 'saved', true, 'def_snapshot_at', v_at);
end $$;

revoke all on function public.save_survey_round_def(uuid, jsonb) from public;
revoke execute on function public.save_survey_round_def(uuid, jsonb) from anon;
grant execute on function public.save_survey_round_def(uuid, jsonb) to authenticated;

commit;

-- 巻き戻し（★列と、入っている写しは残す。落とすと過去の回答を配ったときの文言で読めなくなる。
--   列が残っていても、古い画面は読まないだけで今までどおり動く）:
--   begin;
--   drop function if exists public.save_survey_round_def(uuid, jsonb);
--   drop trigger if exists keep_survey_round_def on public.survey_rounds;
--   drop function if exists app_hidden.keep_survey_round_def();
--   commit;
