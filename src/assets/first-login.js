/* はじめてのログインの受付（2026-11-25 きあ決定・12/12 の会話テストの日に使う）
 *
 * スマホ（master-phone.html ⑦）と PC（master.html 左のメニュー「はじめてのログイン」）が同じものを使う。
 * 🔴 権限の名前・DB の口・「確認済みにできるか」「クラスの中の分け方」はここ1か所。片方の画面だけに条件を書かない
 *    （2026-11-20 きあ「基本の機能はスマホと PC で同じにする」）
 *
 * 状態は3つ：①ログインした（サーバーが知っている）②パスワードを決め直した（サーバーが「scg＋学籍番号」と照合する）
 *            ③ホーム画面に入れた（サーバーには分からない＝見て「確認済みにする」を押す）
 * 🔴 使えるのは「はじめてのログインの受付」（first_login.check）を持つ人だけ。2026-11-25 は情報管理者だけ（きあ「とりあえず」）。
 *    ここの「持っている人だけに出す」は案内であって権限ではない（権限は DB の first_login_board / first_login_mark が見る）
 * 🔴 10秒ごとに取り直すが、画面に触れた直後（2.5秒）と記録を送っている間は描き直さない（押そうとした行がずれて、別の人を押さないように）
 * 🔴 文言はふつうの日本語（社員が使う画面）。名前は textContent で入れる
 * DB＝db/2026-11-25_first_login_board.sql
 */
(function (root) {
  "use strict";
  const CAP = "first_login.check";
  const REFRESH_MS = 10000, TOUCH_MS = 2500, TOAST_MS = 6000;

  /* ── スマホと PC で同じもの ── */
  async function can() {   // 分からないときは出さない
    try { const c = await api.rpc("my_caps", {}); return Array.isArray(c) && c.includes(CAP); }
    catch (e) { return false; }
  }
  const load = c => api.rpc("first_login_board", { p_class: c == null ? null : c });
  const mark = (id, on) => api.rpc("first_login_mark", { p_student_id: id, p_checked: !!on });
  const canMark = s => !!s && s.pw === "changed";                       // 決め直した人だけ（サーバーも断る）
  const pwLabel = s => s.pw === "initial" ? "パスワードまだ" : "照合中";  // 押せない人の札
  /* クラスを開いたときの3つ（DB の rows から）。受付中はログインした順、確認済みは新しい順 */
  function split(rows) {
    rows = rows || [];
    return {
      notYet: rows.filter(s => !s.signed_at && !s.checked),
      inProg: rows.filter(s => s.signed_at && !s.checked).sort((a, b) => String(a.signed_at).localeCompare(String(b.signed_at))),
      done: rows.filter(s => s.checked).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at))),
    };
  }
  const nameOf = s => (s && s.name) || "（名前なし）";
  const short = c => String(c || "").replace(/クラス$/, "");
  const hm = d => d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  const when = iso => { if (!iso) return ""; const d = new Date(iso), n = new Date();
    return d.toDateString() === n.toDateString() ? hm(d) : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm(d); };
  const doneText = (s, on) => nameOf(s) + " さん" + (on ? "を確認済みにしました" : "の確認済みを取り消しました");

  /* ── PC（master.html）── 左のメニュー [data-view="firstlogin"]（持っている人だけに出す）→ #view-firstlogin を組み立てる */
  const P = { asked: false, ok: false, built: false, cls: null, last: null, timer: null, busy: false, touch: 0, showDone: false, toastT: null };
  const byId = id => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function pcInit() {
    if (P.asked) return;
    P.asked = true;
    P.ok = await can();
    const b = document.querySelector('[data-view="firstlogin"]');
    if (b) b.hidden = !P.ok;
    document.addEventListener("pointerdown", () => { P.touch = Date.now(); }, true);
  }
  function pcOnView(v) {
    clearInterval(P.timer); P.timer = null;
    if (v !== "firstlogin") return;
    pcBuild();
    if (!P.ok) { byId("fl-act").replaceChildren(mk("div", "muted", "この画面を使う権限がありません（情報管理者に確認してください）。")); return; }
    pcRefresh(true);
    P.timer = setInterval(() => {
      if (document.hidden || P.busy || Date.now() - P.touch < TOUCH_MS) return;
      pcRefresh(false);
    }, REFRESH_MS);
  }
  function pcBuild() {
    const pane = byId("view-firstlogin");
    if (!pane || P.built) return;
    P.built = true;
    const head = mk("div", "a-head"), l = mk("div", "l");
    l.append(mk("h1", "ah1", "はじめてのログイン"), mk("span", "muted", "受付の画面です。10秒ごとに更新します。"));
    const upd = mk("span", "muted"); upd.id = "fl-upd"; l.appendChild(upd);
    head.appendChild(l); pane.appendChild(head);
    const kpi = mk("div", "kpi"); kpi.id = "fl-kpi"; pane.appendChild(kpi);
    const row = mk("div", "a-row"), main = mk("div", "a-main"), aside = mk("div", "a-aside");
    const panel = (id, title) => { const p = mk("div", "panel"); p.appendChild(mk("h2", "", title)); const b = mk("div"); b.id = id; p.appendChild(b); return p; };
    main.appendChild(panel("fl-act", "受付中（今日ログインして、まだ確認していない人）・ログインした順"));
    const one = mk("div", "panel"); one.id = "fl-one"; one.hidden = true; main.appendChild(one);
    main.appendChild(panel("fl-cls", "クラス別（名前はクラスを開くと出ます）"));
    aside.appendChild(panel("fl-done", "今日 確認済みにした学生"));
    row.append(main, aside); pane.appendChild(row);
    pane.appendChild(mk("div", "note", "パスワードを決め直したかは、サーバーが自動で確かめます。ホーム画面にアイコンが入ったのを見てから「確認済みにする」を押してください。"
      + "パスワードを決め直していない学生は、確認済みにできません。"));
  }
  async function pcRefresh(first) {
    const cls = P.cls;
    if (first) byId("fl-act").replaceChildren(mk("div", "muted", "読み込み中…"));
    try {
      const d = await load(cls);
      if (cls !== P.cls) return;      // 読んでいる間に別のクラスを開いた
      P.last = d; pcDraw(d);
      byId("fl-upd").textContent = "最終 " + new Date().toLocaleTimeString("ja-JP");
    } catch (e) {
      if (first) byId("fl-act").replaceChildren(mk("div", "msg err", "読み込みに失敗しました（" + e.message + "）"));
      else byId("fl-upd").textContent = "更新が止まっています（" + e.message + "）";
      const m = byId("fl-act").querySelector(".msg"); if (m) m.style.display = "block";
    }
  }
  function stat(v, l, s) { const d = mk("div", "stat"); d.append(mk("div", "v", String(v)), mk("div", "l", l)); if (s) d.appendChild(mk("div", "s", s)); return d; }
  function table(heads) {
    const t = mk("table", "atbl fl-tbl"), th = mk("thead"), tr = mk("tr");
    heads.forEach(h => { const c = mk("th", h[1] || "", h[0]); tr.appendChild(c); });
    th.appendChild(tr); t.appendChild(th); const tb = mk("tbody"); t.appendChild(tb);
    return { t, tb };
  }
  function nameCell(s) { const td = mk("td"); td.appendChild(mk("b", "", nameOf(s))); return td; }
  function markCell(s) {
    const td = mk("td");
    if (canMark(s)) { const b = mk("button", "abtn sm pri", "確認済みにする"); b.type = "button";
      b.setAttribute("aria-label", nameOf(s) + " さんを確認済みにする"); b.onclick = () => pcMark(s, true, b); td.appendChild(b); }
    else td.appendChild(mk("span", "pill " + (s.pw === "initial" ? "warn" : "off"), pwLabel(s)));
    return td;
  }
  function undoCell(s) {
    const td = mk("td"), b = mk("button", "abtn sm", "取り消す"); b.type = "button";
    b.onclick = async () => {
      const ok = await askDialog({ title: "「確認済み」を取り消しますか？", body: nameOf(s) + "（" + (s.student_no || "") + "）\n\n受付中に戻ります。", okText: "取り消す", danger: true });
      if (ok) pcMark(s, false, b);
    };
    td.appendChild(b); return td;
  }
  function pcDraw(d) {
    const act = d.active || [], done = d.done || [];
    byId("fl-kpi").replaceChildren(
      stat(act.length, "受付中", "今日ログインして、まだ確認していない人"),
      stat(act.filter(canMark).length, "確認できる人", "パスワードを決め直した人"),
      stat(done.length, "今日の確認済み", ""));
    // 受付中（クラスをまたぐ）
    const a = byId("fl-act");
    if (!act.length) a.replaceChildren(mk("div", "muted", "受付中の学生はいません。学生がログインすると、ここに出ます。"));
    else { const { t, tb } = table([["名前"], ["学籍番号"], ["クラス"], ["ログイン"], [""]]);
      act.forEach(s => { const tr = mk("tr"); tr.style.cursor = "default";
        tr.append(nameCell(s), mk("td", "", s.student_no || ""), mk("td", "", short(s.class) || "なし"), mk("td", "num", when(s.signed_at)), markCell(s));
        tb.appendChild(tr); });
      a.replaceChildren(t); }
    // 今日の確認済み
    const dn = byId("fl-done");
    if (!done.length) dn.replaceChildren(mk("div", "muted", "今日はまだ、だれも確認済みにしていません。"));
    else { const { t, tb } = table([["名前"], ["クラス"], ["確認"], [""]]);
      done.forEach(s => { const tr = mk("tr"); tr.style.cursor = "default";
        tr.append(nameCell(s), mk("td", "", short(s.class) || "なし"), mk("td", "num", when(s.checked_at)), undoCell(s)); tb.appendChild(tr); });
      dn.replaceChildren(t); }
    // クラス別（人数だけ）
    const cl = byId("fl-cls"), cs = (d.classes || []).slice().sort((x, y) => x.class.localeCompare(y.class, "ja", { numeric: true }));
    if (!cs.length) cl.replaceChildren(mk("div", "muted", "在籍中の学生がいません。"));
    else { const { t, tb } = table([["クラス"], ["在籍", "num"], ["未ログイン", "num"], ["確認済み", "num"], [""]]);
      cs.forEach(g => { const tr = mk("tr"); tr.dataset.cls = g.class;
        if (g.class === P.cls) tr.style.background = "var(--pp-l)";
        tr.append(mk("td", "", short(g.class) || "なし"), mk("td", "num", g.target + "人"),
          mk("td", "num" + (g.not_yet ? " or" : ""), g.not_yet + "人"), mk("td", "num", g.checked + "人"), mk("td", "muted", g.class === P.cls ? "開いています" : "開く →"));
        tr.onclick = () => pcOpenClass(g.class === P.cls ? null : g.class);
        tb.appendChild(tr); });
      cl.replaceChildren(t); }
    pcDrawClass(d);
  }
  function pcOpenClass(c) { P.cls = c; P.showDone = false; pcDrawClass(P.last); if (c != null) pcRefresh(false); else pcDraw(P.last); }
  function pcDrawClass(d) {
    const one = byId("fl-one");
    if (P.cls == null || !d || !Array.isArray(d.rows)) { one.hidden = true; one.replaceChildren(); return; }
    const g = split(d.rows);
    one.hidden = false; one.replaceChildren();
    const h = mk("div", "a-head"); h.style.marginBottom = "8px";
    h.appendChild(mk("h2", "", (short(P.cls) || "クラスなし") + " クラス　未ログイン " + g.notYet.length + "人・確認済み " + g.done.length + " / " + d.rows.length + "人"));
    const x = mk("button", "abtn sm", "閉じる"); x.type = "button"; x.onclick = () => pcOpenClass(null); h.appendChild(x);
    one.appendChild(h);
    one.appendChild(mk("div", "secttl", "受付中（" + g.inProg.length + "人）"));
    if (!g.inProg.length) one.appendChild(mk("div", "muted", "いまはいません。"));
    else { const { t, tb } = table([["名前"], ["学籍番号"], ["ログイン"], [""]]);
      g.inProg.forEach(s => { const tr = mk("tr"); tr.style.cursor = "default";
        tr.append(nameCell(s), mk("td", "", s.student_no || ""), mk("td", "num", when(s.signed_at)), markCell(s)); tb.appendChild(tr); });
      one.appendChild(t); }
    one.appendChild(mk("div", "secttl", "まだログインしていない（" + g.notYet.length + "人）"));
    if (!g.notYet.length) one.appendChild(mk("div", "muted", d.rows.length ? "全員がログインしました。" : "このクラスに在籍中の学生はいません。"));
    else { const box = mk("div", "fl-names"); box.id = "fl-one-notyet";
      g.notYet.forEach(s => { const e = mk("div", "fl-name"); e.append(mk("b", "", nameOf(s)), mk("span", "muted", " " + (s.student_no || ""))); box.appendChild(e); });
      one.appendChild(box); }
    if (g.done.length) {
      const b = mk("button", "abtn sm", (P.showDone ? "確認済みをたたむ" : "確認済み " + g.done.length + "人を見る")); b.type = "button"; b.style.marginTop = "12px";
      b.onclick = () => { P.showDone = !P.showDone; pcDrawClass(P.last); }; one.appendChild(b);
      if (P.showDone) { const { t, tb } = table([["名前"], ["学籍番号"], ["確認"], [""]]); t.id = "fl-one-done";
        g.done.forEach(s => { const tr = mk("tr"); tr.style.cursor = "default";
          tr.append(nameCell(s), mk("td", "", s.student_no || ""), mk("td", "num", when(s.checked_at)), undoCell(s)); tb.appendChild(tr); });
        one.appendChild(t); }
    }
    one.appendChild(mk("div", "note", "在籍中の学生だけを数えています。会話テストを休んだ学生は「まだログインしていない」に残ります。"));
  }
  function pcToast(text, undo) {
    clearTimeout(P.toastT);
    let t = byId("fl-toast");
    if (!t) { t = mk("div", "fl-toast"); t.id = "fl-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.replaceChildren(mk("span", "t", text));
    if (undo) { const b = mk("button", "", "取り消す"); b.type = "button"; b.onclick = () => { t.hidden = true; undo(); }; t.appendChild(b); }
    t.hidden = false;
    P.toastT = setTimeout(() => { t.hidden = true; }, TOAST_MS);
  }
  async function pcMark(s, on, btn) {
    if (P.busy) return;
    P.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = "記録中…"; }
    try { await mark(s.id, on); pcToast(doneText(s, on), on ? () => pcMark(s, false) : null); }
    catch (e) { pcToast("記録できませんでした（" + e.message + "）"); }
    finally { P.busy = false; }
    await pcRefresh(false);
  }

  const FL = { CAP, REFRESH_MS, TOUCH_MS, TOAST_MS, can, load, mark, canMark, pwLabel, split, doneText,
    pc: { init: pcInit, onView: pcOnView, _state: P } };
  if (typeof module !== "undefined" && module.exports) module.exports = FL;
  root.FirstLogin = FL;
})(typeof window !== "undefined" ? window : globalThis);
