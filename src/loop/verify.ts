// verify.ts — End-to-end acceptance gate (closing boundary verdict).
//
// Background (Suggestion 4 — "end-to-end verification gate"):
//   Research on agent-loop oversight converges on a pattern: instead of having a
//   human review every single diff line-by-line, move human judgment to the
//   WORKFLOW BOUNDARIES — define the contract/guardrails up front, and verify
//   safety/results at the end. agent-diff-guard already covers:
//     - the OPENING boundary  → contract.ts (.loop-contract.yaml: the six
//       mandatory fields a loop must declare before it starts), and
//     - the PER-ITERATION gate → checkIteration() in check.ts.
//   What was missing is the CLOSING boundary: a single end-of-session acceptance
//   verdict that summarizes everything the loop accumulated and decides
//   "pass" vs "needs-review".
//
// This module is intentionally a *pure aggregator*. It does NOT re-run rules or
// re-parse diffs (checkIteration already did that per iteration and persisted the
// results). It reads the session's accumulated history and renders one boundary
// ruling, so the human reviews the SESSION, not each diff.

import type { LoopSession } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single reason contributing to the final verdict. */
export interface AcceptanceReason {
  /** Which dimension raised the concern. */
  category: "findings" | "drift" | "policy" | "budget" | "safety";
  /** "block" → forces needs-review; "warn" → noted but does not block alone. */
  level: "block" | "warn";
  /** Human-readable explanation. */
  message: string;
}

/** The end-of-session acceptance report (closing boundary gate). */
export interface AcceptanceReport {
  sessionId: string;
  goal: string;
  generatedAt: string;
  iterationsTotal: number;

  /** Final boundary ruling. "pass" = safe to accept without line-by-line review. */
  verdict: "pass" | "needs-review";

  /** Aggregate counters across the whole session. */
  totals: {
    wakeFindings: number;
    lookFindings: number;
    /** 非 finding 类阻断的迭代数(成因可能是 policy/budget/drift/progress/circuit —— riskTrend
     *  不区分具体成因,故如实命名为"非 finding 阻断",不假装全是 policy 违规)。 */
    nonFindingBlocks: number;
    cumulativeDrift: number;
    budgetPct: number;
    tokensUsed: number;
    budgetTotal: number | null;
  };

  /** Distinct wake-you-up findings (rule@path) seen anywhere in the session. */
  unresolvedWakeFindings: {
    rule: string;
    path: string;
    count: number;
  }[];

  /** Why the gate ruled the way it did. Empty reasons ⇒ clean pass. */
  reasons: AcceptanceReason[];

  /** Last recorded safe (all-pass) rollback checkpoint, if any. */
  safeRollbackPoint: {
    iteration: number;
    commitHash: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

/**
 * Produce the end-of-session acceptance report — the CLOSING boundary gate.
 *
 * Verdict logic (conservative — "宁可漏不可烦" applies to noise, NOT to safety):
 *   needs-review if ANY of:
 *     - one or more distinct wake-you-up findings were ever raised
 *     - one or more policy violations were ever recorded
 *     - cumulative drift diverged (> 0.7)
 *     - the session was emergency-braked
 *     - budget block threshold (default 90%) was reached
 *   otherwise pass (drift in the "drifting" band 0.4–0.7 and budget warn band
 *   are warns, not blocks).
 */
export function generateAcceptanceReport(session: LoopSession): AcceptanceReport {
  const now = new Date().toISOString();

  // -- Aggregate findings across the whole session --
  // Deduplicate wake findings by rule:path so a finding re-seen every iteration
  // counts as one outstanding concern (with an occurrence count), not N.
  const wakeMap = new Map<string, { rule: string; path: string; count: number }>();
  let lookFindings = 0;
  let wakeFindings = 0;
  for (const f of session.findingsLog) {
    if (f.severity === "wake-you-up") {
      wakeFindings++;
      const key = `${f.rule}:${f.path}`;
      const existing = wakeMap.get(key);
      if (existing) existing.count++;
      else wakeMap.set(key, { rule: f.rule, path: f.path, count: 1 });
    } else {
      lookFindings++;
    }
  }
  const unresolvedWakeFindings = [...wakeMap.values()].sort(
    (a, b) => b.count - a.count,
  );

  // -- Non-finding blocks --
  // findingsLog 只带 diff findings。一次 block 但 wakeCount===0 的迭代,其成因是
  // policy / budget / drift / progress / circuit 之一 —— riskTrend 没记成因,无法区分。
  // 所以这里【如实】统计为"非 finding 阻断"总数,不冒充全是 policy 违规(那会误导人审)。
  const nonFindingBlocks = session.riskTrend.filter(
    (r) => r.verdict === "block" && r.wakeCount === 0,
  ).length;

  // -- Budget --
  const tokensUsed = session.tokenSpend.reduce(
    (sum, e) => sum + e.inputTokens + e.outputTokens,
    0,
  );
  const budgetPct =
    session.budgetTokens != null && session.budgetTokens > 0
      ? tokensUsed / session.budgetTokens
      : 0;

  const cumulativeDrift = session.cumulativeDrift;

  // -- Safe rollback point (last recorded all-pass checkpoint) --
  const lastRollback =
    session.rollbackPoints.length > 0
      ? session.rollbackPoints[session.rollbackPoints.length - 1]!
      : null;
  const safeRollbackPoint = lastRollback
    ? { iteration: lastRollback.iteration, commitHash: lastRollback.commitHash }
    : null;

  // -- Build reasons --
  const reasons: AcceptanceReason[] = [];

  if (unresolvedWakeFindings.length > 0) {
    reasons.push({
      category: "findings",
      level: "block",
      message: `${unresolvedWakeFindings.length} distinct wake-you-up finding(s) raised during the session`,
    });
  }
  if (lookFindings > 0) {
    reasons.push({
      category: "findings",
      level: "warn",
      message: `${lookFindings} look-once finding(s) accumulated`,
    });
  }
  if (nonFindingBlocks > 0) {
    reasons.push({
      category: "policy",
      level: "block",
      message: `${nonFindingBlocks} iteration(s) blocked on non-finding cause(s) (policy/budget/drift/progress)`,
    });
  }
  if (cumulativeDrift > 0.7) {
    reasons.push({
      category: "drift",
      level: "block",
      message: `cumulative drift diverged: ${(cumulativeDrift * 100).toFixed(0)}%`,
    });
  } else if (cumulativeDrift >= 0.4) {
    reasons.push({
      category: "drift",
      level: "warn",
      message: `cumulative drift elevated: ${(cumulativeDrift * 100).toFixed(0)}%`,
    });
  }
  if (session.status === "emergency-braked") {
    reasons.push({
      category: "safety",
      level: "block",
      message: "session was emergency-braked",
    });
  }
  if (budgetPct >= session.budgetBlockPct) {
    reasons.push({
      category: "budget",
      level: "block",
      message: `budget block threshold reached: ${(budgetPct * 100).toFixed(0)}%`,
    });
  } else if (budgetPct >= session.budgetWarnPct) {
    reasons.push({
      category: "budget",
      level: "warn",
      message: `budget warn threshold reached: ${(budgetPct * 100).toFixed(0)}%`,
    });
  }

  const verdict: "pass" | "needs-review" = reasons.some(
    (r) => r.level === "block",
  )
    ? "needs-review"
    : "pass";

  return {
    sessionId: session.id,
    goal: session.goal,
    generatedAt: now,
    iterationsTotal: session.iterationCount,
    verdict,
    totals: {
      wakeFindings,
      lookFindings,
      nonFindingBlocks,
      cumulativeDrift,
      budgetPct,
      tokensUsed,
      budgetTotal: session.budgetTokens,
    },
    unresolvedWakeFindings,
    reasons,
    safeRollbackPoint,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Render the acceptance report as a human-readable boundary ruling. */
export function renderAcceptanceReport(report: AcceptanceReport): string {
  const lines: string[] = [];
  lines.push(`=== Acceptance Gate: ${report.sessionId} ===`);
  lines.push(`Goal: ${report.goal}`);
  lines.push(`Iterations: ${report.iterationsTotal}`);
  lines.push(`Verdict: ${report.verdict.toUpperCase()}`);
  lines.push("");
  lines.push(
    `Findings: ${report.totals.wakeFindings} wake-you-up, ${report.totals.lookFindings} look-once`,
  );
  lines.push(`Non-finding blocks: ${report.totals.nonFindingBlocks}`);
  lines.push(`Cumulative drift: ${(report.totals.cumulativeDrift * 100).toFixed(0)}%`);
  lines.push(`Budget: ${(report.totals.budgetPct * 100).toFixed(0)}% used`);

  if (report.unresolvedWakeFindings.length > 0) {
    lines.push("");
    lines.push("Wake-you-up findings to review:");
    for (const f of report.unresolvedWakeFindings) {
      lines.push(`  ${f.rule} @ ${f.path} (×${f.count})`);
    }
  }

  if (report.reasons.length > 0) {
    lines.push("");
    lines.push("Reasons:");
    for (const r of report.reasons) {
      const tag = r.level === "block" ? "[BLOCK]" : "[warn]";
      lines.push(`  ${tag} ${r.category}: ${r.message}`);
    }
  }

  if (report.safeRollbackPoint) {
    lines.push("");
    lines.push(
      `Safe rollback: iteration ${report.safeRollbackPoint.iteration} (${report.safeRollbackPoint.commitHash})`,
    );
  }

  return lines.join("\n");
}

/** Serialize the acceptance report as pretty JSON. */
export function acceptanceReportToJson(report: AcceptanceReport): string {
  return JSON.stringify(report, null, 2);
}
