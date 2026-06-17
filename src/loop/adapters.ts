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

function claudeSnippet(guardCliPath: string): AdapterResult {
  const config = {
    hooks: {
      PostToolUse: [
        {
          matcher: { tool_name: "Edit|Write|MultiEdit" },
          hooks: [
            {
              type: "command",
              command: `echo $TOOL_INPUT | bun run ${guardCliPath}`,
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
    ].join("\n"),
    configSnippet: JSON.stringify(config, null, 2),
  };
}

function cursorSnippet(guardCliPath: string): AdapterResult {
  const snippet = `# agent-diff-guard — Cursor integration (.cursorrules)
# Place this file at the root of your project as .cursorrules
# Cursor will prepend these rules to every AI request in this workspace.

## Diff Guard Policy
After every file edit or creation, run the guard CLI to validate the change:
  ${guardCliPath} loop check

If the check returns a non-zero exit code or outputs "block", stop editing and
surface the guard's feedback to the user before proceeding.

The guard CLI path for this project: ${guardCliPath}
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
  const snippet = `#!/usr/bin/env sh
# agent-diff-guard — Codex post-execution hook
# Save as .codex/hooks/post-exec.sh and make executable (chmod +x)
# Codex will run this script after every code-generation step.

set -e

# Run the diff guard check on the current working directory
${guardCliPath} loop check

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
