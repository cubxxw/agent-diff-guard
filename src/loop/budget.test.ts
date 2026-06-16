import { describe, expect, test } from "bun:test";
import { budgetStatus } from "./budget";

const mkHistory = (
  entries: [number, number, number][],
) =>
  entries.map(([iteration, inputTokens, outputTokens]) => ({
    iteration,
    inputTokens,
    outputTokens,
  }));

describe("budgetStatus", () => {
  test("at warnPct boundary → warn", () => {
    const result = budgetStatus(
      300_000,
      500_000,
      0.6,
      0.9,
      mkHistory([
        [1, 40_000, 10_000],
        [2, 45_000, 15_000],
      ]),
    );
    expect(result.budgetPct).toBeCloseTo(0.6);
    expect(result.verdict).toBe("warn");
  });

  test("null budget → pct=0, verdict=pass", () => {
    const result = budgetStatus(50_000, null, 0.6, 0.9, []);
    expect(result.budgetPct).toBe(0);
    expect(result.verdict).toBe("pass");
    expect(result.estimatedIterationsRemaining).toBeNull();
  });

  test("above blockPct → block", () => {
    const result = budgetStatus(
      460_000,
      500_000,
      0.6,
      0.9,
      mkHistory([
        [1, 50_000, 10_000],
        [2, 50_000, 10_000],
        [3, 50_000, 10_000],
      ]),
    );
    expect(result.verdict).toBe("block");
    expect(result.budgetPct).toBeCloseTo(0.92);
  });

  test("below warnPct → pass", () => {
    const result = budgetStatus(
      100_000,
      500_000,
      0.6,
      0.9,
      mkHistory([[1, 30_000, 10_000]]),
    );
    expect(result.verdict).toBe("pass");
    expect(result.budgetPct).toBeCloseTo(0.2);
  });

  test("tokensPerIteration is moving average of last 5", () => {
    const history = mkHistory([
      [1, 10_000, 5_000],
      [2, 20_000, 5_000],
      [3, 30_000, 5_000],
      [4, 40_000, 5_000],
      [5, 50_000, 5_000],
      [6, 60_000, 5_000],
      [7, 70_000, 5_000],
    ]);
    const result = budgetStatus(200_000, 500_000, 0.6, 0.9, history);
    // last 5: iterations 3-7, totals: 35k, 45k, 55k, 65k, 75k → avg 55k
    expect(result.tokensPerIteration).toBe(55_000);
  });

  test("empty history → tokensPerIteration=0", () => {
    const result = budgetStatus(100_000, 500_000, 0.6, 0.9, []);
    expect(result.tokensPerIteration).toBe(0);
    expect(result.estimatedIterationsRemaining).toBeNull();
  });

  test("estimatedIterationsRemaining calculated correctly", () => {
    const result = budgetStatus(
      200_000,
      500_000,
      0.6,
      0.9,
      mkHistory([
        [1, 40_000, 10_000],
        [2, 50_000, 10_000],
        [3, 45_000, 5_000],
      ]),
    );
    // avg per iteration: (50k + 60k + 50k) / 3 ≈ 53333
    // remaining: 300k, floor(300k / 53333) = 5
    const avgPerIter =
      (50_000 + 60_000 + 50_000) / 3;
    const expected = Math.floor(300_000 / avgPerIter);
    expect(result.estimatedIterationsRemaining).toBe(expected);
  });

  test("budget fully spent → estimatedIterationsRemaining=0", () => {
    const result = budgetStatus(
      500_000,
      500_000,
      0.6,
      0.9,
      mkHistory([[1, 50_000, 10_000]]),
    );
    expect(result.estimatedIterationsRemaining).toBe(0);
    expect(result.verdict).toBe("block");
  });
});
