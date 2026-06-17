import { test, expect, describe } from "bun:test";
import { iterationResultToOtelAttributes } from "./otel";
import type { IterationResult } from "./types";

function makeResult(over: Partial<IterationResult> = {}): IterationResult {
  return {
    sessionId: "s1",
    iteration: 3,
    timestamp: "2026-06-17T00:00:00.000Z",
    verdict: "warn",
    verdictReasons: ["drift warn"],
    diffCheck: { filesChanged: 2, wakeFindings: 1, lookFindings: 2, findings: [] },
    driftCheck: { iterationDrift: 0.5, cumulativeDrift: 0.42, goalRelevance: 0.3 },
    budgetCheck: {
      tokensUsed: 12000,
      budgetTotal: 100000,
      budgetPct: 0.12,
      estimatedIterationsRemaining: 7,
      tokensPerIteration: 4000,
    },
    policyCheck: { violationCount: 0, violations: [] },
    ...over,
  };
}

describe("iterationResultToOtelAttributes", () => {
  test("maps all guard.* attributes", () => {
    const attrs = iterationResultToOtelAttributes(makeResult());
    expect(attrs["guard.verdict"]).toBe("warn");
    expect(attrs["guard.iteration"]).toBe(3);
    expect(attrs["guard.drift.cumulative"]).toBe(0.42);
    expect(attrs["guard.drift.iteration"]).toBe(0.5);
    expect(attrs["guard.budget.pct"]).toBe(0.12);
    expect(attrs["guard.budget.tokens_used"]).toBe(12000);
    expect(attrs["guard.findings.wake"]).toBe(1);
    expect(attrs["guard.findings.look"]).toBe(2);
  });

  test("values are flat primitives (string|number) only", () => {
    const attrs = iterationResultToOtelAttributes(makeResult());
    for (const v of Object.values(attrs)) {
      expect(["string", "number"]).toContain(typeof v);
    }
  });

  test("reflects pass verdict", () => {
    const attrs = iterationResultToOtelAttributes(makeResult({ verdict: "pass" }));
    expect(attrs["guard.verdict"]).toBe("pass");
  });
});
