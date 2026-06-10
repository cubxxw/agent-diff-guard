// transcript.ts — 从 Claude Code 的 session 日志里提取"任务 → 改动"配对。
//
// 这是闭环学习的数据源。守门事件只告诉你"哪条规则被触发",而 transcript 告诉你
// "agent 当时声称在做什么任务、为此改了哪些文件" —— 有了它,才能区分:
//   · 任务是"配 CI 缓存"却改了 .github/  → 正当触碰,该规则在这个仓库是噪音
//   · 任务是"修登录 bug"却顺手改了 .github/ → 越界,这才是真该刹的
// 纯元数据永远做不出这个区分,对话内容才能。
//
// 隐私边界(关键):对话内容可能含代码/密钥/业务逻辑。本模块只在【内存】中提取,
//   绝不写进 events.jsonl 审计体系。是否把提取结果送给 AI,由上层(用户 opt-in)决定。
//   提取时已尽量只留"用户意图文本 + 改动文件名",不保留完整代码 diff 正文。

import { readFileSync } from "node:fs";
import { incrementalByFile, decodeProject } from "./file-cache";

/** 一次"用户给任务 → agent 改了哪些文件"的配对。 */
export interface TaskTurn {
  /** 用户的真实指令文本(已剥离系统包裹,截断到合理长度) */
  task: string;
  /** 这一轮 agent 用 Edit/Write/MultiEdit 改动的文件名(去路径,去重) */
  filesChanged: string[];
  /** 发生时间(该 turn 第一条消息的 ISO 时间) */
  timestamp: string | null;
  /** 当时的 git 分支 */
  gitBranch: string | null;
  /** 真实工作目录(来自 session 的 cwd 字段,准确绝对路径)。用于定位仓库读 policy。 */
  cwd: string | null;
}

/** 一个仓库的 transcript 摘要。 */
export interface RepoTranscript {
  project: string; // 解码后的仓库路径(展示用,可能有损)
  /** 真实仓库根目录(从 turns 的 cwd 取,准确)。null 表示 session 未带 cwd。 */
  repoDir: string | null;
  turns: TaskTurn[];
}

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
 * 解析单个 session 文件为一串 TaskTurn。
 * 逻辑:顺序扫描,遇到"真实用户指令"开一个新 turn,把其后到下一条用户指令之间
 * 所有 assistant 的文件改动归到这个 turn。这样就把"任务 ↔ 改动"对齐了。
 */
export function parseTranscriptFile(filePath: string): TaskTurn[] {
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
 * 增量读取所有仓库的 transcript。复用 file-cache 的指纹增量(缓存名 transcript-cache)。
 * 返回按仓库分组的 turns;空 turns 的仓库被略过。
 */
export function allTranscripts(): RepoTranscript[] {
  // incrementalByFile 按文件返回;我们需要按仓库聚合,所以 parse 阶段带回 project。
  const perFile = incrementalByFile<{ project: string; turns: TaskTurn[] }>(
    "transcript-cache",
    (filePath, project) => ({ project, turns: parseTranscriptFile(filePath) })
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

/** 取某个仓库(按路径子串匹配)的 transcript,供守门事件关联用。 */
export function transcriptForRepo(repoHint: string): RepoTranscript | null {
  const all = allTranscripts();
  // repoHint 可能是 "github.com/owner/repo" 或本地路径片段;用宽松子串匹配末段
  const tail = repoHint.split("/").filter(Boolean).slice(-2).join("/").toLowerCase();
  for (const rt of all) {
    if (rt.project.toLowerCase().includes(tail)) return rt;
  }
  return null;
}

export { decodeProject };
