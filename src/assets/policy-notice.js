/* はじめのお知らせ（個人情報のあつかい）の文 — 1か所で管理（2026-11-22）
 * 学生の画面（index.html）と見本（policy-preview.html）が、同じこのファイルを読む。
 *
 * ・同意を取るものではなく、お知らせ。ボタンは「よみました」1つ（docs/yakusoku.md 4-2）
 * ・{ja,en} の組。無い言語は日本語に落ちる。訳は docs/yakusoku.md 4-2 の決まりで足す
 * ・【　】はまだ決まっていない所。🔴 【　】が1つでも残っている間は ready を true にしない
 *   （ready が false の間、学生の画面はお知らせを出さずにホームへ進む。検査が見張る）
 * ・version は DB の notice_versions のいまの版と同じ数にする。
 *   文の意味を変えたら：ここを直して version を上げる → 画面を先に出す → DB に次の版を足す。誤字の直しでは上げない
 */
(function () {
  "use strict";
  const L = (ja, en) => ({ ja, en });
  const NOTICE = {
    key: "student_privacy",
    version: 1,
    ready: false,
    title: L("学校からの 大事な お知らせ", "Important notice from the school"),
    sub: L("学校が あなたの 情報を どう あつかうか", "How the school handles your information"),
    // body の中身：文字の組＝段落／配列＝箇条書き
    sections: [
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
      // AI は同意を取らず、ここで広く知らせる。使い道は例として書く
      { id: "s8", h: L("8. AI の 利用", "8. Use of AI"), body: [
        L("学校は、仕事や、あなたの 学習を 手伝う ために、AI を つかう ことが あります。たとえば、つぎの ような ことです。", "The school sometimes uses AI for its work and to support your learning. For example:"),
        [ L("名簿や 記録の 整理・集計", "Organizing and counting rosters and records"),
          L("お知らせや 資料を つくる・翻訳 する", "Writing and translating notices and materials"),
          L("あなたが 出した もの（作文・会話の テスト・【アルバイトの 書類】）を 読んで、先生の 仕事を 手伝う", "Reading what you submit (essays, speaking tests, 【part-time job documents】) to help teachers with their work") ],
        L("AI だけで、あなたの 成績・進級・進路を 決める ことは ありません。さいごは かならず 先生と 職員が 決めます。", "AI alone never decides your grades, promotion, or future path. Teachers and staff always make the final decision."),
        L("学校が つかう AI は、学校が 契約 している もの だけ です。AI の 会社は、あなたの 情報を AI の 学習に つかいません。", "The school only uses AI services it has a contract with. The AI company does not use your information to train its AI."),
        L("しんぱいな ことが ある ときは、先生に 言って ください。", "If you are worried about anything, please tell your teacher.") ] },
    ],
  };

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // 【…】に、まだ決まっていない印を付けて入れる。文字は必ず textContent／createTextNode で入れる
  function fill(node, text) {
    String(text).split(/(【[^】]*】)/).forEach(part => { if (!part) return; node.appendChild(part.charAt(0) === "【" ? el("span", "pn-todo", part) : document.createTextNode(part)); });
    return node;
  }
  /* parent の中に文を描く。lang＝言語のコード。opts.extra＝{ s8: {ja,en} } のように、その節の箇条書きの最後に足す行（見本が版2を見せるときだけ使う） */
  NOTICE.render = function (parent, lang, opts) {
    const tx = o => o[lang] || o.ja, extra = (opts && opts.extra) || {};
    NOTICE.sections.forEach(sec => {
      const h = el("h3", "pn-h", tx(sec.h)); h.dataset.sec = sec.id; parent.appendChild(h);
      let added = false;
      sec.body.forEach(item => {
        if (Array.isArray(item)) {
          const ul = el("ul", "pn-ul"); item.forEach(li => ul.appendChild(fill(el("li"), tx(li))));
          if (extra[sec.id] && !added) { ul.appendChild(fill(el("li", "pn-new"), tx(extra[sec.id]))); added = true; }
          parent.appendChild(ul);
        } else parent.appendChild(fill(el("p", "pn-p"), tx(item)));
      });
    });
  };
  /* 文の中に【　】が残っているか（残っている間は ready にしない） */
  NOTICE.hasTodo = function () {
    const flat = [];
    NOTICE.sections.forEach(sec => { flat.push(sec.h); sec.body.forEach(item => Array.isArray(item) ? item.forEach(x => flat.push(x)) : flat.push(item)); });
    return flat.some(o => Object.keys(o).some(k => /【/.test(o[k])));
  };
  window.POLICY_NOTICE = NOTICE;
})();
