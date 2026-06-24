// sessions.ts — 解析 Claude Code 本地 session 日志,聚合各项目/仓库的 token 消耗。
//
// 数据来源:~/.claude/projects/<编码后的项目路径>/<sessionId>.jsonl
// 每行一个事件;type==="assistant" 的行带 message.usage,即一次模型调用的 token。
// 我们只读、只聚合,不改、不上传 —— 和审计面板一样,数据不出本机。
//
// 这是"一个人 × N agent"时代的成本可观测性:哪个项目最烧钱?哪个 session 失控了?
// 注意:这是与"守门"独立的第二个维度(运营/FinOps),共用面板但数据源不同。

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

/** Claude Code 各模型的粗略单价(美元 / 百万 token),用于成本估算。
 *  只为"相对比较哪个项目贵",非账单级精确。未知模型按 0 计,不瞎估。 */
const PRICE_PER_MTOK: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-4": { in: 15, out: 75, cacheRead: 1.5 },
  "claude-sonnet-4": { in: 3, out: 15, cacheRead: 0.3 },
  "claude-haiku-4": { in: 1, out: 5, cacheRead: 0.1 },
};

/** 把具体 model id(claude-opus-4-7)归一到价格表的族(claude-opus-4) */
function modelFamily(model: string): string {
  const m = model.match(/^(claude-(?:opus|sonnet|haiku))-\d+/);
  return m ? `${m[1]}-4` : model;
}

export interface ProjectUsage {
  project: string; // 解码后的项目路径
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estCostUsd: number; // 估算成本,未知模型不计
  lastActivity: string | null; // ISO 8601
}

export interface SessionUsage {
  sessionId: string;
  project: string;
  model: string | null;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estCostUsd: number;
  lastActivity: string | null;
}

/** Claude Code 项目日志根目录。导出供增量缓存层复用同一遍历起点。 */
export function projectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/** 目录名 "-Users-foo-bar" → 路径 "/Users/foo/bar"(尽力还原,仅用于显示) */
export function decodeProject(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

interface Tok {
  input: number; output: number; cacheRead: number; cacheCreate: number;
  model: string | null; cost: number;
}

function emptyTok(): Tok {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, model: null, cost: 0 };
}

interface RawLine {
  type?: string;
  timestamp?: string;
  message?: { id?: string; model?: string; usage?: Record<string, number> };
}

/** 累加一行 assistant 消息的 usage 到 acc。返回该行的 timestamp(若有)。
 *
 *  去重(seen):Claude Code 把同一条 assistant 消息(思考块 / 工具调用 / 流式分段)
 *  拆成多行 jsonl 写入,每行都携带**完全相同**的 message.id 与 usage。若按行累加,
 *  同一次模型调用的 token 会被重复计 2~3 次 —— 实测单 session 重复率 ~46%,cacheRead
 *  被放大 ~1.9x,导致面板成本几乎翻倍。故按 message.id 去重:同一 id 只计一次 usage。 */
function accLine(acc: Tok, obj: RawLine, seen: Set<string>): string | null {
  const msg = obj.message;
  const u = msg?.usage;
  if (!u) return obj.timestamp ?? null;
  // 同一 message.id 的后续重复行:仍更新 model/timestamp,但不再累加 usage。
  const id = msg?.id;
  if (id && seen.has(id)) {
    if (msg?.model) acc.model = msg.model;
    return obj.timestamp ?? null;
  }
  if (id) seen.add(id);
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const cc = u.cache_creation_input_tokens ?? 0;
  acc.input += inp; acc.output += out; acc.cacheRead += cr; acc.cacheCreate += cc;
  if (msg?.model) acc.model = msg.model;
  const p = msg?.model ? PRICE_PER_MTOK[modelFamily(msg.model)] : undefined;
  if (p) {
    // cache creation 近似按 input 价
    acc.cost += ((inp + cc) / 1e6) * p.in + (out / 1e6) * p.out + (cr / 1e6) * p.cacheRead;
  }
  return obj.timestamp ?? null;
}

/** 解析单个 session 文件。导出供增量缓存层(sessions-cache.ts)复用。 */
export function parseSession(filePath: string, project: string, sessionId: string): SessionUsage | null {
  let raw: string;
  try { raw = readFileSync(filePath, "utf8"); } catch { return null; }
  const acc = emptyTok();
  const seen = new Set<string>(); // 按 message.id 去重,见 accLine 注释
  let msgCount = 0;
  let last: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: RawLine;
    try { obj = JSON.parse(line) as RawLine; } catch { continue; }
    // messageCount 也按 message.id 去重:重复行不是新消息,否则消息数同样虚高。
    if (obj.type === "assistant" && !(obj.message?.id && seen.has(obj.message.id))) msgCount++;
    const ts = accLine(acc, obj, seen);
    if (ts && (!last || ts > last)) last = ts;
  }
  return {
    sessionId, project, model: acc.model, messageCount: msgCount,
    inputTokens: acc.input, outputTokens: acc.output,
    cacheReadTokens: acc.cacheRead, cacheCreationTokens: acc.cacheCreate,
    estCostUsd: Math.round(acc.cost * 100) / 100, lastActivity: last,
  };
}

/** 读取所有 session(可能慢,调用方自行决定缓存)。 */
export function allSessions(): SessionUsage[] {
  const root = projectsDir();
  if (!existsSync(root)) return [];
  const out: SessionUsage[] = [];
  let dirs: string[];
  try { dirs = readdirSync(root); } catch { return []; }
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    let files: string[];
    try { files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    const project = decodeProject(dir);
    for (const f of files) {
      const sessionId = f.replace(/\.jsonl$/, "");
      const s = parseSession(join(dirPath, f), project, sessionId);
      if (s && (s.inputTokens || s.outputTokens || s.messageCount)) out.push(s);
    }
  }
  return out;
}

/** 按项目聚合 token 与成本,默认按估算成本降序。 */
export function projectUsage(sessions: SessionUsage[] = allSessions()): ProjectUsage[] {
  const map = new Map<string, ProjectUsage>();
  for (const s of sessions) {
    const p = map.get(s.project) ?? {
      project: s.project, sessionCount: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, estCostUsd: 0, lastActivity: null,
    };
    p.sessionCount++;
    p.inputTokens += s.inputTokens;
    p.outputTokens += s.outputTokens;
    p.cacheReadTokens += s.cacheReadTokens;
    p.cacheCreationTokens += s.cacheCreationTokens;
    p.estCostUsd += s.estCostUsd;
    if (s.lastActivity && (!p.lastActivity || s.lastActivity > p.lastActivity)) p.lastActivity = s.lastActivity;
    map.set(s.project, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, estCostUsd: Math.round(p.estCostUsd * 100) / 100 }))
    .sort((a, b) => b.estCostUsd - a.estCostUsd || b.outputTokens - a.outputTokens);
}

/** 全局总览 */
export function usageOverview(sessions: SessionUsage[] = allSessions()): {
  totalProjects: number; totalSessions: number;
  totalInputTokens: number; totalOutputTokens: number;
  totalCacheReadTokens: number; estCostUsd: number;
} {
  const projects = new Set(sessions.map((s) => s.project));
  return {
    totalProjects: projects.size,
    totalSessions: sessions.length,
    totalInputTokens: sessions.reduce((s, x) => s + x.inputTokens, 0),
    totalOutputTokens: sessions.reduce((s, x) => s + x.outputTokens, 0),
    totalCacheReadTokens: sessions.reduce((s, x) => s + x.cacheReadTokens, 0),
    estCostUsd: Math.round(sessions.reduce((s, x) => s + x.estCostUsd, 0) * 100) / 100,
  };
}

/** 最近活跃的 N 个 session,按最后活动时间倒序 */
export function recentSessions(sessions: SessionUsage[] = allSessions(), limit = 50): SessionUsage[] {
  return [...sessions]
    .filter((s) => s.lastActivity)
    .sort((a, b) => (b.lastActivity! > a.lastActivity! ? 1 : -1))
    .slice(0, limit);
}
