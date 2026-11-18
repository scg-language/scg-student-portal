/* 画面で作ったアンケート定義（DB の survey_defs）を読み書きする — 2026-11-18
 *
 * ★考え方: 読み込んだ定義は surveys.js の SURVEYS 配列へ足す（key＝survey_key）。
 *   そうすれば、学生画面・結果の画面・回をはじめるダイアログなど、SURVEYS を引いている所が
 *   1行も変えずに DB の定義も扱える。
 *   - 学生（index.html）…… 自分に開いている回の key のうち、SURVEYS に無いものだけ取りに行く（RLS で公開中だけ返る）
 *   - 職員（master.html）… 全部読む。SURVEYS へ足すのは「公開中」だけ（下書き・しまったものはここの rows にだけ持つ）
 *
 * 🔴 守ること
 *   - 定義は職員が画面で書いたもの＝描くときは必ず textContent（survey-form.js・index.html は既にそうなっている）
 *   - color は CSS の値に入るので、ここで #rrggbb 以外を捨てる
 *   - 書けるのはマスターだけ（サーバーの save_survey_def / set_survey_def_status が is_master() で断る）
 *
 * 依存: api（assets/api.js）, SURVEYS（assets/surveys.js） */
(function () {
  "use strict";
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const state = { rows: [], rounds: {}, loadedAt: 0 };

  function clean(key, def) {
    const d = Object.assign({}, def || {});
    d.key = key;
    if (!COLOR_RE.test(String(d.color || ""))) d.color = "#1769aa";
    if (typeof d.sb !== "string" || !d.sb.trim()) d.sb = "Survey";
    if (!d.title || typeof d.title !== "object") d.title = { ja: key };
    if (!Array.isArray(d.q)) d.q = [];
    delete d.previewOnly;                     // 画面で作ったものに確認用の印は無い
    return d;
  }
  function put(row) {
    const def = clean(row.survey_key, row.def);
    const i = SURVEYS.findIndex(s => s.key === def.key);
    if (i === -1) SURVEYS.push(def); else if (SURVEYS[i]._db) SURVEYS[i] = def;
    def._db = true;                           // 画面で作った印（surveys.js の定義と見分ける）
    return def;
  }
  function drop(key) {
    const i = SURVEYS.findIndex(s => s.key === key && s._db);
    if (i !== -1) SURVEYS.splice(i, 1);
  }

  /* 学生：回の key のうち、まだ定義が無いものだけ読む。読めなくても画面は出す（その回が出ないだけ） */
  async function ensure(keys) {
    const want = [...new Set((keys || []).filter(k => k && !SURVEYS.some(s => s.key === k)))];
    if (!want.length) return;
    try {
      const rows = await api.get("/rest/v1/survey_defs?select=survey_key,def&survey_key=in.("
        + want.map(encodeURIComponent).join(",") + ")");
      (rows || []).forEach(put);
    } catch (e) { /* 定義が読めない回は出さない（index.html の filter が落とす） */ }
  }

  /* 職員：全部読む＋回をはじめた本数（直せるかどうかの判定に使う） */
  async function loadAll() {
    const rows = await api.get("/rest/v1/survey_defs?select=survey_key,def,status,created_at,updated_at,published_at&order=created_at.desc");
    state.rows = (rows || []).map(r => Object.assign({}, r, { def: clean(r.survey_key, r.def) }));
    state.rounds = {};
    if (state.rows.length) {
      const keys = state.rows.map(r => r.survey_key);
      const rr = await api.get("/rest/v1/survey_rounds?select=survey_key&survey_key=in.(" + keys.map(encodeURIComponent).join(",") + ")");
      (rr || []).forEach(r => { state.rounds[r.survey_key] = (state.rounds[r.survey_key] || 0) + 1; });
    }
    state.rows.forEach(r => { if (r.status === "published") put(r); else drop(r.survey_key); });
    state.loadedAt = Date.now();
    return state.rows;
  }

  const row = key => state.rows.find(r => r.survey_key === key) || null;
  /* 一覧に出す順＝コードの定義 → 画面で作った公開中 → 下書き → しまったもの */
  function list() {
    const code = SURVEYS.filter(s => !s._db).map(def => ({ key: def.key, def, source: "code", status: "published", rounds: null }));
    const order = { published: 0, draft: 1, archived: 2 };
    const db = state.rows.slice().sort((a, b) => order[a.status] - order[b.status])
      .map(r => ({ key: r.survey_key, def: r.def, source: "db", status: r.status, rounds: state.rounds[r.survey_key] || 0, row: r }));
    return code.concat(db);
  }
  function find(key) { return list().find(x => x.key === key) || null; }

  async function save(key, def) {
    const body = Object.assign({}, def); delete body.key; delete body._db;
    return api.rpc("save_survey_def", { p_survey_key: key || null, p_def: body });
  }
  async function setStatus(key, status) {
    return api.rpc("set_survey_def_status", { p_survey_key: key, p_status: status });
  }

  window.SurveyDB = { ensure, loadAll, list, find, row, save, setStatus, clean, _state: state };
})();
