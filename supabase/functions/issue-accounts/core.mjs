/* 学生アカウントの発行の「手順」だけ（通信しない。Deno にも Node にも寄らない）。
 *
 * 呼ぶ側（index.ts）が、下の5つの口を渡す。検査（tests/test_issue_accounts_core.cjs）は、にせの口を渡して手順を確かめる。
 *   precheck(rows)                 → { domain, results:[{student_no,status:'ok'|'invalid'|'existing',reason}] }  ＝DB（押した人の資格）
 *   createUser(email, password)    → { id } か { error:'exists' } か { error:'<理由の符号>' }               ＝Auth の管理用 API
 *   attach(id, no, name, cls)      → 何も返さない。だめなら投げる                                          ＝DB（押した人の資格）
 *   deleteUser(id)                 → 何も返さない                                                         ＝Auth の管理用 API
 *   log(counts)                    → 何も返さない                                                         ＝DB（押した人の資格）
 *
 * 🔴 学籍番号の形は、ここでは見ない。決まりは DB の app_hidden.normalize_student_no の1か所（precheck が返す番号を使う）
 * 🔴 返事・記録に、氏名を入れない。理由は符号だけ（文には値が混ざりうる）
 */
export const MAX_ROWS = 30;

/* はじめのパスワード。DB の my_password_is_initial / reset_student_password と同じ式（scg＋学籍番号） */
export const initialPassword = (no) => "scg" + no;

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
/* 理由の符号に使える文字だけ残す（英数字・_・-）。長さは40字まで */
const code = (v) => str(v).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "unknown";

export async function issueAccounts(rows, deps) {
  if (!Array.isArray(rows)) throw Object.assign(new Error("名簿の形が正しくありません"), { status: 400 });
  if (rows.length > MAX_ROWS) throw Object.assign(new Error("一度に発行できるのは30件までです"), { status: 400 });
  const clean = rows.map((r) => ({
    student_no: str(r && r.student_no), display_name: str(r && r.display_name), class_name: str(r && r.class_name),
  }));

  const pre = await deps.precheck(clean);       // 発行できる人でなければ、ここで DB が断る（投げる）
  const list = (pre && pre.results) || [];
  const domain = str(pre && pre.domain);
  if (!domain || list.length !== clean.length) throw Object.assign(new Error("名簿を確かめられませんでした"), { status: 500 });

  const results = [];
  for (let i = 0; i < clean.length; i++) {
    const p = list[i] || {}, no = str(p.student_no);
    if (p.status !== "ok") {
      results.push({ student_no: no, status: p.status === "existing" ? "existing" : "invalid", reason: p.reason || null });
      continue;
    }
    let made = null;
    try { made = await deps.createUser(no + "@" + domain, initialPassword(no)); }
    catch (e) { made = { error: "auth_call" }; }
    if (!made || !made.id) {
      const why = made && made.error;
      results.push(why === "exists"
        ? { student_no: no, status: "existing", reason: "login_exists" }
        : { student_no: no, status: "failed", reason: "error:" + code(why) });
      continue;
    }
    try {
      await deps.attach(made.id, no, clean[i].display_name, clean[i].class_name);
      results.push({ student_no: no, status: "created", reason: null });
    } catch (e) {
      // 名簿の行を付けられなかった → 作ったばかりのログイン用のアカウントを消して、半端を残さない
      let cleaned = true;
      try { await deps.deleteUser(made.id); } catch (e2) { cleaned = false; }
      results.push({ student_no: no, status: "failed", reason: cleaned ? "error:profile" : "error:profile_login_left" });
    }
  }

  const count = (s) => results.filter((x) => x.status === s).length;
  const out = { created: count("created"), existing: count("existing"), invalid: count("invalid"), failed: count("failed") };
  // 記録が書けなくても、作った結果は返す（返さないと、画面が「作れなかった」と見せてしまう）
  let logged = true;
  try { await deps.log(Object.assign({}, out)); } catch (e) { logged = false; }
  return Object.assign(out, { logged, results });
}
