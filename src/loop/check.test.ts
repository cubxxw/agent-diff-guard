import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkIteration, quickCheck } from "./check";
import type { CheckDeps } from "./check";
import { startSession } from "./session";
import type { FileChange, Finding } from "../rules";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `adg-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.ADG_HOME = testDir;
});

afterEach(() => {
  delete process.env.ADG_HOME;
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

const noopDeps: Partial<CheckDeps> = {
  parseDiff: () => [],
  runRules: () => [],
  loadPolicy: () => ({ source: "", policies: [] }),
  detectViolations: () => [],
  buildFindingMeta: (f: Finding) => ({
    rule: f.rule,
    severity: f.severity,
    path: f.path,
    whySummary: f.why.slice(0, 80),
    hasEvidence: false,
  }),
};

describe("checkIteration", () => {
  test("all pass → verdict pass", async () => {
    const session = await startSession({
      goal: "implement login feature",
      cwd: "/tmp/test-repo",
    });

    const result = await checkIteration({
      sessionId: session.id,
      deps: {
        ...noopDeps,
        parseDiff: () => [
          { path: "src/login.ts", kind: "modified", addedLines: [], removedLines: [] },
        ],
      },
    });

    expect(result.verdict).toBe("pass");
    expect(result.verdictReasons).toContain("all checks passed");
    expect(result.iteration).toBe(1);
    expect(result.diffCheck.filesChanged).toBe(1);
  });

  test("wake finding → verdict block", async () => {
    const session = await startSession({
      goal: "implement auth",
      cwd: "/tmp/test-repo-wake",
    });

    const wakeFinding: Finding = {
      rule: "hardcoded-secret",
      severity: "wake-you-up",
      path: "src/config.ts",
      why: "Possible hardcoded secret detected",
    };

    const result = await checkIteration({
      sessionId: session.id,
      deps: {
        ...noopDeps,
        parseDiff: () => [
          { path: "src/config.ts", kind: "modified", addedLines: ["API_KEY=abc123"], removedLines: [] },
        ],
        runRules: () => [wakeFinding],
      },
    });

    expect(result.verdict).toBe("block");
    expect(result.diffCheck.wakeFindings).toBe(1);
    expect(result.verdictReasons.some((r) => r.includes("wake-you-up"))).toBe(true);
  });

  test("drift warn + budget pass → verdict warn", async () => {
    const session = await startSession({
      goal: "implement login feature",
      cwd: "/tmp/test-repo-drift",
    });

    const result = await checkIteration({
      sessionId: session.id,
      deps: {
        ...noopDeps,
        parseDiff: () => [
          { path: "ci.yml", kind: "modified", addedLines: [], removedLines: [] },
          { path: "docker-compose.yml", kind: "modified", addedLines: [], removedLines: [] },
          { path: "Makefile", kind: "modified", addedLines: [], removedLines: [] },
        ],
      },
    });

    // All 3 files are off-goal → iterationDrift=1.0, cumulative=0.3 after EMA
    expect(result.driftCheck.iterationDrift).toBe(1.0);
    expect(result.verdict).toBe("pass");

    // Run 1 more iteration to push cumulative to ~0.51 (warn zone 0.4-0.7)
    const result2 = await checkIteration({
      sessionId: session.id,
      deps: {
        ...noopDeps,
        parseDiff: () => [
          { path: "ci.yml", kind: "modified", addedLines: [], removedLines: [] },
        ],
      },
    });

    expect(result2.driftCheck.cumulativeDrift).toBeGreaterThanOrEqual(0.4);
    expect(result2.driftCheck.cumulativeDrift).toBeLessThanOrEqual(0.7);
    expect(result2.verdict).toBe("warn");
  });

  test("throws for non-existent session", async () => {
    expect(
      checkIteration({ sessionId: "nonexistent", deps: noopDeps }),
    ).rejects.toThrow("not found");
  });

  test("increments iteration count", async () => {
    const session = await startSession({
      goal: "test iterations",
      cwd: "/tmp/iter-test",
    });

    const r1 = await checkIteration({ sessionId: session.id, deps: noopDeps });
    const r2 = await checkIteration({ sessionId: session.id, deps: noopDeps });

    expect(r1.iteration).toBe(1);
    expect(r2.iteration).toBe(2);
  });
});

describe("quickCheck", () => {
  test("normal file → pass", () => {
    const result = quickCheck({ cwd: "/tmp", filePath: "src/app.ts" });
    expect(result.verdict).toBe("pass");
    expect(result.notes.length).toBe(0);
    expect(result.elapsedMs).toBeLessThan(500);
  });

  test("sensitive path → warn", () => {
    const result = quickCheck({ cwd: "/tmp", filePath: ".env" });
    expect(result.verdict).toBe("warn");
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeLessThan(500);
  });
});
