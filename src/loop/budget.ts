export interface TokenSpendSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estCostUsd: number;
}

export interface BudgetStatus {
  budgetPct: number;
  verdict: "pass" | "warn" | "block";
  tokensPerIteration: number;
  estimatedIterationsRemaining: number | null;
}

/**
 * Compute budget status from token usage and history.
 *
 * budgetPct = tokensUsed / (budgetTotal ?? Infinity)
 * tokensPerIteration = moving average of last 5 iterations (input+output)
 * verdict: < warnPct → pass, < blockPct → warn, else → block
 * estimatedIterationsRemaining: null when budgetTotal is null
 */
export function budgetStatus(
  tokensUsed: number,
  budgetTotal: number | null,
  warnPct: number,
  blockPct: number,
  tokenHistory: {
    iteration: number;
    inputTokens: number;
    outputTokens: number;
  }[],
): BudgetStatus {
  const pct =
    budgetTotal != null && budgetTotal > 0
      ? tokensUsed / budgetTotal
      : 0;

  const recent = tokenHistory.slice(-5);
  const tokensPerIteration =
    recent.length > 0
      ? recent.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0) /
        recent.length
      : 0;

  let estimatedIterationsRemaining: number | null = null;
  if (budgetTotal != null && tokensPerIteration > 0) {
    const remaining = budgetTotal - tokensUsed;
    estimatedIterationsRemaining = Math.max(
      0,
      Math.floor(remaining / tokensPerIteration),
    );
  }

  let verdict: "pass" | "warn" | "block";
  if (pct < warnPct) {
    verdict = "pass";
  } else if (pct < blockPct) {
    verdict = "warn";
  } else {
    verdict = "block";
  }

  return {
    budgetPct: pct,
    verdict,
    tokensPerIteration,
    estimatedIterationsRemaining,
  };
}
