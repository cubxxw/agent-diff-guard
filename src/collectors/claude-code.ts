// collectors/claude-code.ts — Claude Code 采集源。
//
// 把 Claude Code 的 session 日志(~/.claude/projects/<encoded>/<sessionId>.jsonl)
// 解析、归一化成 TaskTurn / RepoTranscript。这是第一个、也是参考实现:其它 agent
// 的 collector 只需照此实现同一个 Collector 接口,产出同样的归一化模型即可接入。
//
// 隐私边界:只在内存提取"用户意图文本 + 改动文件名",不保留完整 diff 正文,
//   绝不写进 events.jsonl 审计体系。
//
// 这里曾内联在 transcript.ts 里;抽出后 transcript.ts 只剩中立模型与 registry 转发。

import { readFileSync, existsSync } from "node:fs";
import { incrementalByFile, projectsDir } from "../file-cache";
import type { Collector, TaskTurn, RepoTranscript } from "./types";

interface RawMsg {
  type?: string;
  isMeta?: boolean;
  timestamp?: string;
  gitBranch?: string;
  cwd?: string; // session 行里带的真实工作目录(准确绝对路径,优于目录名解码)
  message?: {
    role?: string;
    content?: unknown;
  };
}

// 系统注入的包裹:这些不是用户真实意图,提取任务时要剔除。
// 命中任一即认为这条 user 消息是系统/工具产物,不算"用户指令"。
const SYSTEM_WRAPPERS = [
  /<command-name>/,
  /<command-message>/,
  /<local-command-/,
  /<task-notification>/,
  /<system-reminder>/,
  /<bash-/,
  /\[Request interrupted/,
  /Caveat: The messages below/,
];

/** 从 user 消息的 content 抽出纯文本(content 可能是 string 或 block 数组)。 */
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text?: string } => !!c && typeof c === "object" && (c as { type?: string }).type === "text")
      .map((c) => c.text ?? "")
      .join(" ");
  }
  return "";
}

/** 判断一段文本是否是"真实用户指令"(非系统包裹、非空、有实质内容)。 */
function isRealTask(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (SYSTEM_WRAPPERS.some((re) => re.test(t))) return false;
  return true;
}

/** 从 assistant 消息里抽出 Edit/Write/MultiEdit 改动的文件名(去路径)。 */
function editedFiles(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const block = c as { type?: string; name?: string; input?: { file_path?: string } };
    if (block.type === "tool_use" && (block.name === "Edit" || block.name === "Write" || block.name === "MultiEdit")) {
      const fp = block.input?.file_path;
      if (fp) out.push(fp.split("/").pop() ?? fp);
    }
  }
  return out;
}

const TASK_MAX = 240; // 任务文本截断:够表达意图,又不把整段长 prompt 拖进来

/**
 * 解析单个 Claude Code session 文件为一串 TaskTurn。
 * 逻辑:顺序扫描,遇到"真实用户指令"开一个新 turn,把其后到下一条用户指令之间
 * 所有 assistant 的文件改动归到这个 turn。这样就把"任务 ↔ 改动"对齐了。
 */
export function parseSessionFile(filePath: string): TaskTurn[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const turns: TaskTurn[] = [];
  let cur: TaskTurn | null = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d: RawMsg;
    try {
      d = JSON.parse(line) as RawMsg;
    } catch {
      continue;
    }

    if (d.type === "user" && !d.isMeta) {
      const text = userText(d.message?.content);
      if (isRealTask(text)) {
        // 新任务:收尾上一个 turn,开新的
        if (cur) turns.push(cur);
        cur = {
          task: text.trim().slice(0, TASK_MAX),
          filesChanged: [],
          timestamp: d.timestamp ?? null,
          gitBranch: d.gitBranch ?? null,
          cwd: d.cwd ?? null,
        };
      }
    } else if (d.type === "assistant" && cur) {
      for (const f of editedFiles(d.message?.content)) {
        if (!cur.filesChanged.includes(f)) cur.filesChanged.push(f);
      }
    }
  }
  if (cur) turns.push(cur);
  // 只保留真的产生了改动的 turn —— 没改文件的纯问答对闭环学习没用
  return turns.filter((t) => t.filesChanged.length > 0);
}

/**
 * 增量读取所有仓库的 Claude Code transcript。复用 file-cache 的指纹增量
 * (缓存名 transcript-cache)。返回按仓库分组的 turns;空 turns 的仓库被略过。
 */
export function collectClaudeCode(): RepoTranscript[] {
  // incrementalByFile 按文件返回;我们需要按仓库聚合,所以 parse 阶段带回 project。
  const perFile = incrementalByFile<{ project: string; turns: TaskTurn[] }>(
    "transcript-cache",
    (filePath, project) => ({ project, turns: parseSessionFile(filePath) })
  );

  const byRepo = new Map<string, TaskTurn[]>();
  for (const { project, turns } of perFile) {
    if (turns.length === 0) continue;
    const arr = byRepo.get(project) ?? [];
    arr.push(...turns);
    byRepo.set(project, arr);
  }
  return [...byRepo.entries()].map(([project, turns]) => ({
    project,
    // 真实仓库根:取第一个带 cwd 的 turn(session 自带的准确绝对路径),回退 null。
    repoDir: turns.find((t) => t.cwd)?.cwd ?? null,
    turns,
  }));
}

/** Claude Code 采集源实现。 */
export const claudeCodeCollector: Collector = {
  id: "claude-code",
  name: "Claude Code",
  available: () => existsSync(projectsDir()),
  collect: collectClaudeCode,
};
