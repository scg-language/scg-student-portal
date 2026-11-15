/* Two-device preview contract. Fixtures only; no network, credentials, or storage. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TwoDeviceCore = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const MINUTE = 60000;
  const DURATIONS = [10, 15, 20, 30];
  const clone = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  function clock(options) {
    const source = options && own(options, "now") ? options.now : Date.now();
    const value = typeof source === "function" ? source() : source;
    if (!Number.isFinite(value) || value < 0) fail("INVALID_TIME", "確認用の時刻を読み取れません。");
    return value;
  }
  function item(items, id, code, message) {
    const found = items.find(row => row.id === id);
    if (!found) fail(code, message);
    return found;
  }
  function event(run, type, at, actorId, details) {
    run.events.push({
      id: run.id + "-event-" + (run.events.length + 1),
      type, at, actorId, details: details || {}
    });
  }
  function requireActor(state, options) {
    const actorId = options && own(options, "actorId") ? options.actorId : state.teacher.id;
    if (actorId !== state.teacher.id || (state.run && actorId !== state.run.teacherId)) {
      fail("FORBIDDEN", "この確認用の回を操作できる先生ではありません。");
    }
    return actorId;
  }
  function requireRun(state) {
    if (!state.run) fail("NO_RUN", "先に確認用のテストをはじめてください。");
    return state.run;
  }
  function requireRunning(state, now) {
    const run = requireRun(state);
    if (run.status !== "running" || now >= run.closesAt) {
      fail("RUN_ENDED", "受付は終了しています。延長や提出はできません。");
    }
    return run;
  }
  function requireEnded(state, now) {
    const run = requireRun(state);
    if (run.status === "running" && now < run.closesAt) {
      fail("NOT_ENDED", "答え合わせはテストを終えてから表示できます。");
    }
    return run;
  }

  function summarize(state, run) {
    const test = item(state.tests, run.testId, "UNKNOWN_TEST", "確認用のテストが見つかりません。");
    const rows = run.submissions;
    const questionStats = test.questions.map((question, index) => {
      const counts = question.options.map(() => 0);
      rows.forEach(row => {
        const answer = row.answers[index];
        if (Number.isInteger(answer) && answer >= 0 && answer < counts.length) counts[answer]++;
      });
      const correctCount = counts[question.correctIndex];
      return {
        index, text: question.text, options: question.options.slice(),
        correctIndex: question.correctIndex, counts, correctCount,
        correctRate: rows.length ? Math.round(correctCount / rows.length * 1000) / 10 : null
      };
    });
    const correct = questionStats.reduce((sum, row) => sum + row.correctCount, 0);
    run.submittedCount = rows.length;
    run.average = rows.length ? Math.round(correct / (rows.length * test.questions.length) * 1000) / 10 : null;
    run.questionStats = questionStats;
  }
  function remember(state) {
    const run = state.run;
    if (!run || run.status !== "ended") return;
    const index = state.history.findIndex(row => row.id === run.id);
    if (index < 0) state.history.push(clone(run));
    else state.history[index] = clone(run);
  }
  function finish(state, at, actorId, reason) {
    const run = state.run;
    if (!run || run.status === "ended") return;
    run.status = "ended";
    run.endedAt = at;
    run.endedBy = actorId;
    run.endedReason = reason;
    event(run, "ended", at, actorId, { reason });
    remember(state);
  }
  function settleDeadline(state, now) {
    if (state.run && state.run.status === "running" && now >= state.run.closesAt) {
      finish(state, state.run.closesAt, null, "deadline");
    }
  }
  function release(state, run) {
    if (!run || !run.roomId) return;
    const room = state.rooms.find(row => row.id === run.roomId);
    if (room && room.occupiedByRunId === run.id) room.occupiedByRunId = null;
  }

  function createState(options) {
    const now = clock(options);
    return {
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      nextRunNumber: 1,
      teacher: { id: "teacher_a", name: "先生A" },
      classes: [{ id: "demo-class", label: "検証クラス", target: 20 }],
      rooms: [
        { id: "room-a", label: "確認用教室A", online: true, occupiedByRunId: null },
        { id: "room-b", label: "確認用教室B", online: false, occupiedByRunId: null }
      ],
      durations: DURATIONS.slice(),
      tests: [{
        id: "demo-basic", title: "操作確認テスト",
        questions: [
          { id: "demo-q1", text: "「あした」の意味はどれですか？", options: ["今日の次の日", "今日の前の日", "今日と同じ日"], correctIndex: 0 },
          { id: "demo-q2", text: "「午前」は、いつですか？", options: ["正午から夜", "0時から正午", "夜だけ"], correctIndex: 1 },
          { id: "demo-q3", text: "「少し待ってください」は、何をお願いしますか？", options: ["早く帰る", "今すぐ話す", "短い時間待つ"], correctIndex: 2 }
        ]
      }],
      students: Array.from({ length: 20 }, (_, i) => ({
        id: "demo-student-" + String(i + 1).padStart(2, "0"),
        name: "確認用の学生" + String(i + 1).padStart(2, "0")
      })),
      selection: { testId: "demo-basic", classId: "demo-class", roomId: "room-a", durationMinutes: 10 },
      run: null,
      history: []
    };
  }

  function reduce(input, action, options) {
    if (!input || input.schemaVersion !== 1) fail("INVALID_STATE", "確認用の状態を読み取れません。");
    if (!action || typeof action.type !== "string") fail("INVALID_ACTION", "操作を選んでください。");
    const now = clock(options);
    const state = clone(input);
    const actorId = action.type === "TICK" ? null : requireActor(state, options);
    settleDeadline(state, now);
    switch (action.type) {
      case "RESET":
        return createState({ now });
      case "TICK":
        break;
      case "SELECT": {
        if (state.run && state.run.status === "running") fail("RUN_ACTIVE", "テスト中は設定を変えられません。");
        const selection = state.selection;
        if (own(action, "testId")) {
          item(state.tests, action.testId, "UNKNOWN_TEST", "テストを選んでください。");
          selection.testId = action.testId;
        }
        if (own(action, "classId")) {
          item(state.classes, action.classId, "UNKNOWN_CLASS", "クラスを選んでください。");
          selection.classId = action.classId;
        }
        if (own(action, "roomId")) {
          if (action.roomId !== null && action.roomId !== "") item(state.rooms, action.roomId, "UNKNOWN_ROOM", "映す教室を選んでください。");
          selection.roomId = action.roomId || null;
        }
        if (own(action, "durationMinutes")) {
          if (!DURATIONS.includes(action.durationMinutes)) fail("INVALID_DURATION", "10・15・20・30分から選んでください。");
          selection.durationMinutes = action.durationMinutes;
        }
        break;
      }
      case "START": {
        if (state.run && state.run.status === "running") fail("RUN_ACTIVE", "確認用のテストはすでにはじまっています。");
        const selection = state.selection;
        const test = item(state.tests, selection.testId, "UNKNOWN_TEST", "テストを選んでください。");
        const cls = item(state.classes, selection.classId, "UNKNOWN_CLASS", "クラスを選んでください。");
        const room = selection.roomId ? item(state.rooms, selection.roomId, "UNKNOWN_ROOM", "映す教室を選んでください。") : null;
        if (room && room.occupiedByRunId && (!state.run || room.occupiedByRunId !== state.run.id)) {
          fail("ROOM_BUSY", "その教室は別の回で使っています。別の教室を選んでください。");
        }
        if (!DURATIONS.includes(selection.durationMinutes)) fail("INVALID_DURATION", "時間を選び直してください。");
        remember(state);
        release(state, state.run);
        const run = {
          id: "demo-run-" + state.nextRunNumber++,
          testId: test.id, testTitle: test.title,
          classId: cls.id, classLabel: cls.label, target: cls.target,
          roomId: room ? room.id : null,
          teacherId: actorId, teacherName: state.teacher.name,
          startedAt: now,
          originalClosesAt: now + selection.durationMinutes * MINUTE,
          closesAt: now + selection.durationMinutes * MINUTE,
          durationMinutes: selection.durationMinutes,
          endedAt: null, endedBy: null, endedReason: null,
          status: "running", showStats: false, questionIndex: 0,
          projectionActive: Boolean(room),
          submissions: [], submittedCount: 0, average: null, questionStats: [], events: []
        };
        state.run = run;
        if (room) room.occupiedByRunId = run.id;
        summarize(state, run);
        event(run, "started", now, actorId, { roomId: run.roomId, target: run.target, durationMinutes: run.durationMinutes });
        break;
      }
      case "SUBMIT_SAMPLE": {
        const run = requireRunning(state, now);
        const count = own(action, "count") ? action.count : 1;
        if (!Number.isInteger(count) || count < 1 || count > run.target) fail("INVALID_COUNT", "確認用の提出人数を指定してください。");
        const test = item(state.tests, run.testId, "UNKNOWN_TEST", "テストが見つかりません。");
        const start = run.submissions.length;
        const until = Math.min(start + count, run.target, state.students.length);
        for (let i = start; i < until; i++) {
          const student = state.students[i];
          const answers = [i % 4 === 3 ? 1 : 0, i % 2 === 0 ? 1 : 0, i % 5 === 0 ? 2 : i % 2];
          const score = test.questions.reduce((sum, question, index) => sum + (answers[index] === question.correctIndex ? 1 : 0), 0);
          run.submissions.push({
            studentId: student.id, name: student.name, submittedAt: now,
            answers, score, percentage: Math.round(score / test.questions.length * 1000) / 10
          });
        }
        summarize(state, run);
        if (until > start) event(run, "sample_submitted", now, actorId, { count: until - start });
        break;
      }
      case "EXTEND": {
        const run = requireRunning(state, now);
        const previousClosesAt = run.closesAt;
        run.closesAt += 5 * MINUTE;
        event(run, "extended", now, actorId, { minutes: 5, previousClosesAt, closesAt: run.closesAt });
        break;
      }
      case "END":
        requireRun(state);
        finish(state, now, actorId, "manual");
        break;
      case "TOGGLE_STATS": {
        const run = requireRunning(state, now);
        if (own(action, "value") && typeof action.value !== "boolean") fail("INVALID_VISIBILITY", "表示するかを選んでください。");
        const showStats = own(action, "value") ? action.value : !run.showStats;
        if (showStats !== run.showStats) {
          run.showStats = showStats;
          event(run, showStats ? "stats_shown" : "stats_hidden", now, actorId, {});
        }
        break;
      }
      case "NEXT_QUESTION":
      case "PREV_QUESTION":
      case "HARDEST_QUESTION": {
        const run = requireEnded(state, now);
        const previousIndex = run.questionIndex;
        if (action.type === "HARDEST_QUESTION") {
          if (!run.submissions.length) fail("NO_SUBMISSIONS", "提出があると、難しかった問題を選べます。");
          run.questionIndex = run.questionStats.reduce((best, row, index, rows) => row.correctRate < rows[best].correctRate ? index : best, 0);
        } else {
          const step = action.type === "NEXT_QUESTION" ? 1 : -1;
          run.questionIndex = Math.max(0, Math.min(run.questionStats.length - 1, previousIndex + step));
        }
        if (run.questionIndex !== previousIndex) event(run, "question_changed", now, actorId, { index: run.questionIndex });
        break;
      }
      case "STOP_PROJECTION": {
        const run = requireRun(state);
        if (run.projectionActive) {
          run.projectionActive = false;
          release(state, run);
          event(run, "projection_stopped", now, actorId, {});
        }
        break;
      }
      case "SET_ROOM_ONLINE": {
        const room = item(state.rooms, action.roomId, "UNKNOWN_ROOM", "教室が見つかりません。");
        if (typeof action.online !== "boolean") fail("INVALID_ROOM_STATUS", "接続状態を選んでください。");
        room.online = action.online;
        break;
      }
      default:
        fail("UNKNOWN_ACTION", "その操作にはまだ対応していません。");
    }
    state.updatedAt = now;
    remember(state);
    return state;
  }

  /* This object is the complete room-facing contract. Never spread state/run here. */
  function project(state, options) {
    const now = clock(options);
    const result = {
      schemaVersion: 1,
      mode: "waiting",
      roomLabel: "投影なし（スマホだけ）",
      statusLabel: "待ち受け",
      testTitle: "", classLabel: "",
      target: 0, submitted: 0, remainingSeconds: 0,
      showStats: false, average: null, correctRate: null, question: null
    };
    // Old or incomplete preview state must not open a path to the private data.
    if (!state || state.schemaVersion !== 1 || !Array.isArray(state.rooms) || !state.selection) return result;
    const run = state.run;
    const roomId = run && run.projectionActive ? run.roomId : state.selection.roomId;
    const room = state.rooms.find(row => row.id === roomId);
    if (room) result.roomLabel = room.label;
    if (!run || !run.projectionActive || !room || room.occupiedByRunId !== run.id) return result;
    if (!["running", "ended"].includes(run.status) || !Number.isFinite(run.closesAt) || !Array.isArray(run.submissions)) return result;
    const ended = run.status === "ended" || now >= run.closesAt;
    result.mode = ended ? "review" : "running";
    result.statusLabel = ended ? "答え合わせ" : "テスト受付中";
    result.testTitle = run.testTitle;
    result.classLabel = run.classLabel;
    result.target = run.target;
    result.submitted = run.submissions.length;
    result.remainingSeconds = ended ? 0 : Math.max(0, Math.ceil((run.closesAt - now) / 1000));
    result.showStats = ended || run.showStats;
    if (result.showStats) {
      result.average = typeof run.average === "number" && Number.isFinite(run.average) ? run.average : null;
      result.correctRate = result.average;
    }
    if (ended) {
      const row = run.questionStats[run.questionIndex];
      if (row) result.question = {
        index: run.questionIndex,
        total: run.questionStats.length,
        text: row.text,
        options: row.options.map((label, index) => ({ label, count: row.counts[index], correct: index === row.correctIndex }))
      };
    }
    return result;
  }

  return Object.freeze({ createState, reduce, project });
});
