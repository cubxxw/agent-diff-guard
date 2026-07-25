// collectors/codex.ts — Codex CLI 采集源。
//
// 把 Codex CLI 的 rollout 日志(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// 解析、归一化成 TaskTurn / RepoTranscript,与 claude-code collector 产出相同模型。
//
// 与 claude-code 的差异(为什么不复用 incrementalByFile):
//   · Claude Code:~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl —— 单层目录,
//     cwd 在目录名里编码。incrementalByFile 直接覆盖。
//   · Codex     :~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl —— 三层日期目录,
//     cwd 在文件第一行 session_meta.payload.cwd 里。需要自走增量,缓存独立。
//
// 改动文件来源:只取 event_msg.payload.type === "patch_apply_end" 的 changes 键集合。
// 不去解析 shell function_call 的 cmd 文本(grep/cat 也会出现文件名,误报会破"宁可漏
// 不可烦"的产品哲学,与已确认决策一致)。
//
// 隐私边界:只在内存提取"用户意图文本 + 改动文件名(basename)",不保留 patch 正文,
//   绝不写进 events.jsonl 审计体系。
//
// Codex rollout 字段(已通过真实样本核对):
//   {"type":"session_meta", "payload":{"session_id","cwd","originator":"codex-tui",...}}
//   {"type":"turn_context", "payload":{"cwd","model","approval_policy",...}}
//   {"type":"event_msg",    "payload":{"type":"user_message","message":"..."}}
//   {"type":"event_msg",    "payload":{"type":"patch_apply_end","changes":{<absPath>:{type,content}}}}
//   {"type":"response_item","payload":{"type":"function_call"|"custom_tool_call"|"message",...}}

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logDir } from "../logger";
import type { Collector, TaskTurn, RepoTranscript } from "./types";

/**
 * Codex CLI 日志根目录(YYYY/MM/DD 三层日期下放 rollout-*.jsonl)。
 * 测试时可用 ADG_CODEX_HOME 覆盖到临时目录,与 logger.ts 的 ADG_HOME 同哲学。
 */
export function codexSessionsDir(): string {
  const override = process.env.ADG_CODEX_HOME?.trim();
  if (override) return join(override, "sessions");
  return join(homedir(), ".codex", "sessions");
}

/** rollout jsonl 一行的最小形状(只字段我们要用的部分)。 */
interface RolloutLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    // session_meta / turn_context
    cwd?: string;
    session_id?: string;
    // event_msg: user_message
    message?: string;
    // event_msg: patch_apply_end
    changes?: Record<string, { type?: string; content?: string }>;
  };
}

// 系统注入的包裹:这些不是用户真实意图,提取任务时要剔除。
// Codex 的 user_message.message 是字符串;Codex CLI 自身的系统刹车标记会以这些前缀出现。
const SYSTEM_WRAPPERS = [
  /^\[Fact-Forcing Gate\]/,
  /^<system-reminder>/,
  /^<task-notification>/,
  /^Caveat:/,
  /^\[Request interrupted/,
];

/** 判断一段文本是否是"真实用户指令"。 */
function isRealTask(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (SYSTEM_WRAPPERS.some((re) => re.test(t))) return false;
  return true;
}

const TASK_MAX = 240;

/**
 * 解析单个 Codex rollout 文件为一串 TaskTurn。
 *
 * 算法(对齐 claude-code collector):
 *   1. 首条 session_meta 取 cwd —— 这是该 session 真实仓库根。
 *   2. 顺序扫描:遇到 user_message 开新 turn;遇到 patch_apply_end 把 changes 的
 *      文件名归到当前 turn。turn_context 出现时刷新 cwd(允许会话中途切目录)。
 *   3. 只保留真的改了文件的 turn —— 与 claude-code 一致,纯问答 turn 丢弃。
 */
export function parseSessionFile(filePath: string): { cwd: string | null; turns: TaskTurn[] } {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { cwd: null, turns: [] };
  }

  const turns: TaskTurn[] = [];
  let cur: TaskTurn | null = null;
  let cwd: string | null = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d: RolloutLine;
    try {
      d = JSON.parse(line) as RolloutLine;
    } catch {
      continue;
    }

    const p = d.payload;
    if (!p) continue;

    if (d.type === "session_meta" || d.type === "turn_context") {
      if (typeof p.cwd === "string" && p.cwd.length > 0) cwd = p.cwd;
      continue;
    }

    if (d.type === "event_msg") {
      if (p.type === "user_message" && typeof p.message === "string") {
        if (isRealTask(p.message)) {
          if (cur) turns.push(cur);
          cur = {
            task: p.message.trim().slice(0, TASK_MAX),
            filesChanged: [],
            timestamp: d.timestamp ?? null,
            gitBranch: null, // Codex rollout 不带 gitBranch
            cwd,
          };
        }
      } else if (p.type === "patch_apply_end" && p.changes && cur) {
        for (const absPath of Object.keys(p.changes)) {
          const base = absPath.split("/").pop() ?? absPath;
          if (!cur.filesChanged.includes(base)) cur.filesChanged.push(base);
        }
      }
    }
  }
  if (cur) turns.push(cur);
  return { cwd, turns: turns.filter((t) => t.filesChanged.length > 0) };
}

// ── 自走增量缓存 ──────────────────────────────────────────────────────────
// 不复用 file-cache.incrementalByFile:那个写死遍历 ~/.claude/projects 单层目录。
// Codex 是 sessions/YYYY/MM/DD/*.jsonl 三层,且 cwd 在文件第一行里,得自己走。
//
// 缓存语义与 file-cache 完全一致:(mtimeMs, size) 指纹未变 → 复用上次 parse 结果。
// 失败一律退化为"重解析",绝不抛错拖垮整体采集。

const CACHE_VERSION = 1;
interface CacheEntry {
  mtimeMs: number;
  size: number;
  cwd: string | null;
  turns: TaskTurn[];
}
type CacheMap = Record<string, CacheEntry>;
interface CacheFile {
  version: number;
  entries: CacheMap;
}

function cachePath(): string {
  return join(logDir(), "codex-transcript-cache.json");
}

function loadCache(): CacheMap {
  const p = cachePath();
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as CacheFile;
    if (data.version !== CACHE_VERSION || typeof data.entries !== "object") return {};
    return data.entries ?? {};
  } catch {
    return {};
  }
}

function saveCache(entries: CacheMap): void {
  try {
    mkdirSync(logDir(), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify({ version: CACHE_VERSION, entries }), "utf8");
  } catch (e) {
    console.warn("[adg] codex-transcript-cache 写入失败(不影响结果):", (e as Error).message);
  }
}

/** 递归列出 sessions/YYYY/MM/DD 下所有 rollout-*.jsonl 的绝对路径。 */
function listRolloutFiles(root: string): string[] {
  const out: string[] = [];
  // 三层固定深度遍历,比通用递归省 IO。结构外的目录直接跳。
  let years: string[];
  try {
    years = readdirSync(root);
  } catch {
    return out;
  }
  for (const y of years) {
    if (!/^\d{4}$/.test(y)) continue;
    const yp = join(root, y);
    let months: string[];
    try {
      months = readdirSync(yp);
    } catch {
      continue;
    }
    for (const m of months) {
      if (!/^\d{2}$/.test(m)) continue;
      const mp = join(yp, m);
      let days: string[];
      try {
        days = readdirSync(mp);
      } catch {
        continue;
      }
      for (const d of days) {
        if (!/^\d{2}$/.test(d)) continue;
        const dp = join(mp, d);
        let files: string[];
        try {
          files = readdirSync(dp);
        } catch {
          continue;
        }
        for (const f of files) {
          if (f.startsWith("rollout-") && f.endsWith(".jsonl")) out.push(join(dp, f));
        }
      }
    }
  }
  return out;
}

/**
 * 增量读取所有 Codex rollout,按真实 cwd 聚合成 RepoTranscript[]。
 * 没有 cwd 的 session 进 "<unknown>" 分桶(只是为了不丢数据,展示侧会过滤)。
 */
export function collectCodex(): RepoTranscript[] {
  const root = codexSessionsDir();
  if (!existsSync(root)) return [];

  const oldCache = loadCache();
  const newCache: CacheMap = {};
  const byRepo = new Map<string, { project: string; repoDir: string | null; turns: TaskTurn[] }>();

  let reparsed = 0;
  for (const filePath of listRolloutFiles(root)) {
    let mtimeMs = 0;
    let size = 0;
    try {
      const st = statSync(filePath);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      continue;
    }

    const hit = oldCache[filePath];
    let entry: CacheEntry;
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size && Array.isArray(hit.turns)) {
      entry = hit;
    } else {
      const parsed = parseSessionFile(filePath);
      entry = { mtimeMs, size, cwd: parsed.cwd, turns: parsed.turns };
      reparsed++;
    }
    newCache[filePath] = entry;
    if (entry.turns.length === 0) continue;

    // 聚合 key:优先 cwd(真实仓库根),否则归到 "<unknown>"。
    const key = entry.cwd ?? "<unknown>";
    const existing = byRepo.get(key);
    if (existing) {
      existing.turns.push(...entry.turns);
    } else {
      byRepo.set(key, {
        project: entry.cwd ?? "<unknown>",
        repoDir: entry.cwd,
        turns: [...entry.turns],
      });
    }
  }

  if (reparsed > 0 || Object.keys(oldCache).length !== Object.keys(newCache).length) {
    saveCache(newCache);
  }

  return [...byRepo.values()].map((v) => ({
    project: v.project,
    repoDir: v.repoDir,
    turns: v.turns.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
  }));
}

/** Codex CLI 采集源实现。 */
export const codexCollector: Collector = {
  id: "codex-cli",
  name: "Codex CLI",
  available: () => existsSync(codexSessionsDir()),
  collect: collectCodex,
};
