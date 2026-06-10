// insights.ts — 闭环洞察引擎:把"任务→改动"(transcript)与守门规则关联,挖出可学习的模式。
//
// 这是 agent-diff-guard 从"静态守门"走向"会学习的守门"的核心。它不直接下结论,
// 而是把真实历史整理成结构化证据,交给上层(AI 或人)判断该怎么调规则:
//
//   · 某仓库里 "dependency-manifest" 被碰 8 次,任务多是"加依赖/升级"→ 正当,在这个仓库是噪音
//   · 某仓库里 ".env" 类被碰,任务却是"改样式"→ 越界,该升级警告
//   · 某类文件反复被改但现有规则没覆盖 → 新规则候选
//
// 注意诚实标注的局限:transcript 只保留了文件名(去路径,隐私+体积考量),所以
// 目录型规则(.github/workflows/、k8s/)无法从文件名判定,这里只覆盖"文件名即可判定"的规则。
// 完整路径级判定仍走 check 主路径(scan.ts);insights 是基于历史对话的【补充】信号。

import { SENSITIVE_PATH_RULES } from "./rules";
import type { RepoTranscript } from "./transcript";

/** 一条规则在某仓库的"被触碰"证据聚合。 */
export interface RuleEvidence {
  rule: string;
  why: string;
  /** 命中次数(有多少个 turn 改了匹配这条规则的文件) */
  hitCount: number;
  /** 触发这条规则的代表性任务(去重,最多几条)—— 判断"正当 vs 越界"的关键素材 */
  sampleTasks: string[];
  /** 命中的代表性文件名 */
  sampleFiles: string[];
}

/** 一个仓库的洞察输入:够 AI/人据此判断规则该怎么调。 */
export interface RepoInsight {
  project: string;
  /** 这个仓库总共分析了多少个 turn */
  turnCount: number;
  /** 各敏感规则的触碰证据,按命中次数降序 */
  evidence: RuleEvidence[];
}

// 用文件名(而非完整路径)能判定的规则子集。目录型规则对纯文件名判不准,跳过。
const FILENAME_MATCHABLE = SENSITIVE_PATH_RULES.filter(
  (r) => !/workflows|k8s|kubernetes|manifests|helm|charts/.test(r.test.source)
);

/** 给定一个文件名,返回它命中的敏感规则(0 或多个)。基于文件名,非完整路径。 */
function rulesForFile(fileName: string): { rule: string; why: string }[] {
  const out: { rule: string; why: string }[] = [];
  for (const r of FILENAME_MATCHABLE) {
    if (r.test.test(fileName)) out.push({ rule: r.rule, why: r.why });
  }
  return out;
}

const SAMPLE_MAX = 4;

// 任务文本来自真实对话,可能夹带用户贴进去的密钥/token。在进入 sampleTasks 前打码,
// 这样即便上层把 insight 送给 AI,也不会外泄凭证。宁可错杀长串,也不漏 key。
const SECRET_LIKE = [
  /\bsk-[A-Za-z0-9_-]{12,}/g, // openai/anthropic 风格
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, // github token
  /\bAKIA[0-9A-Z]{12,}/g, // aws access key
  /\bAIza[0-9A-Za-z_-]{20,}/g, // google api key
  /\b[A-Za-z0-9_-]{32,}\b/g, // 兜底:任何 32+ 位的长串(可能是裸 token/hash)
];

/** 把任务文本里的疑似密钥打码,保留首尾少量字符以便辨认上下文。 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_LIKE) {
    out = out.replace(re, (m) => (m.length <= 8 ? "***" : `${m.slice(0, 4)}…${m.slice(-2)}[REDACTED]`));
  }
  return out;
}

/** 把一个仓库的 transcript 聚合成 RepoInsight。 */
export function buildRepoInsight(rt: RepoTranscript): RepoInsight {
  const acc = new Map<string, RuleEvidence & { _tasks: Set<string>; _files: Set<string> }>();

  for (const turn of rt.turns) {
    // 先算出这个 turn 碰到了哪些规则(跨它改的所有文件去重),以及每条规则由哪些文件触发。
    const hitRules = new Map<string, string>(); // rule -> why
    const ruleFiles = new Map<string, string[]>(); // rule -> 触发它的文件名
    for (const f of turn.filesChanged) {
      for (const { rule, why } of rulesForFile(f)) {
        hitRules.set(rule, why);
        const arr = ruleFiles.get(rule) ?? [];
        arr.push(f);
        ruleFiles.set(rule, arr);
      }
    }
    for (const [rule, why] of hitRules) {
      let e = acc.get(rule);
      if (!e) {
        e = { rule, why, hitCount: 0, sampleTasks: [], sampleFiles: [], _tasks: new Set(), _files: new Set() };
        acc.set(rule, e);
      }
      e.hitCount++;
      if (e._tasks.size < SAMPLE_MAX && turn.task) e._tasks.add(redactSecrets(turn.task));
      for (const f of ruleFiles.get(rule) ?? []) {
        if (e._files.size < SAMPLE_MAX) e._files.add(f);
      }
    }
  }

  const evidence: RuleEvidence[] = [...acc.values()]
    .map(({ _tasks, _files, ...e }) => ({ ...e, sampleTasks: [..._tasks], sampleFiles: [..._files] }))
    .sort((a, b) => b.hitCount - a.hitCount);

  return { project: rt.project, turnCount: rt.turns.length, evidence };
}

/** 批量:对所有仓库产出洞察,过滤掉没有任何敏感触碰的仓库(没料)。 */
export function buildAllInsights(transcripts: RepoTranscript[]): RepoInsight[] {
  return transcripts
    .map(buildRepoInsight)
    .filter((ri) => ri.evidence.length > 0)
    .sort(
      (a, b) =>
        b.evidence.reduce((s, e) => s + e.hitCount, 0) - a.evidence.reduce((s, e) => s + e.hitCount, 0)
    );
}
