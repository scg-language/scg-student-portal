/* アルバイト情報の見本（arbeit-preview.html）。
 * ダミーのデータだけで動く。通信しない・端末に保存しない（再読み込みで元に戻る）。
 * 文字は必ず textContent で入れる（HTML として流し込む書き方はしない。検査が見張る）。 */
"use strict";
(function () {
  const MONTHS = ["2026-09", "2026-10", "2026-11"];
  const CLASSES = ["1A", "1B", "2A"];

  // 状態は7つ＋対象外。「未入力」を「アルバイトなし」や 0 と同じにしない。
  const STAFF_LABEL = {
    missing: "未提出", submitted: "提出済み（未確認）", confirmed: "確認済み", returned: "差し戻し中",
    exempt: "提出免除", none: "アルバイトなし", unknown: "未入力", na: "対象外"
  };
  const STUDENT_LABEL = {
    missing: "まだ", submitted: "だした", confirmed: "かくにん ずみ",
    returned: "もういちど だして ください", exempt: "ださなくて いい"
  };
  const KIND_STAFF = { contract: "雇用契約書", payslip: "給与明細" };
  const KIND_STUDENT = { contract: "こよう けいやくしょ", payslip: "きゅうよ めいさい" };

  const monthStaff = m => m.slice(0, 4) + "年" + Number(m.slice(5)) + "月";
  const monthStudent = m => Number(m.slice(5)) + "がつ ぶん";
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());

  // 見本の書類の絵（通信しない data: の SVG）
  const xml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function sampleImage(title, sub) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">' +
      '<rect width="300" height="400" fill="#fbfbf7" stroke="#999"/>' +
      '<text x="150" y="60" font-size="22" text-anchor="middle" fill="#333">' + xml(title) + '</text>' +
      '<text x="150" y="95" font-size="15" text-anchor="middle" fill="#555">' + xml(sub) + '</text>' +
      '<g fill="#d6d6cf"><rect x="30" y="130" width="240" height="12"/><rect x="30" y="160" width="200" height="12"/>' +
      '<rect x="30" y="190" width="220" height="12"/><rect x="30" y="220" width="160" height="12"/></g>' +
      '<text x="150" y="360" font-size="14" text-anchor="middle" fill="#a00">見本（ダミー）</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // ---------- ダミーデータ（ブラウザのメモリだけ） ----------
  const db = { students: [], docs: {}, exempt: {}, seq: 0 };
  const names = ["テスト太郎", "テスト花子", "テスト次郎", "テスト三郎", "テスト桜", "テスト一郎", "テスト美咲", "テスト健太", "テスト由美", "テスト翔"];
  const classOf = ["1A", "1A", "1A", "1A", "1B", "1B", "1B", "2A", "2A", "2A"];
  names.forEach((name, i) => db.students.push({ id: String(2604999 - i), name, cls: classOf[i], arbeit: "unknown", workplaces: [] }));
  const S = no => db.students.find(s => s.id === no);
  let wpSeq = 0;
  function addWorkplace(st, name, start) { const wp = { id: "w" + (++wpSeq), name, start: start || MONTHS[0] }; st.workplaces.push(wp); st.arbeit = "working"; return wp; }
  const slotKey = (sid, wid, kind, month) => [sid, wid, kind, kind === "contract" ? "" : month].join("|");
  function pushDoc(sid, wid, kind, month, rec) {
    const k = slotKey(sid, wid, kind, month);
    (db.docs[k] = db.docs[k] || []).push(Object.assign({ id: "d" + (++db.seq), status: "submitted", via: "student", reason: "", at: new Date(), log: [] }, rec));
  }
  function seed(no, wid, kind, month, status, extra) {
    const st = S(no), wp = st.workplaces.find(w => w.id === wid);
    const img = sampleImage(KIND_STAFF[kind], wp.name + (month ? " " + monthStaff(month) : ""));
    const rec = Object.assign({ status, img, at: new Date(2026, 10, 1, 10, 0) }, extra || {});
    rec.log = [{ at: rec.at, text: (rec.via === "paper" ? "紙で受け取り（職員が登録）" : "学生が提出") }];
    if (status === "confirmed") rec.log.push({ at: rec.at, text: "確認済みにした" });
    if (status === "returned") rec.log.push({ at: rec.at, text: "差し戻した（理由：" + rec.reason + "）" });
    pushDoc(no, wid, kind, month, rec);
  }
  (function seedAll() {
    let w;
    w = addWorkplace(S("2604999"), "コンビニA", "2026-04");
    seed("2604999", w.id, "contract", null, "confirmed"); seed("2604999", w.id, "payslip", "2026-09", "confirmed"); seed("2604999", w.id, "payslip", "2026-10", "confirmed");
    w = addWorkplace(S("2604998"), "コンビニA", "2026-04");
    seed("2604998", w.id, "contract", null, "confirmed"); seed("2604998", w.id, "payslip", "2026-09", "confirmed"); seed("2604998", w.id, "payslip", "2026-10", "submitted");
    w = addWorkplace(S("2604998"), "工場B", "2026-10");
    seed("2604998", w.id, "contract", null, "submitted");
    S("2604997").arbeit = "none";
    // 2604996 は未入力のまま
    w = addWorkplace(S("2604995"), "飲食店C", "2026-04");
    seed("2604995", w.id, "contract", null, "confirmed", { via: "paper" }); seed("2604995", w.id, "payslip", "2026-09", "confirmed", { via: "paper" });
    seed("2604995", w.id, "payslip", "2026-10", "returned", { reason: "写真がぼやけていて、支給額が読めません。" });
    w = addWorkplace(S("2604994"), "倉庫D", "2026-04");
    seed("2604994", w.id, "contract", null, "confirmed"); seed("2604994", w.id, "payslip", "2026-09", "confirmed"); seed("2604994", w.id, "payslip", "2026-10", "submitted");
    db.exempt["2604994|2026-11"] = "一時帰国のため（11月は勤務なし）";
    S("2604993").arbeit = "none";
    addWorkplace(S("2604992"), "ホテルE", "2026-09");
    // 2604991 は未入力のまま
    w = addWorkplace(S("2604990"), "スーパーF", "2026-04");
    seed("2604990", w.id, "contract", null, "confirmed"); MONTHS.forEach(m => seed("2604990", w.id, "payslip", m, "confirmed"));
  })();

  // ---------- 状態の決め方（学生・職員で同じものを読む） ----------
  const latest = (sid, wid, kind, month) => { const a = db.docs[slotKey(sid, wid, kind, month)]; return a && a.length ? a[a.length - 1] : null; };
  function slotState(st, wp, kind, month) {
    if (kind === "payslip") {
      if (month < wp.start) return "na";
      if (db.exempt[st.id + "|" + month] != null) return "exempt";
    }
    const l = latest(st.id, wp.id, kind, month);
    return l ? l.status : "missing";
  }
  // 1人×1か月（または契約書）の中身。勤務先ごとに分けて返す。
  function cellItems(st, kind, month) {
    if (st.arbeit === "unknown") return [{ state: "unknown" }];
    if (st.arbeit === "none") return [{ state: "none" }];
    if (kind === "payslip" && db.exempt[st.id + "|" + month] != null) return [{ state: "exempt", month }];
    const items = st.workplaces.map(wp => ({ state: slotState(st, wp, kind, month), wp, kind, month, doc: latest(st.id, wp.id, kind, month) })).filter(x => x.state !== "na");
    return items.length ? items : [{ state: "na" }];
  }

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

  // ---------- 切り替え ----------
  function showView(which) {
    $("view-student").hidden = which !== "student"; $("view-staff").hidden = which !== "staff";
    $("tab-student").setAttribute("aria-pressed", String(which === "student")); $("tab-staff").setAttribute("aria-pressed", String(which === "staff"));
    if (which === "student") renderStudent(); else renderStaff();
  }
  $("tab-student").addEventListener("click", () => showView("student"));
  $("tab-staff").addEventListener("click", () => showView("staff"));

  // ================= 学生の画面 =================
  let me = db.students[0].id, chosenFile = null, chosenUrl = "";
  db.students.forEach(s => $("st-who").append(el("option", { value: s.id, text: s.id + " " + s.name + "（" + s.cls + "）" })));
  $("st-who").addEventListener("change", () => { me = $("st-who").value; clearFile(); say($("st-msg"), ""); renderStudent(); });

  function clearFile() { chosenFile = null; chosenUrl = ""; $("st-file").value = ""; $("st-thumb").hidden = true; $("st-thumb-img").removeAttribute("src"); }
  $("st-file").addEventListener("change", () => {
    const f = $("st-file").files[0];
    if (!f) { clearFile(); return; }
    if (!/^image\//.test(f.type)) { clearFile(); say($("st-msg"), "しゃしん（がぞう）を えらんで ください。", true); return; }
    chosenFile = f; chosenUrl = URL.createObjectURL(f); // ブラウザの中だけで表示する。送らない。
    $("st-thumb-img").src = chosenUrl; $("st-thumb").hidden = false; say($("st-msg"), "");
  });

  function renderStudent() {
    const st = S(me);
    $("st-who").value = me;
    // 状態
    const box = $("st-status"); box.replaceChildren();
    if (st.arbeit === "unknown") {
      box.append(el("p", { text: "まだ こたえて いません。アルバイトを して いますか？" }),
        el("div", { class: "ap-choice" },
          el("button", { type: "button", id: "st-say-none", text: "アルバイトを していない", on: { click: () => { st.arbeit = "none"; renderStudent(); } } }),
          el("button", { type: "button", id: "st-say-work", text: "アルバイトを している", on: { click: () => { st.arbeit = "working"; renderStudent(); } } })));
    } else if (st.arbeit === "none") {
      box.append(el("p", { id: "st-status-text", text: "アルバイトを していない" }),
        el("button", { type: "button", id: "st-say-work", text: "アルバイトを はじめた", on: { click: () => { st.arbeit = "working"; renderStudent(); } } }));
    } else {
      box.append(el("p", { id: "st-status-text", text: st.workplaces.length ? "アルバイトを している（" + st.workplaces.length + "か所）" : "アルバイトを している" }));
      if (!st.workplaces.length) box.append(el("button", { type: "button", id: "st-say-none", text: "アルバイトを していない", on: { click: () => { st.arbeit = "none"; renderStudent(); } } }));
      const inp = el("input", { id: "st-wp-name", type: "text", maxlength: "40", placeholder: "れい：コンビニA", "aria-label": "はたらく ところの なまえ" });
      box.append(el("p", { class: "ap-muted", text: "はたらく ところを ふやす：" }),
        el("div", { class: "ap-addwp" }, inp, el("button", { type: "button", id: "st-wp-add", text: "ふやす", on: { click: () => {
          const name = inp.value.trim();
          if (!name) { say($("st-msg"), "はたらく ところの なまえを かいて ください。", true); return; }
          addWorkplace(st, name, MONTHS[MONTHS.length - 1]); say($("st-msg"), "「" + name + "」を ふやしました。こよう けいやくしょを だして ください。"); renderStudent();
        } } })));
    }
    // 書類の一覧
    const docs = $("st-docs"); docs.replaceChildren();
    if (st.arbeit !== "working" || !st.workplaces.length) {
      docs.append(el("p", { class: "ap-muted", text: st.arbeit === "working" ? "はたらく ところを ふやすと、ここに でます。" : "だす しょるいは ありません。" }));
    }
    if (st.arbeit === "working") st.workplaces.forEach(wp => {
      const sec = el("div", { class: "ap-wp", dataset: { wp: wp.id } }, el("h3", { text: wp.name }));
      sec.append(studentRow(st, wp, "contract", null));
      MONTHS.forEach(m => { if (slotState(st, wp, "payslip", m) !== "na") sec.append(studentRow(st, wp, "payslip", m)); });
      docs.append(sec);
    });
    // 出す欄
    const can = st.arbeit === "working" && st.workplaces.length > 0;
    $("st-submit-body").hidden = !can;
    const wpSel = $("st-wp"), keep = wpSel.value; wpSel.replaceChildren();
    st.workplaces.forEach(wp => wpSel.append(el("option", { value: wp.id, text: wp.name })));
    if (st.workplaces.some(w => w.id === keep)) wpSel.value = keep;
    fillMonths();
  }
  function studentRow(st, wp, kind, month) {
    const s = slotState(st, wp, kind, month), d = latest(st.id, wp.id, kind, month);
    const label = kind === "contract" ? KIND_STUDENT.contract : KIND_STUDENT.payslip + "（" + monthStudent(month) + "）";
    const row = el("div", { class: "ap-row", dataset: { kind, month: month || "", wp: wp.id, state: s } },
      el("span", { text: label }),
      el("span", { class: "ap-badge", dataset: { state: s }, text: STUDENT_LABEL[s] + (d && d.via === "paper" && s !== "returned" ? "（かみ）" : "") }));
    if (s === "returned" && d && d.reason) row.append(el("span", { class: "ap-reason st-reason", text: "りゆう：" + d.reason }));
    return row;
  }
  function fillMonths() {
    const st = S(me), wp = st.workplaces.find(w => w.id === $("st-wp").value), kind = $("st-kind").value;
    $("st-month-field").hidden = kind !== "payslip";
    const sel = $("st-month"), keep = sel.value; sel.replaceChildren();
    if (!wp) return;
    MONTHS.forEach(m => {
      const s = slotState(st, wp, "payslip", m);
      if (s === "na") return;
      sel.append(el("option", { value: m, disabled: s === "confirmed" || s === "exempt", text: monthStudent(m) + "（" + STUDENT_LABEL[s] + "）" }));
    });
    if ([...sel.options].some(o => o.value === keep && !o.disabled)) sel.value = keep;
    else { const first = [...sel.options].find(o => !o.disabled); if (first) sel.value = first.value; }
  }
  $("st-wp").addEventListener("change", fillMonths);
  $("st-kind").addEventListener("change", fillMonths);
  $("st-send").addEventListener("click", () => {
    const st = S(me), wp = st.workplaces.find(w => w.id === $("st-wp").value), kind = $("st-kind").value;
    const month = kind === "payslip" ? $("st-month").value : null;
    if (!chosenFile) { say($("st-msg"), "さきに しゃしんを えらんで ください。", true); return; }
    if (!wp) { say($("st-msg"), "はたらく ところを えらんで ください。", true); return; }
    if (kind === "payslip" && !month) { say($("st-msg"), "なんがつ ぶんか えらんで ください。", true); return; }
    const s = slotState(st, wp, kind, month);
    if (s === "confirmed") { say($("st-msg"), "これは もう かくにん ずみ です。だす ひつようは ありません。", true); return; }
    if (s === "exempt") { say($("st-msg"), "この つきは ださなくて いい です。", true); return; }
    const now = new Date();
    pushDoc(st.id, wp.id, kind, month, { img: chosenUrl, fileName: chosenFile.name, at: now, log: [{ at: now, text: s === "missing" ? "学生が提出" : "学生が出し直し" }] });
    say($("st-msg"), wp.name + "の " + (kind === "contract" ? KIND_STUDENT.contract : KIND_STUDENT.payslip + "（" + monthStudent(month) + "）") + "を だしました。せんせいが かくにん します。");
    clearFile(); renderStudent();
  });

  // ================= 職員の画面 =================
  $("sf-class").append(el("option", { value: "", text: "すべて" }), ...CLASSES.map(c => el("option", { value: c, text: c })));
  $("sf-month").append(el("option", { value: "", text: "すべての月" }), ...MONTHS.map(m => el("option", { value: m, text: monthStaff(m) })));
  ["sf-class", "sf-month", "sf-state"].forEach(id => $(id).addEventListener("change", renderStaff));
  $("sf-legend").append(...["missing", "submitted", "confirmed", "returned", "exempt", "none", "unknown", "na"].map(s => el("span", { class: "ap-badge", dataset: { state: s }, text: STAFF_LABEL[s] })));
  let selected = null; // {sid, wid, kind, month} または {sid, exempt:month}

  function renderStaff() {
    const cls = $("sf-class").value, mon = $("sf-month").value, want = $("sf-state").value;
    const months = mon ? [mon] : MONTHS;
    const head = $("sf-head"); head.replaceChildren(
      ...["学籍番号", "氏名", "クラス", "雇用契約書"].map(t => el("th", { text: t })),
      ...months.map(m => el("th", { text: "給与明細 " + monthStaff(m) })));
    const body = $("sf-body"); body.replaceChildren();
    const counts = {}; let rows = 0;
    db.students.forEach(st => {
      if (cls && st.cls !== cls) return;
      const cols = [cellItems(st, "contract", null), ...months.map(m => cellItems(st, "payslip", m))];
      const all = cols.flat();
      if (want && !all.some(x => x.state === want)) return;
      rows++;
      all.forEach(x => { counts[x.state] = (counts[x.state] || 0) + 1; });
      const tr = el("tr", { dataset: { sid: st.id } },
        el("td", { class: "nm", text: st.id }), el("td", { class: "nm", text: st.name }), el("td", { text: st.cls }),
        ...cols.map((items, i) => el("td", null, el("div", { class: "ap-cell" }, items.map(x => chip(st, x, i === 0 ? null : months[i - 1]))))));
      body.append(tr);
    });
    $("sf-empty").hidden = rows > 0;
    $("sf-summary").textContent = "表示中 " + rows + "人 ／ " +
      ["missing", "submitted", "returned", "confirmed", "exempt", "none", "unknown"].map(s => STAFF_LABEL[s] + " " + (counts[s] || 0) + "件").join("・");
    renderDetail();
  }
  function chip(st, x, month) {
    const multi = st.workplaces.length > 1;
    const text = (x.wp && multi ? x.wp.name + "：" : "") + STAFF_LABEL[x.state];
    const clickable = x.wp || x.state === "exempt";
    const b = el(clickable ? "button" : "span", { type: clickable ? "button" : null, class: "ap-chip", dataset: { state: x.state, sid: st.id, wid: x.wp ? x.wp.id : "", kind: x.kind || "", month: month || "" }, title: x.wp ? x.wp.name : null, text });
    if (x.doc && x.doc.via === "paper") b.append(el("span", { class: "ap-paper", text: "紙" }));
    if (clickable) b.addEventListener("click", () => {
      selected = x.wp ? { sid: st.id, wid: x.wp.id, kind: x.kind, month: x.kind === "payslip" ? month : null } : { sid: st.id, exempt: month };
      say($("dt-msg"), ""); renderDetail(); $("sf-detail").scrollIntoView({ block: "nearest" });
    });
    return b;
  }

  function renderDetail() {
    const box = $("sf-detail");
    if (!selected) { box.hidden = true; return; }
    box.hidden = false;
    const st = S(selected.sid), doc = $("dt-doc"), act = $("dt-actions"), hist = $("dt-history");
    doc.replaceChildren(); act.replaceChildren(); hist.replaceChildren();
    if (selected.exempt) {
      const m = selected.exempt;
      $("dt-title").textContent = st.name + "（" + st.id + "）・給与明細 " + monthStaff(m);
      $("dt-state").replaceChildren("状態：", el("span", { class: "ap-badge", dataset: { state: "exempt" }, text: STAFF_LABEL.exempt }));
      doc.append(el("p", { text: "理由：" + db.exempt[st.id + "|" + m] }));
      act.append(el("div", { class: "ap-actions" }, el("button", { type: "button", id: "dt-unexempt", text: "提出免除を取り消す", on: { click: () => {
        delete db.exempt[st.id + "|" + m]; selected = null; say($("dt-msg"), ""); renderStaff();
      } } })));
      return;
    }
    const wp = st.workplaces.find(w => w.id === selected.wid), { kind, month } = selected;
    const s = slotState(st, wp, kind, month), d = latest(st.id, wp.id, kind, month);
    $("dt-title").textContent = st.name + "（" + st.id + "）・" + wp.name + "・" + KIND_STAFF[kind] + (month ? " " + monthStaff(month) : "");
    $("dt-state").replaceChildren("状態：", el("span", { class: "ap-badge", id: "dt-state-badge", dataset: { state: s }, text: STAFF_LABEL[s] }));
    if (d) {
      doc.append(el("p", { class: "ap-muted", text: "提出日時：" + stamp(d.at) + "　提出方法：" + (d.via === "paper" ? "紙で受け取り（職員が登録）" : "学生がアップロード") }));
      if (d.img) doc.append(el("img", { id: "dt-img", src: d.img, alt: "提出された書類" }));
      else doc.append(el("p", { class: "ap-muted", text: "画像なし（紙の原本のみ）" }));
      if (s === "returned") doc.append(el("p", { class: "ap-reason", text: "差し戻しの理由：" + d.reason }));
    } else {
      doc.append(el("p", { class: "ap-muted", text: "提出されていません。" }));
    }
    const row = el("div", { class: "ap-actions" });
    if (s === "submitted") {
      row.append(el("button", { type: "button", id: "dt-confirm", class: "ap-primary", text: "確認済みにする", on: { click: () => {
        d.status = "confirmed"; d.log.push({ at: new Date(), text: "確認済みにした" }); say($("dt-msg"), "確認済みにしました。"); renderStaff();
      } } }));
      const ta = el("textarea", { id: "dt-reason", maxlength: "200", placeholder: "例：写真が暗くて金額が読めません" });
      row.append(el("div", { class: "ap-box" }, el("label", { class: "ap-field", for: "dt-reason", text: "差し戻す理由（学生の画面にそのまま出ます）" }), ta,
        el("button", { type: "button", id: "dt-return", class: "ap-danger", text: "差し戻す", on: { click: () => {
          const r = ta.value.trim();
          if (!r) { say($("dt-msg"), "差し戻す理由を書いてください。", true); return; }
          d.status = "returned"; d.reason = r; d.log.push({ at: new Date(), text: "差し戻した（理由：" + r + "）" }); say($("dt-msg"), "差し戻しました。学生の画面に理由が出ます。"); renderStaff();
        } } })));
    }
    if (s === "missing" || s === "returned") {
      const file = el("input", { id: "dt-paper-file", type: "file", accept: "image/*" });
      row.append(el("div", { class: "ap-box" }, el("p", { text: "紙で受け取った場合（写真は任意）" }), file,
        el("button", { type: "button", id: "dt-paper", text: "紙で受け取りとして登録", on: { click: () => {
          const f = file.files[0]; const now = new Date();
          if (f && !/^image\//.test(f.type)) { say($("dt-msg"), "画像のファイルを選んでください。", true); return; }
          pushDoc(st.id, wp.id, kind, month, { via: "paper", img: f ? URL.createObjectURL(f) : "", at: now, log: [{ at: now, text: "紙で受け取り（職員が登録）" }] });
          say($("dt-msg"), "紙で受け取った分として登録しました（未確認）。"); renderStaff();
        } } })));
    }
    if (s === "missing" && kind === "payslip") {
      const ta = el("input", { id: "dt-exempt-reason", type: "text", maxlength: "100", placeholder: "例：一時帰国のため" });
      row.append(el("div", { class: "ap-box" }, el("label", { class: "ap-field", for: "dt-exempt-reason", text: "この月を提出免除にする（理由）" }), ta,
        el("button", { type: "button", id: "dt-exempt", text: "提出免除にする", on: { click: () => {
          const r = ta.value.trim();
          if (!r) { say($("dt-msg"), "提出免除の理由を書いてください。", true); return; }
          db.exempt[st.id + "|" + month] = r; selected = { sid: st.id, exempt: month }; say($("dt-msg"), "提出免除にしました。"); renderStaff();
        } } })));
    }
    act.append(row);
    const all = db.docs[slotKey(st.id, wp.id, kind, month)] || [];
    if (all.length) {
      hist.append(el("p", { class: "ap-muted", text: "これまでの記録（この見本の中だけ）" }),
        el("ul", { class: "ap-history" }, all.flatMap((x, i) => x.log.map(l => el("li", { text: (i + 1) + "回目 " + stamp(l.at) + " " + l.text })))));
    }
  }
  $("dt-close").addEventListener("click", () => { selected = null; say($("dt-msg"), ""); renderDetail(); });

  renderStudent();
  // 検査用の窓口（読むだけ）
  window.arbeitPreview = { db, cellItems, slotState, STAFF_LABEL, STUDENT_LABEL };
})();
