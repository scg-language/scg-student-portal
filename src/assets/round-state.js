/* アンケートの回の状態 — スマホ（master-phone.html）と PC（master.html / admin.js）で同じ線を引く（2026-11-20 きあ決定）
 *
 *   now  … いまの回。ホームの大きなカード／PC のチップの並びの前
 *   past … おわった回。「おわった アンケート」にしまう（見ることはできる）
 *          ・締切をすぎた回
 *          ・締切のない回で、はじめてから ARCHIVE_DAYS 日たったもの（HR は月1回＝1回ぶんは前に出しておく）
 *   void … 取り消した回。どこにも出さない（回答は消えていない＝集計から外れるだけ）
 *
 * ★「しまう」は表示の話だけ。締切のない回は past に入っても学生は答えられる（isClosed で見分ける）。
 * ★opens_at が無い回は「いつはじめたか分からない」ので、しまわない（欠けたデータで黙って隠さない）。
 */
(function (root) {
  "use strict";
  var ARCHIVE_DAYS = 30;
  var DAY = 86400000;
  function ms(x) { return x ? new Date(x).getTime() : NaN; }
  function isClosed(r, now) {
    now = now == null ? Date.now() : now;
    return !!(r && r.closes_at) && ms(r.closes_at) <= now;
  }
  function state(r, now) {
    now = now == null ? Date.now() : now;
    if (!r || r.is_void) return "void";
    if (isClosed(r, now)) return "past";
    if (!r.closes_at && r.opens_at && now - ms(r.opens_at) > ARCHIVE_DAYS * DAY) return "past";
    return "now";
  }
  /* おわった回の並び：しめきった（または はじめた）のが新しい順 */
  function pastOrder(a, b) { return (ms(b.closes_at) || ms(b.opens_at) || 0) - (ms(a.closes_at) || ms(a.opens_at) || 0); }
  var api = { ARCHIVE_DAYS: ARCHIVE_DAYS, state: state, isClosed: isClosed, pastOrder: pastOrder };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoundState = api;
})(typeof window !== "undefined" ? window : globalThis);
