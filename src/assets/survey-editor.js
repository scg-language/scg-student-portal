/* アンケートの編集フォーム（master.html「アンケートを 作る」）— 2026-11-18
 *
 * できること: 名前・説明・前置き・色／質問（1つ選ぶ・いくつでも・書いて答える・日付）／選択肢／必須／
 *            結果で目立たせる理由（flag）。右に学生の画面での見え方がその場で出る。
 * 保存は「下書き」（save_survey_def）。公開は保存のあと一覧の「公開する」で押す。
 *
 * ★作れる形は surveys.js の簡単な定義と同じ（区切り sections・出し分け showWhen・排他 exclusive は扱わない）。
 *   それらを使っているコードの定義は複製できない（落とすと別のアンケートになるため）＝canCopy() が断る。
 * ★保存する値（質問の k・選択肢の v）は自動で付ける（q1, q2 … / o1, o2 …）。一度付けた値は動かさない
 *   （並べ替えても同じ値のまま）。回をはじめたら定義そのものが直せなくなるので、意味が変わる心配はない。
 * 🔴 職員が書いた文字は value / textContent でしか入れない（innerHTML に入れない）
 *
 * 依存: SurveyForm（assets/survey-form.js）, SurveyDB（assets/survey-db.js） */
(function () {
  "use strict";
  const COLORS = ["#2f9e44", "#7b5cd6", "#1769aa", "#e8590c", "#c2255c", "#0c8599", "#5c677d"];
  const TYPES = [["select", "1つ選ぶ"], ["multi", "いくつでも 選ぶ"], ["text", "書いて答える"], ["date", "日付"]];
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const byId = id => document.getElementById(id);
  const txt = v => (v == null ? "" : String(v));

  /* surveys.js の簡単な形か（複製してよいか）。理由の文字を返す。null なら複製できる */
  function copyProblem(def) {
    if (!def) return "定義が見つかりません";
    if (def.sections || def.schemaVersion || def.studentIdentity) return "区切り（ページ）や本人情報の欄を使っているので、画面では複製できません";
    for (const q of def.q || []) {
      if (q.showWhen || q.exclusive || q.exclusiveGroups) return "出し分けや「一緒に選べない」を使っているので、画面では複製できません";
      if (!["select", "multi", "text", "date"].includes(q.t)) return "画面で扱えない質問の形があります";
    }
    return null;
  }
  const lang2 = o => ({ ja: txt(o && o.ja), en: txt(o && o.en) });
  /* 定義 → 編集用の形（足りないものを埋める） */
  function toModel(def) {
    const d = def || {};
    return {
      title: lang2(d.title), desc: lang2(d.desc),
      intro: { ja: txt(d.intro && d.intro.ja).replace(/<br\s*\/?>/gi, "\n"), en: txt(d.intro && d.intro.en).replace(/<br\s*\/?>/gi, "\n") },
      sb: txt(d.sb) || "Survey", color: COLORS.includes(d.color) ? d.color : COLORS[2],
      q: (d.q || []).map(q => ({
        k: q.k, t: q.t, l: lang2(q.l), sl: txt(q.sl), required: !!q.required, ph: lang2(q.ph),
        o: (q.o || []).map(o => ({ v: o.v, ja: txt(o.ja), en: txt(o.en), flag: txt(o.flag) })),
      })),
    };
  }
  /* 編集用の形 → 保存する定義（空の言語・空の項目は落とす） */
  function toDef(m) {
    const L = o => { const r = {}; if (o.ja.trim()) r.ja = o.ja.trim(); if (o.en.trim()) r.en = o.en.trim(); return r; };
    const def = { title: L(m.title), sb: m.sb.trim() || "Survey", color: m.color, q: [] };
    const desc = L(m.desc); if (Object.keys(desc).length) def.desc = desc;
    const intro = L(m.intro); if (Object.keys(intro).length) def.intro = intro;
    m.q.forEach(q => {
      const o = { k: q.k, t: q.t, l: L(q.l) };
      if (q.sl.trim()) o.sl = q.sl.trim();
      if (q.required) o.required = true;
      if (q.t === "text") { const ph = L(q.ph); if (Object.keys(ph).length) o.ph = ph; }
      if (q.t === "select" || q.t === "multi") {
        o.o = q.o.filter(x => x.ja.trim() || x.en.trim()).map(x => {
          const r = { v: x.v, ja: x.ja.trim() || x.en.trim() };
          if (x.en.trim()) r.en = x.en.trim();
          if (x.flag.trim()) r.flag = x.flag.trim();
          return r;
        });
      }
      def.q.push(o);
    });
    return def;
  }
  /* サーバーの app_hidden.survey_def_problem と同じ検査（押す前に分かるように）。全部の問題を返す */
  function problems(def) {
    const out = [];
    if (!(def.title.ja || "").trim()) out.push("アンケートの名前（日本語）を入れてください");
    if (!def.q.length) out.push("質問を1つ以上 足してください");
    def.q.forEach((q, i) => {
      const n = (i + 1) + "問目";
      if (!(q.l.ja || "").trim()) out.push(n + "：質問文（日本語）が空です");
      if ((q.t === "select" || q.t === "multi") && (q.o || []).length < 2) out.push(n + "：選択肢を2つ以上 入れてください");
    });
    if (def.q.length > 200) out.push("質問は200問までです");
    return out;
  }
  const nextNo = (list, prefix, field) => {
    let n = 0; list.forEach(x => { const m = new RegExp("^" + prefix + "(\\d+)$").exec(x[field] || ""); if (m) n = Math.max(n, +m[1]); });
    return prefix + (n + 1);
  };
  const newOpt = q => ({ v: nextNo(q.o, "o", "v"), ja: "", en: "", flag: "" });
  function newQ(m) { const q = { k: nextNo(m.q, "q", "k"), t: "select", l: { ja: "", en: "" }, sl: "", required: false, ph: { ja: "", en: "" }, o: [] }; q.o.push(newOpt(q)); q.o.push(newOpt(q)); return q; }

  /* ── 画面 ── */
  let E = null;   // { key, m, lang, onDone, timer }
  function open(opts) {
    E = { key: opts.key || null, m: toModel(opts.def), lang: "ja", onDone: opts.onDone || (() => {}), heading: opts.heading || "アンケートを 作る", timer: 0 };
    if (!E.m.q.length) E.m.q.push(newQ(E.m));
    document.querySelectorAll("[data-ed-lang]").forEach(b => {
      b.classList.toggle("on", b.dataset.edLang === "ja");
      b.onclick = () => { E.lang = b.dataset.edLang; document.querySelectorAll("[data-ed-lang]").forEach(x => x.classList.toggle("on", x === b)); preview(); };
    });
    render();
  }
  function changed() { clearTimeout(E.timer); E.timer = setTimeout(preview, 150); }
  function preview() {
    const box = byId("ed-preview");
    try {
      const def = Object.assign({ key: "preview" }, toDef(E.m));
      if (!def.title.ja) def.title.ja = "（名前）";
      def.q = def.q.map(q => Object.assign({}, q, { l: q.l.ja ? q.l : Object.assign({ ja: "（質問文）" }, q.l), o: q.o && q.o.length ? q.o : q.o }));
      SurveyForm.mount(box, def, { lang: E.lang, profile: { student_no: "2604999", display_name: "テスト太郎", class_name: "A①クラス" } });
    } catch (e) { box.textContent = "見本を出せませんでした（" + e.message + "）"; }
  }
  function input(label, get, set, opts) {
    const o = opts || {}, f = mk("label", "fld"), sp = mk("span", null, label);
    if (o.req) sp.appendChild(mk("span", "rq", "必須"));
    f.appendChild(sp);
    const el = mk(o.area ? "textarea" : "input");
    if (!o.area) el.type = "text";
    el.value = get(); if (o.ph) el.placeholder = o.ph; if (o.max) el.maxLength = o.max;
    el.addEventListener("input", () => { set(el.value); changed(); });
    f.appendChild(el);
    return f;
  }
  function pair(label, obj, opts) {
    const row = mk("div", "two");
    row.appendChild(input(label + "（日本語）", () => obj.ja, v => { obj.ja = v; }, Object.assign({}, opts, { req: opts && opts.req })));
    row.appendChild(input(label + "（English）", () => obj.en, v => { obj.en = v; }, Object.assign({}, opts, { req: false, ph: "" })));
    return row;
  }
  function smallBtn(text, fn, title) { const b = mk("button", "abtn sm", text); b.type = "button"; if (title) b.title = title; b.onclick = fn; return b; }
  function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  function render() {
    const form = byId("ed-form"), m = E.m;
    form.replaceChildren();
    form.appendChild(mk("h2", null, E.heading));
    form.appendChild(mk("h3", null, "1. アンケートの名前と説明"));
    form.appendChild(pair("学生に見せる名前", m.title, { req: true, ph: "れい：12月の せいかつ アンケート", max: 80 }));
    form.appendChild(pair("一覧での説明（短く）", m.desc, { ph: "れい：すまい・アルバイト", max: 80 }));
    form.appendChild(pair("回答の前の ひとこと", m.intro, { area: true, ph: "れい：いまの ことを おしえてください。" }));
    const look = mk("div", "two");
    look.appendChild(input("一覧の小見出し（英語・短く）", () => m.sb, v => { m.sb = v; }, { ph: "Survey", max: 20 }));
    const cf = mk("div", "fld"); cf.appendChild(mk("span", null, "色"));
    const sw = mk("div", "swatches");
    COLORS.forEach(c => {
      const b = mk("button", "swatch" + (m.color === c ? " on" : "")); b.type = "button"; b.style.background = c; b.setAttribute("aria-label", "色 " + c);
      b.onclick = () => { m.color = c; sw.querySelectorAll(".swatch").forEach(x => x.classList.toggle("on", x === b)); changed(); };
      sw.appendChild(b);
    });
    cf.appendChild(sw); look.appendChild(cf); form.appendChild(look);

    form.appendChild(mk("h3", null, "2. 質問"));
    m.q.forEach((q, i) => form.appendChild(qCard(q, i)));
    const add = mk("div", "acts");
    add.appendChild(smallBtn("＋ 質問を 足す", () => { m.q.push(newQ(m)); render(); }));
    form.appendChild(add);

    const foot = mk("div", "foot");
    const save = mk("button", "abtn pri", E.key ? "保存する（下書きのまま）" : "下書きとして 保存する"); save.type = "button"; save.id = "ed-save";
    save.onclick = doSave;
    const cancel = mk("button", "abtn", "やめる"); cancel.type = "button"; cancel.id = "ed-cancel";
    cancel.onclick = () => E.onDone(null);
    foot.append(save, cancel, mk("span", "muted", "保存しても、まだ学生には出ません。一覧で「公開する」→「回を はじめる」で出ます。"));
    form.appendChild(foot);
    const errs = mk("ul", "errs"); errs.id = "ed-errs"; errs.hidden = true; form.appendChild(errs);
    preview();
  }
  function qCard(q, i) {
    const m = E.m, c = mk("div", "qcard");
    const hd = mk("div", "qhead");
    hd.appendChild(mk("span", "no", (i + 1) + "問目"));
    const ty = mk("select"); ty.setAttribute("aria-label", "答え方");
    TYPES.forEach(([v, l]) => { const o = mk("option", null, l); o.value = v; ty.appendChild(o); });
    ty.value = q.t;
    ty.onchange = () => { q.t = ty.value; if ((q.t === "select" || q.t === "multi") && q.o.length < 2) { while (q.o.length < 2) q.o.push(newOpt(q)); } render(); };
    hd.appendChild(ty);
    const rq = mk("label", "chk"); const cb = mk("input"); cb.type = "checkbox"; cb.checked = q.required;
    cb.onchange = () => { q.required = cb.checked; changed(); }; rq.append(cb, document.createTextNode("必須"));
    hd.appendChild(rq);
    hd.appendChild(mk("span", "sp"));
    hd.appendChild(smallBtn("↑", () => { move(m.q, i, -1); render(); }, "上へ"));
    hd.appendChild(smallBtn("↓", () => { move(m.q, i, 1); render(); }, "下へ"));
    hd.appendChild(smallBtn("消す", () => { m.q.splice(i, 1); render(); }));
    c.appendChild(hd);
    c.appendChild(pair("質問文", q.l, { req: true, area: true, ph: "れい：いま どこに すんでいますか" }));
    c.appendChild(input("先生の画面での短い名前（任意）", () => q.sl, v => { q.sl = v; }, { ph: "れい：すまい", max: 30 }));
    if (q.t === "text") c.appendChild(pair("入力の れい（任意）", q.ph, { ph: "れい：東京、大阪" }));
    if (q.t === "select" || q.t === "multi") {
      const hdr = mk("div", "orow");
      ["選択肢（日本語）", "English", "結果で目立たせる理由（任意）", ""].forEach(s => hdr.appendChild(mk("span", "ohd", s)));
      c.appendChild(hdr);
      q.o.forEach((o, j) => {
        const r = mk("div", "orow");
        [["ja", "れい：がっこうの りょう"], ["en", "e.g. School dormitory"], ["flag", "れい：学費が心配"]].forEach(([k, ph]) => {
          const el = mk("input"); el.type = "text"; el.value = o[k]; el.placeholder = ph; el.maxLength = k === "flag" ? 20 : 80;
          el.setAttribute("aria-label", (j + 1) + "つ目の選択肢 " + k);
          el.addEventListener("input", () => { o[k] = el.value; changed(); });
          r.appendChild(el);
        });
        const a = mk("span", "acts"); a.style.marginTop = "0";
        a.append(smallBtn("↑", () => { move(q.o, j, -1); render(); }, "上へ"), smallBtn("↓", () => { move(q.o, j, 1); render(); }, "下へ"),
                 smallBtn("×", () => { q.o.splice(j, 1); render(); }, "この選択肢を消す"));
        r.appendChild(a);
        c.appendChild(r);
      });
      const add = mk("div", "acts"); add.appendChild(smallBtn("＋ 選択肢を 足す", () => { q.o.push(newOpt(q)); render(); })); c.appendChild(add);
    }
    return c;
  }
  async function doSave() {
    const def = toDef(E.m), errs = byId("ed-errs"), list = problems(def);
    errs.replaceChildren();
    if (list.length) { list.forEach(s => errs.appendChild(mk("li", null, s))); errs.hidden = false; return; }
    errs.hidden = true;
    const btn = byId("ed-save"); btn.disabled = true; const label = btn.textContent; btn.textContent = "保存しています…";
    try {
      const r = await SurveyDB.save(E.key, def);
      E.onDone(r && r.survey_key);
    } catch (e) {
      errs.appendChild(mk("li", null, "保存できませんでした：" + e.message)); errs.hidden = false;
      btn.disabled = false; btn.textContent = label;
    }
  }

  window.SurveyEditor = { open, copyProblem, _toModel: toModel, _toDef: toDef, _problems: problems };
})();
