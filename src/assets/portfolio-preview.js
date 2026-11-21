/* 成績ポートフォリオ — ダミーだけで動く見本（portfolio-preview.html 専用）
 *
 * ★ この見本は「本人の分だけを渡す」形をためすためのもの。
 *   1) PortfolioDummy  … 全員分のダミーを持つ部分（本番ではサーバー側にあたる）。外へは出さない
 *   2) portfolioFor()  … 「この学生に渡すもの」を作る関数。本人の分だけを、コピーして返す
 *   3) 画面（render*） … portfolioFor() の返り値だけを使う。ほかの学生のデータには届かない
 *
 * 通信なし・保存なし（localStorage 等も使わない）。再読み込みで元に戻る。
 * 文字は textContent / createTextNode だけで入れる（innerHTML を使わない）。
 * 名前・番号はすべて架空（番号は 2604999 から下へ降りる帯）。 */
"use strict";

/* ───────── 1) 全員分のダミー（この中だけで閉じる） ───────── */
const PortfolioDummy = (() => {
  // テストの種類。合格の線は「種類ごとに1本」（約束事 5章）。毎日のテストには合否が無い
  const QUIZ_TYPES = [
    { key: "daily",  label: "まいにち の テスト", passLine: null },
    { key: "kanji",  label: "かんじ",             passLine: 0.8 },
    { key: "matome", label: "まとめ",             passLine: 0.8 },
  ];

  // 点は「正解した問数 / 問題数」。配点では持たない（1問1点）
  const q = (type, date, title, score, total, retest) =>
    ({ type, date, title, score, total, retest: Boolean(retest) });

  const N4_SECTIONS = [
    { key: "gengo",  label: "げんご ちしき（もじ・ごい・ぶんぽう）・どっかい", max: 120 },
    { key: "choukai", label: "ちょうかい", max: 60 },
  ];
  const N3_SECTIONS = [
    { key: "gengo",   label: "げんご ちしき（もじ・ごい・ぶんぽう）", max: 60 },
    { key: "dokkai",  label: "どっかい", max: 60 },
    { key: "choukai", label: "ちょうかい", max: 60 },
  ];

  const STUDENTS = {
    // A：在籍・記録が多い・JLPT あり
    "2604999": {
      no: "2604999", name: "テスト太郎", status: "enrolled", className: "みほん A クラス",
      enrolled: "2025-04",
      quizzes: {
        updated: "2026-11-21",
        records: [
          q("daily", "2026-10-27", "だい 14 か", 7, 10), q("daily", "2026-10-31", "だい 15 か", 9, 10),
          q("daily", "2026-11-05", "だい 16 か", 8, 10), q("daily", "2026-11-10", "だい 17 か", 10, 12),
          q("daily", "2026-11-14", "だい 18 か", 6, 10), q("daily", "2026-11-19", "だい 19 か", 9, 10),
          q("daily", "2026-11-21", "だい 20 か", 8, 10),
          q("kanji", "2026-10-29", "かんじ L13-14", 9, 10), q("kanji", "2026-11-12", "かんじ L15-16", 7, 10),
          q("kanji", "2026-11-13", "かんじ L15-16", 9, 10, true), q("kanji", "2026-11-20", "かんじ L17-18", 8, 10),
          q("matome", "2026-11-07", "まとめ 11〜15 か", 17, 20),
        ],
      },
      attendance: {
        updated: "2026-11-14", current: 96.4,
        months: [["2026-06", 97.1], ["2026-07", 95.0], ["2026-08", 100], ["2026-09", 94.2], ["2026-10", 96.8], ["2026-11", 95.5]],
      },
      exams: {
        updated: "2026-10-02",
        terms: [
          { term: "2026ねん ぜんき", scores: [["もじ・ごい", 82], ["ぶんぽう", 74], ["どっかい", 69], ["ちょうかい", 88], ["かいわ", 91]] },
          { term: "2025ねん こうき", scores: [["もじ・ごい", 77], ["ぶんぽう", 70], ["どっかい", 63], ["ちょうかい", 81], ["かいわ", 86]] },
        ],
      },
      jlpt: {
        updated: "2026-08-25",
        results: [
          { session: "2026ねん 7がつ", level: "N3", passed: false, sections: N3_SECTIONS, scores: { gengo: 31, dokkai: 26, choukai: 31 } },
          { session: "2025ねん 12がつ", level: "N4", passed: true, sections: N4_SECTIONS, scores: { gengo: 78, choukai: 34 } },
        ],
      },
    },
    // B：在籍・JLPT はまだ受けていない
    "2604998": {
      no: "2604998", name: "テスト花子", status: "enrolled", className: "みほん B クラス",
      enrolled: "2026-04",
      quizzes: {
        updated: "2026-11-21",
        records: [
          q("daily", "2026-11-04", "だい 6 か", 5, 10), q("daily", "2026-11-11", "だい 7 か", 7, 10),
          q("daily", "2026-11-18", "だい 8 か", 6, 10), q("daily", "2026-11-21", "だい 9 か", 8, 10),
          q("kanji", "2026-11-06", "かんじ L5-6", 6, 10), q("kanji", "2026-11-09", "かんじ L5-6", 8, 10, true),
          q("kanji", "2026-11-19", "かんじ L7-8", 7, 10),
          q("matome", "2026-11-13", "まとめ 1〜5 か", 13, 20),
        ],
      },
      attendance: {
        updated: "2026-11-14", current: 88.7,
        months: [["2026-04", 92.5], ["2026-05", 90.0], ["2026-06", 86.3], ["2026-07", 89.1], ["2026-08", 84.6], ["2026-09", 90.9], ["2026-10", 87.5], ["2026-11", 91.7]],
      },
      exams: {
        updated: "2026-10-02",
        terms: [
          { term: "2026ねん ぜんき", scores: [["もじ・ごい", 64], ["ぶんぽう", 58], ["どっかい", 61], ["ちょうかい", 72], ["かいわ", 79]] },
        ],
      },
      jlpt: { updated: "2026-08-25", results: [] },
    },
    // C：在籍・入学したばかり（ほとんど空）
    "2604997": {
      no: "2604997", name: "テスト次郎", status: "enrolled", className: "みほん C クラス",
      enrolled: "2026-10",
      quizzes: {
        updated: "2026-11-21",
        records: [
          q("daily", "2026-11-17", "だい 1 か", 6, 8), q("daily", "2026-11-20", "だい 2 か", 7, 8),
        ],
      },
      attendance: { updated: "2026-11-14", current: 97.8, months: [["2026-10", 97.8]] },
      exams: { updated: "2026-10-02", terms: [] },
      jlpt: { updated: "2026-08-25", results: [] },
    },
    // D：卒業生（読むだけ）
    "2604996": {
      no: "2604996", name: "テスト三郎", status: "graduated", className: "みほん D クラス",
      enrolled: "2024-04", graduated: "2026-03",
      quizzes: {
        updated: "2026-03-06",
        records: [
          q("daily", "2026-02-09", "だい 44 か", 9, 10), q("daily", "2026-02-16", "だい 45 か", 8, 10),
          q("daily", "2026-02-23", "だい 46 か", 10, 10), q("daily", "2026-03-02", "だい 47 か", 9, 10),
          q("kanji", "2026-02-12", "かんじ L43-44", 10, 10), q("kanji", "2026-02-26", "かんじ L45-46", 7, 10),
          q("kanji", "2026-02-27", "かんじ L45-46", 7, 10, true),
          q("matome", "2026-02-20", "まとめ 41〜45 か", 19, 20),
        ],
      },
      attendance: {
        updated: "2026-03-13", current: 93.2,
        months: [["2025-10", 92.0], ["2025-11", 95.5], ["2025-12", 90.4], ["2026-01", 93.8], ["2026-02", 94.7], ["2026-03", 92.9]],
      },
      exams: {
        updated: "2026-02-27",
        terms: [
          { term: "2025ねん こうき", scores: [["もじ・ごい", 86], ["ぶんぽう", 83], ["どっかい", 79], ["ちょうかい", 92], ["かいわ", 94]] },
          { term: "2025ねん ぜんき", scores: [["もじ・ごい", 81], ["ぶんぽう", 80], ["どっかい", 72], ["ちょうかい", 87], ["かいわ", 90]] },
        ],
      },
      jlpt: {
        updated: "2026-01-26",
        results: [
          { session: "2025ねん 12がつ", level: "N2", passed: false, sections: N3_SECTIONS, scores: { gengo: 25, dokkai: 30, choukai: 27 } },
          { session: "2025ねん 7がつ", level: "N3", passed: true, sections: N3_SECTIONS, scores: { gengo: 45, dokkai: 40, choukai: 46 } },
        ],
      },
    },
  };

  // 切り替えボタン用。名前・番号は画面に出さない（ボタンの属性にも置かない）
  const SAMPLES = [
    { key: "A", id: "2604999", label: "見本 A", note: "ざいせき・きろく が おおい" },
    { key: "B", id: "2604998", label: "見本 B", note: "ざいせき・JLPT まだ" },
    { key: "C", id: "2604997", label: "見本 C", note: "ざいせき・入学 した ばかり" },
    { key: "D", id: "2604996", label: "見本 D", note: "そつぎょうせい" },
  ];

  const clone = v => JSON.parse(JSON.stringify(v));
  return {
    listSamples: () => clone(SAMPLES),
    /* ★「この学生に渡すもの」。本人の分だけをコピーして返す。
     *   本番ではサーバーがログイン中の本人で絞って返す部分にあたる（画面側で絞らない）。 */
    portfolioFor(studentNo) {
      const s = STUDENTS[studentNo];
      if (!s) return null;
      return {
        profile: { no: s.no, name: s.name, className: s.className, status: s.status,
                   enrolled: s.enrolled, graduated: s.graduated || null },
        canAct: s.status === "enrolled",         // 卒業生は読むだけ
        quizTypes: clone(QUIZ_TYPES),
        quizzes: clone(s.quizzes),
        attendance: clone(s.attendance),
        exams: clone(s.exams),
        jlpt: clone(s.jlpt),
      };
    },
  };
})();

/* ───────── 2) 画面（portfolioFor の返り値だけを使う） ───────── */
const PortfolioView = (() => {
  const SVG = "http://www.w3.org/2000/svg";
  const ATTENDANCE_LINES = [90, 80];   // 見本の仮の線（担当者と詰める）

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false)
      n.append(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }
  function sv(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "text") n.textContent = v; else n.setAttribute(k, String(v));
    }
    for (const c of kids.flat()) if (c) n.append(c);
    return n;
  }

  const ymd = s => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
  const dateJa = s => { const { y, m, d } = ymd(s); return `${y}ねん ${m}がつ ${d}にち`; };
  const monthJa = s => { const { y, m } = ymd(s + "-01"); return `${y}ねん ${m}がつ`; };
  const shortDate = s => { const { m, d } = ymd(s); return `${m}/${d}`; };
  const shortMonth = s => `${Number(s.split("-")[1])}がつ`;
  const pct1 = v => (Math.round(v * 10) / 10).toFixed(1);

  const asOf = date => el("p", { class: "pf-asof", "data-asof": date, text: `${dateJa(date)} の じてん の すうじ です` });
  const empty = text => el("p", { class: "pf-empty", "data-empty": "1", text: text || "まだ ありません" });

  function section(key, title, updated, ...body) {
    return el("section", { class: "pf-sec", id: "pf-" + key, "data-section": key },
      el("h2", { text: title }), asOf(updated), ...body);
  }

  /* 1種類ぶんの折れ線。種類をまたいで線を結ばない＝この関数は1種類しか受け取らない。
   * 1回目の記録だけを線で結び、再テストは線に入れずに白抜きの点で置く。 */
  function quizChart(type, recs) {
    const W = 320, H = 150, L = 34, R = 10, T = 10, B = 24;
    const dates = [...new Set(recs.map(r => r.date))].sort();
    const x = d => dates.length === 1 ? (L + W - R) / 2 : L + (W - L - R) * dates.indexOf(d) / (dates.length - 1);
    const y = p => T + (H - T - B) * (1 - p);
    const g = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "pf-chart", role: "img",
      "aria-label": `${type.label} の すいい` });
    for (const p of [0, 0.5, 1]) {
      g.append(sv("line", { x1: L, x2: W - R, y1: y(p), y2: y(p), class: "pf-grid" }));
      g.append(sv("text", { x: L - 4, y: y(p) + 4, class: "pf-axis", "text-anchor": "end", text: `${p * 100}%` }));
    }
    if (type.passLine) {
      g.append(sv("line", { x1: L, x2: W - R, y1: y(type.passLine), y2: y(type.passLine), class: "pf-passline", "data-passline": type.passLine }));
      g.append(sv("text", { x: W - R, y: y(type.passLine) - 4, class: "pf-axis pf-passlabel", "text-anchor": "end",
        text: `ごうかく の せん ${type.passLine * 100}%` }));
    }
    const firsts = recs.filter(r => !r.retest);
    if (firsts.length > 1)
      g.append(sv("polyline", { class: "pf-line", points: firsts.map(r => `${x(r.date)},${y(r.score / r.total)}`).join(" ") }));
    for (const r of recs) {
      g.append(sv("circle", { cx: x(r.date), cy: y(r.score / r.total), r: r.retest ? 4.5 : 4,
        class: r.retest ? "pf-dot pf-dot-retest" : "pf-dot" },
        sv("title", { text: `${shortDate(r.date)} ${titleOf(r)} ${r.total}もん中 ${r.score}もん` })));
    }
    if (dates.length) {
      g.append(sv("text", { x: x(dates[0]), y: H - 6, class: "pf-axis", "text-anchor": dates.length === 1 ? "middle" : "start", text: shortDate(dates[0]) }));
      if (dates.length > 1)
        g.append(sv("text", { x: x(dates[dates.length - 1]), y: H - 6, class: "pf-axis", "text-anchor": "end", text: shortDate(dates[dates.length - 1]) }));
    }
    return g;
  }

  const titleOf = r => r.retest ? `${r.title}（再）` : r.title;

  function quizRow(type, r) {
    const passed = type.passLine ? r.score / r.total >= type.passLine : null;
    return el("li", { class: "pf-rec" + (r.retest ? " is-retest" : ""), "data-retest": r.retest ? "1" : null,
                      "data-title": titleOf(r) },
      el("span", { class: "pf-rec-date", text: shortDate(r.date) }),
      el("span", { class: "pf-rec-title", text: titleOf(r) }),
      el("span", { class: "pf-rec-score", text: `${r.total}もん中 ${r.score}もん` }),
      passed === null ? null
        : el("span", { class: "pf-badge " + (passed ? "is-pass" : "is-notyet"), "data-pass": passed ? "1" : "0",
                       text: passed ? "ごうかく" : "80% に とどかなかった" }));
  }

  function renderQuizzes(pf) {
    const blocks = pf.quizTypes.map(type => {
      const recs = pf.quizzes.records.filter(r => r.type === type.key)
        .sort((a, b) => a.date.localeCompare(b.date) || Number(a.retest) - Number(b.retest));
      const box = el("div", { class: "pf-quiztype", "data-quiztype": type.key }, el("h3", { text: type.label }));
      if (!recs.length) { box.append(empty()); return box; }
      box.append(quizChart(type, recs));
      if (recs.some(r => r.retest))
        box.append(el("p", { class: "pf-legend", text: "しろい まる は さいテスト（線 で つないで いません）" }));
      box.append(el("ul", { class: "pf-recs" }, recs.slice().reverse().map(r => quizRow(type, r))));
      return box;
    });
    return section("quiz", "しょうテスト", pf.quizzes.updated,
      el("p", { class: "pf-note", text: "テスト の しゅるい ごとに 見ます。むずかしさ が ちがう ので、ちがう しゅるい は 1本 の 線 に しません。" }),
      ...blocks);
  }

  function renderAttendance(pf) {
    const a = pf.attendance;
    if (!a.months.length) return section("attendance", "しゅっせきりつ", a.updated, empty());
    const W = 320, H = 150, L = 34, R = 10, T = 10, B = 24, MIN = 50;
    const y = v => T + (H - T - B) * (1 - (v - MIN) / (100 - MIN));
    const bw = (W - L - R) / a.months.length;
    const g = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "pf-chart", role: "img", "aria-label": "つき ごと の しゅっせきりつ" });
    for (const v of [50, 100]) {
      g.append(sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "pf-grid" }));
      g.append(sv("text", { x: L - 4, y: y(v) + 4, class: "pf-axis", "text-anchor": "end", text: `${v}%` }));
    }
    a.months.forEach(([m, v], i) => {
      const cx = L + bw * i + bw / 2, w = Math.min(26, bw * 0.6);
      g.append(sv("rect", { x: cx - w / 2, y: y(v), width: w, height: y(MIN) - y(v), class: "pf-bar", rx: 3 },
        sv("title", { text: `${monthJa(m)} ${pct1(v)}%` })));
      g.append(sv("text", { x: cx, y: H - 6, class: "pf-axis", "text-anchor": "middle", text: shortMonth(m) }));
    });
    for (const v of ATTENDANCE_LINES) {
      g.append(sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "pf-guide", "data-guide": v }));
      g.append(sv("text", { x: L + 2, y: y(v) - 3, class: "pf-axis pf-guidelabel", text: `めやす ${v}%` }));
    }
    return section("attendance", "しゅっせきりつ", a.updated,
      el("div", { class: "pf-big" },
        el("span", { class: "pf-big-label", text: "いま の しゅっせきりつ" }),
        el("span", { class: "pf-big-num", "data-current": pct1(a.current), text: `${pct1(a.current)}%` })),
      g,
      el("p", { class: "pf-note", text: `ビザ の こうしん や しんがく の とき に 見られる めやす の 線（${ATTENDANCE_LINES.join("% と ")}%）を 引いて います。見本 なので、線 の 高さ は かり です。` }));
  }

  function renderExams(pf) {
    const e = pf.exams;
    if (!e.terms.length) return section("exam", "ていき しけん", e.updated, empty());
    return section("exam", "ていき しけん", e.updated, e.terms.map(t =>
      el("div", { class: "pf-term", "data-term": t.term },
        el("h3", { text: t.term }),
        el("table", { class: "pf-table" },
          el("tbody", {}, t.scores.map(([subj, v]) =>
            el("tr", {}, el("th", { text: subj }), el("td", { text: `${v} / 100` }))))))));
  }

  function renderJlpt(pf) {
    const j = pf.jlpt;
    if (!j.results.length) return section("jlpt", "JLPT", j.updated, empty("まだ ありません（まだ うけて いません）"));
    return section("jlpt", "JLPT", j.updated, j.results.map(r => {
      const total = r.sections.reduce((s, x) => s + r.scores[x.key], 0);
      const max = r.sections.reduce((s, x) => s + x.max, 0);
      return el("div", { class: "pf-jlpt", "data-jlpt": r.session },
        el("h3", {}, `${r.session} ・ ${r.level} `,
          el("span", { class: "pf-badge " + (r.passed ? "is-pass" : "is-notyet"), text: r.passed ? "ごうかく" : "ふごうかく" })),
        el("table", { class: "pf-table" },
          el("tbody", {},
            r.sections.map(s => el("tr", {}, el("th", { text: s.label }), el("td", { text: `${r.scores[s.key]} / ${s.max}` }))),
            el("tr", { class: "pf-total" }, el("th", { text: "ごうけい" }), el("td", { "data-total": total, text: `${total} / ${max}` })))));
    }));
  }

  function renderHead(pf) {
    const p = pf.profile;
    const head = el("div", { class: "pf-head" },
      p.status === "graduated"
        ? el("p", { class: "pf-grad", "data-graduated": "1", text: `そつぎょうせい（${monthJa(p.graduated)} そつぎょう）・ 見る だけ です` })
        : null,
      el("p", { class: "pf-hi", text: `${p.name} さん の きろく` }),
      el("p", { class: "pf-meta" }, el("span", { text: p.no }), el("span", { text: p.className }),
        el("span", { text: `${monthJa(p.enrolled)} 入学` })));
    if (pf.canAct) {
      // 在籍の学生だけ。見本なので押しても先へは進まない
      const msg = el("p", { class: "pf-actmsg", hidden: true, text: "見本 なので、ここ から は うごきません。" });
      const btn = (label, key) => {
        const b = el("button", { type: "button", class: "pf-act", "data-action": key, text: label });
        b.onclick = () => { msg.hidden = false; };
        return b;
      };
      head.append(el("div", { class: "pf-acts" }, btn("テスト を うける", "quiz"), btn("アンケート に こたえる", "survey")), msg);
    }
    return head;
  }

  function render(root, pf) {
    root.replaceChildren(
      renderHead(pf), renderQuizzes(pf), renderAttendance(pf), renderExams(pf), renderJlpt(pf));
  }
  return { render };
})();

/* ───────── 3) 見本の切り替え ───────── */
(() => {
  const samples = PortfolioDummy.listSamples();
  const bar = document.getElementById("pf-samples");
  const root = document.getElementById("pf-root");
  let current = null;
  function select(id) {
    current = id;
    const pf = PortfolioDummy.portfolioFor(id);   // ← 画面が受け取るのはこれだけ
    PortfolioView.render(root, pf);
    const key = (samples.find(s => s.id === id) || {}).key;
    for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.sample === key));
  }
  for (const s of samples) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.sample = s.key;   // 画面には番号を置かない（A〜D だけ）
    const t = document.createElement("strong"); t.textContent = s.label;
    const n = document.createElement("small"); n.textContent = s.note;
    b.append(t, n);
    b.onclick = () => select(s.id);
    bar.append(b);
  }
  select(samples[0].id);
  // 検査用の入口（本番には持ち込まない）
  window.portfolioPreview = { samples: () => samples.map(s => s.id), select, current: () => current,
                              portfolioFor: PortfolioDummy.portfolioFor };
})();
