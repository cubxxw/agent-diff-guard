import { describe, expect, test } from "bun:test";
import { generateReport, renderReport, reportToJson } from "./report";
import type { LoopSession } from "./types";

function makeSession(overrides: Partial<LoopSession> = {}): LoopSession {
  return {
    id: "test-session",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T01:00:00.000Z",
    goal: "implement auth",
    goalHash: "abc123",
    goalKeywords: ["auth"],
    cwd: "/tmp/test",
    repoRemote: null,
    budgetTokens: 500_000,
    budgetWarnPct: 0.6,
    budgetBlockPct: 0.9,
    mode: "attended",
    status: "active",
    iterationCount: 10,
    cumulativeDrift: 0.3,
    driftHistory: [],
    tokenSpend: [],
    rollbackPoints: [],
    findingsLog: [],
    riskTrend: [],
    diffHashHistory: [],
    toolCallHistory: [],
    ...overrides,
  };
}

describe("generateReport", () => {
  test("stable drift → recommendation continue", () => {
    const session = makeSession({ cumulativeDrift: 0.2 });
    const report = generateReport(session);
    expect(report.sessionId).toBe("test-session");
    expect(report.driftSummary.status).toBe("stable");
    expect(report.recommendation).toBe("continue");
    expect(report.emergencyBrakeTriggered).toBe(false);
  });

  test("diverged drift → recommendation review-and-continue", () => {
    const session = makeSession({ cumulativeDrift: 0.75 });
    const report = generateReport(session);
    expect(report.driftSummary.status).toBe("diverged");
    expect(report.recommendation).toBe("review-and-continue");
  });

  test("emergency-braked → recommendation rollback", () => {
    const session = makeSession({ status: "emergency-braked" });
    const report = generateReport(session);
    expect(report.emergencyBrakeTriggered).toBe(true);
    expect(report.recommendation).toBe("rollback");
  });

  test("topFindings deduplicates and takes top 5", () => {
    const session = makeSession({
      findingsLog: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", rule: "r1", severity: "wake-you-up", path: "a.ts", whySummary: "x" },
        { iteration: 2, timestamp: "2026-06-17T00:02:00Z", rule: "r1", severity: "wake-you-up", path: "a.ts", whySummary: "x" },
        { iteration: 3, timestamp: "2026-06-17T00:03:00Z", rule: "r1", severity: "wake-you-up", path: "a.ts", whySummary: "x" },
        { iteration: 4, timestamp: "2026-06-17T00:04:00Z", rule: "r2", severity: "look-once", path: "b.ts", whySummary: "y" },
      ],
    });
    const report = generateReport(session);
    expect(report.topFindings.length).toBe(2);
    expect(report.topFindings[0]!.count).toBe(3);
    expect(report.topFindings[0]!.rule).toBe("r1");
  });

  test("rollbackPoints → safeRollbackPoint from last entry", () => {
    const session = makeSession({
      rollbackPoints: [
        { iteration: 3, timestamp: "2026-06-17T00:03:00Z", commitHash: "abc123" },
        { iteration: 7, timestamp: "2026-06-17T00:07:00Z", commitHash: "def456" },
      ],
    });
    const report = generateReport(session);
    expect(report.safeRollbackPoint).toEqual({
      iteration: 7,
      commitHash: "def456",
    });
  });

  test("no rollbackPoints → safeRollbackPoint null", () => {
    const report = generateReport(makeSession());
    expect(report.safeRollbackPoint).toBeNull();
  });

  test("drift trend detection", () => {
    const session = makeSession({
      driftHistory: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", iterationDrift: 0.2, cumulativeDrift: 0.1, goalRelevance: 0.8 },
        { iteration: 2, timestamp: "2026-06-17T00:02:00Z", iterationDrift: 0.4, cumulativeDrift: 0.2, goalRelevance: 0.6 },
        { iteration: 3, timestamp: "2026-06-17T00:03:00Z", iterationDrift: 0.6, cumulativeDrift: 0.3, goalRelevance: 0.4 },
      ],
      cumulativeDrift: 0.3,
    });
    const report = generateReport(session);
    expect(report.driftSummary.trend).toBe("worsening");
  });

  test("budget summary with token history", () => {
    const session = makeSession({
      budgetTokens: 500_000,
      tokenSpend: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", inputTokens: 40_000, outputTokens: 10_000, cacheReadTokens: 0, estCostUsd: 0 },
        { iteration: 2, timestamp: "2026-06-17T00:02:00Z", inputTokens: 50_000, outputTokens: 10_000, cacheReadTokens: 0, estCostUsd: 0 },
      ],
    });
    const report = generateReport(session);
    expect(report.budgetSummary.tokensUsed).toBe(110_000);
    expect(report.budgetSummary.budgetPct).toBeCloseTo(0.22);
    expect(report.budgetSummary.estimatedIterationsRemaining).toBeGreaterThan(0);
  });
});

describe("driftReason (S4)", () => {
  test("missingKeywords lists goal keywords absent from recent paths", () => {
    const session = makeSession({
      goalKeywords: ["auth", "login"],
      findingsLog: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", rule: "r1", severity: "wake-you-up", path: "src/billing/charge.ts", whySummary: "x" },
        { iteration: 2, timestamp: "2026-06-17T00:02:00Z", rule: "r1", severity: "wake-you-up", path: "src/billing/refund.ts", whySummary: "x" },
      ],
    });
    const report = generateReport(session);
    expect(report.driftSummary.reason.missingKeywords).toContain("auth");
    expect(report.driftSummary.reason.missingKeywords).toContain("login");
    expect(report.driftSummary.reason.recentPathsSample.length).toBeGreaterThan(0);
  });

  test("keyword present in path is not missing", () => {
    const session = makeSession({
      goalKeywords: ["auth"],
      findingsLog: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", rule: "r1", severity: "wake-you-up", path: "src/auth/login.ts", whySummary: "x" },
      ],
    });
    const report = generateReport(session);
    expect(report.driftSummary.reason.missingKeywords).not.toContain("auth");
  });

  test("rollbackCandidates returns up to 3, newest first", () => {
    const session = makeSession({
      rollbackPoints: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", commitHash: "aaa" },
        { iteration: 2, timestamp: "2026-06-17T00:02:00Z", commitHash: "bbb" },
        { iteration: 3, timestamp: "2026-06-17T00:03:00Z", commitHash: "ccc" },
        { iteration: 4, timestamp: "2026-06-17T00:04:00Z", commitHash: "ddd" },
      ],
    });
    const report = generateReport(session);
    expect(report.rollbackCandidates.length).toBe(3);
    expect(report.rollbackCandidates[0]!.commitHash).toBe("ddd");
    expect(report.rollbackCandidates[2]!.commitHash).toBe("bbb");
    expect(report.safeRollbackPoint!.commitHash).toBe("ddd");
  });
});

describe("S2 signal density (all required fields present)", () => {
  test("report carries all 5 mandatory MRA signal fields", () => {
    const session = makeSession({
      rollbackPoints: [{ iteration: 5, timestamp: "2026-06-17T00:05:00Z", commitHash: "xyz" }],
      tokenSpend: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", inputTokens: 10_000, outputTokens: 5_000, cacheReadTokens: 0, estCostUsd: 0 },
      ],
      findingsLog: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", rule: "r1", severity: "wake-you-up", path: "x.ts", whySummary: "y" },
      ],
      riskTrend: [
        { iteration: 1, timestamp: "2026-06-17T00:01:00Z", verdict: "pass", wakeCount: 0, lookCount: 0, cumulativeDrift: 0.1, budgetPct: 0.03 },
      ],
    });
    const report = generateReport(session);
    expect(report.iterationsWhileAway).toBeGreaterThan(0);
    expect(report.budgetSummary.budgetPct).toBeGreaterThanOrEqual(0);
    expect(report.driftSummary.trend).toBeDefined();
    expect(report.topFindings.length).toBeGreaterThan(0);
    expect(report.safeRollbackPoint).not.toBeNull();
  });
});

describe("renderReport", () => {
  test("produces readable output", () => {
    const report = generateReport(makeSession({ cumulativeDrift: 0.2 }));
    const rendered = renderReport(report);
    expect(rendered).toContain("Morning Report");
    expect(rendered).toContain("Drift: stable");
    expect(rendered).toContain("Recommendation: continue");
  });
});

describe("reportToJson", () => {
  test("produces valid JSON", () => {
    const report = generateReport(makeSession());
    const json = reportToJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.sessionId).toBe("test-session");
  });
});
