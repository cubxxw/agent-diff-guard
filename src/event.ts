// event.ts — 守门事件的数据模型。
//
// 一条事件 = 一次 CLI 扫描的完整上下文快照。本文件被 CLI(生成)、
// logger(落盘)、serve-local(读取聚合)、未来的云端 API(接收)共用。
//
// 隐私分区是这个文件存在的理由:
//   - 可记录区:rule / path / severity / 时间 / 统计数 —— 落 JSONL、可上报
//   - 永不出区:evidence 正文、--task 原文、git email 原文、diff 行内容
// 上报的永远是元数据与 hash,绝不是代码。这是"云端 opt-in 也不传代码"的技术落点。

import type { Finding, FileChange, Severity } from "./rules";
import { generateUlid } from "./id";
import { sha256prefix } from "./hash";

export type { Severity };

/** 一条守门发现的元数据快照(不含代码正文) */
export interface FindingMeta {
  rule: string;
  severity: Severity;
  /** 触发文件路径(相对仓库根)。路径可记录,内容不可。 */
  path: string;
  /** why 的摘要,截断到 80 字符 */
  whySummary: string;
  /** evidence 是否存在 —— 只记 bool,正文永不落盘 */
  hasEvidence: boolean;
}

/** 扫描结果的统计摘要 */
export interface ScanSummary {
  totalFilesChanged: number;
  wakeCount: number;
  lookCount: number;
  /** 触发的 rule 列表(去重),用于排行统计 */
  rulesTriggered: string[];
}

/** 人工/自动对这批改动的处置 */
export type DispositionKind =
  | "auto-pass" // 退出码 0:无 wake-you-up,自动放行
  | "human-approved" // 人工确认放行(未来 GitHub App 写入)
  | "blocked"; // 退出码 1:被刹住

/** 一次完整守门扫描的事件记录(落盘 + 上报的共同结构) */
export interface GuardEvent {
  id: string; // ULID,本地生成
  timestamp: string; // ISO 8601
  cliVersion: string;

  repoRemote: string | null; // host+path,不含 token
  gitRange: string;
  taskDescHash: string | null; // sha256(task) 前 16 位,不传原文
  taskDescLen: number | null;

  summary: ScanSummary;
  findings: FindingMeta[];
  disposition: DispositionKind;

  // 团队字段:显式 opt-in 后才填(MVP 阶段均为 null)
  authorHash: string | null; // sha256(git email) 前 16 位
  repoAlias: string | null;
}

const WHY_MAX = 80;

/** 从原始 Finding 构造安全元数据:剥掉 evidence 正文,截断 why。 */
export function buildFindingMeta(f: Finding): FindingMeta {
  return {
    rule: f.rule,
    severity: f.severity,
    path: f.path,
    whySummary: f.why.slice(0, WHY_MAX),
    hasEvidence: Boolean(f.evidence),
  };
}

export interface BuildEventOpts {
  cliVersion: string;
  gitRange: string;
  task: string | undefined;
  changes: FileChange[];
  findings: Finding[];
  disposition: DispositionKind;
  /** git remote origin(已去敏),null 表示取不到 */
  repoRemote?: string | null;
  nowMs?: number; // 可注入用于测试
}

/** 把一次扫描组装成一条 GuardEvent。task 原文经 hash 后丢弃。 */
export async function buildEvent(o: BuildEventOpts): Promise<GuardEvent> {
  const wake = o.findings.filter((f) => f.severity === "wake-you-up");
  const look = o.findings.filter((f) => f.severity === "look-once");
  const rulesTriggered = Array.from(new Set(o.findings.map((f) => f.rule)));
  const nowMs = o.nowMs ?? Date.now();

  return {
    id: generateUlid(nowMs),
    timestamp: new Date(nowMs).toISOString(),
    cliVersion: o.cliVersion,
    repoRemote: o.repoRemote ?? null,
    gitRange: o.gitRange,
    taskDescHash: o.task ? await sha256prefix(o.task) : null,
    taskDescLen: o.task ? o.task.length : null,
    summary: {
      totalFilesChanged: o.changes.length,
      wakeCount: wake.length,
      lookCount: look.length,
      rulesTriggered,
    },
    findings: o.findings.map(buildFindingMeta),
    disposition: o.disposition,
    authorHash: null, // MVP:未启用团队模式
    repoAlias: null,
  };
}
