// app.js — agent-diff-guard 控制台逻辑(原生 JS,零依赖、零构建)。
//
// 设计:一个极小的 h() 渲染器 + 全局 state + 按路由重渲染。
// 所有数据来自本机只读 API,无任何硬编码业务数据。
// 隐私:diff 正文由本机 API 实时从 git 取,只在浏览器内存里,不落盘、不上传。

"use strict";

/* ============================================================
   1. 极小 hyperscript + 渲染
   ============================================================ */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const F = (...children) => { const f = document.createDocumentFragment(); for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; f.appendChild(c.nodeType ? c : document.createTextNode(String(c))); } return f; };

/* ============================================================
   2. Lucide 图标(内联 SVG path,离线可用)
   ============================================================ */
const ICONS = {
  Shield: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  ShieldCheck: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z|M9 12l2 2 4-4",
  ListChecks: "M3 17l2 2 4-4|M3 7l2 2 4-4|M13 6h8|M13 12h8|M13 18h8",
  ScrollText: "M15 12h-5|M15 8h-5|M19 17V5a2 2 0 0 0-2-2H4|M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 0 0-2-2",
  SlidersHorizontal: "M21 4h-7|M10 4H3|M21 12h-9|M8 12H3|M21 20h-5|M12 20H3|M14 2v4|M8 10v4|M16 18v4",
  PlaneTakeoff: "M2 22h20|M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z",
  Map: "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z|M9 4v13|M15 7v13",
  Activity: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  Inbox: "M22 12h-6l-2 3h-4l-2-3H2|M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  Sparkles: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z",
  ArrowRight: "M5 12h14|M12 5l7 7-7 7",
  Check: "M20 6 9 17l-5-5",
  CornerUpLeft: "M20 20v-7a4 4 0 0 0-4-4H4|M9 14l-5-5 5-5",
  Scale: "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z|m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z|M7 21h10|M12 3v18|M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2",
  TriangleAlert: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z|M12 9v4|M12 17h.01",
  Copy: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2|M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z",
  Send: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z|m21.854 2.147-10.94 10.939",
  Clock: "M12 6v6l4 2|M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  FileSearch: "M14 2v4a2 2 0 0 0 2 2h4|M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3|M5 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|m9 18-1.5-1.5",
  RefreshCw: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16|M8 16H3v5",
  WifiOff: "M12 20h.01|M8.5 16.429a5 5 0 0 1 7 0|M5 12.859a10 10 0 0 1 5.17-2.69|M19 12.859a10 10 0 0 0-2.007-1.523|M2 8.82a15 15 0 0 1 4.177-2.643|M22 8.82a15 15 0 0 0-11.288-3.764|m2 2 20 20",
  // ── 命令面板 / 问守门人 用到的图标(lucide path) ──
  Search: "m21 21-4.34-4.34|M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  MessageSquareText: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z|M7 9h10|M7 13h6",
  HardDrive: "M22 12H2|M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z|M6 16h.01|M10 16h.01",
  Cloud: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z",
  ChevronDown: "m6 9 6 6 6-6",
  ArrowUp: "m5 12 7-7 7 7|M12 19V5",
  X: "M18 6 6 18|m6 6 12 12",
  Crosshair: "M22 12h-4|M6 12H2|M12 6V2|M12 22v-4|M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  FileWarning: "M14 2v4a2 2 0 0 0 2 2h4|M4 22V4a2 2 0 0 1 2-2h8l6 6v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z|M12 9v4|M12 17h.01",
};
function Icon(name, size = 16, style) {
  const wrap = h("span", { class: "ic", style });
  const paths = (ICONS[name] || "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0").split("|");
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => (d.includes("m-8") || d.includes("a8 8") ? `<circle cx="12" cy="12" r="8"/>` : `<path d="${d}"/>`)).join("")}</svg>`;
  return wrap;
}

/* ============================================================
   3. 工具
   ============================================================ */
const $ = (s) => document.querySelector(s);
const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(Math.round(n)));
const fmtDur = (ms) => { const hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000); return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`; };
const fmtTime = (iso) => { if (!iso) return "—"; const d = new Date(iso); if (isNaN(d)) return iso; return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-"); };
const ago = (iso) => { if (!iso) return "—"; const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return "刚刚"; if (s < 3600) return Math.floor(s / 60) + " 分钟前"; if (s < 86400) return Math.floor(s / 3600) + " 小时前"; return Math.floor(s / 86400) + " 天前"; };
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + " → " + r.status);
  return r.json();
}
function toast(text, icon = "Check") {
  const el = h("div", { class: "toast" }, Icon(icon, 14), text);
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s, transform .3s"; el.style.opacity = "0"; el.style.transform = "translateY(8px)"; setTimeout(() => el.remove(), 320); }, 2400);
}

/* 单例图表 tooltip:跟随鼠标显示数值。SVG 柱子 hover 时调 showTip/hideTip。 */
let _tip = null;
function tipEl() { if (!_tip) { _tip = h("div", { class: "chart-tip" }); document.body.appendChild(_tip); } return _tip; }
function showTip(evt, html) { const t = tipEl(); t.innerHTML = html; t.classList.add("on"); moveTip(evt); }
function moveTip(evt) { const t = tipEl(); const x = evt.clientX + 14, y = evt.clientY - 10; t.style.left = Math.min(x, window.innerWidth - t.offsetWidth - 8) + "px"; t.style.top = Math.max(8, y - t.offsetHeight) + "px"; }
function hideTip() { if (_tip) _tip.classList.remove("on"); }

/* ============================================================
   4. 通用片段
   ============================================================ */
function SectionTitle(label, hint, right) {
  return h("div", { class: "sec-title" },
    h("div", null, h("span", { class: "ds-label sec-label" }, label), hint && h("span", { class: "sec-hint" }, hint)),
    right && h("div", { class: "sec-right" }, right));
}
function Card(props, ...kids) { return h("div", { class: "card " + (props.class || ""), style: props.style, onClick: props.onClick }, ...kids); }
function Stat(value, label, sub, tone) {
  return h("div", { class: "card stat" },
    h("div", { class: "stat-n" + (tone ? " tone-" + tone : "") }, value),
    h("div", { class: "stat-l" }, label),
    sub && h("div", { class: "stat-s" }, sub));
}
function LevelPill(level) {
  const map = { wake: ["WAKE-YOU-UP", "pill-wake"], look: ["LOOK-ONCE", "pill-look"], pass: ["放行", "pill-pass"] };
  const [t, c] = map[level] || [level, ""];
  return h("span", { class: "pill " + c }, t);
}
function Chip(text) { return h("span", { class: "chip-rule" }, text); }
const ORIGIN_META = { live: ["实时", "origin-live"], history: ["历史", "origin-history"], demo: ["演示", "origin-demo"] };
function OriginBadge(origin) { const m = ORIGIN_META[origin]; return m ? h("span", { class: "origin " + m[1] }, m[0]) : false; }
function Btn(label, { kind = "primary", icon, onClick, small } = {}) {
  return h("button", { class: `btn btn-${kind}` + (small ? " btn-sm" : ""), onClick }, icon && Icon(icon, small ? 13 : 15), label);
}
function Empty(text, icon = "Inbox") { return h("div", { class: "empty" }, Icon(icon, 24), h("div", null, text)); }
function ErrBar(msg) { return h("div", { class: "err-bar" }, Icon("WifiOff", 15), msg); }
function skeletonStats(n = 4) { return h("div", { class: "stat-row" }, ...Array.from({ length: n }, () => h("div", { class: "skel skel-stat" }))); }

/* SVG 图表:14 天风险堆叠条 */
const svgNS = "http://www.w3.org/2000/svg";
function svg(s, attrs) { const el = document.createElementNS(svgNS, s); if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
function RiskBars(rows, height = 132, onPick) {
  const W = 720, H = height, P = 22;
  const max = Math.max(1, ...rows.map((r) => r.pass + r.look + r.wake));
  const step = (W - P * 2) / Math.max(1, rows.length);
  const bw = Math.min(26, step * 0.62);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  root.appendChild(svg("line", { x1: P, y1: H - P, x2: W - P, y2: H - P, stroke: "var(--border-subtle)" }));
  rows.forEach((r, i) => {
    const x = P + i * step + (step - bw) / 2;
    let y = H - P;
    const hOf = (v) => (v / max) * (H - P * 2);
    [["pass", "var(--heatmap-low)"], ["look", "var(--warning)"], ["wake", "var(--error)"]].forEach(([k, color]) => {
      const v = r[k]; if (!v) return;
      const ht = Math.max(2, hOf(v)); y -= ht;
      root.appendChild(svg("rect", { x, y, width: bw, height: ht, rx: 2, fill: color }));
    });
    // 透明 hit 区:覆盖整列高度,hover 出数值 tooltip,点击可下钻(onPick)
    const hit = svg("rect", { x: x - (step - bw) / 2, y: P, width: step, height: H - P * 2, fill: "transparent", class: onPick ? "chart-hit" : "" });
    const total = r.pass + r.look + r.wake;
    hit.addEventListener("mousemove", (e) => showTip(e, `<b>${r.date}</b><br>wake ${r.wake} · look ${r.look} · 放行 ${r.pass}<br>共 ${total} 次扫描`));
    hit.addEventListener("mouseleave", hideTip);
    if (onPick) hit.addEventListener("click", () => { hideTip(); onPick(r); });
    root.appendChild(hit);
    if (i % 2 === 0) { const t = svg("text", { x: x + bw / 2, y: H - 7, "text-anchor": "middle", "font-size": "9.5", fill: "var(--fg-subtle)", "font-family": "var(--font-mono)" }); t.textContent = r.date.slice(5); root.appendChild(t); }
  });
  return root;
}
function DailyBars(rows, selDate, onPick) {
  const W = 720, H = 150, P = 24;
  const data = [...rows].reverse(); // rows 是日期降序,reverse 成升序(左旧右新)
  const max = Math.max(1, ...data.map((r) => r.v));
  const step = (W - P * 2) / Math.max(1, data.length);
  const bw = Math.min(30, step * 0.6);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  root.appendChild(svg("line", { x1: P, y1: H - P, x2: W - P, y2: H - P, stroke: "var(--border-subtle)" }));
  data.forEach((r, i) => {
    const ht = Math.max(2, (r.v / max) * (H - P * 2));
    const x = P + i * step + (step - bw) / 2;
    const isToday = i === data.length - 1; // 最右是今天
    const isSel = selDate ? r.label === selDate : isToday; // 未选时高亮今天
    // 选中:accent 实心 + 顶部小标记;今天但未选:accent 浅;其余:低饱和
    const fill = isSel ? "var(--accent)" : isToday ? "var(--heatmap-mid)" : "var(--heatmap-low)";
    root.appendChild(svg("rect", { x, y: H - P - ht, width: bw, height: ht, rx: 3, fill }));
    if (isSel) root.appendChild(svg("circle", { cx: x + bw / 2, cy: H - P - ht - 7, r: 3, fill: "var(--accent)" }));
    const hit = svg("rect", { x: x - (step - bw) / 2, y: P, width: step, height: H - P * 2, fill: "transparent", class: "chart-hit" });
    hit.addEventListener("mousemove", (e) => showTip(e, `<b>${r.label}</b>${isToday ? " · 今天" : ""}<br>${fmtK(r.v)} token · 点击看当天明细`));
    hit.addEventListener("mouseleave", hideTip);
    hit.addEventListener("click", () => { hideTip(); onPick && onPick(isToday ? null : r.label); });
    root.appendChild(hit);
    if (i % 2 === 0) { const t = svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "font-size": "9.5", fill: isSel ? "var(--accent)" : "var(--fg-subtle)", "font-family": "var(--font-mono)" }); t.textContent = r.label.slice(5); root.appendChild(t); }
  });
  return root;
}
function DriftMeter(value) {
  const pct = Math.round((value ?? 0) * 100);
  const tone = value >= 0.6 ? "var(--error)" : value >= 0.3 ? "var(--warning)" : "var(--success)";
  return h("div", { class: "drift" },
    h("div", { class: "drift-track" }, h("div", { class: "drift-fill", style: { width: pct + "%", background: tone } })),
    h("span", { class: "mono drift-num" }, value == null ? "—" : pct + "%"));
}
function DiffBlock(lines) {
  return h("div", { class: "diff" }, ...(lines || []).map((l) =>
    h("div", { class: "diff-line " + (l.t === "+" ? "diff-add" : l.t === "-" ? "diff-del" : "") },
      h("span", { class: "diff-sign" }, l.t === " " ? "" : l.t), h("span", null, l.s))));
}
function HeatDot(heat) {
  const colors = ["var(--heatmap-empty)", "var(--heatmap-low)", "var(--heatmap-mid)", "var(--heatmap-high)"];
  return h("span", { class: "heat-dots" }, ...[1, 2, 3].map((n) =>
    h("i", { style: { background: n <= heat ? colors[heat] : "var(--heatmap-empty)" } })));
}

/* ============================================================
   5. 全局状态 + 导航
   ============================================================ */
const NAV = [
  { group: "守门 GUARD", items: [
    { id: "overview", label: "总览", en: "OVERVIEW", icon: "Shield" },
    { id: "queue", label: "审查队列", en: "QUEUE", icon: "ListChecks", badge: "queue" },
    { id: "audit", label: "守门记录", en: "AUDIT", icon: "ScrollText" },
    { id: "rules", label: "规则", en: "RULES", icon: "SlidersHorizontal" },
  ]},
  { group: "飞行记录 FLIGHT", items: [
    { id: "flight", label: "越界记录", en: "VIOLATIONS", icon: "PlaneTakeoff" },
    { id: "danger", label: "危险地图", en: "DANGER MAP", icon: "Map" },
  ]},
  { group: "用量 USAGE", items: [{ id: "usage", label: "用量与成本", en: "COST", icon: "Activity" }] },
  { group: "闭环 LOOP", items: [{ id: "inbox", label: "终端信箱", en: "INBOX", icon: "Inbox", badge: "inbox" }] },
];
const PAGE_TITLE = {
  overview: ["总览", "今天该不该担心,一眼看完"],
  queue: ["审查队列", "被刹住的改动在这里等你裁决 —— 放行、驳回或标记误报"],
  audit: ["守门记录", "每一次扫描与处置的完整留痕"],
  rules: ["规则", "命中、级别与精度 —— 误报是头号死因"],
  flight: ["飞行记录 · 越界", "agent 有没有违反人定下的规矩"],
  danger: ["危险地图", "把守门人的判断,变成 agent 编码前的输入"],
  usage: ["用量与成本", "一个人 × N 个 agent,烧了多少"],
  inbox: ["终端信箱", "面板裁决 → 指令 → 终端 agent 取走执行"],
};

const state = {
  route: (() => { try { return localStorage.getItem("adg-route") || "overview"; } catch { return "overview"; } })(),
  decisions: (() => { try { return JSON.parse(localStorage.getItem("adg-decisions") || "{}"); } catch { return {}; } })(),
  cache: {},
  badges: { queue: 0, inbox: 0 },
};
function persistDecisions() { try { localStorage.setItem("adg-decisions", JSON.stringify(state.decisions)); } catch {} }
function nav(r) { state.route = r; try { localStorage.setItem("adg-route", r); } catch {} render(); }

/* ============================================================
   6. 应用壳渲染
   ============================================================ */
function render() {
  const [title, subtitle] = PAGE_TITLE[state.route];
  const root = $("#root");
  root.innerHTML = "";
  root.appendChild(
    h("div", { class: "shell" },
      h("aside", { class: "side" },
        h("div", { class: "brand" },
          h("div", { class: "brand-mark" }, Icon("Shield", 18)),
          h("div", null, h("div", { class: "brand-name" }, "AGENT-DIFF-GUARD"),
            h("div", { class: "brand-sub", title: "合并前的 AI agent 改动守门人:平时放行,关键时刻刹车。wake-you-up=该半夜叫醒你确认的高危改动;look-once=看一眼即可的常规改动。" }, "数据本地存储 · Ask Guard 联网除外"))),
        h("nav", { class: "nav" }, ...NAV.map((g) =>
          h("div", { class: "nav-group" },
            h("div", { class: "ds-label nav-head" }, g.group),
            ...g.items.map((it) => {
              const badge = it.badge ? state.badges[it.badge] : 0;
              return h("button", { class: "nav-item" + (state.route === it.id ? " on" : ""), onClick: () => nav(it.id) },
                Icon(it.icon, 16),
                h("span", { class: "nav-label" }, it.label),
                badge > 0 ? h("span", { class: "nav-badge" + (it.badge === "inbox" ? " look" : "") }, badge) : h("span", { class: "nav-en" }, it.en));
            })))),
        h("div", { class: "side-foot" },
          h("div", { class: "side-status" }, h("span", { class: "dot dot-pass dot-live" }), h("span", { id: "side-repos" }, "守门中")),
          h("button", { class: "side-reset", onClick: () => { state.decisions = {}; persistDecisions(); render(); toast("已重置本地裁决记录", "RefreshCw"); } }, "重置本地裁决"))),
      h("div", { class: "main" },
        h("header", { class: "topbar" },
          h("div", null, h("h1", { class: "top-title" }, title), h("div", { class: "top-sub" }, subtitle)),
          h("div", { class: "top-right" },
            h("div", { class: "searchbox", onClick: openPalette, role: "button", "aria-label": "搜索(⌘K)" },
              Icon("Search", 15),
              h("span", { class: "searchbox-ph" }, "搜索发现、规则,或问守门人…"),
              h("kbd", { class: "searchbox-kbd" }, "⌘K")),
            h("button", { class: "btn btn-ghost btn-sm", onClick: () => { state.cache = {}; render(); renderOverlays(); toast("已刷新", "RefreshCw"); } }, Icon("RefreshCw", 13), "刷新"))),
        h("div", { class: "content" }, h("div", { class: "page", id: "page" }, skeletonStats())))));

  PAGES[state.route]();
  refreshBadges();
}

async function refreshBadges() {
  try {
    const [q, inbox] = await Promise.all([
      state.cache.findings ? Promise.resolve(state.cache.findings) : api("/api/findings"),
      api("/api/inbox/list"),
    ]);
    state.cache.findings = q;
    state.badges.queue = q.filter((f) => !state.decisions[f.id]).length;
    state.badges.inbox = inbox.filter((i) => i.status === "pending").length;
    const repoCount = new Set(q.map((f) => f.repo)).size;
    const sr = $("#side-repos"); if (sr) sr.textContent = repoCount ? `守门中 · ${repoCount} 仓库` : "守门中";
  } catch {}
  rerenderNavBadges();
  if (document.getElementById("ai-overlay")) renderOverlays(); // 同步 orb badge / nudge
}
function rerenderNavBadges() {
  document.querySelectorAll(".nav-group").forEach((grp, gi) => {
    NAV[gi].items.forEach((it, ii) => {
      const btn = grp.querySelectorAll(".nav-item")[ii];
      if (!btn) return;
      const badge = it.badge ? state.badges[it.badge] : 0;
      const last = btn.lastChild;
      if (badge > 0) {
        if (!last.classList || !last.classList.contains("nav-badge")) last.replaceWith(h("span", { class: "nav-badge" + (it.badge === "inbox" ? " look" : "") }, badge));
        else last.textContent = badge;
      }
    });
  });
}

/* ============================================================
   7. 页面加载封装
   ============================================================ */
function setPage(node) { const p = $("#page"); if (p) { p.innerHTML = ""; p.appendChild(node); } }
async function loadPage(fetcher, view, skeleton) {
  setPage(skeleton || skeletonStats());
  try {
    const data = await fetcher();
    setPage(view(data));
  } catch (e) {
    setPage(h("div", null, ErrBar("数据加载失败:" + e.message + " —— 确认 `agent-diff-guard serve` 在跑")));
  }
}

const PAGES = {
  overview: () => loadPage(
    async () => {
      const [ov, tl, disp] = await Promise.all([api("/api/stats/overview"), api("/api/stats/timeline"), api("/api/stats/dispositions")]);
      const findings = state.cache.findings || (state.cache.findings = await api("/api/findings"));
      return { ov, tl, disp, findings };
    },
    ({ ov, tl, disp, findings }) => {
      const pending = findings.filter((f) => !state.decisions[f.id]);
      const wakeN = pending.filter((f) => f.level === "wake").length;
      const lookN = pending.filter((f) => f.level === "look").length;
      const calm = wakeN === 0;
      const rows = tl.map((r) => ({ date: r.date, pass: r.passCount, look: r.lookCount, wake: r.wakeCount })).slice(-14);
      const activity = disp.slice(0, 6).map((d) => ({
        id: d.id,
        time: fmtTime(d.timestamp),
        repo: d.repoAlias || d.gitRange || "本地",
        kind: d.disposition === "blocked" ? "wake" : d.wakeCount > 0 ? "look" : "pass",
        text: d.disposition === "blocked" ? `push 被刹住 —— ${d.wakeCount} 处 wake-you-up` : d.rulesTriggered.length ? `命中 ${d.rulesTriggered.join("、")}${d.disposition === "auto-pass" ? ",未阻断" : ""}` : "扫描通过,放行",
      }));
      // 点活动项 → 跳守门记录并自动展开那一条
      const gotoAudit = (id) => { if (id) auditOpen.add(id); nav("audit"); };
      return F(
        Card({ class: "verdict " + (calm ? "verdict-calm" : "verdict-alert") },
          h("div", { class: "verdict-left" },
            h("span", { class: "ds-label verdict-tag" }, calm ? "今日态势 · 平静" : "今日态势 · 需要你"),
            // 产品定位一句话(P1-7):新用户 5 秒看懂这是什么
            h("p", { class: "verdict-tagline" }, "AI agent 改动守门人 —— 平时放行,关键时刻刹车。"),
            h("h2", { class: "verdict-h" }, calm ? "没有该惊醒你的东西。" : `有 ${wakeN} 处该看一眼。`),
            h("p", { class: "verdict-p" }, calm
              ? "当前没有待裁决的 wake-you-up。守门人继续安静值守,所有 agent 改动都在安全区内。"
              : `审查队列里有 ${wakeN} 处 wake-you-up 等你裁决${lookN ? `,另有 ${lookN} 处 look-once` : ""}。点进去逐条放行、驳回或标记误报。`),
            !calm && h("div", { class: "verdict-actions" },
              Btn("进入审查队列", { icon: "ArrowRight", onClick: () => nav("queue") }),
              Btn("看全部记录", { kind: "ghost", onClick: () => nav("audit") }))),
          h("div", { class: "verdict-right" },
            h("div", { class: "verdict-big mono" }, wakeN),
            h("div", { class: "ds-label" }, "待裁决 WAKE"),
            lookN > 0 && h("div", { class: "verdict-sub mono" }, "+" + lookN + " LOOK-ONCE"))),
        h("div", { class: "stat-row" },
          Stat(ov.totalScans, "总扫描", "本机 events.jsonl"),
          Stat(ov.totalWake, "wake-you-up 命中", `${ov.totalBlocked} 次 push 被刹住`, "error"),
          Stat(Math.round(ov.passRate * 1000) / 10 + "%", "自动放行率", "宁可漏,不可烦", "success"),
          Stat(new Set(findings.map((f) => f.repo)).size || "0", "当前在审仓库", "pre-push + MCP 双通道")),
        h("div", { class: "two-col" },
          Card({}, SectionTitle("风险趋势 · 14 天", "悬停看当天数值,点柱子进守门记录"),
            rows.length ? RiskBars(rows, 132, () => nav("audit")) : Empty("还没有趋势数据", "Activity"),
            h("div", { class: "legend" }, h("i", { style: { background: "var(--heatmap-low)" } }), "放行", h("i", { style: { background: "var(--warning)" } }), "look-once", h("i", { style: { background: "var(--error)" } }), "wake-you-up")),
          Card({}, SectionTitle("最近活动", "点一条进守门记录看详情"),
            activity.length ? h("div", { class: "feed" }, ...activity.map((a) =>
              h("div", { class: "feed-row feed-click", onClick: () => gotoAudit(a.id) }, h("span", { class: "dot dot-" + a.kind }),
                h("div", { class: "feed-body" }, h("div", { class: "feed-text" }, a.text),
                  h("div", { class: "feed-meta" }, h("span", { class: "mono" }, a.time), h("span", { class: "feed-repo" }, a.repo)))))) : Empty("还没有守门记录", "FileSearch"))));
    }),

  queue: () => loadPage(
    async () => state.cache.findings || (state.cache.findings = await api("/api/findings")),
    (findings) => QueueView(findings),
    h("div", { class: "queue-grid" }, h("div", { class: "skel", style: { height: "200px", borderRadius: "14px" } }), h("div", { class: "skel", style: { height: "400px", borderRadius: "14px" } }))),

  audit: () => loadPage(() => api("/api/stats/dispositions"), (disp) => AuditView(disp)),
  rules: () => loadPage(
    async () => {
      const rules = await api("/api/stats/rules");
      const findings = state.cache.findings || (state.cache.findings = await api("/api/findings"));
      return { rules, findings };
    },
    ({ rules, findings }) => RulesView(rules, findings)),
  flight: () => loadPage(() => api("/api/violations"), (v) => FlightView(v)),
  danger: () => loadPage(() => api("/api/danger-map"), (map) => DangerView(map)),
  usage: () => loadPage(
    async () => {
      const [today, daily, projects, sessions, ov] = await Promise.all([
        api("/api/daily/today"), api("/api/daily/list"), api("/api/sessions/projects"), api("/api/sessions/recent"), api("/api/sessions/overview"),
      ]);
      return { today, daily, projects, sessions, ov };
    },
    (d) => UsageView(d)),
  inbox: () => loadPage(() => api("/api/inbox/list"), (items) => InboxView(items)),
};

/* ============================================================
   8. 各页 view
   ============================================================ */
const DECISION_LABEL = {
  approved: { text: "已放行", cls: "pill-pass", icon: "Check" },
  rejected: { text: "已驳回 · 进终端信箱", cls: "pill-wake", icon: "CornerUpLeft" },
  fp: { text: "已标记误报 · 喂给规则校准", cls: "pill-look", icon: "Scale" },
};

const queueState = { filter: "all", sel: null, reasonFor: null, reason: "" };
function QueueView(findings) {
  const pending = findings.filter((f) => !state.decisions[f.id]);
  const done = findings.filter((f) => state.decisions[f.id]);
  const counts = { all: pending.length, wake: pending.filter((f) => f.level === "wake").length, look: pending.filter((f) => f.level === "look").length, done: done.length };
  const list = queueState.filter === "all" ? pending : queueState.filter === "done" ? done : pending.filter((f) => f.level === queueState.filter);
  if (!queueState.sel || !findings.some((f) => f.id === queueState.sel)) queueState.sel = (list[0] || findings[0] || {}).id;
  const current = findings.find((f) => f.id === queueState.sel) || list[0];

  const decide = (id, d) => { state.decisions[id] = d; persistDecisions(); state.badges.queue = findings.filter((f) => !state.decisions[f.id]).length; PAGES.queue(); rerenderNavBadges(); };
  const confirmApprove = (f) => { decide(f.id, { kind: "approved", note: queueState.reason || "未填理由", time: "刚刚" }); queueState.reasonFor = null; queueState.reason = ""; toast("已放行并留痕", "Check"); };
  const reject = async (f) => {
    decide(f.id, { kind: "rejected", note: "已写指令进终端信箱", time: "刚刚" });
    try {
      await api("/api/inbox/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title: `驳回:撤销 ${f.file} 的改动`,
        action: `git checkout origin/main -- ${f.file}  # 与任务「${truncate(f.task, 40)}」无关,已被守门人驳回`,
        context: { rules: [f.rule], note: f.reason, urgency: f.level === "wake" ? "high" : "medium", source: "审查队列" },
      })});
      toast("已驳回 · 指令已落终端信箱", "CornerUpLeft");
    } catch (e) { toast("信箱写入失败:" + e.message, "TriangleAlert"); }
  };

  const head = h("div", { class: "queue-head" },
    h("div", { class: "seg" }, ...[["all", `待裁决 ${counts.all}`], ["wake", `WAKE ${counts.wake}`], ["look", `LOOK ${counts.look}`], ["done", `已处理 ${counts.done}`]].map(([k, label]) =>
      h("button", { class: "seg-btn" + (queueState.filter === k ? " on" : ""), onClick: () => { queueState.filter = k; PAGES.queue(); } }, label))),
    h("span", { class: "kbd-hint" }, h("kbd", null, "J"), h("kbd", null, "K"), "上下走查"));

  if (list.length === 0) return F(head, Card({}, Empty(queueState.filter === "done" ? "还没有处理过的发现。" : "队列空了 —— 当前没有未提交/未合并的可疑改动。守门人继续安静值守。", "ShieldCheck")));

  return F(head, h("div", { class: "queue-grid" },
    h("div", { class: "queue-list" }, ...list.map((f) => {
      const d = state.decisions[f.id];
      return Card({ class: "q-item" + (current && current.id === f.id ? " q-on" : ""), onClick: () => { queueState.sel = f.id; PAGES.queue(); } },
        h("div", { class: "q-item-top" }, h("span", { style: { display: "inline-flex", gap: "6px", alignItems: "center" } }, LevelPill(f.level), OriginBadge(f.origin)), h("span", { class: "mono q-age" }, ago(f.timestamp))),
        h("div", { class: "q-file mono" }, f.file),
        h("div", { class: "q-meta" }, Chip(f.rule), h("span", { class: "q-repo" }, f.repo)),
        d && h("div", { class: "q-done" }, Icon(DECISION_LABEL[d.kind].icon, 12), DECISION_LABEL[d.kind].text));
    })),
    current && QueueDetail(current, { confirmApprove, reject })));
}
function QueueDetail(c, { confirmApprove, reject }) {
  const d = state.decisions[c.id];
  const rangeLabel = c.origin === "history" ? "历史记录" : c.origin === "demo" ? "演示数据" : "git diff";
  return Card({ class: "q-detail" },
    h("div", { class: "qd-head" },
      h("div", null, h("div", { class: "qd-file mono" }, c.file),
        h("div", { class: "qd-meta" }, LevelPill(c.level), OriginBadge(c.origin), Chip(c.rule), h("span", { class: "mono" }, c.repo + (c.branch ? " · " + c.branch : "")))),
      h("div", { class: "qd-agent" }, h("span", { class: "ds-label" }, "来源"), h("div", { class: "mono", style: { fontSize: "12px" } }, rangeLabel))),
    c.task && h("div", { class: "qd-block" }, h("span", { class: "ds-label" }, "声称的任务"), h("div", { class: "qd-task" }, "「" + truncate(c.task, 160) + "」")),
    c.drift != null && h("div", { class: "qd-block" }, h("div", { class: "qd-drift-row" }, h("span", { class: "ds-label" }, "任务 ↔ 改动偏离度"), DriftMeter(c.drift))),
    h("div", { class: "qd-block" }, h("span", { class: "ds-label" }, "守门人为什么拦"), h("p", { class: "qd-reason" }, c.reason)),
    h("div", { class: "qd-block" },
      h("div", { class: "qd-diff-head" }, h("span", { class: "ds-label" }, c.origin === "live" ? "改动片段 · 实时取自本机 git" : c.origin === "demo" ? "改动片段 · 演示" : "改动片段"),
        c.origin !== "history" && h("span", { class: "mono" }, h("span", { class: "t-add" }, "+" + c.stats.add), " ", h("span", { class: "t-del" }, "−" + c.stats.del))),
      c.origin === "history"
        ? h("div", { class: "q-no-diff" }, "这是一条历史被刹住的记录。隐私铁律下,events.jsonl 只留命中元数据(规则 / 路径 / 级别 / 理由),不留 diff 正文 —— 所以无法在此重放代码。要看正文,请在终端对该改动重新跑 ", h("span", { class: "mono" }, "agent-diff-guard check"), "。")
        : DiffBlock(c.diff)),
    d ? h("div", { class: "qd-decided" }, Icon(DECISION_LABEL[d.kind].icon, 14), h("span", null, DECISION_LABEL[d.kind].text), h("span", { class: "mono" }, "· " + d.time + " · " + d.note))
      : queueState.reasonFor === c.id
        ? h("div", { class: "qd-approve" },
            (() => { const inp = h("input", { class: "inp", placeholder: "放行理由(留痕,团队可见)…", value: queueState.reason, onInput: (e) => queueState.reason = e.target.value, onKeydown: (e) => { if (e.key === "Enter") confirmApprove(c); } }); setTimeout(() => inp.focus(), 0); return inp; })(),
            Btn("确认放行", { small: true, icon: "Check", onClick: () => confirmApprove(c) }),
            Btn("取消", { small: true, kind: "quiet", onClick: () => { queueState.reasonFor = null; PAGES.queue(); } }))
        : h("div", { class: "qd-actions" },
            Btn("放行", { icon: "Check", kind: "ghost", onClick: () => { queueState.reasonFor = c.id; PAGES.queue(); } }),
            Btn("驳回 · 发回终端修复", { icon: "CornerUpLeft", onClick: () => reject(c) }),
            Btn("标记误报", { icon: "Scale", kind: "quiet", onClick: () => { state.decisions[c.id] = { kind: "fp", note: "进入规则校准语料", time: "刚刚" }; persistDecisions(); PAGES.queue(); rerenderNavBadges(); toast("已标记误报", "Scale"); } })));
}

const auditState = { disp: "all" };
const auditOpen = new Set();
const DISP_PILL = { blocked: ["被刹住", "pill-wake"], "human-approved": ["人工放行", "pill-look"], "auto-pass": ["自动放行", "pill-pass"] };
function AuditView(rows) {
  const list = rows.filter((r) => auditState.disp === "all" || r.disposition === auditState.disp);
  const toggle = (id) => { auditOpen.has(id) ? auditOpen.delete(id) : auditOpen.add(id); PAGES.audit(); };
  return F(
    h("div", { class: "queue-head" },
      h("div", { class: "seg" }, ...[["all", "全部"], ["blocked", "被刹住"], ["human-approved", "人工放行"], ["auto-pass", "自动放行"]].map(([k, label]) =>
        h("button", { class: "seg-btn" + (auditState.disp === k ? " on" : ""), onClick: () => { auditState.disp = k; PAGES.audit(); } }, label)))),
    Card({}, SectionTitle("处置流水", "每条改动最终被拦了还是被放行了?点一行看完整命中明细。"),
      list.length === 0 ? Empty("这个筛选下没有记录。", "FileSearch") :
      h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", null, "时间"), h("th", null, "范围"), h("th", { class: "num" }, "wake"), h("th", null, "命中规则"), h("th", null, "处置"))),
        h("tbody", null, ...list.flatMap((r) => {
          const [text, cls] = DISP_PILL[r.disposition] || [r.disposition, ""];
          const open = auditOpen.has(r.id);
          const row = h("tr", { class: "row-click" + (open ? " row-open" : ""), onClick: () => toggle(r.id) },
            h("td", null, h("span", { class: "row-caret" }, Icon("ArrowRight", 12)), h("span", { class: "mono" }, fmtTime(r.timestamp))),
            h("td", null, h("span", { class: "mono" }, r.gitRange)),
            h("td", { class: "num" + (r.wakeCount > 0 ? " t-del" : "") }, r.wakeCount),
            h("td", null, h("div", { class: "t-rules" }, r.rulesTriggered.length ? r.rulesTriggered.map((x) => Chip(x)) : h("span", { class: "t-dim" }, "—"))),
            h("td", null, h("span", { class: "pill " + cls }, text)));
          if (!open) return [row];
          return [row, h("tr", null, h("td", { class: "detail-cell", colspan: 5 }, AuditDetail(r)))];
        })))));
}
function AuditDetail(r) {
  return h("div", { class: "detail-box" },
    h("div", { class: "detail-grid" },
      h("span", { class: "detail-k" }, "仓库"), h("span", { class: "detail-v mono" }, r.repoRemote || "(本地仓库)"),
      h("span", { class: "detail-k" }, "git 范围"), h("span", { class: "detail-v mono" }, r.gitRange),
      h("span", { class: "detail-k" }, "改动文件"), h("span", { class: "detail-v" }, F(h("b", null, r.totalFilesChanged), " 个 · ",
        h("span", { class: "t-del" }, r.wakeCount + " wake"), " / ", h("span", { class: "t-by", style: { display: "inline", color: "var(--warning)" } }, r.lookCount + " look"))),
      r.taskDescLen != null && h("span", { class: "detail-k" }, "声称任务"),
      r.taskDescLen != null && h("span", { class: "detail-v" }, `${r.taskDescLen} 字(原文已 hash,不留存 —— 隐私铁律)`)),
    r.findings && r.findings.length
      ? h("div", { style: { marginTop: "12px" } },
          h("span", { class: "ds-label", style: { display: "block", marginBottom: "8px" } }, "逐条命中"),
          ...r.findings.map((f) => h("div", { style: { display: "flex", gap: "8px", alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" } },
            LevelPill(f.severity === "wake-you-up" ? "wake" : "look"),
            h("span", { class: "mono", style: { fontSize: "12px", color: "var(--fg-primary)" } }, f.path),
            h("span", { class: "t-dim", style: { fontSize: "12px" } }, f.whySummary))))
      : h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "8px" } }, "本次扫描未触发任何规则,自动放行。"));
}

// 规则级别:全 wake → wake;全非 → look;混合 → mixed。
function ruleLevel(r) {
  if (r.wakeCount === 0) return ["look", "LOOK-ONCE", "lvl-look"];
  if (r.wakeCount >= r.count) return ["wake", "WAKE-YOU-UP", "lvl-wake"];
  return ["mixed", "混合", "lvl-mixed"];
}
function RulesView(rules, findings) {
  if (!rules.length) return Card({}, Empty("还没有规则命中记录 —— 跑过几次 `agent-diff-guard check` 后这里会有数据。", "SlidersHorizontal"));
  const max = Math.max(...rules.map((x) => x.count));
  // 误报率:本地"标记误报(fp)"的裁决,按规则归集 / 该规则在队列里出现过的总数。
  // 这是用户实际反馈的误报信号(localStorage),目前是面板内闭环;团队版会回流到规则校准。
  const fpByRule = {}, seenByRule = {};
  for (const f of findings || []) {
    seenByRule[f.rule] = (seenByRule[f.rule] || 0) + 1;
    if (state.decisions[f.id] && state.decisions[f.id].kind === "fp") fpByRule[f.rule] = (fpByRule[f.rule] || 0) + 1;
  }
  const totalFp = Object.values(fpByRule).reduce((a, b) => a + b, 0);
  return Card({}, SectionTitle("守门规则", "命中、级别与误报 —— 误报是头号死因,被标记越多越该校准。"),
    h("table", { class: "tbl" },
      h("thead", null, h("tr", null, h("th", null, "规则"), h("th", null, "级别"), h("th", { class: "num" }, "命中"), h("th", { class: "num" }, "其中 wake"), h("th", { class: "num" }, "标记误报"), h("th", { style: { width: "24%" } }, "命中占比"))),
      h("tbody", null, ...rules.map((r) => {
        const [, lvlText, lvlCls] = ruleLevel(r);
        const fp = fpByRule[r.rule] || 0;
        const seen = seenByRule[r.rule] || 0;
        const fpRate = seen > 0 ? Math.round((fp / seen) * 100) : null;
        return h("tr", null,
          h("td", null, h("div", { class: "r-name" }, Chip(r.rule))),
          h("td", null, h("span", { class: "lvl-tag " + lvlCls }, lvlText)),
          h("td", { class: "num" }, h("span", { class: "mono" }, r.count)),
          h("td", { class: "num" }, h("span", { class: "mono" + (r.wakeCount ? " t-del" : "") }, r.wakeCount)),
          h("td", { class: "num" }, fp > 0 ? h("span", { class: "mono t-del", title: fpRate != null ? `误报率 ${fpRate}%` : "" }, fp + (fpRate != null ? ` · ${fpRate}%` : "")) : h("span", { class: "t-dim mono" }, "0")),
          h("td", null, h("span", { class: "bar", style: { width: Math.max(8, (r.count / max) * 100) + "%" } })));
      }))),
    h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "12px" } },
      totalFp > 0
        ? F("你已在审查队列标记 ", h("b", null, totalFp), " 处误报。误报率 = 该规则被标误报数 / 该规则在队列出现数 —— 持续偏高的规则应当降级或收窄,否则会被当成狼来了关掉。")
        : "误报率来自你在审查队列点「标记误报」的反馈,目前为 0。一旦开始标记,这里会显示每条规则的误报压力 —— 这是规则该不该降级的第一手依据。"));
}

const flightOpen = new Set();
function FlightView(v) {
  const allViol = (v.byRepo || []).flatMap((r) => r.violations);
  const toggle = (k) => { flightOpen.has(k) ? flightOpen.delete(k) : flightOpen.add(k); PAGES.flight(); };
  return F(
    h("div", { class: "stat-row stat-row-3" },
      Stat(v.reposWithPolicy || 0, "有规矩的仓库", ".agent-policy.json"),
      Stat(v.totalViolations || 0, "检测到越界", "确定性检测 · 零 AI · 只记录不阻断", v.totalViolations ? "error" : undefined),
      Stat(allViol[0] ? fmtTime(allViol[0].timestamp) : "—", "最近一次越界", allViol[0] ? (allViol[0].offendingFiles || []).join("、") : "暂无")),
    ...(v.byRepo && v.byRepo.length ? v.byRepo.map((r, ri) =>
      Card({}, SectionTitle(r.project, `${r.policyCount} 条规矩`),
        r.violations.length === 0
          ? h("div", { class: "viol-clean" }, Icon("ShieldCheck", 14), "没检测到越界 —— agent 守规矩。")
          : F(...r.violations.map((vi, vj) => {
              const key = `${ri}:${vj}`;
              const open = flightOpen.has(key);
              return h("div", { class: "viol", style: { cursor: "pointer" }, onClick: () => toggle(key) },
                h("div", { class: "viol-head" }, h("span", { class: "row-caret" + (open ? " row-open" : ""), style: open ? { transform: "rotate(90deg)", color: "var(--accent)" } : null }, Icon("ArrowRight", 12)), Icon("TriangleAlert", 15),
                  h("span", { class: "viol-title" }, `[${vi.policyName}] 改了 `, h("span", { class: "mono" }, (vi.offendingFiles || []).slice(0, open ? 99 : 3).join("、"), !open && (vi.offendingFiles || []).length > 3 ? ` 等 ${vi.offendingFiles.length} 个` : ""))),
                h("p", { class: "viol-why" }, vi.reason),
                h("div", { class: "viol-meta" }, h("span", { class: "mono" }, fmtTime(vi.timestamp)), vi.gitBranch && h("span", { class: "mono" }, vi.gitBranch),
                  h("span", null, "当时任务:「" + truncate(vi.task, open ? 9999 : 40) + (open ? "" : "") + "」")),
                open && ViolDetail(vi));
            }))))
      : [Card({}, Empty("还没有任何仓库配置 .agent-policy.json —— 给仓库定下规矩,越界才会被记录。", "PlaneTakeoff"))]),
    h("p", { class: "foot-note" }, "飞行记录只记录、不阻断,供复盘 —— 对准 Replit 式越界:被告知不准改,还是改了。点任意一条看完整任务与全部越界文件。"));
}
function ViolDetail(vi) {
  return h("div", { class: "detail-box", style: { marginTop: "11px", borderRadius: "var(--radius-small)", border: "1px solid var(--border-subtle)" }, onClick: (e) => e.stopPropagation() },
    h("div", { class: "detail-grid" },
      h("span", { class: "detail-k" }, "规矩类型"), h("span", { class: "detail-v mono" }, vi.policyKind || vi.policyName),
      h("span", { class: "detail-k" }, "越界文件"), h("span", { class: "detail-v mono" }, (vi.offendingFiles || []).join("\n")),
      h("span", { class: "detail-k" }, "为什么这是越界"), h("span", { class: "detail-v" }, vi.reason),
      vi.gitBranch && h("span", { class: "detail-k" }, "当时分支"), vi.gitBranch && h("span", { class: "detail-v mono" }, vi.gitBranch),
      h("span", { class: "detail-k" }, "发生时间"), h("span", { class: "detail-v mono" }, fmtTime(vi.timestamp))),
    h("span", { class: "ds-label", style: { display: "block", margin: "12px 0 6px" } }, "当时声称的完整任务"),
    h("div", { class: "detail-task" }, vi.task || "(无任务描述)"));
}

let dangerCopied = null;
const dangerOpen = new Set(); // 展开的行 key:`${repo}:${rule}`
const HEAT_LABEL = { 1: "低", 2: "中", 3: "高" };
function DangerView(map) {
  const copyMd = (r) => {
    const md = `# ${r.repo} 危险地图\n\n` + r.zones.map((z) => `- \`${z.path}\` (${z.rule}) — ${z.note}`).join("\n");
    navigator.clipboard?.writeText(md).then(() => { dangerCopied = r.repo; PAGES.danger(); setTimeout(() => { dangerCopied = null; }, 1800); toast("已复制 Markdown,可粘给 agent", "Copy"); });
  };
  const toggle = (key) => { dangerOpen.has(key) ? dangerOpen.delete(key) : dangerOpen.add(key); PAGES.danger(); };
  return F(
    Card({ class: "danger-intro" },
      h("div", null, SectionTitle("危险地图", "守门人事后积累的判断,翻过来做 agent 的事前输入 —— 让它改之前就避开雷。"),
        h("p", { class: "qd-reason", style: { margin: 0 } }, "通用高危区(固化规则)+ 本仓库历史实际踩过的雷(本机 events 聚合)。只含路径与规则,不含代码正文,可放心交给任何 agent。点任意一行看规则定义与命中详情。")),
      h("div", { class: "danger-mcp" },
        h("span", { class: "ds-label" }, "投喂通道"),
        h("div", { class: "mcp-line" }, h("span", { class: "mono" }, "agent-diff-guard context"), h("span", { class: "t-dim" }, "→ system prompt")),
        h("div", { class: "mcp-line" }, h("span", { class: "mono" }, "MCP · get_repo_danger_map"), h("span", { class: "pill pill-pass" }, "已连接")))),
    ...(map.length ? map.map((r) =>
      Card({}, SectionTitle(r.repo, null, Btn(dangerCopied === r.repo ? "已复制 Markdown" : "复制给 agent", { small: true, kind: "ghost", icon: dangerCopied === r.repo ? "Check" : "Copy", onClick: () => copyMd(r) })),
        h("table", { class: "tbl" },
          h("thead", null, h("tr", null, h("th", null, "路径"), h("th", null, "来源规则"), h("th", null, "热度"), h("th", { class: "num" }, "历史命中"), h("th", null, "备注"))),
          h("tbody", null, ...r.zones.flatMap((z) => {
            const key = `${r.repo}:${z.rule}`;
            const open = dangerOpen.has(key);
            const row = h("tr", { class: "row-click" + (open ? " row-open" : ""), onClick: () => toggle(key) },
              h("td", null, h("span", { class: "row-caret" }, Icon("ArrowRight", 12)), h("span", { class: "mono z-path" }, z.path)),
              h("td", null, Chip(z.rule)),
              h("td", null, HeatDot(z.heat), h("span", { class: "mono", style: { marginLeft: "6px", fontSize: "10px", color: "var(--fg-subtle)" } }, HEAT_LABEL[z.heat] || "")),
              h("td", { class: "num" }, h("span", { class: "mono" }, z.hits)),
              h("td", { class: "t-dim" }, truncate(z.note, 28)));
            if (!open) return [row];
            return [row, h("tr", null, h("td", { class: "detail-cell", colspan: 5 }, DangerDetail(z)))];
          })),
        ),
        // 热度图例
        h("div", { class: "heat-legend" },
          h("span", { class: "ds-label", style: { letterSpacing: ".8px" } }, "热度"),
          ...[3, 2, 1].map((n) => h("span", { class: "hl-item" }, HeatDot(n), HEAT_LABEL[n])),
          h("span", { class: "t-dim", style: { marginLeft: "4px" } }, "按命中频次 × wake 占比 × 新近度综合分级 —— 越热说明本仓库越常在此处出事")))
    )
      : [Card({}, Empty("还没有危险地图数据。", "Map"))]));
}
function DangerDetail(z) {
  return h("div", { class: "detail-box" },
    h("div", { class: "detail-grid" },
      h("span", { class: "detail-k" }, "来源规则"), h("span", { class: "detail-v mono" }, z.rule),
      h("span", { class: "detail-k" }, "为什么危险"), h("span", { class: "detail-v" }, z.note),
      h("span", { class: "detail-k" }, "历史命中"), h("span", { class: "detail-v" }, F(h("b", null, z.hits), " 次",
        z.wakeHits != null ? F(",其中 ", h("span", { class: "t-del" }, z.wakeHits + " 次"), " 被刹住") : "")),
      z.lastSeen && h("span", { class: "detail-k" }, "最近命中"), z.lastSeen && h("span", { class: "detail-v mono" }, z.lastSeen),
      h("span", { class: "detail-k" }, "代表路径"), h("span", { class: "detail-v mono" }, z.path)),
    h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "10px" } }, "把这条投喂给 agent,它在改这类文件前就会主动说明理由 —— 事前避雷,而非事后被刹。"));
}

/* ============================================================
   分享:把某天用量做成晶点卡,复制为图片(原生 SVG foreignObject,零依赖)
   ============================================================ */

// 晶点卡 HTML(所有样式必须内联 —— foreignObject 截图不继承外部样式表)。
// 配色直接写死琥珀棕设计 token 的十六进制,与面板一致。
function usageCardHTML(day, isToday) {
  const C = { bg: "#FAF8F6", surface: "#FFFFFF", fg: "#2B2822", muted: "#6B6560", subtle: "#857F79",
    accent: "#5D3000", accentSoft: "#F5EDE3", border: "#EDE8DF", warn: "#8A5800", succ: "#4C7A3F" }; /* P1-6:对比度达标 */
  const mono = "'SF Mono','JetBrains Mono',ui-monospace,Menlo,monospace";
  const disp = "'Space Grotesk',system-ui,-apple-system,sans-serif";
  const fmtKLocal = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(Math.round(n)));
  const dur = (ms) => { const hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000); return hh > 0 ? `${hh}h${mm}m` : `${mm}m`; };
  const cachePct = day.tokens.total ? Math.round((day.tokens.cacheRead / day.tokens.total) * 100) : 0;
  const dateText = isToday ? "今日" : day.date;
  const sub = (val, label) => `
    <div style="flex:1;min-width:0;background:${C.bg};border:1px solid ${C.border};border-radius:12px;padding:14px 16px;">
      <div style="font-family:${mono};font-size:22px;font-weight:500;color:${C.fg};letter-spacing:-.5px;line-height:1;">${val}</div>
      <div style="font-size:12px;color:${C.muted};margin-top:7px;">${label}</div>
    </div>`;
  return `
  <div xmlns="http://www.w3.org/1999/xhtml" style="width:560px;box-sizing:border-box;background:${C.surface};border:1px solid ${C.border};border-radius:22px;padding:34px 36px;font-family:${disp};color:${C.fg};">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:26px;">
      <div style="display:flex;align-items:center;gap:11px;">
        <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,${C.accent},#7A3F00);display:flex;align-items:center;justify-content:center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
        </div>
        <div>
          <div style="font-weight:700;font-size:13px;letter-spacing:1px;">AGENT-DIFF-GUARD</div>
          <div style="font-family:${mono};font-size:10px;color:${C.subtle};letter-spacing:.5px;margin-top:2px;">本机只读 · 不联网</div>
        </div>
      </div>
      <div style="font-family:${mono};font-size:13px;color:${C.muted};">${dateText}</div>
    </div>

    <div style="background:${C.accentSoft};border-radius:16px;padding:22px 24px;margin-bottom:16px;">
      <div style="font-size:12px;color:${C.accent};letter-spacing:1px;font-weight:700;text-transform:uppercase;">${isToday ? "今日" : "当日"} TOKEN</div>
      <div style="font-family:${mono};font-size:52px;font-weight:500;color:${C.accent};letter-spacing:-1.5px;line-height:1.05;margin-top:4px;">${fmtKLocal(day.tokens.total)}</div>
      <div style="font-size:13px;color:${C.muted};margin-top:4px;">cache 命中 ${cachePct}% · 输出 ${fmtKLocal(day.tokens.output)} · ${day.projects} 个项目</div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:24px;">
      ${sub(dur(day.activeMs), "活跃时长")}
      ${sub(day.toolCalls.toLocaleString(), "工具调用")}
      ${sub("$" + day.estCostUsd.toFixed(1), "估算成本")}
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${C.border};padding-top:16px;">
      <div style="font-size:12.5px;color:${C.muted};">一个人 × N 个 agent,烧了多少 —— 一眼看完</div>
      <div style="font-family:${mono};font-size:11px;color:${C.subtle};">${day.messages.total} 条消息</div>
    </div>
  </div>`;
}

// 把晶点卡 HTML 经 SVG foreignObject 渲染成 PNG Blob(2x 高清)。
function renderCardBlob(day, isToday) {
  return new Promise((resolve, reject) => {
    const W = 560, H = 340, SCALE = 2;
    const inner = usageCardHTML(day, isToday);
    const svgStr =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<foreignObject x="0" y="0" width="${W}" height="${H}">${inner}</foreignObject></svg>`;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * SCALE; canvas.height = H * SCALE;
      const ctx = canvas.getContext("2d");
      ctx.scale(SCALE, SCALE);
      ctx.drawImage(img, 0, 0, W, H);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 返回空"))), "image/png");
    };
    img.onerror = () => reject(new Error("SVG 渲染失败(可能含不支持的样式)"));
    img.src = url;
  });
}

// 入口:生成卡片 → 优先写剪贴板,失败则下载 PNG。按钮给即时反馈。
async function shareUsageCard(day, isToday, btn) {
  const label = btn ? btn.querySelector("span:last-child") || btn : null;
  const restore = btn ? btn.textContent : "";
  try {
    const blob = await renderCardBlob(day, isToday);
    // 优先:复制到剪贴板(可直接粘进聊天/文档)
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("已复制为图片,可直接粘贴", "Copy");
        return;
      } catch { /* 剪贴板被拒 → 降级下载 */ }
    }
    // 降级:触发下载
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `adg-usage-${isToday ? new Date().toISOString().slice(0, 10) : day.date}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("剪贴板不可用,已下载图片", "ArrowRight");
  } catch (e) {
    toast("生成图片失败:" + e.message, "TriangleAlert");
  }
}

const usageState = { selDate: null }; // null = 今天
function UsageView({ today, daily, projects, sessions, ov }) {
  // 选中某天则取那天的 DailyStat(结构与 today 一致);否则用 today
  const sel = usageState.selDate ? daily.find((d) => d.date === usageState.selDate) : null;
  const day = sel || today;
  const isToday = !sel;
  const dayLabel = isToday ? "今日" : day.date.slice(5); // MM-DD
  const cachePct = day.tokens.total ? ((day.tokens.cacheRead / day.tokens.total) * 100).toFixed(0) : 0;
  const dailyRows = daily.slice(0, 14).map((d) => ({ label: d.date, v: d.tokens.total }));
  const maxCost = Math.max(1, ...projects.map((p) => p.estCostUsd));
  const pick = (date) => { usageState.selDate = date; PAGES.usage(); };
  return F(
    h("div", { class: "queue-head", style: { marginBottom: "-6px" } },
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px" } },
        h("span", { class: "ds-label sec-label", style: { fontSize: "13px" } }, isToday ? "今日概览" : `${day.date} 概览`),
        !isToday && h("span", { class: "sec-hint" }, "历史某天 · 数据快照")),
      h("div", { class: "sec-right" },
        !isToday && h("button", { class: "btn btn-quiet btn-sm", onClick: () => pick(null) }, Icon("CornerUpLeft", 13), "回到今天"),
        h("button", { class: "btn btn-ghost btn-sm", onClick: (e) => shareUsageCard(day, isToday, e.currentTarget) }, Icon("Copy", 13), "分享当天为图片"))),
    h("div", { class: "stat-row" },
      Stat(fmtDur(day.activeMs), dayLabel + "活跃时长", `会话跨度 ${fmtDur(day.sessionSpanMs)}`),
      Stat(fmtK(day.tokens.total), dayLabel + " token", `cache ${cachePct}% · out ${fmtK(day.tokens.output)}`),
      Stat(day.toolCalls.toLocaleString(), "工具调用", `${day.messages.total} 条消息 · ${day.projects} 个项目`),
      Stat("$" + day.estCostUsd.toFixed(1), dayLabel + "估算成本", "按模型单价估算,非账单", "warning")),
    isToday && h("p", { class: "foot-note", style: { textAlign: "left", margin: "-8px 0 0" } },
      F("「今日」按自然日(本地 ", h("span", { class: "mono" }, new Date().toISOString().slice(0, 10)), ")切片所有 session 的当天部分;下方「最近 session」按整段会话统计,跨天会话会算进多天 —— 两者口径不同,数字不必相等。")),
    Card({}, SectionTitle("每日 token · 14 天", isToday ? "点任意一根柱子,看那天的明细。" : `已选 ${day.date} —— 高亮的那根。点今天的柱子或「回到今天」复位。`),
      dailyRows.length ? DailyBars(dailyRows, usageState.selDate, pick) : Empty("还没有每日数据", "Activity")),
    h("div", { class: "two-col" },
      Card({}, SectionTitle("项目消耗排行", "哪个仓库最烧?"),
        h("table", { class: "tbl" },
          h("thead", null, h("tr", null, h("th", null, "项目"), h("th", { class: "num" }, "估算"), h("th", { class: "num" }, "session"), h("th", { class: "num" }, "输出"), h("th", { style: { width: "26%" } }))),
          h("tbody", null, ...projects.slice(0, 8).map((p) =>
            h("tr", null, h("td", { class: "t-repo" }, truncate(p.project.split("/").slice(-2).join("/"), 28)),
              h("td", { class: "num" }, h("span", { class: "mono" }, "$" + p.estCostUsd.toFixed(0))),
              h("td", { class: "num" }, p.sessionCount),
              h("td", { class: "num" }, h("span", { class: "mono" }, fmtK(p.outputTokens))),
              h("td", null, h("span", { class: "bar", style: { width: Math.max(6, (p.estCostUsd / maxCost) * 100) + "%" } }))))))),
      Card({}, SectionTitle("历史每日明细", "点一行查看那天概览"),
        h("table", { class: "tbl tbl-tight" },
          h("thead", null, h("tr", null, h("th", null, "日期"), h("th", { class: "num" }, "活跃"), h("th", { class: "num" }, "token"), h("th", { class: "num" }, "工具"), h("th", { class: "num" }, "估算"))),
          h("tbody", null, ...daily.slice(0, 10).map((d, i) => {
            const isSelRow = usageState.selDate ? d.date === usageState.selDate : i === 0; // 未选高亮最近(今天)
            return h("tr", { class: "row-click" + (isSelRow ? " row-open" : ""), onClick: () => pick(i === 0 ? null : d.date) },
              h("td", null, h("span", { class: "mono" }, d.date)),
              h("td", { class: "num" }, fmtDur(d.activeMs)),
              h("td", { class: "num" }, h("span", { class: "mono" }, fmtK(d.tokens.total))),
              h("td", { class: "num" }, d.toolCalls),
              h("td", { class: "num" }, h("span", { class: "mono" }, "$" + d.estCostUsd.toFixed(0))));
          })))),
    Card({}, SectionTitle("最近 session", "哪个 agent 在哪个仓库烧 token?"),
      h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", null, "最近活动"), h("th", null, "项目"), h("th", null, "模型"), h("th", { class: "num" }, "消息"), h("th", { class: "num" }, "输出"), h("th", { class: "num" }, "估算"))),
        h("tbody", null, ...sessions.slice(0, 8).map((s) =>
          h("tr", null, h("td", null, h("span", { class: "mono" }, fmtTime(s.lastActivity))),
            h("td", { class: "t-repo" }, truncate(s.project.split("/").slice(-2).join("/"), 24)),
            h("td", null, h("span", { class: "mono" }, s.model || "—")),
            h("td", { class: "num" }, s.messageCount),
            h("td", { class: "num" }, h("span", { class: "mono" }, fmtK(s.outputTokens))),
            h("td", { class: "num" }, h("span", { class: "mono" }, "$" + s.estCostUsd.toFixed(1)))))),
      h("p", { class: "foot-note", style: { marginTop: "12px", marginBottom: 0 } }, `共 ${ov.totalSessions} 个 session · ${ov.totalProjects} 个项目 · 成本为按模型单价的估算,非账单级精确 · 数据来自本机 session 日志,不上传。`)))));
}

const INBOX_STATUS = { pending: ["待终端取走", "pill-look", "Clock"], done: ["已执行 · 已归档", "pill-pass", "Check"] };
function InboxView(items) {
  const pendingN = items.filter((i) => i.status === "pending").length;
  return F(
    Card({ class: "danger-intro" },
      h("div", null, SectionTitle("终端信箱", "面板上的每个裁决,都变成一条可执行指令,等终端里的 agent 来取。"),
        h("p", { class: "qd-reason", style: { margin: 0 } }, F("人在面板裁决 → 指令落盘到 ", h("span", { class: "mono" }, "~/.agent-diff-guard/inbox/"), " → 终端 Claude Code 通过 MCP 的 ", h("span", { class: "mono" }, "list_pending_decisions"), " 取走执行。闭环不靠复制粘贴。"))),
      h("div", { class: "danger-mcp" }, h("span", { class: "ds-label" }, "等待取走"),
        h("div", { class: "verdict-big mono", style: { fontSize: "40px", color: pendingN ? "var(--warning)" : "var(--success)" } }, pendingN))),
    items.length === 0
      ? Card({}, Empty("信箱空了 —— 在审查队列驳回一条改动,这里就会出现可执行指令。", "Inbox"))
      : h("div", { class: "inbox-list" }, ...items.map((it) => {
          const [label, cls, icon] = INBOX_STATUS[it.status] || INBOX_STATUS.pending;
          return Card({ class: "inbox-item" },
            h("div", { class: "inbox-top" }, h("div", { class: "inbox-title" }, it.title), h("span", { class: "pill " + cls }, Icon(icon, 11), label)),
            h("div", { class: "evo-cmd mono" }, it.action),
            h("div", { class: "inbox-meta" }, h("span", { class: "mono" }, fmtTime(it.time)), Chip(it.source)));
        })));
}

/* ============================================================
   9. 搜索(⌘K 命令面板)+ AI(问守门人)+ 陪伴 orb
   —— 移植自 Guard Console 设计稿,接真实后端数据。
   独立 overlay 层,不触发主页面重渲染。
   ============================================================ */

// overlay 自身的状态(与主 state 分开,避免整页重绘)
const ai = {
  palOpen: false, palQ: "", palSel: 0,
  askOpen: false, askSeed: "", askMsgs: [], askTyping: false, askSent: {},
  nudgeShown: false, nudgeDismissed: false,
};

// nudge 关闭持久化(P1-4):键里带"关闭时的 wake 数",当次会话内同样数量不再重弹;
// 数量变化(出现新的待裁决)才允许再探一次。用 sessionStorage —— 关页即清,不跨会话压制。
const NUDGE_KEY = "adg-nudge-dismissed-wake";
function nudgeDismissedFor(wakeCount) {
  try { return sessionStorage.getItem(NUDGE_KEY) === String(wakeCount); } catch { return false; }
}
function dismissNudge(wakeCount) {
  ai.nudgeDismissed = true;
  try { sessionStorage.setItem(NUDGE_KEY, String(wakeCount)); } catch {}
}

// 跨数据源搜索的导航表(对齐 NAV)
const PAL_NAV = [
  { id: "overview", label: "总览", en: "OVERVIEW", icon: "Shield", kw: "zonglan overview" },
  { id: "queue", label: "审查队列", en: "QUEUE", icon: "ListChecks", kw: "queue shencha duilie pending" },
  { id: "audit", label: "守门记录", en: "AUDIT", icon: "ScrollText", kw: "audit jilu liushui" },
  { id: "rules", label: "规则", en: "RULES", icon: "SlidersHorizontal", kw: "rules guize level" },
  { id: "flight", label: "越界记录", en: "VIOLATIONS", icon: "PlaneTakeoff", kw: "flight yuejie violation policy" },
  { id: "danger", label: "危险地图", en: "DANGER MAP", icon: "Map", kw: "danger weixian map hot" },
  { id: "usage", label: "用量与成本", en: "COST", icon: "Activity", kw: "usage cost yongliang token" },
  { id: "inbox", label: "终端信箱", en: "INBOX", icon: "Inbox", kw: "inbox xinxiang terminal" },
];
const ROUTE_CN = { queue: "审查队列", overview: "总览", rules: "规则", flight: "飞行记录", danger: "危险地图", audit: "守门记录", usage: "用量", inbox: "终端信箱" };

// 把 overlay 挂到独立容器(只重绘 overlay,不动主页面)
function overlayRoot() {
  let el = $("#ai-overlay");
  if (!el) { el = h("div", { id: "ai-overlay" }); document.body.appendChild(el); }
  return el;
}
function renderOverlays() {
  const root = overlayRoot();
  root.innerHTML = "";
  root.appendChild(F(
    ai.palOpen && CommandPalette(),
    ai.askOpen && AskGuard(),
    !ai.askOpen && ai.nudgeShown && !ai.nudgeDismissed && !nudgeDismissedFor(pendingWakeCount()) && CompanionNudge(),
    CompanionOrb(),
  ));
}

/* ── 接地问答引擎:从真实后端缓存现编答案,按意图路由(零 LLM、可复现) ── */
// 数据从 state.cache 拿(overview/findings/rules/violations 已被各页缓存);缺啥补拉。
async function ensureAiData() {
  const need = [];
  if (state.cache.aiEnabled === undefined) need.push(api("/api/ai/status").then((d) => (state.cache.aiEnabled = !!d.enabled)).catch(() => (state.cache.aiEnabled = false)));
  if (!state.cache.aiOverview) need.push(api("/api/stats/overview").then((d) => (state.cache.aiOverview = d)).catch(() => {}));
  if (!state.cache.findings) need.push(api("/api/findings").then((d) => (state.cache.findings = d)).catch(() => {}));
  if (!state.cache.aiRules) need.push(api("/api/stats/rules").then((d) => (state.cache.aiRules = d)).catch(() => {}));
  if (!state.cache.aiViol) need.push(api("/api/violations").then((d) => (state.cache.aiViol = d)).catch(() => {}));
  if (need.length) await Promise.all(need);
}

// 意图路由 → 用真实数据现编结构化回答。每条标 tier(meta=元数据可上云 / local=读代码须本地)。
function answerFor(raw) {
  const q = (raw || "").toLowerCase();
  const has = (...ks) => ks.some((k) => q.includes(k));
  const ov = state.cache.aiOverview || {};
  const findings = state.cache.findings || [];
  const rules = state.cache.aiRules || [];
  const viol = state.cache.aiViol || {};
  const pendingWake = findings.filter((f) => f.level === "wake" && !state.decisions[f.id]).length;

  // ① 态势总结 —— 只读元数据,可上云
  if (has("态势", "本周", "这周", "总结", "概况", "怎么样", "风险", "现在最该")) {
    const repos = new Set(findings.map((f) => f.repo)).size;
    return {
      tier: "grounded", model: "本机接地 · 零上传",
      blocks: [
        { kind: "p", text: `本机 events.jsonl 共记录 ${ov.totalScans ?? 0} 次守门扫描,自动放行率 ${((ov.passRate ?? 1) * 100).toFixed(1)}% —— 大部分时候很安静。` },
        pendingWake > 0
          ? { kind: "p", text: `当前审查队列里有 ${pendingWake} 处 wake-you-up 在等你裁决,这是现在最该看的。其余都在安全区内。` }
          : { kind: "p", text: `审查队列里没有待裁决的 wake-you-up —— 此刻没有该惊醒你的东西。` },
        { kind: "stat", items: [["待裁决 wake", pendingWake], ["累计刹停", ov.totalBlocked ?? 0], ["守护仓库", repos]] },
      ],
    };
  }

  // ② 某批为什么被刹 —— 演示"聚类":把同来源的多条 wake 合并成一次改动(读代码,须本地)
  if (has("为什么", "被刹", "拦", "这批", "聚类", "同一次", "checkout", "deploy")) {
    const wakeFindings = findings.filter((f) => f.level === "wake").slice(0, 3);
    if (wakeFindings.length >= 2) {
      const repo = wakeFindings[0].repo;
      return {
        tier: "grounded", model: "本机接地 · 读了本地 diff",
        blocks: [
          { kind: "p", text: `${repo} 上这几条 wake 看着像三件事,实际可能是同一个 agent 的一次改动 —— 声称做 A、顺手动了 B。我把它们聚成一组给你:` },
          { kind: "cluster", items: wakeFindings.map((f) => [f.rule, f.file, f.reason || "命中高危区"]) },
          { kind: "p", text: "单看每条像噪音,合起来才是该半夜叫醒你的那种。要不要我把「驳回这批」写成提案?" },
        ],
        proposal: {
          title: `驳回 ${repo} 这批改动`,
          command: `git checkout origin/main -- ${wakeFindings.map((f) => f.file).join(" ")}  # 多条 wake 疑似同一次越权改动,与声称任务无关`,
          note: "落进终端信箱,Claude Code 取走执行 —— 你批准前不会动",
        },
      };
    }
  }

  // ③ 哪条规则在误报 / 噪音 —— 元数据 + 规则进化
  if (has("误报", "噪音", "太烦", "降级", "false")) {
    const noisy = [...rules].sort((a, b) => (b.count - b.wakeCount) - (a.count - a.wakeCount))[0];
    if (noisy) {
      return {
        tier: "grounded", model: "本机接地 · 零上传",
        blocks: [
          { kind: "p", text: `命中最多但少有 wake 的规则是 ${noisy.rule}:共 ${noisy.count} 次命中、仅 ${noisy.wakeCount} 次升到 wake。低 wake 占比通常意味着它在某些仓库偏噪音。` },
          { kind: "p", text: "符合「宁可漏,不可烦」—— 在它最吵的仓库降为 look-once,误报压力会随真实使用下降。要我写成提案吗?" },
        ],
        proposal: {
          title: `降级 ${noisy.rule}(少烦)`,
          command: `agent-diff-guard rules set ${noisy.rule} --level look`,
          note: "误报是头号死因 —— 降级噪音规则保住注意力",
        },
      };
    }
  }

  // ④ 越界 / 飞行记录 —— 零 AI 的确定性检测,AI 只读结果不裁决
  if (has("越界", "违反", "冻结", "飞行", "policy")) {
    const total = viol.totalViolations ?? 0;
    const first = (viol.byRepo || []).flatMap((r) => r.violations)[0];
    return {
      tier: "grounded", model: "本机接地 · 零上传",
      blocks: [
        { kind: "p", text: `飞行记录是零 AI 的确定性检测,我只帮你读结果:本机共检测到 ${total} 次越界${first ? `,最近一次是 ${first.policyName} —— 改了 ${(first.offendingFiles || []).join("、")}` : ""}。` },
        { kind: "p", text: "越界判定本身不该用 AI(那会引入误判)—— 这块我只总结,不裁决。" },
      ],
    };
  }

  // 默认:守在范围内,礼貌拒答范围外
  return {
    tier: "meta", model: "本机聚合 · 元数据",
    blocks: [
      { kind: "p", text: "我只在你的审计数据范围内回答 —— 守门发现、规则、越界、用量、危险地图。通用编码问题请交给你的 coding agent。" },
      { kind: "p", text: "试试问:本周态势 · 这批为什么被刹住 · 哪条规则在误报 · 近期有哪些越界。" },
    ],
  };
}

function suggestionsFor(route) {
  const byRoute = {
    queue: ["这批为什么被刹住?", "这几条是同一次改动吗?"],
    overview: ["本周风险态势如何?", "现在最该看的是哪一条?"],
    rules: ["哪条规则是噪音该降级?", "哪条规则误报最多?"],
    flight: ["近期有哪些越界?", "支付冻结期被谁碰了?"],
    danger: ["哪个区最该写进编码前上下文?", "本仓库最热的高危区是哪?"],
  };
  return byRoute[route] || ["本周风险态势如何?", "哪条规则在误报?"];
}

/* ── 命令面板 ⌘K ── */
function CommandPalette() {
  const ql = ai.palQ.trim().toLowerCase();
  const findings = state.cache.findings || [];
  const navHits = PAL_NAV.filter((n) => !ql || n.label.includes(ai.palQ.trim()) || n.kw.includes(ql) || n.en.toLowerCase().includes(ql));
  const findHits = ql
    ? findings.filter((f) => (f.file || "").toLowerCase().includes(ql) || (f.rule || "").toLowerCase().includes(ql) || (f.repo || "").toLowerCase().includes(ql)).slice(0, 5)
    : [];
  // 扁平列表 —— 顺序须与渲染一致,键盘高亮才对得上
  const items = [];
  navHits.forEach((n) => items.push({ type: "nav", ...n }));
  findHits.forEach((f) => items.push({ type: "find", ...f }));
  if (ql) items.push({ type: "ask", q: ai.palQ.trim() });
  if (ai.palSel >= items.length) ai.palSel = Math.max(0, items.length - 1);

  const run = (it) => {
    if (!it) return;
    if (it.type === "nav") { closePalette(); nav(it.id); }
    else if (it.type === "find") { closePalette(); nav("queue"); }
    else if (it.type === "ask") { closePalette(); openAsk(it.q); }
  };
  const lvlClass = (lv) => (lv === "wake" ? "pill-wake" : lv === "look" ? "pill-look" : "pill-pass");

  let idx = -1;
  const rows = [];
  if (navHits.length) rows.push(h("div", { class: "pal-group" }, "快捷跳转"));
  navHits.forEach((n) => {
    idx++; const i = idx;
    rows.push(h("button", { class: "pal-item" + (ai.palSel === i ? " on" : ""), onMouseenter: () => { ai.palSel = i; renderOverlays(); }, onClick: () => run(items[i]) },
      h("span", { class: "pal-item-ic" }, Icon(n.icon, 16)),
      h("span", { class: "pal-item-main" }, h("span", { class: "pal-item-label" }, n.label)),
      h("span", { class: "pal-item-en" }, n.en)));
  });
  if (findHits.length) rows.push(h("div", { class: "pal-group" }, "守门发现"));
  findHits.forEach((f) => {
    idx++; const i = idx;
    rows.push(h("button", { class: "pal-item" + (ai.palSel === i ? " on" : ""), onMouseenter: () => { ai.palSel = i; renderOverlays(); }, onClick: () => run(items[i]) },
      h("span", { class: "pal-item-ic" }, Icon("FileWarning", 16)),
      h("span", { class: "pal-item-main" },
        h("span", { class: "pal-item-label mono" }, f.file),
        h("span", { class: "pal-item-sub" }, (f.repo || "") + (f.repo ? " · " : "") + truncate(f.task, 40))),
      h("span", { class: "pill " + lvlClass(f.level) }, f.rule)));
  });
  if (ql) {
    idx++; const i = idx;
    rows.push(h("div", { class: "pal-group" }, "守门人"));
    rows.push(h("button", { class: "pal-item" + (ai.palSel === i ? " on" : ""), onMouseenter: () => { ai.palSel = i; renderOverlays(); }, onClick: () => run(items[i]) },
      h("span", { class: "pal-item-ic" }, Icon("MessageSquareText", 16)),
      h("span", { class: "pal-item-main" }, h("span", { class: "pal-item-label" }, `问守门人:「${ai.palQ.trim()}」`), h("span", { class: "pal-item-sub" }, "在审计数据范围内回答 · 只提案不动手")),
      h("span", { class: "pal-item-tag mono" }, "ASK ↵")));
  }
  if (items.length === 0) rows.push(h("div", { class: "pal-empty" }, "没有匹配项。试试仓库名、规则名,或直接描述你想问的。"));

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); ai.palSel = Math.min(ai.palSel + 1, items.length - 1); renderOverlays(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); ai.palSel = Math.max(ai.palSel - 1, 0); renderOverlays(); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[ai.palSel]); }
    else if (e.key === "Escape") { closePalette(); }
  };
  const inp = h("input", { class: "pal-inp", placeholder: "搜索发现、规则、仓库,或直接问守门人…", value: ai.palQ,
    onInput: (e) => { ai.palQ = e.target.value; ai.palSel = 0; renderOverlays(); restoreFocus(); },
    onKeydown: onKeyDown });
  setTimeout(() => inp.focus(), 0);

  return h("div", { class: "pal-backdrop", onClick: closePalette },
    h("div", { class: "pal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-label": "搜索" },
      h("div", { class: "pal-inp-row" }, Icon("Search", 17), inp, h("kbd", { class: "pal-esc mono" }, "ESC")),
      h("div", { class: "pal-list" }, ...rows),
      h("div", { class: "pal-foot" },
        h("span", { class: "pal-foot-item" }, h("kbd", { class: "pal-foot-k" }, "↑"), h("kbd", { class: "pal-foot-k" }, "↓"), "选择"),
        h("span", { class: "pal-foot-item" }, h("kbd", { class: "pal-foot-k" }, "↵"), "打开"),
        h("span", { class: "pal-foot-item" }, h("kbd", { class: "pal-foot-k" }, "esc"), "关闭"),
        h("span", { class: "pal-foot-item", style: { marginLeft: "auto" } }, h("kbd", { class: "pal-foot-k" }, "⌘K"), "随时唤起"))));
}
// 重渲染后焦点会丢,把光标还给输入框末尾
function restoreFocus() {
  setTimeout(() => { const el = $(".pal-inp"); if (el && document.activeElement !== el) { const v = el.value; el.focus(); el.setSelectionRange(v.length, v.length); } }, 0);
}

function openPalette() { ai.palOpen = true; ai.palQ = ""; ai.palSel = 0; renderOverlays(); ensureAiData().then(renderOverlays); }
function closePalette() { ai.palOpen = false; renderOverlays(); }

/* ── 问守门人 浮窗 ── */
function Prov(tier, model) {
  // local=接地·本机零上传;meta=只把元数据上了云;cloud-code=连代码正文都上了云(醒目警告)
  if (tier === "local") return h("span", { class: "prov prov-local" }, Icon("HardDrive", 11), "本机问答 · 零上传", h("span", { class: "prov-model" }, model));
  if (tier === "cloud-code") return h("span", { class: "prov prov-code" }, Icon("TriangleAlert", 11), "⚠ 代码已上云", h("span", { class: "prov-model" }, model));
  if (tier === "meta") return h("span", { class: "prov prov-cloud" }, Icon("Cloud", 11), "仅元数据 · 云", h("span", { class: "prov-model" }, model));
  return h("span", { class: "prov prov-meta" }, Icon("HardDrive", 11), "本机问答 · 零上传", h("span", { class: "prov-model" }, model));
}
function MsgBlock(b) {
  if (b.kind === "p") return h("p", { class: "ask-p" }, b.text);
  if (b.kind === "stat") return h("div", { class: "ask-stat" }, ...b.items.map(([l, v]) =>
    h("div", { class: "ask-stat-cell" }, h("div", { class: "ask-stat-n" }, v), h("div", { class: "ask-stat-l" }, l))));
  if (b.kind === "cluster") return h("div", { class: "ask-cluster" }, ...b.items.map(([rule, file, why]) =>
    h("div", { class: "ask-cl-row" }, h("div", { class: "ask-cl-top" }, Chip(rule), h("span", { class: "ask-cl-file" }, file)), h("div", { class: "ask-cl-why" }, why))));
  return false;
}
function askSend(text) {
  const t = (text || "").trim();
  if (!t || ai.askTyping) return;
  ai.askMsgs.push({ role: "user", text: t });
  ai.askTyping = true;
  renderOverlays();
  const finish = (reply) => {
    ai.askMsgs.push({ role: "ai", ...reply });
    ai.askTyping = false;
    renderOverlays();
    setTimeout(() => { const b = $(".ask-body"); if (b) b.scrollTop = b.scrollHeight; }, 0);
  };
  // 优先走 DeepSeek(/api/ai/ask);未启用/失败/超时 → 降级到本机接地问答(answerFor)。
  ensureAiData().then(() => {
    if (state.cache.aiEnabled === false) { setTimeout(() => finish(answerFor(t)), 500); return; }
    api("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: t, route: state.route }) })
      .then((r) => {
        if (r && r.ok) finish({ blocks: r.blocks, tier: r.tier, model: (r.deepCode ? "DeepSeek · 含代码" : "DeepSeek · 元数据"), proposal: r.proposal });
        else finish(answerFor(t)); // 后端降级提示 → 用本机接地
      })
      .catch(() => finish(answerFor(t))); // 网络失败 → 本机接地兜底
  });
}
function sendProposal(key, proposal) {
  ai.askSent[key] = true;
  renderOverlays();
  api("/api/inbox/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    title: proposal.title, action: proposal.command,
    context: { source: "问守门人", note: proposal.note, urgency: "medium" },
  })}).then(() => { toast("已发到终端信箱", "Inbox"); refreshBadges(); }).catch((e) => { toast("写入失败:" + e.message, "TriangleAlert"); });
}
function AskGuard() {
  const route = state.route;
  const empty = ai.askMsgs.length === 0;
  const suggestions = suggestionsFor(route);
  const aiMsg = (m, i) => {
    const prop = m.proposal && h("div", { class: "ask-prop" },
      h("div", { class: "ask-prop-head" }, Icon("Send", 12), h("span", { class: "ask-prop-title" }, m.proposal.title)),
      h("div", { class: "ask-prop-cmd mono" }, m.proposal.command),
      h("div", { class: "ask-prop-foot" },
        h("span", { class: "ask-prop-note" }, m.proposal.note),
        ai.askSent["m" + i]
          ? h("span", { class: "ask-prop-done" }, Icon("Check", 13), "已进终端信箱")
          : h("button", { class: "btn btn-ghost btn-sm", onClick: () => sendProposal("m" + i, m.proposal) }, Icon("Inbox", 13), "发到终端信箱")));
    return h("div", { class: "ask-row ai" }, h("div", { class: "ask-a" },
      ...m.blocks.map((b) => MsgBlock(b)),
      Prov(m.tier, m.model),
      prop));
  };
  const typing = h("div", { class: "ask-row ai" }, h("div", { class: "ask-typing" }, h("span"), h("span"), h("span"), h("span", { class: "ask-typing-l" }, "守门人正在看记录…")));
  const body = h("div", { class: "ask-body" },
    empty && h("div", { class: "ask-intro" }, h("p", { class: "ask-intro-p" }, F("我读你的守门记录、规则与越界历史,帮你把「现在最该看的那一两处」问出来。", h("b", null, "我只提案,执行永远在你和终端那头。")))),
    ...ai.askMsgs.map((m, i) => m.role === "user"
      ? h("div", { class: "ask-row user" }, h("div", { class: "ask-q" }, m.text))
      : aiMsg(m, i)),
    ai.askTyping && typing);

  const inp = h("input", { class: "ask-inp", placeholder: "问守门人 —— 例如:这批为什么被刹住?", value: "",
    onKeydown: (e) => { if (e.key === "Enter") { askSend(e.target.value); e.target.value = ""; } } });
  setTimeout(() => { if (empty) inp.focus(); const b = $(".ask-body"); if (b) b.scrollTop = b.scrollHeight; }, 0);

  return h("aside", { class: "ask", role: "dialog", "aria-label": "问守门人" },
    h("header", { class: "ask-head" },
      h("div", { class: "ask-head-l" }, h("div", { class: "ask-mark" }, Icon("MessageSquareText", 15)),
        h("div", null, h("div", { class: "ask-title" }, "问守门人"), h("div", { class: "ask-sub mono" }, "ASK GUARD · 只在审计数据上回答"))),
      h("button", { class: "ask-x", onClick: closeAsk, "aria-label": "关闭" }, Icon("X", 17))),
    h("div", { class: "ask-ctx" },
      h("span", { class: "ask-ctx-pill" }, Icon("Crosshair", 11), "当前上下文 · " + (ROUTE_CN[route] || route)),
      h("span", { class: "ask-ctx-note" }, state.cache.aiEnabled ? "DeepSeek 已连接 · 失败自动降级本机" : "本机接地 · 零上传 · 不动手")),
    body,
    h("div", { class: "ask-foot" },
      empty && h("div", { class: "ask-chips" }, ...suggestions.map((s) => h("button", { class: "ask-chip", onClick: () => askSend(s) }, s))),
      h("div", { class: "ask-inp-row" }, inp,
        h("button", { class: "ask-send", onClick: () => { askSend(inp.value); inp.value = ""; }, "aria-label": "发送" }, Icon("ArrowUp", 16)))));
}
function openAsk(seed) {
  ai.askOpen = true; dismissNudge(pendingWakeCount());
  renderOverlays();
  ensureAiData().then(() => { if (seed) askSend(seed); });
}
function closeAsk() { ai.askOpen = false; renderOverlays(); }

/* ── 陪伴 orb + 主动探头 ── */
function pendingWakeCount() {
  const findings = state.cache.findings || [];
  return findings.filter((f) => f.level === "wake" && !state.decisions[f.id]).length;
}
function CompanionOrb() {
  const open = ai.askOpen;
  const pw = pendingWakeCount();
  const pulsing = ai.nudgeShown && !ai.nudgeDismissed && !open;
  return h("button", { class: "comp-orb" + (open ? " on" : "") + (pulsing ? " pulsing" : ""), onClick: () => (open ? closeAsk() : openAsk()), "aria-label": "问守门人" },
    open ? Icon("ChevronDown", 22) : Icon("MessageSquareText", 21),
    !open && pw > 0 && h("span", { class: "comp-orb-badge mono" }, pw));
}
function CompanionNudge() {
  const pw = pendingWakeCount();
  if (pw <= 0) return false;
  return h("div", { class: "comp-nudge", role: "status" },
    h("button", { class: "comp-nudge-x", onClick: () => { dismissNudge(pendingWakeCount()); renderOverlays(); }, "aria-label": "知道了" }, Icon("X", 13)),
    h("div", { class: "comp-nudge-head" }, h("span", { class: "comp-nudge-dot" }), "守门人提醒"),
    h("p", { class: "comp-nudge-p" }, F("审查队列里有 ", h("b", null, pw + " 条 wake"), " 在等你裁决 —— 有几条看着像同一次改动顺手干的。要我说说吗?")),
    h("button", { class: "comp-nudge-cta", onClick: () => openAsk("这批为什么被刹住?") }, "看看怎么回事 ", Icon("ArrowRight", 13)));
}

// 主动探头:加载后若有待裁决 wake 且未打开过对话,几秒后探出一条提醒
function scheduleNudge() {
  setTimeout(() => {
    if (ai.askOpen || ai.nudgeDismissed) return;
    ensureAiData().then(() => {
      const wc = pendingWakeCount();
      // 当次会话已对同样 wake 数关闭过 → 不再重弹(P1-4)
      if (wc > 0 && !ai.askOpen && !ai.nudgeDismissed && !nudgeDismissedFor(wc)) {
        ai.nudgeShown = true; renderOverlays();
      }
    });
  }, 3500);
}

/* ============================================================
   9b. 键盘走查(j/k)
   ============================================================ */
window.addEventListener("keydown", (e) => {
  if (state.route !== "queue") return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key !== "j" && e.key !== "k") return;
  const findings = state.cache.findings || [];
  const pending = findings.filter((f) => !state.decisions[f.id]);
  const list = queueState.filter === "all" ? pending : queueState.filter === "done" ? findings.filter((f) => state.decisions[f.id]) : pending.filter((f) => f.level === queueState.filter);
  const ids = list.map((f) => f.id);
  const i = ids.indexOf(queueState.sel);
  const next = e.key === "j" ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
  if (ids[next]) { queueState.sel = ids[next]; PAGES.queue(); }
});

/* ⌘K / Ctrl-K 唤起命令面板(全局,输入框内也响应) */
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    ai.palOpen ? closePalette() : openPalette();
  }
});

/* 启动 */
render();
renderOverlays();
scheduleNudge();
