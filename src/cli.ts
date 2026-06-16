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

import { spawnSync } from "node:child_process";
import { parseDiff, driftFindings } from "./scan";
import { runRules, type Finding } from "./rules";
import { buildEvent } from "./event";
import { appendEvent } from "./logger";
import pkg from "../package.json" with { type: "json" };

interface Args { range: string; task?: string; max: number; }

const HELP = `agent-diff-guard — 合并前的 agent 改动守门人

当 agent 在你没盯着时改了该看一眼的东西(CI/密钥/删测试/任务外顺手改),
在合并前把那 1-3 处拎到你眼前逼一次确认。平时放行,关键时刻刹车。

用法:
  agent-diff-guard check [选项]      扫一次改动(默认行为)
  agent-diff-guard serve [--port N]  启动本地审计面板(读历史守门记录)
  agent-diff-guard context [--json]  输出本仓库"危险地图",供 agent 编码前读取
  agent-diff-guard inbox [--json]    读取面板下发的决策指令(供终端 Claude Code 消费)
                                     [--done <id>] 标记某条已处理并归档
  agent-diff-guard run [选项]        常驻执行 daemon:把信箱里的决策真的跑起来
                                     全自动 + 黑名单保险丝(破坏性命令拦成待批)
                                     [--once] 单轮 [--dry-run] 只分级不执行
                                     [--poll N] 轮询毫秒 [--status] 看概况
  agent-diff-guard loop [子命令]     Loop 验证层:start/check/status/report/stop/list

选项:
  --range <git-range>   要检查的范围 (默认: HEAD,即已暂存+未暂存的当前改动)
                        常用: "@{u}..HEAD" 检查领先远端的改动
  --task "<一句话>"      本次声称的任务,用于"任务 vs 实际改动"偏离检测
  --max <N>             最多拎出几处 wake-you-up 发现 (默认: 3,绝不刷屏)
  -h, --help            显示本帮助

退出码:
  0  放行 (没有该半夜惊醒的改动)
  1  刹车 (有 wake-you-up 级发现,该看一眼 —— git hook 据此阻断)
  2  用法/读取错误

示例:
  agent-diff-guard check --range HEAD --task "重构登录表单"
  ./install.sh /path/to/your/repo        # 装成 pre-push hook,push 前自动刹车
  agent-diff-guard context > .agent-guard.md   # 生成危险地图,喂给 agent 当编码前输入`;

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

/** 取 git remote origin 的去敏标识(host+path,剥掉协议与可能的 token)。取不到返回 null。 */
function repoRemote(): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const url = r.stdout.trim();
  // git@github.com:owner/repo.git  或  https://[token@]github.com/owner/repo.git
  const m = url.match(/(?:@|:\/\/)([^/:]+)[/:](.+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const cmd = rawArgs[0];

  // 无参 或 -h/--help → 显示帮助并退出(别让第一次用的人面对静默扫描)
  if (rawArgs.length === 0 || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    process.exit(0);
  }

  // serve 子命令:启动本地审计面板(懒加载,check 路径不付出 server 代价)
  if (cmd === "serve") {
    const pi = rawArgs.indexOf("--port");
    const port = pi >= 0 ? parseInt(rawArgs[pi + 1] ?? "4757", 10) || 4757 : 4757;
    const { startLocalServer } = await import("./serve-local");
    startLocalServer(port);
    return; // server 常驻,不退出
  }

  // context 子命令:把守门人翻转成"编码前输入端"——输出本仓库危险地图。
  // 默认 markdown(给 agent prompt),--json 给程序消费。懒加载,不拖累 check 路径。
  if (cmd === "context") {
    const asJson = rawArgs.includes("--json");
    const { readEvents } = await import("./logger");
    const { buildDangerMap, renderMarkdown, toJson } = await import("./context");
    const map = buildDangerMap({ repo: repoRemote(), events: readEvents() });
    console.log(asJson ? toJson(map) : renderMarkdown(map));
    process.exit(0);
  }

  // inbox 子命令:终端侧消费面板下发的决策指令。这是"面板 → 终端 Claude Code"闭环的终端端。
  // 默认列出 pending;--done <id> 归档一条;--json 给程序/agent 消费。
  if (cmd === "inbox") {
    const { listPending, markDone } = await import("./inbox");
    const doneIdx = rawArgs.indexOf("--done");
    if (doneIdx >= 0) {
      const id = rawArgs[doneIdx + 1];
      if (!id) { console.error("--done 需要一个指令 id"); process.exit(2); }
      const ok = markDone(id);
      console.log(ok ? `已归档:${id}` : `未找到待处理指令:${id}`);
      process.exit(ok ? 0 : 2);
    }
    const items = listPending();
    if (rawArgs.includes("--json")) {
      console.log(JSON.stringify(items, null, 2));
      process.exit(0);
    }
    if (items.length === 0) {
      console.log(C.dim("信箱为空 —— 面板还没下发任何决策。"));
      process.exit(0);
    }
    console.log(C.bold(`\n  面板下发的决策(${items.length} 条待处理):\n`));
    for (const it of items) {
      console.log(`  ${C.yellow("▸")} ${C.bold(it.title)}  ${C.dim("[" + it.id + "]")}`);
      console.log(`    ${it.action}`);
      console.log(C.dim(`    处理后:agent-diff-guard inbox --done ${it.id}\n`));
    }
    process.exit(0);
  }

  // run 子命令:常驻执行 daemon。把面板下发的 pending 决策真的跑起来。
  //   全自动 + 黑名单保险丝:只读/可逆命令自动执行,破坏性命令拦成 blocked 待人工放行。
  //   --once    处理完当前 pending 就退出(给 launchd/cron)
  //   --dry-run 只分级打印,不真执行(上线前自检:哪些会跑、哪些被拦)
  //   --poll N  轮询间隔毫秒(默认 2000)
  //   --status  打印执行留痕与 blocked 队列概况后退出
  if (cmd === "run") {
    const { runDaemon } = await import("./runner");

    if (rawArgs.includes("--status")) {
      const { listRuns, listBlocked } = await import("./runlog");
      const runs = listRuns();
      const blocked = listBlocked();
      console.log(C.bold(`\n  run daemon 概况\n`));
      console.log(`  已执行留痕:${runs.length} 条`);
      console.log(`  被拦待批:  ${blocked.length} 条`);
      for (const b of blocked) {
        console.log(`    ${C.yellow("⊘")} ${C.bold(b.title)}  ${C.dim("[" + b.id + "]")}`);
        console.log(`      ${b.action}`);
        console.log(C.dim(`      拦截理由:${b.blockedReason}`));
        console.log(C.dim(`      确认无害后放行:把 inbox/blocked/${b.id}.json 移回 inbox/pending/\n`));
      }
      process.exit(0);
    }

    const once = rawArgs.includes("--once");
    const dryRun = rawArgs.includes("--dry-run");
    const pollIdx = rawArgs.indexOf("--poll");
    const pollMs = pollIdx >= 0 ? parseInt(rawArgs[pollIdx + 1] ?? "2000", 10) || 2000 : 2000;

    const mode = dryRun ? C.yellow("DRY-RUN(只分级,不执行)") : once ? "单轮" : "常驻";
    console.log(C.bold(`\n  agent-diff-guard 执行 daemon · ${mode}`));
    console.log(C.dim(`  策略:全自动 + 黑名单保险丝 · 暂停请 touch ~/.agent-diff-guard/PAUSE · Ctrl-C 退出\n`));

    // Ctrl-C 优雅退出:让当前正在跑的那条完成,不再取下一条
    const ac = new AbortController();
    process.on("SIGINT", () => { console.log(C.dim("\n  收到退出信号,处理完当前一条后停止…")); ac.abort(); });

    await runDaemon({
      once, dryRun, pollMs, signal: ac.signal,
      onResult: (r, item) => {
        const tag = r.outcome === "executed" ? C.green("✓ 执行")
          : r.outcome === "blocked" ? C.yellow("⊘ 拦截")
          : r.outcome === "paused" ? C.dim("⏸ 暂停")
          : C.red("✗ 失败");
        console.log(`  ${tag}  ${C.bold(item.title)} ${C.dim("[" + item.id + "]")}`);
        console.log(C.dim(`        ${item.action}`));
        if (r.reason) console.log(C.dim(`        ${r.reason}`));
      },
    });

    if (once || dryRun) {
      console.log(C.dim("\n  本轮处理完毕。\n"));
      process.exit(0);
    }
    return;
  }

  if (cmd === "loop") {
    const { handleLoopCommand } = await import("./loop-cli");
    await handleLoopCommand(rawArgs.slice(1));
    return;
  }

  // 给了一个不认识的子命令(既不是 check/serve/context/inbox/run/loop 也不是 flag)→ 用法错误
  if (cmd && !cmd.startsWith("-") && cmd !== "check") {
    console.error(`未知命令: ${cmd}\n`);
    console.error(HELP);
    process.exit(2);
  }

  const args = parseArgs(rawArgs);

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

  // 落一条审计事件(只记元数据,不记代码正文)。失败不影响守门退出码。
  try {
    const event = await buildEvent({
      cliVersion: pkg.version,
      gitRange: args.range,
      task: args.task,
      changes,
      findings,
      disposition: hasWake ? "blocked" : "auto-pass",
      repoRemote: repoRemote(),
    });
    appendEvent(event);
  } catch (e) {
    console.warn("[adg] 审计事件构造失败(不影响守门结果):", (e as Error).message);
  }

  process.exit(hasWake ? 1 : 0);
}

main();
