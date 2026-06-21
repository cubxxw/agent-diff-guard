import { describe, expect, test } from "bun:test";
import { pushReport, type PushChannel } from "./report-push";
import type { MorningReport } from "./types";

function makeReport(overrides: Partial<MorningReport> = {}): MorningReport {
  return {
    sessionId: "s1",
    generatedAt: "2026-06-19T08:00:00.000Z",
    iterationsWhileAway: 12,
    topFindings: [],
    driftSummary: {
      status: "stable",
      currentDrift: 0.2,
      trend: "stable",
      reason: { missingKeywords: [], recentPathsSample: [] },
    },
    budgetSummary: {
      tokensUsed: 100_000,
      budgetTotal: 500_000,
      budgetPct: 0.2,
      estimatedIterationsRemaining: 30,
    },
    safeRollbackPoint: { iteration: 10, commitHash: "abc123def" },
    rollbackCandidates: [{ iteration: 10, timestamp: "2026-06-19T07:50:00.000Z", commitHash: "abc123def" }],
    emergencyBrakeTriggered: false,
    recommendation: "continue",
    ...overrides,
  };
}

describe("pushReport — S3 reachability", () => {
  test("webhook succeeds via injected fetch", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse((init?.body as string) ?? "{}") });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const results = await pushReport(makeReport(), [{ kind: "webhook", url: "https://example.com/hook" }], {
      fetchImpl: fakeFetch,
    });
    expect(results.length).toBe(1);
    expect(results[0]!.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect((calls[0]!.body as { text: string }).text).toContain("Morning Report");
  });

  test("webhook 5xx is reported as failed, does not throw", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const results = await pushReport(makeReport(), [{ kind: "webhook", url: "https://example.com/x" }], {
      fetchImpl: fakeFetch,
    });
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.reason).toContain("500");
  });

  test("multiple channels: one failure does not block the other", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const results = await pushReport(
      makeReport(),
      [
        { kind: "webhook", url: "https://bad.example/x" },
        { kind: "stdout" },
      ],
      { fetchImpl: fakeFetch },
    );
    expect(results.length).toBe(2);
    expect(results.find((r) => r.channel === "stdout")!.ok).toBe(true);
    expect(results.find((r) => r.channel.startsWith("webhook"))!.ok).toBe(false);
  });

  test("at least one channel succeeds → S3 met", async () => {
    const fakeFetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const channels: PushChannel[] = [
      { kind: "webhook", url: "https://hooks.example/x" },
      { kind: "stdout" },
    ];
    const results = await pushReport(makeReport(), channels, { fetchImpl: fakeFetch });
    const anyOk = results.some((r) => r.ok);
    expect(anyOk).toBe(true);
  });
});
