// runner.ts — 常驻执行 daemon 的编排核心。
//
// 一条决策的生命周期(processOne):
//   pending → [PAUSE? 暂停] → classify 安全分级
//           → blocked? 转 blocked 队列(不执行)
//           → auto:  影子告警(首见新命令) → 按 kind 路由执行 → 写 run 留痕
//                    → 追加 events.jsonl → markDone 归档
//
// 安全护栏(全内建):
//   - PAUSE kill-switch:~/.agent-diff-guard/PAUSE 存在 → 只观察不执行
//   - 黑名单(classify):破坏性命令一律拦成 blocked
//   - 串行:runDaemon 一次只处理一条,绝不并发改同一仓库
//   - 超时/截断:executor 内建
//   - 全程留痕:runs/ + events.jsonl,面板与 cli 可见

import { join } from "node:path";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { logDir } from "./logger";
import { listPending, markDone, type InboxItem } from "./inbox";
import { classify, detectKind, type Kind } from "./classify";
import { runShell, runClaude as realRunClaude, type ExecResult } from "./executor";
import { writeRun, markBlocked, isFirstSeen, rememberCommand } from "./runlog";

export type Outcome = "executed" | "blocked" | "paused" | "failed";

export interface ProcessResult {
  inboxId: string;
  outcome: Outcome;
  /** blocked 的拦截理由 / failed 的错误 / executed 的简述 */
  reason: string;
  exitCode?: number;
}

/** 依赖注入口:测试可替换执行器,避免真的 spawn claude/bash。 */
export interface Deps {
  runShell?: (action: string) => Promise<ExecResult>;
  runClaude?: (prompt: string) => Promise<ExecResult>;
  /** 注入时间,保持项目「可复现」惯例 */
  nowMs?: () => number;
}

function paused(): boolean {
  return existsSync(join(logDir(), "PAUSE"));
}

/**
 * 处理一条决策。纯编排 + 落痕,执行器可注入。
 * 不抛异常:任何失败都收敛为 outcome=failed 并留痕,daemon 主循环不被一条坏指令掀翻。
 */
export async function processOne(item: InboxItem, deps: Deps = {}): Promise<ProcessResult> {
  const now = deps.nowMs ?? Date.now;

  // 0. kill-switch:暂停时原地不动,留在 pending
  if (paused()) {
    return { inboxId: item.id, outcome: "paused", reason: "PAUSE 文件存在,daemon 暂停执行" };
  }

  // 1. 安全分级 —— 黑名单先行
  const verdict = classify(item.action, { kind: item.kind });
  if (verdict.verdict === "blocked") {
    markBlocked(item.id, verdict.reason, now());
    logRunEvent("blocked", item, { reason: verdict.reason });
    return { inboxId: item.id, outcome: "blocked", reason: verdict.reason };
  }

  // 2. 影子告警:首次见到的新命令前缀,先告警再跑(黑名单追不全,可观测性补)
  if (isFirstSeen(item.action)) {
    logRunEvent("new_command", item, { note: "首次自动执行此前未见过的命令前缀" });
  }
  rememberCommand(item.action);

  // 3. 按 kind 路由执行
  const kind: Kind = detectKind(item.action, item.kind);
  let res: ExecResult;
  try {
    if (kind === "agent") {
      const run = deps.runClaude ?? ((p: string) => realRunClaude(p));
      res = await run(item.action);
    } else {
      const run = deps.runShell ?? ((a: string) => runShell(a));
      res = await run(item.action);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    logRunEvent("exec_failed", item, { reason });
    return { inboxId: item.id, outcome: "failed", reason };
  }

  // 4. 留痕 + 归档
  writeRun({
    inboxId: item.id, title: item.title, action: item.action, kind,
    exitCode: res.exitCode, durationMs: res.durationMs,
    stdout: res.stdout, stderr: res.stderr, timedOut: res.timedOut,
    nowMs: now(),
  });
  logRunEvent("executed", item, { note: `exit=${res.exitCode}${res.timedOut ? " 超时" : ""} ${kind}` });
  markDone(item.id);

  const outcome: Outcome = res.exitCode === 0 ? "executed" : "failed";
  return { inboxId: item.id, outcome, reason: res.timedOut ? "执行超时被终止" : "", exitCode: res.exitCode };
}

/**
 * 追加一条 run 审计事件到 run-events.jsonl(与守门用的 events.jsonl 分开,
 * 形状不同、互不污染)。失败只吞不抛,绝不影响主流程。
 */
function logRunEvent(kind: string, item: InboxItem, extra: { reason?: string; note?: string }): void {
  try {
    mkdirSync(logDir(), { recursive: true });
    const line = JSON.stringify({
      source: "run-daemon",
      kind,
      inboxId: item.id,
      title: item.title,
      action: item.action,
      reason: extra.reason,
      note: extra.note,
      at: new Date().toISOString(),
    }) + "\n";
    appendFileSync(join(logDir(), "run-events.jsonl"), line, "utf8");
  } catch {
    // 留痕失败不致命
  }
}

export interface DaemonOpts {
  /** 轮询间隔(毫秒),默认 2000 */
  pollMs?: number;
  /** 只处理一轮当前 pending 就返回(给 launchd/cron / --once 用) */
  once?: boolean;
  /** 干跑:只分级和打印,不真的执行 */
  dryRun?: boolean;
  /** 每处理一条的回调(打印进度用) */
  onResult?: (r: ProcessResult, item: InboxItem) => void;
  /** 外部停止信号 */
  signal?: AbortSignal;
}

/**
 * 常驻循环。串行处理 pending 队列,处理空了就 sleep pollMs 再看。
 * once=true 时处理完当前快照就返回(返回本轮结果),便于测试与 cron 模式。
 */
export async function runDaemon(opts: DaemonOpts = {}): Promise<ProcessResult[]> {
  const pollMs = opts.pollMs ?? 2000;
  const results: ProcessResult[] = [];
  // dry-run 只是「看一眼会怎么分级」,天然是一次性自检 —— 它不改 pending,
  // 若放进常驻循环会无限重读同一批决策。故 dry-run 强制单轮。
  const singlePass = opts.once || opts.dryRun;

  do {
    if (opts.signal?.aborted) break;
    const pending = listPending();
    if (pending.length === 0) {
      if (singlePass) break;
      await sleep(pollMs, opts.signal);
      continue;
    }
    for (const item of pending) {
      if (opts.signal?.aborted) break;
      if (opts.dryRun) {
        const v = classify(item.action, { kind: item.kind });
        const r: ProcessResult = {
          inboxId: item.id,
          outcome: v.verdict === "blocked" ? "blocked" : "executed",
          reason: v.reason || "(将自动执行)",
        };
        results.push(r);
        opts.onResult?.(r, item);
        continue;
      }
      const r = await processOne(item);
      results.push(r);
      opts.onResult?.(r, item);
    }
  } while (!singlePass);

  return results;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
