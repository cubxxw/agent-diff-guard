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
import { projectUsage, usageOverview, recentSessions } from "./sessions";
import { cachedAllSessions } from "./sessions-cache";
import { dailyStats, dayStat } from "./daily";
import { cachedAllRecords } from "./daily-cache";
import { isAIEnabled, buildAnalysisInput, analyzeEvents, analyzeInsights } from "./ai";
import { allTranscripts } from "./transcript";
import { buildAllInsights } from "./insights";
import { loadPolicy } from "./policy";
import { detectViolations, summarizeViolations, type Violation } from "./violations";
import { writeDecision, listPending, listDone } from "./inbox";
import { buildQueue } from "./findings";
import { repoHistory, staticZones } from "./context";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*", // 本地面板跨端口读取
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: JSON_HEADERS });
}

// ── 缓存:两层。 ──
// 底层:sessions 走增量磁盘缓存(sessions-cache.ts),只重解析当天动过的文件 —— 把首跑后的
//       全量扫描从分钟级压到亚秒级。daily 暂仍全量,但有下面的内存 TTL 兜住重复请求。
// 上层:内存 TTL,让同一次页面打开的多个请求共享一次结果,不重复遍历磁盘。
//       增量缓存已经快,所以 TTL 拉长到 5 分钟足够,既新鲜又省重复 stat。
const TTL_MS = 300_000;
let recCache: { at: number; data: ReturnType<typeof cachedAllRecords> } | null = null;
let sessCache: { at: number; data: ReturnType<typeof cachedAllSessions> } | null = null;

function cachedRecords(): ReturnType<typeof cachedAllRecords> {
  if (!recCache || Date.now() - recCache.at > TTL_MS) recCache = { at: Date.now(), data: cachedAllRecords() };
  return recCache.data;
}
function cachedSessions(): ReturnType<typeof cachedAllSessions> {
  if (!sessCache || Date.now() - sessCache.at > TTL_MS) sessCache = { at: Date.now(), data: cachedAllSessions() };
  return sessCache.data;
}

// 闭环洞察:transcript 提取走增量磁盘缓存,这里再套内存 TTL 让同次浏览复用。
let insCache: { at: number; data: ReturnType<typeof buildAllInsights> } | null = null;
function cachedInsights(): ReturnType<typeof buildAllInsights> {
  if (!insCache || Date.now() - insCache.at > TTL_MS) insCache = { at: Date.now(), data: buildAllInsights(allTranscripts()) };
  return insCache.data;
}

// 飞行记录·越界:跨仓库遍历,各自加载 .agent-policy.json,检测 agent 是否越界。
interface RepoViolations { project: string; policySource: string | null; policyCount: number; violations: Violation[] }
let violCache: { at: number; data: RepoViolations[] } | null = null;
function cachedViolations(): RepoViolations[] {
  if (violCache && Date.now() - violCache.at <= TTL_MS) return violCache.data;
  const out: RepoViolations[] = [];
  for (const rt of allTranscripts()) {
    if (!rt.repoDir) continue; // 没拿到真实仓库路径就无法读 policy(目录名解码有损,不用它)
    const ps = loadPolicy(rt.repoDir); // 用 session 自带的准确 cwd 路径
    if (ps.policies.length === 0) continue; // 没规矩的仓库不进记录(没规矩就没违规)
    const violations = detectViolations(rt.turns, ps.policies);
    out.push({ project: rt.project, policySource: ps.source, policyCount: ps.policies.length, violations });
  }
  violCache = { at: Date.now(), data: out };
  return out;
}

// 审查队列:实时跑 git diff,成本略高,内存 TTL 短一点(30s),保证"刷新看最新"又不卡。
const QUEUE_TTL_MS = 30_000;
let queueCache: { at: number; data: ReturnType<typeof buildQueue> } | null = null;
function cachedQueue(): ReturnType<typeof buildQueue> {
  if (!queueCache || Date.now() - queueCache.at > QUEUE_TTL_MS) {
    queueCache = { at: Date.now(), data: buildQueue() };
  }
  return queueCache.data;
}

/**
 * 危险地图:把每个仓库的"通用高危区(固化规则)+ 本仓库历史命中(events 聚合)"
 * 拼成面板要的形态。repo 维度来自 events.repoRemote;无 remote 的归到一组。
 */
function buildDangerMapView() {
  const events = readEvents();
  // 按 repoRemote 分组(null → "(本地仓库)")
  const repos = new Map<string, typeof events>();
  for (const ev of events) {
    const key = ev.repoRemote ?? "(本地仓库)";
    const arr = repos.get(key) ?? [];
    arr.push(ev);
    repos.set(key, arr);
  }
  const zones = staticZones();
  const out = [...repos.entries()].map(([repo, evs]) => {
    const history = repoHistory(evs, repo === "(本地仓库)" ? null : repo);
    const histByRule = new Map(history.map((h) => [h.rule, h]));
    // 合并:每条命中过的规则一行(热度由命中数+是否 wake 推),未命中的固化高危区补在后面
    const rows = history.map((h) => ({
      path: histByRule.get(h.rule)?.samplePaths[0] ?? h.rule,
      rule: h.rule,
      heat: h.wakeCount > 0 ? 3 : h.count >= 3 ? 2 : 1,
      hits: h.count,
      note: zones.find((z) => z.rule === h.rule)?.why ?? "本仓库历史命中",
    }));
    return { repo: repo.split("/").slice(-2).join("/"), zones: rows };
  });
  // 没有任何 events 命中的情况下,至少给一组通用高危区(让面板不空)
  if (out.every((r) => r.zones.length === 0)) {
    return [
      {
        repo: "通用高危区",
        zones: zones.map((z) => ({ path: z.hint, rule: z.rule, heat: 2, hits: 0, note: z.why })),
      },
    ];
  }
  return out.filter((r) => r.zones.length > 0);
}

/** 把 inbox 文件信箱(pending + done)拼成面板列表,时间倒序。 */
function buildInboxView() {
  const pending = listPending().map((i) => ({ ...i, status: "pending" as const }));
  const done = listDone();
  const all = [...pending, ...done];
  return all
    .map((i) => ({
      id: i.id,
      time: i.createdAt,
      title: i.title,
      action: i.action,
      source: (i.context as { source?: string }).source ?? "审查队列",
      status: i.status,
    }))
    .sort((a, b) => b.time.localeCompare(a.time));
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

  // ── 审查队列 API:当下未提交/未合并的真实改动,实时 git diff(正文只流给本机) ──
  if (path === "/api/findings") return jsonResponse(cachedQueue());

  // ── 危险地图 API:通用高危区 + 本仓库历史命中(按 repo 分组) ──
  if (path === "/api/danger-map") return jsonResponse(buildDangerMapView());

  // ── 终端信箱列表 API:pending + done 全量(状态可见) ──
  if (path === "/api/inbox/list") return jsonResponse(buildInboxView());

  // ── AI 分析 API:只读元数据 → DeepSeek → 摘要+建议(配了 key 才启用) ──
  if (path === "/api/ai/status") return jsonResponse({ enabled: isAIEnabled() });

  if (path === "/api/ai/analyze" && req.method === "POST") {
    if (!isAIEnabled()) return jsonResponse({ ok: false, reason: "AI 未启用(未配置 DEEPSEEK_API_KEY)" });
    // body 可选传 ids[](只分析选中的事件);不传则分析全部。
    let ids: string[] | undefined;
    try {
      const body = (await req.json()) as { ids?: string[] };
      ids = Array.isArray(body.ids) ? body.ids : undefined;
    } catch {
      ids = undefined; // 空 body 容忍
    }
    const all = readEvents();
    const picked = ids && ids.length > 0 ? all.filter((e) => ids!.includes(e.id)) : all;
    if (picked.length === 0) return jsonResponse({ ok: false, reason: "没有可分析的事件" });
    const result = await analyzeEvents(buildAnalysisInput(picked));
    if (!result) return jsonResponse({ ok: false, reason: "AI 分析失败或超时(已降级,不影响面板)" });
    return jsonResponse({ ok: true, analyzedCount: picked.length, ...result });
  }

  // ── 闭环洞察 API:从"任务→改动"历史挖规则进化信号 ──
  // 裸数据(不调 AI):各仓库哪些敏感规则被反复碰、当时任务是什么(已脱敏)。
  if (path === "/api/insights/data") {
    return jsonResponse(cachedInsights());
  }
  // AI 分析:把洞察喂给 DeepSeek,产出"规则该降级/升级/新增"的进化建议。
  if (path === "/api/insights/analyze" && req.method === "POST") {
    if (!isAIEnabled()) return jsonResponse({ ok: false, reason: "AI 未启用(未配置 DEEPSEEK_API_KEY)" });
    const insights = cachedInsights();
    if (insights.length === 0) return jsonResponse({ ok: false, reason: "还没有足够的'任务→改动'历史可分析" });
    const result = await analyzeInsights(insights);
    if (!result) return jsonResponse({ ok: false, reason: "AI 分析失败或超时(已降级)" });
    return jsonResponse({ ok: true, repoCount: insights.length, ...result });
  }

  // ── 飞行记录·越界 API:agent 有没有违反人定下的规矩(确定性检测,不调 AI) ──
  if (path === "/api/violations") {
    const repos = cachedViolations();
    const all = repos.flatMap((r) => r.violations);
    return jsonResponse({
      reposWithPolicy: repos.length,
      totalViolations: all.length,
      summary: summarizeViolations(all),
      byRepo: repos.map((r) => ({
        project: r.project.split("/").slice(-2).join("/"),
        policyCount: r.policyCount,
        violations: r.violations.slice(0, 20),
      })),
    });
  }

  // ── 信箱写入 API:把面板上的用户决策写成指令,等终端 Claude Code 来取 ──
  if (path === "/api/inbox/decision" && req.method === "POST") {
    let body: { title?: string; action?: string; context?: Record<string, unknown> };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return new Response(JSON.stringify({ ok: false, reason: "请求体不是合法 JSON" }), { status: 400, headers: JSON_HEADERS });
    }
    if (!body.action || typeof body.action !== "string") {
      return new Response(JSON.stringify({ ok: false, reason: "缺少 action(要终端执行的指令)" }), { status: 400, headers: JSON_HEADERS });
    }
    const item = writeDecision({
      title: typeof body.title === "string" ? body.title : "未命名决策",
      action: body.action,
      context: (body.context as never) ?? {},
    });
    return jsonResponse({ ok: true, id: item.id });
  }

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
