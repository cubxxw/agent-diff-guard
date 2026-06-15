# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

agent-diff-guard is a merge-time guardrail for AI agent code changes. When an agent modifies something risky while you're not watching — CI pipelines, secrets, deleted tests, scope drift — it surfaces the 1–3 most important findings and blocks the merge until you confirm. Philosophy: **surface only what would wake someone up at night; never spam** ("宁可漏不可烦").

Two entry points: a CLI (`src/cli.ts`) and an MCP server (`src/mcp.ts`). Both share the same pure-logic core (scan/rules/context/insights).

## Commands

```bash
bun test                    # run all tests (bun:test, NOT vitest)
bun test src/rules.test.ts  # run a single test file
bun run typecheck           # tsc --noEmit (strict mode)
bun run check               # run the CLI guard on current changes
bun run mcp                 # start MCP server (stdio transport)
```

**CLI subcommands** (via `bun run src/cli.ts`):
- `check [--range <git-range>] [--task "..."] [--max N]` — scan changes, exit 0 (pass) or 1 (blocked)
- `serve [--port N]` — local audit dashboard on port 4757
- `context [--json]` — output repo danger map (for agent system prompt)
- `inbox [--json] [--done <id>]` — read/archive panel decisions
- `run [--once] [--dry-run] [--poll N] [--status]` — execution daemon

## Architecture

**Data flow (two directions):**

1. **Downstream guard** (check path): `git diff` → `parseDiff()` → `runRules()` + `driftFindings()` → findings → render/exit-code + `appendEvent()` to `~/.agent-diff-guard/events.jsonl`
2. **Upstream context** (context path): `SENSITIVE_PATH_RULES` + `events.jsonl` history → `buildDangerMap()` → markdown/JSON danger map fed to agent before coding

**Key modules:**

| Module | Role |
|---|---|
| `rules.ts` | The guardrail's judgment — `SENSITIVE_PATH_RULES` (path patterns) + content rules (deleted tests, hardcoded secrets). Exported and reused by `context.ts` to generate danger maps from the same source of truth. |
| `scan.ts` | Parses `git diff --unified=0` into `FileChange[]`; task-drift detection via keyword extraction (supports CJK). `isLowInfoTask()` gates drift detection for vague tasks. |
| `classify.ts` | Run daemon's safety fuse — blacklist of destructive shell patterns (rm, force-push, sudo, etc.). Pure function, no IO. |
| `executor.ts` | Spawns shell (`bash -lc`) or headless Claude (`claude -p`) with wall-clock timeout + output truncation. |
| `runner.ts` | Daemon orchestration: `processOne()` pipeline = PAUSE check → classify → blocked/auto → execute → runlog + markDone. Serial, never concurrent. |
| `inbox.ts` | File-based mailbox (`~/.agent-diff-guard/inbox/pending/` → `done/`) bridging the web dashboard to terminal. |
| `findings.ts` | Review queue: live (realtime `git diff`), history (events.jsonl blocked items, aggregated by repo:rule:file), demo (seed for new users). |
| `context.ts` | Danger map builder — static zones from `rules.ts` + repo history from events. Pure functions + render separation. |
| `insights.ts` | Learning engine: cross-references transcripts × sensitive rules to find which rules are noise vs. real risk per repo. Redacts secrets before output. |
| `transcript.ts` | Neutral model (`TaskTurn` / `RepoTranscript`) + collector registry forwarding. Actual parsing lives in `collectors/`. |
| `collectors/` | Plugin architecture for agent log sources. `claude-code.ts` is the first; `registry.ts` merges across agents by repo key. |
| `policy.ts` | Loads `.agent-policy.json` — user-defined governance rules (frozen-path, freeze-window). No policy file = no violations. |
| `violations.ts` | Deterministic violation detection: path substring match + time window check. Zero LLM, zero false positives. |
| `serve-local.ts` | Bun.serve HTTP server for the local dashboard. Read-only, data never leaves the machine. Two-layer cache (disk incremental + in-memory TTL). |
| `ai.ts` | Optional DeepSeek integration. Only sends de-identified metadata (rule/path/counts), never code. Gated by `DEEPSEEK_API_KEY` env var. |
| `event.ts` | Privacy-partitioned event model: paths are recordable, evidence/task/diff content never persists. Task → sha256 hash only. |
| `logger.ts` | JSONL append-only log at `~/.agent-diff-guard/events.jsonl`. Write failures never affect guard exit code. `ADG_HOME` env var overrides data dir (used in tests). |

**MCP server** (`mcp.ts`): 4 tools — `check_diff_risk`, `get_repo_danger_map`, `get_rule_insights`, `list_pending_decisions`. Stdio transport; stdout is JSON-RPC only, all logging goes to stderr.

**Web dashboard** (`web/`): Static HTML+JS served by `serve-local.ts`. Consumes `/api/*` endpoints. Purely local, zero upload.

## Conventions

- **Runtime**: Bun ≥1.3. No Node.js compatibility layer needed — uses `Bun.spawn`, `Bun.serve`, `Bun.file`.
- **Module system**: ESM (`"type": "module"`), TypeScript with `verbatimModuleSyntax`. Import JSON with `with { type: "json" }`.
- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`.
- **Dependencies**: Intentionally minimal — only `@modelcontextprotocol/sdk` and `zod`. No ORMs, no Express (uses Bun native server).
- **Test isolation**: Tests that touch filesystem set `ADG_HOME` to a temp dir. Time/IDs are injectable (`nowMs` params) for determinism.
- **Privacy partition**: Code content and task text never persist to `events.jsonl` — only paths, rule names, severity, and hashed task descriptions. The `evidence` field in findings is transient (in-memory only for CLI rendering).
- **Severity model**: `wake-you-up` = almost certainly needs human eyes (exit code 1); `look-once` = routine, only escalates when combined with task-drift.
- **New rules**: Add to `SENSITIVE_PATH_RULES` in `rules.ts` for path-based, or add a function in `contentFindings()` for content-based. The same table drives both the guard and the danger map.
- **New collectors**: Implement the `Collector` interface in `collectors/types.ts`, add to `COLLECTORS` array in `collectors/registry.ts`. Main code doesn't change.
