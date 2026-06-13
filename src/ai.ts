// ai.ts — 可选的 AI 分析层(DeepSeek)。
//
// 定位:面板的"时不时整理一下"。它读已落盘的【去敏元数据】,生成一段人话摘要 +
// 几条可执行建议。它是增强,不是主路径 —— 没配 key 就静默关闭,调用失败就降级返回 null,
// 绝不影响面板的只读展示或守门的退出码。
//
// 隐私铁律(这个文件存在的前提):
//   送给模型的 payload 只含 rule / path / severity / 统计计数 —— 全是 events.jsonl 里
//   本就"可记录、可出区"的字段。绝不发送代码正文、密钥原文、任务原文、diff 内容。
//   assertNoSourceLeak() 在发送前做一次结构断言,把"只传元数据"从约定变成代码保证。
//
// 零 SDK 依赖:DeepSeek 兼容 OpenAI 的 /chat/completions,直接用 fetch。

/** AI 配置,全部来自环境变量(.env 由 bun 原生注入)。 */
export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 读环境变量。没有 DEEPSEEK_API_KEY 返回 null —— 即"AI 未启用"。 */
export function readAIConfig(env: Record<string, string | undefined> = process.env): AIConfig | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    model: env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
  };
}

/** AI 是否可用(配了 key 即启用,不需额外开关)。 */
export function isAIEnabled(env?: Record<string, string | undefined>): boolean {
  return readAIConfig(env) !== null;
}

/**
 * 联网披露文案。所有调用 DeepSeek 的入口(整理 / 规则进化 / Ask Guard)在响应里
 * 统一带上它,保证"数据会出本机上云"这件事在每个入口都被一致、显式地告知 ——
 * 不在"本机只读不联网"的印象下被意外上云。
 */
export const NETWORK_DISCLOSURE =
  "联网披露:本次分析会把上述去敏元数据发送到 DeepSeek(api.deepseek.com)。代码正文不在其中。";

// ── 送进模型的去敏输入(只有这些字段允许出区) ──────────────────────
/** 一条规则在被选事件里的聚合 —— 不含任何代码正文。 */
export interface RuleStat {
  rule: string;
  count: number;
  wakeCount: number;
  /** 命中过的代表性路径(路径可出区,内容不可) */
  samplePaths: string[];
}

import type { GuardEvent } from "./event";
import type { RepoInsight } from "./insights";

/** 喂给 AI 的分析输入:纯计数与路径。 */
export interface AnalysisInput {
  /** 参与分析的事件数 */
  eventCount: number;
  /** 时间范围(YYYY-MM-DD ~ YYYY-MM-DD) */
  dateRange: { from: string; to: string };
  /** 被刹住(blocked)次数 */
  blockedCount: number;
  /** 自动放行次数 */
  passCount: number;
  /** 按规则聚合的统计 */
  rules: RuleStat[];
}

/** AI 返回的一条建议 —— 给用户在面板上点选。 */
export interface Suggestion {
  /** 建议标题(一句话) */
  title: string;
  /** 为什么 */
  rationale: string;
  /** 建议给终端 Claude Code 的可执行动作描述(自然语言指令) */
  action: string;
  /** 紧迫度,影响面板排序与配色 */
  urgency: "high" | "medium" | "low";
}

/** AI 分析结果。 */
export interface AnalysisResult {
  summary: string;
  suggestions: Suggestion[];
  model: string;
}

/**
 * 隐私守护:在发送前断言 samplePaths 不含明显的代码泄露信号。
 * AnalysisInput 的类型已经只允许元数据,这里再防御性地拦住任何意外混入的
 * diff 行特征(换行、超长串)。命中即抛错,宁可不分析也不外传可疑内容。
 */
export function assertNoSourceLeak(input: AnalysisInput): void {
  for (const r of input.rules) {
    for (const p of r.samplePaths) {
      if (p.includes("\n") || p.length > 300) {
        throw new Error(`[ai] 隐私守护拦截:samplePaths 含疑似非路径内容(len=${p.length}),拒绝发送`);
      }
    }
  }
}

/** 构造发给模型的 prompt。中文输出,贴合产品语气。 */
function buildMessages(input: AnalysisInput): { role: string; content: string }[] {
  const system =
    "你是 agent-diff-guard 的审计分析助手。你只会收到【去敏元数据】(规则名、文件路径、计数)," +
    "绝不会收到任何代码正文。基于这些元数据,你的任务是:" +
    "(1) 用 2-4 句话总结这段时间 agent 改动的风险态势;" +
    "(2) 给出 1-3 条可执行建议,每条建议要能转交给终端里的 Claude Code 去执行(比如收紧某条规则、" +
    "审查某个高频命中的目录、为某类改动加测试)。" +
    "严格按给定 JSON schema 输出,不要多余文字。语气克制、像资深 DevOps,不夸张、不刷屏。";

  const schema =
    '输出 JSON,形如:{"summary":"...","suggestions":[{"title":"...","rationale":"...","action":"给 Claude Code 的自然语言指令","urgency":"high|medium|low"}]}';

  const user = `以下是审计元数据(${input.dateRange.from} ~ ${input.dateRange.to},共 ${input.eventCount} 次守门,其中刹停 ${input.blockedCount} 次、放行 ${input.passCount} 次):

按规则聚合:
${input.rules.map((r) => `- ${r.rule}: 命中 ${r.count} 次(刹停 ${r.wakeCount}),路径如 ${r.samplePaths.slice(0, 3).join(", ") || "(无)"}`).join("\n")}

${schema}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 从模型返回里抽出 JSON(容忍被 ```json 包裹)。 */
function parseResult(raw: string, model: string): AnalysisResult | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as { summary?: string; suggestions?: Suggestion[] };
    if (typeof obj.summary !== "string" || !Array.isArray(obj.suggestions)) return null;
    // 规整 urgency,防止模型给出非法值
    const suggestions = obj.suggestions
      .filter((s) => s && typeof s.title === "string")
      .map((s) => ({
        title: s.title,
        rationale: typeof s.rationale === "string" ? s.rationale : "",
        action: typeof s.action === "string" ? s.action : "",
        urgency: (["high", "medium", "low"] as const).includes(s.urgency) ? s.urgency : "medium",
      }));
    return { summary: obj.summary, suggestions, model };
  } catch {
    return null;
  }
}

/**
 * 把一批 GuardEvent 聚合成去敏的 AnalysisInput。
 * 只读 events 里"可出区"的字段(rule/severity/path/timestamp/disposition),
 * 天然不碰代码正文 —— 这是隐私边界落在数据构造这一层的体现。
 */
export function buildAnalysisInput(events: GuardEvent[]): AnalysisInput {
  const ruleMap = new Map<string, RuleStat & { _paths: Set<string> }>();
  let from = "9999-99-99";
  let to = "0000-00-00";
  let blockedCount = 0;
  let passCount = 0;

  for (const ev of events) {
    const date = ev.timestamp.slice(0, 10);
    if (date < from) from = date;
    if (date > to) to = date;
    if (ev.disposition === "blocked") blockedCount++;
    if (ev.disposition === "auto-pass") passCount++;
    for (const f of ev.findings) {
      let row = ruleMap.get(f.rule);
      if (!row) {
        row = { rule: f.rule, count: 0, wakeCount: 0, samplePaths: [], _paths: new Set() };
        ruleMap.set(f.rule, row);
      }
      row.count++;
      if (f.severity === "wake-you-up") row.wakeCount++;
      if (row._paths.size < 5) row._paths.add(f.path);
    }
  }

  const rules = [...ruleMap.values()]
    .map(({ _paths, ...r }) => ({ ...r, samplePaths: [..._paths] }))
    .sort((a, b) => b.count - a.count);

  return {
    eventCount: events.length,
    dateRange: { from: events.length ? from : "", to: events.length ? to : "" },
    blockedCount,
    passCount,
    rules,
  };
}

/**
 * 通用 DeepSeek 调用:发 messages,拿回 content 字符串。任何失败返回 null。
 * analyzeEvents / analyzeInsights 共用这一层,避免重复 fetch/超时/降级代码。
 */
async function callDeepSeek(
  messages: { role: string; content: string }[],
  config: AIConfig,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.3, response_format: { type: "json_object" } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[ai] DeepSeek 返回 ${res.status}(降级,不影响面板)`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn("[ai] 分析失败(降级,不影响面板):", (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调 DeepSeek 分析守门事件。任何失败(无 key / 网络 / 解析)都返回 null —— 调用方据此降级。
 */
export async function analyzeEvents(
  input: AnalysisInput,
  opts: { config?: AIConfig | null; timeoutMs?: number } = {}
): Promise<AnalysisResult | null> {
  const config = opts.config !== undefined ? opts.config : readAIConfig();
  if (!config) return null;
  try {
    assertNoSourceLeak(input);
  } catch (e) {
    console.warn((e as Error).message);
    return null;
  }
  const content = await callDeepSeek(buildMessages(input), config, opts.timeoutMs ?? 30_000);
  return content ? parseResult(content, config.model) : null;
}

// ── 闭环:从"任务→改动"历史里产出规则进化建议 ──────────────────────

/** 一条规则进化建议。 */
export interface RuleAdjustment {
  /** 涉及的规则名(或新规则的拟定名) */
  rule: string;
  /** 建议动作:降级=这个仓库里是噪音少烦;升级=反复越界该更严;keep=维持;new=补一条没覆盖的 */
  action: "downgrade" | "upgrade" | "keep" | "new";
  /** 涉及的仓库(末两段) */
  repo: string;
  /** 一句话理由(基于真实任务证据) */
  rationale: string;
  /** 给终端 Claude Code 的可执行指令(如何落实这次调整) */
  command: string;
}

export interface InsightAnalysis {
  summary: string;
  adjustments: RuleAdjustment[];
  model: string;
}

function repoTail(p: string): string {
  return p.split("/").filter(Boolean).slice(-2).join("/");
}

/** 构造规则进化分析的 prompt。输入是已脱敏的 RepoInsight。 */
function buildInsightMessages(insights: RepoInsight[]): { role: string; content: string }[] {
  const system =
    "你是 agent-diff-guard 的'规则进化'分析助手。守门人的核心哲学是【宁可漏,不可烦】——误报会让人三天就关掉它。" +
    "你会收到各仓库的真实历史:某条敏感规则被碰了几次、当时 agent 的任务是什么。" +
    "你的任务是判断每条规则在【这个具体仓库】里该怎么调:" +
    "downgrade(任务都正当→这条在本仓库是噪音,该降级少烦人)、" +
    "upgrade(任务与改动不相关=越界顺手改→该更严)、keep(维持)、new(反复出现但没规则覆盖→补一条)。" +
    "只在证据充分时给建议,证据弱就 keep。每条建议给一句话理由 + 一条能转给终端 Claude Code 执行的指令。" +
    "严格按 JSON 输出,语气克制像资深 DevOps。";

  const schema =
    '输出 JSON:{"summary":"...","adjustments":[{"rule":"...","action":"downgrade|upgrade|keep|new","repo":"owner/repo","rationale":"...","command":"给Claude Code的指令"}]}';

  const body = insights
    .map((ri) => {
      const lines = ri.evidence
        .map(
          (e) =>
            `  · ${e.rule} 被碰 ${e.hitCount} 次,文件如 [${e.sampleFiles.join(", ")}],当时任务如:${e.sampleTasks
              .map((t) => `"${t.replace(/\s+/g, " ").slice(0, 50)}"`)
              .join("; ")}`
        )
        .join("\n");
      return `仓库 ${repoTail(ri.project)}(共 ${ri.turnCount} 个任务轮次):\n${lines}`;
    })
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: `以下是各仓库的真实"任务→敏感改动"历史(密钥已脱敏):\n\n${body}\n\n${schema}` },
  ];
}

/** 从模型返回解析 InsightAnalysis。 */
function parseInsightResult(raw: string, model: string): InsightAnalysis | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as { summary?: string; adjustments?: RuleAdjustment[] };
    if (typeof obj.summary !== "string" || !Array.isArray(obj.adjustments)) return null;
    const valid = ["downgrade", "upgrade", "keep", "new"] as const;
    const adjustments = obj.adjustments
      .filter((a) => a && typeof a.rule === "string")
      .map((a) => ({
        rule: a.rule,
        action: (valid as readonly string[]).includes(a.action) ? a.action : "keep",
        repo: typeof a.repo === "string" ? a.repo : "",
        rationale: typeof a.rationale === "string" ? a.rationale : "",
        command: typeof a.command === "string" ? a.command : "",
      }));
    return { summary: obj.summary, adjustments, model };
  } catch {
    return null;
  }
}

/**
 * 闭环核心:把"任务→改动"洞察喂给 AI,产出规则进化建议。
 * 输入必须是已脱敏的 RepoInsight(insights.ts 的 redactSecrets 已处理)。失败返回 null。
 */
export async function analyzeInsights(
  insights: RepoInsight[],
  opts: { config?: AIConfig | null; timeoutMs?: number } = {}
): Promise<InsightAnalysis | null> {
  const config = opts.config !== undefined ? opts.config : readAIConfig();
  if (!config || insights.length === 0) return null;
  // 收窄到命中最多的前 6 个仓库:既保证信号密度,又压住 prompt 大小和 reasoning 模型耗时。
  const top = insights.slice(0, 6);
  // reasoning 模型(deepseek-v4-pro)较慢,默认给足 120s,避免在有料时被超时误杀。
  const content = await callDeepSeek(buildInsightMessages(top), config, opts.timeoutMs ?? 120_000);
  return content ? parseInsightResult(content, config.model) : null;
}

// ── Ask Guard:面板上「问守门人」对话窗的 DeepSeek 后端 ──────────────
//
// ⚠️ 隐私边界(与本文件其余部分不同,务必读这段):
//   本文件其余函数严守"只传元数据"(assertNoSourceLeak)。Ask Guard 是【显式例外】:
//   用户在面板上主动提问、且通过 ADG_AI_CLOUD_DEEPCODE 开关知情同意后,问题的上下文
//   (可能含 diff 正文 / 任务原文)才会发给 DeepSeek。这是用户的选择,不是默认行为。
//   每条上云回答都会带 tier 标注,前端把"代码已上云"画成醒目警告 —— 越界必须可见。

/** Ask Guard 一次问答的上下文(调用方按需填,可含代码正文 → 只在开关打开时上云)。 */
export interface AskGuardContext {
  /** 当前页面路由(给模型定位用户在看什么) */
  route?: string;
  /** 顶层态势(元数据) */
  overview?: { totalScans?: number; totalBlocked?: number; passRate?: number; reposWatched?: number };
  /** 待裁决/历史的发现摘要(可能含 file/rule/reason/task/diff 片段) */
  findings?: { file: string; rule: string; repo?: string; level?: string; reason?: string; task?: string; diff?: string }[];
  /** 规则命中统计(元数据) */
  rules?: { rule: string; count: number; wakeCount: number }[];
  /** 越界摘要(元数据) */
  violations?: { policyName: string; offendingFiles?: string[]; reason?: string }[];
}

/** Ask Guard 回答的一个内容块(对齐前端 MsgBlock)。 */
export type AskBlock =
  | { kind: "p"; text: string }
  | { kind: "stat"; items: [string, string | number][] }
  | { kind: "cluster"; items: [string, string, string][] };

/** Ask Guard 一次回答。tier 决定前端出处标签:cloud-code = 代码已上云(醒目警告)。 */
export interface AskGuardReply {
  blocks: AskBlock[];
  /** meta=只用了元数据;cloud-code=上下文含代码正文且已上云 */
  tier: "meta" | "cloud-code";
  model: string;
  proposal?: { title: string; command: string; note: string };
}

/** 上下文里是否夹带了代码正文/任务原文(决定 tier 与是否需要开关)。 */
function contextHasCode(ctx: AskGuardContext): boolean {
  return (ctx.findings || []).some((f) => (f.diff && f.diff.length > 0) || (f.task && f.task.length > 0));
}

/** 含代码上云是否被允许(显式开关;默认关 —— 安全优先)。 */
export function deepCodeAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADG_AI_CLOUD_DEEPCODE?.trim() === "1";
}

function buildAskMessages(question: string, ctx: AskGuardContext, withCode: boolean): { role: string; content: string }[] {
  const system =
    "你是 agent-diff-guard 的「问守门人」助手。守门人的核心哲学是【宁可漏,不可烦】——你的唯一目标是" +
    "降低用户每个裁决的注意力成本,而不是产出更多要读的东西。规则:" +
    "(1) 只在给定的审计上下文范围内回答(守门发现、规则、越界、态势);超出范围(通用编码问题)就礼貌说明你只看审计数据。" +
    "(2) 回答要短、像资深 DevOps,不刷屏不夸张。" +
    "(3) 若发现多条 wake 像同一次改动(声称做A顺手动了B),把它们聚成一组(cluster)。" +
    "(4) 你只提案,绝不声称已执行;若给出可执行修复,放进 proposal,由用户批准后终端才执行。" +
    "严格按 JSON schema 输出。";
  const schema =
    '输出 JSON:{"blocks":[{"kind":"p","text":"..."} 或 {"kind":"stat","items":[["标签",数值],...]} 或 {"kind":"cluster","items":[["规则名","文件路径","一句话说它实际干了啥"],...]}],"proposal"(可选):{"title":"...","command":"给终端Claude Code的可执行指令","note":"一句话说明"}}';

  const ctxParts: string[] = [];
  if (ctx.route) ctxParts.push(`用户当前在「${ctx.route}」页面。`);
  if (ctx.overview) {
    const o = ctx.overview;
    ctxParts.push(`态势:共 ${o.totalScans ?? 0} 次扫描,刹停 ${o.totalBlocked ?? 0} 次,放行率 ${((o.passRate ?? 1) * 100).toFixed(1)}%,守护 ${o.reposWatched ?? 0} 个仓库。`);
  }
  if (ctx.rules?.length) ctxParts.push(`规则命中:${ctx.rules.map((r) => `${r.rule}(${r.count}次/${r.wakeCount}wake)`).join("、")}`);
  if (ctx.violations?.length) ctxParts.push(`越界:${ctx.violations.map((v) => `${v.policyName}改了${(v.offendingFiles || []).join(",")}`).join(";")}`);
  if (ctx.findings?.length) {
    ctxParts.push("待裁决/相关发现:");
    for (const f of ctx.findings.slice(0, 6)) {
      let line = `· [${f.level || "?"}] ${f.rule} @ ${f.file}${f.repo ? ` (${f.repo})` : ""} —— ${f.reason || ""}`;
      if (withCode && f.task) line += `\n  声称任务:"${f.task.replace(/\s+/g, " ").slice(0, 120)}"`;
      if (withCode && f.diff) line += `\n  改动片段:\n${f.diff.split("\n").slice(0, 20).join("\n")}`;
      ctxParts.push(line);
    }
  }

  return [
    { role: "system", content: system },
    { role: "user", content: `审计上下文:\n${ctxParts.join("\n")}\n\n用户的问题:${question}\n\n${schema}` },
  ];
}

function parseAskReply(raw: string, model: string, tier: AskGuardReply["tier"]): AskGuardReply | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as { blocks?: AskBlock[]; proposal?: AskGuardReply["proposal"] };
    if (!Array.isArray(obj.blocks) || obj.blocks.length === 0) return null;
    // 只保留合法 block,防模型给脏数据
    const blocks = obj.blocks.filter((b) => b && (b.kind === "p" || b.kind === "stat" || b.kind === "cluster")) as AskBlock[];
    if (blocks.length === 0) return null;
    const proposal =
      obj.proposal && typeof obj.proposal.title === "string" && typeof obj.proposal.command === "string"
        ? { title: obj.proposal.title, command: obj.proposal.command, note: typeof obj.proposal.note === "string" ? obj.proposal.note : "" }
        : undefined;
    return { blocks, tier, model, proposal };
  } catch {
    return null;
  }
}

/**
 * Ask Guard 主入口:把问题 + 审计上下文发给 DeepSeek,返回结构化回答。
 * 隐私分层:上下文若含代码(diff/task)且开关未开 → 剥掉代码再发(降级为元数据),tier=meta;
 * 开关开 → 连代码一起发,tier=cloud-code(前端醒目标注)。任何失败返回 null,前端降级到接地引擎。
 */
export async function answerAskGuard(
  question: string,
  ctx: AskGuardContext,
  opts: { config?: AIConfig | null; timeoutMs?: number; env?: Record<string, string | undefined> } = {}
): Promise<AskGuardReply | null> {
  const config = opts.config !== undefined ? opts.config : readAIConfig(opts.env);
  if (!config || !question.trim()) return null;

  const wantCode = contextHasCode(ctx);
  const allowCode = deepCodeAllowed(opts.env);
  const withCode = wantCode && allowCode;
  // 开关没开却带了代码:剥掉代码字段,只用元数据上云(安全降级,不是拒答)
  const safeCtx: AskGuardContext = withCode
    ? ctx
    : { ...ctx, findings: (ctx.findings || []).map(({ diff, task, ...rest }) => rest) };
  const tier: AskGuardReply["tier"] = withCode ? "cloud-code" : "meta";

  const content = await callDeepSeek(buildAskMessages(question, safeCtx, withCode), config, opts.timeoutMs ?? 40_000);
  return content ? parseAskReply(content, config.model, tier) : null;
}
