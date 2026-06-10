// transcript.ts — 归一化模型定义 + 跨 agent 采集的转发入口。
//
// 这里曾把"读 Claude Code session 日志"与"归一化成 TaskTurn"焊死在一起。现在解耦:
//   · 中立模型(TaskTurn / RepoTranscript)在本文件定义 —— 策略层(violations/policy)
//     与消费层(insights/面板/MCP)都只依赖它,不关心数据来自哪个 agent。
//   · 具体采集逻辑下沉到 collectors/(claude-code 是第一个实现)。
//   · allTranscripts() 转发到 collectors registry,跨所有可用 agent 汇总。
//
// 隐私边界(不变):对话内容可能含代码/密钥/业务逻辑。归一化只在【内存】中进行,
//   绝不写进 events.jsonl 审计体系;只留"用户意图文本 + 改动文件名",不留 diff 正文。

import { decodeProject } from "./file-cache";
import { collectAll } from "./collectors/registry";

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

// parseTranscriptFile 是历史入口(测试与按需解析在用)。解耦后实现下沉到
// claude-code collector;此处转发,保持对外签名不变。
export { parseSessionFile as parseTranscriptFile } from "./collectors/claude-code";

/**
 * 增量读取所有仓库的 transcript,跨所有可用 agent 汇总(Claude Code / Cursor / …)。
 * 实际采集走 collectors registry;本函数只是稳定的对外入口。
 */
export function allTranscripts(): RepoTranscript[] {
  return collectAll();
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
