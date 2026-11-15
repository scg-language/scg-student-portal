/* 管理画面（master.html）の新しい画面 — 2026-11-16
 * デザイン案＝Claude のキャンバス「学生ポータル 画面デザイン」管理①〜⑥。見た目は assets/admin.css。
 *
 * ここに置いたもの（master.html を膨らませないために分けた）:
 *   Admin.today   … 今日：あいさつ・実施中の大きなカード・対応すること・近い締切
 *   Admin.survey  … アンケート結果：回のチップ・提出/未提出/面談候補・集計／一人ずつ／未提出／面談候補・CSV
 *   Admin.quiz    … 小テスト：再テストの対象（正答率の線）
 *   Admin.build   … アンケートを作る：定義を読む・学生の画面での見え方・回をはじめる（書き換えはしない）
 *   Admin.students… 学生：一覧・しぼり込み・右からの詳細（小テストの推移・アンケート）
 *   Admin.notice  … お知らせ（画面イメージ。宛先の人数だけ本物）
 *
 * master.html の中の関数・変数（api, $, askDialog, openSurveyRoundDialog, setView, svKey, quizSet,
 * renderSurveyRounds, downloadCsv, fetchClassNames）を使う。読むのは master.html の本体スクリプトより前だが、
 * ここの関数が呼ばれるのはログイン後（start() の中）なので、そのときには揃っている。
 *
 * 🔴 守ること
 *   - 文字は h()（< > & " ' を全部エスケープ）を通してから HTML に入れる。学生が書いた答え・名前が入るため
 *   - 小テストの「画面を離れた記録」は個人別に出さない（tests/test_integrity.py の方針）。ここでは一切読まない
 *   - 点数は「◯問中◯問」と「正答率％」で言う。配点で採点しない（CLAUDE.md の決まり）
 *   - 作り話の数字は置かない。仕組みが無いもの（出席・再発行の依頼・お知らせの既読）は出さない */
(function () {
  "use strict";
  const h = s => (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const byId = id => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const md = iso => { const d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate(); };
  const mdhm = iso => { const d = new Date(iso); return md(iso) + " " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const daysLeft = iso => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  const isLive = r => !r.is_void && (!r.closes_at || new Date(r.closes_at).getTime() > Date.now());
  const defOf = key => SURVEYS.find(s => s.key === key) || null;
  const ansText = (q, v) => (v == null || v === "" || (Array.isArray(v) && !v.length)) ? "" : (Array.isArray(v) ? v.map(x => optLabel(q, x)).join("、") : optLabel(q, v));
  const TYPE_JA = { select: "1つ選ぶ", multi: "いくつでも", text: "書いて答える", date: "日付" };

  /* 学生の名簿（role=student）。1分だけ使い回す */
  let stuCache = null, stuAt = 0;
  async function students() {
    if (stuCache && Date.now() - stuAt < 60000) return stuCache;
    stuCache = await api.get("/rest/v1/profiles?select=id,student_no,display_name,class_name&role=eq.student&order=student_no");
    stuAt = Date.now();
    return stuCache;
  }
  /* 回の対象＝class_names と student_ids（どちらも空なら全員）。★サーバーの run_target_count と同じ考え方 */
  function targetsOf(round, all) {
    const cls = round.class_names || [], ids = round.student_ids || [];
    if (!cls.length && !ids.length) return all;
    return all.filter(s => cls.includes(s.class_name) || ids.includes(s.id));
  }
  /* 目立たせる答え（surveys.js の選択肢の flag）。理由の札の文字を返す */
  function flagsOf(def, answers) {
    const out = [];
    (def && def.q || []).forEach(q => {
      if (!q.o) return;
      const v = (answers || {})[q.k], vals = Array.isArray(v) ? v : (v == null ? [] : [v]);
      vals.forEach(x => { const o = q.o.find(o => o.v === x); if (o && o.flag && !out.includes(o.flag)) out.push(o.flag); });
    });
    return out;
  }
  function qFlagged(q, v) {
    if (!q.o) return false;
    const vals = Array.isArray(v) ? v : (v == null ? [] : [v]);
    return vals.some(x => { const o = q.o.find(o => o.v === x); return o && o.flag; });
  }
  function copyText(text, btn) {
    const done = () => { if (btn) { const t = btn.textContent; btn.textContent = "コピーしました"; setTimeout(() => { btn.textContent = t; }, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const ta = mk("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) {} ta.remove(); }
  }
  function showMsg(id, text, ng) { const m = byId(id); if (!m) return; m.style.display = "block"; m.textContent = text; m.className = "msg" + (ng ? " err" : " info"); }

  /* ── 右から出る詳細（1つだけ。中身は毎回 build(body) で組み立てる） ── */
  const drawer = (() => {
    let root = null, back = null;
    function ensure() {
      if (root) return;
      root = mk("div", "drawer"); root.hidden = true;
      root.innerHTML = '<div class="dp" role="dialog" aria-modal="true" aria-labelledby="dr-t" tabindex="-1">'
        + '<div class="dh"><div class="dt"><h2 id="dr-t"></h2><div class="ds"></div></div>'
        + '<button class="abtn sm noprint" type="button" data-print>印刷</button>'
        + '<button class="x" type="button" aria-label="とじる">×</button></div><div class="db"></div></div>';
      document.body.appendChild(root);
      root.addEventListener("click", e => {
        if (e.target === root || e.target.closest(".x")) close();
        else if (e.target.closest("[data-print]")) window.print();
      });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && root && !root.hidden) close(); });
    }
    function open(title, sub, build) {
      ensure(); back = document.activeElement;
      root.querySelector("h2").textContent = title;
      root.querySelector(".ds").textContent = sub || "";
      const b = root.querySelector(".db"); b.replaceChildren(); build(b);
      root.hidden = false;
      requestAnimationFrame(() => { root.classList.add("on"); root.querySelector(".dp").focus(); });
    }
    function close() {
      if (!root || root.hidden) return;
      root.classList.remove("on");
      setTimeout(() => { root.hidden = true; }, 220);
      if (back && back.focus) back.focus();
    }
    return { open, close };
  })();

  /* 1人のアンケートの答えを全部（気になる答えはオレンジ・前の回の答えも並べる） */
  function answerRows(body, def, answers, prevAnswers) {
    let sec = null;
    (def.q || []).forEach(q => {
      if (!Object.prototype.hasOwnProperty.call(answers || {}, q.k)) return;
      if (q.section && q.section !== sec) {
        sec = q.section;
        const s = (def.sections || []).find(x => x.key === sec);
        if (s) body.appendChild(mk("div", "dsec", s.title.ja));
      }
      const v = answers[q.k], row = mk("div", "arow" + (qFlagged(q, v) ? " flag" : ""));
      row.appendChild(mk("div", "q", q.sl || (q.l && q.l.ja) || q.k));
      row.appendChild(mk("div", "a", ansText(q, v) || "（なし）"));
      if (prevAnswers && Object.prototype.hasOwnProperty.call(prevAnswers, q.k)) {
        const pv = ansText(q, prevAnswers[q.k]), same = JSON.stringify(prevAnswers[q.k]) === JSON.stringify(v);
        row.appendChild(mk("div", "pv" + (same ? "" : " chg"), (same ? "前の回と同じ" : "前の回：" + (pv || "（なし）"))));
      }
      body.appendChild(row);
    });
  }

  /* ════════ アンケート結果（管理①） ════════ */
  const S = { key: null, rounds: [], rid: null, resp: [], prevRound: null, prevResp: [], all: [], tab: "sum", cls: "", compare: false, loadedAt: 0, busy: false };
  const sdef = () => defOf(S.key) || SURVEYS[0];
  const curRound = () => S.rounds.find(r => r.id === S.rid) || null;
  const respQ = rid => "/rest/v1/survey_responses?select=student_id,answers,submitted_at,profiles(student_no,display_name,class_name)&round_id=eq." + rid + "&order=submitted_at.desc";

  async function svLoadResp() {
    S.resp = []; S.prevResp = []; S.prevRound = null;
    if (!S.rid) return;
    S.resp = await api.get(respQ(S.rid));
    const i = S.rounds.findIndex(r => r.id === S.rid);
    S.prevRound = S.rounds.slice(i + 1).find(r => !r.is_void) || null;   // 同じアンケートの1つ前の回（取り消しは飛ばす）
    if (S.prevRound) { try { S.prevResp = await api.get(respQ(S.prevRound.id)); } catch (e) { S.prevResp = []; } }
  }
  async function svReload() {
    if (S.busy) return;
    S.busy = true;
    try {
      if (!S.key) S.key = (typeof svKey !== "undefined" && svKey) || SURVEYS[0].key;
      S.all = await students();
      S.rounds = await api.get("/rest/v1/survey_rounds?select=id,title,class_names,student_ids,opens_at,closes_at,is_void"
        + "&survey_key=eq." + encodeURIComponent(S.key) + "&order=opens_at.desc&limit=30");
      if (!S.rounds.find(r => r.id === S.rid)) {
        // 既定は「受付中で締切のある回」→「受付中」→「取り消していない回」→ 先頭
        const pick = S.rounds.find(r => isLive(r) && r.closes_at) || S.rounds.find(isLive) || S.rounds.find(r => !r.is_void) || S.rounds[0];
        S.rid = pick ? pick.id : null;
      }
      await svLoadResp();
      S.loadedAt = Date.now();
      svRender();
    } catch (e) {
      showMsg("sv-msg", "読み込みに失敗しました（" + e.message + "）", true);
    } finally { S.busy = false; }
  }
  function svScope() {
    const r = curRound(), def = sdef();
    let targets = r ? targetsOf(r, S.all) : [];
    let resp = S.resp;
    if (S.cls) { targets = targets.filter(s => s.class_name === S.cls); resp = resp.filter(x => (x.profiles || {}).class_name === S.cls); }
    const done = new Set(resp.map(x => x.student_id));
    const rest = targets.filter(s => !done.has(s.id));
    const flagged = resp.map(x => ({ x, f: flagsOf(def, x.answers) })).filter(o => o.f.length);
    return { r, def, targets, resp, rest, flagged };
  }
  function svRender() {
    const sc = svScope(), { r, def, targets, resp, rest, flagged } = sc;
    // 回のチップ
    const chips = byId("sv-chips"); chips.replaceChildren();
    if (!S.rounds.length) chips.appendChild(mk("span", "muted", "まだ回がありません。「＋ 新しい回を はじめる」から作れます。"));
    S.rounds.forEach(x => {
      const b = mk("button", "chip" + (x.is_void ? " void" : ""));
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", x.id === S.rid ? "true" : "false");
      if (isLive(x)) b.appendChild(mk("span", "dot"));
      b.appendChild(document.createTextNode((x.title || "（無題）") + (x.is_void ? "（取消）" : "")));
      b.title = x.is_void ? "取り消した回（学生には出ていません）" : (isLive(x) ? "受付中" : "終了");
      b.onclick = async () => { S.rid = x.id; await svLoadResp(); svRender(); };
      chips.appendChild(b);
    });
    // クラス
    const sel = byId("sv-class"), keep = S.cls;
    const classes = [...new Set((r ? targetsOf(r, S.all) : []).map(s => s.class_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
    sel.innerHTML = '<option value="">すべてのクラス</option>' + classes.map(c => '<option value="' + h(c) + '">' + h(c) + "</option>").join("");
    sel.value = classes.includes(keep) ? keep : ""; S.cls = sel.value;
    // 数字
    byId("sv-count").textContent = resp.length;
    byId("sv-of").textContent = r ? "/ " + targets.length + "人 ・ " + pct(resp.length, targets.length) + "%" : "";
    const byCls = classes.filter(c => !S.cls || c === S.cls).map(c => {
      const t = targets.filter(s => s.class_name === c).length, d = resp.filter(x => (x.profiles || {}).class_name === c).length;
      return c.replace(/クラス$/, "") + " " + d + "/" + t;
    });
    byId("sv-bycls").textContent = byCls.join(" ・ ");
    byId("sv-rest").textContent = r ? rest.length : "–";
    byId("sv-flagn").textContent = r ? flagged.length : "–";
    if (r && r.closes_at) {
      const n = daysLeft(r.closes_at);
      byId("sv-due").textContent = md(r.closes_at);
      byId("sv-due-s").textContent = r.is_void ? "取り消した回" : (n > 0 ? "あと " + n + "日" : "締め切りました");
    } else { byId("sv-due").textContent = r ? "なし" : "–"; byId("sv-due-s").textContent = r ? "ずっと開いたまま（常設）" : ""; }
    byId("sv-tn-each").textContent = resp.length; byId("sv-tn-rest").textContent = rest.length; byId("sv-tn-flag").textContent = flagged.length;
    byId("sv-compare").disabled = !S.prevRound;
    byId("sv-compare").parentElement.title = S.prevRound ? "前の回「" + (S.prevRound.title || "") + "」の割合を細い棒で重ねます" : "前の回がありません";
    svTabs();
    svSum(sc); svEach(sc); svRest(sc); svFlag(sc);
  }
  function svTabs() {
    document.querySelectorAll("#sv-tabs .tab").forEach(t => t.setAttribute("aria-selected", t.dataset.tab === S.tab ? "true" : "false"));
    ["sum", "each", "rest", "flag"].forEach(k => { byId("sv-tab-" + k).hidden = k !== S.tab; });
  }
  function svSum(sc) {
    const box = byId("sv-tab-sum"), { def, resp } = sc;
    if (!sc.r) { box.innerHTML = '<div class="panel muted">回を選ぶと集計が出ます。</div>'; return; }
    if (!resp.length) { box.innerHTML = '<div class="panel muted">まだ提出がありません。</div>'; return; }
    const prev = S.compare ? S.prevResp.filter(x => !S.cls || (x.profiles || {}).class_name === S.cls) : null;
    const groups = [];
    (def.q || []).forEach(q => {
      const key = q.section || "";
      let g = groups.find(x => x.key === key);
      if (!g) { const s = (def.sections || []).find(x => x.key === key); g = { key, title: s ? s.title.ja : "", qs: [] }; groups.push(g); }
      g.qs.push(q);
    });
    let html = "";
    groups.forEach(g => {
      if (g.title) html += '<h2 class="secttl">' + h(g.title) + "</h2>";
      html += '<div class="qgrid">';
      g.qs.forEach(q => {
        const answered = resp.filter(x => x.answers && Object.prototype.hasOwnProperty.call(x.answers, q.k) && x.answers[q.k] !== "" && x.answers[q.k] != null);
        if (q.showWhen && !answered.length) return;   // 出し分けの質問で、答えた人がいないものは出さない（「その他」の記入欄など）
        html += '<div class="qcard"><h3>' + h(q.sl || (q.l && q.l.ja) || q.k) + '</h3><div class="qm">' + h(TYPE_JA[q.t] || q.t || "") + " ・ 答えた人 " + answered.length + "人</div>";
        if ((q.t === "select" || q.t === "multi") && q.o) {
          const pAns = prev ? prev.filter(x => x.answers && Object.prototype.hasOwnProperty.call(x.answers, q.k)) : null;
          q.o.forEach(o => {
            const has = x => { const v = x.answers[q.k]; return Array.isArray(v) ? v.includes(o.v) : v === o.v; };
            const n = answered.filter(has).length, p = pct(n, answered.length);
            const pp = pAns && pAns.length ? pct(pAns.filter(has).length, pAns.length) : null;
            html += '<div class="bar' + (o.flag ? " flag" : "") + '" title="' + h(o.ja) + (o.flag ? "（目立たせる答え：" + h(o.flag) + "）" : "") + '">'
              + '<span class="bl">' + h(o.ja) + "</span>"
              + '<span class="bt"><i style="width:' + p + '%"></i>' + (pp != null ? '<s style="width:' + pp + '%"></s>' : "") + "</span>"
              + '<span class="bn">' + n + "<small>" + p + "%" + (pp != null ? "・前" + pp + "%" : "") + "</small></span></div>";
          });
        } else {
          const cnt = new Map();
          answered.forEach(x => { const t = ansText(q, x.answers[q.k]).trim(); if (t) cnt.set(t, (cnt.get(t) || 0) + 1); });
          const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
          html += top.length ? '<div class="texts">' + top.map(([t, n]) => "<span>" + h(t) + (n > 1 ? "<b>×" + n + "</b>" : "") + "</span>").join("") + "</div>"
                             : '<div class="muted">（記入なし）</div>';
          if (cnt.size > top.length) html += '<div class="qm">ほか ' + (cnt.size - top.length) + "件（「一人ずつ」で全部見られます）</div>";
        }
        html += "</div>";
      });
      html += "</div>";
    });
    box.innerHTML = html;
  }
  /* 一覧に並べる短い列＝最初の「選ぶ」質問から6つ */
  function svCols(def) { return (def.q || []).filter(q => (q.t === "select" || q.t === "multi") && !q.showWhen).slice(0, 6); }
  function openPerson(x, def) {
    const p = x.profiles || {};
    const prev = S.prevResp.find(y => y.student_id === x.student_id);
    drawer.open(p.display_name || "（名前なし）", (p.student_no || "") + " ・ " + (p.class_name || "") + " ・ 提出 " + mdhm(x.submitted_at), body => {
      const f = flagsOf(def, x.answers);
      if (f.length) { const t = mk("div", "tags"); f.forEach(r => t.appendChild(mk("span", "tag or", r))); body.appendChild(t); }
      if (prev) body.appendChild(mk("div", "note", "前の回「" + (S.prevRound.title || "") + "」の答えも並べています（変わったところは紫）。"));
      answerRows(body, def, x.answers, prev ? prev.answers : null);
      body.appendChild(mk("div", "note", "面談ノートへ送る口は、面談ノート（scg-mendan-note）とのつなぎこみができてから足します。"));
    });
  }
  function svEach(sc) {
    const box = byId("sv-list"), { def, resp } = sc;
    if (!resp.length) { box.innerHTML = '<div class="muted">回答待ち…</div>'; return; }
    const cols = svCols(def);
    box.innerHTML = '<table class="atbl"><thead><tr><th>名前</th><th>クラス</th><th>提出</th>' + cols.map(q => "<th>" + h(q.sl) + "</th>").join("") + "<th>面談</th></tr></thead><tbody>"
      + resp.map((x, i) => {
        const p = x.profiles || {}, f = flagsOf(def, x.answers);
        return '<tr data-i="' + i + '"><td><b>' + h(p.display_name) + '</b><br><span class="muted">' + h(p.student_no) + "</span></td><td>" + h(p.class_name || "") + "</td><td>" + mdhm(x.submitted_at) + "</td>"
          + cols.map(q => '<td class="' + (qFlagged(q, (x.answers || {})[q.k]) ? "or" : "") + '">' + h(ansText(q, (x.answers || {})[q.k])) + "</td>").join("")
          + '<td><div class="tags">' + f.map(r => '<span class="tag or">' + h(r) + "</span>").join("") + "</div></td></tr>";
      }).join("") + "</tbody></table>";
    box.querySelectorAll("tr[data-i]").forEach(tr => { tr.onclick = () => openPerson(resp[Number(tr.dataset.i)], def); });
  }
  function svRest(sc) {
    const box = byId("sv-rest-box"), { rest } = sc;
    if (!sc.r) { box.innerHTML = '<div class="muted">回を選ぶと出ます。</div>'; return; }
    if (!rest.length) { box.innerHTML = '<div class="muted">未提出の人はいません。</div>'; return; }
    const by = new Map(); rest.forEach(s => { const c = s.class_name || "（クラスなし）"; if (!by.has(c)) by.set(c, []); by.get(c).push(s); });
    box.innerHTML = '<div class="a-head" style="margin-bottom:8px;"><h2 style="margin:0;">未提出 ' + rest.length + '人</h2><button class="abtn sm" type="button" id="sv-rest-copy">名前をコピー</button></div>'
      + [...by.entries()].map(([c, list]) => '<div class="dsec">' + h(c) + "（" + list.length + '人）</div><div class="tags" style="margin:6px 0 12px;">'
        + list.map(s => '<span class="tag gr">' + h(s.display_name) + "（" + h(s.student_no) + "）</span>").join("") + "</div>").join("")
      + '<div class="note">お知らせでの催促・ログインしたときに回答をうながす仕組みは、お知らせの仕組みができてから足します。</div>';
    byId("sv-rest-copy").onclick = e => copyText([...by.entries()].map(([c, l]) => c + "\n" + l.map(s => s.display_name + "（" + s.student_no + "）").join("\n")).join("\n\n"), e.currentTarget);
  }
  function svFlag(sc) {
    const box = byId("sv-flag-box"), { def, flagged } = sc;
    const hasFlags = (def.q || []).some(q => (q.o || []).some(o => o.flag));
    if (!hasFlags) { box.innerHTML = '<div class="muted">このアンケートには「目立たせる答え」の旗がありません（assets/surveys.js の選択肢に flag を付けると出ます）。</div>'; return; }
    if (!flagged.length) { box.innerHTML = '<div class="muted">面談候補はいません。</div>'; return; }
    box.innerHTML = '<table class="atbl"><thead><tr><th>名前</th><th>クラス</th><th>理由</th><th>提出</th></tr></thead><tbody>'
      + flagged.map((o, i) => { const p = o.x.profiles || {}; return '<tr data-i="' + i + '"><td><b>' + h(p.display_name) + '</b> <span class="muted">' + h(p.student_no) + "</span></td><td>" + h(p.class_name || "")
        + '</td><td><div class="tags">' + o.f.map(r => '<span class="tag or">' + h(r) + "</span>").join("") + "</div></td><td>" + mdhm(o.x.submitted_at) + "</td></tr>"; }).join("")
      + "</tbody></table>";
    box.querySelectorAll("tr[data-i]").forEach(tr => { tr.onclick = () => openPerson(flagged[Number(tr.dataset.i)].x, def); });
  }
  function svCsv() {
    const sc = svScope(), { r, def, resp } = sc;
    if (!r || !resp.length) { showMsg("sv-msg", "書き出す回答がありません。", true); return; }
    const qs = def.q || [];
    const rows = [["学籍番号", "氏名", "クラス", "提出日時", "面談候補の理由"].concat(qs.map(q => q.sl || q.k))];
    resp.forEach(x => {
      const p = x.profiles || {};
      rows.push([p.student_no, p.display_name, p.class_name || "", new Date(x.submitted_at).toLocaleString("ja-JP"), flagsOf(def, x.answers).join("・")]
        .concat(qs.map(q => ansText(q, (x.answers || {})[q.k]))));
    });
    const safe = s => String(s || "").replace(/[\\/:*?"<>|]/g, "_");
    downloadCsv(safe(def.title.ja) + "_" + safe(r.title) + ".csv", rows);
    showMsg("sv-msg", "書き出しました（" + resp.length + "人ぶん）。ファイルはダウンロード先に保存されています。");
  }
  function svInit() {
    byId("sv-tabs").addEventListener("click", e => { const t = e.target.closest(".tab"); if (!t) return; S.tab = t.dataset.tab; svTabs(); });
    byId("sv-class").onchange = () => { S.cls = byId("sv-class").value; svRender(); };
    byId("sv-compare").onchange = () => { S.compare = byId("sv-compare").checked; svRender(); };
    byId("sv-csv").onclick = svCsv;
  }
  const survey = {
    async tick() { if (Date.now() - S.loadedAt < 20000) return; await svReload(); },   // 2秒の tick から呼ばれる。20秒あける
    reload() { S.loadedAt = 0; return svReload(); },
    pickKey(k) { S.key = k; S.rid = null; S.cls = ""; S.loadedAt = 0; svReload(); },
    /* 今日の「対応すること」から：そのアンケート・その回・そのタブで開く */
    focus(key, rid, tab) {
      svKey = key; byId("sv-pick").value = key;
      S.key = key; S.rid = rid; S.tab = tab || "sum"; S.cls = ""; S.loadedAt = 0;
      setView("survey");
    },
  };

  /* ════════ 今日（管理③） ════════ */
  const T = { at: 0, busy: false };
  const doneKey = id => { const d = new Date(); return "adm_done_" + d.getFullYear() + (d.getMonth() + 1) + d.getDate() + "_" + id; };
  const isDone = id => { try { return localStorage.getItem(doneKey(id)) === "1"; } catch (e) { return false; } };
  const setDone = (id, v) => { try { v ? localStorage.setItem(doneKey(id), "1") : localStorage.removeItem(doneKey(id)); } catch (e) {} };
  function hello() {
    const d = new Date(), hr = d.getHours();
    byId("td-date").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日（" + WD[d.getDay()] + "）";
    const g = hr >= 4 && hr < 11 ? "おはようございます" : hr >= 11 && hr < 17 ? "こんにちは" : "おつかれさまです";
    const nm = (api.profile && api.profile.display_name) || "";
    byId("td-hello").textContent = nm ? g + "、" + nm + "さん" : g;
  }
  async function todayLive() {
    const box = byId("td-live"), nowIso = new Date().toISOString();
    const runs = await api.get("/rest/v1/quiz_runs?select=id,quiz_set_id,class_names,student_ids,opens_at,closes_at,quiz_sets(title,lesson),attempts(count)"
      + "&is_void=eq.false&opens_at=lte." + nowIso + "&closes_at=gt." + nowIso + "&order=closes_at.asc");
    if (!runs.length) {
      box.innerHTML = '<div class="livecard idle"><span class="lc-t"><span class="lc-name">いま 実施中の小テストは ありません</span>'
        + '<span class="lc-sub">「問題の登録・解放」の一覧から「はじめる」を押すと、ここに出ます。</span></span>'
        + '<button class="abtn pri" type="button" data-goto="qsets">小テストを はじめる</button></div>';
      return;
    }
    const r = runs[0];
    const all = await students();
    const target = targetsOf(r, all).length;
    const sub = (r.attempts && r.attempts[0] && r.attempts[0].count) || 0;
    let doing = 0;
    try {   // 回答中＝途中保存がある人（提出すると下書きは消える）。★人数だけ・名前は出さない
      const dr = await api.get("/rest/v1/attempt_drafts?select=student_id&quiz_set_id=eq." + r.quiz_set_id);
      const tset = new Set(targetsOf(r, all).map(s => s.id));
      doing = new Set(dr.map(x => x.student_id).filter(id => tset.has(id))).size;
    } catch (e) { doing = 0; }
    const t = r.quiz_sets || {}, cls = (r.class_names || []).join("・") || "全員";
    const left = Math.max(0, Math.ceil((new Date(r.closes_at) - Date.now()) / 60000));
    const p = pct(sub, target);
    box.innerHTML = '<div class="livecard"><span class="lc-t"><span class="lc-badge"><i></i>いま 実施中' + (runs.length > 1 ? "（ほか " + (runs.length - 1) + "）" : "") + "</span>"
      + '<span class="lc-name">' + h((t.lesson ? t.lesson + " " : "") + (t.title || "")) + "</span>"
      + '<span class="lc-sub">' + h(cls) + " ・ " + new Date(r.opens_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) + " にはじめた ・ あと " + left + "分 ・ 回答中 " + doing + "人</span></span>"
      + '<span class="lc-n"><span><b>' + sub + "</b> <span>/ " + target + "人 提出</span></span>"
      + '<span class="lc-bar"><i style="width:' + p + '%"></i></span></span>'
      + '<button class="lc-go" type="button" id="td-golive">ライブ集計を 見る →</button></div>';
    byId("td-golive").onclick = () => {
      const sel = byId("quiz-pick");
      if ([...sel.options].some(o => o.value === r.quiz_set_id)) { sel.value = r.quiz_set_id; sel.onchange && sel.onchange(); }
      setView("quiz");
    };
  }
  async function openSurveyRounds() {
    const rounds = await api.get("/rest/v1/survey_rounds?select=id,survey_key,title,class_names,student_ids,opens_at,closes_at,is_void&is_void=eq.false&order=closes_at.asc.nullslast");
    return rounds.filter(r => isLive(r) && defOf(r.survey_key));
  }
  async function todayTodo(rounds) {
    const box = byId("td-todo"), all = await students(), items = [];
    if (rounds.length) {
      const resp = await api.get("/rest/v1/survey_responses?select=student_id,round_id,answers&round_id=in.(" + rounds.map(r => r.id).join(",") + ")");
      rounds.forEach(r => {
        const def = defOf(r.survey_key), tg = targetsOf(r, all), mine = resp.filter(x => x.round_id === r.id);
        const done = new Set(mine.map(x => x.student_id)), rest = tg.filter(s => !done.has(s.id)).length;
        const due = r.closes_at ? "締切 " + md(r.closes_at) + " ・ あと " + daysLeft(r.closes_at) + "日" : "締切なし";
        const name = def.title.ja + (r.title && r.title !== "常設" ? "「" + r.title + "」" : "");
        if (rest > 0 && r.closes_at) items.push({ id: "sv_" + r.id, n: rest, cls: "", title: name + " 未提出", sub: due + " ・ 提出 " + done.size + " / " + tg.length, act: "名前を見る", go: () => survey.focus(r.survey_key, r.id, "rest") });
        const fl = mine.filter(x => flagsOf(def, x.answers).length).length;
        if (fl > 0) items.push({ id: "fl_" + r.id, n: fl, cls: "or", title: "面談候補（" + def.title.ja + "）", sub: "目立たせる答えのある人 ・ " + (r.title || ""), act: "見る", go: () => survey.focus(r.survey_key, r.id, "flag") });
      });
    }
    byId("td-todo-n").textContent = items.length ? items.filter(i => isDone(i.id)).length + " / " + items.length + " 済み" : "";
    if (!items.length) { box.innerHTML = '<div class="todo"><span class="tt"><b>いま 対応することは ありません</b><span>締切のあるアンケートの未提出・面談候補があると、ここに出ます。</span></span></div>'; return; }
    box.replaceChildren();
    items.forEach(it => {
      const row = mk("div", "todo" + (isDone(it.id) ? " done" : ""));
      row.appendChild(mk("span", "tn " + it.cls, String(it.n)));
      const tt = mk("span", "tt"); tt.appendChild(mk("b", "", it.title)); tt.appendChild(mk("span", "", it.sub)); row.appendChild(tt);
      const a = mk("button", "abtn sm", it.act); a.type = "button"; a.onclick = it.go; row.appendChild(a);
      const ck = mk("button", "ck"); ck.type = "button"; ck.setAttribute("aria-label", "済みにする"); ck.setAttribute("aria-pressed", isDone(it.id) ? "true" : "false");
      ck.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      ck.onclick = () => { setDone(it.id, !isDone(it.id)); T.at = 0; todayTodo(rounds); };
      row.appendChild(ck);
      box.appendChild(row);
    });
  }
  function todayDues(rounds) {
    const box = byId("td-dues"), today = new Date(); today.setHours(0, 0, 0, 0);
    const list = [];
    ((window.EXAM_DATES || {}).school_exams || []).forEach(x => {
      const d = new Date(x.date + "T00:00:00");
      if (d >= today) list.push({ d, ex: true, t: x.test_name || x.test, s: (x.session || "") + " ・ " + (x.grades || []).join("・") + " ・ あと " + Math.round((d - today) / 86400000) + "日" });
    });
    rounds.filter(r => r.closes_at).forEach(r => {
      const d = new Date(r.closes_at);
      list.push({ d, ex: false, t: defOf(r.survey_key).title.ja + " 締切", s: (r.title || "") + " ・ あと " + daysLeft(r.closes_at) + "日" });
    });
    list.sort((a, b) => a.d - b.d);
    if (!list.length) { box.innerHTML = '<div class="muted">近い締切・試験はありません。</div>'; return; }
    box.innerHTML = list.slice(0, 5).map(x => '<div class="due"><span class="dd' + (x.ex ? " ex" : "") + '"><small>' + (x.d.getMonth() + 1) + "月</small><b>" + x.d.getDate() + "</b></span>"
      + '<span class="dt"><b>' + h(x.t) + "</b><span>" + h(x.s) + "</span></span></div>").join("");
  }
  const today = {
    async tick() {
      if (T.busy || Date.now() - T.at < 15000) return;
      T.busy = true;
      try {
        hello();
        const rounds = await openSurveyRounds();
        await Promise.all([todayLive().catch(() => {}), todayTodo(rounds).catch(e => { byId("td-todo").textContent = "読み込みに失敗しました（" + e.message + "）"; })]);
        todayDues(rounds);
        T.at = Date.now();
      } catch (e) { /* 次の tick で回復 */ } finally { T.busy = false; }
    },
  };

  /* ════════ 小テスト：再テストの対象（管理④） ════════
     ★線は正答率（％）。点数（配点）では引かない。★画面を離れた記録とは結び付けない */
  const Q = { th: 60, last: [] };
  function retestRender() {
    const th = byId("qz-th"); if (!th) return;
    th.replaceChildren();
    [50, 60, 70].forEach(v => {
      const b = mk("button", "chip" + (Q.th === v ? " on" : ""), v + "%未満"); b.type = "button";
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", Q.th === v ? "true" : "false");
      b.onclick = () => { Q.th = v; retestRender(); };
      th.appendChild(b);
    });
    const list = Q.last.filter(a => a.total && a.score / a.total * 100 < Q.th).sort((a, b) => a.score / a.total - b.score / b.total);
    const box = byId("qz-re-list");
    if (!Q.last.length) { box.innerHTML = '<div class="muted">提出待ち…</div>'; return; }
    box.innerHTML = list.length
      ? '<table class="atbl"><tbody>' + list.map(a => "<tr><td><b>" + h(a.name) + '</b> <span class="muted">' + h(a.student_no) + '</span></td><td class="num or">' + a.score + " / " + a.total + "問（" + pct(a.score, a.total) + "%）</td></tr>").join("") + "</tbody></table>"
      : '<div class="muted">' + Q.th + "%未満の人はいません。</div>";
    byId("qz-re-copy").onclick = e => copyText(list.map(a => a.name + "（" + a.student_no + "）").join("\n"), e.currentTarget);
    byId("qz-re-copy").disabled = !list.length;
  }
  const quiz = { retest(attempts) { Q.last = attempts || []; retestRender(); } };

  /* ════════ アンケートを作る（管理②・定義を読む） ════════ */
  const B = { key: null, i: 0, lang: "ja" };
  function build() {
    const pick = byId("bld-pick");
    if (!pick.options.length) {
      pick.innerHTML = SURVEYS.map(s => '<option value="' + h(s.key) + '">' + h(s.title.ja) + "（" + h(s.key) + "）</option>").join("");
      pick.onchange = () => { B.key = pick.value; B.i = 0; build(); };
      document.querySelectorAll("[data-bld-lang]").forEach(b => { b.onclick = () => { B.lang = b.dataset.bldLang; document.querySelectorAll("[data-bld-lang]").forEach(x => x.classList.toggle("on", x === b)); bldPreview(); }; });
      byId("bld-start").onclick = async () => {
        const r = await openSurveyRoundDialog(B.key);
        if (r) showMsg("bld-msg", "「" + r.title + "」を はじめました" + (r.target_count != null ? "（" + r.target_count + "人対象）" : "") + "。結果は「アンケート 結果」で見られます。");
      };
    }
    if (!B.key) B.key = (typeof svKey !== "undefined" && svKey) || SURVEYS[0].key;
    pick.value = B.key;
    const def = defOf(B.key), list = byId("bld-list");
    list.replaceChildren();
    let sec = null;
    (def.q || []).forEach((q, i) => {
      if ((q.section || "") !== sec) {
        sec = q.section || "";
        const s = (def.sections || []).find(x => x.key === sec);
        if (s) list.appendChild(mk("div", "sh", s.title.ja));
      }
      const b = mk("button", "qi" + (i === B.i ? " on" : "")); b.type = "button";
      b.appendChild(mk("span", "no", String(i + 1)));
      b.appendChild(mk("span", "qs", q.sl || (q.l && q.l.ja) || q.k));
      b.appendChild(mk("span", "tag gr", TYPE_JA[q.t] || q.t || ""));
      if ((q.o || []).some(o => o.flag)) b.appendChild(mk("span", "tag or", "旗"));
      b.onclick = () => { B.i = i; build(); };
      list.appendChild(b);
    });
    bldDetail(def);
    bldPreview();
  }
  function bldDetail(def) {
    const q = (def.q || [])[B.i], box = byId("bld-detail");
    if (!q) { box.innerHTML = '<div class="muted">質問がありません。</div>'; return; }
    const dep = q.showWhen ? (def.q.find(x => x.k === q.showWhen.key) || {}) : null;
    let html = '<h2 style="margin:0 0 12px;font-size:1.05rem;">' + (B.i + 1) + ". " + h(q.l ? q.l.ja : q.k) + "</h2><dl>"
      + "<dt>English</dt><dd>" + h(q.l ? (q.l.en || "（なし）") : "") + "</dd>"
      + "<dt>教師画面での名前</dt><dd>" + h(q.sl || "") + "</dd>"
      + "<dt>答え方</dt><dd>" + h(TYPE_JA[q.t] || q.t || "") + (q.maxLength ? "（" + q.maxLength + "字まで）" : "") + "</dd>"
      + "<dt>必須</dt><dd>" + (q.required ? "必須" : "任意") + "</dd>"
      + (dep ? "<dt>出し分け</dt><dd>「" + h(dep.sl || dep.k) + "」が「" + h(optLabel(dep, q.showWhen.is)) + "」のときだけ出す</dd>" : "")
      + "<dt>保存する名前</dt><dd><code>" + h(q.k) + "</code></dd></dl>";
    if (q.o) {
      html += '<h3 style="font-size:.9rem;margin:16px 0 8px;">選択肢</h3><div class="opts">'
        + q.o.map(o => '<div class="opt' + (o.flag ? " flag" : "") + '"><span>' + h(o.ja) + '</span><span class="muted">' + h(o.en || "") + "</span>"
          + (o.flag ? '<span class="tag or">結果で目立たせる：' + h(o.flag) + "</span>" : "") + (((q.exclusive || []).includes(o.v)) ? '<span class="tag gr">ほかと一緒に選べない</span>' : "") + "<code>" + h(o.v) + "</code></div>").join("") + "</div>";
    }
    html += '<div class="note" style="margin-top:14px;">記名（ログインした学生の答えとして保存）・言語は日本語/English・出したあとも締切までは学生が直せます。</div>';
    box.innerHTML = html;
  }
  function bldPreview() {
    const def = defOf(B.key), box = byId("bld-preview");
    try {
      SurveyForm.mount(box, def, { lang: B.lang, profile: { student_no: "2604999", display_name: "テスト太郎", class_name: "A①クラス" } });
    } catch (e) { box.textContent = "見本を出せませんでした（" + e.message + "）"; }
  }

  /* ════════ 学生（管理⑤） ════════ */
  const ST = { rows: [], f: "", q: "", cls: "", at: 0 };
  async function stLoad() {
    if (Date.now() - ST.at < 30000 && ST.rows.length) { stRender(); return; }
    byId("st-table").innerHTML = '<div class="muted">読み込み中…</div>';
    try {
      const [all, atts, rounds] = await Promise.all([
        students(),
        api.get("/rest/v1/attempts?select=student_id,score,total,submitted_at,quiz_set_id&order=submitted_at.asc&limit=20000"),
        openSurveyRounds(),
      ]);
      let resp = [];
      if (rounds.length) resp = await api.get("/rest/v1/survey_responses?select=student_id,round_id&round_id=in.(" + rounds.map(r => r.id).join(",") + ")");
      const by = new Map(all.map(s => [s.id, { s, att: [], owe: 0, did: 0 }]));
      atts.forEach(a => { const o = by.get(a.student_id); if (o) o.att.push(a); });
      rounds.forEach(r => {
        const done = new Set(resp.filter(x => x.round_id === r.id).map(x => x.student_id));
        targetsOf(r, all).forEach(s => { const o = by.get(s.id); if (!o) return; if (done.has(s.id)) o.did++; else o.owe++; });
      });
      // 並びはクラス→学籍番号。★負荷試験用（クラス LOAD）はうしろへ（デモDBにだけある）
      ST.rows = [...by.values()].sort((a, b) => ((a.s.class_name === "LOAD") - (b.s.class_name === "LOAD"))
        || String(a.s.class_name || "").localeCompare(String(b.s.class_name || ""), "ja") || String(a.s.student_no).localeCompare(String(b.s.student_no)));
      ST.atts = atts;
      ST.at = Date.now();
      const sel = byId("st-cls"), keep = sel.value;
      const classes = [...new Set(all.map(s => s.class_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
      sel.innerHTML = '<option value="">すべてのクラス</option>' + classes.map(c => '<option value="' + h(c) + '">' + h(c) + "</option>").join("");
      sel.value = classes.includes(keep) ? keep : "";
      stRender();
    } catch (e) { byId("st-table").innerHTML = '<div class="msg err" style="display:block;">読み込みに失敗しました（' + h(e.message) + "）</div>"; }
  }
  const avgPct = att => { const t = att.reduce((a, x) => a + x.total, 0); return t ? Math.round(att.reduce((a, x) => a + x.score, 0) / t * 100) : null; };
  function stRender() {
    const q = ST.q.toLowerCase();
    const rows = ST.rows.filter(o => {
      if (ST.cls && o.s.class_name !== ST.cls) return false;
      if (q && !((o.s.display_name || "").toLowerCase().includes(q) || (o.s.student_no || "").toLowerCase().includes(q))) return false;
      if (ST.f === "nosv" && !o.owe) return false;
      if (ST.f === "low") { const p = avgPct(o.att); if (p == null || p >= 60) return false; }
      return true;
    });
    byId("st-sum").textContent = ST.rows.length + "人 ・ 表示 " + rows.length + "人";
    if (!rows.length) { byId("st-table").innerHTML = '<div class="muted">当てはまる学生はいません。</div>'; return; }
    byId("st-table").innerHTML = '<table class="atbl"><thead><tr><th>学籍番号</th><th>名前</th><th>クラス</th><th class="num">小テスト 平均</th><th class="num">受けた回数</th><th>アンケート</th><th>最近の小テスト</th></tr></thead><tbody>'
      + rows.map((o, i) => {
        const p = avgPct(o.att), last = o.att.length ? o.att[o.att.length - 1].submitted_at : null;
        return '<tr data-i="' + i + '"><td>' + h(o.s.student_no) + "</td><td><b>" + h(o.s.display_name) + "</b></td><td>" + h(o.s.class_name || "") + "</td>"
          + '<td class="num' + (p != null && p < 60 ? " or" : "") + '">' + (p == null ? "—" : p + "%") + '</td><td class="num">' + o.att.length + "</td>"
          + "<td>" + (o.owe ? '<span class="tag or">未提出 ' + o.owe + "</span>" : (o.did ? '<span class="tag ok">提出済み</span>' : '<span class="muted">—</span>')) + "</td>"
          + "<td>" + (last ? md(last) : '<span class="muted">—</span>') + "</td></tr>";
      }).join("") + "</tbody></table>";
    byId("st-table").querySelectorAll("tr[data-i]").forEach(tr => { tr.onclick = () => stOpen(rows[Number(tr.dataset.i)]); });
  }
  /* 本人の正答率の推移と、同じテストのクラス平均（学生にはクラス平均だけ見せる・順位は出さない） */
  function spark(o) {
    const pts = o.att.slice(-10);
    if (!pts.length) return null;
    const mates = new Set(ST.rows.filter(x => x.s.class_name === o.s.class_name).map(x => x.s.id));
    const clsAvg = qs => { const a = ST.atts.filter(x => x.quiz_set_id === qs && mates.has(x.student_id)); return avgPct(a); };
    const W = 440, H = 150, L = 30, R = 10, Tp = 14, Bt = 24, n = pts.length;
    const X = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), Y = v => Tp + (100 - v) * (H - Tp - Bt) / 100;
    const me = pts.map(a => pct(a.score, a.total)), cl = pts.map(a => clsAvg(a.quiz_set_id));
    let svg = '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="正答率の推移（本人とクラス平均）">';
    [0, 50, 100].forEach(v => { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#F0ECF3"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end" font-size="10" fill="#6B6475">' + v + "</text>"; });
    const line = (arr, col, dash) => { const p = arr.map((v, i) => v == null ? null : X(i) + "," + Y(v)).filter(Boolean).join(" "); return p ? '<polyline points="' + p + '" fill="none" stroke="' + col + '" stroke-width="' + (dash ? 2 : 3) + '"' + (dash ? ' stroke-dasharray="4 4"' : "") + ' stroke-linecap="round" stroke-linejoin="round"/>' : ""; };
    svg += line(cl, "#B8AEC6", true) + line(me, "#7B2A70", false);
    me.forEach((v, i) => { svg += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="4" fill="#fff" stroke="#7B2A70" stroke-width="2"/>'; });
    pts.forEach((a, i) => { svg += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#6B6475">' + md(a.submitted_at) + "</text>"; });
    return svg + "</svg>";
  }
  async function stOpen(o) {
    drawer.open(o.s.display_name || "（名前なし）", (o.s.student_no || "") + " ・ " + (o.s.class_name || ""), body => {
      body.appendChild(mk("div", "dsec", "小テストの正答率（紫＝本人・点線＝クラス平均）"));
      const sv = spark(o);
      if (sv) { const d = mk("div"); d.innerHTML = sv; body.appendChild(d); }
      else body.appendChild(mk("div", "muted", "まだ小テストを受けていません。"));
      body.appendChild(mk("div", "dsec", "アンケート"));
      const box = mk("div", "", "読み込み中…"); body.appendChild(box);
      body.appendChild(mk("div", "note", "出席率・同意の記録・パスワード再発行・アカウントを止める は、学生マスタDBとのつなぎこみと管理用の権限ができてから足します。"));
      api.get("/rest/v1/survey_responses?select=survey_key,round_id,answers,submitted_at,survey_rounds(title)&student_id=eq." + o.s.id + "&order=submitted_at.desc")
        .catch(() => api.get("/rest/v1/survey_responses?select=survey_key,round_id,answers,submitted_at&student_id=eq." + o.s.id + "&order=submitted_at.desc"))
        .then(rows => {
          box.replaceChildren();
          if (!rows.length) { box.appendChild(mk("div", "muted", "まだ答えていません。")); return; }
          rows.forEach((r, i) => {
            const def = defOf(r.survey_key); if (!def) return;
            const head = mk("div", "arow");
            head.appendChild(mk("div", "q", mdhm(r.submitted_at) + (r.survey_rounds && r.survey_rounds.title && r.survey_rounds.title !== "常設" ? " ・ " + r.survey_rounds.title : "")));
            head.appendChild(mk("div", "a", def.title.ja));
            const f = flagsOf(def, r.answers);
            if (f.length) { const t = mk("div", "tags"); f.forEach(x => t.appendChild(mk("span", "tag or", x))); head.appendChild(t); }
            const more = mk("button", "abtn sm", i === 0 ? "答えをたたむ" : "答えを見る"); more.type = "button"; more.style.marginTop = "6px";
            const inner = mk("div"); inner.style.display = i === 0 ? "flex" : "none"; inner.style.flexDirection = "column"; inner.style.gap = "6px"; inner.style.marginTop = "8px";
            answerRows(inner, def, r.answers, null);
            more.onclick = () => { const on = inner.style.display === "none"; inner.style.display = on ? "flex" : "none"; more.textContent = on ? "答えをたたむ" : "答えを見る"; };
            head.appendChild(more); head.appendChild(inner);
            box.appendChild(head);
          });
        }).catch(e => { box.textContent = "読み込めませんでした（" + e.message + "）"; });
    });
  }
  function stInit() {
    byId("st-q").oninput = () => { ST.q = byId("st-q").value.trim(); stRender(); };
    byId("st-cls").onchange = () => { ST.cls = byId("st-cls").value; stRender(); };
    byId("st-flt").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; ST.f = b.dataset.f; byId("st-flt").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); stRender(); });
  }

  /* ════════ お知らせ（画面イメージ・宛先の人数だけ本物） ════════ */
  let ntDone = false;
  async function notice() {
    const pv = () => { byId("nt-pv-subj").textContent = byId("nt-subj").value || "（件名）"; byId("nt-pv-body").textContent = byId("nt-body").value || "（本文）"; };
    byId("nt-subj").oninput = pv; byId("nt-body").oninput = pv;
    byId("nt-kind").onclick = e => { const b = e.target.closest(".chip"); if (b) byId("nt-kind").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); };
    if (ntDone) return;
    ntDone = true;
    const box = byId("nt-to");
    const count = async cls => {
      try { const n = await api.rpc("run_target_count", { p_class_names: cls ? [cls] : [] }); byId("nt-count").textContent = "届く人数：" + n + "人"; }
      catch (e) { byId("nt-count").textContent = ""; }
    };
    try {
      const classes = await fetchClassNames();
      classes.forEach(c => { const b = mk("button", "chip", c); b.type = "button"; b.dataset.to = c; box.appendChild(b); });
    } catch (e) {}
    box.onclick = e => { const b = e.target.closest(".chip"); if (!b) return; box.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); count(b.dataset.to); };
    count("");
  }

  /* ════════ 入口 ════════ */
  let inited = false;
  window.Admin = {
    init() {
      const p = api.profile || {};
      const nm = p.display_name || p.student_no || "";
      byId("me-name").textContent = nm;
      byId("me-av").textContent = (String(nm).trim()[0] || "?").toUpperCase();
      if (inited) return;
      inited = true;
      document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g) setView(g.dataset.goto); });
      svInit(); stInit();
      retestRender();
    },
    onView(v) {
      if (v === "svbuild") build();
      else if (v === "students") stLoad();
      else if (v === "notice") notice();
      else if (v === "survey") { S.loadedAt = 0; survey.tick(); }
      else if (v === "today") { T.at = 0; today.tick(); }
    },
    today, survey, quiz,
    _flagsOf: flagsOf,   // テスト用
  };
})();
