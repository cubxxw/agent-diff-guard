// findings.ts — 审查队列的真实数据源。
//
// 审查队列要回答的是:"现在,哪些已发生的 agent 改动该被我看一眼、逐条裁决?"
// 这和 events.jsonl(已落盘的历史元数据)不同 —— 队列要的是【当下未提交/未合并】
// 的真实改动正文,逐行 diff、声称的任务、偏离度,供人决策。
//
// 数据从哪来(隐私铁律下的取法):
//   · 声称的任务 / 分支 / 仓库目录 ← transcript(内存归一化,不落盘)
//   · diff 正文                    ← 请求时实时 `git diff`,只在内存流给【本机】面板
//   · 命中规则 / 偏离度            ← 复用 rules.runRules + scan.driftFindings(同一套判断)
//
// 关键:diff 正文绝不写进 events.jsonl、绝不上报。它只在这一次 HTTP 响应里存在,
// 服务对象是同一台机器上的浏览器面板。这与 context/danger 的"路径可出区、内容不出区"
// 是一致的 —— 这里的内容出的是 localhost,不是云端。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runRules, type FileChange, type Finding, type Severity } from "./rules";
import { parseDiff, driftFindings } from "./scan";
import { allTranscripts, type RepoTranscript, type TaskTurn } from "./transcript";

/** diff 的一行(给面板渲染用)。t: 增 / 删 / 上下文。 */
export interface DiffLine {
  t: "+" | "-" | " ";
  s: string;
}

/** 一条待裁决的发现(审查队列的最小单元)。 */
export interface QueueFinding {
  id: string;
  /** wake-you-up → "wake";look-once → "look"(对齐面板级别词) */
  level: "wake" | "look";
  rule: string;
  /** 仓库展示名(取末两段) */
  repo: string;
  branch: string | null;
  /** 改动文件路径 */
  file: string;
  /** 声称的任务原文(来自 transcript,已截断) */
  task: string;
  /** 任务 ↔ 改动偏离度 0–1(无 task 时为 null) */
  drift: number | null;
  /** 守门人为什么拦(规则的 why) */
  reason: string;
  /** 发生时间 ISO,或 null */
  timestamp: string | null;
  /** 增删行数 */
  stats: { add: number; del: number };
  /** diff 片段(最多若干行,正文只流给本机) */
  diff: DiffLine[];
}

const MAX_DIFF_LINES = 40;

function git(args: string[], cwd: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout;
}

/** 取一个仓库"当下待审"的 git 范围:优先 @{u}..HEAD(本地领先 upstream),否则工作区改动。 */
function pickRange(cwd: string): string | null {
  // 有 upstream 且本地有领先提交 → 审"还没推上去的"
  const ahead = git(["rev-list", "--count", "@{u}..HEAD"], cwd);
  if (ahead !== null && Number(ahead.trim()) > 0) return "@{u}..HEAD";
  // 否则看工作区是否有未提交改动(含已暂存)
  const status = git(["status", "--porcelain"], cwd);
  if (status !== null && status.trim().length > 0) return "HEAD";
  return null;
}

function currentBranch(cwd: string): string | null {
  const b = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return b ? b.trim() : null;
}

/** 把某文件的 FileChange 转成面板 diff 片段(裁到 MAX_DIFF_LINES)。 */
function toDiffLines(fc: FileChange): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const s of fc.removedLines) lines.push({ t: "-", s });
  for (const s of fc.addedLines) lines.push({ t: "+", s });
  if (lines.length > MAX_DIFF_LINES) {
    const head = lines.slice(0, MAX_DIFF_LINES);
    const hidden = lines.length - MAX_DIFF_LINES;
    head.push({ t: " ", s: `…(另有 ${hidden} 行)` });
    return head;
  }
  return lines;
}

const LEVEL: Record<Severity, "wake" | "look"> = {
  "wake-you-up": "wake",
  "look-once": "look",
};

/** 找一个仓库最近一次带 task 的 turn(给队列项标注"声称的任务")。 */
function latestTaskTurn(rt: RepoTranscript): TaskTurn | null {
  let best: TaskTurn | null = null;
  for (const t of rt.turns) {
    if (!t.task) continue;
    if (!best || (t.timestamp ?? "") > (best.timestamp ?? "")) best = t;
  }
  return best;
}

/** 偏离度:复用 driftFindings 的判断 —— 命中 task-drift 的文件占比。 */
function driftScore(changes: FileChange[], task: string | undefined): number | null {
  if (!task || !task.trim()) return null;
  if (changes.length === 0) return null;
  const drift = driftFindings(changes, task);
  return Math.min(1, drift.length / changes.length);
}

export interface BuildQueueOpts {
  transcripts?: RepoTranscript[];
}

/**
 * 扫所有有真实仓库目录的 transcript,对其当下待审范围实时跑规则,
 * 产出审查队列。纯读 git、不写任何东西。
 */
export function buildQueue(o: BuildQueueOpts = {}): QueueFinding[] {
  const transcripts = o.transcripts ?? allTranscripts();
  const out: QueueFinding[] = [];

  for (const rt of transcripts) {
    const cwd = rt.repoDir;
    if (!cwd || !existsSync(cwd)) continue;
    const range = pickRange(cwd);
    if (!range) continue;

    let changes: FileChange[];
    try {
      changes = parseDiff(range, cwd);
    } catch {
      continue; // git 失败的仓库跳过,不拖垮整个队列
    }
    if (changes.length === 0) continue;

    const turn = latestTaskTurn(rt);
    const task = turn?.task ?? "";
    const branch = turn?.gitBranch ?? currentBranch(cwd);
    const repo = rt.project.split("/").slice(-2).join("/");
    const drift = driftScore(changes, task);

    // 路径/内容规则命中
    const findings: Finding[] = runRules(changes);
    // 任务偏离命中(可能给非敏感文件也挂上 look-once)
    if (task) findings.push(...driftFindings(changes, task));

    const byPath = new Map<string, FileChange>();
    for (const c of changes) byPath.set(c.path, c);

    for (const f of findings) {
      const fc = byPath.get(f.path);
      out.push({
        id: `${range}:${f.rule}:${f.path}`.replace(/[^\w.:/@-]/g, "_"),
        level: LEVEL[f.severity],
        rule: f.rule,
        repo,
        branch,
        file: f.path,
        task,
        drift,
        reason: f.why,
        timestamp: turn?.timestamp ?? null,
        stats: { add: fc?.addedLines.length ?? 0, del: fc?.removedLines.length ?? 0 },
        diff: fc ? toDiffLines(fc) : [],
      });
    }
  }

  // wake 在前、look 在后;同级按时间倒序
  const rank = { wake: 0, look: 1 };
  return out.sort(
    (a, b) => rank[a.level] - rank[b.level] || (b.timestamp ?? "").localeCompare(a.timestamp ?? "")
  );
}
