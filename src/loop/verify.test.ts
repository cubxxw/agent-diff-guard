import { describe, expect, test } from "bun:test";
import {
  generateAcceptanceReport,
  renderAcceptanceReport,
  acceptanceReportToJson,
} from "./verify";
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
    cumulativeDrift: 0.2,
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

function wakeFinding(rule: string, path: string, iteration = 1) {
  return {
    iteration,
    timestamp: "2026-06-17T00:30:00.000Z",
    rule,
    severity: "wake-you-up" as const,
    path,
    whySummary: "danger",
  };
}

function lookFinding(rule: string, path: string, iteration = 1) {
  return {
    iteration,
    timestamp: "2026-06-17T00:30:00.000Z",
    rule,
    severity: "look-once" as const,
    path,
    whySummary: "minor",
  };
}

describe("generateAcceptanceReport — clean pass", () => {
  test("no findings, low drift, low budget → pass with no reasons", () => {
    const r = generateAcceptanceReport(makeSession());
    expect(r.verdict).toBe("pass");
    expect(r.reasons).toEqual([]);
    expect(r.totals.wakeFindings).toBe(0);
    expect(r.totals.lookFindings).toBe(0);
    expect(r.unresolvedWakeFindings).toEqual([]);
  });

  test("carries session identity and iteration count", () => {
    const r = generateAcceptanceReport(makeSession({ iterationCount: 7 }));
    expect(r.sessionId).toBe("test-session");
    expect(r.goal).toBe("implement auth");
    expect(r.iterationsTotal).toBe(7);
  });
});

describe("generateAcceptanceReport — wake findings block", () => {
  test("a single wake finding forces needs-review", () => {
    const session = makeSession({
      findingsLog: [wakeFinding("hardcoded-secret", "src/config.ts")],
    });
    const r = generateAcceptanceReport(session);
    expect(r.verdict).toBe("needs-review");
    expect(r.totals.wakeFindings).toBe(1);
    expect(r.unresolvedWakeFindings).toHaveLength(1);
    expect(r.reasons.some((x) => x.category === "findings" && x.level === "block")).toBe(true);
  });

  test("same rule:path repeated across iterations dedups to one concern with count", () => {
    const session = makeSession({
      findingsLog: [
        wakeFinding("hardcoded-secret", "src/config.ts", 1),
        wakeFinding("hardcoded-secret", "src/config.ts", 2),
        wakeFinding("hardcoded-secret", "src/config.ts", 3),
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.totals.wakeFindings).toBe(3); // raw occurrences
    expect(r.unresolvedWakeFindings).toHaveLength(1); // distinct concern
    expect(r.unresolvedWakeFindings[0]!.count).toBe(3);
  });

  test("distinct wake findings are sorted by occurrence count desc", () => {
    const session = makeSession({
      findingsLog: [
        wakeFinding("ruleA", "a.ts", 1),
        wakeFinding("ruleB", "b.ts", 1),
        wakeFinding("ruleB", "b.ts", 2),
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.unresolvedWakeFindings[0]!.rule).toBe("ruleB");
    expect(r.unresolvedWakeFindings[0]!.count).toBe(2);
  });
});

describe("generateAcceptanceReport — look findings warn only", () => {
  test("look-once findings alone do NOT block (still pass)", () => {
    const session = makeSession({
      findingsLog: [lookFinding("style-nit", "src/a.ts")],
    });
    const r = generateAcceptanceReport(session);
    expect(r.verdict).toBe("pass");
    expect(r.totals.lookFindings).toBe(1);
    expect(r.reasons.some((x) => x.category === "findings" && x.level === "warn")).toBe(true);
  });
});

describe("generateAcceptanceReport — drift", () => {
  test("diverged drift (>0.7) blocks", () => {
    const r = generateAcceptanceReport(makeSession({ cumulativeDrift: 0.85 }));
    expect(r.verdict).toBe("needs-review");
    expect(r.reasons.some((x) => x.category === "drift" && x.level === "block")).toBe(true);
  });

  test("elevated drift (0.4–0.7) warns but passes", () => {
    const r = generateAcceptanceReport(makeSession({ cumulativeDrift: 0.5 }));
    expect(r.verdict).toBe("pass");
    expect(r.reasons.some((x) => x.category === "drift" && x.level === "warn")).toBe(true);
  });
});

describe("generateAcceptanceReport — policy / safety / budget", () => {
  test("a block iteration with zero wake findings counts as a non-finding block and blocks", () => {
    const session = makeSession({
      riskTrend: [
        {
          iteration: 1,
          timestamp: "2026-06-17T00:30:00.000Z",
          verdict: "block",
          wakeCount: 0,
          lookCount: 0,
          cumulativeDrift: 0.1,
          budgetPct: 0.1,
        },
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.totals.nonFindingBlocks).toBe(1);
    expect(r.verdict).toBe("needs-review");
  });

  test("a block iteration WITH wake findings is not double-counted as a non-finding block", () => {
    const session = makeSession({
      riskTrend: [
        {
          iteration: 1,
          timestamp: "2026-06-17T00:30:00.000Z",
          verdict: "block",
          wakeCount: 2,
          lookCount: 0,
          cumulativeDrift: 0.1,
          budgetPct: 0.1,
        },
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.totals.nonFindingBlocks).toBe(0);
  });

  test("emergency-braked session blocks", () => {
    const r = generateAcceptanceReport(makeSession({ status: "emergency-braked" }));
    expect(r.verdict).toBe("needs-review");
    expect(r.reasons.some((x) => x.category === "safety")).toBe(true);
  });

  test("budget block threshold reached → needs-review", () => {
    const session = makeSession({
      budgetTokens: 1000,
      tokenSpend: [
        {
          iteration: 1,
          timestamp: "2026-06-17T00:30:00.000Z",
          inputTokens: 600,
          outputTokens: 350,
          cacheReadTokens: 0,
          estCostUsd: 0,
        },
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.totals.budgetPct).toBeCloseTo(0.95, 2);
    expect(r.verdict).toBe("needs-review");
    expect(r.reasons.some((x) => x.category === "budget" && x.level === "block")).toBe(true);
  });

  test("budget warn band warns but passes", () => {
    const session = makeSession({
      budgetTokens: 1000,
      tokenSpend: [
        {
          iteration: 1,
          timestamp: "2026-06-17T00:30:00.000Z",
          inputTokens: 400,
          outputTokens: 300,
          cacheReadTokens: 0,
          estCostUsd: 0,
        },
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.totals.budgetPct).toBeCloseTo(0.7, 2);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.some((x) => x.category === "budget" && x.level === "warn")).toBe(true);
  });
});

describe("generateAcceptanceReport — rollback point", () => {
  test("surfaces the last recorded rollback checkpoint", () => {
    const session = makeSession({
      rollbackPoints: [
        { iteration: 3, timestamp: "2026-06-17T00:10:00.000Z", commitHash: "aaa" },
        { iteration: 8, timestamp: "2026-06-17T00:40:00.000Z", commitHash: "bbb" },
      ],
    });
    const r = generateAcceptanceReport(session);
    expect(r.safeRollbackPoint).toEqual({ iteration: 8, commitHash: "bbb" });
  });

  test("null rollback point when none recorded", () => {
    const r = generateAcceptanceReport(makeSession());
    expect(r.safeRollbackPoint).toBeNull();
  });
});

describe("rendering", () => {
  test("renderAcceptanceReport includes verdict and key totals", () => {
    const session = makeSession({
      findingsLog: [wakeFinding("hardcoded-secret", "src/config.ts")],
    });
    const text = renderAcceptanceReport(generateAcceptanceReport(session));
    expect(text).toContain("Acceptance Gate");
    expect(text).toContain("NEEDS-REVIEW");
    expect(text).toContain("hardcoded-secret");
    expect(text).toContain("Reasons:");
  });

  test("acceptanceReportToJson is valid JSON round-trip", () => {
    const r = generateAcceptanceReport(makeSession());
    const parsed = JSON.parse(acceptanceReportToJson(r));
    expect(parsed.sessionId).toBe("test-session");
    expect(parsed.verdict).toBe("pass");
  });
});
