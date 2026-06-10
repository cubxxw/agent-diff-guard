// serve-local.ts — 本地只读审计面板服务。
//
// `agent-diff-guard serve` 启动它:读本地 ~/.agent-diff-guard/events.jsonl,
// 把聚合结果通过 HTTP 暴露给 web/ 面板。纯本地、只读、零上传 —— 数据不出这台机器。
//
// 刻意不做的事(守产品哲学):
//   - 不做 WebSocket/SSE/轮询推送。面板是"周期性看趋势",不是实时大屏。
//     每次刷新页面才重新聚合,不主动 push。
//   - 不写、不删事件,只读。

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readEvents } from "./logger";
import { ruleRank, timeline, dispositions, overview } from "./stats";
import { allSessions, projectUsage, usageOverview, recentSessions } from "./sessions";
import { allRecords, dailyStats, dayStat } from "./daily";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*", // 本地面板跨端口读取
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: JSON_HEADERS });
}

// ── 缓存:扫全部 session 日志很慢(秒级),同一面板的多个请求共享一次扫描。 ──
// TTL 30s:刷新页面能拿到几乎最新的数据,又不会每个请求都重扫一遍磁盘。
const TTL_MS = 30_000;
let recCache: { at: number; data: ReturnType<typeof allRecords> } | null = null;
let sessCache: { at: number; data: ReturnType<typeof allSessions> } | null = null;

function cachedRecords(): ReturnType<typeof allRecords> {
  if (!recCache || Date.now() - recCache.at > TTL_MS) recCache = { at: Date.now(), data: allRecords() };
  return recCache.data;
}
function cachedSessions(): ReturnType<typeof allSessions> {
  if (!sessCache || Date.now() - sessCache.at > TTL_MS) sessCache = { at: Date.now(), data: allSessions() };
  return sessCache.data;
}

/** web 静态资源目录(相对本文件) */
function webDir(): string {
  return join(import.meta.dir, "..", "web");
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── 守门审计 API:实时聚合 events.jsonl ──
  if (path === "/api/stats/overview") return jsonResponse(overview(readEvents()));
  if (path === "/api/stats/rules") return jsonResponse(ruleRank(readEvents()));
  if (path === "/api/stats/timeline") return jsonResponse(timeline(readEvents()));
  if (path === "/api/stats/dispositions") return jsonResponse(dispositions(readEvents()));

  // ── 成本/Session API:解析 Claude Code 本地 session 日志(读一次复用) ──
  if (path.startsWith("/api/sessions/")) {
    const sessions = cachedSessions();
    if (path === "/api/sessions/overview") return jsonResponse(usageOverview(sessions));
    if (path === "/api/sessions/projects") return jsonResponse(projectUsage(sessions));
    if (path === "/api/sessions/recent") return jsonResponse(recentSessions(sessions));
  }

  // ── 今日/Daily API:按天切片的活跃度(token/消息/工具/活跃时长) ──
  if (path.startsWith("/api/daily/")) {
    const records = cachedRecords();
    if (path === "/api/daily/list") return jsonResponse(dailyStats(records));
    if (path === "/api/daily/today") {
      const today = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
      return jsonResponse(dayStat(today, records));
    }
  }

  // ── 静态面板 ──
  if (path === "/" || path === "/index.html") {
    const f = Bun.file(join(webDir(), "index.html"));
    if (await f.exists()) return new Response(f, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("web/index.html 缺失 —— 请确认从 repo 根目录运行", { status: 404 });
  }
  // 其余静态文件(app.js 等),限制在 web/ 内防目录穿越
  const safe = path.replace(/\.\./g, "").replace(/^\/+/, "");
  const candidate = join(webDir(), safe);
  if (candidate.startsWith(webDir()) && existsSync(candidate)) {
    return new Response(Bun.file(candidate));
  }

  return new Response("Not Found", { status: 404 });
}

export function startLocalServer(port = 4757): void {
  const server = Bun.serve({ port, fetch: handle });
  const n = readEvents().length;
  console.log(`\n  agent-diff-guard 审计面板(本地、只读)`);
  console.log(`  ▸ http://localhost:${server.port}`);
  console.log(`  ▸ 已读取 ${n} 条守门事件  (Ctrl-C 退出)\n`);
}
