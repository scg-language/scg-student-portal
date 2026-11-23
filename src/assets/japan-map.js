/* 押せる日本地図（2026-11-23）。ライブラリ依存ゼロ。地図の形は japan-map-data.js（JAPAN_MAP）。
 *
 * ■ 使い方
 *   const map = JapanMap.mount(置く場所, {
 *     groups: [{ v: "kyoto", codes: ["26"], at: [135, 262], label: "${京都}(きょうと)" }, …],
 *     isOn: v => 選ばれているか,            // 地図は自分では状態を持たない。聞くたびに答える
 *     onToggle: v => { … },                 // 押されたとき。状態を変えるのは呼ぶ側
 *     allOn: () => 全部に色を付けるか,      // 「日本のどこでも」など（省いてよい）
 *     ariaLabel: "…",
 *   });
 *   map.update();                           // 状態が変わったら呼ぶ（色を塗り直す）
 *
 *   groups[].codes … 都道府県コード（"01"〜"47"）。1つの選択肢に、いくつ入れてもよい
 *   groups[].at    … 名前の札を置く場所（地図の座標。幅400・高さ約446。札のまん中）
 *   groups[].label … 札の文。ルビの記法 ${漢字}(よみ) を使える
 *
 * ■ 考え方
 *   ・地図は「見て分かるため」、札は「押すため」。県の形は小さいので、札を大きくしてある（県を押しても同じ）
 *   ・地図だけに頼らない。呼ぶ側は、同じ選択肢の一覧も必ず出す（地図が出ない・読めない人のため）
 *   ・文字は textContent と要素の組み立てで入れる（innerHTML は使わない）
 *   ・沖縄は、実際の場所ではなく、左上の枠の中 */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = ["#2f7ed8", "#e8590c", "#2f9e44", "#9c36b5", "#c2255c", "#0c8599", "#a17100", "#5c7cfa"];
  function fillRuby(el, text) {
    const doc = el.ownerDocument, str = String(text == null ? "" : text), re = /\$\{([^}]*)\}\(([^)]*)\)/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) el.appendChild(doc.createTextNode(str.slice(last, m.index)));
      const ruby = doc.createElement("ruby"), rt = doc.createElement("rt");
      ruby.appendChild(doc.createTextNode(m[1])); rt.textContent = m[2]; ruby.appendChild(rt); el.appendChild(ruby);
      last = m.index + m[0].length;
    }
    if (last < str.length) el.appendChild(doc.createTextNode(str.slice(last)));
  }
  function mount(container, options) {
    const data = options.data || root.JAPAN_MAP, doc = container.ownerDocument;
    if (!data) return null;
    const groups = options.groups || [], isOn = options.isOn || (() => false), allOn = options.allOn || (() => false);
    const svgEl = (tag, attrs) => { const el = doc.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(k => el.setAttribute(k, attrs[k])); return el; };
    const groupOf = new Map();                       // 都道府県コード → その選択肢
    groups.forEach((g, i) => { g.color = g.color || COLORS[i % COLORS.length]; (g.codes || []).forEach(c => groupOf.set(c, g)); });

    const wrap = doc.createElement("div"); wrap.className = "jm";
    const svg = svgEl("svg", { viewBox: "0 0 " + data.w + " " + data.h, role: "img", "aria-label": options.ariaLabel || "日本地図" });
    const inset = data.inset;
    if (inset) svg.appendChild(svgEl("rect", { x: inset.x, y: inset.y, width: inset.w, height: inset.h, rx: 6, class: "jm-inset" }));
    const shapes = [];
    data.pref.forEach(p => {
      const g = groupOf.get(p.c), path = svgEl("path", { d: p.d, class: "jm-pref" + (g ? " jm-can" : "") });
      path.dataset.code = p.c;
      const title = svgEl("title"); title.textContent = p.ja; path.appendChild(title);
      if (g) { path.dataset.v = g.v; path.addEventListener("click", () => options.onToggle && options.onToggle(g.v)); }
      svg.appendChild(path); shapes.push({ path, g });
    });
    // 札から地域へ引く線（札は HTML で上に重ねる。線は地図の中）
    const lines = [];
    groups.forEach(g => {
      if (!g.at) return;
      const ps = data.pref.filter(p => (g.codes || []).includes(p.c));
      if (!ps.length) return;
      const to = g.to || [ps.reduce((s, p) => s + p.cx, 0) / ps.length, ps.reduce((s, p) => s + p.cy, 0) / ps.length];
      const line = svgEl("line", { x1: g.at[0], y1: g.at[1], x2: to[0], y2: to[1], class: "jm-line", stroke: g.color });
      svg.appendChild(line); lines.push({ line, g });
      svg.appendChild(svgEl("circle", { cx: to[0], cy: to[1], r: 2.6, fill: g.color, class: "jm-dot" }));
    });
    wrap.appendChild(svg);
    const chips = [];
    groups.forEach(g => {
      if (!g.at) return;
      const chip = doc.createElement("button");
      chip.type = "button"; chip.className = "jm-chip"; chip.dataset.v = g.v;
      chip.style.left = (g.at[0] / data.w * 100) + "%"; chip.style.top = (g.at[1] / data.h * 100) + "%";
      chip.style.setProperty("--jm-c", g.color);
      fillRuby(chip, g.label || g.v);
      chip.addEventListener("click", () => options.onToggle && options.onToggle(g.v));
      wrap.appendChild(chip); chips.push({ chip, g });
    });
    container.appendChild(wrap);
    function update() {
      const all = !!allOn();
      wrap.classList.toggle("jm-all", all);
      shapes.forEach(({ path, g }) => {
        const on = g ? !!isOn(g.v) : false;
        path.classList.toggle("jm-on", on);
        path.style.fill = g ? g.color : "";                 // 選べる地域は、札と同じ色。選ぶ前はうすく
        path.style.fillOpacity = g ? (on ? "1" : ".38") : "";
      });
      chips.forEach(({ chip, g }) => { const on = !!isOn(g.v); chip.classList.toggle("jm-on", on); chip.setAttribute("aria-pressed", on ? "true" : "false"); });
    }
    update();
    return { update, element: wrap };
  }
  root.JapanMap = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);
