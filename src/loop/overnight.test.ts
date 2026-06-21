import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  shouldEmergencyBrake,
  executeEmergencyBrake,
  unattendedVerdictOverride,
} from "./overnight";
import type { LoopSession, IterationResult } from "./types";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `adg-overnight-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.ADG_HOME = testDir;
});

afterEach(() => {
  delete process.env.ADG_HOME;
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function makeSession(overrides: Partial<LoopSession> = {}): LoopSession {
  return {
    id: "test-session-id",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    goal: "test goal",
    goalHash: "abc123",
    goalKeywords: ["test"],
    cwd: "/tmp/test",
    repoRemote: null,
    budgetTokens: 500_000,
    budgetWarnPct: 0.6,
    budgetBlockPct: 0.9,
    mode: "attended",
    status: "active",
    iterationCount: 5,
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

function makeResult(overrides: Partial<IterationResult> = {}): IterationResult {
  return {
    sessionId: "test-session-id",
    iteration: 1,
    timestamp: "2026-06-17T00:00:00.000Z",
    verdict: "block",
    verdictReasons: ["test block"],
    diffCheck: { filesChanged: 1, wakeFindings: 1, lookFindings: 0, findings: [] },
    driftCheck: { iterationDrift: 0.5, cumulativeDrift: 0.5, goalRelevance: 0.5 },
    budgetCheck: { tokensUsed: 100_000, budgetTotal: 500_000, budgetPct: 0.2, estimatedIterationsRemaining: 10, tokensPerIteration: 40_000 },
    policyCheck: { violationCount: 0, violations: [] },
    ...overrides,
  };
}

const mkRiskEntry = (verdict: "pass" | "warn" | "block", budgetPct = 0.3) => ({
  iteration: 1,
  timestamp: "2026-06-17T00:00:00.000Z",
  verdict,
  wakeCount: verdict === "block" ? 1 : 0,
  lookCount: 0,
  cumulativeDrift: 0.3,
  budgetPct,
});

describe("shouldEmergencyBrake", () => {
  test("3 consecutive blocks → brake", () => {
    const session = makeSession({
      riskTrend: [
        mkRiskEntry("block"),
        mkRiskEntry("block"),
        mkRiskEntry("block"),
      ],
    });
    const result = shouldEmergencyBrake(session);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain("3 consecutive");
  });

  test("2 blocks → no brake", () => {
    const session = makeSession({
      riskTrend: [
        mkRiskEntry("pass"),
        mkRiskEntry("block"),
        mkRiskEntry("block"),
      ],
    });
    expect(shouldEmergencyBrake(session).brake).toBe(false);
  });

  test("cumulativeDrift > 0.8 → brake", () => {
    const session = makeSession({ cumulativeDrift: 0.81 });
    const result = shouldEmergencyBrake(session);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain("drift");
  });

  test("cumulativeDrift = 0.8 → no brake", () => {
    const session = makeSession({ cumulativeDrift: 0.8 });
    expect(shouldEmergencyBrake(session).brake).toBe(false);
  });

  test("budgetPct > 0.95 → brake", () => {
    const session = makeSession({
      riskTrend: [mkRiskEntry("warn", 0.96)],
    });
    const result = shouldEmergencyBrake(session);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain("budget");
  });

  test("frozen-path wake-you-up → brake", () => {
    const session = makeSession({
      findingsLog: [
        {
          iteration: 1,
          timestamp: "2026-06-17T00:00:00.000Z",
          rule: "frozen-path-violation",
          severity: "wake-you-up",
          path: "deploy.sh",
          whySummary: "frozen path modified",
        },
      ],
    });
    const result = shouldEmergencyBrake(session);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain("frozen-path");
  });

  test("no triggers → no brake", () => {
    const session = makeSession({
      riskTrend: [mkRiskEntry("pass")],
      cumulativeDrift: 0.3,
    });
    expect(shouldEmergencyBrake(session).brake).toBe(false);
  });
});

describe("executeEmergencyBrake", () => {
  test("writes PAUSE file and updates session status", () => {
    mkdirSync(join(testDir, "loops"), { recursive: true });
    const session = makeSession();
    const sessionPath = join(testDir, "loops", `${session.id}.json`);
    writeFileSync(sessionPath, JSON.stringify(session), "utf8");

    executeEmergencyBrake(session, "test reason");

    expect(session.status).toBe("emergency-braked");
    const pausePath = join(testDir, "PAUSE");
    expect(existsSync(pausePath)).toBe(true);
  });
});

describe("unattendedVerdictOverride", () => {
  test("unattended block without emergency → downgraded to warn", () => {
    const session = makeSession({ mode: "unattended" });
    const result = makeResult({ verdict: "block" });
    const overridden = unattendedVerdictOverride(result, session);
    expect(overridden.verdict).toBe("warn");
    expect(overridden.verdictReasons).toContain("unattended: block downgraded to warn");
  });

  test("attended block → stays block", () => {
    const session = makeSession({ mode: "attended" });
    const result = makeResult({ verdict: "block" });
    const overridden = unattendedVerdictOverride(result, session);
    expect(overridden.verdict).toBe("block");
  });

  test("unattended pass → stays pass", () => {
    const session = makeSession({ mode: "unattended" });
    const result = makeResult({ verdict: "pass" });
    const overridden = unattendedVerdictOverride(result, session);
    expect(overridden.verdict).toBe("pass");
  });

  test("unattended block with emergency → stays block", () => {
    const session = makeSession({
      mode: "unattended",
      cumulativeDrift: 0.85,
    });
    const result = makeResult({ verdict: "block" });
    const overridden = unattendedVerdictOverride(result, session);
    expect(overridden.verdict).toBe("block");
  });
});
