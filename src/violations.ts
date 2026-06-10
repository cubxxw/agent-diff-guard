// violations.ts — 越界检测引擎:agent 有没有违反人定下的规矩。
//
// 这是"飞行记录仪"的核心能力,也是它区别于市面所有 AI 工具的地方:
// 别人(CodeRabbit/Greptile)学的是【人写 PR 的偏好】;这里抓的是【AI agent 实际越了什么界】。
// 对准 Replit 式事故 —— agent 在冻结期改了不该改的东西。
//
// 确定性检测:全部基于路径子串匹配 + 时间区间判断,【无 LLM 参与】,所以零误判、可复现、
// 可审计。规矩是用户显式定的(policy.ts),没规矩就没违规 —— 不无中生有。
//
// 输入是 transcript 的 TaskTurn(谁/何时/改了什么),与某仓库的 PolicySet 交叉。
// 局限(诚实标注):TaskTurn.filesChanged 是文件名(去路径),所以 frozen-path 对
// "禁改某文件名(deploy.sh / prod.env)"准确,对"禁改某目录"会失真——后者需完整路径,
// 走 check 主路径补。第一版聚焦文件名级,够覆盖最对准事故的场景。

import type { TaskTurn } from "./transcript";
import type { Policy, FrozenPathPolicy, FreezeWindowPolicy } from "./policy";
import { redactSecrets } from "./insights";

/** 一次越界记录。 */
export interface Violation {
  /** 违反了哪类规矩 */
  policyKind: Policy["kind"];
  /** 规矩名 */
  policyName: string;
  /** 为什么这条规矩存在 */
  reason: string;
  /** 触发越界的任务(agent 当时声称在做什么) */
  task: string;
  /** 具体违规的文件(frozen-path)或全部改动(freeze-window) */
  offendingFiles: string[];
  /** 发生时间 */
  timestamp: string | null;
  /** 当时分支 */
  gitBranch: string | null;
}

/** 检查一个 turn 是否撞了某条 frozen-path 规矩。返回命中的文件(空=没撞)。 */
function frozenPathHits(turn: TaskTurn, p: FrozenPathPolicy): string[] {
  const out: string[] = [];
  for (const f of turn.filesChanged) {
    const lf = f.toLowerCase();
    if (p.paths.some((pat) => lf.includes(pat.toLowerCase()))) out.push(f);
  }
  return out;
}

/** 检查一个 turn 是否落在某 freeze-window 内(且确实有改动)。 */
function inFreezeWindow(turn: TaskTurn, p: FreezeWindowPolicy): boolean {
  if (!turn.timestamp) return false;
  if (turn.filesChanged.length === 0) return false;
  return turn.timestamp >= p.from && turn.timestamp <= p.to;
}

/**
 * 对一组 turn × 一组 policy 做越界检测,产出所有 Violation。
 * 一个 turn 可能同时撞多条规矩 → 各记一条。
 */
export function detectViolations(turns: TaskTurn[], policies: Policy[]): Violation[] {
  if (policies.length === 0) return [];
  const out: Violation[] = [];

  for (const turn of turns) {
    for (const p of policies) {
      if (p.kind === "frozen-path") {
        const hits = frozenPathHits(turn, p);
        if (hits.length > 0) {
          out.push({
            policyKind: "frozen-path",
            policyName: p.name,
            reason: p.reason,
            task: redactSecrets(turn.task), // 任务文本可能夹带密钥,打码后才进记录
            offendingFiles: hits,
            timestamp: turn.timestamp,
            gitBranch: turn.gitBranch,
          });
        }
      } else if (p.kind === "freeze-window") {
        if (inFreezeWindow(turn, p)) {
          out.push({
            policyKind: "freeze-window",
            policyName: p.name,
            reason: p.reason,
            task: redactSecrets(turn.task), // 同上,脱敏后才进记录
            offendingFiles: turn.filesChanged,
            timestamp: turn.timestamp,
            gitBranch: turn.gitBranch,
          });
        }
      }
    }
  }

  // 时间倒序:最近的越界排前面(飞行记录最关心新近发生的)
  return out.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
}

/** 按规矩名聚合越界次数,给面板做"哪条规矩被反复违反"的概览。 */
export interface ViolationSummary {
  policyName: string;
  policyKind: Policy["kind"];
  count: number;
  /** 最近一次违规时间 */
  lastSeen: string | null;
}

export function summarizeViolations(violations: Violation[]): ViolationSummary[] {
  const map = new Map<string, ViolationSummary>();
  for (const v of violations) {
    const row = map.get(v.policyName) ?? { policyName: v.policyName, policyKind: v.policyKind, count: 0, lastSeen: null };
    row.count++;
    if (v.timestamp && (!row.lastSeen || v.timestamp > row.lastSeen)) row.lastSeen = v.timestamp;
    map.set(v.policyName, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
