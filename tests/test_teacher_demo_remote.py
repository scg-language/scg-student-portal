# -*- coding: utf-8 -*-
"""Opt-in smoke checks for the isolated, fixture-only teacher demo RPCs.

Run this file alone with SP_DEMO_LIVE=1 after provisioning the demo classroom.
No real quiz, student, survey, or attendance records are written. Only room-a
in teacher_demo_sessions is changed, with four synthetic submissions. Display
keys, credentials, access tokens, response bodies, and connection URLs are never
included in test output. Cleanup returns the demo classroom to waiting mode.
"""
import ast
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import unittest
import urllib.error
import urllib.parse
import urllib.request

from env_creds import (
    get_teacher_no, get_teacher_pw, get_student_no, get_student_pw,
)


ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "src/assets/teacher-two-device-core.js"
LIVE = os.environ.get("SP_DEMO_LIVE") == "1"
ROOM = "room-a"
SAFE_ERROR_CODES = {
    "40001", "PT409", "42501", "22023", "28000", "42P01", "42883", "42703",
    "PGRST202", "PGRST205", "PGRST301", "PGRST003",
}
DTO_FIELDS = {
    "schemaVersion", "mode", "roomLabel", "statusLabel", "testTitle", "classLabel",
    "target", "submitted", "remainingSeconds", "showStats", "average", "correctRate", "question",
}
PRIVATE_FIELDS = {
    "studentId", "student_id", "studentNo", "student_no", "name", "displayName",
    "display_name", "teacherId", "teacher_id", "actorId", "actor_id", "owner_id",
    "submissions", "attempts", "profiles", "private_state", "key", "key_hash",
    "password", "token", "runId", "run_id",
}


class DemoRemoteError(RuntimeError):
    """An intentionally sanitized error, suitable for unittest output."""


def error_code(body):
    code = body.get("code") if isinstance(body, dict) else None
    return code if code in SAFE_ERROR_CODES else "OTHER"


def config():
    try:
        source = (ROOT / "src/assets/api.js").read_text(encoding="utf-8")
        result = {}
        for name in ("SB_URL", "SB_ANON", "MAIL_DOMAIN"):
            pattern = (
                r"\bconst\s+" + name + r"\s*=\s*"
                r"(\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*')\s*;"
            )
            match = re.search(pattern, source)
            if not match:
                raise ValueError("missing literal")
            value = ast.literal_eval(match.group(1))
            if not isinstance(value, str) or not value:
                raise ValueError("invalid literal")
            result[name] = value
        parsed = urllib.parse.urlsplit(result["SB_URL"])
        if (parsed.scheme != "https" or not parsed.hostname
                or not parsed.hostname.endswith(".supabase.co")
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError("unexpected endpoint")
        return result
    except Exception:
        raise DemoRemoteError("The public API configuration could not be read safely.") from None


class Client:
    def __init__(self, settings, token=None):
        self._settings = settings
        self._token = token

    def request(self, path, body=None):
        headers = {"apikey": self._settings["SB_ANON"], "Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = "Bearer " + self._token
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            self._settings["SB_URL"] + path, data=data, headers=headers,
            method="POST" if body is not None else "GET",
        )
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(request, timeout=25) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as response:
            status, raw = response.code, response.read()
        except Exception as error:
            kind = type(error).__name__
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", kind):
                kind = "TransportError"
            raise DemoRemoteError("The demo API request did not complete (" + kind + ").") from None
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else None
        except Exception:
            raise DemoRemoteError("The demo API returned a non-JSON response.") from None
        return status, parsed

    def rpc(self, name, body):
        if name not in {
            "teacher_demo_rooms", "teacher_demo_load", "teacher_demo_publish",
            "get_teacher_demo_display",
        }:
            raise DemoRemoteError("A non-demo RPC was blocked by the test harness.")
        return self.request("/rest/v1/rpc/" + name, body)


def require_ok(response, operation):
    status, body = response
    if not 200 <= status < 300:
        raise DemoRemoteError(
            operation + " failed (HTTP " + str(status) + ", code " + error_code(body) + ")."
        )
    return body


def login(settings, number, password):
    if not number or not password:
        raise DemoRemoteError("The required demo account credentials are unavailable.")
    email = number if "@" in number else number + "@" + settings["MAIL_DOMAIN"]
    body = require_ok(Client(settings).request(
        "/auth/v1/token?grant_type=password", {"email": email, "password": password}
    ), "Demo account sign-in")
    token = body.get("access_token") if isinstance(body, dict) else None
    if not isinstance(token, str) or not token:
        raise DemoRemoteError("Demo account sign-in did not return a session.")
    return Client(settings, token)


def fixture_states():
    # Only this Node subprocess may serialize fixture state. Its output is captured
    # as JSON and is never forwarded to the console or written to a shared file.
    script = r"""
const Core = require(process.argv[1]);
const now = Date.now();
const options = {now, actorId:'teacher_a'};
let current = Core.createState({now});
current = Core.reduce(current,{type:'START'},options);
current = Core.reduce(current,{type:'SUBMIT_SAMPLE',count:4},options);
const running = current;
const rates = Core.reduce(running,{type:'TOGGLE_STATS',value:true},options);
const ended = Core.reduce(rates,{type:'END'},options);
const waiting = Core.reduce(ended,{type:'STOP_PROJECTION'},options);
const pair = value => ({private_state:value,public_state:Core.project(value,{now})});
process.stdout.write(JSON.stringify({running:pair(running),rates:pair(rates),ended:pair(ended),waiting:pair(waiting)}));
"""
    try:
        result = subprocess.run(
            ["node", "-e", script, str(CORE)], capture_output=True, text=True,
            encoding="utf-8", timeout=20, cwd=str(ROOT),
        )
        if result.returncode != 0:
            raise ValueError("fixture process failed")
        states = json.loads(result.stdout)
        if states["running"]["private_state"]["run"]["submittedCount"] != 4:
            raise ValueError("unexpected fixture count")
        return states
    except Exception:
        raise DemoRemoteError("Synthetic demo fixtures could not be prepared.") from None


def room_access_path():
    override = os.environ.get("SCG_DEMO_ROOM_ACCESS", "").strip()
    if override:
        selected = Path(override).expanduser()
        return selected if selected.is_absolute() else ROOT / selected
    relative = Path(
        "マイドライブ/claude作業場/1.3_scratch_codex(PII含む)/"
        "学生ポータル_2台デモ/room-access.json"
    )
    candidates = []
    for drive in ("I:/", "H:/", "G:/"):
        root = Path(drive)
        candidate = root / relative
        if ((root / "マイドライブ").is_dir() and (root / "共有ドライブ").is_dir()
                and candidate.is_file()):
            candidates.append(candidate)
    if len(candidates) != 1:
        raise DemoRemoteError("The classroom access file must be selected with SCG_DEMO_ROOM_ACCESS.")
    return candidates[0]


def display_key():
    try:
        records = json.loads(room_access_path().read_text(encoding="utf-8-sig"))["rooms"]
        matches = [room for room in records if room.get("id") == ROOM]
        if len(matches) != 1:
            raise ValueError("room is not unique")
        value = matches[0]["key"]
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", value):
            raise ValueError("invalid key format")
        return value
    except Exception:
        raise DemoRemoteError("The separately stored classroom access key is unavailable.") from None


@unittest.skipUnless(LIVE, "Set SP_DEMO_LIVE=1 to run the isolated demo RPC checks.")
class TeacherDemoRemote(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._mutated = False
        cls._cleanup_verified = False
        cls.settings = config()
        cls.key = display_key()
        cls.teacher = login(cls.settings, get_teacher_no(), get_teacher_pw())
        cls.student = login(cls.settings, get_student_no(), get_student_pw())
        cls.anon = Client(cls.settings)
        cls.fixtures = fixture_states()
        rooms = require_ok(cls.teacher.rpc("teacher_demo_rooms", {}), "Demo classroom list")
        selected = [room for room in rooms if room.get("roomId") == ROOM]
        if len(selected) != 1:
            raise DemoRemoteError("The isolated demo classroom has not been provisioned.")
        if selected[0].get("occupied") and not selected[0].get("ownedByMe"):
            raise unittest.SkipTest("The demo classroom is occupied; no takeover was attempted.")
        loaded = require_ok(cls.teacher.rpc("teacher_demo_load", {"p_room_id": ROOM}), "Demo state load")
        cls.version = loaded.get("version")
        if not isinstance(cls.version, int) or cls.version < 0:
            raise DemoRemoteError("The demo state version is invalid.")
        try:
            cls._mutated = True
            cls.publish("running", malicious_public=True)
        except Exception:
            cls.cleanup()
            raise

    @classmethod
    def payload(cls, fixture, version=None, malicious_public=False):
        pair = cls.fixtures[fixture]
        public = dict(pair["public_state"])
        if malicious_public:
            public.update({
                "studentId": "PRIVATE-STUDENT-CANARY", "name": "PRIVATE-NAME-CANARY",
                "teacherId": "PRIVATE-TEACHER-CANARY", "token": "PRIVATE-TOKEN-CANARY",
                "submissions": [{"name": "PRIVATE-NAME-CANARY", "score": 99}],
                "showStats": True, "average": 99, "correctRate": 99,
                "question": {"text": "PRIVATE-EARLY-ANSWER-CANARY", "options": [
                    {"label": "PRIVATE-EARLY-CHOICE-CANARY", "count": 4, "correct": True},
                    {"label": "OTHER-CHOICE", "count": 0, "correct": False},
                ], "index": 0, "total": 1},
            })
        return {
            "p_room_id": ROOM, "p_expected_version": cls.version if version is None else version,
            "p_private_state": pair["private_state"], "p_public_state": public,
        }

    @classmethod
    def publish(cls, fixture, malicious_public=False):
        body = require_ok(cls.teacher.rpc(
            "teacher_demo_publish", cls.payload(fixture, malicious_public=malicious_public)
        ), "Demo state publish")
        value = body.get("version") if isinstance(body, dict) else None
        if not isinstance(value, int) or value <= cls.version:
            raise DemoRemoteError("Publishing did not advance the demo state version.")
        cls.version = value

    @classmethod
    def cleanup(cls):
        if not cls._mutated:
            return
        loaded = require_ok(cls.teacher.rpc("teacher_demo_load", {"p_room_id": ROOM}), "Demo cleanup load")
        if not isinstance(loaded, dict) or loaded.get("private_state") is None:
            raise DemoRemoteError("Demo cleanup could not confirm ownership; no takeover was attempted.")
        version = loaded.get("version")
        if not isinstance(version, int) or version < 1:
            raise DemoRemoteError("Demo cleanup received an invalid version.")
        cls.version = version
        cls.publish("waiting")
        dto = require_ok(cls.anon.rpc("get_teacher_demo_display", {"p_key": cls.key}), "Demo cleanup display")
        if not isinstance(dto, dict) or dto.get("mode") != "waiting":
            raise DemoRemoteError("The demo classroom did not return to waiting mode.")
        cls._mutated = False
        cls._cleanup_verified = True

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()
        # Do not sign out globally: existing app sessions must remain untouched.
        cls.teacher = cls.student = cls.anon = None
        cls.key = None

    def public_dto(self, client=None):
        return require_ok((client or self.anon).rpc(
            "get_teacher_demo_display", {"p_key": self.key}
        ), "Demo public display")

    def assert_projection_boundary(self, dto):
        self.assertTrue(isinstance(dto, dict), "Projection must return an object.")
        self.assertTrue(set(dto).issubset(DTO_FIELDS), "Unexpected top-level projection fields.")
        def visit(value):
            if isinstance(value, dict):
                self.assertFalse(bool(set(value) & PRIVATE_FIELDS), "Private fields reached the display.")
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        visit(dto)
        serialized = json.dumps(dto, ensure_ascii=False)
        self.assertFalse("PRIVATE-" in serialized, "A synthetic private canary reached the display.")
        private = self.fixtures["running"]["private_state"]
        values = [private["teacher"]["id"], private["teacher"]["name"], private["run"]["id"]]
        for record in private["run"]["submissions"]:
            values.extend(value for key, value in record.items()
                          if isinstance(value, str) and key in {"id", "studentId", "name", "student_no"})
        self.assertFalse(any(value in serialized for value in values if value), "A private fixture value reached the display.")

    def assert_denied(self, response):
        status, _ = response
        self.assertIn(status, (401, 403), "The unauthorized demo operation was not denied.")

    def test_01_running_display_is_aggregate_only_and_ignores_early_answer_payload(self):
        dto = self.public_dto()
        self.assert_projection_boundary(dto)
        self.assertTrue(dto.get("mode") == "running", "The demo was not running.")
        self.assertTrue(dto.get("submitted") == 4, "Synthetic submissions were not reflected.")
        self.assertTrue(dto.get("target") == 20, "The fixture target was not preserved.")
        self.assertTrue(dto.get("showStats") is False, "Public input bypassed the private permission flag.")
        self.assertTrue(dto.get("average") is None, "Average leaked before permission.")
        self.assertTrue(dto.get("correctRate") is None, "Rates leaked before permission.")
        self.assertTrue(dto.get("question") is None, "Answers leaked before the run ended.")

    def test_02_permitted_live_rates_still_withhold_choices_and_correct_answers(self):
        type(self).publish("rates")
        dto = self.public_dto()
        self.assert_projection_boundary(dto)
        self.assertTrue(dto.get("showStats") is True, "The permitted rates were not enabled.")
        self.assertTrue(dto.get("average") is not None, "The aggregate average was not available.")
        self.assertTrue(dto.get("question") is None, "Live rates disclosed the answer choices.")

    def test_03_review_exposes_only_bounded_question_aggregates(self):
        type(self).publish("ended")
        dto = self.public_dto(self.student)
        self.assert_projection_boundary(dto)
        self.assertTrue(dto.get("mode") == "review", "The completed run was not in review mode.")
        question = dto.get("question")
        self.assertTrue(isinstance(question, dict), "Review question aggregates were not returned.")
        choices = question.get("options", [])
        self.assertTrue(isinstance(choices, list), "The review choices must be an array.")
        self.assertTrue(all(isinstance(choice, dict) and isinstance(choice.get("count"), int)
                            for choice in choices), "The review choice aggregates have invalid types.")
        self.assertGreaterEqual(len(choices), 2, "The review choices are incomplete.")
        self.assertEqual(sum(choice.get("count", 0) for choice in choices), 4, "Choice counts do not match submissions.")
        self.assertEqual(sum(choice.get("correct") is True for choice in choices), 1, "Review must mark exactly one correct choice.")

    def test_04_student_and_anonymous_clients_cannot_load_or_publish_private_state(self):
        for role, client in (("student", self.student), ("anonymous", self.anon)):
            for name, body in (
                ("teacher_demo_rooms", {}),
                ("teacher_demo_load", {"p_room_id": ROOM}),
                ("teacher_demo_publish", type(self).payload("running")),
            ):
                with self.subTest(role=role, operation=name):
                    self.assert_denied(client.rpc(name, body))

    def test_05_raw_demo_tables_cannot_be_read_by_browser_roles(self):
        for role, client in (("teacher", self.teacher), ("student", self.student), ("anonymous", self.anon)):
            for table in ("demo_classrooms", "teacher_demo_sessions"):
                with self.subTest(role=role, table=table):
                    status, _ = client.request("/rest/v1/" + table + "?select=*")
                    self.assertIn(status, (401, 403, 404), "A raw demo table was exposed to a browser role.")

    def test_06_a_wrong_display_key_is_rejected(self):
        status, body = self.anon.rpc("get_teacher_demo_display", {"p_key": secrets.token_urlsafe(48)})
        self.assertFalse(200 <= status < 300, "A wrong classroom display key was accepted.")
        self.assertEqual(error_code(body), "28000", "The display key was not rejected by the intended boundary.")

    def test_07_a_stale_version_is_rejected_without_overwriting_state(self):
        before = self.version
        status, body = self.teacher.rpc("teacher_demo_publish", type(self).payload("running", version=before - 1))
        self.assertEqual(status, 409, "A stale update did not return an application conflict.")
        self.assertEqual(error_code(body), "PT409", "A stale update did not produce a version conflict.")
        loaded = require_ok(self.teacher.rpc("teacher_demo_load", {"p_room_id": ROOM}), "Version check load")
        self.assertTrue(isinstance(loaded, dict) and loaded.get("version") == before,
                        "A rejected update changed the version.")

    def test_08_concurrent_updates_with_the_same_version_have_one_winner(self):
        payload = type(self).payload("running")
        with ThreadPoolExecutor(max_workers=2) as executor:
            replies = list(executor.map(lambda _: self.teacher.rpc("teacher_demo_publish", payload), range(2)))
        winners = [body for status, body in replies if 200 <= status < 300]
        losers = [(status, body) for status, body in replies if not 200 <= status < 300]
        self.assertEqual(len(winners), 1, "Concurrent updates did not have exactly one winner.")
        self.assertEqual(len(losers), 1, "Concurrent updates did not reject the stale writer.")
        self.assertEqual(losers[0][0], 409, "The losing writer did not receive an application conflict.")
        self.assertEqual(error_code(losers[0][1]), "PT409", "The losing writer was not rejected as stale.")
        version = winners[0].get("version")
        self.assertTrue(isinstance(version, int), "The winning update did not return a version.")
        self.assertGreater(version, self.version, "The winning update did not advance the version.")
        type(self).version = version


if __name__ == "__main__":
    unittest.main(verbosity=2)
