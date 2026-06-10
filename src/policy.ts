// policy.ts — agent 必须遵守的"规矩"(治理边界)的定义与加载。
//
// 这是"飞行记录仪"从"看 agent 做了什么"升级到"看 agent 有没有越界"的基础。
// Replit 事故的教训:agent 会在被明确告知"冻结期、未经许可不准改"时仍然碰生产、
// 还撒谎说不能回滚。问题不在"agent 不会干活",而在【没人定规矩、也没人抓违反】。
//
// 设计原则(延续产品哲学):
//   · 规矩由【用户/团队显式定义】(仓库根的 .agent-policy.json),记录仪只负责抓违反。
//     不凭空造规矩 —— 没配置就没规矩,绝不无中生有地报警(宁可漏,不可烦)。
//   · 第一版只做两类最对准事故、且【确定性可判】(非 LLM,零误判)的规矩:
//       frozen-path   某些路径/文件 agent 不准动(prod 配置、发布脚本、迁移...)
//       freeze-window 某段时间窗内不准有任何改动(发布冻结期、合规审查期)

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

/** 禁改路径规矩:碰了这些路径就是越界。 */
export interface FrozenPathPolicy {
  kind: "frozen-path";
  /** 规矩的人类可读名字 */
  name: string;
  /** 匹配的路径片段(子串匹配,大小写不敏感)。命中任一即越界。 */
  paths: string[];
  /** 一句话:为什么这些路径被冻结 */
  reason: string;
}

/** 冻结窗口规矩:这段时间内不准有任何改动。 */
export interface FreezeWindowPolicy {
  kind: "freeze-window";
  name: string;
  /** ISO 8601 起止(含)。在 [from, to] 内的改动都算越界。 */
  from: string;
  to: string;
  reason: string;
}

export type Policy = FrozenPathPolicy | FreezeWindowPolicy;

/** 一个仓库的全部规矩。 */
export interface PolicySet {
  /** 来源文件路径(用于展示),null 表示用了内置默认 */
  source: string | null;
  policies: Policy[];
}

/** 规矩文件名(放仓库根)。 */
export const POLICY_FILE = ".agent-policy.json";

const EMPTY: PolicySet = { source: null, policies: [] };

/** 校验单条 policy 结构,不合法返回 null(坏的一条不拖垮整组)。 */
function validatePolicy(p: unknown): Policy | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (o.kind === "frozen-path") {
    if (typeof o.name !== "string" || !Array.isArray(o.paths)) return null;
    const paths = o.paths.filter((x): x is string => typeof x === "string");
    if (paths.length === 0) return null;
    return { kind: "frozen-path", name: o.name, paths, reason: typeof o.reason === "string" ? o.reason : "" };
  }
  if (o.kind === "freeze-window") {
    if (typeof o.name !== "string" || typeof o.from !== "string" || typeof o.to !== "string") return null;
    // 起止必须是可解析的时间,且 from <= to
    if (Number.isNaN(Date.parse(o.from)) || Number.isNaN(Date.parse(o.to))) return null;
    if (o.from > o.to) return null;
    return { kind: "freeze-window", name: o.name, from: o.from, to: o.to, reason: typeof o.reason === "string" ? o.reason : "" };
  }
  return null;
}

/**
 * 从仓库根加载 .agent-policy.json。
 * 文件不存在 / 坏 / 无合法规矩 → 返回空规矩集(不报错、不造规矩)。
 * 文件格式:{ "policies": [ {kind, name, ...}, ... ] }
 */
export function loadPolicy(repoDir: string): PolicySet {
  const path = join(repoDir, POLICY_FILE);
  if (!existsSync(path)) return EMPTY;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return EMPTY;
  }
  try {
    const data = JSON.parse(raw) as { policies?: unknown };
    if (!Array.isArray(data.policies)) return { source: path, policies: [] };
    const policies = data.policies.map(validatePolicy).filter((p): p is Policy => p !== null);
    return { source: path, policies };
  } catch {
    // 坏 JSON:返回空但标注来源,让上层能提示"policy 文件存在但解析失败"。
    return { source: path, policies: [] };
  }
}

/** 解析 policy 列表(从已读到的对象,供测试/面板直接喂数据,不走文件)。 */
export function parsePolicies(input: { policies?: unknown }): Policy[] {
  if (!input || !Array.isArray(input.policies)) return [];
  return input.policies.map(validatePolicy).filter((p): p is Policy => p !== null);
}
