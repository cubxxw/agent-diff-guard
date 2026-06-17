// compliance-export.test.ts — Tests for EU AI Act compliance export.
//
// Uses ADG_HOME isolation to prevent any interaction with real ~/.agent-diff-guard data.
// Privacy invariant: all tests assert that the raw goal text does NOT appear in any export.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sessionToComplianceRecords,
  exportComplianceJsonLd,
  exportComplianceCsv,
  complianceReport,
  type ComplianceRecord,
} from "./compliance-export";
import type { LoopSession } from "./types";

// ---------------------------------------------------------------------------
// Test isolation — ADG_HOME points to a temp directory
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `adg-compliance-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.ADG_HOME = testDir;
});

afterEach(() => {
  delete process.env.ADG_HOME;
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mock LoopSession builder
// ---------------------------------------------------------------------------

const GOAL_TEXT = "Refactor the authentication module to use JWT tokens";
const GOAL_HASH = "abc123def456"; // synthetic hash — does NOT appear in GOAL_TEXT

function mockSession(overrides?: Partial<LoopSession>): LoopSession {
  const base: LoopSession = {
    id: "01HY00000000000000000001",
    createdAt: "2026-06-17T08:00:00.000Z",
    updatedAt: "2026-06-17T09:00:00.000Z",
    goal: GOAL_TEXT,
    goalHash: GOAL_HASH,
    goalKeywords: ["refactor", "authentication", "jwt"],
    cwd: "/tmp/test-repo",
    repoRemote: null,
    budgetTokens: 10000,
    budgetWarnPct: 0.6,
    budgetBlockPct: 0.9,
    mode: "unattended",
    status: "active",
    iterationCount: 2,
    cumulativeDrift: 0.15,
    driftHistory: [
      {
        iteration: 1,
        timestamp: "2026-06-17T08:10:00.000Z",
        iterationDrift: 0.1,
        cumulativeDrift: 0.1,
        goalRelevance: 0.9,
      },
      {
        iteration: 2,
        timestamp: "2026-06-17T08:20:00.000Z",
        iterationDrift: 0.05,
        cumulativeDrift: 0.15,
        goalRelevance: 0.85,
      },
    ],
    tokenSpend: [
      {
        iteration: 1,
        timestamp: "2026-06-17T08:10:00.000Z",
        inputTokens: 500,
        outputTokens: 300,
        cacheReadTokens: 0,
        estCostUsd: 0.004,
      },
      {
        iteration: 2,
        timestamp: "2026-06-17T08:20:00.000Z",
        inputTokens: 600,
        outputTokens: 400,
        cacheReadTokens: 0,
        estCostUsd: 0.005,
      },
    ],
    rollbackPoints: [
      {
        iteration: 1,
        timestamp: "2026-06-17T08:10:00.000Z",
        commitHash: "deadbeef1234",
      },
    ],
    findingsLog: [
      {
        iteration: 1,
        timestamp: "2026-06-17T08:10:00.000Z",
        rule: "hardcoded-secret",
        severity: "wake-you-up",
        path: "src/auth.ts",
        whySummary: "API key found in source",
      },
      {
        iteration: 2,
        timestamp: "2026-06-17T08:20:00.000Z",
        rule: "test-deleted",
        severity: "look-once",
        path: "src/auth.test.ts",
        whySummary: "Test file removed",
      },
    ],
    riskTrend: [
      {
        iteration: 1,
        timestamp: "2026-06-17T08:10:00.000Z",
        verdict: "warn",
        wakeCount: 1,
        lookCount: 0,
        cumulativeDrift: 0.1,
        budgetPct: 0.08,
      },
      {
        iteration: 2,
        timestamp: "2026-06-17T08:20:00.000Z",
        verdict: "pass",
        wakeCount: 0,
        lookCount: 1,
        cumulativeDrift: 0.15,
        budgetPct: 0.17,
      },
    ],
    diffHashHistory: [],
    toolCallHistory: [],
    ...overrides,
  };
  return base;
}

// ---------------------------------------------------------------------------
// sessionToComplianceRecords — six-category extraction
// ---------------------------------------------------------------------------

describe("sessionToComplianceRecords", () => {
  test("returns one record per riskTrend iteration", () => {
    const session = mockSession();
    const records = sessionToComplianceRecords(session);
    expect(records.length).toBe(2);
  });

  test("identity contains session id and goal hash", () => {
    const session = mockSession();
    const [r1] = sessionToComplianceRecords(session);
    expect(r1!.identity).toContain(session.id);
    expect(r1!.identity).toContain(GOAL_HASH);
  });

  test("inputPrompt is goal hash only", () => {
    const session = mockSession();
    const records = sessionToComplianceRecords(session);
    for (const r of records) {
      expect(r.inputPrompt).toBe(GOAL_HASH);
    }
  });

  test("toolInvocations contains rollback commit for iter 1", () => {
    const session = mockSession();
    const [r1] = sessionToComplianceRecords(session);
    expect(r1!.toolInvocations).toContain("rollback:deadbeef1234");
  });

  test("toolInvocations is empty for iter 2 (no rollback at iter 2)", () => {
    const session = mockSession();
    const records = sessionToComplianceRecords(session);
    const r2 = records[1]!;
    expect(r2.toolInvocations).toHaveLength(0);
  });

  test("decisionPoints contains verdict sequence", () => {
    const session = mockSession();
    const [r1, r2] = sessionToComplianceRecords(session);
    expect(r1!.decisionPoints[0]).toContain("warn");
    expect(r2!.decisionPoints[0]).toContain("pass");
  });

  test("decisionPoints contains wake and look counts", () => {
    const session = mockSession();
    const [r1] = sessionToComplianceRecords(session);
    expect(r1!.decisionPoints[0]).toContain("wake=1");
    expect(r1!.decisionPoints[0]).toContain("look=0");
  });

  test("outputs contains findings log entries", () => {
    const session = mockSession();
    const [r1, r2] = sessionToComplianceRecords(session);
    expect(r1!.outputs.length).toBe(1);
    expect(r1!.outputs[0]).toContain("hardcoded-secret");
    expect(r1!.outputs[0]).toContain("src/auth.ts");
    expect(r2!.outputs.length).toBe(1);
    expect(r2!.outputs[0]).toContain("test-deleted");
  });

  test("latencyMetadata contains token and drift data", () => {
    const session = mockSession();
    const [r1] = sessionToComplianceRecords(session);
    const meta = r1!.latencyMetadata;
    expect(meta.inputTokens).toBe(500);
    expect(meta.outputTokens).toBe(300);
    expect(meta.iterationDrift).toBe(0.1);
    expect(meta.goalRelevance).toBe(0.9);
    expect(meta.budgetPct).toBeCloseTo(0.08);
  });

  test("session with no riskTrend returns a single summary record", () => {
    const session = mockSession({ riskTrend: [] });
    const records = sessionToComplianceRecords(session);
    expect(records.length).toBe(1);
    expect(records[0]!.decisionPoints).toHaveLength(0);
    expect(records[0]!.toolInvocations).toHaveLength(0);
  });

  // Privacy invariant — must pass
  test("PRIVACY: raw goal text never appears in any field", () => {
    const session = mockSession();
    const records = sessionToComplianceRecords(session);
    for (const r of records) {
      expect(r.identity).not.toContain(GOAL_TEXT);
      expect(r.inputPrompt).not.toContain(GOAL_TEXT);
      expect(r.toolInvocations.join("")).not.toContain(GOAL_TEXT);
      expect(r.decisionPoints.join("")).not.toContain(GOAL_TEXT);
      expect(r.outputs.join("")).not.toContain(GOAL_TEXT);
      expect(JSON.stringify(r.latencyMetadata)).not.toContain(GOAL_TEXT);
    }
  });
});

// ---------------------------------------------------------------------------
// exportComplianceJsonLd
// ---------------------------------------------------------------------------

describe("exportComplianceJsonLd", () => {
  function buildRecords(): ComplianceRecord[] {
    return sessionToComplianceRecords(mockSession());
  }

  test("output is valid JSON", () => {
    const json = exportComplianceJsonLd(buildRecords());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test("output contains @context and @type Dataset", () => {
    const doc = JSON.parse(exportComplianceJsonLd(buildRecords()));
    expect(doc["@context"]).toBeDefined();
    expect(doc["@type"]).toBe("Dataset");
  });

  test("@graph contains one entry per record", () => {
    const records = buildRecords();
    const doc = JSON.parse(exportComplianceJsonLd(records));
    expect(doc["@graph"]).toHaveLength(records.length);
  });

  test("each graph node has @type AuditRecord", () => {
    const doc = JSON.parse(exportComplianceJsonLd(buildRecords()));
    for (const node of doc["@graph"]) {
      expect(node["@type"]).toBe("adg:AuditRecord");
    }
  });

  test("all six compliance fields present in each graph node", () => {
    const doc = JSON.parse(exportComplianceJsonLd(buildRecords()));
    for (const node of doc["@graph"]) {
      expect(node.identity).toBeDefined();
      expect(node.inputPrompt).toBeDefined();
      expect(node.toolInvocations).toBeDefined();
      expect(node.decisionPoints).toBeDefined();
      expect(node.outputs).toBeDefined();
      expect(node.latencyMetadata).toBeDefined();
    }
  });

  // Privacy invariant
  test("PRIVACY: raw goal text never appears in JSON-LD output", () => {
    const json = exportComplianceJsonLd(buildRecords());
    expect(json).not.toContain(GOAL_TEXT);
  });
});

// ---------------------------------------------------------------------------
// exportComplianceCsv
// ---------------------------------------------------------------------------

describe("exportComplianceCsv", () => {
  function buildRecords(): ComplianceRecord[] {
    return sessionToComplianceRecords(mockSession());
  }

  test("output contains a header row", () => {
    const csv = exportComplianceCsv(buildRecords());
    const firstLine = csv.split("\n")[0]!;
    expect(firstLine).toContain("identity");
    expect(firstLine).toContain("inputPrompt");
    expect(firstLine).toContain("toolInvocations");
    expect(firstLine).toContain("decisionPoints");
    expect(firstLine).toContain("outputs");
    expect(firstLine).toContain("latencyMetadata");
  });

  test("output has header + one data row per record", () => {
    const records = buildRecords();
    const csv = exportComplianceCsv(records);
    const lines = csv.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(records.length + 1);
  });

  test("array fields are joined with semicolons", () => {
    // Session with 2 findings on the same iteration to get multi-value outputs
    const session = mockSession({
      findingsLog: [
        {
          iteration: 1,
          timestamp: "2026-06-17T08:10:00.000Z",
          rule: "hardcoded-secret",
          severity: "wake-you-up",
          path: "src/auth.ts",
          whySummary: "API key found",
        },
        {
          iteration: 1,
          timestamp: "2026-06-17T08:10:00.000Z",
          rule: "test-deleted",
          severity: "look-once",
          path: "src/auth.test.ts",
          whySummary: "Test removed",
        },
      ],
      riskTrend: [
        {
          iteration: 1,
          timestamp: "2026-06-17T08:10:00.000Z",
          verdict: "warn",
          wakeCount: 1,
          lookCount: 1,
          cumulativeDrift: 0.1,
          budgetPct: 0.08,
        },
      ],
    });
    const csv = exportComplianceCsv(sessionToComplianceRecords(session));
    expect(csv).toContain(";");
  });

  test("all rows are double-quoted", () => {
    const csv = exportComplianceCsv(buildRecords());
    const dataLines = csv.split("\n").slice(1).filter((l) => l.trim());
    for (const line of dataLines) {
      expect(line.startsWith('"')).toBe(true);
    }
  });

  // Privacy invariant
  test("PRIVACY: raw goal text never appears in CSV output", () => {
    const csv = exportComplianceCsv(buildRecords());
    expect(csv).not.toContain(GOAL_TEXT);
  });
});

// ---------------------------------------------------------------------------
// complianceReport — integration (isolated ADG_HOME, no real sessions)
// ---------------------------------------------------------------------------

describe("complianceReport", () => {
  test("returns empty records when no sessions exist", async () => {
    const result = await complianceReport();
    expect(result.records).toHaveLength(0);
    expect(result.chainValid).toBe(true); // empty chain is valid
    expect(result.total).toBe(0);
  });

  test("chainValid and total are present in result", async () => {
    const result = await complianceReport();
    expect(typeof result.chainValid).toBe("boolean");
    expect(typeof result.total).toBe("number");
  });

  test("since filter with future date returns empty records", async () => {
    const result = await complianceReport({ since: "2099-01-01T00:00:00.000Z" });
    expect(result.records).toHaveLength(0);
  });
});
