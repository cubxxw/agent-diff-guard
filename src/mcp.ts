#!/usr/bin/env bun
// mcp.ts — agent-diff-guard 的 MCP server 入口。
//
// 把守门 / 危险地图 / 规则进化洞察 / 信箱,暴露成跨 agent 的 MCP tool。
// 这一步把 agent-diff-guard 从"用户装的 CLI/面板"升级成"任何支持 MCP 的 agent
// (Claude Code / Cursor / Cline ...)自己就会调用的能力"——进入 agent 的工具箱,
// 而不只是 CI 的一环。
//
// 铁律(stdio transport):stdout 只能走 JSON-RPC 协议,任何日志必须走 stderr。
//   所以本文件只复用【纯逻辑模块】(scan/rules/context/transcript/insights/inbox),
//   绝不 import cli.ts / serve-local.ts(它们往 stdout 打人类可读输出,会破坏协议)。
//   这些纯逻辑模块内部的日志都是 console.warn(走 stderr),安全。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { spawnSync } from "node:child_process";

import { parseDiff, driftFindings } from "./scan";
import { runRules, type Finding } from "./rules";
import { buildDangerMap, renderMarkdown } from "./context";
import { readEvents } from "./logger";
import { allTranscripts } from "./transcript";
import { buildAllInsights } from "./insights";
import { listPending } from "./inbox";

/** 取某目录的 git remote 去敏标识(host+path),取不到返回 null。 */
function repoRemote(cwd: string): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  const m = r.stdout.trim().match(/(?:@|:\/\/)([^/:]+)[/:](.+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** 统一返回纯文本 content。 */
function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const server = new McpServer({ name: "agent-diff-guard", version: "0.0.1" });

// ── Tool 1: check_diff_risk ──────────────────────────────────────────
// agent 写完一段后自己调:把当前改动跑一遍守门规则,拿回结构化风险。
server.registerTool(
  "check_diff_risk",
  {
    title: "检查改动风险",
    description:
      "Scan the current git changes in a repository and return which of them are risky enough to require human attention before merge — CI/CD pipeline edits, hardcoded secrets, deleted tests, dependency manifest changes, infra/IaC, auth surfaces. Use this RIGHT AFTER you finish making code changes, before suggesting the user commit or push. Returns a concise list of only the 1-3 most important findings (philosophy: surface only what would wake someone up at night, never spam). If a task description is given, also flags changes unrelated to that task (scope drift).",
    inputSchema: {
      cwd: z.string().optional().describe("Repository directory to check. Defaults to the server's working directory."),
      range: z.string().optional().describe("Git range to inspect, e.g. 'HEAD' (default, current staged+unstaged) or '@{u}..HEAD'."),
      task: z.string().optional().describe("What you were asked to do this session. Enables task-vs-change drift detection."),
    },
  },
  async ({ cwd, range, task }) => {
    const dir = cwd || process.cwd();
    const r = range || "HEAD";
    let findings: Finding[];
    try {
      const changes = parseDiff(r, dir);
      findings = [...runRules(changes), ...driftFindings(changes, task)];
    } catch (e) {
      return text(`无法读取 git diff(${dir} @ ${r}):${(e as Error).message}`);
    }
    const wake = findings.filter((f) => f.severity === "wake-you-up");
    const look = findings.filter((f) => f.severity === "look-once");
    if (wake.length === 0 && look.length === 0) {
      return text("✓ 这批改动没有该半夜惊醒的东西,可以放行。");
    }
    const lines: string[] = [];
    if (wake.length) {
      lines.push(`⚠ ${wake.length} 处合并前请看一眼:`);
      for (const f of wake.slice(0, 3)) {
        lines.push(`  ● ${f.path} [${f.rule}] — ${f.why}`);
        if (f.evidence) lines.push(`    ↳ ${f.evidence}`);
      }
      if (wake.length > 3) lines.push(`  …另有 ${wake.length - 3} 处同级`);
    }
    if (look.length) {
      lines.push(`⚖ ${look.length} 处任务范围外的改动(供参考):${look.slice(0, 5).map((f) => f.path).join(", ")}`);
    }
    return text(lines.join("\n"));
  }
);

// ── Tool 2: get_repo_danger_map ──────────────────────────────────────
// agent 编码前调:拿这个仓库的危险地图,改之前就避开雷。
server.registerTool(
  "get_repo_danger_map",
  {
    title: "本仓库危险地图",
    description:
      "Get the danger map for a repository BEFORE you start editing: which file areas (CI, containers, IaC, K8s, env files, dependency manifests, auth) will trigger a merge-time guard, plus this repo's actual history of past guard hits. Use this at the start of a coding task so you know which areas to avoid or to justify before touching. Returns markdown suitable to keep in mind while working.",
    inputSchema: {
      cwd: z.string().optional().describe("Repository directory. Defaults to the server's working directory."),
    },
  },
  async ({ cwd }) => {
    const dir = cwd || process.cwd();
    const map = buildDangerMap({ repo: repoRemote(dir), events: readEvents() });
    return text(renderMarkdown(map));
  }
);

// ── Tool 3: get_rule_insights ────────────────────────────────────────
// 让 agent 反思:在各仓库里反复触碰哪些危险区、当时任务是什么(已脱敏)。
server.registerTool(
  "get_rule_insights",
  {
    title: "规则进化洞察",
    description:
      "Get learned insights about which guard rules fire most in each repository and what the agent was trying to do at the time (secrets are redacted before they leave the machine). Use this to understand whether a guard rule is genuinely catching risk or is just noise in a given repo — e.g. if env-file is always touched during legitimate config tasks, it may be over-strict there. Returns per-repo evidence (rule, hit count, sample tasks, sample files). Note: first call scans local session logs and may take a few seconds.",
    inputSchema: {
      repo: z.string().optional().describe("Optional repo path substring to filter to one repository (e.g. 'owner/repo')."),
    },
  },
  async ({ repo }) => {
    let insights = buildAllInsights(allTranscripts());
    if (repo) {
      const tail = repo.split("/").filter(Boolean).slice(-2).join("/").toLowerCase();
      insights = insights.filter((ri) => ri.project.toLowerCase().includes(tail));
    }
    if (insights.length === 0) return text("还没有足够的'任务→改动'历史可分析(或没匹配到该仓库)。");
    const out: string[] = [];
    for (const ri of insights.slice(0, 8)) {
      out.push(`## ${ri.project.split("/").slice(-2).join("/")}(${ri.turnCount} 轮)`);
      for (const e of ri.evidence) {
        out.push(`- ${e.rule}:碰 ${e.hitCount} 次,文件如 [${e.sampleFiles.join(", ")}]`);
        if (e.sampleTasks.length) out.push(`  典型任务:${e.sampleTasks.map((t) => t.replace(/\s+/g, " ").slice(0, 50)).join(" | ")}`);
      }
    }
    return text(out.join("\n"));
  }
);

// ── Tool 4: list_pending_decisions ───────────────────────────────────
// agent 读面板下发的决策:把"面板→终端"闭环接进 agent 自己的循环。
server.registerTool(
  "list_pending_decisions",
  {
    title: "待处理决策",
    description:
      "List pending decisions that a human queued from the agent-diff-guard dashboard for the terminal agent to act on (e.g. 'downgrade this rule in this repo', 'review this directory'). Use this to pick up human-in-the-loop instructions. Each item has an id, a title, and an actionable instruction. After acting on one, archive it via the CLI `agent-diff-guard inbox --done <id>`.",
    inputSchema: {},
  },
  async () => {
    const items = listPending();
    if (items.length === 0) return text("信箱为空 —— 面板还没下发任何决策。");
    const out = items.map((it) => `▸ [${it.id}] ${it.title}\n  指令:${it.action}`);
    return text(`${items.length} 条待处理决策:\n\n${out.join("\n\n")}`);
  }
);

// ── 启动:stdio transport ─────────────────────────────────────────────
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 日志走 stderr,绝不污染 stdout 的 JSON-RPC。
  console.error("[agent-diff-guard mcp] server running on stdio");
}

main().catch((e) => {
  console.error("[agent-diff-guard mcp] fatal:", e);
  process.exit(1);
});
