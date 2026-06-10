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
function Btn(label, { kind = "primary", icon, onClick, small } = {}) {
  return h("button", { class: `btn btn-${kind}` + (small ? " btn-sm" : ""), onClick }, icon && Icon(icon, small ? 13 : 15), label);
}
function Empty(text, icon = "Inbox") { return h("div", { class: "empty" }, Icon(icon, 24), h("div", null, text)); }
function ErrBar(msg) { return h("div", { class: "err-bar" }, Icon("WifiOff", 15), msg); }
function skeletonStats(n = 4) { return h("div", { class: "stat-row" }, ...Array.from({ length: n }, () => h("div", { class: "skel skel-stat" }))); }

/* SVG 图表:14 天风险堆叠条 */
const svgNS = "http://www.w3.org/2000/svg";
function svg(s, attrs) { const el = document.createElementNS(svgNS, s); if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
function RiskBars(rows, height = 132) {
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
    if (i % 2 === 0) { const t = svg("text", { x: x + bw / 2, y: H - 7, "text-anchor": "middle", "font-size": "9.5", fill: "var(--fg-subtle)", "font-family": "var(--font-mono)" }); t.textContent = r.date.slice(5); root.appendChild(t); }
  });
  return root;
}
function DailyBars(rows) {
  const W = 720, H = 150, P = 24;
  const data = [...rows].reverse();
  const max = Math.max(1, ...data.map((r) => r.v));
  const step = (W - P * 2) / Math.max(1, data.length);
  const bw = Math.min(30, step * 0.6);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  root.appendChild(svg("line", { x1: P, y1: H - P, x2: W - P, y2: H - P, stroke: "var(--border-subtle)" }));
  data.forEach((r, i) => {
    const ht = Math.max(2, (r.v / max) * (H - P * 2));
    const x = P + i * step + (step - bw) / 2;
    const isLast = i === data.length - 1;
    root.appendChild(svg("rect", { x, y: H - P - ht, width: bw, height: ht, rx: 3, fill: isLast ? "var(--accent)" : "var(--heatmap-low)" }));
    if (i % 2 === 0) { const t = svg("text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", "font-size": "9.5", fill: "var(--fg-subtle)", "font-family": "var(--font-mono)" }); t.textContent = r.label.slice(5); root.appendChild(t); }
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
          h("div", null, h("div", { class: "brand-name" }, "AGENT-DIFF-GUARD"), h("div", { class: "brand-sub" }, "本机只读 · 不联网"))),
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
            h("span", { class: "chip" }, Icon("Sparkles", 12), "本机数据"),
            h("button", { class: "btn btn-ghost btn-sm", onClick: () => { state.cache = {}; render(); toast("已刷新", "RefreshCw"); } }, Icon("RefreshCw", 13), "刷新"))),
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
        time: fmtTime(d.timestamp),
        repo: d.repoAlias || d.gitRange || "本地",
        kind: d.disposition === "blocked" ? "wake" : d.wakeCount > 0 ? "look" : "pass",
        text: d.disposition === "blocked" ? `push 被刹住 —— ${d.wakeCount} 处 wake-you-up` : d.rulesTriggered.length ? `命中 ${d.rulesTriggered.join("、")}${d.disposition === "auto-pass" ? ",未阻断" : ""}` : "扫描通过,放行",
      }));
      return F(
        Card({ class: "verdict " + (calm ? "verdict-calm" : "verdict-alert") },
          h("div", { class: "verdict-left" },
            h("span", { class: "ds-label verdict-tag" }, calm ? "今日态势 · 平静" : "今日态势 · 需要你"),
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
          Card({}, SectionTitle("风险趋势 · 14 天", "水位在升还是降?"),
            rows.length ? RiskBars(rows) : Empty("还没有趋势数据", "Activity"),
            h("div", { class: "legend" }, h("i", { style: { background: "var(--heatmap-low)" } }), "放行", h("i", { style: { background: "var(--warning)" } }), "look-once", h("i", { style: { background: "var(--error)" } }), "wake-you-up")),
          Card({}, SectionTitle("最近活动", "刷新页面看最新"),
            activity.length ? h("div", { class: "feed" }, ...activity.map((a) =>
              h("div", { class: "feed-row" }, h("span", { class: "dot dot-" + a.kind }),
                h("div", { class: "feed-body" }, h("div", { class: "feed-text" }, a.text),
                  h("div", { class: "feed-meta" }, h("span", { class: "mono" }, a.time), h("span", { class: "feed-repo" }, a.repo)))))) : Empty("还没有守门记录", "FileSearch"))));
    }),

  queue: () => loadPage(
    async () => state.cache.findings || (state.cache.findings = await api("/api/findings")),
    (findings) => QueueView(findings),
    h("div", { class: "queue-grid" }, h("div", { class: "skel", style: { height: "200px", borderRadius: "14px" } }), h("div", { class: "skel", style: { height: "400px", borderRadius: "14px" } }))),

  audit: () => loadPage(() => api("/api/stats/dispositions"), (disp) => AuditView(disp)),
  rules: () => loadPage(() => api("/api/stats/rules"), (rules) => RulesView(rules)),
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
        h("div", { class: "q-item-top" }, LevelPill(f.level), h("span", { class: "mono q-age" }, ago(f.timestamp))),
        h("div", { class: "q-file mono" }, f.file),
        h("div", { class: "q-meta" }, Chip(f.rule), h("span", { class: "q-repo" }, f.repo)),
        d && h("div", { class: "q-done" }, Icon(DECISION_LABEL[d.kind].icon, 12), DECISION_LABEL[d.kind].text));
    })),
    current && QueueDetail(current, { confirmApprove, reject })));
}
function QueueDetail(c, { confirmApprove, reject }) {
  const d = state.decisions[c.id];
  return Card({ class: "q-detail" },
    h("div", { class: "qd-head" },
      h("div", null, h("div", { class: "qd-file mono" }, c.file),
        h("div", { class: "qd-meta" }, LevelPill(c.level), Chip(c.rule), h("span", { class: "mono" }, c.repo + (c.branch ? " · " + c.branch : "")))),
      h("div", { class: "qd-agent" }, h("span", { class: "ds-label" }, "范围"), h("div", { class: "mono", style: { fontSize: "12px" } }, "git diff"))),
    c.task && h("div", { class: "qd-block" }, h("span", { class: "ds-label" }, "声称的任务"), h("div", { class: "qd-task" }, "「" + truncate(c.task, 160) + "」")),
    c.drift != null && h("div", { class: "qd-block" }, h("div", { class: "qd-drift-row" }, h("span", { class: "ds-label" }, "任务 ↔ 改动偏离度"), DriftMeter(c.drift))),
    h("div", { class: "qd-block" }, h("span", { class: "ds-label" }, "守门人为什么拦"), h("p", { class: "qd-reason" }, c.reason)),
    h("div", { class: "qd-block" },
      h("div", { class: "qd-diff-head" }, h("span", { class: "ds-label" }, "改动片段 · 实时取自本机 git"),
        h("span", { class: "mono" }, h("span", { class: "t-add" }, "+" + c.stats.add), " ", h("span", { class: "t-del" }, "−" + c.stats.del))),
      DiffBlock(c.diff)),
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
const DISP_PILL = { blocked: ["被刹住", "pill-wake"], "human-approved": ["人工放行", "pill-look"], "auto-pass": ["自动放行", "pill-pass"] };
function AuditView(rows) {
  const list = rows.filter((r) => auditState.disp === "all" || r.disposition === auditState.disp);
  return F(
    h("div", { class: "queue-head" },
      h("div", { class: "seg" }, ...[["all", "全部"], ["blocked", "被刹住"], ["human-approved", "人工放行"], ["auto-pass", "自动放行"]].map(([k, label]) =>
        h("button", { class: "seg-btn" + (auditState.disp === k ? " on" : ""), onClick: () => { auditState.disp = k; PAGES.audit(); } }, label)))),
    Card({}, SectionTitle("处置流水", "每条改动最终被拦了还是被放行了?全留痕。"),
      list.length === 0 ? Empty("这个筛选下没有记录。", "FileSearch") :
      h("table", { class: "tbl" },
        h("thead", null, h("tr", null, h("th", null, "时间"), h("th", null, "范围"), h("th", { class: "num" }, "wake"), h("th", null, "命中规则"), h("th", null, "处置"))),
        h("tbody", null, ...list.map((r) => {
          const [text, cls] = DISP_PILL[r.disposition] || [r.disposition, ""];
          return h("tr", null,
            h("td", null, h("span", { class: "mono" }, fmtTime(r.timestamp))),
            h("td", null, h("span", { class: "mono" }, r.gitRange)),
            h("td", { class: "num" + (r.wakeCount > 0 ? " t-del" : "") }, r.wakeCount),
            h("td", null, h("div", { class: "t-rules" }, r.rulesTriggered.length ? r.rulesTriggered.map((x) => Chip(x)) : h("span", { class: "t-dim" }, "—"))),
            h("td", null, h("span", { class: "pill " + cls }, text)));
        })))));
}

function RulesView(rules) {
  if (!rules.length) return Card({}, Empty("还没有规则命中记录 —— 跑过几次 `agent-diff-guard check` 后这里会有数据。", "SlidersHorizontal"));
  const max = Math.max(...rules.map((x) => x.count));
  return Card({}, SectionTitle("守门规则", "每条规则的命中与级别。命中越多说明 agent 越常碰这类危险区。"),
    h("table", { class: "tbl" },
      h("thead", null, h("tr", null, h("th", null, "规则"), h("th", { class: "num" }, "命中"), h("th", { class: "num" }, "其中 wake"), h("th", { style: { width: "30%" } }, "占比"))),
      h("tbody", null, ...rules.map((r) =>
        h("tr", null,
          h("td", null, h("div", { class: "r-name" }, Chip(r.rule))),
          h("td", { class: "num" }, h("span", { class: "mono" }, r.count)),
          h("td", { class: "num" }, h("span", { class: "mono" + (r.wakeCount ? " t-del" : "") }, r.wakeCount)),
          h("td", null, h("span", { class: "bar", style: { width: Math.max(8, (r.count / max) * 100) + "%" } })))))));
}

function FlightView(v) {
  const allViol = (v.byRepo || []).flatMap((r) => r.violations);
  return F(
    h("div", { class: "stat-row stat-row-3" },
      Stat(v.reposWithPolicy || 0, "有规矩的仓库", ".agent-policy.json"),
      Stat(v.totalViolations || 0, "检测到越界", "确定性检测 · 零 AI · 只记录不阻断", v.totalViolations ? "error" : undefined),
      Stat(allViol[0] ? fmtTime(allViol[0].timestamp) : "—", "最近一次越界", allViol[0] ? (allViol[0].offendingFiles || []).join("、") : "暂无")),
    ...(v.byRepo && v.byRepo.length ? v.byRepo.map((r) =>
      Card({}, SectionTitle(r.project, `${r.policyCount} 条规矩`),
        r.violations.length === 0
          ? h("div", { class: "viol-clean" }, Icon("ShieldCheck", 14), "没检测到越界 —— agent 守规矩。")
          : F(...r.violations.map((vi) =>
              h("div", { class: "viol" },
                h("div", { class: "viol-head" }, Icon("TriangleAlert", 15),
                  h("span", { class: "viol-title" }, `[${vi.policyName}] 改了 `, h("span", { class: "mono" }, (vi.offendingFiles || []).join("、")))),
                h("p", { class: "viol-why" }, vi.reason),
                h("div", { class: "viol-meta" }, h("span", { class: "mono" }, fmtTime(vi.timestamp)), vi.gitBranch && h("span", { class: "mono" }, vi.gitBranch), h("span", null, "当时任务:「" + truncate(vi.task, 40) + "」")))))))
      : [Card({}, Empty("还没有任何仓库配置 .agent-policy.json —— 给仓库定下规矩,越界才会被记录。", "PlaneTakeoff"))]),
    h("p", { class: "foot-note" }, "飞行记录只记录、不阻断,供复盘 —— 对准 Replit 式越界:被告知不准改,还是改了。"));
}

let dangerCopied = null;
function DangerView(map) {
  const copyMd = (r) => {
    const md = `# ${r.repo} 危险地图\n\n` + r.zones.map((z) => `- \`${z.path}\` (${z.rule}) — ${z.note}`).join("\n");
    navigator.clipboard?.writeText(md).then(() => { dangerCopied = r.repo; PAGES.danger(); setTimeout(() => { dangerCopied = null; }, 1800); toast("已复制 Markdown,可粘给 agent", "Copy"); });
  };
  return F(
    Card({ class: "danger-intro" },
      h("div", null, SectionTitle("危险地图", "守门人事后积累的判断,翻过来做 agent 的事前输入 —— 让它改之前就避开雷。"),
        h("p", { class: "qd-reason", style: { margin: 0 } }, "通用高危区(固化规则)+ 本仓库历史实际踩过的雷(本机 events 聚合)。只含路径与规则,不含代码正文,可放心交给任何 agent。")),
      h("div", { class: "danger-mcp" },
        h("span", { class: "ds-label" }, "投喂通道"),
        h("div", { class: "mcp-line" }, h("span", { class: "mono" }, "agent-diff-guard context"), h("span", { class: "t-dim" }, "→ system prompt")),
        h("div", { class: "mcp-line" }, h("span", { class: "mono" }, "MCP · get_repo_danger_map"), h("span", { class: "pill pill-pass" }, "已连接")))),
    ...(map.length ? map.map((r) =>
      Card({}, SectionTitle(r.repo, null, Btn(dangerCopied === r.repo ? "已复制 Markdown" : "复制给 agent", { small: true, kind: "ghost", icon: dangerCopied === r.repo ? "Check" : "Copy", onClick: () => copyMd(r) })),
        h("table", { class: "tbl" },
          h("thead", null, h("tr", null, h("th", null, "路径"), h("th", null, "来源规则"), h("th", null, "热度"), h("th", { class: "num" }, "历史命中"), h("th", null, "备注"))),
          h("tbody", null, ...r.zones.map((z) =>
            h("tr", null, h("td", null, h("span", { class: "mono z-path" }, z.path)), h("td", null, Chip(z.rule)), h("td", null, HeatDot(z.heat)), h("td", { class: "num" }, h("span", { class: "mono" }, z.hits)), h("td", { class: "t-dim" }, z.note)))))))
      : [Card({}, Empty("还没有危险地图数据。", "Map"))]));
}

function UsageView({ today, daily, projects, sessions, ov }) {
  const cachePct = today.tokens.total ? ((today.tokens.cacheRead / today.tokens.total) * 100).toFixed(0) : 0;
  const dailyRows = daily.slice(0, 14).map((d) => ({ label: d.date, v: d.tokens.total }));
  const maxCost = Math.max(1, ...projects.map((p) => p.estCostUsd));
  return F(
    h("div", { class: "stat-row" },
      Stat(fmtDur(today.activeMs), "今日活跃时长", `会话跨度 ${fmtDur(today.sessionSpanMs)}`),
      Stat(fmtK(today.tokens.total), "今日 token", `cache ${cachePct}% · out ${fmtK(today.tokens.output)}`),
      Stat(today.toolCalls.toLocaleString(), "工具调用", `${today.messages.total} 条消息 · ${today.projects} 个项目`),
      Stat("$" + today.estCostUsd.toFixed(1), "今日估算成本", "按模型单价估算,非账单", "warning")),
    Card({}, SectionTitle("每日 token · 14 天", "今天是深色那根。"),
      dailyRows.length ? DailyBars(dailyRows) : Empty("还没有每日数据", "Activity")),
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
      Card({}, SectionTitle("历史每日明细"),
        h("table", { class: "tbl tbl-tight" },
          h("thead", null, h("tr", null, h("th", null, "日期"), h("th", { class: "num" }, "活跃"), h("th", { class: "num" }, "token"), h("th", { class: "num" }, "工具"), h("th", { class: "num" }, "估算"))),
          h("tbody", null, ...daily.slice(0, 10).map((d) =>
            h("tr", null, h("td", null, h("span", { class: "mono" }, d.date)),
              h("td", { class: "num" }, fmtDur(d.activeMs)),
              h("td", { class: "num" }, h("span", { class: "mono" }, fmtK(d.tokens.total))),
              h("td", { class: "num" }, d.toolCalls),
              h("td", { class: "num" }, h("span", { class: "mono" }, "$" + d.estCostUsd.toFixed(0)))))))),
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
   9. 键盘走查(j/k)
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

/* 启动 */
render();
