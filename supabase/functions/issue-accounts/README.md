# issue-accounts（学生アカウントの発行）

Supabase の Edge Function。マスター画面「学生」→「アカウントの発行」が呼ぶ。

- **なぜあるか**：アカウントは Supabase の正規の口（Auth の管理用 API）で作る。DB から `auth` の表へ直接は書かない（2026-11-21 きあ・`docs/schema-plan.md` 5章の3）。
- **状態（2026-11-24）**：Supabase に置いた（`verify_jwt` 有効）。DB の SQL（`db/2026-11-24_account_issue_edge.sql`）も適用済み。
- **直したら、置き直す。** リポに入れただけでは、動いている関数は変わらない。

## ファイル

| ファイル | 中身 |
|---|---|
| `index.ts` | 通信だけ（呼んだ人のトークンで DB の関数を呼ぶ／Auth の管理用 API を呼ぶ） |
| `core.mjs` | 手順だけ（通信しない）。`node tests/test_issue_accounts_core.cjs` で確かめる |

## 入力と出力

- 入力：`POST /functions/v1/issue-accounts`、本文 `{ "rows": [{ "student_no", "display_name", "class_name" }] }`（30件まで）。`Authorization: Bearer <ログイン中の人のトークン>`
- 出力：`{ created, existing, invalid, failed, logged, results: [{ student_no, status, reason }] }`
- だれが呼べるか：「アカウントの発行・停止・再開」（`account.manage`＝情報管理者）を持つ人だけ。見ているのは DB（`issue_precheck`）

## 置く順番（どれも、きあの確認のあと）

1. `db/2026-11-24_account_issue_edge.sql` を流す（前の口 `issue_student_accounts` が外れる）
2. この関数を置く（`verify_jwt` は有効のまま）
3. 画面（`src/`）を公開する

## 置いたあと、実物で確かめること（検査では確かめられないもの）

通しの検査は通信を止めているので、下は実物で1回ずつ見る。ダミーの番号（`2604999` など）で試し、終わったら消す。

1. ~~ブラウザからの呼び出しが、`verify_jwt` を有効にしたままで通るか~~ → 11/24 に確認（事前の問い合わせは 200・トークンなしは 401）
2. はじめのパスワード「scg＋学籍番号」が、Auth のパスワードの決まり（長さ・文字の種類・漏れたパスワードの検査）で断られないか
   - 断られたら、結果に「符号 auth_weak_password」と出る
3. 作ったアカウントでログインできて、「パスワードの決め直し → お知らせ → ホーム」と進むか
4. 20件を1回で送って、時間切れにならないか

## 失敗したときの見方

- 画面に「まだ使えません（サーバーの準備待ち）」＝この関数が置かれていない（404）
- 画面に「アカウントを発行できるのは、その権限を持つ人だけです」＝押した人に権限が無い
- 行ごとの「符号 auth_…」＝Auth が断った理由（Supabase の画面 → Edge Functions → Logs にも件数が出る。学籍番号・氏名はログに出さない）
- 「ログイン用のアカウントだけが残りました」＝名簿に入れられず、消すのにも失敗した。Supabase の画面の Authentication で、その番号のアカウントを消してからやり直す

## 鍵

強い鍵（`SUPABASE_SERVICE_ROLE_KEY`）は、Supabase が関数に渡す。**リポ・画面・ログに書かない。** 使うのは Auth の管理用 API を呼ぶときだけ。
