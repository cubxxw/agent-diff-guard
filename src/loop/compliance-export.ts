// compliance-export.ts — EU AI Act compliance record export for loop sessions.
//
// Privacy rule: goal text is NEVER exported. Only goalHash is used to identify
// the task (see project docs: "Goal text: local only").
//
// Covers the six EU AI Act audit categories:
//   1. identity            — session ID + goal hash (no raw goal text)
//   2. inputPrompt         — goal hash (opaque reference to original prompt)
//   3. toolInvocations     — iteration-level tool signals (rollback points)
//   4. decisionPoints      — risk verdict sequence (pass/warn/block) per iteration
//   5. outputs             — findings log entries per iteration
//   6. latencyMetadata     — token spend timing and drift data per iteration

import { listSessions } from "./session";
import { verifyAuditChain } from "./audit";
import type { LoopSession } from "./types";

// ---------------------------------------------------------------------------
// ComplianceRecord — maps one LoopSession iteration to EU AI Act categories
// ---------------------------------------------------------------------------

export interface ComplianceRecord {
  /** EU AI Act §13(3)(a): identity of the session (id + goal hash only, no raw goal) */
  identity: string;

  /** EU AI Act §13(3)(b): opaque reference to the input prompt (goal hash, not goal text) */
  inputPrompt: string;

  /** EU AI Act §13(3)(c): tool invocations that took place (rollback commit hashes if any) */
  toolInvocations: string[];

  /** EU AI Act §13(3)(d): decision points — verdict at each iteration (pass/warn/block) */
  decisionPoints: string[];

  /** EU AI Act §13(3)(e): outputs produced — finding log summaries */
  outputs: string[];

  /** EU AI Act §13(3)(f): latency and resource metadata */
  latencyMetadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// sessionToComplianceRecords
// ---------------------------------------------------------------------------

/**
 * Convert a LoopSession to a list of ComplianceRecords.
 *
 * Each record captures the full lifecycle of ONE iteration's audit evidence.
 * If the session has no riskTrend entries, a single summary record is returned
 * so that sessions with zero iterations are still exportable.
 *
 * Privacy guarantee: `session.goal` is never referenced here.
 */
export function sessionToComplianceRecords(session: LoopSession): ComplianceRecord[] {
  // Build a map of iteration → rollback commits
  const rollbackByIteration = new Map<number, string[]>();
  for (const rp of session.rollbackPoints) {
    const existing = rollbackByIteration.get(rp.iteration) ?? [];
    existing.push(`rollback:${rp.commitHash}`);
    rollbackByIteration.set(rp.iteration, existing);
  }

  // Build a map of iteration → drift entry
  const driftByIteration = new Map<number, {
    iterationDrift: number;
    cumulativeDrift: number;
    goalRelevance: number;
  }>();
  for (const d of session.driftHistory) {
    driftByIteration.set(d.iteration, {
      iterationDrift: d.iterationDrift,
      cumulativeDrift: d.cumulativeDrift,
      goalRelevance: d.goalRelevance,
    });
  }

  // Build a map of iteration → token spend
  const tokenByIteration = new Map<number, {
    inputTokens: number;
    outputTokens: number;
    estCostUsd: number;
  }>();
  for (const t of session.tokenSpend) {
    tokenByIteration.set(t.iteration, {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      estCostUsd: t.estCostUsd,
    });
  }

  // Build a map of iteration → findings
  const findingsByIteration = new Map<number, string[]>();
  for (const f of session.findingsLog) {
    const existing = findingsByIteration.get(f.iteration) ?? [];
    existing.push(`[${f.severity}] ${f.rule} @ ${f.path}: ${f.whySummary}`);
    findingsByIteration.set(f.iteration, existing);
  }

  // If no riskTrend iterations, return a single summary record
  if (session.riskTrend.length === 0) {
    const record: ComplianceRecord = {
      identity: `${session.id}:${session.goalHash}`,
      inputPrompt: session.goalHash,
      toolInvocations: [],
      decisionPoints: [],
      outputs: [],
      latencyMetadata: {
        sessionId: session.id,
        status: session.status,
        iterationCount: session.iterationCount,
        cumulativeDrift: session.cumulativeDrift,
        mode: session.mode,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    };
    return [record];
  }

  // One ComplianceRecord per riskTrend iteration
  return session.riskTrend.map((rt) => {
    const drift = driftByIteration.get(rt.iteration);
    const tokens = tokenByIteration.get(rt.iteration);
    const findings = findingsByIteration.get(rt.iteration) ?? [];
    const rollbacks = rollbackByIteration.get(rt.iteration) ?? [];

    const record: ComplianceRecord = {
      // identity: session id + goal hash — never the raw goal text
      identity: `${session.id}:${session.goalHash}:iter${rt.iteration}`,

      // inputPrompt: goal hash only (EU AI Act §13: input reference without PII)
      inputPrompt: session.goalHash,

      // toolInvocations: rollback commit references at this iteration
      toolInvocations: rollbacks,

      // decisionPoints: the risk verdict at this iteration
      decisionPoints: [
        `iter${rt.iteration}:${rt.verdict}:wake=${rt.wakeCount}:look=${rt.lookCount}:budget=${(rt.budgetPct * 100).toFixed(1)}%`,
      ],

      // outputs: finding log entries at this iteration
      outputs: findings,

      // latencyMetadata: token usage, drift, timestamps
      latencyMetadata: {
        sessionId: session.id,
        iteration: rt.iteration,
        timestamp: rt.timestamp,
        mode: session.mode,
        cumulativeDrift: rt.cumulativeDrift,
        iterationDrift: drift?.iterationDrift ?? null,
        goalRelevance: drift?.goalRelevance ?? null,
        inputTokens: tokens?.inputTokens ?? null,
        outputTokens: tokens?.outputTokens ?? null,
        estCostUsd: tokens?.estCostUsd ?? null,
        budgetPct: rt.budgetPct,
      },
    };

    return record;
  });
}

// ---------------------------------------------------------------------------
// exportComplianceJsonLd
// ---------------------------------------------------------------------------

/**
 * Serialize ComplianceRecords as JSON-LD.
 *
 * Uses a minimal @context aligned with schema.org / W3C PROV vocabulary.
 * Each record is typed as "AuditRecord" to aid downstream tooling.
 */
export function exportComplianceJsonLd(records: ComplianceRecord[]): string {
  const doc = {
    "@context": {
      "@vocab": "https://schema.org/",
      adg: "https://agent-diff-guard.dev/ns#",
      identity: "adg:identity",
      inputPrompt: "adg:inputPrompt",
      toolInvocations: "adg:toolInvocations",
      decisionPoints: "adg:decisionPoints",
      outputs: "adg:outputs",
      latencyMetadata: "adg:latencyMetadata",
    },
    "@type": "Dataset",
    name: "agent-diff-guard EU AI Act Compliance Export",
    description:
      "Tamper-evident loop execution audit records. Goal text excluded per privacy policy.",
    "@graph": records.map((r) => ({
      "@type": "adg:AuditRecord",
      identity: r.identity,
      inputPrompt: r.inputPrompt,
      toolInvocations: r.toolInvocations,
      decisionPoints: r.decisionPoints,
      outputs: r.outputs,
      latencyMetadata: r.latencyMetadata,
    })),
  };

  return JSON.stringify(doc, null, 2);
}

// ---------------------------------------------------------------------------
// exportComplianceCsv
// ---------------------------------------------------------------------------

/**
 * Serialize ComplianceRecords as CSV.
 *
 * Array fields (toolInvocations, decisionPoints, outputs) are joined with ";".
 * The latencyMetadata object is serialized as a compact JSON string in one cell.
 * All values are double-quoted and internal quotes escaped.
 */
export function exportComplianceCsv(records: ComplianceRecord[]): string {
  const header = [
    "identity",
    "inputPrompt",
    "toolInvocations",
    "decisionPoints",
    "outputs",
    "latencyMetadata",
  ];

  function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  const rows = records.map((r) => {
    return [
      csvCell(r.identity),
      csvCell(r.inputPrompt),
      csvCell(r.toolInvocations.join(";")),
      csvCell(r.decisionPoints.join(";")),
      csvCell(r.outputs.join(";")),
      csvCell(JSON.stringify(r.latencyMetadata)),
    ].join(",");
  });

  return [header.map(csvCell).join(","), ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// complianceReport
// ---------------------------------------------------------------------------

/**
 * Generate a full compliance report by aggregating all loop sessions.
 *
 * @param opts.since - ISO timestamp; if provided, only sessions updated at or
 *   after this time are included. Defaults to all sessions.
 *
 * Returns:
 *   - records:    all ComplianceRecord items from matching sessions
 *   - chainValid: whether the audit hash chain passes integrity verification
 *   - total:      number of audit entries in the chain
 *
 * Privacy guarantee: raw goal text is never included in the output.
 */
export async function complianceReport(opts?: {
  since?: string;
}): Promise<{
  records: ComplianceRecord[];
  chainValid: boolean;
  total: number;
}> {
  const since = opts?.since;

  // Load all sessions, optionally filtering by updatedAt >= since
  let sessions = listSessions();
  if (since) {
    sessions = sessions.filter((s) => s.updatedAt >= since);
  }

  // Extract compliance records from every matching session
  const records: ComplianceRecord[] = [];
  for (const session of sessions) {
    records.push(...sessionToComplianceRecords(session));
  }

  // Verify the tamper-evident audit hash chain
  const chainResult = await verifyAuditChain();

  return {
    records,
    chainValid: chainResult.valid,
    total: chainResult.total,
  };
}
