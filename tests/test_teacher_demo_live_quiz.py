"""Opt-in checks for the existing dummy students' real quiz submissions.

Only the dedicated three-question fixture set and its explicit dummy targets are
used. No credentials, response bodies, classroom keys or keyed URLs are printed.
Answers remain recorded; cleanup ends this test's run and resets its display.
"""
import os
import re
import unittest

from env_creds import get_teacher_no, get_teacher_pw, get_student_no, get_student_pw
from test_teacher_demo_remote import Client, config, display_key, login, require_ok, DTO_FIELDS


LIVE = os.environ.get('SP_DEMO_LIVE_QUIZ') == '1'


@unittest.skipUnless(LIVE, 'Set SP_DEMO_LIVE_QUIZ=1 to test the dummy students real quiz flow.')
class TeacherDemoLiveQuiz(unittest.TestCase):
    room = 'room-a'
    snapshot = None
    run_id = None

    @classmethod
    def rpc(cls, client, name, body):
        allowed = {'teacher_demo_live_load', 'teacher_demo_live_action',
                   'get_teacher_demo_display', 'submit_attempt', 'teacher_demo_publish'}
        if name not in allowed:
            raise RuntimeError('Fixture test blocked an unrelated endpoint')
        return client.request('/rest/v1/rpc/' + name, body)

    @classmethod
    def load(cls):
        cls.snapshot = require_ok(cls.rpc(cls.teacher, 'teacher_demo_live_load', {'p_room_id': cls.room}), 'Live fixture load')
        return cls.snapshot['private_state']

    @classmethod
    def action(cls, kind, **values):
        cls.snapshot = require_ok(cls.rpc(cls.teacher, 'teacher_demo_live_action', {
            'p_room_id': cls.room, 'p_expected_version': cls.snapshot['version'],
            'p_action': {'type': kind, **values},
        }), 'Live fixture command')
        return cls.snapshot['private_state']

    @classmethod
    def display(cls):
        return require_ok(cls.rpc(cls.anon, 'get_teacher_demo_display', {'p_key': cls.key}), 'Classroom projection')

    @classmethod
    def setUpClass(cls):
        if not re.fullmatch(r's(?:00[1-9]|0[12][0-9]|03[0-9]|040)', get_student_no() or ''):
            raise unittest.SkipTest('A pre-existing fixture student account is required')
        cls.settings = config()
        cls.teacher = login(cls.settings, get_teacher_no(), get_teacher_pw())
        cls.student = login(cls.settings, get_student_no(), get_student_pw())
        cls.anon = Client(cls.settings)
        cls.key = display_key()
        state = cls.load()
        if state.get('run') and state['run']['status'] == 'running':
            raise unittest.SkipTest('An existing fixture run is active; no takeover attempted')
        cls.action('RESET')
        state = cls.action('START')
        cls.run_id = state['run']['id']

    @classmethod
    def tearDownClass(cls):
        if cls.run_id:
            state = cls.load()
            if (state.get('run') or {}).get('id') == cls.run_id:
                if state['run']['status'] == 'running':
                    cls.action('END')
                cls.action('RESET')
            if cls.display()['mode'] != 'waiting':
                raise RuntimeError('Fixture classroom cleanup was not verified')

    def test_01_real_run_has_only_explicit_dummy_targets(self):
        state = self.load()
        self.assertEqual(state['source'], 'existing-dummy-quiz')
        self.assertEqual(len(state['students']), 40)
        self.assertEqual(state['run']['target'], 40)
        runs = require_ok(self.teacher.request('/rest/v1/quiz_runs?select=class_names,student_ids&' + 'id=eq.' + self.run_id), 'Fixture target inspection')
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]['class_names'], [])
        self.assertEqual(set(runs[0]['student_ids']), {row['id'] for row in state['students']})
        dto = self.display()
        self.assertEqual(set(dto), DTO_FIELDS)
        self.assertEqual(dto['mode'], 'running')
        self.assertIsNone(dto['question'])
        self.assertIsNone(dto['average'])

    def test_02_student_and_anonymous_cannot_control(self):
        for client in (self.student, self.anon):
            status, _ = self.rpc(client, 'teacher_demo_live_action', {
                'p_room_id': self.room, 'p_expected_version': self.snapshot['version'], 'p_action': {'type': 'END'}})
            self.assertGreaterEqual(status, 400)

    def test_03_stale_version_is_immediately_rejected(self):
        status, body = self.rpc(self.teacher, 'teacher_demo_live_action', {
            'p_room_id': self.room, 'p_expected_version': self.snapshot['version'] - 1, 'p_action': {'type': 'END'}})
        self.assertEqual(status, 409)
        self.assertEqual(body.get('code'), 'PT409')

    def test_04_synthetic_submissions_are_rejected(self):
        status, _ = self.rpc(self.teacher, 'teacher_demo_live_action', {
            'p_room_id': self.room, 'p_expected_version': self.snapshot['version'], 'p_action': {'type': 'SUBMIT_SAMPLE', 'count': 5}})
        self.assertGreaterEqual(status, 400)
        self.assertEqual(self.load()['run']['submittedCount'], 0)
        status, _ = self.rpc(self.teacher, 'teacher_demo_publish', {
            'p_room_id': self.room, 'p_expected_version': self.snapshot['version'],
            'p_private_state': self.snapshot['private_state'], 'p_public_state': self.display(),
        })
        self.assertGreaterEqual(status, 400)

    def test_05_existing_submit_endpoint_reaches_both_views(self):
        state = self.load()
        questions = state['tests'][0]['questions']
        require_ok(self.rpc(self.student, 'submit_attempt', {
            'p_quiz_set_id': state['tests'][0]['id'], 'p_run_id': self.run_id,
            'p_answers': {q['id']: q['correctIndex'] + 1 for q in questions}, 'p_duration_ms': 3000,
        }), 'Existing student submission')
        self.assertEqual(self.load()['run']['submittedCount'], 1)
        self.assertEqual(self.display()['submitted'], 1)
        self.assertIsNone(self.display()['question'])

    def test_06_resubmission_counts_one_student_and_latest_answers(self):
        state = self.load()
        require_ok(self.rpc(self.student, 'submit_attempt', {
            'p_quiz_set_id': state['tests'][0]['id'], 'p_run_id': self.run_id,
            'p_answers': {q['id']: 1 for q in state['tests'][0]['questions']}, 'p_duration_ms': 4000,
        }), 'Existing student repeat submission')
        state = self.load()
        self.assertEqual(state['run']['submittedCount'], 1)
        self.assertEqual(state['run']['submissions'][0]['answers'], [0, 0, 0])
        self.assertAlmostEqual(state['run']['average'], 33.3, places=1)
        self.assertEqual(self.display()['submitted'], 1)

    def test_07_extend_end_and_review_use_the_real_run(self):
        state = self.load()
        before = state['run']['closesAt']
        state = self.action('EXTEND')
        self.assertEqual(state['run']['closesAt'] - before, 300000)
        state = self.action('END')
        self.assertEqual(state['run']['status'], 'ended')
        dto = self.display()
        self.assertEqual(dto['mode'], 'review')
        self.assertEqual(set(dto), DTO_FIELDS)
        self.assertIsNotNone(dto['question'])
        self.assertEqual(sum(row['count'] for row in dto['question']['options']), 1)
        before_index = dto['question']['index']
        self.action('NEXT_QUESTION')
        self.assertEqual(self.display()['question']['index'], before_index + 1)

    def test_08_prepare_next_run_preserves_recorded_answers(self):
        self.action('RESET')
        self.assertIsNone(self.load()['run'])
        self.assertEqual(self.display()['mode'], 'waiting')
        attempts = require_ok(self.teacher.request('/rest/v1/attempts?select=id&run_id=eq.' + self.run_id), 'Retained fixture answers')
        self.assertEqual(len(attempts), 2)


if __name__ == '__main__':
    unittest.main()
