#!/usr/bin/env bun
// cli.ts — agent-diff-guard 入口。
//
// 它不是 dashboard("展示所有 agent 状态")。它是守门人:
// 当 agent 在你没盯着时改了该让你看一眼的东西,它在合并前把那 1-3 处拎出来,逼一次确认。
// 平时安静放行,关键时刻刹车。
//
// 用法:
//   agent-diff-guard check [--range <git-range>] [--task "<本次任务描述>"] [--max N]
//   退出码 0 = 放行;1 = 有 wake-you-up 级发现,该看一眼(可用于 git hook 阻断)。

import { parseDiff, driftFindings } from "./scan";
import { runRules, type Finding } from "./rules";

interface Args { range: string; task?: string; max: number; }

function parseArgs(argv: string[]): Args {
  const a: Args = { range: "HEAD", max: 3 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    // 取下一个参数作为 flag 的值;缺失时退回 undefined,由各分支自行兜底。
    const next = (): string | undefined => argv[++i];
    if (v === "--range") a.range = next() ?? a.range;
    else if (v === "--task") a.task = next();
    else if (v === "--max") a.max = Math.max(1, parseInt(next() ?? "3", 10) || 3);
  }
  return a;
}

const C = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

function render(findings: Finding[], max: number): void {
  const wake = findings.filter((f) => f.severity === "wake-you-up");
  const look = findings.filter((f) => f.severity === "look-once");

  if (wake.length === 0 && look.length === 0) {
    console.log(C.green("✓ agent-diff-guard: 这批改动没有该半夜惊醒的东西,放行。"));
    return;
  }

  console.log(C.bold("\n  agent-diff-guard — 合并前请看一眼\n"));

  // 宁可漏不可烦:只推最该看的 max 条 wake-you-up
  const shown = wake.slice(0, max);
  for (const f of shown) {
    console.log(`  ${C.red("●")} ${C.bold(f.path)}  ${C.dim("[" + f.rule + "]")}`);
    console.log(`    ${f.why}`);
    if (f.evidence) console.log(`    ${C.dim("↳ " + f.evidence)}`);
    console.log();
  }
  if (wake.length > shown.length) {
    console.log(C.dim(`  …另有 ${wake.length - shown.length} 处同级改动(--max 调整显示数)\n`));
  }

  // 偏离单独成块,弱提示,不抢戏
  if (look.length > 0) {
    console.log(C.yellow(`  ⚖ 任务范围外的改动(${look.length} 处,供参考):`));
    for (const f of look.slice(0, 5)) console.log(`    ${C.dim("· " + f.path)}`);
    console.log();
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cmd = process.argv[2];
  if (cmd && !cmd.startsWith("--") && cmd !== "check") {
    console.error('usage: agent-diff-guard check [--range <git-range>] [--task "..."] [--max N]');
    process.exit(2);
  }

  let changes;
  try {
    changes = parseDiff(args.range, process.cwd());
  } catch (e) {
    console.error(C.red("agent-diff-guard: 读取 git diff 失败 — ") + (e as Error).message);
    process.exit(2);
  }

  const findings = [...runRules(changes), ...driftFindings(changes, args.task)];
  render(findings, args.max);

  const hasWake = findings.some((f) => f.severity === "wake-you-up");
  process.exit(hasWake ? 1 : 0);
}

main();
