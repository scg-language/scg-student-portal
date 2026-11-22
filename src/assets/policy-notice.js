/* 学生ポータルについてのお知らせの文 — 1か所で管理（2026-11-22・11-23 に2点だけに絞った）
 * 学生の画面（index.html）と見本（policy-preview.html）が、同じこのファイルを読む。
 *
 * ・同意を取るものではなく、お知らせ。ボタンは「よみました」1つ（docs/yakusoku.md 4-2）
 * ・{ja,en} の組。無い言語は日本語に落ちる。訳は docs/yakusoku.md 4-2 の決まりで足す
 * ・ready が false の間、学生の画面はお知らせを出さずにホームへ進む。きあが文を確かめてから true にする
 *   （【　】＝まだ決まっていない所、が1つでも残っている間は true にしない。検査が見張る）
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
    // body の中身：文字の組＝段落／配列＝箇条書き
    // ★入れるのは2点だけ（2026-11-23 きあ）：情報を保存する場所（日本の外のサーバー）と、AI の利用。
    //   これは学生ポータルについてのお知らせで、個人情報の取り扱い全体の同意書ではない（そちらは入学前の契約の話）
    sections: [
      { id: "s1", h: L("1. 情報を 保存 する 場所", "1. Where information is stored"), body: [
        L("学校は、インターネットの サービスを つかって、あなたの 情報を 保存 しています。", "The school stores your information using internet services."),
        L("これらの サービスでは、情報が 日本の 外に ある コンピューターに 保存される ことが あります。", "With these services, information may be stored on computers outside Japan."),
        L("学校は、サービスの 会社と 契約を して、情報を 安全に あつかう ことを 決めて います。", "The school has contracts with these companies that set out how to handle information safely.") ] },
      // AI は同意を取らず、ここで広く知らせる。使い道は例として書く
      { id: "s2", h: L("2. AI の 利用", "2. Use of AI"), body: [
        L("学校は、仕事や、あなたの 学習を 手伝う ために、AI を つかう ことが あります。たとえば、つぎの ような ことです。", "The school sometimes uses AI for its work and to support your learning. For example:"),
        [ L("名簿や 記録の 整理・集計", "Organizing and counting rosters and records"),
          L("あなたが 出した もの（作文・会話の テスト など）を 読んで、先生の 仕事を 手伝う", "Reading what you submit (such as essays and speaking tests) to help teachers with their work"),
          L("手続きの 書類や 証明書を つくる ときの 手伝い", "Helping to prepare procedure documents and certificates") ],
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
  /* parent の中に文を描く。lang＝言語のコード。opts.extra＝{ s2: {ja,en} } のように、その節の箇条書きの最後に足す行（見本が版2を見せるときだけ使う） */
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
