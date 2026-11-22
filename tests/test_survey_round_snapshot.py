#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""test_survey_round_snapshot.py — 回の「配ったときの設問の写し」の見張り（DB不要・2026-11-21）

**DBには繋がない。** 見ていること:
  ① db/2026-11-24_survey_round_snapshot.sql が、決めた形から外れていないか（テキストとして読む）
     ・列は足すだけ／写しは1回だけ書ける／表へ直接は書けない／学生が呼ぶ口を変えていない
  ② 画面（admin.js）が、過去の回答を読むところで写しを先に使っているか
     ・写しが無い・DB がまだ変わっていないときは、今までどおり「いまの定義」に落ちる書き方か
  ③ 読む・保存する部品（survey-db.js）の動き＝ node tests/test_survey_round_snapshot.cjs を実際に走らせる

  py -X utf8 -m unittest discover -s tests -p "test_survey_round_snapshot.py" -v
依存: node（Node.js）。無ければ ③ は skip、①② だけ走る。
"""
from __future__ import annotations

import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "db" / "2026-11-24_survey_round_snapshot.sql"
CHECK_SQL = ROOT / "tests" / "sql" / "survey_round_snapshot_check.sql"
ADMIN = ROOT / "src" / "assets" / "admin.js"
SURVEY_DB = ROOT / "src" / "assets" / "survey-db.js"
NODE = shutil.which("node")


def strip_comments(sql: str) -> str:
    out = []
    for line in sql.splitlines():
        i = line.find("--")
        out.append(line if i < 0 else line[:i])
    return "\n".join(out)


class SqlShapeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = SQL.read_text(encoding="utf-8")
        cls.body = strip_comments(cls.raw)

    def test_only_adds_nullable_columns(self):
        """列は足すだけ・null 可＝古い画面も、写しの無い昔の回も、そのまま動く。"""
        adds = re.findall(r"(?i)alter\s+table\s+public\.survey_rounds\s+add\s+column\s+if\s+not\s+exists\s+(\w+)\s+([^;]+);", self.body)
        self.assertEqual([a[0] for a in adds], ["def_snapshot", "def_snapshot_at"])
        for name, rest in adds:
            self.assertNotRegex(rest, r"(?i)not\s+null", f"{name} を not null にすると昔の回が入らない")
        self.assertNotRegex(self.body, r"(?i)alter\s+table\s+public\.survey_responses", "回答の表は変えない")

    def test_snapshot_is_write_once(self):
        """🔴 入った写しは変えられない（直せる写しは写しではない）。"""
        self.assertRegex(self.body, r"(?is)old\.def_snapshot\s+is\s+not\s+null.+?new\.def_snapshot\s+is\s+distinct\s+from\s+old\.def_snapshot.+?raise\s+exception")
        self.assertRegex(self.body, r"(?is)before\s+insert\s+or\s+update\s+on\s+public\.survey_rounds\s+for\s+each\s+row\s+execute\s+function\s+app_hidden\.keep_survey_round_def\(\)")
        # RPC も、写しがある回は update まで進まない
        fn = re.search(r"(?is)create\s+or\s+replace\s+function\s+public\.save_survey_round_def.+?\$\$(.+?)\$\$", self.body).group(1)
        self.assertLess(fn.index("def_snapshot is not null"), fn.index("update public.survey_rounds"))
        self.assertRegex(fn, r"'saved',\s*false")

    def test_no_direct_write_by_staff(self):
        """表へ直接（authenticated）では写しを入れられない＝入口はトリガと RPC だけ。"""
        self.assertGreaterEqual(len(re.findall(r"current_user\s*=\s*'authenticated'", self.body)), 2,
                                "insert と update の両方で、表へ直接の書き込みを見分ける")

    def test_rpc_is_staff_only(self):
        fn = re.search(r"(?is)create\s+or\s+replace\s+function\s+public\.save_survey_round_def.+?\$\$(.+?)\$\$", self.body).group(1)
        self.assertRegex(fn, r"(?is)app_hidden\.can\('survey\.manage'\)\s+or\s+app_hidden\.can\('survey\.read'\)\)\s+then\s+raise\s+exception")
        self.assertNotIn("is_teacher()", fn, "「職員ならだれでも」に戻っていない")
        self.assertLess(fn.index("app_hidden.can("), fn.index("select * into v_round"), "権限の検査が先")
        self.assertRegex(self.body, r"(?i)revoke\s+execute\s+on\s+function\s+public\.save_survey_round_def\(uuid,\s*jsonb\)\s+from\s+anon")

    def test_db_defs_are_copied_by_server(self):
        """画面で作った定義の回は、サーバーが survey_defs から写す（画面から送られた値を使わない）。"""
        trg = re.search(r"(?is)create\s+or\s+replace\s+function\s+app_hidden\.keep_survey_round_def.+?\$\$(.+?)\$\$", self.body).group(1)
        self.assertRegex(trg, r"(?is)from\s+public\.survey_defs\s+d\s+where\s+d\.survey_key\s*=\s*new\.survey_key")
        self.assertRegex(self.body, r"(?is)update\s+public\.survey_rounds\s+r\s+set\s+def_snapshot\s*=\s*d\.def.+?r\.def_snapshot\s+is\s+null",
                         "いままでの回の埋め戻しは、写しの無い行だけ")

    def test_existing_rpcs_untouched(self):
        """回をはじめる・学生の一覧の口は作り直さない（3つ目の写しを増やさない・学生の受け取る形を変えない）。"""
        for name in ("start_survey_round", "my_open_survey_rounds", "close_survey_round", "save_survey_def"):
            self.assertNotRegex(self.body, rf"(?i)function\s+public\.{name}\s*\(", f"{name} を作り直している")

    def test_rollback_keeps_the_snapshots(self):
        tail = re.split(r"(?m)^commit;\s*$", self.raw, maxsplit=1)[1]
        self.assertIn("巻き戻し", tail)
        self.assertIn("drop function if exists public.save_survey_round_def(uuid, jsonb);", tail)
        self.assertIn("drop trigger if exists keep_survey_round_def on public.survey_rounds;", tail)
        self.assertNotRegex(tail, r"(?i)drop\s+column", "巻き戻しでも写しの列は落とさない")

    def test_check_sql_leaves_nothing(self):
        """検査 SQL は最後に例外で止める＝全部ロールバックされる。実在の値を書かない。"""
        text = CHECK_SQL.read_text(encoding="utf-8")
        self.assertRegex(text.strip(), r"(?s)raise exception 'RESULT%', r;\s*end \$\$;$")
        self.assertNotRegex(strip_comments(text), r"(?im)^\s*commit\s*;")
        self.assertNotRegex(text, r"\b\d{7}\b", "学籍番号らしい数字を書かない")


class ScreenWiringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = ADMIN.read_text(encoding="utf-8")
        cls.sdb = SURVEY_DB.read_text(encoding="utf-8")

    def test_results_view_prefers_snapshot_then_falls_back(self):
        """アンケート結果：回の写し → いまの定義 の順。写しが無ければ今までどおり。"""
        self.assertRegex(self.admin, r"const sdef = \(\) => snapOf\(S\.rid\) \|\| defOf\(S\.key\) \|\| SURVEYS\[0\];")
        self.assertRegex(self.admin, r"await snapLoad\(S\.rounds\.map\(")

    def test_student_drawer_prefers_snapshot_then_falls_back(self):
        """学生の詳細（過去の回答の読み返し）：回ごとに写し → いまの定義。"""
        self.assertRegex(self.admin, r"const def = snapOf\(r\.round_id\) \|\| defOf\(r\.survey_key\); if \(!def\) return;")
        self.assertRegex(self.admin, r"await snapLoad\(rows\.map\(")

    def test_snapshot_load_never_stops_the_screen(self):
        """写しを読めなくても画面は出す（DB 適用前・通信の失敗）。"""
        self.assertRegex(self.admin, r"const snapLoad = async rounds => \{ try \{.+?\} catch \(e\) \{")
        self.assertRegex(self.admin, r"const snapOf = rid => \(window\.SurveyDB && SurveyDB\.roundDef \?")

    def test_survey_db_does_not_touch_SURVEYS_for_snapshots(self):
        """写しは SURVEYS に足さない＝学生画面・回をはじめる一覧は「いまの定義」のまま。"""
        part = self.sdb[self.sdb.index("const snap = "):self.sdb.index("window.SurveyDB =")]
        self.assertNotRegex(part, r"SURVEYS\.(push|splice)|SURVEYS\[[^\]]+\]\s*=")
        self.assertRegex(self.sdb, r"window\.SurveyDB = \{[^}]*roundDef, loadRoundDefs, saveRoundDef")

    def test_no_internal_names_in_messages(self):
        """先生の画面に内部の列名・RPC 名を出さない（今回は文言を足していない）。"""
        for word in ("def_snapshot", "save_survey_round_def"):
            self.assertNotIn(word, self.admin)


@unittest.skipUnless(NODE, "node が無いので skip（SQL と画面のつなぎの検査だけ走ります）")
class NodeBehaviourTest(unittest.TestCase):
    def test_node_checks_pass(self):
        p = subprocess.run([NODE, str(ROOT / "tests" / "test_survey_round_snapshot.cjs")],
                           capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout[-1500:] + p.stderr[-500:])
        self.assertNotIn("FAIL ", p.stdout)


if __name__ == "__main__":
    unittest.main()
