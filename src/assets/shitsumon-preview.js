/* 質問箱の見本（shitsumon-preview.html）。
 * ダミーのデータだけで動く。通信しない・端末に保存しない（再読み込みで元に戻る）。
 * 文字は必ず textContent で入れる（HTML として流し込む書き方はしない。検査が見張る）。 */
"use strict";
(function () {
  const DAY = 24 * 60 * 60 * 1000;
  const STALE_DAYS = 3;
  const NOW0 = Date.now();

  // ---------- 職員（役割名だけ。実在しそうな氏名は書かない） ----------
  const STAFF = [
    { id: "jimu", name: "事務の職員A", desk: "事務", student: "じむの ひと" },
    { id: "tanninA", name: "担任A", desk: "担任", student: "たんにんの せんせい" },
    { id: "tanninB", name: "担任B", desk: "担任", student: "たんにんの せんせい" },
    { id: "madoguchi", name: "相談窓口の職員", desk: "相談窓口（担任以外）", student: "そうだんの まどぐちの ひと" },
    { id: "admin", name: "情報管理者", desk: "情報管理者", student: "がっこうの ひと", admin: true }
  ];
  const ST = id => STAFF.find(s => s.id === id);

  // ---------- 相談の種類と行き先（行き先はシステムが決める） ----------
  // route: jimu＝事務／tannin＝その学生の担任／madoguchi＝担任以外の相談窓口
  const KINDS = [
    { key: "address", label: "じゅうしょ・ひっこし", staff: "住所・引っ越し", route: "jimu" },
    { key: "arbeit", label: "アルバイト", staff: "アルバイト", route: "jimu" },
    { key: "money", label: "がくひ・おかね", staff: "学費・お金", route: "jimu" },
    { key: "career", label: "しんがく・しゅうしょく", staff: "進学・就職", route: "tannin" },
    { key: "study", label: "べんきょう・じゅぎょう", staff: "勉強・授業", route: "tannin" },
    { key: "health", label: "からだ・こころ", staff: "体・心", route: "tannin" },
    { key: "nottannin", label: "たんにん いがいの ひとに はなしたい", staff: "担任以外に相談したい", route: "madoguchi" },
    { key: "unknown", label: "どれか わからない（とりあえず おくる）", staff: "とりあえず送る・種類不明", route: "tannin" }
  ];
  const K = key => KINDS.find(k => k.key === key);
  const DEST_TEXT = {
    jimu: "じむの ひとに とどきます。",
    tannin: "たんにんの せんせいに とどきます。",
    madoguchi: "そうだんの まどぐちの ひとに とどきます。たんにんの せんせいには みえません。"
  };

  // ---------- ダミーの学生（7桁・2604999 から下へ） ----------
  const names = ["テスト太郎", "テスト花子", "テスト次郎", "テスト三郎", "テスト桜", "テスト一郎", "テスト美咲", "テスト健太"];
  const db = { students: [], consults: [], log: [], notices: [], seq: 0 };
  names.forEach((name, i) => db.students.push({ id: String(2604999 - i), name, cls: i < 4 ? "1A" : "1B", tannin: i < 4 ? "tanninA" : "tanninB" }));
  const S = id => db.students.find(s => s.id === id);

  function routeTo(student, kindKey) {
    const r = K(kindKey).route;
    return r === "tannin" ? student.tannin : r;
  }

  // ---------- 外への知らせ（文面は種類だけ。名前・番号・メモは入れない） ----------
  function noticeText(c) { return "相談が1件届きました（種類：" + K(c.kind).staff + "）。ポータルで確認してください"; }
  function addNotice(c, at) { db.notices.push({ to: c.assignee, at, text: noticeText(c) }); }

  // ---------- 操作の記録（だれが・どの役割で・いつ・何を・どれに。中身は入れない） ----------
  function addLog(actor, action, c) { db.log.push({ at: new Date(), who: ST(actor).name, action, target: "相談 #" + c.no }); }

  function createConsult(sid, kind, memo, at) {
    const st = S(sid), assignee = routeTo(st, kind);
    const c = { no: ++db.seq, sid, kind, memo: memo || "", at, assignee, status: "new", handler: null, staffNote: "",
      history: [{ at, text: "受付（行き先：" + ST(assignee).name + "）" }] };
    db.consults.push(c); addNotice(c, at);
    return c;
  }

  // ---------- ダミーの相談 ----------
  (function seed() {
    const ago = d => new Date(NOW0 - d * DAY);
    // 4日前のまま未対応（放置の印が付く）
    createConsult("2604998", "arbeit", "", ago(4));
    createConsult("2604996", "career", "せんもんがっこうの ことを ききたい", ago(1));
    const c3 = createConsult("2604995", "health", "おなかが いたい 日が おおい", ago(2));
    c3.status = "doing"; c3.handler = "tanninB"; c3.history.push({ at: ago(1), text: "担任B が対応を始めた" });
    const c4 = createConsult("2604993", "money", "", ago(6));
    c4.status = "doing"; c4.handler = "jimu"; c4.history.push({ at: ago(5), text: "事務の職員A が対応を始めた" });
    c4.status = "done"; c4.staffNote = "窓口で説明済み"; c4.history.push({ at: ago(5), text: "事務の職員A が終了にした" });
    createConsult("2604994", "nottannin", "I want to talk about my class.", ago(1));
    const c6 = createConsult("2604999", "study", "", ago(3));
    c6.status = "done"; c6.handler = "tanninA";
    c6.history.push({ at: ago(3), text: "担任A が対応を始めた" }, { at: ago(2), text: "担任A が終了にした" });
  })();

  // ---------- 見える範囲（自分が担当の相談だけ。情報管理者は全部） ----------
  function visibleTo(staffId) {
    const me = ST(staffId);
    return db.consults.filter(c => me.admin || c.assignee === staffId);
  }
  const isStale = c => c.status === "new" && (Date.now() - c.at.getTime()) >= STALE_DAYS * DAY;

  // ---------- 小さな道具 ----------
  const $ = id => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") e.textContent = v; else if (k === "on") Object.entries(v).forEach(([ev, fn]) => e.addEventListener(ev, fn));
      else if (k === "dataset") Object.assign(e.dataset, v); else e.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach(c => { if (c == null) return; e.append(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function say(node, text, err) { node.textContent = text; node.hidden = !text; node.classList.toggle("err", !!err); }
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const stampSt = d => (d.getMonth() + 1) + "がつ " + d.getDate() + "にち";
  const daysAgo = d => Math.floor((Date.now() - d.getTime()) / DAY);
  const agoText = d => daysAgo(d) === 0 ? "今日" : daysAgo(d) + "日前";
  const STATUS_STAFF = { new: "未対応", doing: "対応中", done: "終了" };
  function studentStatus(c) {
    if (c.status === "new") return "うけとりました";
    if (c.status === "doing") return "たんとう：" + ST(c.handler).student;
    return "おわりました";
  }

  // ---------- 切り替え ----------
  function showView(which) {
    $("view-student").hidden = which !== "student"; $("view-staff").hidden = which !== "staff";
    $("tab-student").setAttribute("aria-pressed", String(which === "student")); $("tab-staff").setAttribute("aria-pressed", String(which === "staff"));
    if (which === "student") renderStudent(); else renderStaff();
  }
  $("tab-student").addEventListener("click", () => showView("student"));
  $("tab-staff").addEventListener("click", () => showView("staff"));

  // ================= 学生の画面 =================
  let me = db.students[0].id, chosenKind = null;
  db.students.forEach(s => $("st-who").append(el("option", { value: s.id, text: s.id + " " + s.name + "（" + s.cls + "）" })));
  $("st-who").addEventListener("change", () => { me = $("st-who").value; chosenKind = null; $("st-memo").value = ""; say($("st-msg"), ""); renderStudent(); });
  KINDS.forEach(k => $("st-kinds").append(el("button", { type: "button", class: "qb-kind", "aria-pressed": "false", dataset: { kind: k.key }, text: k.label,
    on: { click: () => { chosenKind = k.key; say($("st-msg"), ""); renderStudent(); } } })));

  function renderStudent() {
    const st = S(me);
    $("st-who").value = me;
    $("st-me").replaceChildren(
      el("span", { class: "qb-me-name", text: st.name }),
      el("span", { text: "がくせき ばんごう：" + st.id }),
      el("span", { text: "クラス：" + st.cls }));
    document.querySelectorAll("#st-kinds .qb-kind").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === chosenKind)));
    const dest = $("st-dest");
    if (chosenKind) { dest.hidden = false; dest.textContent = DEST_TEXT[K(chosenKind).route]; dest.dataset.route = K(chosenKind).route; }
    else { dest.hidden = true; dest.textContent = ""; delete dest.dataset.route; }
    $("st-send").disabled = !chosenKind;
    const list = $("st-list"); list.replaceChildren();
    const mine = db.consults.filter(c => c.sid === st.id).sort((a, b) => b.at - a.at);
    if (!mine.length) list.append(el("li", { class: "qb-muted", text: "まだ ありません。" }));
    mine.forEach(c => list.append(el("li", { dataset: { no: String(c.no), status: c.status } },
      el("span", { class: "qb-st-kind", text: K(c.kind).label }),
      el("span", { class: "qb-muted qb-small", text: stampSt(c.at) }),
      el("span", { class: "qb-badge st-status", dataset: { status: c.status }, text: studentStatus(c) }))));
  }
  $("st-send").addEventListener("click", () => {
    if (!chosenKind) { say($("st-msg"), "そうだんの しゅるいを えらんで ください。", true); return; }
    const c = createConsult(me, chosenKind, $("st-memo").value.trim(), new Date());
    say($("st-msg"), "おくりました。" + DEST_TEXT[K(c.kind).route]);
    chosenKind = null; $("st-memo").value = "";
    renderStudent();
  });

  // ================= 職員の画面 =================
  let viewer = "jimu", filter = "new", selected = null;
  STAFF.forEach(s => $("sf-who").append(el("option", { value: s.id, text: s.name + (s.admin ? "（全部見える）" : "") })));
  $("sf-who").addEventListener("change", () => { viewer = $("sf-who").value; selected = null; say($("dt-msg"), ""); if ($("sf-flash")) say($("sf-flash"), ""); renderStaff(); });
  document.querySelectorAll(".qb-filter button").forEach(b => b.addEventListener("click", () => { filter = b.dataset.filter; renderStaff(); }));

  function consultRow(c, onOpen) {
    const st = S(c.sid);
    const li = el("li", { dataset: { no: String(c.no), status: c.status, assignee: c.assignee } });
    const btn = el("button", { type: "button", class: "qb-row", dataset: { no: String(c.no) }, on: { click: onOpen } },
      el("span", { class: "qb-row-kind", text: K(c.kind).staff }),
      el("span", { text: st.name + "（" + st.cls + "）" }),
      el("span", { class: "qb-muted", text: "受付 " + stamp(c.at) + "（" + agoText(c.at) + "）" }),
      ST(viewer).admin ? el("span", { class: "qb-muted", text: "担当：" + ST(c.assignee).name }) : null,
      isStale(c) ? el("span", { class: "qb-stale", text: STALE_DAYS + "日以上 未対応" }) : null);
    li.append(btn);
    return li;
  }
  function openConsult(c) {
    selected = c.no; addLog(viewer, "相談を開いた", c);
    say($("dt-msg"), ""); renderStaff();
    $("sf-detail").scrollIntoView({ block: "nearest" });
  }

  function renderStaff() {
    const v = ST(viewer);
    $("sf-who").value = viewer;
    const mine = visibleTo(viewer);
    const cnt = { new: 0, doing: 0, done: 0 };
    mine.forEach(c => cnt[c.status]++);
    $("sf-open").textContent = "未対応 " + cnt.new + "件";
    ["new", "doing", "done"].forEach(s => { $("cnt-" + s).textContent = cnt[s] + "件"; });
    document.querySelectorAll(".qb-filter button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
    const list = $("sf-list"); list.replaceChildren();
    const shown = mine.filter(c => c.status === filter).sort((a, b) => a.at - b.at);
    shown.forEach(c => list.append(consultRow(c, () => openConsult(c))));
    $("sf-empty").hidden = shown.length > 0;

    // 情報管理者だけ：放置されている相談・操作の記録
    $("ad-stale").hidden = !v.admin; $("ad-log").hidden = !v.admin;
    if (v.admin) {
      const stale = db.consults.filter(isStale).sort((a, b) => a.at - b.at);
      const sl = $("ad-stale-list"); sl.replaceChildren(...stale.map(c => consultRow(c, () => openConsult(c))));
      $("ad-stale-empty").hidden = stale.length > 0;
      const ll = $("ad-log-list"); ll.replaceChildren();
      db.log.slice().reverse().forEach(l => ll.append(el("li", { text: stamp(l.at) + "　" + l.who + "　" + l.action + "　" + l.target })));
      if (!db.log.length) ll.append(el("li", { text: "まだありません。" }));
    } else {
      $("ad-stale-list").replaceChildren(); $("ad-log-list").replaceChildren();
    }

    // 外への知らせ（自分あての分。情報管理者は全部）
    const nl = $("nt-list"); nl.replaceChildren();
    const ns = db.notices.filter(n => v.admin || n.to === viewer).sort((a, b) => b.at - a.at);
    ns.forEach(n => nl.append(el("li", null,
      el("span", { class: "qb-muted qb-small", text: stamp(n.at) + "　宛先：" + ST(n.to).name }),
      el("span", { class: "qb-nt-text", text: n.text }))));
    $("nt-empty").hidden = ns.length > 0;

    renderDetail();
  }

  function renderDetail() {
    const box = $("sf-detail");
    const c = selected && visibleTo(viewer).find(x => x.no === selected);
    if (!c) { box.hidden = true; return; }
    box.hidden = false;
    const st = S(c.sid), v = ST(viewer), mineToHandle = c.assignee === viewer;
    $("dt-title").textContent = "相談 #" + c.no + "（" + K(c.kind).staff + "）";
    const info = $("dt-info"); info.replaceChildren();
    const row = (k, val, id) => info.append(el("dt", { text: k }), el("dd", { id, text: val }));
    row("学生", st.name + "（" + st.id + "・" + st.cls + "）");
    row("種類", K(c.kind).staff);
    row("メモ", c.memo || "（メモなし）", "dt-memo");
    row("受付", stamp(c.at) + "（" + agoText(c.at) + "）" + (isStale(c) ? "　" + STALE_DAYS + "日以上 未対応" : ""));
    row("状態", STATUS_STAFF[c.status] + (c.handler && c.status !== "new" ? "（" + ST(c.handler).name + "）" : ""), "dt-status");
    row("担当", ST(c.assignee).name, "dt-assignee");
    if (c.staffNote) row("職員用メモ", c.staffNote + "（学生には見えません）", "dt-note-view");

    const act = $("dt-actions"); act.replaceChildren();
    if (mineToHandle && c.status === "new") {
      act.append(el("div", { class: "qb-actions" }, el("button", { type: "button", id: "dt-start", class: "qb-primary", text: "対応を始める", on: { click: () => {
        c.status = "doing"; c.handler = viewer; c.history.push({ at: new Date(), text: v.name + " が対応を始めた" }); addLog(viewer, "対応を始めた", c);
        say($("dt-msg"), "対応中にしました。学生の画面に担当が出ます。"); renderStaff();
      } } })));
    }
    if (mineToHandle && c.status === "doing") {
      const note = el("input", { id: "dt-note", type: "text", maxlength: "100", placeholder: "例：面談で話した" });
      act.append(el("div", { class: "qb-box" },
        el("label", { class: "qb-field", for: "dt-note", text: "ひとことメモ（職員用・学生には見えません。任意）" }), note,
        el("button", { type: "button", id: "dt-finish", class: "qb-primary", text: "終了にする", on: { click: () => {
          c.status = "done"; c.staffNote = note.value.trim(); c.history.push({ at: new Date(), text: v.name + " が終了にした" }); addLog(viewer, "終了にした", c);
          say($("dt-msg"), "終了にしました。"); renderStaff();
        } } })));
    }
    if ((mineToHandle || v.admin) && c.status !== "done") {
      const sel = el("select", { id: "dt-to" });
      sel.append(el("option", { value: "", text: "回す先を選ぶ" }));
      const dests = [{ id: "jimu", text: "事務（事務の職員A）" }, { id: st.tannin, text: "担任（" + ST(st.tannin).name + "）" }, { id: "madoguchi", text: "担任以外の相談窓口" }]
        .filter(d => d.id !== c.assignee)
        // 学生が「担任以外」を選んだ相談は、担任へは回せない
        .filter(d => !(c.kind === "nottannin" && d.id === st.tannin));
      dests.forEach(d => sel.append(el("option", { value: d.id, text: d.text })));
      const reason = el("input", { id: "dt-reason", type: "text", maxlength: "100", placeholder: "例：学費の相談だったため" });
      act.append(el("div", { class: "qb-box" },
        el("p", { class: "qb-boxhead", text: "別の担当へ回す" }),
        c.kind === "nottannin" ? el("p", { class: "qb-muted qb-small", text: "学生が「担任以外に相談したい」を選んだので、担任へは回せません。" }) : null,
        el("label", { class: "qb-field", for: "dt-to", text: "回す先" }), sel,
        el("label", { class: "qb-field", for: "dt-reason", text: "理由（1行）" }), reason,
        el("button", { type: "button", id: "dt-forward", text: "回す", on: { click: () => {
          const to = sel.value, r = reason.value.trim();
          if (!to) { say($("dt-msg"), "回す先を選んでください。", true); return; }
          if (!r) { say($("dt-msg"), "回す理由を書いてください。", true); return; }
          const from = c.assignee;
          c.assignee = to; c.status = "new"; c.handler = null;
          c.history.push({ at: new Date(), text: v.name + " が回した：" + ST(from).name + " → " + ST(to).name + "（理由：" + r + "）" });
          addLog(viewer, "回した（" + ST(from).name + " → " + ST(to).name + "）", c);
          if (!v.admin) selected = null;
          say($("dt-msg"), ""); renderStaff();
          flash(ST(to).name + " へ回しました。");
        } } })));
    }
    const hist = $("dt-history"); hist.replaceChildren(...c.history.map(h => el("li", { text: stamp(h.at) + "　" + h.text })));
  }
  function flash(text) {
    // 詳細が閉じても見えるよう、一覧の上に出す
    let n = $("sf-flash");
    if (!n) { n = el("p", { id: "sf-flash", class: "qb-msg", role: "status" }); $("sf-open").after(n); }
    say(n, text);
  }
  $("dt-close").addEventListener("click", () => { selected = null; say($("dt-msg"), ""); renderDetail(); });

  renderStudent();
  // 検査用の窓口（読むだけ）
  window.shitsumonPreview = { db, visibleTo, isStale, noticeText, KINDS, STAFF };
})();
