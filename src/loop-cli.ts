import {
  startSession,
  loadSession,
  stopSession,
  listSessions,
  activeSessionForCwd,
} from "./loop/session";
import { checkIteration } from "./loop/check";
import { generateReport, renderReport, reportToJson } from "./loop/report";
import {
  generateAcceptanceReport,
  renderAcceptanceReport,
  acceptanceReportToJson,
} from "./loop/verify";
import { pushReport, type PushChannel } from "./loop/report-push";
import { adapterConfig, type SupportedAgent } from "./loop/adapters";

const C = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseBudget(raw: string): number {
  const lower = raw.toLowerCase().trim();
  if (lower.endsWith("m")) return parseFloat(lower) * 1_000_000;
  if (lower.endsWith("k")) return parseFloat(lower) * 1_000;
  return parseInt(raw, 10);
}

const LOOP_HELP = `agent-diff-guard loop — Loop 验证层

子命令:
  start   --goal "<目标>" [--budget 500k] [--mode attended|unattended] [--cwd .]
          启动新的 loop session

  check   [--session <id>] [--task "<描述>"] [--json]
          对当前迭代执行一次完整检查

  status  [--session <id>] [--json]
          查看 session 状态

  report  [--session <id>] [--json]
          生成晨报

  verify  [--session <id>] [--json]
          结尾验收闸门:汇总整个 session 的 drift / wake findings / policy /
          预算,给出 pass / needs-review 的边界裁决(对齐"结尾验安全/结果")

  morning [--push macos,webhook] [--webhook <url>] [--all] [--json]
          为 active session 生成晨报,可选推送到 macOS 通知 / webhook

  stop    [--session <id>]
          停止 session

  list    [--json]
          列出所有 sessions

  install-hook [--agent claude|cursor|codex|copilot] [--cli <path>]
          输出指定 agent 的守门集成配置(默认 claude)

  --help  显示本帮助
`;

export async function handleLoopCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(LOOP_HELP);
    return;
  }

  if (sub === "start") {
    const goal = parseFlag(args, "--goal");
    if (!goal) {
      console.error(C.red("--goal 必填"));
      process.exit(2);
    }
    const budgetRaw = parseFlag(args, "--budget");
    const budgetTokens = budgetRaw ? parseBudget(budgetRaw) : undefined;
    const mode = (parseFlag(args, "--mode") as "attended" | "unattended") ?? "attended";
    const cwd = parseFlag(args, "--cwd") ?? process.cwd();

    const session = await startSession({ goal, cwd, budgetTokens, mode });
    console.log(C.green(`✓ Loop session started: ${session.id}`));
    console.log(C.dim(`  goal: ${goal}`));
    console.log(C.dim(`  cwd: ${cwd}`));
    if (budgetTokens) console.log(C.dim(`  budget: ${budgetTokens.toLocaleString()} tokens`));
    return;
  }

  if (sub === "check") {
    const cwd = parseFlag(args, "--cwd") ?? process.cwd();
    const sessionId = parseFlag(args, "--session") ?? activeSessionForCwd(cwd)?.id;
    if (!sessionId) {
      console.error(C.red("No active session found. Use --session <id> or start one first."));
      process.exit(2);
    }
    const task = parseFlag(args, "--task");
    const json = hasFlag(args, "--json");

    const result = await checkIteration({ sessionId, task });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const icon = result.verdict === "pass" ? C.green("✓") : result.verdict === "warn" ? C.yellow("⚠") : C.red("✗");
      console.log(`${icon} Iteration ${result.iteration}: ${C.bold(result.verdict)}`);
      for (const r of result.verdictReasons) console.log(C.dim(`  ${r}`));
    }

    if (result.verdict === "block") process.exit(1);
    return;
  }

  if (sub === "status") {
    const cwd = parseFlag(args, "--cwd") ?? process.cwd();
    const sessionId = parseFlag(args, "--session") ?? activeSessionForCwd(cwd)?.id;
    if (!sessionId) {
      console.error(C.red("No active session found."));
      process.exit(2);
    }
    const session = loadSession(sessionId);
    if (!session) {
      console.error(C.red(`Session ${sessionId} not found.`));
      process.exit(2);
    }
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(session, null, 2));
    } else {
      console.log(C.bold(`Session: ${session.id}`));
      console.log(`  Status: ${session.status}`);
      console.log(`  Iterations: ${session.iterationCount}`);
      console.log(`  Drift: ${(session.cumulativeDrift * 100).toFixed(0)}%`);
      console.log(`  Goal: ${session.goal}`);
    }
    return;
  }

  if (sub === "report") {
    const cwd = parseFlag(args, "--cwd") ?? process.cwd();
    const sessionId = parseFlag(args, "--session") ?? activeSessionForCwd(cwd)?.id;
    if (!sessionId) {
      console.error(C.red("No active session found."));
      process.exit(2);
    }
    const session = loadSession(sessionId);
    if (!session) {
      console.error(C.red(`Session ${sessionId} not found.`));
      process.exit(2);
    }
    const report = generateReport(session);
    if (hasFlag(args, "--json")) {
      console.log(reportToJson(report));
    } else {
      console.log(renderReport(report));
    }
    return;
  }

  if (sub === "verify") {
    const cwd = parseFlag(args, "--cwd") ?? process.cwd();
    const sessionId = parseFlag(args, "--session") ?? activeSessionForCwd(cwd)?.id;
    if (!sessionId) {
      console.error(C.red("No active session found."));
      process.exit(2);
    }
    const session = loadSession(sessionId);
    if (!session) {
      console.error(C.red(`Session ${sessionId} not found.`));
      process.exit(2);
    }
    const acceptance = generateAcceptanceReport(session);
    if (hasFlag(args, "--json")) {
      console.log(acceptanceReportToJson(acceptance));
    } else {
      const icon = acceptance.verdict === "pass" ? C.green("✓") : C.yellow("⚠");
      console.log(`${icon} ${renderAcceptanceReport(acceptance)}`);
    }
    // Boundary ruling: non-zero exit when the session needs human review.
    if (acceptance.verdict === "needs-review") process.exit(1);
    return;
  }

  if (sub === "morning") {
    const all = hasFlag(args, "--all");
    const pushRaw = parseFlag(args, "--push");
    const webhookUrl = parseFlag(args, "--webhook");
    const json = hasFlag(args, "--json");

    const targets = all
      ? listSessions().filter((s) => s.status === "active")
      : (() => {
          const cwd = parseFlag(args, "--cwd") ?? process.cwd();
          const sessionId = parseFlag(args, "--session") ?? activeSessionForCwd(cwd)?.id;
          const s = sessionId ? loadSession(sessionId) : null;
          return s ? [s] : [];
        })();

    if (targets.length === 0) {
      console.error(C.red("No matching session. Try --all or --session <id>."));
      process.exit(2);
    }

    const channels: PushChannel[] = [];
    if (pushRaw) {
      for (const kind of pushRaw.split(",").map((x) => x.trim())) {
        if (kind === "macos") channels.push({ kind: "macos" });
        else if (kind === "webhook" && webhookUrl) channels.push({ kind: "webhook", url: webhookUrl });
        else if (kind === "stdout") channels.push({ kind: "stdout" });
      }
    }

    const outputs = [];
    for (const session of targets) {
      const report = generateReport(session);
      const pushResults = channels.length > 0 ? await pushReport(report, channels) : [];
      outputs.push({ sessionId: session.id, report, pushResults });
    }

    if (json) {
      console.log(JSON.stringify(outputs, null, 2));
    } else {
      for (const o of outputs) {
        console.log(renderReport(o.report));
        if (o.pushResults.length > 0) {
          console.log(C.dim("Pushed:"));
          for (const r of o.pushResults) {
            const icon = r.ok ? C.green("✓") : C.red("✗");
            console.log(C.dim(`  ${icon} ${r.channel}${r.reason ? ` — ${r.reason}` : ""}`));
          }
        }
        console.log("");
      }
    }
    return;
  }

  if (sub === "stop") {
    const cwd = parseFlag(args, "--cwd") ?? process.cwd();
    const sessionId = parseFlag(args, "--session") ?? activeSessionForCwd(cwd)?.id;
    if (!sessionId) {
      console.error(C.red("No active session found."));
      process.exit(2);
    }
    const ok = stopSession(sessionId);
    if (ok) {
      console.log(C.green(`✓ Session ${sessionId} stopped.`));
    } else {
      console.error(C.red(`Session ${sessionId} not found.`));
      process.exit(2);
    }
    return;
  }

  if (sub === "list") {
    const sessions = listSessions();
    if (hasFlag(args, "--json")) {
      console.log(JSON.stringify(sessions, null, 2));
    } else if (sessions.length === 0) {
      console.log(C.dim("No loop sessions found."));
    } else {
      console.log(C.bold(`Loop sessions (${sessions.length}):\n`));
      for (const s of sessions) {
        const icon = s.status === "active" ? C.green("●") : s.status === "emergency-braked" ? C.red("●") : C.dim("○");
        console.log(`  ${icon} ${s.id}  ${C.dim(s.status)}  ${C.dim(s.goal.slice(0, 50))}`);
      }
    }
    return;
  }

  if (sub === "install-hook") {
    const agentRaw = parseFlag(args, "--agent") ?? "claude";
    const validAgents: SupportedAgent[] = ["claude", "cursor", "codex", "copilot"];
    if (!validAgents.includes(agentRaw as SupportedAgent)) {
      console.error(C.red(`Unknown --agent: ${agentRaw}. Supported: ${validAgents.join(", ")}`));
      process.exit(2);
    }
    const guardCliPath = parseFlag(args, "--cli") ?? "src/loop/hook.ts";
    const cfg = adapterConfig(agentRaw as SupportedAgent, guardCliPath);
    console.log(C.dim(cfg.instructions));
    console.log("");
    console.log(cfg.configSnippet);
    return;
  }

  console.error(C.red(`Unknown loop subcommand: ${sub}`));
  console.log(LOOP_HELP);
  process.exit(2);
}

// 直接 `bun run src/loop-cli.ts <sub>` 也能用(此前缺入口块 → 静默 exit 0,新人撞墙)。
// 主入口仍是 `cli.ts loop <sub>`;这里只是让独立运行也走同一派发。
if (import.meta.main) {
  handleLoopCommand(process.argv.slice(2)).catch((e) => {
    console.error(C.red(String(e?.message ?? e)));
    process.exit(1);
  });
}
