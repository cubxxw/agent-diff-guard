// serve-local.ts — 本地只读审计面板服务。
//
// `agent-diff-guard serve` 启动它:读本地 ~/.agent-diff-guard/events.jsonl,
// 把聚合结果通过 HTTP 暴露给 web/ 面板。纯本地、只读、零上传 —— 数据不出这台机器。
//
// 刻意不做的事(守产品哲学):
//   - 不做 WebSocket/SSE/轮询推送。面板是"周期性看趋势",不是实时大屏。
//     每次刷新页面才重新聚合,不主动 push。
//   - 不写、不删事件,只读。

import { join, resolve, dirname } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { readEvents } from "./logger";
import { ruleRank, timeline, dispositions, overview } from "./stats";
import { projectUsage, usageOverview, recentSessions } from "./sessions";
import { cachedAllSessions } from "./sessions-cache";
import { dailyStats, dayStat, todayLocal } from "./daily";
import { cachedAllRecords } from "./daily-cache";
import { isAIEnabled, buildAnalysisInput, analyzeEvents, analyzeInsights, answerAskGuard, deepCodeAllowed, NETWORK_DISCLOSURE, type AskGuardContext } from "./ai";
import { allTranscripts } from "./transcript";
import { buildAllInsights } from "./insights";
import { loadPolicy } from "./policy";
import { detectViolations, summarizeViolations, type Violation } from "./violations";
import { writeDecision, listPending, listDone } from "./inbox";
import { listProjects, createProject, updateProject, deleteProject, type PermissionMode } from "./projects";
import { listRuns, listBlocked } from "./runlog";
import { buildQueue } from "./findings";
import { repoHistory, staticZones } from "./context";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*", // 本地面板跨端口读取
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: JSON_HEADERS });
}

// 安全读取 POST JSON body。
// 关键:Bun 的 req.json() 在 body 流为空时不抛异常而是一直等待 —— 空 body 的 POST
// 会挂起约 10s 直到超时(P1-3)。先 await req.text() 拿到字符串,空串按 {} 处理,
// 再 JSON.parse,从根上避免挂起。parse 失败返回 null,调用方据此回 400。
async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  const text = await req.text();
  if (!text.trim()) return {} as T; // 空 body 容忍为 {}
  try {
    return JSON.parse(text) as T;
  } catch {
    return null; // 畸形 JSON
  }
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
 * 热度分级(1/2/3)——修掉"恒等于 3"的旧 bug。
 *
 * 旧逻辑 `wakeCount > 0 ? 3 : ...` 让任何踩过一次 wake 的规则都锁死 3,与命中频次脱钩
 * (报告实测 1 次命中和 6 次命中同为 3)。新逻辑按三个维度加权打分,真正分级:
 *   · 频次   命中越多越热(取 log,避免一条规则刷高把别的压平)
 *   · 严重度 wake 占比越高越热(被刹住比只是看一眼更危险)
 *   · 新近度 最近 14 天还在踩 → 加权;超过 60 天没踩 → 降权(老雷自然冷却)
 * 三档:score ≥ 2.2 → 3(高);≥ 1.1 → 2(中);否则 1(低)。
 */
export function heatOf(h: { count: number; wakeCount: number; lastSeen: string }): number {
  const freq = Math.log2(h.count + 1); // 1→1, 3→2, 7→3 …
  const wakeRatio = h.count > 0 ? h.wakeCount / h.count : 0;
  const severity = wakeRatio * 1.5; // 全 wake → +1.5;无 wake → 0

  // 新近度:用本地日期算天数差(lastSeen 是 YYYY-MM-DD)
  const days = Math.max(0, (Date.now() - new Date(h.lastSeen + "T00:00:00Z").getTime()) / 86400000);
  const recency = days <= 14 ? 0.6 : days <= 60 ? 0 : -0.6;

  const score = freq + severity + recency;
  if (score >= 2.2) return 3;
  if (score >= 1.1) return 2;
  return 1;
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
    // 合并:每条命中过的规则一行,热度按真实分级算(见 heatOf),未命中的固化高危区补后面
    const rows = history.map((h) => ({
      path: histByRule.get(h.rule)?.samplePaths[0] ?? h.rule,
      rule: h.rule,
      heat: heatOf(h),
      hits: h.count,
      wakeHits: h.wakeCount,
      lastSeen: h.lastSeen,
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

/** 执行记录:pending + blocked + runs 合并为统一时间线,给面板 /api/runlog。 */
function buildRunlogView() {
  const MAX_OUTPUT = 2000;
  const trunc = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…(已截断)" : s);

  type Phase = "pending" | "blocked" | "success" | "failed" | "timeout";
  const pending = listPending().map((i) => ({
    id: i.id, time: i.createdAt, title: i.title, action: i.action,
    kind: i.kind, phase: "pending" as Phase,
    urgency: i.context?.urgency,
    source: (i.context as { source?: string }).source,
  }));
  const blocked = listBlocked().map((i) => ({
    id: i.id, time: i.blockedAt, title: i.title, action: i.action,
    kind: i.kind, phase: "blocked" as Phase,
    blockedReason: i.blockedReason,
    urgency: i.context?.urgency,
    source: (i.context as { source?: string }).source,
  }));
  const runs = listRuns().map((r) => {
    const phase: Phase = r.timedOut ? "timeout" : r.exitCode === 0 ? "success" : "failed";
    return {
      id: r.id, time: r.createdAt, title: r.title, action: r.action,
      kind: r.kind, phase,
      exitCode: r.exitCode, durationMs: r.durationMs,
      stdout: trunc(r.stdout), stderr: trunc(r.stderr), timedOut: r.timedOut,
    };
  });

  const items = [...pending, ...blocked, ...runs].sort((a, b) => b.time.localeCompare(a.time));
  const successCount = runs.filter((r) => r.phase === "success").length;
  return {
    stats: {
      totalRuns: runs.length,
      totalBlocked: blocked.length,
      totalPending: pending.length,
      successRate: runs.length ? successCount / runs.length : 0,
      totalTimeout: runs.filter((r) => r.phase === "timeout").length,
    },
    items,
  };
}

/** web 静态资源目录(相对本文件) */
function webDir(): string {
  return join(import.meta.dir, "..", "web");
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight:跨端口前端(如 Vite dev)对带 Content-Type 的 POST 会先发 OPTIONS,
  // 必须回 204 + 完整 CORS 头,否则 POST 端点(ai/ask、inbox/decision)被浏览器阻断(P2-5)。
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (path === "/favicon.ico") {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5D3000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" } });
  }

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

  // ── 执行记录 API:pending + blocked + runs 合并的统一时间线 ──
  if (path === "/api/runlog") return jsonResponse(buildRunlogView());

  // ── AI 分析 API:只读元数据 → DeepSeek → 摘要+建议(配了 key 才启用) ──
  if (path === "/api/ai/status") return jsonResponse({ enabled: isAIEnabled() });

  if (path === "/api/ai/analyze" && req.method === "POST") {
    if (!isAIEnabled()) return jsonResponse({ ok: false, reason: "AI 未启用(未配置 DEEPSEEK_API_KEY)" });
    // body 可选传 ids[](只分析选中的事件);不传/空 body 则分析全部。
    const body = await readJsonBody<{ ids?: string[] }>(req);
    const ids = body && Array.isArray(body.ids) ? body.ids : undefined;
    const all = readEvents();
    const picked = ids && ids.length > 0 ? all.filter((e) => ids!.includes(e.id)) : all;
    if (picked.length === 0) return jsonResponse({ ok: false, reason: "没有可分析的事件" });
    const result = await analyzeEvents(buildAnalysisInput(picked));
    if (!result) return jsonResponse({ ok: false, reason: "AI 分析失败或超时(已降级,不影响面板)" });
    return jsonResponse({ ok: true, analyzedCount: picked.length, disclosure: NETWORK_DISCLOSURE, ...result });
  }

  // ── Ask Guard API:面板「问守门人」的 DeepSeek 后端 ──
  // 前端只传 question + route;context(含 diff/task)由后端从本机数据自组装,
  // 不经前端 body 来回。是否带代码上云由 ADG_AI_CLOUD_DEEPCODE 开关 + answerAskGuard 内部裁决。
  if (path === "/api/ai/ask" && req.method === "POST") {
    if (!isAIEnabled()) return jsonResponse({ ok: false, reason: "AI 未启用(未配置 DEEPSEEK_API_KEY)" });
    const body = await readJsonBody<{ question?: string; route?: string }>(req);
    if (body === null) {
      return new Response(JSON.stringify({ ok: false, reason: "请求体不是合法 JSON" }), { status: 400, headers: JSON_HEADERS });
    }
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return new Response(JSON.stringify({ ok: false, reason: "缺少 question" }), { status: 400, headers: JSON_HEADERS });

    // 从本机数据组装上下文。queue 含 diff/task —— 仅当开关打开时才会被 answerAskGuard 真正上云。
    const queue = cachedQueue();
    const ov = overview(readEvents());
    const violRepos = cachedViolations();
    const ctx: AskGuardContext = {
      route: body.route,
      overview: { totalScans: ov.totalScans, totalBlocked: ov.totalBlocked, passRate: ov.passRate, reposWatched: new Set(queue.map((q) => q.repo)).size },
      findings: queue.slice(0, 6).map((q) => ({
        file: q.file, rule: q.rule, repo: q.repo, level: q.level, reason: q.reason,
        task: q.task || undefined,
        diff: q.diff && q.diff.length ? q.diff.map((d) => d.t + d.s).join("\n") : undefined,
      })),
      rules: ruleRank(readEvents()).slice(0, 8).map((r) => ({ rule: r.rule, count: r.count, wakeCount: r.wakeCount })),
      violations: violRepos.flatMap((r) => r.violations).slice(0, 5).map((v) => ({ policyName: v.policyName, offendingFiles: v.offendingFiles, reason: v.reason })),
    };
    const reply = await answerAskGuard(question, ctx);
    if (!reply) return jsonResponse({ ok: false, reason: "AI 分析失败或超时(已降级到本机问答)" });
    const askDisclosure = deepCodeAllowed()
      ? "联网披露:问题与元数据发送到 DeepSeek(api.deepseek.com);「含代码」开关已开,代码正文也会上云。"
      : NETWORK_DISCLOSURE;
    return jsonResponse({ ok: true, deepCode: deepCodeAllowed(), disclosure: askDisclosure, ...reply });
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
    return jsonResponse({ ok: true, repoCount: insights.length, disclosure: NETWORK_DISCLOSURE, ...result });
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
    const body = await readJsonBody<{ title?: string; action?: string; projectId?: string; context?: Record<string, unknown> }>(req);
    if (body === null) {
      return new Response(JSON.stringify({ ok: false, reason: "请求体不是合法 JSON" }), { status: 400, headers: JSON_HEADERS });
    }
    if (!body.action || typeof body.action !== "string") {
      return new Response(JSON.stringify({ ok: false, reason: "缺少 action(要终端执行的指令)" }), { status: 400, headers: JSON_HEADERS });
    }
    const item = writeDecision({
      title: typeof body.title === "string" ? body.title : "未命名决策",
      action: body.action,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      context: (body.context as never) ?? {},
    });
    return jsonResponse({ ok: true, id: item.id });
  }

  // ── Projects CRUD API:项目注册、管理、收藏 ──
  // PUT/DELETE 带 :id 的路由放在 GET/POST 前面,避免前缀匹配冲突
  if (path.startsWith("/api/projects/") && req.method === "PUT") {
    const id = path.slice("/api/projects/".length);
    if (!id) return new Response(JSON.stringify({ ok: false, reason: "缺少项目 ID" }), { status: 400, headers: JSON_HEADERS });
    const body = await readJsonBody<Record<string, unknown>>(req);
    if (body === null) {
      return new Response(JSON.stringify({ ok: false, reason: "请求体不是合法 JSON" }), { status: 400, headers: JSON_HEADERS });
    }
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.cwd === "string") patch.cwd = body.cwd;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.favorite === "boolean") patch.favorite = body.favorite;
    const validModes: PermissionMode[] = ["default", "acceptEdits", "bypassPermissions"];
    if (typeof body.permissionMode === "string" && validModes.includes(body.permissionMode as PermissionMode)) {
      patch.permissionMode = body.permissionMode;
    }
    const updated = updateProject(id, patch as Parameters<typeof updateProject>[1]);
    if (!updated) return new Response(JSON.stringify({ ok: false, reason: "项目不存在" }), { status: 404, headers: JSON_HEADERS });
    return jsonResponse({ ok: true, project: updated });
  }

  if (path.startsWith("/api/projects/") && req.method === "DELETE") {
    const id = path.slice("/api/projects/".length);
    if (!id) return new Response(JSON.stringify({ ok: false, reason: "缺少项目 ID" }), { status: 400, headers: JSON_HEADERS });
    const ok = deleteProject(id);
    if (!ok) return new Response(JSON.stringify({ ok: false, reason: "项目不存在" }), { status: 404, headers: JSON_HEADERS });
    return jsonResponse({ ok: true });
  }

  if (path === "/api/projects" && req.method === "GET") {
    const all = listProjects();
    const sorted = [...all].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return jsonResponse(sorted);
  }

  if (path === "/api/projects" && req.method === "POST") {
    const body = await readJsonBody<{ name?: string; cwd?: string; permissionMode?: string; favorite?: boolean; description?: string }>(req);
    if (body === null) {
      return new Response(JSON.stringify({ ok: false, reason: "请求体不是合法 JSON" }), { status: 400, headers: JSON_HEADERS });
    }
    if (!body.name || typeof body.name !== "string" || !body.cwd || typeof body.cwd !== "string") {
      return new Response(JSON.stringify({ ok: false, reason: "缺少 name 或 cwd" }), { status: 400, headers: JSON_HEADERS });
    }
    const validModes: PermissionMode[] = ["default", "acceptEdits", "bypassPermissions"];
    const mode = validModes.includes(body.permissionMode as PermissionMode) ? (body.permissionMode as PermissionMode) : "default";
    const project = createProject({
      name: body.name,
      cwd: body.cwd,
      permissionMode: mode,
      favorite: body.favorite ?? false,
      description: body.description,
    });
    return jsonResponse({ ok: true, project });
  }

  // ── 目录浏览 API:让前端面板选择本地目录 ──
  if (path === "/api/browse-dirs") {
    const rawDir = url.searchParams.get("path") || homedir();
    const target = resolve(rawDir);
    if (!existsSync(target)) {
      return new Response(JSON.stringify({ ok: false, reason: "路径不存在" }), { status: 400, headers: JSON_HEADERS });
    }
    let stat;
    try { stat = statSync(target); } catch { return new Response(JSON.stringify({ ok: false, reason: "无法访问" }), { status: 400, headers: JSON_HEADERS }); }
    if (!stat.isDirectory()) {
      return new Response(JSON.stringify({ ok: false, reason: "不是目录" }), { status: 400, headers: JSON_HEADERS });
    }
    let entries: { name: string; path: string; isGitRepo: boolean }[] = [];
    try {
      const items = readdirSync(target, { withFileTypes: true });
      entries = items
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200)
        .map((d) => {
          const full = join(target, d.name);
          return { name: d.name, path: full, isGitRepo: existsSync(join(full, ".git")) };
        });
    } catch { /* permission denied etc — return empty */ }
    const isGitRepo = existsSync(join(target, ".git"));
    const parent = dirname(target);
    return jsonResponse({ current: target, parent: parent !== target ? parent : null, dirs: entries, isGitRepo });
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
      const today = url.searchParams.get("date") ?? todayLocal();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
        return new Response(JSON.stringify({ ok: false, reason: "date must be YYYY-MM-DD" }), { status: 400, headers: JSON_HEADERS });
      }
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

  if (path.startsWith("/api/")) {
    return new Response(JSON.stringify({ ok: false, reason: "Not Found" }), { status: 404, headers: JSON_HEADERS });
  }
  return new Response("Not Found", { status: 404 });
}

export function startLocalServer(port = 4757): void {
  let server;
  try {
    server = Bun.serve({ port, fetch: handle });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "EADDRINUSE") {
      console.error(`\n  端口 ${port} 已被占用 —— 换一个再试:agent-diff-guard serve --port ${port + 1}\n`);
      process.exit(1);
    }
    throw e;
  }
  const n = readEvents().length;
  console.log(`\n  agent-diff-guard 审计面板(本地、只读)`);
  console.log(`  ▸ http://localhost:${server.port}`);
  console.log(`  ▸ 已读取 ${n} 条守门事件  (Ctrl-C 退出)\n`);
}
