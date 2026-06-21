// Production-grade end-to-end assertions for MRA (Morning Report Actionability).
// Stop condition for /goal: this file must stay green.
//
// S1 coverage: every active session yields exactly one report per trigger
// S2 signal density: report carries iterations / token% / drift trend / top findings / rollback commit
// S3 reachability: at least one push channel succeeds
// S4 closed loop: rollback commit copyable + drift trend explains "why" (missing keywords)

import { describe, expect, test } from "bun:test";
import { generateReport, reportToJson } from "./report";
import { pushReport } from "./report-push";
import type { LoopSession, MorningReport } from "./types";

function mockSession(id: string, overrides: Partial<LoopSession> = {}): LoopSession {
  return {
    id,
    createdAt: "2026-06-18T22:00:00.000Z",
    updatedAt: "2026-06-19T08:00:00.000Z",
    goal: "implement auth login endpoint",
    goalHash: "h1",
    goalKeywords: ["auth", "login"],
    cwd: "/tmp/test",
    repoRemote: null,
    budgetTokens: 500_000,
    budgetWarnPct: 0.6,
    budgetBlockPct: 0.9,
    mode: "unattended",
    status: "active",
    iterationCount: 10,
    cumulativeDrift: 0.55,
    driftHistory: Array.from({ length: 10 }, (_, i) => ({
      iteration: i + 1,
      timestamp: `2026-06-18T${22 + Math.floor(i / 6)}:${(i * 6) % 60}:00.000Z`,
      iterationDrift: 0.2 + i * 0.05,
      cumulativeDrift: 0.1 + i * 0.05,
      goalRelevance: 0.9 - i * 0.05,
    })),
    tokenSpend: Array.from({ length: 10 }, (_, i) => ({
      iteration: i + 1,
      timestamp: `2026-06-18T${22 + Math.floor(i / 6)}:${(i * 6) % 60}:00.000Z`,
      inputTokens: 18_000,
      outputTokens: 7_000,
      cacheReadTokens: 0,
      estCostUsd: 0,
    })),
    rollbackPoints: [
      { iteration: 3, timestamp: "2026-06-18T23:00:00.000Z", commitHash: "a1b2c3d4e5f6" },
      { iteration: 6, timestamp: "2026-06-19T02:00:00.000Z", commitHash: "9f8e7d6c5b4a" },
      { iteration: 9, timestamp: "2026-06-19T06:00:00.000Z", commitHash: "112233445566" },
    ],
    findingsLog: [
      { iteration: 8, timestamp: "2026-06-19T05:00:00.000Z", rule: "unsafe-shell", severity: "wake-you-up", path: "src/billing/charge.ts", whySummary: "spawn no shell:false" },
      { iteration: 9, timestamp: "2026-06-19T06:00:00.000Z", rule: "unsafe-shell", severity: "wake-you-up", path: "src/billing/charge.ts", whySummary: "spawn no shell:false" },
      { iteration: 10, timestamp: "2026-06-19T07:00:00.000Z", rule: "secret-leak", severity: "wake-you-up", path: "src/billing/refund.ts", whySummary: "AWS_SECRET" },
    ],
    riskTrend: Array.from({ length: 10 }, (_, i) => ({
      iteration: i + 1,
      timestamp: `2026-06-18T${22 + Math.floor(i / 6)}:${(i * 6) % 60}:00.000Z`,
      verdict: i < 8 ? "pass" : "warn" as const,
      wakeCount: i < 8 ? 0 : 1,
      lookCount: 0,
      cumulativeDrift: 0.1 + i * 0.05,
      budgetPct: 0.05 * (i + 1),
    })),
    diffHashHistory: [],
    toolCallHistory: [],
    ...overrides,
  };
}

describe("MRA end-to-end", () => {
  test("S1 — every active session yields exactly one report", () => {
    const sessions = [
      mockSession("s1"),
      mockSession("s2"),
      mockSession("s3", { status: "stopped" }),
    ];
    const active = sessions.filter((s) => s.status === "active");
    const reports = active.map((s) => generateReport(s));
    expect(reports.length).toBe(active.length);
    expect(reports.length).toBe(2);
    const ids = new Set(reports.map((r) => r.sessionId));
    expect(ids.size).toBe(2);
  });

  test("S2 — every report carries all mandatory signal fields", () => {
    const report = generateReport(mockSession("s1"));
    const required: Array<(r: MorningReport) => boolean> = [
      (r) => Number.isFinite(r.iterationsWhileAway) && r.iterationsWhileAway > 0,
      (r) => Number.isFinite(r.budgetSummary.budgetPct) && r.budgetSummary.budgetPct >= 0,
      (r) => ["improving", "stable", "worsening"].includes(r.driftSummary.trend),
      (r) => Array.isArray(r.topFindings) && r.topFindings.length > 0,
      (r) => r.safeRollbackPoint !== null && typeof r.safeRollbackPoint.commitHash === "string",
    ];
    for (const check of required) {
      expect(check(report)).toBe(true);
    }
    // JSON serializable — required for /api/loop/report and webhook payload
    expect(() => JSON.parse(reportToJson(report))).not.toThrow();
  });

  test("S3 — at least one push channel succeeds (Slack-shaped webhook)", async () => {
    const report = generateReport(mockSession("s1"));
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      // Webhook receives both rendered text AND structured report for downstream parsing
      if (!body.text || !body.report) return new Response("bad", { status: 400 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const results = await pushReport(
      report,
      [
        { kind: "webhook", url: "https://hooks.example/slack" },
        { kind: "stdout" },
      ],
      { fetchImpl: fakeFetch },
    );
    const anyOk = results.some((r) => r.ok);
    expect(anyOk).toBe(true);
  });

  test("S4 — rollback commit copyable + drift trend explains 'why'", () => {
    const report = generateReport(mockSession("s1"));
    // Copyable: full hash, not truncated
    expect(report.safeRollbackPoint).not.toBeNull();
    expect(report.safeRollbackPoint!.commitHash.length).toBeGreaterThanOrEqual(7);
    // Drift trend has a reason
    expect(Array.isArray(report.driftSummary.reason.missingKeywords)).toBe(true);
    // Mock session's goal is "auth login" but recent findings hit billing/* → both keywords missing
    expect(report.driftSummary.reason.missingKeywords).toContain("auth");
    expect(report.driftSummary.reason.missingKeywords).toContain("login");
    expect(report.driftSummary.reason.recentPathsSample.length).toBeGreaterThan(0);
    // At least 1 alternative rollback for risk-averse rollback path
    expect(report.rollbackCandidates.length).toBeGreaterThanOrEqual(2);
  });

  test("MRA stop condition: full pipeline produces actionable JSON for downstream UI/Slack", async () => {
    const sessions = [mockSession("s1"), mockSession("s2")];
    const fakeFetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const pipeline = await Promise.all(
      sessions.map(async (s) => {
        const report = generateReport(s);
        const pushResults = await pushReport(report, [{ kind: "webhook", url: "https://x.example" }], {
          fetchImpl: fakeFetch,
        });
        return { sessionId: s.id, report, pushResults };
      }),
    );
    expect(pipeline.length).toBe(2);
    for (const entry of pipeline) {
      expect(entry.report.recommendation).toMatch(/^(continue|review-and-continue|rollback|stop)$/);
      expect(entry.pushResults.every((r) => r.ok)).toBe(true);
    }
  });
});
