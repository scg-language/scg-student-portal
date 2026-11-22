/* はじめのお知らせの見本（policy-preview.html）。
 * ダミーのデータだけで動く。通信しない・端末に保存しない（再読み込みで元に戻る）。
 * 文字は必ず textContent で入れる（HTML として流し込む書き方はしない。検査が見張る）。
 * 文は下書き。【　】はまだ決まっていない所。英語は確認前。 */
"use strict";
(function () {
  // ---------- 文（版1）。{ja,en} の組。段落は文字列、箇条書きは配列 ----------
  const L = (ja, en) => ({ ja, en });
  const SECTIONS = [
    { id: "s1", h: L("1. 学校が もっている 情報", "1. Information the school holds"), body: [
      L("名前、学生番号、生年月日、国、連絡先、クラス、出席、テストや 試験の 結果、進路の 相談の 記録、【そのほか】",
        "Your name, student number, date of birth, country, contact details, class, attendance, test and exam results, records of career guidance, 【other items】") ] },
    { id: "s2", h: L("2. なんの ために つかうか", "2. What it is used for"), body: [[
      L("在籍と 出席の 管理", "Managing enrollment and attendance"),
      L("授業と 学習の 記録（小テスト・アンケートを ふくみます）", "Records of classes and learning (including quizzes and surveys)"),
      L("進路の 相談", "Career guidance"),
      L("学校からの 連絡", "Messages from the school"),
      L("在留資格の 手続きと、証明書の 発行", "Residence status procedures and issuing certificates") ]] },
    { id: "s3", h: L("3. どこに 保存 しているか", "3. Where it is stored"), body: [
      L("学校は、インターネットの サービスを つかって 情報を 保存 しています。", "The school stores information using internet services."),
      [ L("【Google の サービス（Google ドライブ など）】", "【Google services (such as Google Drive)】"),
        L("【学生ポータル（小テスト・アンケート）】", "【Student Portal (quizzes and surveys)】"),
        L("【そのほか】", "【Others】") ],
      L("これらの サービスでは、情報が 日本の 外に ある コンピューターに 保存される ことが あります。", "With these services, information may be stored on computers outside Japan."),
      L("学校は、サービスの 会社と 契約を して、情報を 安全に あつかう ことを 約束 しています。", "The school has contracts with these companies to handle information safely.") ] },
    { id: "s4", h: L("4. だれが 見るか", "4. Who can see it"), body: [[
      L("見る人：学校の 先生と 職員", "The school's teachers and staff"),
      L("学校が あなたの 同意なしに 情報を わたすのは、法律で 決まっている ときだけ です", "The school gives your information to others without your consent only when the law requires it"),
      L("【エージェント・保証人・進学先への 提供】", "【Sharing with agents, guarantors, and schools you apply to】") ]] },
    { id: "s5", h: L("5. いつまで もっているか", "5. How long it is kept"), body: [
      L("【在学中と、卒業の あと ○年】。その あとは 消します。", "【While you are enrolled and for ○ years after graduation】. After that, it is deleted.") ] },
    { id: "s6", h: L("6. あなたが できる こと", "6. What you can do"), body: [
      L("じぶんの 情報を 見たい とき、まちがいを なおして ほしい ときは、【窓口】に 言って ください。", "If you want to see your information or have a mistake corrected, please tell 【the contact desk】.") ] },
    { id: "s7", h: L("7. 学生ポータルが どうしても いやな とき", "7. If you really do not want to use the Student Portal"), body: [
      L("先生に 言って ください。テストは 紙で 受けます。アンケートは 先生が 直接 聞きます。", "Please tell your teacher. You will take tests on paper, and your teacher will ask you the survey questions directly.") ] },
  ];
  // AI の所。同意は取らず、8番として知らせる（一律お知らせ）。使い道は例として広く書く
  const AI = {
    h: L("AI の 利用", "Use of AI"),
    lead: L("学校は、仕事や、あなたの 学習を 手伝う ために、AI を つかう ことが あります。たとえば、つぎの ような ことです。", "The school sometimes uses AI for its work and to support your learning. For example:"),
    uses: [
      L("名簿や 記録の 整理・集計", "Organizing and counting rosters and records"),
      L("お知らせや 資料を つくる・翻訳 する", "Writing and translating notices and materials"),
      L("あなたが 出した もの（作文・会話の テスト・【アルバイトの 書類】）を 読んで、先生の 仕事を 手伝う", "Reading what you submit (essays, speaking tests, 【part-time job documents】) to help teachers with their work") ],
    added: L("先生との 面談の 記録を まとめる", "Summarizing records of your meetings with teachers"), // 版2で足す行
    rules: [
      L("AI だけで、あなたの 成績・進級・進路を 決める ことは ありません。さいごは かならず 先生と 職員が 決めます。", "AI alone never decides your grades, promotion, or future path. Teachers and staff always make the final decision."),
      L("学校が つかう AI は、学校が 契約 している もの だけ です。AI の 会社は、あなたの 情報を AI の 学習に つかいません。", "The school only uses AI services it has a contract with. The AI company does not use your information to train its AI.") ],
    worry: L("しんぱいな ことが ある ときは、先生に 言って ください。", "If you are worried about anything, please tell your teacher."),
  };
  const UI = {
    login: L("ログイン", "Log in"), loginNote: L("（見本です。おすと ログイン します）", "(Preview: press to log in)"),
    title: L("学校からの 大事な お知らせ", "Important notice from the school"),
    sub: L("学校が あなたの 情報を どう あつかうか", "How the school handles your information"),
    read: L("よみました", "I have read this"),
    changed: L("まえに よんだ ときから、かわった ところが あります。色の ついた ところです。", "Something has changed since you last read this. The change is highlighted."),
    hello: L("{name} さん", "Hello, {name}"), quiz: L("テストを うける", "Take a quiz"), survey: L("アンケートに こたえる", "Answer a survey"),
    dummy: L("（見本では うごきません）", "(Not active in this preview)"),
    noticeCard: L("学校からの 大事な お知らせ", "Important notice from the school"),
    readOn: L("よみました（{d}）", "Read ({d})"), again: L("もういちど よむ", "Read again"), back: L("もどる", "Back"),
    logout: L("ログアウト", "Log out"), soon: L("じゅんびちゅう", "coming soon"),
  };
  const LANGS = [["ja", "日本語", true], ["en", "English", true], ["zh", "中文", false], ["ne", "नेपाली", false], ["my", "မြန်မာ", false], ["si", "සිංහල", false], ["bn", "বাংলা", false]];
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
  // 【…】をまだ決まっていない印つきで入れる
  function fill(node, text) {
    String(text).split(/(【[^】]*】)/).forEach(part => { if (!part) return; node.appendChild(part.startsWith("【") ? el("span", "pp-todo", part) : document.createTextNode(part)); });
    return node;
  }
  function button(text, cls, id, fn) { const b = el("button", cls, text); b.type = "button"; if (id) b.id = id; b.addEventListener("click", fn); return b; }
  function body(parent, items) {
    items.forEach(item => {
      if (Array.isArray(item)) { const ul = el("ul"); item.forEach(li => ul.appendChild(fill(el("li"), tx(li)))); parent.appendChild(ul); }
      else parent.appendChild(fill(el("p"), tx(item)));
    });
  }
  function langBar(parent) {
    const bar = el("div", "pp-langs"); bar.id = "st-langs";
    LANGS.forEach(([code, label, ready]) => {
      const b = button(ready ? label : label + "（" + tx(UI.soon) + "）", "", "lang-" + code, () => { state.lang = code; render(); });
      b.disabled = !ready; b.setAttribute("aria-pressed", String(state.lang === code)); bar.appendChild(b);
    });
    parent.appendChild(bar);
  }
  function aiBlock(parent) {
    parent.appendChild(el("h3", "", "8. " + tx(AI.h)));
    parent.appendChild(el("p", "", tx(AI.lead)));
    const ul = el("ul"); AI.uses.forEach(u => ul.appendChild(fill(el("li"), tx(u))));
    if (state.version >= 2) { const li = fill(el("li", "pp-new"), tx(AI.added)); li.id = "st-new"; ul.appendChild(li); }
    parent.appendChild(ul);
    AI.rules.forEach(r => parent.appendChild(el("p", "", tx(r))));
    parent.appendChild(el("p", "", tx(AI.worry)));
  }

  // ---------- 学生の画面 ----------
  const me = () => students.find(s => s.id === state.who);
  const nextScreen = () => hasRead(state.who) ? "home" : "gate";
  function noticeDoc(card) {
    SECTIONS.forEach(sec => { card.appendChild(el("h3", "", tx(sec.h))); body(card, sec.body); });
    aiBlock(card);
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
      card.appendChild(el("h2", "", tx(UI.title)));
      card.appendChild(el("p", "pp-muted", tx(UI.sub)));
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
