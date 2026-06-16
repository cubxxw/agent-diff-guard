# agent-diff-guard · Loop Verification Layer Design

> agent-diff-guard 不做 Loop 管理器，做**所有 Loop 的验证层**。
> Loop 越自治，守门越刚需 — Build the guard for the loop, not the loop itself.

---

## 1. Why: Loop 时代为什么需要我们

Loop Engineering (2026-06) 让 agent **在你睡觉时**持续迭代。Ralph 一夜产出 50+ commits，`/goal` 跑到条件满足才停，Gas Town 20 个 agent 并行。

**Loop 的三大失败模式，正是我们的差异化能力**：

| 失败模式 | agent-diff-guard 的回答 |
|---|---|
| Goal drift — 每步小、总量大的渐进偏离 | **累积漂移检测**（EMA 跨轮累积） |
| Token explosion — 失控的成本 | **预算守护**（读 session logs，阈值制动） |
| Verification absence — "done" 是 claim 不是 proof | **独立 checker**（分离于 writer 的验证层） |

---

## 2. What: 三个入口，一套逻辑

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
│  MCP Tool        │   │  CLI Command     │   │  Claude Code    │
│  guard_loop_     │   │  loop check      │   │  PostToolUse    │
│  iteration       │   │  --session <id>  │   │  Hook           │
└────────┬────────┘   └────────┬─────────┘   └────────┬────────┘
         │                     │                       │
         └─────────────────────┼───────────────────────┘
                               │
                     ┌─────────▼──────────┐
                     │    check.ts        │  编排器
                     │  checkIteration()  │  ~80ms, no LLM
                     └─────────┬──────────┘
                               │
         ┌──────────┬──────────┼──────────┬──────────┐
         │          │          │          │          │
    ┌────▼──┐ ┌────▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼──────┐
    │scan.ts│ │drift.ts│ │budget │ │policy │ │overnight │
    │rules  │ │EMA cum.│ │.ts    │ │.ts    │ │.ts       │
    └───────┘ └────────┘ └───────┘ └───────┘ └──────────┘
                               │
                     ┌─────────▼──────────┐
                     │  session.ts        │
                     │  loops/<id>.json   │  状态持久化
                     └─────────┬──────────┘
                               │
                     ┌─────────▼──────────┐
                     │ loop-events.jsonl  │  审计轨迹
                     └────────────────────┘
```

---

## 3. Data Model

### LoopSession (`~/.agent-diff-guard/loops/<ULID>.json`)

```typescript
interface LoopSession {
  id: string;                    // ULID
  createdAt: string;             // ISO 8601
  updatedAt: string;

  // Goal
  goal: string;                  // 原始目标（本地不出区，不进 audit trail）
  goalHash: string;              // sha256prefix(goal)，可出区
  goalKeywords: string[];        // taskKeywords(goal)，用于漂移检测

  // Config
  cwd: string;
  repoRemote: string | null;
  budgetTokens: number | null;   // null = 无限制
  budgetWarnPct: number;         // default 0.6
  budgetBlockPct: number;        // default 0.9
  mode: "attended" | "unattended";

  // Status
  status: "active" | "paused" | "stopped" | "emergency-braked";
  iterationCount: number;
  cumulativeDrift: number;       // 0.0-1.0

  // History arrays (capped at 500 entries)
  driftHistory: DriftEntry[];
  tokenSpend: TokenEntry[];
  rollbackPoints: RollbackEntry[];
  findingsLog: FindingLogEntry[];
  riskTrend: RiskTrendEntry[];
}
```

### IterationResult (每轮检查返回)

```typescript
interface IterationResult {
  sessionId: string;
  iteration: number;
  timestamp: string;
  verdict: "pass" | "warn" | "block";
  verdictReasons: string[];
  diffCheck: { filesChanged: number; wakeFindings: number; lookFindings: number; findings: FindingMeta[] };
  driftCheck: { iterationDrift: number; cumulativeDrift: number; goalRelevance: number };
  budgetCheck: { tokensUsed: number; budgetTotal: number | null; budgetPct: number; estimatedIterationsRemaining: number | null; tokensPerIteration: number };
  policyCheck: { violationCount: number; violations: { policyName: string; offendingFiles: string[] }[] };
}
```

---

## 4. Module Specs

### `src/loop/types.ts` (~120L) — Data model + Zod schemas
All interfaces above + Zod schemas for runtime validation. Also `HookResult` (lightweight for < 500ms path) and `MorningReport`.

### `src/loop/drift.ts` (~180L) — 累积漂移检测
- `iterationDriftScore(changedFiles, goalKeywords) → 0.0-1.0` — 本轮文件 vs 目标关键词
- `updateCumulativeDrift(score, previous, alpha=0.3) → number` — EMA 累积
- `goalRelevance(allFiles, goalKeywords) → 0.0-1.0` — 全局：所有迭代 union
- `driftVerdict(cumulative) → pass(<0.4) | warn(0.4-0.7) | block(>0.7)`
- Pure functions, no IO.

### `src/loop/budget.ts` (~200L) — Token 预算守护
- `readTokenSpend(cwd, sinceTimestamp)` — 读 `~/.claude/projects/` session logs (reuse `sessions.ts`)
- `budgetStatus(tokensUsed, budgetTotal, history) → { budgetPct, verdict, tokensPerIteration, estimatedIterationsRemaining }`
- warn at 60%, block at 90%.

### `src/loop/session.ts` (~200L) — Session CRUD
- `startSession(opts) → LoopSession` — create + persist
- `loadSession(id) → LoopSession | null`
- `saveSession(session)` — atomic write-rename
- `stopSession(id) → boolean`
- `listSessions() → LoopSession[]`
- `activeSessionForCwd(cwd) → LoopSession | null` — at most one active per repo

### `src/loop/check.ts` (~250L) — 编排器 (core)
- `checkIteration(sessionId, task?)` — full check (~80ms): parseDiff → runRules → detectViolations → drift → budget → composite verdict → save
- `quickCheck(cwd, filePath)` — fast path for hook (~51ms): pathFindings + contentFindings on single file only

### `src/loop/overnight.ts` (~150L) — 无人值守
- `shouldEmergencyBrake(session) → { brake, reason }`
- `executeEmergencyBrake(session, reason)` — writes PAUSE file
- `unattendedVerdictOverride(result, session)` — block → warn unless emergency

### `src/loop/report.ts` (~200L) — 晨报
- `generateReport(session) → MorningReport`
- `renderReport(report) → string` (human readable)
- `reportToJson(report) → string`

### `src/loop/hook.ts` (~150L) — PostToolUse hook adapter
- `handlePostToolUse()` — reads tool event from stdin, runs quickCheck
- `hookConfig(guardCliPath)` — generates Claude Code settings.json hook config

### `src/loop-cli.ts` (~250L) — CLI subcommands
All `loop` subcommands: start/check/status/report/stop/list/install-hook.

### `src/loop-mcp.ts` (~180L) — MCP tool registration
Exports `registerLoopTools(server)` that registers `guard_loop_iteration` + `loop_status`.

---

## 5. Integration Recipes

### Ralph Loop
```bash
SID=$(agent-diff-guard loop start --goal "implement feature X" --budget 500k)
while :; do
  cat PROMPT.md | claude -p
  VERDICT=$(agent-diff-guard loop check --session $SID --json | jq -r '.verdict')
  [ "$VERDICT" = "block" ] && break
done
agent-diff-guard loop report --session $SID
```

### Claude Code /goal — agent calls `guard_loop_iteration` MCP tool
### Claude Code /loop — loop prompt includes guard call
### PostToolUse Hook — `agent-diff-guard loop install-hook --cwd .`
### Gas Town — each worktree gets its own session
### GitHub Actions — `bunx agent-diff-guard check --range "origin/main..HEAD"`

---

## 6. Reuse Map

| Existing Module | How Loop Guard Uses It |
|---|---|
| `scan.ts` `parseDiff` + `taskKeywords` (export) | Diff parsing + keyword extraction |
| `rules.ts` `runRules` | Per-iteration rule check |
| `violations.ts` `detectViolations` | Per-iteration policy check |
| `sessions.ts` | Token spend for budget |
| `event.ts` `GuardEvent` | Extended with optional `loopSessionId` |
| `logger.ts` | Loop events to `loop-events.jsonl` |
| `id.ts` `generateUlid` | Session + event IDs |
| `hash.ts` `sha256prefix` | Goal hash |

---

## 7. Privacy (Unchanged)

- Goal text: local only (`loops/<id>.json`), never in audit trail
- Audit trail: only goalHash + rule + path + verdict
- No new code content recorded
- No new network calls
