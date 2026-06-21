/**
 * adapters.ts — Cross-agent neutral integration adapters for agent-diff-guard.
 *
 * agent-diff-guard acts as a neutral gatekeeper that works with multiple AI coding
 * agents (Claude Code, Cursor, Codex, GitHub Copilot). Each adapter generates the
 * configuration snippet required to hook agent-diff-guard into that agent's workflow.
 */

/** All supported AI coding agents. */
export type SupportedAgent = "claude" | "cursor" | "codex" | "copilot";

/** Result returned by adapterConfig for a given agent. */
export interface AdapterResult {
  agent: SupportedAgent;
  /** Human-readable installation instructions. */
  instructions: string;
  /** The raw configuration/snippet to paste or write to disk. */
  configSnippet: string;
}

// ---------------------------------------------------------------------------
// Per-agent snippet generators
// ---------------------------------------------------------------------------

/** 由 PostToolUse 的 guard 路径推导 PreToolUse 的 pretool 路径(同目录,换文件名)。 */
export function preToolPathFrom(guardCliPath: string): string {
  // .../src/loop/hook.ts → .../src/loop/pretool.ts;不含目录时直接换名。
  const idx = Math.max(guardCliPath.lastIndexOf("/"), guardCliPath.lastIndexOf("\\"));
  const dir = idx >= 0 ? guardCliPath.slice(0, idx + 1) : "";
  return `${dir}pretool.ts`;
}

/**
 * 把 guardCliPath 解析成【绝对路径】—— Claude Code hook 在【目标仓库根目录】执行,
 * 相对路径(src/loop/hook.ts)在那儿根本不存在,会让整个 hook 静默失效。
 * 已是绝对路径就原样返回;相对路径则相对本仓库根(adapters.ts 在 src/loop/,
 * 仓库根 = ../..)解析。这是 install-hook"复制粘贴就能用"的前提。
 */
export function resolveGuardPath(guardCliPath: string): string {
  if (guardCliPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(guardCliPath)) {
    return guardCliPath; // 已是绝对路径(POSIX / Windows)
  }
  // import.meta.dir = .../src/loop;仓库根 = 上两级。拼上相对 guardCliPath。
  const repoRoot = import.meta.dir.replace(/[\\/]src[\\/]loop$/, "");
  const rel = guardCliPath.replace(/^\.?[\\/]/, "");
  return `${repoRoot}/${rel}`;
}

/** cli.ts 的绝对路径(cursor/codex 要的是 `cli.ts loop check`,不是吃 stdin 的 hook.ts)。 */
function cliPathFrom(guardCliPath: string): string {
  const abs = resolveGuardPath(guardCliPath);
  // .../src/loop/hook.ts → .../src/cli.ts;已指向 cli.ts 就原样。
  return abs.replace(/[\\/]src[\\/]loop[\\/][^\\/]+$/, "/src/cli.ts");
}

function claudeSnippet(guardCliPath: string): AdapterResult {
  const guardAbs = resolveGuardPath(guardCliPath);
  const preToolAbs = resolveGuardPath(preToolPathFrom(guardCliPath));
  const config = {
    hooks: {
      // PreToolUse:在 agent 动手【之前】刹车。matcher 是【字符串】(Claude Code schema:
      // matcher 按工具名过滤,字符串/管道分隔/正则),覆盖文件编辑工具 + MCP 工具(mcp__.*)
      // —— 把 MCP 调用纳入与 Edit/Write 并列的一等治理面。高危路径 → ask;平时 allow。
      // command 用【绝对路径】(hook 在目标仓库根执行,相对路径会失效)。
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|Bash|mcp__.*",
          hooks: [
            {
              type: "command",
              command: `bun run ${preToolAbs}`,
            },
          ],
        },
      ],
      // PostToolUse:事后留痕(改完之后跑规则、记面板),与 PreToolUse 互补。
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [
            {
              type: "command",
              command: `bun run ${guardAbs}`,
            },
          ],
        },
      ],
    },
  };

  return {
    agent: "claude",
    instructions: [
      "Add the following JSON to your Claude Code settings.json (merge into existing hooks).",
      "File location: ~/.claude/settings.json  or  <project>/.claude/settings.json",
      "PreToolUse 在 agent 动手前刹车(高危改动 → 弹人工确认);PostToolUse 事后留痕。",
      "command 已用绝对路径,可直接粘贴生效;若 agent-diff-guard 仓库迁移过位置,重跑本命令。",
    ].join("\n"),
    configSnippet: JSON.stringify(config, null, 2),
  };
}

function cursorSnippet(guardCliPath: string): AdapterResult {
  // cursor/codex 跑的是 `cli.ts loop check`(有子命令派发),不是吃 stdin 的 hook.ts;
  // 且必须 `bun run <绝对路径>`(.ts 不可直接执行,相对路径在目标仓库不存在)。
  const cli = cliPathFrom(guardCliPath);
  const snippet = `# agent-diff-guard — Cursor integration (.cursorrules)
# Place this file at the root of your project as .cursorrules
# Cursor will prepend these rules to every AI request in this workspace.

## Diff Guard Policy
After every file edit or creation, run the guard CLI to validate the change:
  bun run ${cli} loop check

If the check returns a non-zero exit code or outputs "block", stop editing and
surface the guard's feedback to the user before proceeding.

The guard CLI command for this project: bun run ${cli} loop check
`;

  return {
    agent: "cursor",
    instructions: [
      "Create (or append) a .cursorrules file at the root of your project with the snippet below.",
      "Cursor automatically reads .cursorrules and injects them into every AI request.",
    ].join("\n"),
    configSnippet: snippet,
  };
}

function codexSnippet(guardCliPath: string): AdapterResult {
  const cli = cliPathFrom(guardCliPath);
  const snippet = `#!/usr/bin/env sh
# agent-diff-guard — Codex post-execution hook
# Save as .codex/hooks/post-exec.sh and make executable (chmod +x)
# Codex will run this script after every code-generation step.

set -e

# Run the diff guard check on the current working directory
bun run ${cli} loop check

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "[agent-diff-guard] Check failed (exit $EXIT_CODE). Review guard output above." >&2
  exit $EXIT_CODE
fi
`;

  return {
    agent: "codex",
    instructions: [
      "Save the snippet below to .codex/hooks/post-exec.sh and make it executable:",
      "  chmod +x .codex/hooks/post-exec.sh",
      "Codex will invoke this hook automatically after each code-generation step.",
    ].join("\n"),
    configSnippet: snippet,
  };
}

function copilotSnippet(_guardCliPath: string): AdapterResult {
  const workflow = `# .github/workflows/diff-guard.yml
# agent-diff-guard — GitHub Copilot / PR integration
# This GitHub Actions workflow runs agent-diff-guard on every pull request.
# It checks all commits since the merge-base of the PR branch vs. main.

name: Diff Guard

on:
  pull_request:
    branches: [main, master]

jobs:
  diff-guard:
    name: Run agent-diff-guard
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run diff guard check
        run: |
          bunx agent-diff-guard check --range origin/main..HEAD
`;

  return {
    agent: "copilot",
    instructions: [
      "Create the file .github/workflows/diff-guard.yml with the snippet below.",
      "The workflow runs on every pull request and validates the diff with agent-diff-guard.",
      "GitHub Copilot pull request suggestions will be guarded automatically via CI.",
    ].join("\n"),
    configSnippet: workflow,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate integration configuration for a specific agent.
 *
 * @param agent        - The target AI coding agent.
 * @param guardCliPath - Absolute or relative path to the agent-diff-guard CLI entry point.
 * @returns            AdapterResult with instructions and a ready-to-use configSnippet.
 */
export function adapterConfig(
  agent: SupportedAgent,
  guardCliPath: string,
): AdapterResult {
  switch (agent) {
    case "claude":
      return claudeSnippet(guardCliPath);
    case "cursor":
      return cursorSnippet(guardCliPath);
    case "codex":
      return codexSnippet(guardCliPath);
    case "copilot":
      return copilotSnippet(guardCliPath);
  }
}

/**
 * Generate integration configurations for all supported agents at once.
 *
 * @param guardCliPath - Path to the agent-diff-guard CLI.
 * @returns            A record keyed by SupportedAgent with each adapter result.
 */
export function allAdapters(
  guardCliPath: string,
): Record<SupportedAgent, AdapterResult> {
  return {
    claude: adapterConfig("claude", guardCliPath),
    cursor: adapterConfig("cursor", guardCliPath),
    codex: adapterConfig("codex", guardCliPath),
    copilot: adapterConfig("copilot", guardCliPath),
  };
}
