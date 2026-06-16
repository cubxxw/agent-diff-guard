import type { LoopSession, MorningReport } from "./types";

export function generateReport(
  session: LoopSession,
  opts?: { since?: string },
): MorningReport {
  const since = opts?.since;

  const recentTrend = since
    ? session.riskTrend.filter((r) => r.timestamp >= since)
    : session.riskTrend;
  const iterationsWhileAway = recentTrend.length;

  // Top findings: deduplicate by rule:path, count occurrences, take top 5
  const findingCounts = new Map<
    string,
    { rule: string; path: string; severity: "wake-you-up" | "look-once"; count: number }
  >();
  const relevantFindings = since
    ? session.findingsLog.filter((f) => f.timestamp >= since)
    : session.findingsLog;

  for (const f of relevantFindings) {
    const key = `${f.rule}:${f.path}`;
    const existing = findingCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      findingCounts.set(key, {
        rule: f.rule,
        path: f.path,
        severity: f.severity,
        count: 1,
      });
    }
  }
  const topFindings = [...findingCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Drift summary
  const currentDrift = session.cumulativeDrift;
  const driftStatus: "stable" | "drifting" | "diverged" =
    currentDrift < 0.4 ? "stable" : currentDrift <= 0.7 ? "drifting" : "diverged";

  let driftTrend: "improving" | "stable" | "worsening" = "stable";
  if (session.driftHistory.length >= 3) {
    const last3 = session.driftHistory.slice(-3);
    const first = last3[0]!.cumulativeDrift;
    const last = last3[last3.length - 1]!.cumulativeDrift;
    if (last - first > 0.05) driftTrend = "worsening";
    else if (first - last > 0.05) driftTrend = "improving";
  }

  // Budget summary
  const totalTokensUsed = session.tokenSpend.reduce(
    (sum, e) => sum + e.inputTokens + e.outputTokens,
    0,
  );
  const budgetPct =
    session.budgetTokens != null && session.budgetTokens > 0
      ? totalTokensUsed / session.budgetTokens
      : 0;

  const recent5 = session.tokenSpend.slice(-5);
  const avgPerIter =
    recent5.length > 0
      ? recent5.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0) /
        recent5.length
      : 0;
  const estimatedIterationsRemaining =
    session.budgetTokens != null && avgPerIter > 0
      ? Math.max(0, Math.floor((session.budgetTokens - totalTokensUsed) / avgPerIter))
      : null;

  // Safe rollback point
  const safeRollbackPoint =
    session.rollbackPoints.length > 0
      ? {
          iteration: session.rollbackPoints[session.rollbackPoints.length - 1]!.iteration,
          commitHash: session.rollbackPoints[session.rollbackPoints.length - 1]!.commitHash,
        }
      : null;

  const emergencyBrakeTriggered = session.status === "emergency-braked";

  let recommendation: "continue" | "review-and-continue" | "rollback" | "stop";
  if (emergencyBrakeTriggered) {
    recommendation = "rollback";
  } else if (driftStatus === "diverged") {
    recommendation = "review-and-continue";
  } else {
    recommendation = "continue";
  }

  return {
    sessionId: session.id,
    generatedAt: new Date().toISOString(),
    iterationsWhileAway,
    topFindings,
    driftSummary: {
      status: driftStatus,
      currentDrift,
      trend: driftTrend,
    },
    budgetSummary: {
      tokensUsed: totalTokensUsed,
      budgetTotal: session.budgetTokens,
      budgetPct,
      estimatedIterationsRemaining,
    },
    safeRollbackPoint,
    emergencyBrakeTriggered,
    recommendation,
  };
}

export function renderReport(report: MorningReport): string {
  const lines: string[] = [];
  lines.push(`=== Morning Report: ${report.sessionId} ===`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Iterations while away: ${report.iterationsWhileAway}`);
  lines.push("");
  lines.push(`Drift: ${report.driftSummary.status} (${(report.driftSummary.currentDrift * 100).toFixed(0)}%, ${report.driftSummary.trend})`);
  lines.push(`Budget: ${(report.budgetSummary.budgetPct * 100).toFixed(0)}% used${report.budgetSummary.estimatedIterationsRemaining != null ? `, ~${report.budgetSummary.estimatedIterationsRemaining} iters left` : ""}`);
  lines.push("");

  if (report.topFindings.length > 0) {
    lines.push("Top Findings:");
    for (const f of report.topFindings) {
      lines.push(`  [${f.severity}] ${f.rule} @ ${f.path} (×${f.count})`);
    }
    lines.push("");
  }

  if (report.safeRollbackPoint) {
    lines.push(`Safe rollback: iteration ${report.safeRollbackPoint.iteration} (${report.safeRollbackPoint.commitHash})`);
  }
  if (report.emergencyBrakeTriggered) {
    lines.push("WARNING: EMERGENCY BRAKE TRIGGERED");
  }
  lines.push(`Recommendation: ${report.recommendation}`);
  return lines.join("\n");
}

export function reportToJson(report: MorningReport): string {
  return JSON.stringify(report, null, 2);
}
