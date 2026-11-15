# -*- coding: utf-8 -*-
"""1月進路アンケートと共通入力モデルのオフライン回帰検査。

資格情報・DB・ネットワークを使わない。実際のJavaScriptをNodeで実行し、
型・選択肢・分岐・再提出用の正規化と旧定義の互換性を確かめる。
"""
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
SURVEYS = ROOT / "src" / "assets" / "surveys.js"
FORM = ROOT / "src" / "assets" / "survey-form.js"


FIXTURE = {
    "key": "offline_fixture",
    "q": [
        {"k": "status", "t": "select", "required": True,
         "l": {"ja": "学校の希望", "en": "School plans"},
         "o": [{"v": "decided", "ja": "決まっている", "en": "Decided"},
               {"v": "undecided", "ja": "未定", "en": "Undecided"}]},
        {"k": "school", "t": "text", "required": True,
         "showWhen": {"key": "status", "is": "decided"},
         "maxLength": 50, "l": {"ja": "学校名", "en": "School name"}},
        {"k": "concerns", "t": "multi", "required": True,
         "exclusive": ["none"],
         "l": {"ja": "心配なこと", "en": "Concerns"},
         "o": [{"v": "money", "ja": "費用", "en": "Money"},
               {"v": "language", "ja": "日本語", "en": "Japanese"},
               {"v": "none", "ja": "特になし", "en": "None"}]},
        {"k": "exam", "t": "multi", "exclusiveGroups": [["n1", "n2"]],
         "l": {"ja": "受験予定", "en": "Exam plans"},
         "o": [{"v": "n1", "ja": "N1", "en": "N1"},
               {"v": "n2", "ja": "N2", "en": "N2"},
               {"v": "eju", "ja": "EJU", "en": "EJU"}]},
        {"k": "day", "t": "date",
         "l": {"ja": "相談する日", "en": "Discussion date"}},
        {"k": "field2", "t": "select", "required": True,
         "l": {"ja": "第2希望", "en": "Second choice"},
         "o": [{"v": "it", "ja": "IT", "en": "IT"},
               {"v": "unknown", "ja": "未定", "en": "Undecided"}]},
    ],
}
BASE_ANSWERS = {"status": "decided", "school": "Example school",
                "concerns": ["money"], "exam": ["n2", "eju"],
                "field2": "unknown", "day": "2027-01-15"}
CAREER_UNDECIDED = {
    "jlpt_level": "n4", "future_exams": ["undecided"],
    "education": "high_school", "path": "undecided", "job": "undecided",
    "field_first": "unknown", "field_second": "unknown",
    "schools_status": "undecided", "areas": ["anywhere"], "oc_status": "no",
    "funding": ["unknown"], "family_status": "discussing", "concerns": ["none"],
    "interview_preference": "regular",
}


def node_value(expression, payload=None):
    """受け渡す値はこのテストの架空データだけ。資格情報は取得しない。"""
    program = (
        "const fs=require('node:fs');"
        "const form=require(process.argv[1]);"
        "const src=fs.readFileSync(process.argv[2],'utf8');"
        "const defs=new Function(src+';return {surveys:SURVEYS,optLabel};')();"
        "const input=JSON.parse(process.argv[3]);"
        "const value=(" + expression + ");"
        "process.stdout.write(JSON.stringify(value));"
    )
    result = subprocess.run(
        ["node", "-e", program, str(FORM), str(SURVEYS), json.dumps(payload)],
        capture_output=True, text=True, encoding="utf-8", timeout=20,
    )
    if result.returncode:
        raise AssertionError("Offline JavaScript check failed: " + result.stderr[:600])
    return json.loads(result.stdout)


class TestCareerSurveyDefinition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.definition = node_value(
            "defs.surveys.find(s=>s.key==='shinro_2027_jan_v1')")

    def test_separate_definition_and_four_sections(self):
        self.assertIsNotNone(self.definition)
        self.assertEqual(self.definition.get("schemaVersion"), 1)
        self.assertTrue(self.definition.get("studentIdentity"))
        self.assertEqual(len(self.definition.get("sections", [])), 4)
        self.assertEqual(len({s["key"] for s in self.definition["sections"]}), 4)

    def test_japanese_and_english_only(self):
        def visit(value):
            if isinstance(value, dict):
                if "ja" in value:
                    self.assertTrue({"ja", "en"}.issubset(value))
                    # flag＝管理画面で目立たせる理由の札（2026-11-16）。言語ではないので許す
                    self.assertFalse(set(value) - {"ja", "en", "v", "flag"})
                    self.assertTrue(value["ja"].strip())
                    self.assertTrue(value["en"].strip())
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        visit(self.definition)

    def test_n4_without_independent_n5_choice(self):
        levels = [q for q in self.definition["q"]
                  if {"n1", "n2", "n3", "n4"}.issubset(
                      {o["v"] for o in q.get("o", [])})]
        self.assertEqual(len(levels), 1)
        self.assertNotIn("n5", {o["v"] for o in levels[0]["o"]})

    def test_second_field_has_undecided(self):
        second = next(q for q in self.definition["q"] if q["k"] == "field_second")
        self.assertIn("unknown", {o["v"] for o in second["o"]})

    def test_source_question_topics_are_all_present(self):
        expected = {"jlpt_level", "future_exams", "education", "path", "job",
                    "field_first", "field_second", "schools_status",
                    "school_1", "school_2", "school_3", "areas", "oc_status",
                    "oc_school", "funding", "family_status", "family_talk_by",
                    "concerns", "interview_preference"}
        self.assertTrue(expected.issubset({q["k"] for q in self.definition["q"]}))

    def test_actual_undecided_path_can_be_submitted(self):
        result = node_value(
            "form.validate(defs.surveys.find(s=>s.key==='shinro_2027_jan_v1'),input,{lang:'ja'})",
            CAREER_UNDECIDED)
        self.assertTrue(result["ok"], result.get("errors"))
        self.assertEqual(result["answers"]["field_second"], "unknown")

    def test_actual_undecided_school_drops_all_stale_school_names(self):
        result = node_value(
            "form.normalize(defs.surveys.find(s=>s.key==='shinro_2027_jan_v1'),input)",
            dict(CAREER_UNDECIDED, school_1="Example 1", school_2="Example 2", school_3="Example 3"))
        self.assertTrue(all(key not in result for key in ("school_1", "school_2", "school_3")))

    def test_actual_conditional_date_and_other_are_required(self):
        answers = dict(CAREER_UNDECIDED, family_status="not_yet", future_exams=["other"])
        result = node_value(
            "form.validate(defs.surveys.find(s=>s.key==='shinro_2027_jan_v1'),input,{lang:'en'})",
            answers)
        self.assertFalse(result["ok"])
        errors = {error["key"] for error in result["errors"]}
        self.assertIn("family_talk_by", errors)
        self.assertIn("future_exams_other", errors)
        answers.update(family_talk_by="2027-01-31", future_exams_other="Example exam")
        complete = node_value(
            "form.validate(defs.surveys.find(s=>s.key==='shinro_2027_jan_v1'),input,{lang:'en'})",
            answers)
        self.assertTrue(complete["ok"], complete.get("errors"))

    def test_original_career_definition_unchanged(self):
        original = node_value("defs.surveys.find(s=>s.key==='shinro_2026')")
        self.assertEqual([q["k"] for q in original["q"]], ["job", "field", "town"])
        self.assertEqual([q["t"] for q in original["q"]], ["text", "select", "text"])
        self.assertEqual(len(original["q"][1]["o"]), 10)

    def test_multiselect_teacher_labels_are_readable(self):
        result = node_value(
            "(()=>{const q={t:'multi',o:[{v:'a',ja:'選択A',en:'A'},"
            "{v:'b',ja:'選択B',en:'B'}]};return defs.optLabel(q,['b','a']);})()")
        self.assertIsInstance(result, str)
        self.assertIn("選択A", result)
        self.assertIn("選択B", result)


class TestSurveyFormModel(unittest.TestCase):
    def evaluate(self, answers, expression="form.validate(input.def,input.answers,{lang:'ja'})"):
        return node_value(expression, {"def": FIXTURE, "answers": answers})

    def test_valid_answers_and_explicit_undecided_are_accepted(self):
        result = self.evaluate(BASE_ANSWERS)
        self.assertTrue(result["ok"], result.get("errors"))
        self.assertEqual(result["answers"]["field2"], "unknown")
        self.assertEqual(result["answers"]["concerns"], ["money"])

    def test_missing_required_answer_has_field_error(self):
        answer = dict(BASE_ANSWERS, field2="")
        result = self.evaluate(answer)
        self.assertFalse(result["ok"])
        self.assertTrue(any(error["key"] == "field2" for error in result["errors"]))

    def test_conditional_required_is_only_required_when_visible(self):
        hidden = self.evaluate(dict(BASE_ANSWERS, status="undecided", school=""))
        self.assertTrue(hidden["ok"], hidden.get("errors"))
        self.assertNotIn("school", hidden["answers"])
        visible = self.evaluate(dict(BASE_ANSWERS, status="decided", school=""))
        self.assertFalse(visible["ok"])
        self.assertTrue(any(error["key"] == "school" for error in visible["errors"]))

    def test_stale_hidden_and_unknown_values_are_not_saved(self):
        answer = dict(BASE_ANSWERS, status="undecided", school="Old selection", injected="unknown key")
        result = self.evaluate(answer, "form.normalize(input.def,input.answers)")
        self.assertNotIn("school", result)
        self.assertNotIn("injected", result)
        self.assertEqual(result["status"], "undecided")

    def test_exclusive_none_and_other_concerns_are_rejected(self):
        result = self.evaluate(dict(BASE_ANSWERS, concerns=["none", "money"]))
        self.assertFalse(result["ok"])
        self.assertTrue(any(error["key"] == "concerns" for error in result["errors"]))

    def test_exclusive_group_is_rejected(self):
        result = self.evaluate(dict(BASE_ANSWERS, exam=["n1", "n2"]))
        self.assertFalse(result["ok"])
        self.assertTrue(any(error["key"] == "exam" for error in result["errors"]))

    def test_nonexistent_date_is_rejected(self):
        for value in ["2027-02-29", "2027-13-01", "2027-01-32", "15/01/2027"]:
            with self.subTest(value=value):
                result = self.evaluate(dict(BASE_ANSWERS, day=value))
                self.assertFalse(result["ok"])
                self.assertTrue(any(error["key"] == "day" for error in result["errors"]))

    def test_valid_leap_day_is_accepted(self):
        result = self.evaluate(dict(BASE_ANSWERS, day="2028-02-29"))
        self.assertTrue(result["ok"], result.get("errors"))

    def test_unknown_choice_and_wrong_types_are_rejected(self):
        invalid = [dict(BASE_ANSWERS, status="not_in_options"),
                   dict(BASE_ANSWERS, concerns="money"),
                   dict(BASE_ANSWERS, concerns=["not_in_options"]),
                   dict(BASE_ANSWERS, school={"not": "a string"})]
        for answer in invalid:
            with self.subTest(answer=answer):
                self.assertFalse(self.evaluate(answer)["ok"])

    def test_maximum_text_length_is_enforced(self):
        self.assertFalse(self.evaluate(dict(BASE_ANSWERS, school="x" * 51))["ok"])

    def test_multi_parent_condition_and_inputs_are_not_mutated(self):
        value = node_value(
            "(()=>{const before=JSON.stringify(input.answers);"
            "const visible=form.isVisible({showWhen:{key:'concerns',is:'money'}},input.answers);"
            "form.normalize(input.def,input.answers);"
            "return {visible,unchanged:before===JSON.stringify(input.answers)};})()",
            {"def": FIXTURE, "answers": BASE_ANSWERS})
        self.assertTrue(value["visible"])
        self.assertTrue(value["unchanged"])

    def test_legacy_empty_and_one_answer_behavior(self):
        value = node_value(
            "(()=>{const d=defs.surveys.find(s=>s.key==='shinro_2026');"
            "return {empty:form.validate(d,{}, {lang:'ja'}),"
            "one:form.validate(d,{job:'Example job'}, {lang:'ja'})};})()")
        self.assertFalse(value["empty"]["ok"])
        self.assertTrue(value["one"]["ok"], value["one"].get("errors"))


if __name__ == "__main__":
    unittest.main()
