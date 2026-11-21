# 共通スキーマの設計（案・未適用）

`docs/yakusoku.md` の決まりを、データベースの形に落としたもの。**まだ SQL にしていない・流していない。** きあの確認のあと、`db/` に日付つき SQL として1本ずつ置く。

機能を作る人は、ここにある表・関数を使う。ここに無いものを足したくなったら、止まってリードに報告する。

## 0. 変えないもの

- `app_hidden.is_teacher()`（＝職員かどうか）と `is_master()` は、そのまま残す。18のポリシーと8つの関数が呼んでいて、一度に書き換えると静かに権限が抜けるため
- 新しく作る機能と、線を締め直す関数（下の 1-4）だけ、新しい `app_hidden.can()` を使う
- `profiles.role`（student / teacher / master）の意味は変えない

## 1. できること

### 1-1. 表

```
capabilities          できることの一覧（固定・SQL で入れる。画面からは増やせない）
  key   text primary key      例 'quiz.run' 'quiz.result.export' 'audit.read'
  label text not null         画面に出す日本語

cap_bundles           束（ひな型）
  bundle  text                'teacher' | 'fulltime' | 'info_admin'（あとで 'office' などを足す）
  cap_key text → capabilities
  primary key (bundle, cap_key)

staff_caps            人ごとの足し引き（束との差だけを持つ）
  profile_id uuid → profiles
  cap_key    text → capabilities
  granted    boolean          true＝足す／false＝外す
  primary key (profile_id, cap_key)
```

`profiles` に列を1つ足す：`bundle text`（職員だけ。null のときは role から決める＝teacher→'teacher'、master→'fulltime'）。
＝**いまの職員は、何もしなくても今までどおり動く。** 情報管理者だけ、手で `bundle='info_admin'` を入れる。

### 1-2. できることの鍵（yakusoku.md 2章の表と1対1）

| 鍵 | 先生 | 常勤 | 情報管理者 |
|---|---|---|---|
| `quiz.run`（始める。自分の回を閉じる・取り消す） | ○ | ○ | ○ |
| `quiz.run.any`（他の人の回を閉じる・取り消す） | | ○ | ○ |
| `retest.run`（再テストの一覧・開く） | ○ | ○ | ○ |
| `quiz.result.one`（回を1つ開いて名前と点数） | ○ | ○ | ○ |
| `quiz.result.export`（まとめて見る・書き出す） | | ○ | ○ |
| `quiz.edit`（問題の登録・編集・公開・削除） | | ○ | ○ |
| `quiz.passline`（合格の線を変える） | | ○ | ○ |
| `survey.manage`（作る・回を始める・閉じる） | | ○ | ○ |
| `survey.read`（回答と提出の状況） | | ○ | ○ |
| `student.read`（名簿と学生の詳細） | | ○ | ○ |
| `student.pwreset`（パスワードを初期値に戻す） | | ○ | ○ |
| `account.manage`（発行・停止・再開・卒業生へ） | | | ○ |
| `notice.send`（お知らせ） | | ○ | ○ |
| `quiz.editlog.read`（問題の変更の履歴） | | ○ | ○ |
| `audit.read`（操作の記録） | | | ○ |
| `caps.manage`（権限を変える） | | | ○ |

### 1-3. 関数

- `app_hidden.can(p_cap text) returns boolean`（security definer・stable）
  ＝ログイン中の人が職員で、停止されておらず、（束に入っている または 足されている）かつ 外されていない
- `public.my_caps() returns text[]`＝画面が「どのボタンを出すか」を決めるためのもの。**案内であって権限ではない**（`my_role()` と同じ位置づけ）
- `public.set_staff_cap(p_profile, p_cap, p_granted, p_approver text)`＝`caps.manage` を持つ人だけ。操作の記録に1行（承認者つき）
- 表はどれも RLS を有効にし、直接は書けない。読めるのは `caps.manage` を持つ人（`capabilities` だけは職員全員が読める）

### 1-4. 既存の関数で、線を締め直すもの

いまは「職員なら可」。次の SQL で `can()` に替える（1本ずつ・検査つき）。

| 関数 | いま | これから |
|---|---|---|
| `delete_quiz_set` | 職員 | `quiz.edit` |
| `start_survey_round` / `close_survey_round` | 職員 | `survey.manage` |
| `close_quiz_run` / `void_quiz_run` | 職員 | 自分が始めた回なら `quiz.run`、他の人の回なら `quiz.run.any` |
| `quiz_stats`（名前と点数を返す） | 職員 | 回を指定＝`quiz.result.one`／横断＝`quiz.result.export` |
| `reset_student_password` | マスター | `student.pwreset` |

## 2. 操作の記録

```
audit_log
  id          bigint generated always as identity primary key
  at          timestamptz not null default now()
  actor_id    uuid not null            だれが（外部キーを張らない＝アカウントを消しても残す）
  actor_role  text not null            そのときの束（'teacher' など）
  action      text not null            何を。例 'quiz.run.start' 'view.retest_list' 'caps.set'
  target_type text                     どれに。例 'quiz_run' 'student' 'class'
  target_id   text                     その id（クラスならクラス名）
  detail      jsonb not null default '{}'   件数・種類まで。本文・回答・個人の値は入れない
```

- 書く口は2つだけ
  - `app_hidden.audit(action, target_type, target_id, detail)`＝ほかの RPC の中から呼ぶ（書き換えの記録）
  - `public.log_view(p_screen text, p_target_type text, p_target_id text)`＝画面が「名前の並ぶ画面を開いた」ときに呼ぶ。職員だけ。同じ人・同じ画面・同じ対象は、10分に1行まで
- select のポリシーは `can('audit.read')` だけ。insert / update / delete のポリシーは作らない
- `action` の名前は、この文書の末尾の一覧に足してから使う（担当ごとに別の名前を作らない）
- 既存の `quiz_edit_log`・`password_reset_log` は消さない。新しい機能は `audit_log` に書く。寄せるのは後で

## 3. アカウントの状態

`profiles` に足す：

```
status            text not null default 'active'   'active' | 'graduated' | 'withdrawn'
status_changed_at timestamptz
status_changed_by uuid
graduated_on      date            卒業した日（5年の起点）
```

- `homeroom_id uuid → profiles`（学生の行だけ。担任の職員。null＝未設定）。書き換えは `public.set_homeroom(p_student_ids uuid[], p_staff uuid)`＝`account.manage` を持つ人だけ・操作の記録に1行。学生本人は自分の担任の名前だけ読める
- 学生が書く RPC（`submit_attempt`・`save_draft`・`record_away`・アンケートの提出）は、`status='active'` の学生だけ通す
- `graduated`＝ログインできる。自分の記録は読める。受ける・出すは通らない。開いている回の一覧にも出ない
- `withdrawn`＝ログインできない（Auth 側でも止める）＋ 上と同じく書けない
- 切り替えは `public.set_account_status(p_student, p_status)`＝`account.manage` を持つ人だけ。操作の記録に1行
- 学籍番号の検査は `app_hidden.normalize_student_no(text)` の1か所（全角→半角・ハイフンを取る・数字7桁でなければ null）
- 発行（アカウントを作る）の方式は、この文書では決めない（DB から直接作るか、Edge Function か。別に決める）

## 4. テストの種類・合格の線・再テスト

```
quiz_kinds
  key        text primary key      'daily' | 'kanji' | 'matome'
  label      text not null         毎日のテスト／漢字テスト／まとめテスト
  has_retest boolean not null      daily=false, kanji=true, matome=true
  pass_pct   integer not null      80（1〜100）

quiz_sets に足す：  kind_key text → quiz_kinds（null＝種類なし＝合否を出さない）
quiz_runs に足す：  pass_pct  integer         始めた瞬間の線の写し（＝線を変えても、終わった回の合否は動かない）
                    retest_of uuid → quiz_runs  再テスト・あとから受ける回なら、元の回
```

- 合否は保存しない。`正解数 × 100 >= pass_pct × 問題数` で、そのつど計算する（`attempts.score` / `total` は今のまま）
- 線を変える＝`public.set_pass_pct(p_kind, p_pct)`（`quiz.passline`・操作の記録に1行）。次に始める回から効く
- **再テストの対象の決め方**（元の回ごと・学生ごと）
  - 元の回とその `retest_of` の回を「ひとつながり」と見る
  - つながりの中に提出が1つも無い → 「まだ受けていない（1回目）」
  - 提出が1つだけで、不合格 → 「再テストの対象」
  - 提出が2つ → 終わり（合格でも不合格でも、もう出さない）
  - 最初の提出が合格 → 終わり
  - `status` が `active` でない学生は、どこにも出さない
- 一覧を返す＝`public.retest_targets(p_class_name text)`（`retest.run`）。返すのは名前・対象テスト・元の回の日付・状態だけ。**点数は返さない**
- 再テストを開く＝`public.start_retest_run(p_origin_run uuid, p_minutes int)`。元の回の翌日以降だけ。対象はサーバーが上の決め方で入れる（画面から名簿を渡さない）。`closes_at` は「押した時刻＋分数」と「その日の終わり」の早いほう＝閉じ忘れても日をまたがない
- 再テストの回の提出も、今の「実施回ごとに1回だけ」で受ける。最初の点はそのまま残る
- 本人へのお知らせ＝`public.my_retests()`（学生本人だけ・自分の分だけ）。学生画面のホームに出す
- 集計（平均と、80% に届かなかった割合）は、今ある `attempts` から出す。表は足さない

## 5. きあに確かめたいこと

1. ~~「いまいる教室を選ぶ」~~ → 決定：先生はクラスを選ぶ。教室とクラスを結ぶ表は持たない。再テストは教室の画面に映さない。いつものテストを閉じた直後にも、そのクラスの「再テストの学生が◯名います」を出す（`retest_targets` をそのクラス名で呼ぶだけ＝表は足さない）
2. ~~再テストの時間~~ → 決定：元のテストと同じ分数を初めから入れておき、先生が変えられる
3. ~~アカウントの発行の方式~~ → 決定：Edge Function（Supabase の正規の口を通す。DB から auth の表へ直接は入れない）

## 6. 流す順番（1本ずつ・それぞれロールバック検査つき）

1. できること（表3つ・`can()`・`my_caps()`）＝何も締めない。足すだけ
2. 操作の記録（表・`audit()`・`log_view()`）
3. アカウントの状態（列・書く RPC の検査）
4. テストの種類と再テスト
5. 既存の関数の締め直し（1-4 の表を1行ずつ）

1〜4 は、今の画面を1行も変えなくても動く形にする（足すだけ・既定値つき）。

## 付録：操作の記録の `action` 一覧

| action | いつ |
|---|---|
| `view.retest_list` | 再テストの一覧を開いた |
| `view.run_result` | 回を1つ開いて名前と点数を見た |
| `view.student_list` | 名簿を開いた |
| `view.student_detail` | 学生の詳細を開いた |
| `view.survey_result` | アンケートの回答・提出の状況を開いた |
| `export.quiz_result` | 結果を書き出した |
| `quiz.run.start` / `.close` / `.void` | 実施回 |
| `retest.run.start` | 再テストを開いた |
| `passline.set` | 合格の線を変えた |
| `account.status.set` | 在籍・卒業生・退学を切り替えた |
| `account.issue` | アカウントを発行した |
| `password.reset` | パスワードを初期値に戻した |
| `caps.set` | 人ごとの足し引きを変えた |
| `caps.bundle.set` | 束を付け替えた |

## 進み具合（SQL にしたもの）

| 順 | ファイル | 検査 | 状態 |
|---|---|---|---|
| 1 | `db/2026-11-21_capabilities.sql` | `tests/sql/capabilities_check.sql`（25項目） | ロールバック検査は通過（2026-11-22）。**未適用** |
| 2 | `db/2026-11-22_audit_log.sql` | `tests/sql/audit_log_check.sql`（32項目） | ロールバック検査は通過（2026-11-22）。**未適用** |
| 3 | アカウントの状態 | — | まだ書いていない |
| 4 | テストの種類と再テスト | — | まだ書いていない |
| 5 | 既存の関数の締め直し | — | まだ書いていない |

2本目で決めたこと：権限を変える口は `set_staff_cap`（人ごとの足し引き）と `set_staff_bundle`（束の付け替え）の2つ。どちらも承認者の記入が必須。自分の「権限を変える」と自分の束は、自分では変えられない（うっかり外して、だれも直せなくなるのを防ぐ）。
