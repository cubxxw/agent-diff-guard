// collectors/types.ts — 采集层的中立契约。
//
// 这是"agent 无关治理层"的地基:每种编码 agent(Claude Code / Cursor / Cline / …)
// 的日志格式各不相同,但它们最终都被归一化成同一个 TaskTurn 模型。策略层
// (violations/policy)与消费层(insights/面板/MCP)只依赖这个中立模型,完全
// 不关心数据来自哪个 agent —— 这就是为什么加一个新 agent 只要写一个 Collector,
// 而不用动主干。
//
// 归一化模型(TaskTurn / RepoTranscript)仍由 transcript.ts 定义并导出,这里只做
// 转出,避免循环依赖。新 collector 应 import 本文件拿接口与模型。

import type { TaskTurn, RepoTranscript } from "../transcript";

export type { TaskTurn, RepoTranscript };

/**
 * 一个采集源。把某种 agent 的本地痕迹(session 日志、chat 历史、git hook 记录…)
 * 解析、归一化成按仓库分组的 RepoTranscript。
 *
 * 实现约束(守隐私边界):
 *   - 只在内存中提取,绝不把对话正文写进 events.jsonl 审计体系。
 *   - 尽量只留"用户意图文本 + 改动文件名",不保留完整代码 diff 正文。
 *   - 拿不到数据(agent 未安装/无日志)时返回 [],绝不抛错拖垮整体采集。
 */
export interface Collector {
  /** 采集源标识(展示与溯源用),如 "claude-code" / "cursor"。 */
  readonly id: string;
  /** 人类可读名称,如 "Claude Code"。 */
  readonly name: string;
  /**
   * 该源此刻在本机是否可采集(对应日志目录存在等)。
   * 为 false 时 registry 会跳过它,不调用 collect()。
   */
  available(): boolean;
  /** 采集并归一化为按仓库分组的 transcript。无数据时返回 []。 */
  collect(): RepoTranscript[];
}
