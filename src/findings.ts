// findings.ts — 审查队列的真实数据源。
//
// 审查队列要回答的是:"现在,哪些 agent 改动该被我看一眼、逐条裁决?"
// 它有三个来源,合成一条统一的队列(每项带 origin 标明出处):
//
//   live    —— 【当下未提交/未合并】的真实改动正文。请求时实时 `git diff`,
//              逐行 diff、声称的任务、偏离度,供人决策。正文只流给本机面板。
//   history —— 【过去被刹住】的命中。从 events.jsonl 回流 blocked/wake 命中,
//              让"守门记录里被刹住的"和"队列里等裁决的"是同一批数据,而非两套断开
//              的世界。隐私铁律下 events 只存元数据(rule/path/severity/why),
//              没有 diff 正文 —— 所以 history 项的 diff 为空,展示"历史记录·无正文重放"。
//   demo    —— 仅当 live+history 都为空时的兜底种子,让新用户进来也能走通
//              "队列→裁决→信箱"闭环、看清产品长什么样。明确标 origin:"demo"。
//
// 关键:live 的 diff 正文绝不写进 events.jsonl、绝不上报。它只在这一次 HTTP 响应里
// 存在,服务对象是同一台机器上的浏览器面板。这与 context/danger 的"路径可出区、
// 内容不出区"一致 —— 这里内容出的是 localhost,不是云端。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runRules, type FileChange, type Finding, type Severity } from "./rules";
import { parseDiff, driftFindings, isLowInfoTask } from "./scan";
import { allTranscripts, type RepoTranscript, type TaskTurn } from "./transcript";
import { readEvents } from "./logger";
import type { GuardEvent } from "./event";

/** diff 的一行(给面板渲染用)。t: 增 / 删 / 上下文。 */
export interface DiffLine {
  t: "+" | "-" | " ";
  s: string;
}

/** 队列项出处:live=当下 git diff;history=events 回流的历史被刹住;demo=兜底种子。 */
export type QueueOrigin = "live" | "history" | "demo";

/** 一条待裁决的发现(审查队列的最小单元)。 */
export interface QueueFinding {
  id: string;
  /** 这条发现从哪来 —— 决定前端怎么标注"实时 diff / 历史记录 / 演示" */
  origin: QueueOrigin;
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
  /** 同一处(repo:rule:file)被刹住的次数;history 聚合后 >1,live/demo 省略(默认 1) */
  hitCount?: number;
  /** 同一处最早一次被刹的时间 ISO(history 聚合产物) */
  firstSeen?: string | null;
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

/** 偏离度:复用 driftFindings 的判断 —— 命中 task-drift 的文件占比。
 *  P0-4:任务描述信息量不足(空 / 过短 / 全是"继续修复解决"这类无指向停用词)时返回 null
 *  ——「无法判断偏离」,而非默认 0%(假安全)。前端对 null 与 0 区别展示。 */
function driftScore(changes: FileChange[], task: string | undefined): number | null {
  if (changes.length === 0) return null;
  if (isLowInfoTask(task)) return null; // 信息量不足 → 不可判,而非"0% 偏离 = 安全"
  const drift = driftFindings(changes, task);
  return Math.min(1, drift.length / changes.length);
}

export interface BuildQueueOpts {
  transcripts?: RepoTranscript[];
  /** 注入历史事件(测试用);省略则读 events.jsonl */
  events?: GuardEvent[];
  /** 关掉 demo 兜底(测试用,验证 live/history 为空时确实返回空) */
  noDemo?: boolean;
  /**
   * 是否把"过去被刹住"的历史回流进队列。默认 false ——
   * 审查队列只放 live(当下未 push、能真正裁决、有 diff 正文)。
   * history 已被刹住/已合并,对它点"放行/驳回"无意义;它的聚合数据(aggregateHistory)
   * 改由"守门记录"页消费。设 true 才回流(测试/特殊视图用)。
   */
  includeHistory?: boolean;
}

/**
 * 扫所有有真实仓库目录的 transcript,对其当下待审范围实时跑规则,
 * 产出 live 队列项。纯读 git、不写任何东西。
 */
function buildLive(transcripts: RepoTranscript[]): QueueFinding[] {
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
    // P0-4:任务描述信息量不足时,既不算 0% 偏离,也不跑词面 drift(会假命中/假放过)。
    const lowInfo = isLowInfoTask(task);

    // 路径/内容规则命中
    const findings: Finding[] = runRules(changes);
    // 任务偏离命中(可能给非敏感文件也挂上 look-once);低信息任务不跑,避免误导
    if (task && !lowInfo) findings.push(...driftFindings(changes, task));

    const byPath = new Map<string, FileChange>();
    for (const c of changes) byPath.set(c.path, c);

    // 任务有内容但信息量不足:给个可读提示,让前端知道 drift=null 是"无法判断"而非"安全"
    const driftNote = task && lowInfo ? "(任务描述不足以判断偏离 —— 已跳过偏离检测,请人工确认改动范围)" : "";

    for (const f of findings) {
      const fc = byPath.get(f.path);
      out.push({
        id: `${range}:${f.rule}:${f.path}`.replace(/[^\w.:/@-]/g, "_"),
        origin: "live",
        level: LEVEL[f.severity],
        rule: f.rule,
        repo,
        branch,
        file: f.path,
        task,
        drift,
        reason: driftNote ? `${f.why} ${driftNote}` : f.why,
        timestamp: turn?.timestamp ?? null,
        stats: { add: fc?.addedLines.length ?? 0, del: fc?.removedLines.length ?? 0 },
        diff: fc ? toDiffLines(fc) : [],
      });
    }
  }

  return out;
}

/**
 * 从 events.jsonl 回流"过去被刹住"的命中,转成队列项(origin:history)。
 * 这是修复"被刹住 ≠ 待裁决"断裂的关键:守门记录里 blocked/wake 的事件,
 * 应当作为可裁决项出现在队列里,而非只躺在审计流水里。
 *
 * 隐私铁律:events 只存元数据(rule/path/severity/whySummary),没有 diff 正文 ——
 * 所以 history 项 diff 为空、stats 取自 summary、task 只能给 hash 化的占位说明。
 * 只回流 wake-you-up 级 findings(对齐"宁可漏不可烦":历史 look-once 不再翻旧账)。
 */
/**
 * 把"被刹住"的历史事件回流成队列项,并按 repo:rule:file 聚合 ——
 * 同一处被刹 N 次只出一条,带 hitCount(命中次数)和 firstSeen(最早时间),
 * 展示用最近一次的元数据。修复"src/config.ts 被列 6 次"的告警疲劳。
 *
 * 导出供"守门记录"页复用:队列默认不放 history(见 buildQueue),
 * 但守门记录页要展示"过去被刹住的、已聚合的"全量。
 *
 * 隐私铁律:events 只存元数据(rule/path/severity/whySummary),没有 diff 正文 ——
 * 所以聚合项 diff 为空、stats 取自 summary、task 只给 hash 化的占位说明。
 * 只回流 wake-you-up 级 findings(对齐"宁可漏不可烦":历史 look-once 不再翻旧账)。
 */
export function aggregateHistory(events: GuardEvent[]): QueueFinding[] {
  // key = repo:rule:file → 聚合;按时间升序遍历,保证 firstSeen 是最早、展示取最近
  const byKey = new Map<string, QueueFinding>();
  const sorted = [...events].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

  for (const ev of sorted) {
    // 只回流"被刹住"的事件里的 wake 命中 —— 这些是真正该被人裁决的
    if (ev.disposition !== "blocked") continue;
    const repo = (ev.repoRemote ?? "(本地仓库)").split("/").slice(-2).join("/");
    for (const f of ev.findings) {
      if (f.severity !== "wake-you-up") continue;
      const key = `${repo}:${f.rule}:${f.path}`;
      const existing = byKey.get(key);
      if (existing) {
        // 同一处再次被刹:累加次数,展示数据更新为最近一次(sorted 升序 → ev 更新)
        existing.hitCount = (existing.hitCount ?? 1) + 1;
        existing.timestamp = ev.timestamp;
        existing.reason = f.whySummary;
        existing.task = ev.taskDescLen ? `历史任务(${ev.taskDescLen} 字,原文未留存)` : "";
        continue;
      }
      byKey.set(key, {
        id: `hist:${f.rule}:${f.path}`.replace(/[^\w.:/@-]/g, "_"),
        origin: "history",
        level: LEVEL[f.severity],
        rule: f.rule,
        repo,
        branch: null,
        file: f.path,
        // events 不留 task 原文(只有 hash),给出可读占位而非假装有正文
        task: ev.taskDescLen ? `历史任务(${ev.taskDescLen} 字,原文未留存)` : "",
        drift: null,
        reason: f.whySummary,
        timestamp: ev.timestamp,
        stats: { add: 0, del: 0 },
        diff: [], // 隐私铁律:历史无正文可重放
        hitCount: 1,
        firstSeen: ev.timestamp,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * 兜底种子:仅当 live+history 都为空时注入,让新用户也能走通闭环、看清产品形态。
 * 明确标 origin:"demo",前端会打"演示"角标,不会被误认成真实改动。
 */
function demoSeeds(): QueueFinding[] {
  return [
    {
      id: "demo:wake:hardcoded-secret",
      origin: "demo",
      level: "wake",
      rule: "hardcoded-secret",
      repo: "your-org/your-repo",
      branch: "feat/login",
      file: "src/config.ts",
      task: "(演示)接入第三方登录,把回调地址写进配置",
      drift: 0.72,
      reason: "新增了疑似硬编码的密钥/令牌 —— 一旦合并入库几乎不可撤回",
      timestamp: new Date().toISOString(),
      stats: { add: 3, del: 0 },
      diff: [
        { t: " ", s: "export const oauth = {" },
        { t: "+", s: '  clientSecret: "sk-live-9f3a...本演示密钥已打码",' },
        { t: " ", s: "  redirectUri: process.env.OAUTH_REDIRECT," },
      ],
    },
    {
      id: "demo:wake:ci-pipeline",
      origin: "demo",
      level: "wake",
      rule: "ci-pipeline",
      repo: "your-org/your-repo",
      branch: "feat/login",
      file: ".github/workflows/deploy.yml",
      task: "(演示)接入第三方登录,把回调地址写进配置",
      drift: 0.9,
      reason: "改动了 CI/CD 流水线 —— agent 动这里可能改变构建/发布/权限行为,且与当前任务无关",
      timestamp: new Date().toISOString(),
      stats: { add: 2, del: 5 },
      diff: [
        { t: "-", s: "      - run: npm test" },
        { t: "+", s: "      - run: npm test || true   # 演示:放宽了 CI 断言" },
      ],
    },
    {
      id: "demo:look:dependency-manifest",
      origin: "demo",
      level: "look",
      rule: "dependency-manifest",
      repo: "your-org/your-repo",
      branch: "feat/login",
      file: "package.json",
      task: "(演示)接入第三方登录,把回调地址写进配置",
      drift: 0.4,
      reason: "改动了依赖清单 —— 引入了新依赖或改了版本,供应链风险",
      timestamp: new Date().toISOString(),
      stats: { add: 1, del: 0 },
      diff: [{ t: "+", s: '    "passport-oauth2": "^1.8.0",' }],
    },
  ];
}

/** wake 在前、look 在后;同级按时间倒序。 */
function sortQueue(items: QueueFinding[]): QueueFinding[] {
  const rank = { wake: 0, look: 1 };
  return items.sort(
    (a, b) => rank[a.level] - rank[b.level] || (b.timestamp ?? "").localeCompare(a.timestamp ?? "")
  );
}

/**
 * 合成审查队列:默认只放 live(当下 git diff,能真正裁决、有正文)。
 * history(过去被刹住)默认不回流 —— 它已被刹住/已合并,对它裁决无意义,
 * 其聚合数据交给"守门记录"页(aggregateHistory)。仅 includeHistory:true 时回流。
 * live(+history)都空时返回 demo 兜底种子。同一 file+rule 优先保留 live(有正文)。
 */
export function buildQueue(o: BuildQueueOpts = {}): QueueFinding[] {
  const transcripts = o.transcripts ?? allTranscripts();
  const live = buildLive(transcripts);

  // 默认队列只放 live;history 仅在显式 includeHistory 时回流
  const history = o.includeHistory ? aggregateHistory(o.events ?? readEvents()) : [];

  // 去重:live 已覆盖的 file+rule 不再用 history 重复列(live 有正文,更优)
  const liveKeys = new Set(live.map((f) => `${f.repo}:${f.rule}:${f.file}`));
  const dedupedHistory = history.filter((f) => !liveKeys.has(`${f.repo}:${f.rule}:${f.file}`));

  const merged = [...live, ...dedupedHistory];
  if (merged.length === 0 && !o.noDemo) return sortQueue(demoSeeds());
  return sortQueue(merged);
}
