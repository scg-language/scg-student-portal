/* Shared survey form: data-only definitions, language-independent answer values.
 * No API calls, credentials, storage, or student data are contained here.
 * read() keeps hidden drafts; validate().answers omits hidden/unknown fields.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SurveyForm = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MESSAGES = {
    ja: {
      choose: "選択してください", required: "回答してください。", choice: "選択肢から選んでください。",
      type: "回答の形式が正しくありません。", exclusive: "同時には選べない項目が含まれています。",
      date: "正しい日付を入力してください。", length: "入力が長すぎます。", empty: "1つ以上回答してください。",
      requiredMark: "必須", optional: "任意", multi: "複数選択可", identity: "あなたの情報",
      number: "学籍番号", name: "氏名", className: "クラス", advisor: "担任", unknown: "学校が確認します",
      num: "{min}〜{max}の数字を入力してください。", forgot: "おぼえていない"
    },
    en: {
      choose: "Please choose", required: "Please answer this question.", choice: "Please select a listed option.",
      type: "This answer has an invalid format.", exclusive: "Some selected options cannot be chosen together.",
      date: "Please enter a valid date.", length: "This answer is too long.", empty: "Please answer at least one question.",
      requiredMark: "Required", optional: "Optional", multi: "Select all that apply", identity: "Your information",
      number: "Student number", name: "Name", className: "Class", advisor: "Class teacher", unknown: "To be confirmed by the school",
      num: "Please enter a number from {min} to {max}.", forgot: "I do not remember"
    }
  };
  const UNKNOWN = "unknown";   // number の「おぼえていない」。保存する値（言語に依らない）
  function words(lang) { return MESSAGES[lang] || MESSAGES.ja; }
  function label(value, lang) {
    return value && typeof value === "object" ? (value[lang] || value.ja || value.en || "") : String(value || "");
  }
  function isVisible(q, answers) {
    if (!q.showWhen) return true;
    const value = (answers || {})[q.showWhen.key];
    return Array.isArray(value) ? value.includes(q.showWhen.is) : value === q.showWhen.is;
  }
  function canonical(q, raw) {
    if (q.t === "multi") return Array.isArray(raw) ? [...new Set(raw.filter(x => typeof x === "string").map(x => x.trim()).filter(Boolean))] : [];
    let value = typeof raw === "string" ? raw.trim() : "";
    // number: 全角の数字を半角にそろえる。「おぼえていない」は UNKNOWN という値で持つ
    if (q.t === "number") value = value.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    // Older surveys stored Japanese/English labels rather than option values.
    if (q.t === "select" && q.o) {
      const hit = q.o.find(o => o.v === value || o.ja === value || o.en === value);
      if (hit) value = hit.v;
    }
    return value;
  }
  function normalize(def, answers) {
    const source = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
    const all = Object.create(null), result = Object.create(null);
    (def.q || []).forEach(q => { all[q.k] = canonical(q, source[q.k]); });
    (def.q || []).forEach(q => { if (isVisible(q, all)) result[q.k] = all[q.k]; });
    return result;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split("-").map(Number);
    if (parts[0] < 1000) return false;
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return d.getUTCFullYear() === parts[0] && d.getUTCMonth() === parts[1] - 1 && d.getUTCDate() === parts[2];
  }
  function validate(def, raw, options) {
    const msg = words((options || {}).lang || "ja"), answers = normalize(def, raw), errors = [];
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    let filled = 0;
    for (const q of def.q || []) {
      if (!Object.prototype.hasOwnProperty.call(answers, q.k)) continue;
      const value = answers[q.k], original = source[q.k];
      const add = text => { if (!errors.some(e => e.key === q.k)) errors.push({key: q.k, message: text}); };
      if (q.t === "multi") {
        if (original != null && (!Array.isArray(original) || original.some(x => typeof x !== "string"))) add(msg.type);
      } else if (original != null && typeof original !== "string") add(msg.type);
      const has = Array.isArray(value) ? value.length > 0 : value !== "";
      if (has) filled++;
      if (q.required && !has) { add(msg.required); continue; }
      if (!has) continue;
      if (q.t === "select" && !(q.o || []).some(o => o.v === value)) add(msg.choice);
      if (q.t === "multi") {
        if (value.some(v => !(q.o || []).some(o => o.v === v))) add(msg.choice);
        if ((q.exclusive || []).some(v => value.includes(v)) && value.length > 1) add(msg.exclusive);
        if ((q.exclusiveGroups || []).some(group => group.filter(v => value.includes(v)).length > 1)) add(msg.exclusive);
      }
      if (q.t === "date" && !validDate(value)) add(msg.date);
      if (q.t === "number" && !(q.unknown && value === UNKNOWN)) {
        const min = q.min == null ? 0 : q.min, max = q.max == null ? 9999 : q.max;
        if (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max) add(msg.num.replace("{min}", min).replace("{max}", max));
      }
      if (typeof value === "string" && value.length > (q.maxLength || 2000)) add(msg.length);
    }
    if (!filled && !errors.length) errors.push({key: "", message: msg.empty});
    return {ok: errors.length === 0, answers, errors};
  }
  function mount(container, def, options) {
    options = options || {};
    const lang = options.lang || "ja", msg = words(lang), doc = container.ownerDocument;
    const initial = options.answers || {}, controls = new Map(), rows = new Map(), errorNodes = new Map();
    container.replaceChildren();
    container.classList.add("sv-form");
    const make = (tag, text, className) => {
      const el = doc.createElement(tag);
      if (text != null) el.textContent = text;
      if (className) el.className = className;
      return el;
    };
    if (def.studentIdentity) {
      const info = make("section", null, "sv-identity");
      info.appendChild(make("h2", msg.identity));
      const profile = options.profile || {};
      const fields = [[msg.number, profile.student_no], [msg.name, profile.display_name], [msg.className, profile.class_name], [msg.advisor, profile.teacher_name || profile.advisor_name]];
      const dl = make("dl");
      fields.forEach(([name, value]) => { dl.append(make("dt", name), make("dd", value || msg.unknown)); });
      info.appendChild(dl); container.appendChild(info);
    }
    let currentSection = "";
    const pages = [];          // [{key, title, keys:[], nodes:[]}] in order of appearance
    const pageOf = key => pages.findIndex(p => p.key === key);
    (def.q || []).forEach((q, i) => {
      const sectionKey = q.section || "";
      if (pageOf(sectionKey) < 0) {
        const section = (def.sections || []).find(s => s.key === sectionKey);
        pages.push({key: sectionKey, title: section ? label(section.title, lang) : "", keys: [], nodes: []});
      }
      const page = pages[pageOf(sectionKey)];
      if (q.section && q.section !== currentSection) {
        const section = (def.sections || []).find(s => s.key === q.section);
        if (section) { const h = make("h2", label(section.title, lang), "sv-section"); container.appendChild(h); page.nodes.push(h); }
        currentSection = q.section;
      }
      const id = "sv-" + q.k, field = make("div", null, "field sv-question");
      field.dataset.question = q.k;
      page.keys.push(q.k); page.nodes.push(field);
      const title = make("label", (i + 1) + ". " + label(q.l, lang));
      title.htmlFor = id;
      title.appendChild(make("span", q.required ? msg.requiredMark : msg.optional, "sv-required"));
      field.appendChild(title);
      if (q.hint) field.appendChild(make("p", label(q.hint, lang), "sv-hint"));
      let input;
      if (q.t === "multi") {
        input = make("div", null, "sv-options"); input.id = id;
        input.setAttribute("role", "group"); input.setAttribute("aria-label", label(q.l, lang));
        field.appendChild(make("p", msg.multi, "sv-hint"));
        (q.o || []).forEach(o => {
          const option = make("label", null, "sv-option"), box = make("input");
          box.type = "checkbox"; box.value = o.v; box.id = id + "-" + o.v;
          box.checked = Array.isArray(initial[q.k]) && initial[q.k].includes(o.v);
          option.append(box, make("span", label(o, lang))); input.appendChild(option);
          box.addEventListener("change", () => {
            if (box.checked) {
              const exclusive = q.exclusive || [];
              Array.from(input.querySelectorAll("input")).forEach(other => {
                if (other === box) return;
                if (exclusive.includes(box.value) || exclusive.includes(other.value) || (q.exclusiveGroups || []).some(group => group.includes(box.value) && group.includes(other.value))) other.checked = false;
              });
            }
            updateVisibility(); clearErrors();
          });
        });
      } else if (q.t === "select") {
        input = make("select"); input.id = id;
        const empty = make("option", msg.choose); empty.value = ""; input.appendChild(empty);
        (q.o || []).forEach(o => { const option = make("option", label(o, lang)); option.value = o.v; input.appendChild(option); });
        input.value = canonical(q, initial[q.k]);
      } else if (q.t === "number") {
        // 数字の欄。q.unknown があれば「おぼえていない」のチェックを下に付ける（どちらか片方だけが入る）
        input = make("div", null, "sv-number");
        const num = make("input"); num.id = id; num.type = "text"; num.inputMode = "numeric"; num.maxLength = 6; num.autocomplete = "off";
        const first = canonical(q, initial[q.k]);
        num.value = first === UNKNOWN ? "" : first;
        if (q.ph) num.placeholder = label(q.ph, lang);
        input.appendChild(num);
        if (q.unknown) {
          const option = make("label", null, "sv-option"), box = make("input");
          box.type = "checkbox"; box.id = id + "-unknown"; box.checked = first === UNKNOWN;
          option.append(box, make("span", msg.forgot)); input.appendChild(option);
          box.addEventListener("change", () => { if (box.checked) num.value = ""; });
          num.addEventListener("input", () => { if (num.value) box.checked = false; });
        }
      } else {
        input = make("input"); input.id = id; input.type = q.t === "date" ? "date" : "text";
        input.value = canonical(q, initial[q.k]);
        if (q.ph) input.placeholder = label(q.ph, lang);
        if (q.t !== "date") input.maxLength = q.maxLength || 2000;
      }
      input.setAttribute("aria-describedby", id + "-error");
      input.addEventListener("input", () => { updateVisibility(); clearErrors(); });
      input.addEventListener("change", () => { updateVisibility(); clearErrors(); });
      field.appendChild(input);
      const error = make("p", "", "sv-field-error"); error.id = id + "-error"; error.hidden = true;
      field.appendChild(error); container.appendChild(field);
      controls.set(q.k, input); rows.set(q.k, field); errorNodes.set(q.k, error);
    });
    function read() {
      const result = Object.create(null);
      (def.q || []).forEach(q => {
        const el = controls.get(q.k);
        if (q.t === "multi") result[q.k] = Array.from(el.querySelectorAll("input:checked"), x => x.value);
        else if (q.t === "number") result[q.k] = el.querySelector("input[type=checkbox]:checked") ? UNKNOWN : el.querySelector("input").value;
        else result[q.k] = el.value;
      });
      return result;
    }
    function updateVisibility() {
      const values = read();
      let visibleNumber = 0;
      (def.q || []).forEach(q => {
        const hidden = !isVisible(q, values), row = rows.get(q.k);
        row.hidden = hidden;
        if (!hidden) row.firstElementChild.firstChild.nodeValue = (++visibleNumber) + ". " + label(q.l, lang);
        row.querySelectorAll("input, select").forEach(el => { el.disabled = hidden; });
      });
    }
    function clearErrors() {
      errorNodes.forEach(el => { el.textContent = ""; el.hidden = true; });
      controls.forEach(el => { el.removeAttribute("aria-invalid"); });
    }
    function showErrors(errors) {
      clearErrors();
      errors.forEach(error => {
        const el = errorNodes.get(error.key);
        if (el) { el.textContent = error.message; el.hidden = false; controls.get(error.key).setAttribute("aria-invalid", "true"); }
      });
      const first = errors.find(error => rows.has(error.key));
      if (first) {
        const input = controls.get(first.key);
        (input.matches("input,select") ? input : input.querySelector("input"))?.focus();
        rows.get(first.key).scrollIntoView({block: "center", behavior: "smooth"});
      }
    }
    /* Paging (2026-11): one page per section. Only the caller decides to page;
     * without showPage() every question stays on one screen (preview page, old surveys). */
    let current = -1;
    function showPage(index) {
      current = Math.max(0, Math.min(index, pages.length - 1));
      pages.forEach((p, i) => p.nodes.forEach(node => node.classList.toggle("sv-page-off", i !== current)));
      return current;
    }
    function pageErrors(index) {
      const keys = (pages[index] || {keys: []}).keys;
      return validate(def, read(), {lang}).errors.filter(e => keys.includes(e.key));
    }
    function pageOfKey(key) { return pages.findIndex(p => p.keys.includes(key)); }
    updateVisibility();
    return {read, showErrors, validate: () => validate(def, read(), {lang}), clearErrors,
      pages: () => pages.map(p => ({key: p.key, title: p.title})), showPage, page: () => current, pageErrors, pageOfKey};
  }
  /* A plain-text copy of submitted answers, for the receipt. Values are labels in the
   * given language; the caller must insert them with textContent (never innerHTML). */
  function describe(def, answers, lang) {
    lang = lang || "ja";
    const values = normalize(def, answers), out = [];
    (def.q || []).forEach(q => {
      if (!Object.prototype.hasOwnProperty.call(values, q.k)) return;
      const v = values[q.k], pick = x => { const o = (q.o || []).find(o => o.v === x); return o ? label(o, lang) : x; };
      const text = Array.isArray(v) ? v.map(pick).join(lang === "ja" ? "、" : ", ")
        : q.t === "select" ? (v ? pick(v) : "") : (q.t === "number" && v === UNKNOWN ? words(lang).forgot : v);
      const section = (def.sections || []).find(s => s.key === q.section);
      out.push({key: q.k, section: section ? label(section.title, lang) : "", label: label(q.l, lang), value: text});
    });
    return out;
  }
  return {normalize, validate, isVisible, mount, validDate, describe, UNKNOWN};
});
