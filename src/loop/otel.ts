import type { IterationResult } from "./types";

/**
 * Convert an IterationResult into a flat map of OpenTelemetry span attributes.
 * Designed for automatic ingestion by Datadog, Phoenix, Langfuse, etc.
 *
 * Attribute keys follow the "guard.*" namespace convention.
 */
export function iterationResultToOtelAttributes(
  result: IterationResult,
): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    "guard.verdict": result.verdict,
    "guard.iteration": result.iteration,
    "guard.drift.cumulative": result.driftCheck.cumulativeDrift,
    "guard.drift.iteration": result.driftCheck.iterationDrift,
    "guard.budget.pct": result.budgetCheck.budgetPct,
    "guard.budget.tokens_used": result.budgetCheck.tokensUsed,
    "guard.findings.wake": result.diffCheck.wakeFindings,
    "guard.findings.look": result.diffCheck.lookFindings,
  };
  return attrs;
}
