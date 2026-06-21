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
  Download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3",
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
  Terminal: "M4 17l6-6-6-6|M12 19h8",
  FolderOpen: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  ChevronRight: "m9 18 6-6-6-6",
  ChevronUp: "m18 15-6-6-6 6",
  GitBranch: "M6 3v12|M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 9a9 9 0 0 1-9 9",
  Menu: "M4 6h16|M4 12h16|M4 18h16",
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
// 本地日期 YYYY-MM-DD —— 绝不用 toISOString(那是 UTC,北京时区凌晨前差一天,会和后端按本地日聚合的口径打架)
const localDateStr = (d = new Date()) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
// 浏览器实际时区偏移,渲染成 UTC±N(分享卡片用,避免跨时区歧义)
const tzLabel = () => { const off = -new Date().getTimezoneOffset() / 60; return "UTC" + (off >= 0 ? "+" : "") + off; };
// "2026-06-17 周三 · UTC+8 · 14:30 生成" —— 分享卡片时间锚点(日期+时区,本地实时)
const shareStamp = (dateStr) => {
  const now = new Date();
  const wk = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
  const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
  const datePart = dateStr || localDateStr(now);
  // 历史某天:dateStr 与今天不同 → 只给日期(那天没有"生成时刻"概念);今天 → 带星期+时区+生成时刻
  return datePart === localDateStr(now)
    ? `${datePart} ${wk} · ${tzLabel()} · ${hh}:${mm} 生成`
    : `${datePart} · ${tzLabel()}`;
};

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
function Card(props, ...kids) {
  // 透传 class/style 外的其余 props(role/tabindex/aria-*/onKeydown 等),让卡片可按需当按钮、键盘可达。
  const rest = {};
  for (const k in props) { if (k !== "class" && k !== "style") rest[k] = props[k]; }
  return h("div", Object.assign({ class: "card " + (props.class || ""), style: props.style }, rest), ...kids);
}
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
// "现在还能不能处置"——决定放行/驳回是否仍有意义。前端最该让人一眼看清的状态。
const DISPOSABLE_META = {
  uncommitted: ["可处置 · 未提交", "disp-ok", "改动还在工作区,放行/驳回都来得及"],
  unpushed: ["可处置 · 未推送", "disp-warn", "已提交但未 push,仍可本地 reset/amend"],
  history: ["已落地 · 仅记录", "disp-locked", "历史改动早已合并,裁决只作留痕、不可逆"],
};
function DisposableBadge(d) { const m = DISPOSABLE_META[d]; return m ? h("span", { class: "disp " + m[1], title: m[2] }, m[0]) : false; }
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
    // 共 N 次扫描:用当天真实扫描次数(eventCount),不要把 wake/look(命中数,单位不同)与 pass 混加(P2-2)
    const scans = r.event != null ? r.event : r.pass;
    hit.addEventListener("mousemove", (e) => showTip(e, `<b>${r.date}</b><br>wake ${r.wake} · look ${r.look} · 放行 ${r.pass}<br>共 ${scans} 次扫描`));
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
function DiffBlock(lines, agent) {
  // 行级 AI 归因:新增行(+)就是 agent 写的 —— 给它标 ai-line + tooltip,
  // 让评审一眼聚焦"AI 写的行"(研究验证的有效模式)。不承诺跨 squash/rebase 持久化,
  // 只对当下这次实时 diff 标注 —— 诚实地只声称做得到的。
  const aiTitle = agent ? `${agent} 新增的行` : "AI 新增的行";
  return h("div", { class: "diff" }, ...(lines || []).map((l) => {
    const isAi = l.t === "+";
    return h("div", { class: "diff-line " + (l.t === "+" ? "diff-add" : l.t === "-" ? "diff-del" : "") + (isAi ? " ai-line" : ""), title: isAi ? aiTitle : undefined },
      h("span", { class: "diff-sign" }, l.t === " " ? "" : l.t), h("span", null, l.s));
  }));
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
  // USAGE / LOOP 是辅助能力,默认折叠 —— 让侧栏第一屏聚焦"守门 + 飞行记录"核心主线,
  // 而非把 12 个入口平铺成综合 dashboard(产品定位:关键时刻刹车,不做 dashboard)。
  { group: "用量 USAGE", collapsible: true, items: [{ id: "usage", label: "用量与成本", en: "COST", icon: "Activity" }] },
  { group: "闭环 LOOP", collapsible: true, items: [
    { id: "projects", label: "项目", en: "PROJECTS", icon: "HardDrive" },
    { id: "inbox", label: "终端信箱", en: "INBOX", icon: "Inbox", badge: "inbox" },
    { id: "runlog", label: "执行记录", en: "EXEC LOG", icon: "Terminal" },
    { id: "loops", label: "Loop 监控", en: "LOOP MONITOR", icon: "Repeat" },
    { id: "morning", label: "晨报", en: "MORNING", icon: "Sunrise" },
  ]},
];
const PAGE_TITLE = {
  overview: ["总览", "今天该不该担心,一眼看完"],
  queue: ["审查队列", "被刹住的改动在这里等你裁决 —— 放行、驳回或标记误报"],
  audit: ["守门记录", "每一次扫描与处置的完整留痕"],
  rules: ["规则", "命中、级别与精度 —— 误报是头号死因"],
  flight: ["越界记录", "agent 有没有违反人定下的规矩(飞行黑匣子:只记录、不阻断)"],
  danger: ["危险地图", "把守门人的判断,变成 agent 编码前的输入"],
  usage: ["用量与成本", "一个人 × N 个 agent,烧了多少"],
  projects: ["项目", "注册项目:给每个仓库配工作目录与权限级别,daemon 自动路由"],
  inbox: ["终端信箱", "面板裁决 → 指令 → 终端 agent 取走执行"],
  runlog: ["执行记录", "daemon 每一次执行与拦截的完整留痕"],
  loops: ["Loop 监控", "跨所有 loop session 的全局风险视图 —— 漂移、预算、最近裁决一眼看完"],
  morning: ["晨报", "睡醒第一眼:挑一个 session,5 秒决定继续/复盘/回滚"],
};

const state = {
  route: (() => {
    const fromHash = (location.hash || "").replace(/^#/, "").trim();
    if (fromHash) return fromHash; // URL hash 优先:可深链/分享/刷新恢复(P2-4)
    // 默认落在审查队列(待处理风险主线)而非总览 —— 产品是"关键时刻刹车",不是 dashboard。
    // 老用户的上次位置仍然尊重(localStorage 优先)。
    try { return localStorage.getItem("adg-route") || "queue"; } catch { return "queue"; }
  })(),
  decisions: (() => { try { return JSON.parse(localStorage.getItem("adg-decisions") || "{}"); } catch { return {}; } })(),
  cache: {},
  badges: { queue: 0, inbox: 0 },
  // 折叠的导航分组(默认 USAGE/LOOP 收起,聚焦核心)。存 localStorage,记住用户偏好。
  navCollapsed: (() => {
    try {
      const saved = localStorage.getItem("adg-nav-collapsed");
      return saved ? JSON.parse(saved) : { "用量 USAGE": true, "闭环 LOOP": true };
    } catch { return { "用量 USAGE": true, "闭环 LOOP": true }; }
  })(),
};
function toggleNavGroup(group) {
  state.navCollapsed[group] = !state.navCollapsed[group];
  try { localStorage.setItem("adg-nav-collapsed", JSON.stringify(state.navCollapsed)); } catch {}
  render();
}
function persistDecisions() { try { localStorage.setItem("adg-decisions", JSON.stringify(state.decisions)); } catch {} }
// 把人工裁决理由同步到本机 decisions.jsonl(证据链)。best-effort:写失败不打扰用户
// (本地 localStorage 已留痕,服务端持久化是增强而非阻塞)。disposition 用服务端枚举值。
function syncDecision(targetId, disposition, reason) {
  api("/api/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, disposition, reason: reason || "" }),
  }).catch(() => {});
}
// 移动端抽屉开关:纯 UI 临时状态,不持久化。窄屏下侧栏默认隐藏,汉堡按钮切换。
let drawerOpen = false;
// 切抽屉:更新 body class(驱动 CSS) + 重渲染(让汉堡图标在 ☰/✕ 间切换)。
// rerender 参数为 false 时只改 class(供 nav() 这类紧接着自己会 render 的调用方复用,避免双重渲染)。
function setDrawer(open, rerender = true) {
  drawerOpen = open;
  document.body.classList.toggle("drawer-open", open);
  if (rerender) render();
}
function nav(r) {
  state.route = r;
  setDrawer(false, false); // 点击导航项后自动收起抽屉(窄屏);下面紧接 render(),无需重复
  try { localStorage.setItem("adg-route", r); } catch {}
  if (location.hash.replace(/^#/, "") !== r) location.hash = r; // 同步 URL,可分享/前进后退(P2-4)
  render();
}
// 浏览器前进/后退或手改 hash → 跟随切换
window.addEventListener("hashchange", () => {
  const r = location.hash.replace(/^#/, "").trim();
  if (r && r !== state.route) { state.route = r; try { localStorage.setItem("adg-route", r); } catch {} render(); }
});

/* ============================================================
   6. 应用壳渲染
   ============================================================ */
function render() {
  const [title, subtitle] = PAGE_TITLE[state.route];
  const root = $("#root");
  root.innerHTML = "";
  document.body.classList.toggle("drawer-open", drawerOpen); // render 会重建 DOM,重新同步抽屉状态
  root.appendChild(
    h("div", { class: "shell" },
      // 移动端汉堡按钮(≤640px 显示,固定左上角);点击切换抽屉
      h("button", { class: "drawer-toggle", "aria-label": "切换导航菜单", onClick: () => setDrawer(!drawerOpen) }, Icon(drawerOpen ? "X" : "Menu", 20)),
      // 抽屉打开时的半透明遮罩,点击关闭
      h("div", { class: "drawer-backdrop", onClick: () => setDrawer(false) }),
      h("aside", { class: "side" },
        h("div", { class: "brand" },
          h("div", { class: "brand-mark" }, Icon("Shield", 18)),
          h("div", null, h("div", { class: "brand-name" }, "AGENT-DIFF-GUARD"),
            h("div", { class: "brand-sub", title: "合并前的 AI agent 改动守门人:平时放行,关键时刻刹车。wake-you-up=该半夜叫醒你确认的高危改动;look-once=看一眼即可的常规改动。" }, "数据本地存储 · Ask Guard 联网除外"))),
        h("nav", { class: "nav" }, ...NAV.map((g) => {
          const collapsed = g.collapsible && state.navCollapsed[g.group];
          // 折叠时聚合组内未读 badge,在组头露出,避免把"终端信箱有 5 条"藏没了。
          const groupBadge = collapsed
            ? g.items.reduce((sum, it) => sum + (it.badge ? (state.badges[it.badge] || 0) : 0), 0)
            : 0;
          return h("div", { class: "nav-group" + (collapsed ? " collapsed" : "") },
            g.collapsible
              ? h("button", { class: "ds-label nav-head nav-head-btn", onClick: () => toggleNavGroup(g.group), "aria-expanded": String(!collapsed) },
                  Icon(collapsed ? "ChevronRight" : "ChevronDown", 12),
                  h("span", null, g.group),
                  groupBadge > 0 ? h("span", { class: "nav-badge look" }, groupBadge) : false)
              : h("div", { class: "ds-label nav-head" }, g.group),
            ...(collapsed ? [] : g.items.map((it) => {
              const badge = it.badge ? state.badges[it.badge] : 0;
              return h("button", { class: "nav-item" + (state.route === it.id ? " on" : ""), onClick: () => nav(it.id) },
                Icon(it.icon, 16),
                h("span", { class: "nav-label" }, it.label),
                badge > 0 ? h("span", { class: "nav-badge" + (it.badge === "inbox" ? " look" : "") }, badge) : h("span", { class: "nav-en" }, it.en));
            })));
        })),
        h("div", { class: "side-foot" },
          h("div", { class: "side-status" }, h("span", { class: "dot dot-pass dot-live" }), h("span", { id: "side-repos" }, "守门中")),
          h("button", { class: "side-reset", onClick: () => { state.decisions = {}; persistDecisions(); render(); toast("已重置本地裁决记录", "RefreshCw"); } }, "重置本地裁决"))),
      h("div", { class: "main" },
        h("header", { class: "topbar" },
          h("div", null, h("h1", { class: "top-title" }, title), h("div", { class: "top-sub" }, subtitle)),
          h("div", { class: "top-right" },
            h("div", { class: "searchbox", onClick: openPalette, role: "button", tabindex: "0", "aria-label": "搜索(⌘K)", onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPalette(); } } },
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
    // 仓库计数只数真实信号(排除 demo 兜底种子,origin==="demo")。零真实数据时显示"未接入",
    // 而不是把 demo 仓库 your-org/your-repo 当成"守门中 · 1 仓库"误导新用户。
    const repoCount = new Set(q.filter((f) => f.origin !== "demo").map((f) => f.repo)).size;
    const sr = $("#side-repos"); if (sr) sr.textContent = repoCount ? `守门中 · ${repoCount} 仓库` : "未接入";
  } catch {}
  rerenderNavBadges();
  if (document.getElementById("ai-overlay")) renderOverlays(); // 同步 orb badge / nudge
}
function rerenderNavBadges() {
  // 不调 render()(会与 render 末尾的 refreshBadges 互相触发成死循环),纯 DOM patch:
  //   展开组 → patch 各 item 的 badge;
  //   折叠组 → item 未渲染,改 patch 组头的聚合 badge(否则"信箱 5 条"会被藏没)。
  document.querySelectorAll(".nav-group").forEach((grp, gi) => {
    const g = NAV[gi];
    const collapsed = g.collapsible && state.navCollapsed[g.group];
    if (collapsed) {
      const headBtn = grp.querySelector(".nav-head-btn");
      if (!headBtn) return;
      const total = g.items.reduce((s, it) => s + (it.badge ? (state.badges[it.badge] || 0) : 0), 0);
      const existing = headBtn.querySelector(".nav-badge");
      if (total > 0) {
        if (existing) existing.textContent = total;
        else headBtn.appendChild(h("span", { class: "nav-badge look" }, total));
      } else if (existing) existing.remove();
      return;
    }
    g.items.forEach((it, ii) => {
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
      // 零真实数据判定:events.jsonl 一次守门扫描都没有(demo 兜底只塞 findings 队列,
      // 不影响 events 统计)。此时 pending 里的 wake/look 全来自 demo 种子,不能当真实警报。
      const noRealData = (ov.totalScans || 0) === 0;
      const calm = wakeN === 0;
      const rows = tl.map((r) => ({ date: r.date, pass: r.passCount, look: r.lookCount, wake: r.wakeCount, event: r.eventCount })).slice(-14);
      const activity = disp.slice(0, 6).map((d) => ({
        id: d.id,
        time: fmtTime(d.timestamp),
        repo: d.repoAlias || d.gitRange || "本地",
        kind: d.disposition === "blocked" ? "wake" : d.wakeCount > 0 ? "look" : "pass",
        text: d.disposition === "blocked" ? `push 被刹住 —— ${d.wakeCount} 处 wake-you-up` : d.rulesTriggered.length ? `命中 ${d.rulesTriggered.join("、")}${d.disposition === "auto-pass" ? ",未阻断" : ""}` : "扫描通过,放行",
      }));
      // 点活动项 → 跳守门记录并自动展开那一条
      const gotoAudit = (id) => { if (id) auditOpen.add(id); nav("audit"); };
      // 零真实数据:用平静态 onboarding 卡替代 demo 警报顶栏。审查队列页的 demo 兜底仍保留,
      // 新人点进去能走通闭环,但总览第一眼不能拿 demo 当真实警报破坏"平时平静"的信任。
      const onboardCard = Card({ class: "verdict verdict-calm" },
        h("div", { class: "verdict-left" },
          h("span", { class: "ds-label verdict-tag" }, "尚未接入 · 等待第一次守门"),
          h("p", { class: "verdict-tagline" }, "AI agent 改动守门人 —— 平时放行,关键时刻刹车。"),
          h("h2", { class: "verdict-h" }, "还没有守门数据 —— 这里会很安静。"),
          h("p", { class: "verdict-p" }, "本机还没有任何真实守门事件。跑一次检查或挂上 hook,守门人就会开始记录;平时它什么都不打扰你,只在关键改动时叫醒你。"),
          h("ol", { class: "onboard-steps" },
            h("li", null, h("span", { class: "onboard-n mono" }, "1"), h("div", null, h("div", null, "在项目里跑一次检查,或装上 pre-push hook"), h("code", { class: "onboard-cmd mono" }, "bun src/cli.ts check"))),
            h("li", null, h("span", { class: "onboard-n mono" }, "2"), h("div", null, h("div", null, "给 AI agent 挂实时守门"), h("code", { class: "onboard-cmd mono" }, "bun src/cli.ts loop install-hook --agent claude"))),
            h("li", null, h("span", { class: "onboard-n mono" }, "3"), h("div", null, h("div", null, "自检环境是否就绪"), h("code", { class: "onboard-cmd mono" }, "bun src/cli.ts doctor")))),
          h("div", { class: "verdict-actions" },
            Btn("先看看审查队列长什么样", { kind: "ghost", icon: "ArrowRight", onClick: () => nav("queue") }))),
        h("div", { class: "verdict-right" },
          h("div", { class: "verdict-big mono" }, "—"),
          h("div", { class: "ds-label" }, "等待接入")));
      return F(
        noRealData ? onboardCard : Card({ class: "verdict " + (calm ? "verdict-calm" : "verdict-alert") },
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
          // 零真实数据时 findings 全是 demo 兜底,不能据此显示"在审仓库",改显"未接入"。
          Stat(noRealData ? "未接入" : (new Set(findings.map((f) => f.repo)).size || "0"), "当前在审仓库", "pre-push + MCP 双通道")),
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
    async () => {
      const [findings] = await Promise.all([
        state.cache.findings ? Promise.resolve(state.cache.findings) : api("/api/findings").then(f => (state.cache.findings = f)),
        queueState._projects.length ? Promise.resolve() : api("/api/projects").then(ps => { queueState._projects = ps || []; }).catch(() => {}),
      ]);
      return findings;
    },
    (findings) => QueueView(findings),
    h("div", { class: "queue-grid" }, h("div", { class: "skel", style: { height: "200px", borderRadius: "14px" } }), h("div", { class: "skel", style: { height: "400px", borderRadius: "14px" } }))),

  audit: () => loadPage(
    async () => {
      // 裁决理由(decisions.jsonl)与处置流水并行取;理由接口失败不拖垮主表(降级为空)。
      const [disp, decisions] = await Promise.all([
        api("/api/stats/dispositions"),
        api("/api/decisions").catch(() => ({})),
      ]);
      return { disp, decisions };
    },
    ({ disp, decisions }) => AuditView(disp, decisions)),
  rules: () => loadPage(
    async () => {
      const [rules, overrides] = await Promise.all([
        api("/api/stats/rules"),
        api("/api/rules/overrides").catch(() => ({ version: 1, overrides: {} })),
      ]);
      const findings = state.cache.findings || (state.cache.findings = await api("/api/findings"));
      return { rules, findings, overrides };
    },
    ({ rules, findings, overrides }) => RulesView(rules, findings, overrides)),
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
  projects: () => loadPage(() => api("/api/projects"), (projects) => ProjectsView(projects)),
  inbox: () => loadPage(() => api("/api/inbox/list"), (items) => InboxView(items)),
  runlog: () => loadPage(() => api("/api/runlog"), (data) => RunlogView(data)),
  loops: () => loadPage(() => api("/api/loops"), (sessions) => LoopMonitorView(sessions)),
  morning: () => loadPage(
    async () => {
      const sessions = await api("/api/loops");
      const id = morningState.selectedId || sessions[0]?.id || null;
      if (!id) return { sessions, report: null, selectedId: null };
      try {
        const report = await api("/api/loop/report?session=" + encodeURIComponent(id));
        return { sessions, report, selectedId: id };
      } catch {
        return { sessions, report: null, selectedId: id };
      }
    },
    (d) => MorningView(d)),
};

const morningState = { selectedId: null };

function MorningView({ sessions, report, selectedId }) {
  if (!sessions || sessions.length === 0) {
    return Card({}, SectionTitle("晨报", "还没有 loop session。"),
      Empty("用 agent-diff-guard loop start --goal \"...\" 启动一个 session。", "Repeat"));
  }
  const picker = h("div", { class: "row", style: { gap: "8px", flexWrap: "wrap" } },
    ...sessions.map((s) => h("button", {
      class: "pill " + (s.id === selectedId ? "pill-pass" : ""),
      onclick: () => { morningState.selectedId = s.id; render(); }
    }, (s.goal || s.id).slice(0, 40))));

  if (!report) {
    return F(Card({}, SectionTitle("晨报", "选一个 session"), picker),
      Empty("无法生成报告。session 可能已损坏或还没有迭代。", "AlertTriangle"));
  }

  const driftPct = Math.round((report.driftSummary.currentDrift || 0) * 100);
  const budgetPct = Math.round((report.budgetSummary.budgetPct || 0) * 100);
  const recCls = report.recommendation === "rollback" ? "pill-wake"
    : report.recommendation === "review-and-continue" ? "pill-look" : "pill-pass";

  const copyBtn = (text) => h("button", {
    class: "btn-mini",
    title: "复制 " + text,
    onclick: () => { try { navigator.clipboard.writeText(text); } catch {} }
  }, "复制");

  return F(
    Card({}, SectionTitle("晨报", "选一个 session"), picker),
    Card({ class: "danger-intro" },
      h("div", null,
        SectionTitle("结论", "agent 一夜跑出来的结果,值不值得继续。"),
        h("p", { class: "qd-reason", style: { margin: "8px 0 0" } },
          "迭代 ", h("strong", null, report.iterationsWhileAway), " 轮 · ",
          "漂移 ", h("strong", { style: { color: driftColor(report.driftSummary.currentDrift) } }, driftPct + "%"),
          " (", report.driftSummary.status, " · ", report.driftSummary.trend, ") · ",
          "预算 ", h("strong", null, budgetPct + "%"),
          report.budgetSummary.estimatedIterationsRemaining != null
            ? F(" · 约剩 ", h("strong", null, report.budgetSummary.estimatedIterationsRemaining), " 轮") : ""),
        report.emergencyBrakeTriggered
          ? h("p", { class: "qd-reason", style: { color: "var(--error)", marginTop: "6px" } }, "⚠ 紧急制动已触发") : ""),
      h("div", { class: "danger-mcp" },
        h("span", { class: "ds-label" }, "建议"),
        h("div", { style: { marginTop: "6px" } }, h("span", { class: "pill " + recCls }, report.recommendation)))),

    Card({}, SectionTitle("漂移原因", "目标关键词没出现在最近改的文件路径里。"),
      report.driftSummary.reason.missingKeywords.length === 0
        ? h("p", { class: "qd-reason" }, "全部目标关键词都被覆盖到了。")
        : h("p", { class: "qd-reason" }, "缺失关键词:",
            ...report.driftSummary.reason.missingKeywords.map((kw) =>
              h("span", { class: "pill pill-wake", style: { marginLeft: "6px" } }, kw))),
      report.driftSummary.reason.recentPathsSample.length > 0
        ? h("p", { class: "qd-reason mono", style: { marginTop: "8px", fontSize: "12px" } },
            "最近常改: " + report.driftSummary.reason.recentPathsSample.join(", ")) : ""),

    Card({}, SectionTitle("Top findings", "出现次数最多的命中。"),
      report.topFindings.length === 0
        ? Empty("没有 finding。", "Check")
        : h("table", { class: "tbl" },
            h("thead", null, h("tr", null,
              h("th", null, "规则"), h("th", null, "路径"),
              h("th", null, "等级"), h("th", { class: "num" }, "次数"))),
            h("tbody", null, ...report.topFindings.map((f) => h("tr", null,
              h("td", null, f.rule),
              h("td", { class: "mono" }, f.path),
              h("td", null, h("span", { class: "pill " + (f.severity === "wake-you-up" ? "pill-wake" : "pill-look") }, f.severity)),
              h("td", { class: "num mono" }, f.count)))))),

    Card({}, SectionTitle("安全回滚点", "出问题就回到这里 —— 点复制拿到 commit hash。"),
      report.rollbackCandidates.length === 0
        ? Empty("还没有 rollback point。让 loop 跑通至少一轮。", "GitBranch")
        : h("table", { class: "tbl" },
            h("thead", null, h("tr", null,
              h("th", { class: "num" }, "iter"),
              h("th", null, "commit"),
              h("th", null, "time"),
              h("th", null, ""))),
            h("tbody", null, ...report.rollbackCandidates.map((c, i) => h("tr", null,
              h("td", { class: "num mono" }, c.iteration),
              h("td", { class: "mono" }, c.commitHash.slice(0, 12)),
              h("td", { class: "mono" }, fmtTime(c.timestamp)),
              h("td", null, copyBtn(c.commitHash), i === 0 ? h("span", { class: "pill pill-pass", style: { marginLeft: "6px" } }, "首选") : ""))))))
  );
}


/* ============================================================
   8. 各页 view
   ============================================================ */
const DECISION_LABEL = {
  approved: { text: "已放行", cls: "pill-pass", icon: "Check" },
  rejected: { text: "已驳回 · 进终端信箱", cls: "pill-wake", icon: "CornerUpLeft" },
  fp: { text: "已标记误报 · 喂给规则校准", cls: "pill-look", icon: "Scale" },
};

// sel 管「看哪条详情」(单选);picked 管「批量作用对象」(会话内多选,Set of finding id),两者并存。
// batchReasonOpen:批量放行时弹一次共用理由输入的开关;batchReason:输入内容。
const queueState = { filter: "all", sel: null, reasonFor: null, reason: "", projectId: "", _projects: [], picked: new Set(), batchReasonOpen: false, batchReason: "" };
// 移动端(≤640px)队列单列、详情渲染在列表【之下】(屏外);tap 卡片后把详情滚进视口,
// 否则看着像"点了没反应"。桌面端(详情与列表并排、且 sticky)不触发,避免破坏现有体验。
function scrollDetailIntoViewOnMobile() {
  if (!window.matchMedia || !window.matchMedia("(max-width:640px)").matches) return;
  // PAGES.queue() 同步重渲染后,新的 .q-detail 已在 DOM;setTimeout 0 让浏览器先完成布局再滚。
  setTimeout(() => {
    const el = document.querySelector(".q-detail");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
}
// 队列内纯 UI 态变化(勾选 / 批量选 / 开关理由框)用这个就地重渲染:直接拿 state.cache.findings
// 重画 QueueView 写进 #page,不走 loadPage 的 setPage(skeleton)+异步重取 —— 避免每次勾选都闪一帧骨架
// 屏(那一帧里 .q-item/.q-check 短暂为 0,会被同步探针误判成"勾选后 checkbox 消失")。
// 数据有变化的路径(decide/批量裁决收尾)仍走 PAGES.queue() 重取,保持与全局刷新一致。
function rerenderQueue() {
  if (!state.cache.findings) { PAGES.queue(); return; }
  setPage(QueueView(state.cache.findings));
}
function QueueView(findings) {
  const pending = findings.filter((f) => !state.decisions[f.id]);
  const done = findings.filter((f) => state.decisions[f.id]);
  const counts = { all: pending.length, wake: pending.filter((f) => f.level === "wake").length, look: pending.filter((f) => f.level === "look").length, done: done.length };
  const list = queueState.filter === "all" ? pending : queueState.filter === "done" ? done : pending.filter((f) => f.level === queueState.filter);
  if (!queueState.sel || !findings.some((f) => f.id === queueState.sel)) queueState.sel = (list[0] || findings[0] || {}).id;
  const current = findings.find((f) => f.id === queueState.sel) || list[0];

  const decide = (id, d) => { state.decisions[id] = d; persistDecisions(); state.badges.queue = findings.filter((f) => !state.decisions[f.id]).length; PAGES.queue(); rerenderNavBadges(); };
  const confirmApprove = (f) => { const reason = queueState.reason || "未填理由"; decide(f.id, { kind: "approved", note: reason, time: "刚刚" }); syncDecision(f.id, "approved", reason); queueState.reasonFor = null; queueState.reason = ""; toast("已放行并留痕", "Check"); };
  const reject = async (f) => {
    decide(f.id, { kind: "rejected", note: "已写指令进终端信箱", time: "刚刚" });
    syncDecision(f.id, "rejected", f.reason || "与任务无关,发回终端修复");
    const body = {
      title: `驳回:撤销 ${f.file} 的改动`,
      action: `git checkout origin/main -- ${f.file}  # 与任务「${truncate(f.task, 40)}」无关,已被守门人驳回`,
      context: { rules: [f.rule], note: f.reason, urgency: f.level === "wake" ? "high" : "medium", source: "审查队列" },
    };
    if (queueState.projectId) body.projectId = queueState.projectId;
    try {
      await api("/api/inbox/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast("已驳回 · 指令已落终端信箱", "CornerUpLeft");
    } catch (e) { toast("信箱写入失败:" + e.message, "TriangleAlert"); }
  };

  // ── 批量裁决:picked(Set of id)是作用对象。批量动作逐条复用 syncDecision + 信箱构造,
  //    与逐条裁决同源,只是不弹逐条 UI。完成后清空 picked、刷 badge、toast。 ──
  const pickable = list.filter((f) => !state.decisions[f.id]); // 已处理的不参与批量
  const togglePick = (id) => { queueState.picked.has(id) ? queueState.picked.delete(id) : queueState.picked.add(id); rerenderQueue(); };
  const pickedFindings = () => findings.filter((f) => queueState.picked.has(f.id) && !state.decisions[f.id]);
  // 批量放行:共用一个理由,逐条写 decision + syncDecision。
  const batchApprove = (reason) => {
    const targets = pickedFindings();
    const note = reason || "批量放行 · 未填理由";
    for (const f of targets) { state.decisions[f.id] = { kind: "approved", note, time: "刚刚" }; syncDecision(f.id, "approved", note); }
    finishBatch(targets.length, "已批量放行 " + targets.length + " 项并留痕", "Check");
  };
  // 批量驳回:逐条复用 reject 的信箱 body 构造,每条进信箱。
  const batchReject = async () => {
    const targets = pickedFindings();
    for (const f of targets) {
      state.decisions[f.id] = { kind: "rejected", note: "已写指令进终端信箱", time: "刚刚" };
      syncDecision(f.id, "rejected", f.reason || "与任务无关,发回终端修复");
      const body = {
        title: `驳回:撤销 ${f.file} 的改动`,
        action: `git checkout origin/main -- ${f.file}  # 与任务「${truncate(f.task, 40)}」无关,已被守门人驳回`,
        context: { rules: [f.rule], note: f.reason, urgency: f.level === "wake" ? "high" : "medium", source: "审查队列 · 批量" },
      };
      if (queueState.projectId) body.projectId = queueState.projectId;
      try { await api("/api/inbox/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch {}
    }
    finishBatch(targets.length, "已批量驳回 " + targets.length + " 项 · 指令已落终端信箱", "CornerUpLeft");
  };
  // 批量标误报:逐条 fp,喂规则校准。
  const batchFp = () => {
    const targets = pickedFindings();
    for (const f of targets) { state.decisions[f.id] = { kind: "fp", note: "进入规则校准语料", time: "刚刚" }; syncDecision(f.id, "fp", "批量标记误报 · 进入规则校准语料"); }
    finishBatch(targets.length, "已批量标记 " + targets.length + " 项误报", "Scale");
  };
  // 收尾:统一 persist + 清 picked + 关理由框 + 刷 badge + 重渲染 + toast。
  const finishBatch = (n, msg, icon) => {
    persistDecisions();
    queueState.picked.clear();
    queueState.batchReasonOpen = false; queueState.batchReason = "";
    state.badges.queue = findings.filter((f) => !state.decisions[f.id]).length;
    PAGES.queue(); rerenderNavBadges();
    if (n > 0) toast(msg, icon);
  };

  // 「按组选」:全选当前列表 / 按 commit 选 / 按规则选。只作用于 pickable(未处理项)。
  const commitGroups = {}; // commit 短hash → 条数
  for (const f of pickable) { if (f.commit) commitGroups[f.commit] = (commitGroups[f.commit] || 0) + 1; }
  const ruleGroups = {};
  for (const f of pickable) { ruleGroups[f.rule] = (ruleGroups[f.rule] || 0) + 1; }
  const pickAll = () => { for (const f of pickable) queueState.picked.add(f.id); rerenderQueue(); };
  const clearPick = () => { queueState.picked.clear(); rerenderQueue(); };
  const pickByCommit = (commit) => { for (const f of pickable) if (f.commit === commit) queueState.picked.add(f.id); rerenderQueue(); };
  const pickByRule = (rule) => { for (const f of pickable) if (f.rule === rule) queueState.picked.add(f.id); rerenderQueue(); };
  const ungroupedCount = pickable.filter((f) => !f.commit).length; // commit 为 null 的(history)归"未分组"

  const groupSelect = (label, opts, onPick) => h("select", {
    class: "inp", style: { width: "auto", minWidth: "130px", fontSize: "12px" },
    value: "", onChange: (e) => { if (e.target.value !== "") { onPick(e.target.value); e.target.value = ""; } },
  }, h("option", { value: "" }, label), ...opts);

  const head = h("div", { class: "queue-head" },
    h("div", { class: "seg" }, ...[["all", `待裁决 ${counts.all}`], ["wake", `WAKE ${counts.wake}`], ["look", `LOOK ${counts.look}`], ["done", `已处理 ${counts.done}`]].map(([k, label]) =>
      h("button", { class: "seg-btn" + (queueState.filter === k ? " on" : ""), onClick: () => { queueState.filter = k; PAGES.queue(); } }, label))),
    // 按组选:仅在有可选项时露出(已处理列表 done 下 pickable 为空 → 不显示)。
    pickable.length > 0 && h("div", { class: "queue-group-sel" },
      h("button", { class: "seg-btn", onClick: pickAll, title: "全选当前列表所有未处理项" }, `全选 ${pickable.length}`),
      Object.keys(commitGroups).length > 0 && groupSelect("按 commit 选",
        Object.entries(commitGroups).map(([c, n]) => h("option", { value: c }, `${c} · ${n} 条`)), pickByCommit),
      Object.keys(ruleGroups).length > 0 && groupSelect("按规则选",
        Object.entries(ruleGroups).map(([r, n]) => h("option", { value: r }, `${r} · ${n} 条`)), pickByRule),
      ungroupedCount > 0 && h("span", { class: "kbd-hint", title: "无 commit 的历史记录不参与按 commit 全选" }, `${ungroupedCount} 条未分组`)),
    h("span", { class: "kbd-hint" }, h("kbd", null, "J"), h("kbd", null, "K"), "上下走查 · ",
      h("kbd", null, "A"), "放行 ", h("kbd", null, "R"), "驳回 ", h("kbd", null, "F"), "误报"));

  if (list.length === 0) return F(head, Card({}, Empty(queueState.filter === "done" ? "还没有处理过的发现。" : "队列空了 —— 当前没有未提交/未合并的可疑改动。守门人继续安静值守。", "ShieldCheck")));

  // sticky 批量动作条:picked 非空时露出。批量放行先弹一次共用理由输入。
  const pickedCount = pickedFindings().length;
  const batchBar = pickedCount > 0 && h("div", { class: "batch-bar" },
    h("span", { class: "batch-count" }, "已选 ", h("b", null, pickedCount), " 项"),
    queueState.batchReasonOpen
      ? F(
          (() => { const inp = h("input", { class: "inp", placeholder: "批量放行理由(共用,留痕;Esc 取消)…", value: queueState.batchReason, onInput: (e) => queueState.batchReason = e.target.value, onKeydown: (e) => { if (e.key === "Enter") batchApprove(queueState.batchReason); else if (e.key === "Escape") { e.preventDefault(); queueState.batchReasonOpen = false; rerenderQueue(); } } }); setTimeout(() => inp.focus(), 0); return inp; })(),
          Btn("确认放行", { small: true, icon: "Check", onClick: () => batchApprove(queueState.batchReason) }),
          Btn("取消", { small: true, kind: "quiet", onClick: () => { queueState.batchReasonOpen = false; rerenderQueue(); } }))
      : F(
          Btn("批量放行", { small: true, icon: "Check", kind: "ghost", onClick: () => { queueState.batchReasonOpen = true; rerenderQueue(); } }),
          Btn("批量驳回 · 发回终端", { small: true, icon: "CornerUpLeft", onClick: batchReject }),
          Btn("批量标误报", { small: true, icon: "Scale", kind: "quiet", onClick: batchFp }),
          Btn("清空选择", { small: true, kind: "quiet", onClick: clearPick })));

  return F(head, batchBar, h("div", { class: "queue-grid" },
    h("div", { class: "queue-list" }, ...list.map((f) => {
      const d = state.decisions[f.id];
      const picked = queueState.picked.has(f.id);
      const selectItem = () => { queueState.sel = f.id; PAGES.queue(); scrollDetailIntoViewOnMobile(); };
      return Card({ class: "q-item" + (current && current.id === f.id ? " q-on" : "") + (picked ? " q-picked" : ""), role: "button", tabindex: "0", "aria-label": "查看 " + f.file + " 的详情", onClick: selectItem, onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectItem(); } } },
        h("div", { class: "q-item-top" },
          h("span", { style: { display: "inline-flex", gap: "8px", alignItems: "center" } },
            // checkbox:stopPropagation 防触发选中详情;已处理项不可勾。
            !d && h("input", { type: "checkbox", class: "q-check", checked: picked, title: "加入批量裁决", onClick: (e) => { e.stopPropagation(); togglePick(f.id); } }),
            LevelPill(f.level), OriginBadge(f.origin)),
          h("span", { class: "mono q-age" }, ago(f.timestamp))),
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
      h("div", null,
        h("div", { class: "qd-file mono" }, c.file, c.disposable ? DisposableBadge(c.disposable) : false),
        h("div", { class: "qd-meta" }, LevelPill(c.level), OriginBadge(c.origin), Chip(c.rule),
          h("span", { class: "mono" }, c.repo + (c.branch ? " · " + c.branch : "") + (c.commit ? " @" + c.commit : "")))),
      h("div", { class: "qd-agent" },
        h("span", { class: "ds-label" }, "来源"),
        h("div", { class: "mono", style: { fontSize: "12px" } }, rangeLabel),
        c.agent ? h("div", { class: "mono", style: { fontSize: "11px", opacity: "0.7", marginTop: "2px" } }, c.agent) : false)),
    c.task && h("div", { class: "qd-block" },
      h("span", { class: "ds-label" }, "声称的任务",
        c.origin === "live" ? h("span", { class: "qd-task-src", title: "实时取自本机 agent 会话,仅用于本机判断偏离;不写入 events.jsonl 审计,不上报" }, " · 实时读取 · 不入审计") : false),
      h("div", { class: "qd-task" }, "「" + truncate(c.task, 160) + "」")),
    c.drift != null && h("div", { class: "qd-block" }, h("div", { class: "qd-drift-row" }, h("span", { class: "ds-label" }, "任务 ↔ 改动偏离度"), DriftMeter(c.drift))),
    h("div", { class: "qd-block" }, h("span", { class: "ds-label" }, "守门人为什么拦"), h("p", { class: "qd-reason" }, c.reason)),
    h("div", { class: "qd-block" },
      h("div", { class: "qd-diff-head" },
        h("span", { class: "ds-label" },
          c.origin === "live" ? "改动片段 · 实时取自本机 git" : c.origin === "demo" ? "改动片段 · 演示" : "改动片段",
          // 行级归因提示:让评审知道高亮的新增行就是这个 agent 写的(聚焦 AI 写的行)。
          c.origin !== "history" && c.agent ? h("span", { class: "ai-attrib", title: "新增行(绿色)由该 agent 写入 —— 聚焦审查 AI 写的行" }, " · 绿行 = " + c.agent + " 写入") : false),
        c.origin !== "history" && h("span", { class: "mono" }, h("span", { class: "t-add" }, "+" + c.stats.add), " ", h("span", { class: "t-del" }, "−" + c.stats.del))),
      c.origin === "history"
        ? h("div", { class: "q-no-diff" }, "这是一条历史被刹住的记录。隐私铁律下,events.jsonl 只留命中元数据(规则 / 路径 / 级别 / 理由),不留 diff 正文 —— 所以无法在此重放代码。要看正文,请在终端对该改动重新跑 ", h("span", { class: "mono" }, "agent-diff-guard check"), "。")
        : DiffBlock(c.diff, c.agent)),
    d ? h("div", { class: "qd-decided" }, Icon(DECISION_LABEL[d.kind].icon, 14), h("span", null, DECISION_LABEL[d.kind].text), h("span", { class: "mono" }, "· " + d.time + " · " + d.note))
      : queueState.reasonFor === c.id
        ? h("div", { class: "qd-approve" },
            (() => { const inp = h("input", { class: "inp", placeholder: "放行理由(留痕,团队可见;Esc 取消)…", value: queueState.reason, onInput: (e) => queueState.reason = e.target.value, onKeydown: (e) => { if (e.key === "Enter") confirmApprove(c); else if (e.key === "Escape") { e.preventDefault(); queueState.reasonFor = null; PAGES.queue(); } } }); setTimeout(() => inp.focus(), 0); return inp; })(),
            Btn("确认放行", { small: true, icon: "Check", onClick: () => confirmApprove(c) }),
            Btn("取消", { small: true, kind: "quiet", onClick: () => { queueState.reasonFor = null; PAGES.queue(); } }))
        : h("div", { class: "qd-actions" },
            queueState._projects.length > 0 && h("select", { class: "inp", style: { width: "auto", minWidth: "140px", fontSize: "13px" }, value: queueState.projectId, onChange: (e) => { queueState.projectId = e.target.value; } },
              h("option", { value: "" }, "目标项目(可选)"),
              ...queueState._projects.map((p) => h("option", { value: p.id }, (p.favorite ? "★ " : "") + p.name))),
            Btn("放行", { icon: "Check", kind: "ghost", onClick: () => { queueState.reasonFor = c.id; PAGES.queue(); } }),
            Btn("驳回 · 发回终端修复", { icon: "CornerUpLeft", onClick: () => reject(c) }),
            Btn("标记误报", { icon: "Scale", kind: "quiet", onClick: () => { state.decisions[c.id] = { kind: "fp", note: "进入规则校准语料", time: "刚刚" }; persistDecisions(); syncDecision(c.id, "fp", "标记误报 · 进入规则校准语料"); PAGES.queue(); rerenderNavBadges(); toast("已标记误报", "Scale"); } })));
}

const auditState = { disp: "all" };
const auditOpen = new Set();
const DISP_PILL = { blocked: ["被刹住", "pill-wake"], "human-approved": ["人工放行", "pill-look"], "auto-pass": ["自动放行", "pill-pass"] };
// 裁决 key 是 ${repo}:${range}:${rule}:${path},审计行 id 是 ULID —— 两个 id 空间永不相等,
// 直接 decisions[r.id] 恒 miss(证据包 humanDecision 永远 null)。两者唯一稳定共有的维度是
// rule + path:按 "rule path" 尾部重建索引,让审计行的每条命中能关联到它的人工裁决。
function repoTail(s) { return (s || "").split("/").filter(Boolean).slice(-2).join("/"); }
function indexDecisionsByRulePath(decisions) {
  const idx = {};
  for (const key of Object.keys(decisions || {})) {
    // key = repo:range:rule:path. MUST include repo, else two repos with same rule+path
    // would cross-link. repo has "/"; parts[2] is rule(no colon); parts[3..] rejoined is path.
    const parts = key.split(":");
    if (parts.length < 4) continue;
    const repo = repoTail(parts[0]);
    const rule = parts[2];
    const path = parts.slice(3).join(":");
    idx[repo + "|" + rule + "|" + path] = decisions[key];
  }
  return idx;
}
function decisionForRow(r, idx) {
  // audit row repo from repoRemote/repoAlias tail, aligned with decision key repo segment.
  const repo = repoTail(r.repoRemote || r.repoAlias || "");
  for (const f of r.findings || []) {
    const hit = idx[repo + "|" + f.rule + "|" + f.path];
    if (hit) return hit;
  }
  return null;
}
function AuditView(rows, decisions = {}) {
  const decisionIdx = indexDecisionsByRulePath(decisions);
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
          const row = h("tr", { class: "row-click" + (open ? " row-open" : ""), role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false", onClick: () => toggle(r.id), onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r.id); } } },
            h("td", null, h("span", { class: "row-caret" }, Icon("ArrowRight", 12)), h("span", { class: "mono" }, fmtTime(r.timestamp))),
            h("td", null, h("span", { class: "mono" }, r.gitRange)),
            h("td", { class: "num" + (r.wakeCount > 0 ? " t-del" : "") }, r.wakeCount),
            h("td", null, h("div", { class: "t-rules" }, r.rulesTriggered.length ? r.rulesTriggered.map((x) => Chip(x)) : h("span", { class: "t-dim" }, "—"))),
            h("td", null, h("span", { class: "pill " + cls }, text)));
          if (!open) return [row];
          return [row, h("tr", null, h("td", { class: "detail-cell", colspan: 5 }, AuditDetail(r, decisionForRow(r, decisionIdx))))];
        })))));
}
// 导出单条守门记录的证据包(纯前端 Blob 下载)。
// 隐私铁律:只导元数据(时间/范围/commit/命中规则/处置/理由),绝不含 diff 正文。
// findings 仅保留 rule/severity/path/whySummary —— 与面板展示同源,无代码行。
function exportEvidence(r, decision) {
  const bundle = {
    _meta: {
      kind: "agent-diff-guard-evidence",
      version: 1,
      exportedAt: new Date().toISOString(),
      note: "隐私铁律:本证据包只含守门元数据,不含 diff 正文 / task 原文 / 代码行。",
    },
    id: r.id,
    timestamp: r.timestamp,
    repoRemote: r.repoRemote || null,
    repoAlias: r.repoAlias || null,
    gitRange: r.gitRange,
    commitHash: r.commitHash || null,
    disposition: r.disposition,
    wakeCount: r.wakeCount,
    lookCount: r.lookCount,
    totalFilesChanged: r.totalFilesChanged,
    rulesTriggered: r.rulesTriggered || [],
    taskDescLen: r.taskDescLen ?? null,
    findings: (r.findings || []).map((f) => ({ rule: f.rule, severity: f.severity, path: f.path, whySummary: f.whySummary })),
    humanDecision: decision
      ? { disposition: decision.disposition, reason: decision.reason || "", timestamp: decision.timestamp }
      : null,
  };
  try {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: `evidence-${r.id}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("证据包已导出(仅元数据)", "Download");
  } catch (e) {
    toast("导出失败:" + e.message, "TriangleAlert");
  }
}
function AuditDetail(r, decision) {
  return h("div", { class: "detail-box" },
    h("div", { class: "detail-grid" },
      h("span", { class: "detail-k" }, "仓库"), h("span", { class: "detail-v mono" }, r.repoRemote || "(本地仓库)"),
      h("span", { class: "detail-k" }, "git 范围"), h("span", { class: "detail-v mono" }, r.gitRange),
      // commit SHA:扫描当时落盘的 short hash;老事件没有 → "—"。可复制做回滚锚点。
      h("span", { class: "detail-k" }, "commit"),
      h("span", { class: "detail-v mono" }, r.commitHash
        ? F(r.commitHash, " ", h("button", { class: "btn-mini", title: "复制 " + r.commitHash, onclick: () => { try { navigator.clipboard.writeText(r.commitHash); toast("已复制 commit", "Copy"); } catch {} } }, "复制"))
        : "—"),
      h("span", { class: "detail-k" }, "改动文件"), h("span", { class: "detail-v" }, F(h("b", null, r.totalFilesChanged), " 个 · ",
        h("span", { class: "t-del" }, r.wakeCount + " wake"), " / ", h("span", { class: "t-by", style: { display: "inline", color: "var(--warning)" } }, r.lookCount + " look"))),
      r.taskDescLen != null && h("span", { class: "detail-k" }, "声称任务"),
      r.taskDescLen != null && h("span", { class: "detail-v", title: "审计层(events.jsonl)只存 task 长度 + sha256,原文 hash 后即丢弃、绝不上报。注:本机 loop 会话为驱动执行会留目标原文,但仅在本机、永不出区。" }, `${r.taskDescLen} 字 · 审计层仅存 hash(原文不入审计)`)),
    // 人工裁决理由:来自本机 decisions.jsonl(证据链)。有则展示处置 + 理由 + 时间。
    decision && h("div", { class: "qd-decided", style: { marginTop: "12px" } },
      Icon((DECISION_LABEL[decision.disposition] || {}).icon || "Scale", 14),
      h("span", null, (DECISION_LABEL[decision.disposition] || {}).text || decision.disposition),
      h("span", { class: "mono" }, "· " + fmtTime(decision.timestamp) + " · " + (decision.reason || "未填理由"))),
    // 导出证据包:纯前端 Blob 下载,只含元数据(隐私铁律:绝不含 diff 正文)。
    h("div", { style: { marginTop: "12px" } },
      Btn("导出证据包", { small: true, kind: "ghost", icon: "Download", onClick: () => exportEvidence(r, decision) })),
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
// 规则治理:把面板上的禁用/降级写回服务端 overrides,再重渲染。best-effort 不阻塞 UI。
function setRuleOverride(rule, action) {
  api("/api/rules/overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rule, action }),
  }).then(() => {
    state.cache.ruleOverrides = null; // 失效缓存(若有),强制下次重取
    PAGES.rules();
    toast(action === "disable" ? "已停用该规则" : action === "downgrade" ? "已降为 look-once" : "已恢复默认", "SlidersHorizontal");
  }).catch((e) => toast("治理写入失败:" + e.message, "TriangleAlert"));
}
function RulesView(rules, findings, overrides = { overrides: {} }) {
  if (!rules.length) return Card({}, Empty("还没有规则命中记录 —— 跑过几次 `agent-diff-guard check` 后这里会有数据。", "SlidersHorizontal"));
  const ov = (overrides && overrides.overrides) || {};
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
      h("thead", null, h("tr", null, h("th", null, "规则"), h("th", null, "级别"), h("th", { class: "num" }, "命中"), h("th", { class: "num" }, "其中 wake"), h("th", { class: "num" }, "标记误报"), h("th", { style: { width: "18%" } }, "命中占比"), h("th", { style: { width: "16%" } }, "治理"))),
      h("tbody", null, ...rules.map((r) => {
        const [, lvlText, lvlCls] = ruleLevel(r);
        const fp = fpByRule[r.rule] || 0;
        const seen = seenByRule[r.rule] || 0;
        const fpRate = seen > 0 ? Math.round((fp / seen) * 100) : null;
        const action = (ov[r.rule] && ov[r.rule].action) || ""; // "" 正常 | "downgrade" | "disable"
        const suggest = fpRate != null && fpRate > 40 && !action; // 误报率>40% 且未治理 → 建议降级
        return h("tr", null,
          h("td", null, h("div", { class: "r-name" }, Chip(r.rule),
            action === "disable" ? h("span", { class: "pill pill-look", style: { marginLeft: "6px" }, title: "该规则已停用,不再产生命中" }, "已停用") : false,
            action === "downgrade" ? h("span", { class: "pill pill-look", style: { marginLeft: "6px" }, title: "该规则已降为 look-once,不再 wake-you-up" }, "已降级") : false)),
          h("td", null, h("span", { class: "lvl-tag " + lvlCls }, lvlText)),
          h("td", { class: "num" }, h("span", { class: "mono" }, r.count)),
          h("td", { class: "num" }, h("span", { class: "mono" + (r.wakeCount ? " t-del" : "") }, r.wakeCount)),
          h("td", { class: "num" }, fp > 0 ? h("span", { class: "mono t-del", title: fpRate != null ? `误报率 ${fpRate}%` : "" }, fp + (fpRate != null ? ` · ${fpRate}%` : "")) : h("span", { class: "t-dim mono" }, "0")),
          h("td", null, h("span", { class: "bar", style: { width: Math.max(8, (r.count / max) * 100) + "%" } })),
          h("td", null,
            h("select", {
              class: "inp" + (suggest ? " rule-gov-suggest" : ""),
              style: { width: "auto", minWidth: "120px", fontSize: "12px" },
              title: suggest ? "误报率偏高,建议降级 —— 但仍由你裁决" : "",
              value: action,
              onChange: (e) => setRuleOverride(r.rule, e.target.value === "" ? null : e.target.value),
            },
              h("option", { value: "" }, "正常"),
              h("option", { value: "downgrade" }, "降为 look-once"),
              h("option", { value: "disable" }, "停用")),
            suggest ? h("div", { class: "rule-gov-hint", title: `误报率 ${fpRate}%`, style: { fontSize: "11px", color: "var(--warning)", marginTop: "3px" } }, "建议降级") : false));
      }))),
    h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "12px" } },
      totalFp > 0
        ? F("你已在审查队列标记 ", h("b", null, totalFp), " 处误报。误报率 = 该规则被标误报数 / 该规则在队列出现数 —— 误报率 > 40% 的规则会在「治理」列标注「建议降级」,可直接在那一列降为 look-once 或停用(由你裁决,守门人不自动降级)。")
        : "误报率来自你在审查队列点「标记误报」的反馈,目前为 0。一旦开始标记,这里会显示每条规则的误报压力,并在「治理」列给出降级建议 —— 这是规则该不该降级的第一手依据。"),
    h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "8px" } },
      "如何添加规则:守门规则定义在 ", h("span", { class: "mono" }, "src/rules.ts"),
      " 的 SENSITIVE_PATH_RULES 表(路径级)与 contentFindings(内容级);每条带 severity:wake-you-up 或 look-once。"));
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
            const row = h("tr", { class: "row-click" + (open ? " row-open" : ""), role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false", onClick: () => toggle(key), onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); } } },
              h("td", null, h("span", { class: "row-caret" }, Icon("ArrowRight", 12)), h("span", { class: "mono z-path" }, z.path)),
              h("td", null, Chip(z.rule)),
              h("td", null, HeatDot(z.heat), h("span", { class: "mono", style: { marginLeft: "6px", fontSize: "10px", color: "var(--fg-subtle)" } }, HEAT_LABEL[z.heat] || "")),
              h("td", { class: "num" }, h("span", { class: "mono" }, z.hits)),
              h("td", { class: "t-dim" }, truncate(z.note, 28)));
            if (!open) return [row];
            return [row, h("tr", null, h("td", { class: "detail-cell", colspan: 5 }, DangerDetail(z)))];
          })),
        ),
        // 移动端提示:表格(877px)宽于窄屏视口、靠横向滚动看热度/历史命中/备注等核心列。
        // CSS 只在 ≤640px 显示这条,桌面端不出现。
        h("div", { class: "tbl-scroll-hint" }, "← 左右滑动查看热度 / 历史命中 / 备注 →"),
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

// HTML 实体转义 —— 插入 foreignObject 的字符串字段必须转义,否则破坏 XML 解析触发 onerror。
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 内联 sparkline(纯矢量,跨平台逐像素一致;处理空/单点/全等值边界,绝不报错)。
// 在 data URL SVG foreignObject → canvas 管线下安全:无 emoji、无外链、显式 xmlns/viewBox。
function sparkline(points, width, height, color) {
  const W = Math.max(1, width | 0), H = Math.max(1, height | 0), pad = 3, innerH = Math.max(1, H - pad * 2);
  const data = (Array.isArray(points) ? points : []).map(Number).filter(Number.isFinite);
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  if (data.length < 2) {
    const y = (H / 2).toFixed(2);
    const dot = data.length === 1 ? `<circle cx="${(W / 2).toFixed(2)}" cy="${y}" r="2" fill="${color}"/>` : "";
    return open + `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.35" stroke-linecap="round"/>` + dot + `</svg>`;
  }
  const min = Math.min(...data), max = Math.max(...data), range = max - min, n = data.length, stepX = W / (n - 1);
  const x = (i) => (i * stepX).toFixed(2);
  const y = (v) => range === 0 ? (H / 2).toFixed(2) : (pad + (1 - (v - min) / range) * innerH).toFixed(2);
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return open
    + `<polyline points="0,${H} ${pts} ${W},${H}" fill="${color}" fill-opacity="0.12" stroke="none"/>`
    + `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${x(n - 1)}" cy="${y(data[n - 1])}" r="2.5" fill="${color}"/></svg>`;
}

// 社交炫耀·数据海报(560×680)。所有样式内联、零 emoji(全 SVG path 图标)、字体静默 fallback。
// 大背景渐变在 renderCardBlob 的外层 SVG 铺底,这里根 div 透明。
// trend = 近 14 天 token 数值数组;nowText = 已格式化的"日期+时区+生成时刻"锚点(本地实时)。
function usageCardHTML(day, isToday, trend, nowText) {
  const W = 560, H = 680;
  const C = { fg: "#2B2822", muted: "#6B6560", subtle: "#857F79", accent: "#5D3000",
    accentSoft: "#F5EDE3", warn: "#8A5800", succ: "#4C7A3F", surface: "#FFFFFF", heroInk: "#FBEFE0", heroDim: "#D9B98E" };
  const mono = "'SF Mono','JetBrains Mono',ui-monospace,Menlo,monospace";
  const disp = "'Space Grotesk',system-ui,-apple-system,sans-serif";
  const t = day.tokens || {};
  const totalTok = Number(t.total) || 0, outTok = Number(t.output) || 0, cacheRead = Number(t.cacheRead) || 0;
  const fmtTok = (n) => { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)); };
  const fmtUsd = (n) => "$" + (Number(n) || 0).toFixed(1);
  const dur = (ms) => { const m = Math.round((Number(ms) || 0) / 60000); if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h ${mm}m` : `${h}h`; } return `${m}m`; };

  // 金句:≈ 写完 N 本《三体》(output token → 汉字 ×0.75 ÷ 单册 88 万字),不足一本降级到"万字"
  const chars = outTok * 0.75, books = chars / 880000;
  const heroLine = books >= 1 ? `≈ 写完 ${Math.ceil(books)} 本《三体》的字数` : `≈ 写完 ${Math.max(1, Math.round(chars / 10000))} 万字的体量`;
  // cache 命中率:cacheRead 占总 token 的比例(直观、可信,不会出现"省下的比花的多"的荒谬值)
  const cachePct = totalTok ? Math.round(cacheRead / totalTok * 100) : 0;
  const cacheTxt = cachePct + "%";

  // 内联 SVG path 图标(替代 emoji,跨平台一致)
  const icon = (path, color, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const P = {
    spark: '<path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3z"/>',
    cache: '<path d="M3 6c0 1.7 4 3 9 3s9-1.3 9-3-4-3-9-3-9 1.3-9 3z"/><path d="M3 6v12c0 1.7 4 3 9 3s9-1.3 9-3V6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
  };

  const spark = sparkline(Array.isArray(trend) ? trend : [], 496, 56, C.heroDim);

  const stats = [
    { ic: P.clock, label: "活跃时长", val: dur(day.activeMs), tone: C.fg },
    { ic: P.tool, label: "工具调用", val: (Number(day.toolCalls) || 0).toLocaleString("en-US"), tone: C.fg },
    { ic: P.cache, label: "cache 命中", val: cacheTxt, tone: C.succ },
    { ic: P.folder, label: "活跃项目", val: (Number(day.projects) || 0).toLocaleString("en-US"), tone: C.fg },
  ];
  const statCards = stats.map((s) =>
    `<div style="flex:1;min-width:0;background:${C.surface};border:1px solid #ECE3D7;border-radius:14px;padding:12px 11px 13px;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 2px 6px rgba(93,48,0,.05);">`
    + `<div style="display:flex;align-items:center;gap:5px;margin-bottom:7px;">${icon(s.ic, s.tone === C.succ ? C.succ : C.accent, 14)}`
    + `<span style="font:600 10px/1 ${disp};color:${C.subtle};letter-spacing:.02em;white-space:nowrap;">${esc(s.label)}</span></div>`
    + `<div style="font:700 19px/1 ${mono};color:${s.tone};letter-spacing:-.02em;">${esc(s.val)}</div></div>`
  ).join("");

  const dateText = isToday ? esc(nowText) : `${esc(day.date)} · 当日快照`;

  return `
  <div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;overflow:hidden;background:transparent;box-sizing:border-box;font-family:${disp};color:${C.fg};position:relative;">

    <div style="position:relative;margin:18px 18px 0;height:312px;border-radius:22px;overflow:hidden;padding:22px 24px 0;box-sizing:border-box;box-shadow:0 10px 30px rgba(93,48,0,.22);">
      <div style="position:absolute;left:0;top:0;right:0;bottom:0;background:linear-gradient(135deg,#5D3000 0%,#7A3F00 58%,#8A5800 100%);"></div>
      <div style="position:absolute;top:-60px;right:-40px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(255,200,130,.22),rgba(255,200,130,0) 70%);"></div>
      <div style="position:relative;">
        <div style="display:flex;align-items:center;gap:7px;">
          ${icon(P.spark, "#F2B670", 16)}
          <span style="font:700 13px/1 ${disp};color:${C.heroInk};letter-spacing:.01em;">agent-diff-guard · 我的 AI 算力日报</span>
        </div>
        <div style="margin-top:9px;display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,235,210,.25);border-radius:999px;padding:5px 12px;font:600 12px/1 ${mono};color:${C.heroInk};letter-spacing:.02em;">${dateText}</div>
        <div style="margin-top:26px;font:500 15px/1.2 ${disp};color:${C.heroDim};letter-spacing:.04em;">${isToday ? "今天,我让 AI 吞下了" : "这一天,AI 吞下了"}</div>
        <div style="margin-top:4px;display:flex;align-items:baseline;gap:10px;">
          <span style="font:700 72px/0.92 ${mono};color:#FFF7EC;letter-spacing:-.03em;">${esc(fmtTok(totalTok))}</span>
          <span style="font:600 18px/1 ${disp};color:${C.heroDim};padding-bottom:6px;">tokens</span>
        </div>
        <div style="margin-top:14px;display:flex;align-items:baseline;gap:8px;">
          <span style="font:600 13px/1 ${disp};color:${C.heroDim};letter-spacing:.05em;">估算成本</span>
          <span style="font:700 30px/1 ${mono};color:#F2B670;letter-spacing:-.02em;">${esc(fmtUsd(day.estCostUsd))}</span>
        </div>
      </div>
    </div>

    <div style="margin:16px 18px 0;background:${C.accentSoft};border:1px solid #EBDCC8;border-radius:14px;padding:11px 16px;display:flex;align-items:center;gap:9px;">
      ${icon(P.trend, C.warn, 16)}
      <span style="font:600 15px/1.2 ${disp};color:${C.accent};letter-spacing:.01em;">${esc(heroLine)}</span>
    </div>

    <div style="margin:14px 18px 0;display:flex;gap:9px;">${statCards}</div>

    <div style="margin:16px 18px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font:600 10px/1 ${disp};color:${C.subtle};letter-spacing:.08em;text-transform:uppercase;">14-day trend</span>
        <span style="font:600 10px/1 ${mono};color:${C.subtle};">${esc(fmtTok(totalTok))} today</span>
      </div>
      <div style="height:56px;">${spark}</div>
    </div>

    <div style="position:absolute;left:18px;right:18px;bottom:18px;">
      <div style="font:700 17px/1.2 ${disp};color:${C.fg};letter-spacing:.01em;">不是我卷,是我的 agent 们卷。</div>
      <div style="margin-top:6px;font:600 12px/1 ${mono};color:${C.warn};letter-spacing:.02em;">#AI算力日报  #agentdiffguard</div>
    </div>
  </div>`;
}

// 把海报 HTML 经 SVG foreignObject 渲染成 PNG Blob(2x 高清)。
// 大背景渐变用 SVG <linearGradient>+<rect> 铺在 foreignObject 之下(比 CSS gradient 在此管线下更可靠),卡片根 div 透明。
function renderCardBlob(day, isToday, trend, nowText) {
  return new Promise((resolve, reject) => {
    const W = 560, H = 680, SCALE = 2;
    const inner = usageCardHTML(day, isToday, trend, nowText);
    const svgStr =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<defs>` +
        `<linearGradient id="adgBg" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#FAF8F6"/><stop offset="0.55" stop-color="#FBF4EA"/><stop offset="1" stop-color="#F3E7D6"/>` +
        `</linearGradient>` +
        `<radialGradient id="adgGlow" cx="0.5" cy="0" r="0.9">` +
          `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.7"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>` +
        `</radialGradient>` +
      `</defs>` +
      `<rect x="0" y="0" width="${W}" height="${H}" rx="28" fill="url(#adgBg)"/>` +
      `<rect x="0" y="0" width="${W}" height="220" rx="28" fill="url(#adgGlow)"/>` +
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
async function shareUsageCard(day, isToday, trend, nowText, btn) {
  const label = btn ? btn.querySelector("span:last-child") || btn : null;
  const restore = btn ? btn.textContent : "";
  // 降级:把图片做成下载。无论是剪贴板 API 缺失,还是 write() 被权限/非安全上下文拒绝,都走这里 —— 绝不静默失败。
  const downloadBlob = (blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `adg-usage-${isToday ? localDateStr() : day.date}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  try {
    const blob = await renderCardBlob(day, isToday, trend, nowText);
    // 优先:复制到剪贴板(可直接粘进聊天/文档)
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("已复制为图片,可直接粘贴", "Copy");
      } catch {
        // 剪贴板被拒(权限/非安全上下文/非聚焦)→ 在此显式降级下载,并给反馈,不吞错。
        downloadBlob(blob);
        toast("剪贴板被拒,已改为下载图片", "ArrowRight");
      }
    } else {
      // 浏览器无 ClipboardItem → 直接下载。
      downloadBlob(blob);
      toast("剪贴板不可用,已下载图片", "ArrowRight");
    }
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
  // sparkline 趋势:近 14 天 token,倒序的 daily 还原成时间正序(旧→新)
  const trend = daily.slice(0, 14).map((d) => d.tokens.total).reverse();
  // 分享卡时间锚点:今天用"日期 周几 · 时区 · 生成时刻",历史某天用那天的日期+时区
  const nowText = shareStamp(isToday ? null : day.date);
  const maxCost = Math.max(1, ...projects.map((p) => p.estCostUsd));
  const pick = (date) => { usageState.selDate = date; PAGES.usage(); };
  return F(
    h("div", { class: "queue-head", style: { marginBottom: "-6px" } },
      h("div", { style: { display: "flex", alignItems: "baseline", gap: "10px" } },
        h("span", { class: "ds-label sec-label", style: { fontSize: "13px" } }, isToday ? "今日概览" : `${day.date} 概览`),
        !isToday && h("span", { class: "sec-hint" }, "历史某天 · 数据快照")),
      h("div", { class: "sec-right" },
        !isToday && h("button", { class: "btn btn-quiet btn-sm", onClick: () => pick(null) }, Icon("CornerUpLeft", 13), "回到今天"),
        h("button", { class: "btn btn-ghost btn-sm", onClick: (e) => shareUsageCard(day, isToday, trend, nowText, e.currentTarget) }, Icon("Copy", 13), "分享当天为图片"))),
    h("div", { class: "stat-row" },
      Stat(fmtDur(day.activeMs), dayLabel + "活跃时长", `会话跨度 ${fmtDur(day.sessionSpanMs)}`),
      Stat(fmtK(day.tokens.total), dayLabel + " token", `cache ${cachePct}% · out ${fmtK(day.tokens.output)}`),
      Stat(day.toolCalls.toLocaleString(), "工具调用", `${day.messages.total} 条消息 · ${day.projects} 个项目`),
      Stat("$" + day.estCostUsd.toFixed(1), dayLabel + "估算成本", "按模型单价估算,非账单", "warning")),
    isToday && h("p", { class: "foot-note", style: { textAlign: "left", margin: "-8px 0 0" } },
      F("「今日」按自然日(本地 ", h("span", { class: "mono" }, localDateStr()), ")切片所有 session 的当天部分;下方「最近 session」按整段会话统计,跨天会话会算进多天 —— 两者口径不同,数字不必相等。")),
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
            return h("tr", { class: "row-click" + (isSelRow ? " row-open" : ""), role: "button", tabindex: "0", "aria-pressed": isSelRow ? "true" : "false", onClick: () => pick(i === 0 ? null : d.date), onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i === 0 ? null : d.date); } } },
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

// ── 8a. 项目管理(Projects) ──
const projState = { editing: null, form: { name: "", cwd: "", permissionMode: "default", description: "" }, browser: { open: false, target: null, loading: false, current: "", parent: null, dirs: [], isGitRepo: false } };

function openDirBrowser(target) {
  projState.browser = { open: true, target, loading: true, current: "", parent: null, dirs: [], isGitRepo: false };
  PAGES.projects();
  browseTo();
}
async function browseTo(dirPath) {
  projState.browser.loading = true;
  PAGES.projects();
  try {
    const qs = dirPath ? "?path=" + encodeURIComponent(dirPath) : "";
    const data = await api("/api/browse-dirs" + qs);
    projState.browser = { ...projState.browser, loading: false, current: data.current, parent: data.parent, dirs: data.dirs, isGitRepo: data.isGitRepo };
  } catch (e) {
    projState.browser.loading = false;
    toast("无法浏览目录: " + e.message, "TriangleAlert");
  }
  PAGES.projects();
}
function selectDir(dirPath) {
  const target = projState.browser.target;
  projState.form.cwd = dirPath;
  if (target === "add" && !projState.form.name.trim()) {
    const parts = dirPath.split("/").filter(Boolean);
    projState.form.name = parts[parts.length - 1] || "";
  }
  projState.browser = { open: false, target: null, loading: false, current: "", parent: null, dirs: [], isGitRepo: false };
  PAGES.projects();
}
function closeBrowser() {
  projState.browser = { open: false, target: null, loading: false, current: "", parent: null, dirs: [], isGitRepo: false };
  PAGES.projects();
}
function DirBrowser() {
  const b = projState.browser;
  if (!b.open) return h("span");
  const overlay = h("div", { class: "dir-overlay", onClick: (e) => { if (e.target === overlay) closeBrowser(); } },
    h("div", { class: "dir-modal" },
      h("div", { class: "dir-header" },
        h("div", { class: "dir-title" }, Icon("FolderOpen", 18), " 选择项目目录"),
        h("button", { class: "dir-close", onClick: closeBrowser }, Icon("X", 16))),
      h("div", { class: "dir-path-bar" },
        b.parent ? h("button", { class: "dir-up", onClick: () => browseTo(b.parent), title: "上级目录" }, Icon("ChevronUp", 14), " 上级") : null,
        h("span", { class: "dir-current mono" }, b.current),
        b.isGitRepo ? h("span", { class: "pill pill-pass", style: { marginLeft: "8px", fontSize: "11px" } }, Icon("GitBranch", 12), " Git") : null),
      h("div", { class: "dir-select-bar" },
        Btn("选择此目录", { icon: "Check", onClick: () => selectDir(b.current) }),
        h("span", { class: "dir-hint mono" }, b.current)),
      b.loading
        ? h("div", { class: "dir-loading" }, "加载中…")
        : h("div", { class: "dir-list" },
            b.dirs.length === 0
              ? h("div", { class: "dir-empty" }, "此目录下没有子目录")
              : b.dirs.map((d) =>
                  h("div", { class: "dir-item" + (d.isGitRepo ? " dir-git" : ""), onClick: () => browseTo(d.path) },
                    Icon(d.isGitRepo ? "GitBranch" : "FolderOpen", 15),
                    h("span", { class: "dir-name" }, d.name),
                    d.isGitRepo ? h("span", { class: "pill pill-pass", style: { fontSize: "10px" } }, "git") : null,
                    h("span", { class: "dir-arrow" }, Icon("ChevronRight", 14)))))));
  return overlay;
}
const PERM_LABELS = { default: ["只读观察", "pill-pass"], acceptEdits: ["自动编辑", "pill-look"], bypassPermissions: ["完全自主", "pill-wake"] };
const PERM_OPTIONS = [["default", "default · 只读观察"], ["acceptEdits", "acceptEdits · 自动编辑"], ["bypassPermissions", "bypassPermissions · 完全自主"]];

function ProjectsView(projects) {
  const favN = projects.filter((p) => p.favorite).length;
  const editN = projects.filter((p) => p.permissionMode === "acceptEdits").length;
  const bypassN = projects.filter((p) => p.permissionMode === "bypassPermissions").length;

  const resetForm = () => { projState.form = { name: "", cwd: "", permissionMode: "default", description: "" }; };
  const addProject = async () => {
    const { name, cwd, permissionMode, description } = projState.form;
    if (!name.trim() || !cwd.trim()) { toast("请填写项目名称和目录路径", "TriangleAlert"); return; }
    try {
      await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), cwd: cwd.trim(), permissionMode, description: description.trim() || undefined }) });
      resetForm();
      toast("项目已添加", "Check");
      PAGES.projects();
    } catch (e) { toast("添加失败:" + e.message, "TriangleAlert"); }
  };
  const toggleFav = async (p) => {
    try {
      await api("/api/projects/" + p.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorite: !p.favorite }) });
      PAGES.projects();
    } catch (e) { toast("操作失败:" + e.message, "TriangleAlert"); }
  };
  const removeProject = async (p) => {
    if (!confirm(`确定删除项目「${p.name}」?`)) return;
    try {
      await api("/api/projects/" + p.id, { method: "DELETE" });
      toast("已删除", "Check");
      PAGES.projects();
    } catch (e) { toast("删除失败:" + e.message, "TriangleAlert"); }
  };
  const startEdit = (p) => {
    projState.editing = p.id;
    projState.form = { name: p.name, cwd: p.cwd, permissionMode: p.permissionMode, description: p.description || "" };
    PAGES.projects();
  };
  const saveEdit = async (p) => {
    const { name, cwd, permissionMode, description } = projState.form;
    if (!name.trim() || !cwd.trim()) { toast("名称和路径不能为空", "TriangleAlert"); return; }
    try {
      await api("/api/projects/" + p.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), cwd: cwd.trim(), permissionMode, description: description.trim() || undefined }) });
      projState.editing = null;
      resetForm();
      toast("已保存", "Check");
      PAGES.projects();
    } catch (e) { toast("保存失败:" + e.message, "TriangleAlert"); }
  };
  const cancelEdit = () => { projState.editing = null; resetForm(); PAGES.projects(); };

  const permSelect = (val, onChange) => h("select", { class: "inp", style: { width: "auto", minWidth: "180px" }, value: val, onChange: (e) => onChange(e.target.value) },
    ...PERM_OPTIONS.map(([v, label]) => h("option", { value: v, selected: val === v }, label)));

  const addForm = Card({ class: "proj-add" },
    SectionTitle("添加项目", "注册一个工作目录,daemon 执行时自动 cd 到这里"),
    h("div", { class: "proj-form" },
      h("input", { class: "inp", placeholder: "项目名称", value: projState.form.name, onInput: (e) => projState.form.name = e.target.value, onKeydown: (e) => { if (e.key === "Enter") addProject(); } }),
      h("div", { style: { display: "flex", flex: 2, gap: "4px" } },
        h("input", { class: "inp", placeholder: "/path/to/your/repo", value: projState.form.cwd, onInput: (e) => projState.form.cwd = e.target.value, style: { flex: 1 }, onKeydown: (e) => { if (e.key === "Enter") addProject(); } }),
        Btn("浏览", { icon: "FolderOpen", kind: "ghost", onClick: () => openDirBrowser("add") })),
      permSelect(projState.form.permissionMode, (v) => projState.form.permissionMode = v),
      Btn("添加", { icon: "Plus", onClick: addProject })),
    h("div", { class: "proj-form", style: { marginTop: "8px" } },
      h("input", { class: "inp", placeholder: "描述(可选)", value: projState.form.description, onInput: (e) => projState.form.description = e.target.value, style: { flex: 1 }, onKeydown: (e) => { if (e.key === "Enter") addProject(); } })));

  const projectCards = projects.length === 0
    ? Card({}, Empty("还没有注册任何项目 — 添加一个后,信箱决策可自动路由到对应目录执行。", "HardDrive"))
    : h("div", { class: "proj-list" }, ...projects.map((p) => {
        const [permLabel, permCls] = PERM_LABELS[p.permissionMode] || PERM_LABELS.default;
        const isEditing = projState.editing === p.id;

        if (isEditing) {
          return Card({ class: "proj-card proj-editing" },
            h("div", { class: "proj-form" },
              h("input", { class: "inp", value: projState.form.name, onInput: (e) => projState.form.name = e.target.value }),
              h("div", { style: { display: "flex", flex: 2, gap: "4px" } },
                h("input", { class: "inp", value: projState.form.cwd, onInput: (e) => projState.form.cwd = e.target.value, style: { flex: 1 } }),
                Btn("浏览", { small: true, icon: "FolderOpen", kind: "ghost", onClick: () => openDirBrowser("edit") })),
              permSelect(projState.form.permissionMode, (v) => projState.form.permissionMode = v)),
            h("div", { class: "proj-form", style: { marginTop: "8px" } },
              h("input", { class: "inp", value: projState.form.description, placeholder: "描述(可选)", onInput: (e) => projState.form.description = e.target.value, style: { flex: 1 } }),
              Btn("保存", { small: true, icon: "Check", onClick: () => saveEdit(p) }),
              Btn("取消", { small: true, kind: "quiet", onClick: cancelEdit })));
        }

        return Card({ class: "proj-card" },
          h("div", { class: "proj-top" },
            h("div", { class: "proj-title-row" },
              h("button", { class: "proj-star" + (p.favorite ? " on" : ""), onClick: () => toggleFav(p), title: p.favorite ? "取消收藏" : "收藏" }, p.favorite ? "★" : "☆"),
              h("div", { class: "proj-name" }, p.name),
              h("span", { class: "pill " + permCls }, permLabel)),
            h("div", { class: "proj-actions" },
              Btn("编辑", { small: true, kind: "ghost", icon: "Edit3", onClick: () => startEdit(p) }),
              Btn("删除", { small: true, kind: "quiet", icon: "Trash2", onClick: () => removeProject(p) }))),
          h("div", { class: "proj-cwd mono" }, p.cwd),
          p.description && h("div", { class: "proj-desc" }, p.description),
          h("div", { class: "proj-meta" }, h("span", { class: "mono" }, ago(p.createdAt))));
      }));

  return F(
    h("div", { class: "stat-row" },
      Stat(projects.length, "注册项目", "配置工作目录与权限"),
      Stat(favN, "收藏", "快速访问"),
      Stat(editN, "自动编辑", "acceptEdits 模式"),
      Stat(bypassN, "完全自主", "bypassPermissions 模式", bypassN > 0 ? "error" : undefined)),
    addForm, projectCards, DirBrowser());
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

// ── 8b. 执行记录(Runlog)──
const runlogState = { filter: "all" };
const runlogOpen = new Set();
const fmtMs = (ms) => { if (ms == null) return "—"; if (ms < 1000) return ms + "ms"; if (ms < 60000) return (ms / 1000).toFixed(1) + "s"; return fmtDur(ms); };
const PHASE_PILL = { pending: ["待执行", "pill-look"], blocked: ["已拦截", "pill-wake"], success: ["成功", "pill-pass"], failed: ["失败", "pill-wake"], timeout: ["超时", "pill-wake"] };
const PHASE_FILTERS = [["all", "全部"], ["success", "成功"], ["failed", "失败"], ["blocked", "已拦截"], ["pending", "待执行"]];

function RunlogView(data) {
  const { stats, items } = data;
  const list = items.filter((it) => runlogState.filter === "all" || it.phase === runlogState.filter);
  const toggle = (id) => { runlogOpen.has(id) ? runlogOpen.delete(id) : runlogOpen.add(id); PAGES.runlog(); };
  const pct = stats.totalRuns ? Math.round(stats.successRate * 100) + "%" : "—";
  return F(
    h("div", { class: "stat-row" },
      Stat(stats.totalRuns, "已执行", "runs/ 留痕"),
      Stat(pct, "成功率", "exit 0 占比", stats.successRate >= 0.9 ? "success" : stats.successRate >= 0.5 ? "" : "error"),
      Stat(stats.totalBlocked, "被拦截", "安全闸门 · 破坏性命令", stats.totalBlocked > 0 ? "error" : ""),
      Stat(stats.totalPending, "待执行", "等 daemon 取走", stats.totalPending > 0 ? "warning" : "")),
    h("div", { class: "queue-head" },
      h("div", { class: "seg" }, ...PHASE_FILTERS.map(([k, label]) =>
        h("button", { class: "seg-btn" + (runlogState.filter === k ? " on" : ""), onClick: () => { runlogState.filter = k; PAGES.runlog(); } }, label)))),
    Card({}, SectionTitle("执行时间线", "daemon 每一次执行与拦截的完整留痕。点击任意行查看详情。"),
      list.length === 0
        ? Empty("还没有执行记录 —— 在终端信箱写一条决策,再启动 agent-diff-guard run,这里就会有数据。", "Terminal")
        : h("table", { class: "tbl" },
            h("thead", null, h("tr", null, h("th", null, "时间"), h("th", null, "标题"), h("th", null, "类型"), h("th", null, "状态"), h("th", { class: "num" }, "耗时"))),
            h("tbody", null, ...list.flatMap((it) => {
              const [label, cls] = PHASE_PILL[it.phase] || ["—", ""];
              const open = runlogOpen.has(it.id);
              const row = h("tr", { class: "row-click" + (open ? " row-open" : ""), role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false", onClick: () => toggle(it.id), onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(it.id); } } },
                h("td", null, h("span", { class: "row-caret" }, Icon("ArrowRight", 12)), h("span", { class: "mono" }, fmtTime(it.time))),
                h("td", null, it.title ? (it.title.length > 50 ? it.title.slice(0, 50) + "…" : it.title) : h("span", { class: "t-dim" }, "—")),
                h("td", null, Chip(it.kind || "—")),
                h("td", null, h("span", { class: "pill " + cls }, label)),
                h("td", { class: "num mono" }, fmtMs(it.durationMs)));
              if (!open) return [row];
              return [row, h("tr", null, h("td", { class: "detail-cell", colspan: 5 }, RunlogDetail(it)))];
            })))));
}

function RunlogDetail(it) {
  if (it.phase === "blocked") {
    return h("div", { class: "detail-box" },
      h("div", { class: "detail-grid" },
        h("span", { class: "detail-k" }, "拦截理由"), h("span", { class: "detail-v" }, it.blockedReason || "—"),
        h("span", { class: "detail-k" }, "原始命令"), h("span", { class: "detail-v mono" }, it.action || "—")),
      h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "8px" } }, "安全闸门拦截了这条破坏性命令,不会自动执行。"));
  }
  if (it.phase === "pending") {
    return h("div", { class: "detail-box" },
      h("div", { class: "detail-grid" },
        h("span", { class: "detail-k" }, "命令"), h("span", { class: "detail-v mono" }, it.action || "—"),
        it.urgency && h("span", { class: "detail-k" }, "紧急度"), it.urgency && h("span", { class: "detail-v" }, it.urgency),
        it.source && h("span", { class: "detail-k" }, "来源"), it.source && h("span", { class: "detail-v" }, it.source)),
      h("p", { class: "foot-note", style: { textAlign: "left", marginTop: "8px" } }, "等待 run daemon 轮询取走。"));
  }
  // success / failed / timeout
  return h("div", { class: "detail-box" },
    h("div", { class: "detail-grid" },
      h("span", { class: "detail-k" }, "退出码"), h("span", { class: "detail-v mono" + (it.exitCode !== 0 ? " t-del" : "") }, it.exitCode ?? "—"),
      h("span", { class: "detail-k" }, "耗时"), h("span", { class: "detail-v mono" }, fmtMs(it.durationMs)),
      h("span", { class: "detail-k" }, "类型"), h("span", { class: "detail-v" }, it.kind || "—"),
      it.timedOut && h("span", { class: "detail-k" }, "超时"), it.timedOut && h("span", { class: "detail-v t-del" }, "是 — 执行被终止")),
    it.stdout && F(h("div", { class: "run-output-label" }, "STDOUT"), h("pre", { class: "run-output" }, it.stdout)),
    it.stderr && F(h("div", { class: "run-output-label" }, "STDERR"), h("pre", { class: "run-output run-output-err" }, it.stderr)));
}

// ── 8c. Loop 监控(LE-03)+ 就绪度 widget(LE-18)──
const LOOP_STATUS_PILL = {
  active: ["运行中", "pill-pass"],
  paused: ["已暂停", "pill-look"],
  stopped: ["已停止", ""],
  "emergency-braked": ["紧急制动", "pill-wake"],
};
const LOOP_VERDICT_PILL = {
  pass: ["pass", "pill-pass"],
  warn: ["warn", "pill-look"],
  block: ["block", "pill-wake"],
};

// LE-18: 从 session 列表推算 Loop 就绪度等级 L0-L3
function loopReadiness(sessions) {
  if (!sessions.length) return { level: "L0", label: "无 loop 配置", tone: "", pct: 0 };
  const hasBudget = sessions.some((s) => s.budgetTokens != null);
  const hasUnattended = sessions.some((s) => s.mode === "unattended");
  const multi = sessions.length >= 2;
  if (hasUnattended && multi) return { level: "L3", label: "无人值守 + 多 session 监控", tone: "success", pct: 100 };
  if (hasBudget) return { level: "L2", label: "已配预算闸", tone: "success", pct: 66 };
  return { level: "L1", label: "有 active session", tone: "warning", pct: 33 };
}

function ReadinessWidget(sessions) {
  const r = loopReadiness(sessions);
  return Card({ class: "danger-intro" },
    h("div", null,
      SectionTitle("Loop 就绪度", "你的仓库离\"装上就敢一直开着\"的自治 loop 还有多远(L0→L3)。"),
      h("div", { class: "seg", style: { marginTop: "6px" } },
        ...["L0", "L1", "L2", "L3"].map((lv) =>
          h("span", { class: "pill " + (lv === r.level ? "pill-pass" : "") , style: { marginRight: "6px" } }, lv))),
      h("p", { class: "qd-reason", style: { margin: "8px 0 0" } }, r.label)),
    h("div", { class: "danger-mcp" },
      h("span", { class: "ds-label" }, "就绪等级"),
      h("div", { class: "verdict-big mono", style: { fontSize: "40px", color: r.tone === "success" ? "var(--success)" : r.tone === "warning" ? "var(--warning)" : "var(--muted)" } }, r.level)));
}

function driftColor(d) {
  return d > 0.7 ? "var(--error)" : d >= 0.4 ? "var(--warning)" : "var(--success)";
}

function LoopMonitorView(sessions) {
  const active = sessions.filter((s) => s.status === "active").length;
  const braked = sessions.filter((s) => s.status === "emergency-braked").length;
  return F(
    ReadinessWidget(sessions),
    h("div", { class: "stat-row" },
      Stat(sessions.length, "Loop sessions", "全部已知 session"),
      Stat(active, "运行中", "status=active", active > 0 ? "success" : ""),
      Stat(braked, "紧急制动", "emergency-braked", braked > 0 ? "error" : "")),
    Card({}, SectionTitle("Loop session 列表", "每个 session 的漂移、预算余量与最近一次裁决。"),
      sessions.length === 0
        ? Empty("还没有 loop session —— 用 agent-diff-guard loop start --goal \"...\" 启动一个。", "Repeat")
        : h("table", { class: "tbl" },
            h("thead", null, h("tr", null,
              h("th", null, "目标"), h("th", null, "状态"), h("th", { class: "num" }, "迭代"),
              h("th", { class: "num" }, "漂移"), h("th", null, "最近裁决"), h("th", null, "更新"))),
            h("tbody", null, ...sessions.map((s) => {
              const [slabel, scls] = LOOP_STATUS_PILL[s.status] || [s.status, ""];
              const driftPct = Math.round((s.cumulativeDrift || 0) * 100);
              const [vlabel, vcls] = s.latestVerdict ? (LOOP_VERDICT_PILL[s.latestVerdict] || [s.latestVerdict, ""]) : ["—", ""];
              return h("tr", null,
                h("td", null, s.goal || h("span", { class: "t-dim" }, "—")),
                h("td", null, h("span", { class: "pill " + scls }, slabel)),
                h("td", { class: "num mono" }, s.iterationCount),
                h("td", { class: "num mono", style: { color: driftColor(s.cumulativeDrift || 0) } }, driftPct + "%"),
                h("td", null, h("span", { class: "pill " + vcls }, vlabel)),
                h("td", { class: "mono" }, fmtTime(s.updatedAt)));
            })))));
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
  { id: "runlog", label: "执行记录", en: "EXEC LOG", icon: "Terminal", kw: "runlog exec zhixing jilu daemon run blocked terminal" },
];
const ROUTE_CN = { queue: "审查队列", overview: "总览", rules: "规则", flight: "飞行记录", danger: "危险地图", audit: "守门记录", usage: "用量", inbox: "终端信箱", runlog: "执行记录" };

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
    // 提醒卡只在非队列页探出。它的作用是把人引到审查队列;一旦人已在队列页,
    // 它就和右下角 sticky 裁决动作区(放行/驳回)几何重叠、拦掉点击 —— 此时隐藏让位。
    state.route !== "queue" && !ai.askOpen && ai.nudgeShown && !ai.nudgeDismissed && !nudgeDismissedFor(pendingWakeCount()) && CompanionNudge(),
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
// 输入框与外壳只建一次;打字/方向键/hover 只局部刷新结果列表(.pal-list),
// 绝不重建 input —— 这样光标、IME、焦点都不会被打断,彻底消除逐字闪烁。
function CommandPalette() {
  const lvlClass = (lv) => (lv === "wake" ? "pill-wake" : lv === "look" ? "pill-look" : "pill-pass");

  // 根据当前 ai.palQ 算出扁平 items(顺序须与渲染一致,键盘高亮才对得上)
  const compute = () => {
    const ql = ai.palQ.trim().toLowerCase();
    const findings = state.cache.findings || [];
    const navHits = PAL_NAV.filter((n) => !ql || n.label.includes(ai.palQ.trim()) || n.kw.includes(ql) || n.en.toLowerCase().includes(ql));
    const findHits = ql
      ? findings.filter((f) => (f.file || "").toLowerCase().includes(ql) || (f.rule || "").toLowerCase().includes(ql) || (f.repo || "").toLowerCase().includes(ql)).slice(0, 5)
      : [];
    const items = [];
    navHits.forEach((n) => items.push({ type: "nav", ...n }));
    findHits.forEach((f) => items.push({ type: "find", ...f }));
    if (ql) items.push({ type: "ask", q: ai.palQ.trim() });
    if (ai.palSel >= items.length) ai.palSel = Math.max(0, items.length - 1);
    return { ql, navHits, findHits, items };
  };

  const run = (it) => {
    if (!it) return;
    if (it.type === "nav") { closePalette(); nav(it.id); }
    else if (it.type === "find") { closePalette(); nav("queue"); }
    else if (it.type === "ask") { closePalette(); openAsk(it.q); }
  };

  // 只重建结果行,不动 input。每次调用返回新的 row 元素数组。
  const buildRows = (ctx) => {
    const { ql, navHits, findHits, items } = ctx;
    let idx = -1;
    const rows = [];
    if (navHits.length) rows.push(h("div", { class: "pal-group" }, "快捷跳转"));
    navHits.forEach((n) => {
      idx++; const i = idx;
      rows.push(h("button", { class: "pal-item" + (ai.palSel === i ? " on" : ""), onMouseenter: () => setSel(i), onClick: () => run(items[i]) },
        h("span", { class: "pal-item-ic" }, Icon(n.icon, 16)),
        h("span", { class: "pal-item-main" }, h("span", { class: "pal-item-label" }, n.label)),
        h("span", { class: "pal-item-en" }, n.en)));
    });
    if (findHits.length) rows.push(h("div", { class: "pal-group" }, "守门发现"));
    findHits.forEach((f) => {
      idx++; const i = idx;
      rows.push(h("button", { class: "pal-item" + (ai.palSel === i ? " on" : ""), onMouseenter: () => setSel(i), onClick: () => run(items[i]) },
        h("span", { class: "pal-item-ic" }, Icon("FileWarning", 16)),
        h("span", { class: "pal-item-main" },
          h("span", { class: "pal-item-label mono" }, f.file),
          h("span", { class: "pal-item-sub" }, (f.repo || "") + (f.repo ? " · " : "") + truncate(f.task, 40))),
        h("span", { class: "pill " + lvlClass(f.level) }, f.rule)));
    });
    if (ql) {
      idx++; const i = idx;
      rows.push(h("div", { class: "pal-group" }, "守门人"));
      rows.push(h("button", { class: "pal-item" + (ai.palSel === i ? " on" : ""), onMouseenter: () => setSel(i), onClick: () => run(items[i]) },
        h("span", { class: "pal-item-ic" }, Icon("MessageSquareText", 16)),
        h("span", { class: "pal-item-main" }, h("span", { class: "pal-item-label" }, `问守门人:「${ai.palQ.trim()}」`), h("span", { class: "pal-item-sub" }, "在审计数据范围内回答 · 只提案不动手")),
        h("span", { class: "pal-item-tag mono" }, "ASK ↵")));
    }
    if (items.length === 0) rows.push(h("div", { class: "pal-empty" }, "没有匹配项。试试仓库名、规则名,或直接描述你想问的。"));
    return rows;
  };

  // 列表容器建一次;之后只换它的孩子,input 始终原地不动
  const list = h("div", { class: "pal-list" });
  let curItems = compute().items;
  const refreshList = () => {
    const ctx = compute();
    curItems = ctx.items;
    list.replaceChildren(...buildRows(ctx));
  };
  // 只更新高亮(方向键/hover):不重算、不重建,改 class 即可
  const setSel = (i) => {
    ai.palSel = i;
    const btns = list.querySelectorAll(".pal-item");
    btns.forEach((b, k) => b.classList.toggle("on", k === i));
  };
  refreshList();

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(Math.min(ai.palSel + 1, curItems.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(Math.max(ai.palSel - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(curItems[ai.palSel]); }
    else if (e.key === "Escape") { closePalette(); }
  };
  const inp = h("input", { class: "pal-inp", placeholder: "搜索发现、规则、仓库,或直接问守门人…", value: ai.palQ,
    onInput: (e) => { ai.palQ = e.target.value; ai.palSel = 0; refreshList(); },
    onKeydown: onKeyDown });
  setTimeout(() => inp.focus(), 0);

  return h("div", { class: "pal-backdrop", onClick: closePalette },
    h("div", { class: "pal", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-label": "搜索" },
      h("div", { class: "pal-inp-row" }, Icon("Search", 17), inp, h("kbd", { class: "pal-esc mono" }, "ESC")),
      list,
      h("div", { class: "pal-foot" },
        h("span", { class: "pal-foot-item" }, h("kbd", { class: "pal-foot-k" }, "↑"), h("kbd", { class: "pal-foot-k" }, "↓"), "选择"),
        h("span", { class: "pal-foot-item" }, h("kbd", { class: "pal-foot-k" }, "↵"), "打开"),
        h("span", { class: "pal-foot-item" }, h("kbd", { class: "pal-foot-k" }, "esc"), "关闭"),
        h("span", { class: "pal-foot-item", style: { marginLeft: "auto" } }, h("kbd", { class: "pal-foot-k" }, "⌘K"), "随时唤起"))));
}

function openPalette() {
  ai.palOpen = true; ai.palQ = ""; ai.palSel = 0; renderOverlays();
  // 数据回来后只在用户还没开始打字时才重渲染,否则会重建 input、吞掉已输入的字
  ensureAiData().then(() => { if (ai.palOpen && !ai.palQ) renderOverlays(); });
}
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
      state.cache.aiEnabled
        ? h("div", { class: "ask-disclose net" }, Icon("Cloud", 12),
            h("span", null, "发送目标:DeepSeek(api.deepseek.com)。提问与元数据会联网上云;代码正文仅在你显式开启「含代码」时才上传。"))
        : h("div", { class: "ask-disclose local" }, Icon("HardDrive", 12),
            h("span", null, "发送目标:本机接地问答。未配置 DeepSeek,问题不出本机、零上传。")),
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
// 队列裁决:a=放行(开理由框) r=驳回·发回终端 f=标误报。逻辑与详情面板 onClick 同源,
// 这里直接复用模块级 persistDecisions/syncDecision/PAGES/rerenderNavBadges/toast,不另起一套。
function kbReject(f) {
  state.decisions[f.id] = { kind: "rejected", note: "已写指令进终端信箱", time: "刚刚" };
  persistDecisions();
  state.badges.queue = (state.cache.findings || []).filter((x) => !state.decisions[x.id]).length;
  syncDecision(f.id, "rejected", f.reason || "与任务无关,发回终端修复");
  const body = {
    title: `驳回:撤销 ${f.file} 的改动`,
    action: `git checkout origin/main -- ${f.file}  # 与任务「${truncate(f.task, 40)}」无关,已被守门人驳回`,
    context: { rules: [f.rule], note: f.reason, urgency: f.level === "wake" ? "high" : "medium", source: "审查队列 · 快捷键" },
  };
  if (queueState.projectId) body.projectId = queueState.projectId;
  api("/api/inbox/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(() => toast("已驳回 · 指令已落终端信箱", "CornerUpLeft"))
    .catch((err) => toast("信箱写入失败:" + err.message, "TriangleAlert"));
  PAGES.queue(); rerenderNavBadges();
}
function kbFalsePositive(f) {
  state.decisions[f.id] = { kind: "fp", note: "进入规则校准语料", time: "刚刚" };
  persistDecisions();
  state.badges.queue = (state.cache.findings || []).filter((x) => !state.decisions[x.id]).length;
  syncDecision(f.id, "fp", "标记误报 · 进入规则校准语料");
  PAGES.queue(); rerenderNavBadges(); toast("已标记误报", "Scale");
}
window.addEventListener("keydown", (e) => {
  if (state.route !== "queue") return;
  // 焦点在输入控件里(打字)时不抢键,避免误触发裁决/走查
  const ae = document.activeElement;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const findings = state.cache.findings || [];
  const pending = findings.filter((f) => !state.decisions[f.id]);
  const list = queueState.filter === "all" ? pending : queueState.filter === "done" ? findings.filter((f) => state.decisions[f.id]) : pending.filter((f) => f.level === queueState.filter);
  // 裁决快捷键作用于当前选中且未处理的项
  if (e.key === "a" || e.key === "r" || e.key === "f") {
    const current = findings.find((f) => f.id === queueState.sel);
    if (!current || state.decisions[current.id]) return; // 没选中 / 已处理 → no-op
    e.preventDefault();
    if (e.key === "a") { queueState.reasonFor = current.id; PAGES.queue(); } // 放行:开理由框,复用现有流程
    else if (e.key === "r") kbReject(current);
    else kbFalsePositive(current);
    return;
  }
  if (e.key !== "j" && e.key !== "k") return;
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
