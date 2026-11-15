'use strict';

// Pure, offline checks. This file never loads API credentials or contacts a DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/assets/teacher-two-device-core.js');

const START_AT = Date.UTC(2026, 10, 16, 0, 0, 0);
const MINUTE = 60_000;
const OWNER = 'teacher_a';
const options = (now = START_AT, actorId = OWNER) => ({ now, actorId });
const fresh = () => Core.createState({ now: START_AT });
const act = (state, type, payload = {}, now = START_AT, actorId = OWNER) =>
  Core.reduce(state, { type, ...payload }, options(now, actorId));
const start = () => act(fresh(), 'START');
const withSubmissions = (count = 4) => act(start(), 'SUBMIT_SAMPLE', { count }, START_AT + MINUTE);
const review = () => act(withSubmissions(), 'END', {}, START_AT + 2 * MINUTE);
const projection = (state, now = START_AT) => Core.project(state, { now });

function rejectedWithoutMutation(state, type, payload = {}, now = START_AT, actorId = OWNER) {
  const before = JSON.stringify(state);
  assert.throws(() => act(state, type, payload, now, actorId), error =>
    error instanceof Error && typeof error.code === 'string' && error.code.length > 0);
  assert.equal(JSON.stringify(state), before, 'a rejected command must leave the state intact');
}

function assertAggregateOnly(dto, privateValues = []) {
  // The public payload is an explicit allowlist, not the private run minus a few fields.
  const permitted = new Set([
    'schemaVersion', 'mode', 'roomLabel', 'statusLabel', 'testTitle', 'classLabel',
    'target', 'submitted', 'remainingSeconds', 'showStats', 'average', 'correctRate', 'question',
  ]);
  for (const key of Object.keys(dto)) {
    assert.ok(permitted.has(key), `unexpected projection field: ${key}`);
  }
  const forbiddenKeys = new Set([
    'studentId', 'student_id', 'studentNo', 'student_no', 'displayName', 'display_name',
    'teacherId', 'teacher_id', 'actorId', 'actor_id', 'profile', 'profiles',
    'submissions', 'attempts', 'records', 'runId', 'run_id', 'score', 'password', 'token',
  ]);
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbiddenKeys.has(key), `private field leaked into projection: ${key}`);
      walk(child);
    }
  };
  walk(dto);
  const serialized = JSON.stringify(dto);
  for (const secret of privateValues.filter(x => typeof x === 'string' && x.length > 0)) {
    assert.ok(!serialized.includes(secret), `private value leaked into projection: ${secret}`);
  }
}

test('a classroom starts in waiting mode without quiz answers or personal data', () => {
  const state = fresh();
  assert.equal(state.run, null);
  const dto = projection(state);
  assert.equal(dto.mode, 'waiting');
  assert.equal(dto.question, null);
  assert.equal(dto.average, null);
  assert.equal(dto.correctRate, null);
  assertAggregateOnly(dto, [state.teacher.id, state.teacher.name]);
});

test('starting a run preserves the initial state and records owner and original deadline', () => {
  const state = fresh();
  const before = JSON.stringify(state);
  const running = act(state, 'START');
  assert.equal(JSON.stringify(state), before, 'reduce must not modify its input');
  assert.equal(running.run.teacherId, OWNER);
  assert.equal(running.run.startedAt, START_AT);
  assert.equal(running.run.originalClosesAt, START_AT + 10 * MINUTE);
  assert.equal(running.run.closesAt, running.run.originalClosesAt);
  assert.equal(running.run.status, 'running');
  assert.ok(running.run.events.some(event => event.type === 'started'));
  assert.equal(projection(running).mode, 'running');
});

test('sample submissions change aggregate progress but remain private records', () => {
  const state = withSubmissions(3);
  assert.equal(state.run.submittedCount, 3);
  assert.equal(state.run.submissions.length, 3);
  const dto = projection(state, START_AT + MINUTE);
  assert.equal(dto.submitted, 3);
  assert.ok(dto.target >= dto.submitted);
  assertAggregateOnly(dto, [state.run.id, state.run.teacherId]);
});

test('projection excludes arbitrary private canaries in every phase, including review', () => {
  for (const phase of ['running', 'stats', 'review']) {
    let state = withSubmissions(3);
    if (phase === 'stats') state = act(state, 'TOGGLE_STATS', { value: true }, START_AT + MINUTE);
    if (phase === 'review') state = act(state, 'END', {}, START_AT + 2 * MINUTE);
    // These fields represent private data an internal reader may have; a projector must never copy them.
    state.teacher = { ...state.teacher, name: 'PRIVATE-TEACHER-CANARY' };
    state.run.submissions = state.run.submissions.map((row, i) => ({
      ...row, studentId: `PRIVATE-STUDENT-ID-${i}`, name: `PRIVATE-STUDENT-NAME-${i}`,
      email: `PRIVATE-MAIL-${i}@invalid.example`, score: 987_654 + i,
    }));
    const canaries = [state.teacher.id, state.teacher.name, state.run.id, state.run.teacherId];
    for (const row of state.run.submissions) canaries.push(row.studentId, row.name, row.email);
    const dto = projection(state, START_AT + 2 * MINUTE);
    assert.equal(dto.mode, phase === 'review' ? 'review' : 'running', 'privacy must also hold on an active projection');
    assertAggregateOnly(dto, canaries);
    assert.ok(!JSON.stringify(dto).includes('98765'), 'individual score canaries must be excluded');
  }
});

test('running projection withholds statistics, choices and correct answers until allowed', () => {
  const state = withSubmissions();
  const dto = projection(state, START_AT + MINUTE);
  assert.equal(dto.showStats, false);
  assert.equal(dto.average, null);
  assert.equal(dto.correctRate, null);
  assert.equal(dto.question, null);
  for (const question of state.tests[0].questions) {
    assert.ok(!JSON.stringify(dto).includes(question.text));
    for (const option of question.options) assert.ok(!JSON.stringify(dto).includes(option));
  }
});

test('allowing live rates still withholds individual answers, choices and the correct option', () => {
  const state = act(withSubmissions(), 'TOGGLE_STATS', { value: true }, START_AT + MINUTE);
  const dto = projection(state, START_AT + MINUTE);
  assert.equal(dto.showStats, true);
  assert.notEqual(dto.average, null);
  assert.notEqual(dto.correctRate, null);
  assert.equal(dto.question, null, 'live rates are not permission to reveal answer choices');
  assertAggregateOnly(dto, [state.run.id, state.run.teacherId]);
  const hiddenAgain = projection(act(state, 'TOGGLE_STATS', { value: false }, START_AT + MINUTE));
  assert.equal(hiddenAgain.average, null);
  assert.equal(hiddenAgain.correctRate, null);
});

test('adding five minutes preserves the original deadline and previous events', () => {
  const running = start();
  const oldEvents = JSON.parse(JSON.stringify(running.run.events));
  const extended = act(running, 'EXTEND', {}, START_AT + MINUTE);
  assert.equal(extended.run.closesAt, running.run.closesAt + 5 * MINUTE);
  assert.equal(extended.run.originalClosesAt, running.run.originalClosesAt);
  assert.deepEqual(extended.run.events.slice(0, oldEvents.length), oldEvents);
  assert.ok(extended.run.events.some(event => event.type === 'extended' && event.actorId === OWNER));
  assert.equal(running.run.events.length, oldEvents.length, 'old state history must remain untouched');
});

test('a different actor cannot control another teacher\'s running test', () => {
  const state = start();
  for (const command of ['EXTEND', 'END', 'TOGGLE_STATS', 'STOP_PROJECTION']) {
    rejectedWithoutMutation(state, command, {}, START_AT + MINUTE, 'another-teacher');
  }
});

test('starting is rejected when the selected room is occupied by another run', () => {
  const state = fresh();
  state.rooms.find(room => room.id === 'room-a').occupiedByRunId = 'another-run';
  rejectedWithoutMutation(state, 'START');
});

test('an unknown classroom cannot be used to start a run', () => {
  const state = fresh();
  state.selection.roomId = 'room-that-does-not-exist';
  rejectedWithoutMutation(state, 'START');
});

test('a stale classroom assignment or removed room fails closed without showing old statistics', () => {
  for (const missing of [false, true]) {
    const state = withSubmissions();
    if (missing) state.rooms = state.rooms.filter(room => room.id !== 'room-a');
    else state.rooms.find(room => room.id === 'room-a').occupiedByRunId = 'a-newer-run';
    const dto = projection(state, START_AT + MINUTE);
    assert.equal(dto.mode, 'waiting');
    assert.equal(dto.submitted, 0);
    assert.equal(dto.target, 0);
    assert.equal(dto.question, null);
    assert.equal(dto.average, null);
    assert.equal(dto.correctRate, null);
    assertAggregateOnly(dto, [state.run.id, state.run.teacherId]);
  }
});

test('the same preview cannot start a second run while its first run is active', () => {
  rejectedWithoutMutation(start(), 'START', {}, START_AT + MINUTE);
});

test('ending a run fixes its actual end and disallows new submissions and extensions', () => {
  const state = review();
  assert.equal(state.run.status, 'ended');
  assert.equal(state.run.endedAt, START_AT + 2 * MINUTE);
  assert.ok(state.run.events.some(event => event.type === 'ended'));
  rejectedWithoutMutation(state, 'EXTEND', {}, START_AT + 3 * MINUTE);
  rejectedWithoutMutation(state, 'SUBMIT_SAMPLE', { count: 1 }, START_AT + 3 * MINUTE);
});

test('a deadline is enforced without relying on a timer having fired first', () => {
  const state = withSubmissions();
  const atDeadline = state.run.closesAt;
  assert.equal(projection(state, atDeadline).mode, 'review');
  rejectedWithoutMutation(state, 'EXTEND', {}, atDeadline);
  rejectedWithoutMutation(state, 'SUBMIT_SAMPLE', { count: 1 }, atDeadline);
  const settled = act(state, 'TICK', {}, atDeadline + 10_000);
  assert.equal(settled.run.status, 'ended');
  assert.equal(settled.run.endedAt, atDeadline, 'a late timer must preserve the real deadline');
  assert.equal(settled.run.endedReason, 'deadline');
  const again = act(settled, 'TICK', {}, atDeadline + 20_000);
  assert.equal(again.run.endedAt, atDeadline);
  assert.equal(again.run.events.filter(event => event.type === 'ended').length, 1, 'timer refreshes must not duplicate the end event');
});

test('post-test review can move between questions and select a lowest-rate question', () => {
  const ended = review();
  const initial = projection(ended, START_AT + 2 * MINUTE).question;
  assert.ok(initial, 'question-level answers become available only after the run ends');
  const next = act(ended, 'NEXT_QUESTION', {}, START_AT + 2 * MINUTE);
  assert.notDeepEqual(projection(next, START_AT + 2 * MINUTE).question, initial);
  const previous = act(next, 'PREV_QUESTION', {}, START_AT + 2 * MINUTE);
  assert.deepEqual(projection(previous, START_AT + 2 * MINUTE).question, initial);
  const hardest = act(next, 'HARDEST_QUESTION', {}, START_AT + 2 * MINUTE);
  const selectedRate = hardest.run.questionStats[hardest.run.questionIndex].correctRate;
  const rates = hardest.run.questionStats.map(question => question.correctRate);
  assert.equal(selectedRate, Math.min(...rates));
  assertAggregateOnly(projection(hardest, START_AT + 2 * MINUTE), [hardest.run.id, hardest.run.teacherId]);
});

test('stopping projection returns the classroom to waiting while preserving the run history', () => {
  const ended = review();
  const stopped = act(ended, 'STOP_PROJECTION', {}, START_AT + 3 * MINUTE);
  const dto = projection(stopped, START_AT + 3 * MINUTE);
  assert.equal(dto.mode, 'waiting');
  assert.equal(dto.question, null);
  assert.equal(dto.average, null);
  assert.equal(dto.correctRate, null);
  assert.equal(stopped.run.submittedCount, ended.run.submittedCount);
  assert.ok(stopped.run.events.some(event => event.type === 'projection_stopped'));
  assert.equal(stopped.rooms.find(room => room.id === 'room-a').occupiedByRunId, null);
});

test('the private teacher view can keep running with no classroom projection', () => {
  const selected = act(fresh(), 'SELECT', { roomId: null });
  const running = act(selected, 'START');
  const answered = act(running, 'SUBMIT_SAMPLE', { count: 2 }, START_AT + MINUTE);
  assert.equal(answered.run.submittedCount, 2);
  assert.equal(projection(answered, START_AT + MINUTE).mode, 'waiting');
});

test('starting the next run keeps the original deadline and extended event in archived history', () => {
  const extended = act(start(), 'EXTEND', {}, START_AT + MINUTE);
  const ended = act(extended, 'END', {}, START_AT + 2 * MINUTE);
  const stopped = act(ended, 'STOP_PROJECTION', {}, START_AT + 3 * MINUTE);
  const next = act(stopped, 'START', {}, START_AT + 4 * MINUTE);
  assert.notEqual(next.run.id, ended.run.id);
  const archived = next.history.find(run => run.id === ended.run.id);
  assert.ok(archived, 'a completed run remains available for the private history');
  assert.equal(archived.originalClosesAt, START_AT + 10 * MINUTE);
  assert.ok(archived.events.some(event => event.type === 'extended'));
  assert.ok(archived.events.some(event => event.type === 'ended'));
  assert.ok(archived.events.some(event => event.type === 'projection_stopped'));
  assert.equal(projection(next, START_AT + 4 * MINUTE).mode, 'running');
  assertAggregateOnly(projection(next), [archived.id, archived.teacherId]);
});

test('an explicit full reset clears simulated submissions and history, like reloading the preview', () => {
  const ended = review();
  assert.ok(ended.history.length > 0);
  const reset = act(ended, 'RESET', {}, START_AT + 4 * MINUTE);
  assert.equal(reset.run, null);
  assert.deepEqual(reset.history, []);
  assert.equal(projection(reset, START_AT + 4 * MINUTE).mode, 'waiting');
});

test('missing, old or unsupported preview state cannot expose a stale run to the classroom', () => {
  const oldSchema = { ...withSubmissions(), schemaVersion: 0 };
  const unknownRun = withSubmissions();
  unknownRun.run.status = 'unsupported-status';
  for (const state of [null, {}, oldSchema, unknownRun]) {
    const dto = projection(state, START_AT + MINUTE);
    assert.equal(dto.mode, 'waiting');
    assert.equal(dto.submitted, 0);
    assert.equal(dto.question, null);
    assert.equal(dto.average, null);
    assert.equal(dto.correctRate, null);
    assertAggregateOnly(dto, [OWNER]);
  }
});
