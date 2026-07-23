// replay.ts — 一条命令,回放"过去 N 天你的 agent 背着你干了什么"。
//
// 这是产品的 60 秒 aha 入口:不装 hook、不配置,直接吃现成的 collectors 数据
// (Claude Code / Codex / …的本地 session 日志),按敏感规则回放历史触碰。
// 两种结局都是好结局:后背发凉 → 当场装 hook;干干净净 → 确认不需要,也值 60 秒。
//
// 诚实口径(比吓人更重要):
//   · transcript 只保留文件名(去路径,隐私边界),所以只统计"文件名即可判定"的规则
//     (FILENAME_MATCHABLE,与 insights 同一子集)。说"碰过",不说"删过/泄露了"。
//   · 目录型规则(.github/workflows/、k8s/)文件名判不准 → 不统计,宁可漏不可烦。
//   · 任务外顺手改动用保守判据:该 turn 至少有 1 个文件与任务相关、同时有文件无关,
//     才算"顺手改"(全无关更可能是关键词没对上,不算;与主路径 driftFindings 的
//     压制哲学一致)。低信息任务(isLowInfoTask)不参与判定。
//   · 每个数字必须带可下钻的实例(日期+仓库+任务原文+文件),没有实例的数字不可信。

import { FILENAME_MATCHABLE, redactSecrets } from "./insights";
import { taskKeywords, isLowInfoTask } from "./scan";
import type { RepoTranscript, TaskTurn } from "./transcript";
import type { GuardEvent } from "./event";

/** 一个可下钻的实例:哪天、哪个仓库、什么任务、碰了哪些文件。 */
export interface ReplaySample {
  date: string; // YYYY-MM-DD(本地时区)
  project: string; // 仓库路径末两段(展示用)
  task: string; // 任务原文(已打码、截断)
  files: string[];
}

/** 一类敏感触碰的聚合。 */
export interface ReplayCategory {
  rule: string;
  severity: "wake-you-up" | "look-once";
  why: string;
  /** 命中的 turn 数(同一 turn 碰同类多个文件算 1 次) */
  hits: number;
  /** 涉及的仓库数 */
  repos: number;
  samples: ReplaySample[];
}

export interface ReplayReport {
  days: number;
  from: string; // YYYY-MM-DD
  to: string;
  sources: string[]; // 采集源名称(Claude Code / Codex CLI / …)
  turns: number; // 窗口内产生了文件改动的任务数
  repos: number;
  fileTouches: number; // 文件改动总触碰数(非去重文件数)
  wake: ReplayCategory[]; // wake 级触碰,hits 降序
  look: ReplayCategory[]; // look 级触碰
  testTouches: { hits: number; samples: ReplaySample[] };
  drift: { hits: number; judgeable: number; samples: ReplaySample[] };
  /** 窗口内的真实守门记录;null = 从没跑过任何扫描(没装 hook 的信号)。 */
  guard: { scans: number; wake: number; look: number } | null;
}

const SAMPLE_MAX = 2; // 每类默认展示的实例数:够下钻,不刷屏
const TASK_SHOW = 42; // 实例里任务原文的展示长度

function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortProject(p: string): string {
  return p.split("/").filter(Boolean).slice(-2).join("/");
}

function toSample(turn: TaskTurn, project: string, files: string[]): ReplaySample {
  // 任务原文可能带换行/连续空白(粘贴的长 prompt),压成单行再截断,别破坏终端排版
  const oneLine = redactSecrets(turn.task).replace(/\s+/g, " ").trim();
  return {
    date: turn.timestamp ? localDate(turn.timestamp) : "????-??-??",
    project: shortProject(project),
    task: oneLine.slice(0, TASK_SHOW),
    files: files.slice(0, 3),
  };
}

// 测试文件的文件名级判据(拿不到目录,所以只认文件名里的 test/spec 标记)
const TEST_FILE = /(\.test\.|\.spec\.|_test\.)/i;

/**
 * 保守的"顺手改"判据:任务关键词命中了部分文件(说明任务描述是有效的、agent 确实
 * 在干正事),同时还有文件与任务无关 —— 这才是"干着 A 顺手改了 B"的真实签名。
 * 返回无关文件列表;null = 该 turn 不可判定(低信息任务/关键词全没对上)。
 */
export function sideEditFiles(turn: TaskTurn): string[] | null {
  if (isLowInfoTask(turn.task)) return null;
  const kws = taskKeywords(turn.task);
  if (kws.length === 0) return null;
  const related: string[] = [];
  const unrelated: string[] = [];
  for (const f of turn.filesChanged) {
    const p = f.toLowerCase();
    (kws.some((kw) => p.includes(kw)) ? related : unrelated).push(f);
  }
  // 全部无关 → 更可能是"关键词没对上文件名"(文件名比完整路径信息少),不可判定
  if (related.length === 0) return null;
  return unrelated;
}

export function buildReplayReport(opts: {
  transcripts: RepoTranscript[];
  sources: string[];
  events: GuardEvent[];
  days?: number;
  /** 注入"现在"以便测试;默认真实当前时间 */
  now?: Date;
}): ReplayReport {
  const days = Math.max(1, opts.days ?? 30);
  const now = opts.now ?? new Date();
  const sinceMs = now.getTime() - days * 24 * 3600 * 1000;

  // ── 窗口内的 turns(带上所属仓库) ──
  const turns: { turn: TaskTurn; project: string }[] = [];
  for (const rt of opts.transcripts) {
    for (const t of rt.turns) {
      if (!t.timestamp) continue; // 没时间戳无法归窗,丢弃(诚实:不猜)
      const ms = new Date(t.timestamp).getTime();
      if (Number.isNaN(ms) || ms < sinceMs || ms > now.getTime()) continue;
      turns.push({ turn: t, project: rt.project });
    }
  }

  const projects = new Set(turns.map((t) => t.project));
  const fileTouches = turns.reduce((s, t) => s + t.turn.filesChanged.length, 0);

  // ── 敏感规则触碰(文件名级) ──
  const acc = new Map<string, ReplayCategory & { _repos: Set<string> }>();
  for (const { turn, project } of turns) {
    for (const r of FILENAME_MATCHABLE) {
      const hitFiles = turn.filesChanged.filter((f) => r.test.test(f));
      if (hitFiles.length === 0) continue;
      let cat = acc.get(r.rule);
      if (!cat) {
        cat = { rule: r.rule, severity: r.severity ?? "wake-you-up", why: r.why, hits: 0, repos: 0, samples: [], _repos: new Set() };
        acc.set(r.rule, cat);
      }
      cat.hits++;
      cat._repos.add(project);
      if (cat.samples.length < SAMPLE_MAX) cat.samples.push(toSample(turn, project, hitFiles));
    }
  }
  const cats = [...acc.values()]
    .map(({ _repos, ...c }) => ({ ...c, repos: _repos.size }))
    .sort((a, b) => b.hits - a.hits);

  // ── 测试文件触碰 ──
  const testTouches = { hits: 0, samples: [] as ReplaySample[] };
  for (const { turn, project } of turns) {
    const hitFiles = turn.filesChanged.filter((f) => TEST_FILE.test(f));
    if (hitFiles.length === 0) continue;
    testTouches.hits++;
    if (testTouches.samples.length < SAMPLE_MAX) testTouches.samples.push(toSample(turn, project, hitFiles));
  }

  // ── 任务外顺手改动 ──
  const drift = { hits: 0, judgeable: 0, samples: [] as ReplaySample[] };
  for (const { turn, project } of turns) {
    const side = sideEditFiles(turn);
    if (side === null) continue;
    drift.judgeable++;
    if (side.length === 0) continue;
    drift.hits++;
    if (drift.samples.length < SAMPLE_MAX) drift.samples.push(toSample(turn, project, side));
  }

  // ── 窗口内的真实守门记录 ──
  const winEvents = opts.events.filter((e) => {
    const ms = new Date(e.timestamp).getTime();
    return !Number.isNaN(ms) && ms >= sinceMs;
  });
  let guard: ReplayReport["guard"] = null;
  if (opts.events.length > 0) {
    let wake = 0, look = 0;
    for (const e of winEvents) {
      for (const f of e.findings) {
        if (f.severity === "wake-you-up") wake++;
        else look++;
      }
    }
    guard = { scans: winEvents.length, wake, look };
  }

  const fmt = (d: Date) => localDate(d.toISOString());
  return {
    days,
    from: fmt(new Date(sinceMs)),
    to: fmt(now),
    sources: opts.sources,
    turns: turns.length,
    repos: projects.size,
    fileTouches,
    wake: cats.filter((c) => c.severity === "wake-you-up"),
    look: cats.filter((c) => c.severity === "look-once"),
    testTouches,
    drift,
    guard,
  };
}

// ── 终端渲染 ──────────────────────────────────────────────────────────

const A = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// 规则 id → 回放里的人话标签("碰过"口径,只声称文件名证据能支撑的)
const RULE_LABEL: Record<string, string> = {
  "env-file": ".env 环境变量文件被改",
  "authz-surface": "疑似鉴权/密钥/权限相关文件被改",
  "iac-terraform": "Terraform 文件被改(apply 后不可逆)",
  "container-build": "容器构建定义被改(Dockerfile 等)",
  "dependency-manifest": "依赖清单被改(供应链)",
};

function sampleLines(samples: ReplaySample[], indent: string): string[] {
  return samples.map(
    (s) => A.dim(`${indent}· ${s.date.slice(5)} ${s.project} 「${s.task}」 → ${s.files.join(", ")}`)
  );
}

export function renderReplayTerminal(r: ReplayReport): string {
  const L: string[] = [];
  L.push("");
  L.push(`  ${A.bold("agent-diff-guard replay")} · 过去 ${r.days} 天 ${A.dim(`(${r.from} ~ ${r.to})`)}`);
  L.push(A.dim(`  数据源 ${r.sources.join(", ") || "无"} · ${r.turns} 次任务 · ${r.repos} 个仓库 · ${r.fileTouches} 处文件改动`));
  L.push("");

  if (r.turns === 0) {
    L.push(A.dim("  窗口内没有观察到任何 agent 改动 —— 换个 --days 试试,或先跑 doctor 确认采集源。"));
    L.push("");
    return L.join("\n");
  }

  // wake 级:大字区。没有就明确说干净 —— "没发现"也是有价值的结论。
  if (r.wake.length > 0) {
    L.push(`  ${A.red("●")} ${A.bold("该看一眼的触碰")}`);
    for (const c of r.wake) {
      const label = RULE_LABEL[c.rule] ?? c.why;
      L.push(`    ${label} ${A.bold(String(c.hits))} 次 · ${c.repos} 个仓库  ${A.dim(`[${c.rule}]`)}`);
      L.push(...sampleLines(c.samples, "      "));
    }
    L.push("");
  } else {
    L.push(A.green("  ✓ 没有发现该半夜惊醒的触碰(.env / 鉴权密钥 / Terraform)"));
    L.push("");
  }

  // look 级 + 测试 + 顺手改:一行一条,不展开实例(--json 里有)
  const looks: string[] = [];
  for (const c of r.look) {
    looks.push(`${RULE_LABEL[c.rule] ?? c.why} ${c.hits} 次 · ${c.repos} 个仓库`);
  }
  if (r.testTouches.hits > 0) looks.push(`测试文件被改 ${r.testTouches.hits} 次`);
  if (r.drift.judgeable > 0) {
    // 词面级判据在纯文件名上偏保守上限(路径信息丢了),诚实标注,别让它冒充精确值
    looks.push(`任务外顺手改动 ${r.drift.hits} 次 / ${r.drift.judgeable} 个可判定任务(词面级粗估,偏高)`);
  }
  if (looks.length > 0) {
    L.push(`  ${A.yellow("⚖")} ${A.bold("常规但值得知道")}`);
    for (const s of looks) L.push(`    ${s}`);
    if (r.drift.samples.length > 0) L.push(...sampleLines(r.drift.samples, "    "));
    L.push("");
  }

  // 守门实录 / 没装 hook 的诚实提醒 —— 这一行是整份报告的转化点。
  // 三种状态分开说:从没扫过(没装) / 装了但窗口内没上岗 / 真在岗。
  const anyTouch = r.wake.length > 0 || r.look.length > 0;
  if (r.guard && r.guard.scans > 0) {
    L.push(A.dim(`  ✋ 守门实录:${r.guard.scans} 次扫描 · 拦下 wake ${r.guard.wake} / look ${r.guard.look}`));
  } else if (r.guard) {
    L.push(`  ${A.yellow("✋")} 守门人装过,但这 ${r.days} 天 ${A.bold("0 次上岗")}${anyTouch ? " —— 上面的触碰发生时它不在场" : ""}。`);
    L.push(A.dim("     挂回仓库:./install.sh <你的仓库>,或 loop install-hook 装编码前刹车"));
  } else {
    L.push(`  ${A.yellow("✋")} ${anyTouch ? `上面这些发生时,${A.bold("没有任何东西拦过它们")} —— ` : ""}还没装守门 hook。`);
    L.push(A.dim("     装编码前刹车:./install.sh <你的仓库>"));
  }
  L.push("");
  L.push(A.dim("  口径:本机 agent session 日志的文件名级证据 · 只读不上传 · 完整 diff 级判定走 check/hook"));
  L.push("");
  return L.join("\n");
}
