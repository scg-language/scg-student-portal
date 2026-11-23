/* 学生アカウントの発行（Supabase Edge Function）                                   2026-11-24
 *
 * なぜここにあるか：アカウントは「Supabase の正規の口」で作る（2026-11-21 きあ・docs/schema-plan.md 5章の3）。
 *   DB から auth の表へ直接は書かない。ログイン用のアカウントを作る・消すのは、Auth の管理用 API だけ。
 *
 * 呼び方：POST /functions/v1/issue-accounts   本文 { "rows": [{student_no, display_name, class_name}, …] }（30件まで）
 *   Authorization: Bearer <押した人のログインのトークン>   ← 画面（src/assets/api.js の api.fn）が付ける
 * 返事：{ created, existing, invalid, failed, logged, results:[{student_no,status,reason}] }
 *
 * 分担（手順は core.mjs。ここは通信だけ）
 *   ・名簿の行を見る／名簿の行を付ける／操作の記録 ＝ DB の関数を「押した人の資格」で呼ぶ（発行できる人かは DB が見る）
 *   ・ログイン用のアカウントを作る・消す ＝ Auth の管理用 API（/auth/v1/admin/users）。強い鍵を使うのはここだけ
 *
 * 🔴 強い鍵（SUPABASE_SERVICE_ROLE_KEY）は、Supabase が Edge Function に渡すもの。リポ・画面・返事・ログに出さない
 * 🔴 ログ（console）に、学籍番号・氏名を出さない。出してよいのは件数と理由の符号だけ
 * ★置き方・確かめ方：このフォルダの README.md
 */
import { issueAccounts } from "./core.mjs";

const URL_BASE = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/* 呼んでよい画面の場所。増やすときは、Supabase の画面で ALLOWED_ORIGINS（カンマ区切り）を入れる */
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://apps.scg-language.com,https://scg-language.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

class Refused extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/* DB の関数を、押した人の資格で呼ぶ */
async function rpc(auth: string, name: string, args: unknown) {
  const res = await fetch(URL_BASE + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { "apikey": ANON, "Authorization": auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Refused(res.status, typeof b.message === "string" ? b.message : "確かめられませんでした");
  }
  return res.status === 204 ? null : await res.json().catch(() => null);
}

/* Auth の管理用 API */
async function adminFetch(path: string, init: RequestInit) {
  return await fetch(URL_BASE + "/auth/v1/admin/" + path, {
    ...init,
    headers: { "apikey": ADMIN, "Authorization": "Bearer " + ADMIN, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { message: "この呼び方はできません" });
  if (!URL_BASE || !ANON || !ADMIN) return json(req, 500, { message: "サーバーの準備ができていません" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth)) return json(req, 401, { message: "ログインが必要です" });

  let rows: unknown;
  try { rows = (await req.json())?.rows; } catch (_e) { rows = null; }
  if (!Array.isArray(rows)) return json(req, 400, { message: "名簿の形が正しくありません" });

  try {
    const out = await issueAccounts(rows, {
      precheck: (r: unknown) => rpc(auth, "issue_precheck", { p_rows: r }),
      createUser: async (email: string, password: string) => {
        const res = await adminFetch("users", {
          method: "POST",
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        const b = await res.json().catch(() => ({}));
        if (res.ok && typeof b.id === "string") return { id: b.id };
        const c = String(b.error_code ?? b.code ?? res.status);
        return { error: c === "email_exists" || c === "user_already_exists" ? "exists" : "auth_" + c };
      },
      attach: (id: string, no: string, name: string, cls: string) =>
        rpc(auth, "issue_attach_profile", { p_user: id, p_student_no: no, p_display_name: name, p_class_name: cls }),
      deleteUser: async (id: string) => {
        const res = await adminFetch("users/" + encodeURIComponent(id), { method: "DELETE" });
        if (!res.ok) throw new Error("delete " + res.status);
      },
      log: (c: { created: number; existing: number; invalid: number; failed: number }) =>
        rpc(auth, "issue_log", { p_created: c.created, p_existing: c.existing, p_invalid: c.invalid, p_failed: c.failed }),
    });
    console.log("issue-accounts", JSON.stringify({
      created: out.created, existing: out.existing, invalid: out.invalid, failed: out.failed, logged: out.logged,
    }));
    return json(req, 200, out);
  } catch (e) {
    const status = e instanceof Refused ? e.status : (e as { status?: number })?.status ?? 500;
    const safe = status >= 400 && status < 500;       // 断った理由（権限・形）は、そのまま返す。それ以外は中身を返さない
    if (!safe) console.error("issue-accounts error", status);
    return json(req, safe ? status : 500, { message: safe ? (e as Error).message : "発行できませんでした" });
  }
});
