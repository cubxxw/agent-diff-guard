import { describe, test, expect, beforeEach } from "bun:test";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  submitTask, nextPending, listTasksPending, listTasksRunning, listTasksDone,
  findTask, markRunning, markCompleted, cancelTask, recoverCrashed, toView,
} from "./task-queue";

const TMP = join(tmpdir(), "adg-tq-test-" + Date.now());

describe("task-queue", () => {
  beforeEach(() => {
    process.env.ADG_HOME = TMP;
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  test("submitTask creates a pending task file", () => {
    const t = submitTask({ title: "Test", prompt: "do something", nowMs: 1700000000000 });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe("pending");
    expect(t.title).toBe("Test");
    expect(t.prompt).toBe("do something");
    expect(t.priority).toBe(2);
  });

  test("nextPending returns highest priority first", () => {
    submitTask({ title: "Low", prompt: "a", priority: 3, nowMs: 1700000000000 });
    submitTask({ title: "High", prompt: "b", priority: 1, nowMs: 1700000001000 });
    submitTask({ title: "Med", prompt: "c", priority: 2, nowMs: 1700000002000 });
    const next = nextPending();
    expect(next).not.toBeNull();
    expect(next!.title).toBe("High");
  });

  test("markRunning moves task from pending to running", () => {
    const t = submitTask({ title: "Run me", prompt: "go", nowMs: 1700000000000 });
    expect(listTasksPending()).toHaveLength(1);
    expect(listTasksRunning()).toHaveLength(0);

    const ok = markRunning(t.id, 1700000001000);
    expect(ok).toBe(true);
    expect(listTasksPending()).toHaveLength(0);
    expect(listTasksRunning()).toHaveLength(1);
    expect(listTasksRunning()[0]!.status).toBe("running");
    expect(listTasksRunning()[0]!.startedAt).toBeTruthy();
  });

  test("markCompleted moves from running to done", () => {
    const t = submitTask({ title: "Finish", prompt: "x", nowMs: 1700000000000 });
    markRunning(t.id, 1700000001000);
    const ok = markCompleted(t.id, { exitCode: 0, stdout: "ok", durationMs: 500, nowMs: 1700000002000 });
    expect(ok).toBe(true);
    expect(listTasksRunning()).toHaveLength(0);
    const done = listTasksDone();
    expect(done).toHaveLength(1);
    expect(done[0]!.status).toBe("done");
    expect(done[0]!.exitCode).toBe(0);
    expect(done[0]!.stdout).toBe("ok");
  });

  test("markCompleted with non-zero exit sets status to failed", () => {
    const t = submitTask({ title: "Fail", prompt: "x", nowMs: 1700000000000 });
    markRunning(t.id);
    markCompleted(t.id, { exitCode: 1 });
    const done = listTasksDone();
    expect(done[0]!.status).toBe("failed");
  });

  test("cancelTask moves pending to done with cancelled status", () => {
    const t = submitTask({ title: "Cancel me", prompt: "x", nowMs: 1700000000000 });
    const ok = cancelTask(t.id, 1700000001000);
    expect(ok).toBe(true);
    expect(listTasksPending()).toHaveLength(0);
    const done = listTasksDone();
    expect(done).toHaveLength(1);
    expect(done[0]!.status).toBe("cancelled");
  });

  test("cancelTask returns false for non-existent task", () => {
    expect(cancelTask("nonexistent")).toBe(false);
  });

  test("findTask looks across all directories", () => {
    const t = submitTask({ title: "Find me", prompt: "x", nowMs: 1700000000000 });
    expect(findTask(t.id)).not.toBeNull();
    markRunning(t.id);
    expect(findTask(t.id)).not.toBeNull();
    markCompleted(t.id, { exitCode: 0 });
    expect(findTask(t.id)).not.toBeNull();
    expect(findTask("bogus")).toBeNull();
  });

  test("recoverCrashed moves running back to pending", () => {
    const t = submitTask({ title: "Crash", prompt: "x", nowMs: 1700000000000 });
    markRunning(t.id);
    expect(listTasksRunning()).toHaveLength(1);
    const n = recoverCrashed();
    expect(n).toBe(1);
    expect(listTasksRunning()).toHaveLength(0);
    expect(listTasksPending()).toHaveLength(1);
    expect(listTasksPending()[0]!.status).toBe("pending");
  });

  test("toView strips stdout/stderr", () => {
    const t = submitTask({ title: "View", prompt: "x", nowMs: 1700000000000 });
    markRunning(t.id);
    markCompleted(t.id, { exitCode: 0, stdout: "big output", stderr: "errors" });
    const done = findTask(t.id)!;
    const view = toView(done);
    expect(view.id).toBe(t.id);
    expect(view.title).toBe("View");
    expect((view as unknown as Record<string, unknown>)["stdout"]).toBeUndefined();
    expect((view as unknown as Record<string, unknown>)["stderr"]).toBeUndefined();
  });

  test("listTasksDone respects limit", () => {
    for (let i = 0; i < 5; i++) {
      const t = submitTask({ title: `T${i}`, prompt: "x", nowMs: 1700000000000 + i * 1000 });
      markRunning(t.id);
      markCompleted(t.id, { exitCode: 0 });
    }
    expect(listTasksDone(3)).toHaveLength(3);
    expect(listTasksDone()).toHaveLength(5);
  });

  test("empty directories return empty arrays", () => {
    expect(listTasksPending()).toHaveLength(0);
    expect(listTasksRunning()).toHaveLength(0);
    expect(listTasksDone()).toHaveLength(0);
    expect(nextPending()).toBeNull();
  });
});
