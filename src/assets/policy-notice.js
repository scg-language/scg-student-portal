/* 学生ポータルについてのお知らせの文 — 1か所で管理（2026-11-22・11-23 に2点だけに絞った）
 * 学生の画面（index.html）と見本（policy-preview.html）が、同じこのファイルを読む。
 *
 * ・同意を取るものではなく、お知らせ。ボタンは「よみました」1つ（docs/yakusoku.md 4-2）
 * ・入れるのは2点だけ：情報を保存する場所（日本の外のサーバー）と、AI の利用。節を足さない
 *   （学生ポータルについてのお知らせで、個人情報の取り扱い全体の同意書ではない。そちらは入学前の契約の話）
 * ・言語はお知らせの画面だけで切り替える（ポータルのほかの画面は日本語か英語のまま）。
 *   下の T に訳が入っている言語だけが、言語えらびに出る。無い言語は日本語に落ちる
 * ・訳は docs/yakusoku.md 4-2 の決まりで作る（Sonnet が訳す → Opus が直す → Fable が確かめる）
 * ・ready が false の間、学生の画面はお知らせを出さずにホームへ進む。きあが文を確かめてから true にする
 *   （【　】＝まだ決まっていない所、が1つでも残っている間は true にしない。検査が見張る）
 * ・version は DB の notice_versions のいまの版と同じ数にする。
 *   文の意味を変えたら：ここを直して version を上げる → 画面を先に出す → DB に次の版を足す。誤字の直しでは上げない
 * ・言語を足すとき：LANGS と T の両方。DB 側は notice_acks_lang_check と ack_notice の中の一覧
 */
(function () {
  "use strict";
  const LANGS = [["ja", "日本語"], ["en", "English"], ["zh", "中文"], ["ne", "नेपाली"], ["my", "မြန်မာ"], ["si", "සිංහල"], ["bn", "বাংলা"], ["vi", "Tiếng Việt"], ["uz", "Oʻzbekcha"]];
  // T:BEGIN（キーごとに、言語のコード→文。1キー1行）
  const T = {
    title: {"ja": "学校からの 大事な お知らせ", "en": "Important notice from the school"},
    s1_h: {"ja": "1. 情報を 保存 する 場所", "en": "1. Where information is stored"},
    s1_p1: {"ja": "学校は、インターネットの サービスを つかって、あなたの 情報を 保存 しています。", "en": "The school stores your information using internet services."},
    s1_p2: {"ja": "これらの サービスでは、情報が 日本の 外に ある コンピューターに 保存される ことが あります。", "en": "With these services, information may be stored on computers outside Japan."},
    s1_p3: {"ja": "学校は、サービスの 会社と 契約を して、情報を 安全に あつかう ことを 決めて います。", "en": "The school has contracts with these companies that set out how to handle information safely."},
    s2_h: {"ja": "2. AI の 利用", "en": "2. Use of AI"},
    s2_lead: {"ja": "学校は、仕事や、あなたの 学習を 手伝う ために、AI を つかう ことが あります。たとえば、つぎの ような ことです。", "en": "The school sometimes uses AI for its work and to support your learning. For example:"},
    s2_use1: {"ja": "名簿や 記録の 整理・集計", "en": "Organizing and counting rosters and records"},
    s2_use2: {"ja": "あなたが 出した もの（作文・会話の テスト など）を 読んで、先生の 仕事を 手伝う", "en": "Reading what you submit (such as essays and speaking tests) to help teachers with their work"},
    s2_use3: {"ja": "手続きの 書類や 証明書を つくる ときの 手伝い", "en": "Helping to prepare procedure documents and certificates"},
    s2_rule1: {"ja": "AI だけで、あなたの 成績・進級・進路を 決める ことは ありません。さいごは かならず 先生と 職員が 決めます。", "en": "AI alone never decides your grades, promotion, or future path. Teachers and staff always make the final decision."},
    s2_rule2: {"ja": "学校が つかう AI は、学校が 契約 している もの だけ です。AI の 会社は、あなたの 情報を AI の 学習に つかいません。", "en": "The school only uses AI services it has a contract with. The AI company does not use your information to train its AI."},
    s2_worry: {"ja": "しんぱいな ことが ある ときは、先生に 言って ください。", "en": "If you are worried about anything, please tell your teacher."},
    ui_read: {"ja": "よみました", "en": "I have read this"},
    ui_busy: {"ja": "おくっています…", "en": "Sending…"},
    ui_changed: {"ja": "まえに よんだ ときから、かわった ところが あります。もういちど よんで ください。", "en": "Something has changed since you last read this. Please read it again."},
    ui_readon: {"ja": "✓ よみました（{d}）", "en": "✓ Read ({d})"},
    ui_err_reload: {"ja": "お知らせが あたらしく なりました。ページを よみこみなおして ください。", "en": "The notice has been updated. Please reload the page."},
    ui_err_other: {"ja": "おくれませんでした。もういちど おして ください。", "en": "Could not send. Please press again."},
    ui_back: {"ja": "もどる", "en": "Back"},
    ui_logout: {"ja": "ログアウト", "en": "Log out"},
  };
  // T:END
  const NOTICE = {
    key: "student_privacy",
    version: 1,
    ready: false,
    title: T.title,
    // body の中身：文字の組＝段落／配列＝箇条書き
    sections: [
      { id: "s1", h: T.s1_h, body: [T.s1_p1, T.s1_p2, T.s1_p3] },
      // AI は同意を取らず、ここで広く知らせる。使い道は例として書く
      { id: "s2", h: T.s2_h, body: [T.s2_lead, [T.s2_use1, T.s2_use2, T.s2_use3], T.s2_rule1, T.s2_rule2, T.s2_worry] },
    ],
    // お知らせの画面のボタンと知らせ（ポータルの言語ではなく、お知らせの言語で出す）
    ui: { read: T.ui_read, busy: T.ui_busy, changed: T.ui_changed, readon: T.ui_readon,
          errReload: T.ui_err_reload, errOther: T.ui_err_other, back: T.ui_back, logout: T.ui_logout },
  };
  /* その言語の訳が入っているか（題名で見る） */
  NOTICE.has = code => Boolean(T.title[code]);
  /* 言語えらびに出す言語＝訳が入っているものだけ。[[コード, その言語での名前], …] */
  NOTICE.langs = () => LANGS.filter(l => NOTICE.has(l[0]));
  /* 文字の組から、その言語の文を取る。無ければ日本語 */
  NOTICE.tx = (o, lang) => o[lang] || o.ja;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // 【…】に、まだ決まっていない印を付けて入れる。文字は必ず textContent／createTextNode で入れる
  function fill(node, text) {
    String(text).split(/(【[^】]*】)/).forEach(part => { if (!part) return; node.appendChild(part.charAt(0) === "【" ? el("span", "pn-todo", part) : document.createTextNode(part)); });
    return node;
  }
  /* parent の中に文を描く。lang＝言語のコード。opts.extra＝{ s2: {ja,en} } のように、その節の箇条書きの最後に足す行（見本が版2を見せるときだけ使う） */
  NOTICE.render = function (parent, lang, opts) {
    const tx = o => NOTICE.tx(o, lang), extra = (opts && opts.extra) || {};
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
    return Object.keys(T).some(k => Object.keys(T[k]).some(c => /【/.test(T[k][c])));
  };
  /* 訳の抜けを数える（検査用）。{ 言語のコード: 抜けているキーの数 } */
  NOTICE.missing = function () {
    const out = {};
    NOTICE.langs().forEach(l => { const n = Object.keys(T).filter(k => !T[k][l[0]]).length; if (n) out[l[0]] = n; });
    return out;
  };
  window.POLICY_NOTICE = NOTICE;
})();
