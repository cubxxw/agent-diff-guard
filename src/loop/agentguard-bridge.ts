// agentguard-bridge.ts — Interoperability layer between AgentGuard47 (Python runtime
// guardrails) and agent-diff-guard (TypeScript diff analysis / drift detection).
//
// AgentGuard47 emits JSONL trace files (one JSON object per line) capturing budget
// events, tool calls, verdicts, etc.  This module provides:
//   - A TypeScript interface mirroring the AgentGuard47 v1.2.13 trace schema
//   - Fault-tolerant JSONL parsing (bad lines are silently skipped — same approach as
//     logger.ts readEvents)
//   - Budget aggregation that produces a TokenSpendSnapshot compatible with budget.ts
//   - A converter that wraps an agent-diff-guard verdict into an AgentGuard47 trace row

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One line in an AgentGuard47 JSONL trace file (v1.2.13 schema).
 * Unknown extra fields are allowed via the index signature — this makes the type
 * forward-compatible with minor schema additions.
 */
export interface AgentGuardEvent {
  /** Event category, e.g. "budget_update", "tool_call", "guard_verdict". */
  type: string;
  /** ISO 8601 timestamp, e.g. "2026-06-17T12:34:56.789Z". */
  timestamp: string;
  /** Cumulative USD spend recorded by AgentGuard47 for this event. */
  budget_used_usd?: number;
  /** Token count associated with the event (may be input+output combined). */
  tokens?: number;
  /** Name of the tool invoked, if applicable. */
  tool?: string;
  /** Whether the guarded operation succeeded. */
  success?: boolean;
  /** Allow arbitrary additional fields from future schema versions. */
  [key: string]: unknown;
}

/**
 * Aggregated token spend extracted from an AgentGuard47 trace.
 * Shape matches the subset of budget.ts `TokenSpendSnapshot` that can be derived
 * from AgentGuard47 traces (cacheReadTokens is always 0 — not tracked there).
 */
export interface AgentGuardBudgetSpend {
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse the raw text content of an AgentGuard47 JSONL trace file.
 *
 * Fault-tolerant: lines that are empty, whitespace-only, or fail JSON.parse are
 * silently skipped so that a truncated or corrupt line never aborts the whole read.
 * This mirrors the strategy used in `src/logger.ts` readEvents().
 *
 * @param content - Full text of the JSONL file.
 * @returns Array of successfully parsed AgentGuardEvent objects.
 */
export function parseAgentGuardTrace(content: string): AgentGuardEvent[] {
  const events: AgentGuardEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue; // skip blank lines
    try {
      const parsed = JSON.parse(line) as AgentGuardEvent;
      // Require at minimum the mandatory fields to be present
      if (typeof parsed.type === "string" && typeof parsed.timestamp === "string") {
        events.push(parsed);
      }
    } catch {
      // Malformed JSON — skip without throwing (e.g. partially-written line)
    }
  }

  return events;
}

// ─── Budget aggregation ───────────────────────────────────────────────────────

/**
 * Aggregate budget spend data from a list of AgentGuard47 events.
 *
 * AgentGuard47 does not split token counts into input vs. output; the `tokens`
 * field is a combined total.  Convention used here:
 *   - All `tokens` are counted as `inputTokens` (conservative — callers can adjust).
 *   - `outputTokens` remains 0 unless a future schema adds a dedicated field.
 *   - `estCostUsd` is the sum of all `budget_used_usd` values.
 *
 * The returned shape is intentionally compatible with `budget.ts` TokenSpendSnapshot
 * (minus `cacheReadTokens` which AgentGuard47 does not track).
 *
 * @param events - Array of AgentGuard47 events, typically from parseAgentGuardTrace().
 * @returns Aggregated spend ready to feed into budget.ts calculations.
 */
export function extractBudgetSpend(events: AgentGuardEvent[]): AgentGuardBudgetSpend {
  let inputTokens = 0;
  let outputTokens = 0;
  let estCostUsd = 0;

  for (const ev of events) {
    if (typeof ev.tokens === "number" && ev.tokens > 0) {
      // No input/output split available — attribute everything to inputTokens
      inputTokens += ev.tokens;
    }
    if (typeof ev.budget_used_usd === "number" && ev.budget_used_usd > 0) {
      estCostUsd += ev.budget_used_usd;
    }
  }

  return { inputTokens, outputTokens, estCostUsd };
}

// ─── Verdict export ───────────────────────────────────────────────────────────

/**
 * Convert an agent-diff-guard verdict into an AgentGuard47-compatible trace event.
 *
 * This lets agent-diff-guard write its own decisions into an AgentGuard47 trace so
 * that a unified log can be produced for auditing or downstream tooling.
 *
 * @param verdict - The agent-diff-guard verdict ("pass", "warn", or "block").
 * @param reason  - Human-readable explanation for the verdict.
 * @returns An AgentGuardEvent with type "guard_verdict" and current UTC timestamp.
 */
export function verdictToAgentGuardEvent(
  verdict: "pass" | "warn" | "block",
  reason: string,
): AgentGuardEvent {
  return {
    type: "guard_verdict",
    timestamp: new Date().toISOString(),
    // Embed agent-diff-guard specific fields under a namespaced key
    adg_verdict: verdict,
    adg_reason: reason,
    success: verdict !== "block",
  };
}
