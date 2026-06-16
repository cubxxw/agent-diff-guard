import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  startSession,
  loadSession,
  saveSession,
  stopSession,
  listSessions,
  activeSessionForCwd,
  loopsDir,
} from "./session";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `adg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.ADG_HOME = testDir;
});

afterEach(() => {
  delete process.env.ADG_HOME;
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("loopsDir", () => {
  test("creates loops subdirectory under ADG_HOME", () => {
    const dir = loopsDir();
    expect(dir).toBe(join(testDir, "loops"));
    expect(existsSync(dir)).toBe(true);
  });
});

describe("startSession", () => {
  test("creates session file and returns LoopSession", async () => {
    const session = await startSession({
      goal: "implement auth feature",
      cwd: "/tmp/test-repo",
    });

    expect(session.id).toBeTruthy();
    expect(session.goal).toBe("implement auth feature");
    expect(session.goalKeywords).toContain("implement");
    expect(session.goalKeywords).toContain("auth");
    expect(session.goalKeywords).toContain("feature");
    expect(session.status).toBe("active");
    expect(session.mode).toBe("attended");
    expect(session.budgetTokens).toBeNull();
    expect(session.iterationCount).toBe(0);
    expect(session.cumulativeDrift).toBe(0);

    const filePath = join(loopsDir(), `${session.id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  test("sets budgetTokens and mode when provided", async () => {
    const session = await startSession({
      goal: "build dashboard",
      cwd: "/tmp/test-repo-2",
      budgetTokens: 500_000,
      mode: "unattended",
    });

    expect(session.budgetTokens).toBe(500_000);
    expect(session.mode).toBe("unattended");
  });

  test("throws when active session already exists for cwd", async () => {
    await startSession({
      goal: "first goal",
      cwd: "/tmp/same-repo",
    });

    expect(
      startSession({
        goal: "second goal",
        cwd: "/tmp/same-repo",
      }),
    ).rejects.toThrow("Already have active session");
  });
});

describe("loadSession", () => {
  test("loads a saved session back", async () => {
    const original = await startSession({
      goal: "test loading",
      cwd: "/tmp/load-test",
    });

    const loaded = loadSession(original.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(original.id);
    expect(loaded!.goal).toBe("test loading");
    expect(loaded!.status).toBe("active");
  });

  test("returns null for non-existent session", () => {
    expect(loadSession("nonexistent-id")).toBeNull();
  });
});

describe("saveSession", () => {
  test("updates session and persists", async () => {
    const session = await startSession({
      goal: "test save",
      cwd: "/tmp/save-test",
    });

    session.iterationCount = 5;
    session.cumulativeDrift = 0.3;
    session.updatedAt = "2020-01-01T00:00:00.000Z";
    saveSession(session);

    const reloaded = loadSession(session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.iterationCount).toBe(5);
    expect(reloaded!.cumulativeDrift).toBe(0.3);
    expect(reloaded!.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("stopSession", () => {
  test("sets status to stopped", async () => {
    const session = await startSession({
      goal: "test stop",
      cwd: "/tmp/stop-test",
    });

    const result = stopSession(session.id);
    expect(result).toBe(true);

    const reloaded = loadSession(session.id);
    expect(reloaded!.status).toBe("stopped");
  });

  test("returns false for non-existent session", () => {
    expect(stopSession("nonexistent")).toBe(false);
  });
});

describe("listSessions", () => {
  test("lists all sessions", async () => {
    await startSession({ goal: "goal one", cwd: "/tmp/repo-a" });
    await startSession({ goal: "goal two", cwd: "/tmp/repo-b" });

    const all = listSessions();
    expect(all.length).toBe(2);
  });

  test("returns empty when no sessions", () => {
    expect(listSessions().length).toBe(0);
  });
});

describe("activeSessionForCwd", () => {
  test("finds active session for cwd", async () => {
    const session = await startSession({
      goal: "active goal",
      cwd: "/tmp/active-test",
    });

    const found = activeSessionForCwd("/tmp/active-test");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(session.id);
  });

  test("returns null when no active session", async () => {
    const session = await startSession({
      goal: "will stop",
      cwd: "/tmp/no-active",
    });
    stopSession(session.id);

    expect(activeSessionForCwd("/tmp/no-active")).toBeNull();
  });

  test("returns null for different cwd", async () => {
    await startSession({ goal: "other", cwd: "/tmp/other-repo" });
    expect(activeSessionForCwd("/tmp/different-repo")).toBeNull();
  });
});
