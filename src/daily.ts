// daily.ts — 按"天"切片的 agent 活跃度统计(对标 agentboard 的 Today 仪表盘)。
//
// 数据源同 sessions.ts:~/.claude/projects/**/*.jsonl,每行一条消息。
// 这里关心的是"某一天我和 agent 一起干了多少活":token、消息数、tool calls、活跃时长。
//
// 活跃时长是估算:把消息按时间排序,相邻间隔 <= IDLE_GAP 的算"连续活跃",
// 累加这些活跃段的时长。这正是 agentboard "Active Time" 的算法思路 ——
// 不是简单的 last-first(那会把午饭两小时也算进去),而是"真正在交互的时间"。

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const IDLE_GAP_MS = 5 * 60 * 1000; // 相邻消息间隔超过 5 分钟视为离开

const PRICE_PER_MTOK: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-4": { in: 15, out: 75, cacheRead: 1.5 },
  "claude-sonnet-4": { in: 3, out: 15, cacheRead: 0.3 },
  "claude-haiku-4": { in: 1, out: 5, cacheRead: 0.1 },
};
function modelFamily(model: string): string {
  const m = model.match(/^(claude-(?:opus|sonnet|haiku))-\d+/);
  return m ? `${m[1]}-4` : model;
}

/** 一条被提取出来的消息记录(细粒度,供 daily 聚合) */
export interface MsgRecord {
  ts: number; // epoch ms
  date: string; // YYYY-MM-DD(本地时区)
  role: "ai" | "user";
  project: string;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  toolCalls: number;
  cost: number;
}

export interface DailyStat {
  date: string; // YYYY-MM-DD
  activeMs: number; // 估算活跃时长
  sessionSpanMs: number; // 首尾跨度(对标 "Session time")
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number; total: number };
  messages: { ai: number; user: number; total: number };
  toolCalls: number;
  projects: number;
  estCostUsd: number;
}

interface RawContent { type?: string }
interface RawLine {
  type?: string;
  timestamp?: string;
  message?: { model?: string; usage?: Record<string, number>; content?: RawContent[] | string };
}

function projectsDir(): string {
  return join(homedir(), ".claude", "projects");
}
function decodeProject(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

/** YYYY-MM-DD,按本地时区(用户看的是自己当地的"今天") */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "今天"按本地时区取(切勿用 toISOString —— 那是 UTC,北京时区凌晨前会差一天) */
export function todayLocal(): string {
  return localDate(new Date());
}

/** 把一行解析成 MsgRecord(非消息行返回 null) */
function toRecord(obj: RawLine, project: string): MsgRecord | null {
  if (obj.type !== "assistant" && obj.type !== "user") return null;
  if (!obj.timestamp) return null;
  const d = new Date(obj.timestamp);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;

  const msg = obj.message;
  const u = msg?.usage;
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheCreate = u?.cache_creation_input_tokens ?? 0;

  let toolCalls = 0;
  if (Array.isArray(msg?.content)) {
    toolCalls = msg!.content.filter((c) => c && typeof c === "object" && c.type === "tool_use").length;
  }

  let cost = 0;
  const p = msg?.model ? PRICE_PER_MTOK[modelFamily(msg.model)] : undefined;
  if (p) cost = ((input + cacheCreate) / 1e6) * p.in + (output / 1e6) * p.out + (cacheRead / 1e6) * p.cacheRead;

  return {
    ts: ms, date: localDate(d), role: obj.type === "assistant" ? "ai" : "user",
    project, model: msg?.model ?? null,
    input, output, cacheRead, cacheCreate, toolCalls, cost,
  };
}

/** 解析单个 session 文件为 MsgRecord[]。导出供增量缓存层(daily-cache)复用。 */
export function parseRecordsFile(filePath: string, project: string): MsgRecord[] {
  let raw: string;
  try { raw = readFileSync(filePath, "utf8"); } catch { return []; }
  const out: MsgRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: RawLine;
    try { obj = JSON.parse(line) as RawLine; } catch { continue; }
    const rec = toRecord(obj, project);
    if (rec) out.push(rec);
  }
  return out;
}

/** 读取所有消息记录(可能慢)。since:只要 >= 这个 epoch ms 的记录(用于"近 N 天"加速)。 */
export function allRecords(sinceMs?: number): MsgRecord[] {
  const root = projectsDir();
  if (!existsSync(root)) return [];
  const out: MsgRecord[] = [];
  let dirs: string[];
  try { dirs = readdirSync(root); } catch { return []; }
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    let files: string[];
    try { files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    const project = decodeProject(dir);
    for (const f of files) {
      for (const rec of parseRecordsFile(join(dirPath, f), project)) {
        if (sinceMs === undefined || rec.ts >= sinceMs) out.push(rec);
      }
    }
  }
  return out;
}

/** 从一组(已按时间排序的)时间戳估算活跃时长:累加间隔 <= IDLE_GAP 的段。 */
function activeMs(sortedTs: number[]): number {
  let active = 0;
  for (let i = 1; i < sortedTs.length; i++) {
    const gap = sortedTs[i]! - sortedTs[i - 1]!;
    if (gap > 0 && gap <= IDLE_GAP_MS) active += gap;
  }
  return active;
}

/** 把记录按天聚合成 DailyStat[](日期降序,最近的在前)。 */
export function dailyStats(records: MsgRecord[] = allRecords()): DailyStat[] {
  const byDate = new Map<string, MsgRecord[]>();
  for (const r of records) {
    const arr = byDate.get(r.date) ?? [];
    arr.push(r);
    byDate.set(r.date, arr);
  }

  const stats: DailyStat[] = [];
  for (const [date, recs] of byDate) {
    const ts = recs.map((r) => r.ts).sort((a, b) => a - b);
    const projects = new Set(recs.map((r) => r.project));
    const t = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
    let ai = 0, user = 0, toolCalls = 0, cost = 0;
    for (const r of recs) {
      t.input += r.input; t.output += r.output; t.cacheRead += r.cacheRead; t.cacheCreate += r.cacheCreate;
      if (r.role === "ai") ai++; else user++;
      toolCalls += r.toolCalls; cost += r.cost;
    }
    t.total = t.input + t.output + t.cacheRead + t.cacheCreate;
    stats.push({
      date,
      activeMs: activeMs(ts),
      sessionSpanMs: ts.length > 1 ? ts[ts.length - 1]! - ts[0]! : 0,
      tokens: t,
      messages: { ai, user, total: ai + user },
      toolCalls,
      projects: projects.size,
      estCostUsd: Math.round(cost * 100) / 100,
    });
  }
  return stats.sort((a, b) => b.date.localeCompare(a.date));
}

/** 取某一天(默认今天,本地时区)的统计;没有则返回空壳。 */
export function dayStat(date: string, records?: MsgRecord[]): DailyStat {
  const all = dailyStats(records);
  return all.find((d) => d.date === date) ?? {
    date, activeMs: 0, sessionSpanMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
    messages: { ai: 0, user: 0, total: 0 }, toolCalls: 0, projects: 0, estCostUsd: 0,
  };
}
