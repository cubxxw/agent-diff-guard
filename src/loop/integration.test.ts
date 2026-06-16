import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  startSession,
  loadSession,
  stopSession,
  listSessions,
} from "./session";
import { checkIteration } from "./check";
import { generateReport } from "./report";

let testHome: string;
let repoDir: string;
let cleanupBase: string;

function git(...args: string[]) {
  const r = spawnSync("git", args, { cwd: repoDir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

beforeEach(() => {
  const id = `adg-int-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  cleanupBase = join(tmpdir(), id);
  testHome = join(cleanupBase, "home");
  repoDir = join(cleanupBase, "repo");
  mkdirSync(testHome, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  process.env.ADG_HOME = testHome;

  git("init");
  git("config", "user.email", "test@test.com");
  git("config", "user.name", "Test");
  writeFileSync(join(repoDir, "README.md"), "# test\n");
  git("add", ".");
  git("commit", "-m", "init");
});

afterEach(() => {
  delete process.env.ADG_HOME;
  rmSync(cleanupBase, { recursive: true, force: true });
});

describe("loop integration: full lifecycle", () => {
  test("start → check × 2 → report → stop → list", async () => {
    // 1. Start session
    const session = await startSession({
      goal: "add auth feature",
      cwd: repoDir,
      budgetTokens: 100_000,
      mode: "attended",
    });
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("active");
    expect(session.goal).toBe("add auth feature");

    // 2. On-goal change: create auth.ts, commit, then check
    writeFileSync(join(repoDir, "auth.ts"), "export function login() {}\n");
    git("add", ".");
    git("commit", "-m", "add auth");

    const result1 = await checkIteration({ sessionId: session.id });
    expect(result1.iteration).toBe(1);
    expect(result1.verdict).toBeDefined();

    // 3. Off-goal change: create CI file, commit, then check
    mkdirSync(join(repoDir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(repoDir, ".github", "workflows", "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    );
    git("add", ".");
    git("commit", "-m", "add ci");

    const result2 = await checkIteration({ sessionId: session.id });
    expect(result2.iteration).toBe(2);
    const reloaded = loadSession(session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.iterationCount).toBe(2);
    expect(reloaded!.driftHistory.length).toBe(2);

    // 4. Report
    const report = generateReport(reloaded!);
    expect(report.sessionId).toBe(session.id);
    expect(report.driftSummary).toBeDefined();
    expect(report.driftSummary.status).toBeDefined();

    // 5. Stop
    const stopped = stopSession(session.id);
    expect(stopped).toBe(true);
    const stoppedSession = loadSession(session.id);
    expect(stoppedSession!.status).toBe("stopped");

    // 6. List includes the session
    const all = listSessions();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some((s) => s.id === session.id)).toBe(true);
  });
});
