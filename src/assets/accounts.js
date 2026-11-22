/* 学生アカウントの発行（2026-11-23／2026-11-24 に Edge Function へ移した）
 *
 * 置き場：マスター画面「学生」の下の「アカウントの発行」（master.html の #ac-panel。中身はここで組み立てる）
 *   名簿のファイルを選ぶ（または3列を貼る）→「名簿を確認する」
 *   → 新しく作る・すでにある・形式がおかしい の件数 → 確認 → 発行 → 結果
 *   ★名簿は、学生マスタDB（またはリンガル）から「学籍番号・氏名・クラス」の3列を書き出したものを使う（2026-11-23 きあ）。
 *     事務に見本の Excel を配って埋めてもらう形はやめた（見本を保存するボタンは外した）
 *
 * 🔴 作るのはサーバーだけ＝Supabase の Edge Function「issue-accounts」（supabase/functions/issue-accounts/）。
 *    ログイン用のアカウントは Auth の管理用 API で作る（DB から auth の表へ直接は書かない＝2026-11-21 の決定）。
 *    発行できる人かどうかは DB が見る（account.manage＝情報管理者。db/2026-11-24_account_issue_edge.sql）。
 *    ここの「持っている人だけに出す」は案内であって権限ではない
 * 🔴 学籍番号の決まりはサーバーと同じ＝全角・ハイフン・空白を取ってから、7桁の数字だけを通す
 *    （サーバー側は app_hidden.normalize_student_no。片方だけ直さない）
 * 🔴 文言はふつうの日本語（社員が使う画面）。表・列・RPC の名前を画面に出さない
 * ★Edge Function がまだ置かれていなくても、画面は今までどおり動く。発行だけ「まだ使えません」と出す
 * ★名簿の文字は textContent で入れる（HTML として流し込まない）
 *
 * master.html の中の api / askDialog / XLSX を使う。通信もDOMも触らない部分（normalizeNo / parseRoster /
 * rowsFromSheet / checkRow / classify）は、検査（tests/run_e2e_accounts.cjs）から直接呼べるように Accounts に出してある
 */
(function () {
  "use strict";
  const CHUNK = 20;          // 1回の送信で作る件数（サーバーは30件まで。パスワードの計算に時間がかかるため小分け）
  const REASON = {
    bad_student_no: "学籍番号が7桁の数字ではありません",
    bad_name: "氏名が空か、長すぎます（100字まで）",
    bad_class: "クラスが空か、長すぎます（50字まで）",
    duplicate_in_list: "名簿の中で同じ学籍番号が重なっています",
    exists: "すでにアカウントがあります",
    login_exists: "ログイン用のアカウントだけが残っています（情報管理者に確認してください）",
    "error:profile": "名簿に入れられなかったので、作りませんでした",
    "error:profile_login_left": "名簿に入れられず、ログイン用のアカウントだけが残りました（情報管理者に確認してください）",
  };
  const reasonText = code => REASON[code] || (/^error:/.test(code || "") ? "作成中にエラーが起きました（符号 " + code.slice(6) + "）" : "作成できませんでした");

  /* ── 名簿を読む（通信・DOM なし） ── */
  /* 学籍番号の形。全角の数字を半角に直し、ハイフン・空白を取ってから、7桁の数字だけを通す。それ以外は null */
  function normalizeNo(raw) {
    const s = String(raw == null ? "" : raw)
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[-‐‑–—―ー－−\s　]/g, "");
    return /^[0-9]{7}$/.test(s) ? s : null;
  }
  function splitLine(line, sep) {
    if (sep === "\t") return line.split("\t");
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  const isHead = cell => /学籍|番号|^no\.?$|student/i.test(String(cell || ""));
  /* 表（行の配列の配列）から名簿へ。空行と、先頭の見出しは飛ばす。値は前後の空白を取るだけ */
  function rowsFromSheet(aoa) {
    const rows = []; let first = true;
    (aoa || []).forEach((cells, i) => {
      const c = (cells || []).map(x => String(x == null ? "" : x).trim());
      if (!c.some(Boolean)) return;
      if (first) { first = false; if (isHead(c[0])) return; }
      rows.push({ line: i + 1, student_no: c[0] || "", display_name: c[1] || "", class_name: c[2] || "" });
    });
    return rows;
  }
  /* 文字から名簿へ。1行＝学籍番号・氏名・クラス（タブ区切り＝Excel からの貼り付け／カンマ区切り＝CSV） */
  function parseRoster(text) {
    const lines = String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/);
    const sep = lines.some(l => l.includes("\t")) ? "\t" : ",";
    return rowsFromSheet(lines.map(l => l.trim() ? splitLine(l, sep) : []));
  }
  function checkRow(r) {
    if (!normalizeNo(r.student_no)) return "bad_student_no";
    if (!r.display_name || r.display_name.length > 100) return "bad_name";
    if (!r.class_name || r.class_name.length > 50) return "bad_class";
    return null;
  }
  /* existing＝すでにある学籍番号の Set。返すのは 新しく作る・すでにある・形式がおかしい の3つ。
     新しく作る・すでにある の行には、正した番号（no）を付ける */
  function classify(rows, existing) {
    const out = { fresh: [], existing: [], invalid: [] }, seen = new Set();
    rows.forEach(r => {
      const no = normalizeNo(r.student_no);
      let why = checkRow(r);
      if (!why && seen.has(no)) why = "duplicate_in_list";
      if (no) seen.add(no);
      if (why) out.invalid.push({ row: r, reason: why });
      else if (existing.has(no)) out.existing.push(Object.assign({ no }, r));
      else out.fresh.push(Object.assign({ no }, r));
    });
    return out;
  }

  /* ── ここから画面 ── */
  const byId = id => document.getElementById(id);
  function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const notReady = e => (e && e.status === 404) || /issue_precheck|schema cache|404/.test((e && e.message) || "");
  const NOT_READY = "まだ使えません（サーバーの準備待ち）。";
  function say(el, text, kind) {
    el.className = kind ? "" : "muted"; el.style.fontWeight = kind === "ok" ? "700" : "";
    el.style.color = kind === "ok" ? "#047857" : kind === "ng" ? "#B91C1C" : "";
    el.textContent = text;
  }
  async function getAll(path) {   // 1000件ずつ（1回で返る件数に上限があるため）
    const out = [];
    for (let off = 0; ; off += 1000) {
      const rows = await api.get(path + "&limit=1000&offset=" + off);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  function listBox(title, items) {   // たたんでおく一覧（件数が多くても画面を押し流さない）
    const d = mk("details"), s = mk("summary", "", title); s.style.cursor = "pointer"; s.style.fontWeight = "700";
    const ul = mk("div"); ul.style.cssText = "display:flex;flex-direction:column;gap:4px;margin:8px 0 0;font-size:.86rem;";
    items.forEach(t => ul.appendChild(mk("div", "", t)));
    d.append(s, ul);
    return d;
  }
  /* 発行できる人か（案内。権限はサーバーが見る）。分からないときは出さない */
  async function canIssue() {
    try { const caps = await api.rpc("my_caps", {}); return Array.isArray(caps) && caps.includes("account.manage"); }
    catch (e) { return false; }
  }
  /* Excel（1枚目か「名簿」のシート）を、貼り付けと同じ形（タブ区切りの文字）にする。番号は文字のまま読む */
  function textFromWorkbook(buf) {
    const wb = XLSX.read(buf, { type: "array" });
    const name = wb.SheetNames.includes("名簿") ? "名簿" : wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    return aoa.map(r => r.slice(0, 3).map(x => String(x == null ? "" : x).replace(/[\t\r\n]/g, " ")).join("\t")).join("\n");
  }

  const P = { built: false, plan: null, asked: false };
  async function buildPanel() {
    const panel = byId("ac-panel");
    if (!panel || P.built || P.asked) return;
    P.asked = true;
    const ok = await canIssue();
    P.asked = false;
    panel.hidden = !ok;
    if (!ok) return;
    P.built = true;
    panel.appendChild(mk("h2", "", "アカウントの発行"));
    panel.appendChild(mk("div", "note", "新しい学生のアカウントを、名簿からまとめて作ります。左から「学籍番号・氏名・クラス」の3列が並んだ Excel か CSV を選んでください"
      + "（3列をコピーして、下の欄に貼ることもできます）。1行目が見出しなら、飛ばして読みます。"
      + "初期パスワードは「scg＋学籍番号」です。学生は、最初のログインで新しいパスワードを決めます。"
      + "すでにアカウントがある学生は作り直しません（名前やクラスも変わりません）。"));
    const row1 = mk("div"); row1.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px;";
    const file = mk("input"); file.type = "file"; file.id = "ac-file"; file.accept = ".xlsx,.csv,.tsv,.txt"; file.setAttribute("aria-label", "名簿のファイル");
    row1.append(file);
    const ta = mk("textarea"); ta.id = "ac-text"; ta.rows = 6; ta.spellcheck = false;
    ta.placeholder = "2604999\tテスト太郎\tA1クラス";
    ta.setAttribute("aria-label", "名簿（学籍番号・氏名・クラス）");
    ta.style.cssText = "width:100%;box-sizing:border-box;margin:10px 0;padding:10px;border:1px solid #D6CFDD;border-radius:10px;font:inherit;font-size:.88rem;";
    const check = mk("button", "abtn", "名簿を確認する"); check.type = "button"; check.id = "ac-check";
    const msg = mk("div", "muted"); msg.id = "ac-msg"; msg.style.marginTop = "10px";
    const pv = mk("div"); pv.id = "ac-preview"; pv.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-top:10px;";
    const issue = mk("button", "abtn pri"); issue.type = "button"; issue.id = "ac-issue"; issue.hidden = true; issue.style.marginTop = "12px";
    const res = mk("div"); res.id = "ac-result"; res.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-top:12px;";
    panel.append(row1, ta, check, msg, pv, issue, res);

    const forget = () => { P.plan = null; pv.replaceChildren(); issue.hidden = true; };   // 名簿を直したら、確認からやり直し
    ta.oninput = () => { forget(); say(msg, ""); };
    file.onchange = () => {
      const f = file.files && file.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let text = "";
        try {
          if (/\.xlsx$/i.test(f.name)) text = textFromWorkbook(rd.result);
          else { try { text = new TextDecoder("utf-8", { fatal: true }).decode(rd.result); } catch (e) { text = new TextDecoder("shift_jis").decode(rd.result); } }
        } catch (e) { text = ""; }
        ta.value = text; forget();
        say(msg, text ? "ファイルを読み込みました。「名簿を確認する」を押してください。" : "ファイルを読めませんでした。", text ? "" : "ng");
      };
      rd.readAsArrayBuffer(f);
    };
    check.onclick = () => preview(ta, msg, pv, issue, res);
    issue.onclick = () => runIssue(msg, pv, issue, res, check);
  }

  async function preview(ta, msg, pv, issue, res) {
    P.plan = null; pv.replaceChildren(); res.replaceChildren(); issue.hidden = true;
    const rows = parseRoster(ta.value);
    if (!rows.length) { say(msg, "名簿が空です。1行に1人、学籍番号・氏名・クラスの順で入れてください。", "ng"); return; }
    say(msg, "いまの名簿と照らし合わせています…");
    let have;
    try { have = await getAll("/rest/v1/profiles?select=student_no,class_name,role&order=student_no"); }
    catch (e) { say(msg, "いまの名簿を読めませんでした（" + e.message + "）", "ng"); return; }
    const plan = classify(rows, new Set(have.map(p => String(p.student_no || "").trim())));
    P.plan = plan;
    say(msg, "");

    const sum = mk("div"); sum.id = "ac-sum"; sum.style.fontWeight = "700";
    sum.textContent = "名簿 " + rows.length + "件 ： 新しく作る " + plan.fresh.length + "件 ／ すでにある " + plan.existing.length + "件 ／ 形式がおかしい " + plan.invalid.length + "件";
    pv.appendChild(sum);
    if (plan.fresh.length) {
      // クラスごとの人数（いまの名簿に無いクラス名＝打ち間違いの目印）
      const known = new Set(have.filter(p => p.role === "student").map(p => p.class_name).filter(Boolean)), by = new Map();
      plan.fresh.forEach(r => by.set(r.class_name, (by.get(r.class_name) || 0) + 1));
      const cls = mk("div"); cls.id = "ac-cls"; cls.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:.86rem;";
      cls.appendChild(mk("span", "muted", "新しく作る学生のクラス："));
      [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja")).forEach(([c, n]) => {
        const isNew = !known.has(c);
        cls.appendChild(mk("span", "tag " + (isNew ? "or" : "gr"), c + " " + n + "人" + (isNew ? "（新しいクラス名）" : "")));
      });
      pv.appendChild(cls);
      if ([...by.keys()].some(c => !known.has(c)))
        pv.appendChild(mk("div", "note", "「新しいクラス名」は、いまの名簿に無いクラスです。新しいクラスなら問題ありません。打ち間違いなら、名簿を直してからもう一度確認してください。"));
    }
    if (plan.invalid.length) {
      const d = listBox("形式がおかしい行（" + plan.invalid.length + "件・この行は作りません）",
        plan.invalid.map(x => x.row.line + "行目 ・ " + (x.row.student_no || "（学籍番号なし）") + " ・ " + reasonText(x.reason)));
      d.id = "ac-invalid"; d.open = true; pv.appendChild(d);
    }
    if (plan.existing.length) {
      const d = listBox("すでにある学籍番号（" + plan.existing.length + "件・作り直しません）", plan.existing.map(r => r.no));
      d.id = "ac-existing"; pv.appendChild(d);
    }
    if (plan.fresh.length) { issue.textContent = plan.fresh.length + "件のアカウントを発行する"; issue.hidden = false; }
    else pv.appendChild(mk("div", "note", "新しく作るアカウントはありません。"));
  }

  async function runIssue(msg, pv, issue, res, check) {
    const plan = P.plan;
    if (!plan || !plan.fresh.length) return;
    const ok = await askDialog({
      title: plan.fresh.length + "件のアカウントを発行しますか？",
      body: "・新しく作る " + plan.fresh.length + "件（すでにある " + plan.existing.length + "件・形式がおかしい " + plan.invalid.length + "件は作りません）\n"
        + "・初期パスワードは「scg＋学籍番号」です\n・発行したアカウントは、この画面からは消せません",
      okText: "発行する",
    });
    if (!ok) return;
    issue.disabled = true; check.disabled = true; res.replaceChildren();
    const total = plan.fresh.length, got = [];
    let stopped = null;
    try {
      for (let i = 0; i < total; i += CHUNK) {
        say(msg, "発行しています… " + i + " / " + total + "件");
        const part = plan.fresh.slice(i, i + CHUNK);
        try {
          const r = await api.fn("issue-accounts", { rows: part.map(x => ({ student_no: x.no, display_name: x.display_name, class_name: x.class_name })) });
          got.push(...((r && r.results) || []));
        } catch (e) { stopped = e; break; }
      }
    } finally { issue.disabled = false; check.disabled = false; }

    const made = got.filter(x => x.status === "created"), refused = got.filter(x => x.status !== "created");
    const unsent = total - got.length;
    if (stopped && !got.length) { say(msg, notReady(stopped) ? NOT_READY : "発行できませんでした（" + stopped.message + "）", "ng"); return; }
    P.plan = null; issue.hidden = true; pv.replaceChildren();
    say(msg, "");
    const sum = mk("div"); sum.id = "ac-done"; sum.style.fontWeight = "700"; sum.style.color = refused.length || unsent ? "#B45309" : "#047857";
    sum.textContent = "発行の結果 ： 作った " + made.length + "件 ／ 断られた " + refused.length + "件" + (unsent ? " ／ 送れなかった " + unsent + "件" : "");
    res.appendChild(sum);
    if (refused.length) {
      const d = listBox("断られた学籍番号と理由（" + refused.length + "件）", refused.map(x => (x.student_no || "（学籍番号なし）") + " ・ " + reasonText(x.reason)));
      d.id = "ac-refused"; d.open = true; res.appendChild(d);
    }
    if (unsent) res.appendChild(mk("div", "note", "途中で止まりました（" + (notReady(stopped) ? NOT_READY : stopped.message) + "）。残りは、もう一度「名簿を確認する」から発行してください。作り終えた分は「すでにある」に入ります。"));
    if (made.length) res.appendChild(mk("div", "note", "本人には、学籍番号と、初期パスワード（scg＋学籍番号）を伝えてください。最初のログインで、本人が新しいパスワードを決めます。"
      + "ログインは同じ場所から一度に大勢で行うと断られることがあるので、初回はクラスごとに分けてください。"));
  }

  function init() {
    const view = byId("view-students");
    if (!view) return;
    new MutationObserver(() => { if (!view.hidden) buildPanel(); }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
    if (!view.hidden) buildPanel();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  }

  const Accounts = { normalizeNo, parseRoster, rowsFromSheet, checkRow, classify, reasonText, CHUNK };
  if (typeof window !== "undefined") window.Accounts = Accounts;
  if (typeof module !== "undefined" && module.exports) module.exports = Accounts;
})();
