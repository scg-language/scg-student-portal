/* はじめのお知らせの見本（policy-preview.html）。
 * ダミーのデータだけで動く。通信しない・端末に保存しない（再読み込みで元に戻る）。
 * 文字は必ず textContent で入れる（HTML として流し込む書き方はしない。検査が見張る）。
 * 文は下書き。【　】はまだ決まっていない所。英語は確認前。 */
"use strict";
(function () {
  // 文は assets/policy-notice.js（学生の画面と同じもの）。ここには見本だけの文言を置く
  const L = (ja, en) => ({ ja, en });
  const NOTICE = window.POLICY_NOTICE;
  // 版2を見せるときに足す行（見本だけ。本物の文には無い）
  const ADDED = L("先生との 面談の 記録を まとめる", "Summarizing records of your meetings with teachers");
  const UI = {
    login: L("ログイン", "Log in"), loginNote: L("（見本です。おすと ログイン します）", "(Preview: press to log in)"),
    read: L("よみました", "I have read this"),
    changed: L("まえに よんだ ときから、かわった ところが あります。色の ついた ところです。", "Something has changed since you last read this. The change is highlighted."),
    hello: L("{name} さん", "Hello, {name}"), quiz: L("テストを うける", "Take a quiz"), survey: L("アンケートに こたえる", "Answer a survey"),
    dummy: L("（見本では うごきません）", "(Not active in this preview)"),
    noticeCard: L("学校からの 大事な お知らせ", "Important notice from the school"),
    readOn: L("よみました（{d}）", "Read ({d})"), again: L("もういちど よむ", "Read again"), back: L("もどる", "Back"),
    logout: L("ログアウト", "Log out"), soon: L("じゅんびちゅう", "coming soon"),
  };
  const LANGS = [["ja", "日本語", true], ["en", "English", true], ["zh", "中文", false], ["ne", "नेपाली", false], ["my", "မြန်မာ", false], ["si", "සිංහල", false], ["bn", "বাংলা", false], ["vi", "Tiếng Việt", false], ["uz", "Oʻzbekcha", false]];
  const ACTION_LABEL = { read: "よみました" };

  // ---------- ダミーデータ（ブラウザのメモリだけ） ----------
  const names = ["テスト太郎", "テスト花子", "テスト次郎", "テスト三郎", "テスト桜", "テスト一郎"];
  const classOf = ["1A", "1A", "1A", "1A", "1B", "1B"];
  const students = names.map((name, i) => ({ id: String(2604999 - i), name, cls: classOf[i] }));
  const log = []; // 押すたびに1行ふえる。直さない・消さない
  const state = { version: 1, who: students[0].id, lang: "ja", screen: "login", tab: "student", cls: "1A" };
  let clock = new Date(2026, 11, 15, 10, 0).getTime();
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  function record(sid, action, lang, at) { clock += 60000; log.push({ sid, action, version: state.version, lang: lang || state.lang, at: at || new Date(clock) }); }
  // はじめから押してある学生（版1）
  record("2604998", "read", "ja"); record("2604997", "read", "en"); record("2604995", "read", "ja");

  const last = (sid, actions, version) => { for (let i = log.length - 1; i >= 0; i--) { const r = log[i]; if (r.sid === sid && actions.includes(r.action) && (version == null || r.version === version)) return r; } return null; };
  const hasRead = sid => Boolean(last(sid, ["read"], state.version));
  const readBefore = sid => log.some(r => r.sid === sid && r.action === "read" && r.version < state.version);

  // ---------- 部品 ----------
  const $ = id => document.getElementById(id);
  const tx = o => o[state.lang] || o.ja;
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(text, cls, id, fn) { const b = el("button", cls, text); b.type = "button"; if (id) b.id = id; b.addEventListener("click", fn); return b; }
  function langBar(parent) {
    const bar = el("div", "pp-langs"); bar.id = "st-langs";
    LANGS.forEach(([code, label, ready]) => {
      const b = button(ready ? label : label + "（" + tx(UI.soon) + "）", "", "lang-" + code, () => { state.lang = code; render(); });
      b.disabled = !ready; b.setAttribute("aria-pressed", String(state.lang === code)); bar.appendChild(b);
    });
    parent.appendChild(bar);
  }

  // ---------- 学生の画面 ----------
  const me = () => students.find(s => s.id === state.who);
  const nextScreen = () => hasRead(state.who) ? "home" : "gate";
  function noticeDoc(card) {
    NOTICE.render(card, state.lang, state.version >= 2 ? { extra: { s8: ADDED } } : null);
  }
  function renderStudent() {
    const phone = $("st-phone"); phone.replaceChildren(); phone.dataset.screen = state.screen;
    const card = el("div", "pp-card"); phone.appendChild(card);
    if (state.screen === "login") {
      langBar(card);
      card.appendChild(el("h2", "", "SCG 学生ポータル"));
      card.appendChild(el("p", "pp-muted", me().id + " ／ " + me().name));
      card.appendChild(button(tx(UI.login), "pp-primary pp-wide", "st-login", () => { state.screen = nextScreen(); render(); }));
      card.appendChild(el("p", "pp-muted", tx(UI.loginNote)));
    } else if (state.screen === "gate" || state.screen === "reread") {
      langBar(card);
      card.appendChild(el("h2", "", tx(NOTICE.title)));
      card.appendChild(el("p", "pp-muted", tx(NOTICE.sub)));
      if (state.screen === "gate" && readBefore(state.who)) { const c = el("p", "pp-changed", tx(UI.changed)); c.id = "st-changed"; card.appendChild(c); }
      noticeDoc(card);
      if (state.screen === "gate") card.appendChild(button(tx(UI.read), "pp-primary pp-wide", "st-read", () => { record(state.who, "read"); state.screen = nextScreen(); render(); }));
      else card.appendChild(button(tx(UI.back), "pp-wide", "st-back", () => { state.screen = "home"; render(); }));
    } else {
      card.appendChild(el("h2", "", tx(UI.hello).replace("{name}", me().name)));
      [UI.quiz, UI.survey].forEach(label => { const b = button(tx(label), "pp-wide", null, () => {}); b.disabled = true; card.appendChild(b); });
      card.appendChild(el("p", "pp-muted", tx(UI.dummy)));
      const notice = el("div", "pp-card"); phone.appendChild(notice);
      notice.appendChild(el("h2", "", tx(UI.noticeCard)));
      const r = last(state.who, ["read"], state.version);
      const done = el("p", "pp-done", tx(UI.readOn).replace("{d}", stamp(r.at))); done.id = "st-done"; notice.appendChild(done);
      notice.appendChild(button(tx(UI.again), "", "st-again", () => { state.screen = "reread"; render(); }));
      phone.appendChild(button(tx(UI.logout), "pp-wide", "st-logout", () => { state.screen = "login"; render(); }));
    }
  }

  // ---------- 先生のスマホ（ふつうの日本語。名前は「まだ」の学生だけ） ----------
  function renderTeacher() {
    const inClass = students.filter(s => s.cls === state.cls), notYet = inClass.filter(s => !hasRead(s.id));
    $("tc-count").textContent = "まだ読んでいない学生　" + notYet.length + "名";
    const list = $("tc-list"); list.replaceChildren();
    notYet.forEach(s => list.appendChild(el("li", "", s.name + "（" + s.id + "）")));
    $("tc-done").textContent = "読んだ学生　" + (inClass.length - notYet.length) + "名 ／ クラス " + inClass.length + "名";
  }
  function renderLog() {
    const tbody = $("lg-body"); tbody.replaceChildren();
    log.slice().reverse().forEach(r => {
      const tr = el("tr"); tr.dataset.action = r.action;
      [r.sid, ACTION_LABEL[r.action], "版" + r.version, r.lang, stamp(r.at)].forEach(v => tr.appendChild(el("td", "", v)));
      tbody.appendChild(tr);
    });
  }

  function render() {
    document.documentElement.lang = "ja";
    ["student", "teacher", "log"].forEach(t => { $("tab-" + t).setAttribute("aria-pressed", String(state.tab === t)); $("view-" + t).hidden = state.tab !== t; });
    $("ctl-ver").textContent = "版" + state.version;
    $("ctl-bump").disabled = state.version >= 2;
    renderStudent(); renderTeacher(); renderLog();
  }

  // ---------- 見本の操作 ----------
  students.forEach(s => { const o = el("option", "", s.name + "（" + s.cls + "）"); o.value = s.id; $("ctl-who").appendChild(o); });
  ["1A", "1B"].forEach(c => { const o = el("option", "", c); o.value = c; $("tc-class").appendChild(o); });
  $("ctl-who").addEventListener("change", e => { state.who = e.target.value; state.screen = "login"; render(); });
  $("ctl-bump").addEventListener("click", () => { state.version = 2; state.screen = "login"; render(); });
  $("tc-class").addEventListener("change", e => { state.cls = e.target.value; render(); });
  ["student", "teacher", "log"].forEach(t => $("tab-" + t).addEventListener("click", () => { state.tab = t; render(); }));
  render();
  window.policyPreview = { state, log, students };
})();
