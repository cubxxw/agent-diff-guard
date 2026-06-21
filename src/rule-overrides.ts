// rule-overrides.ts — 运行时规则覆盖层。
//
// 为什么存在:产品反复说"误报是头号死因、标记误报越多越该降级规则",但在此之前
// 降级一条规则只能改 src/rules.ts 源码 —— "标记误报 → 校准"的闭环是断的。
// 这一层让用户在面板上【禁用 / 降级】某条规则,落到本机 ~/.agent-diff-guard/rule-overrides.json,
// 所有守门通道(队列 / check / MCP / loop / pretool)读同一个文件,即时生效、无需改代码。
//
// 只往【更安静】方向(disable / 降级 wake→look),不提供 upgrade —— 对齐"宁可漏不可烦":
// 降级是安全方向(顶多多漏一点),升级会把本来安静的规则变吵,需谨慎,留给后续。

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { logDir } from "./logger";
import type { Finding } from "./rules";

export type RuleOverrideAction = "disable" | "downgrade";

export interface RuleOverrides {
  version: 1;
  /** ruleName → 覆盖动作。disable=该规则命中被剔除;downgrade=wake-you-up 降为 look-once。 */
  overrides: Record<string, { action: RuleOverrideAction }>;
}

const EMPTY: RuleOverrides = { version: 1, overrides: {} };

export function overridesPath(): string {
  return join(logDir(), "rule-overrides.json");
}

// 进程级缓存 + 短 TTL:守门每次 diff 都会读,避免反复读盘。文件被另一进程改了,
// 最多 1s 后生效(serve-local 写、check/MCP 短命进程读 —— 各自进程独立缓存,天然同步)。
let cache: { at: number; data: RuleOverrides } | null = null;
const TTL_MS = 1000;

export function readOverrides(nowMs?: number): RuleOverrides {
  const now = nowMs ?? Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  let data: RuleOverrides = EMPTY;
  try {
    if (existsSync(overridesPath())) {
      const parsed = JSON.parse(readFileSync(overridesPath(), "utf8")) as RuleOverrides;
      if (parsed && typeof parsed === "object" && parsed.overrides) data = parsed;
    }
  } catch {
    data = EMPTY; // 坏文件 → 当作无覆盖,绝不拖垮守门
  }
  cache = { at: now, data };
  return data;
}

/** 设置/清除一条规则覆盖。action=null 清除该规则的覆盖。返回更新后的全量配置。 */
export function setOverride(rule: string, action: RuleOverrideAction | null): RuleOverrides {
  const current = readOverrides();
  const next: RuleOverrides = { version: 1, overrides: { ...current.overrides } };
  if (action === null) delete next.overrides[rule];
  else next.overrides[rule] = { action };
  mkdirSync(logDir(), { recursive: true });
  writeFileSync(overridesPath(), JSON.stringify(next, null, 2), "utf8");
  cache = { at: Date.now(), data: next }; // 写后立即刷新本进程缓存
  return next;
}

/** action 是否合法(API 入参校验用)。 */
export function isOverrideAction(v: unknown): v is RuleOverrideAction {
  return v === "disable" || v === "downgrade";
}

/**
 * 把覆盖应用到一批 finding(不可变:返回新数组):
 *   disable   → 剔除该规则的命中
 *   downgrade → 把 wake-you-up 降为 look-once(已是 look-once 则不变)
 * 对空覆盖是 no-op(原样返回)。
 */
export function applyOverrides(findings: Finding[], ov: RuleOverrides = readOverrides()): Finding[] {
  // 空覆盖也返回【副本】而非原数组引用 —— 下游(findings.ts)会 push 进结果数组,
  // 返回引用会让它 mutate 到调用方的本地数组,是脆弱的隐式契约。
  if (Object.keys(ov.overrides).length === 0) return [...findings];
  return findings.flatMap((f) => {
    const o = ov.overrides[f.rule];
    if (!o) return [f];
    if (o.action === "disable") return [];
    // downgrade:只往更安静方向
    return f.severity === "wake-you-up" ? [{ ...f, severity: "look-once" as const }] : [f];
  });
}
