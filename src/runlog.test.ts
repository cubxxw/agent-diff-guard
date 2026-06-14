// runlog.test.ts — run daemon 的执行留痕 / blocked 队列 / 已见命令集合。
// 用临时 ADG_HOME 隔离,不污染真实 ~/.agent-diff-guard。

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
const orig = process.env.ADG_HOME;
beforeEach(() => { tmpHome = mkdtempSync(join(tmpdir(), "adg-runlog-")); process.env.ADG_HOME = tmpHome; });
afterEach(() => { if (orig === undefined) delete process.env.ADG_HOME; else process.env.ADG_HOME = orig; rmSync(tmpHome, { recursive: true, force: true }); });

describe("writeRun / listRuns — 执行留痕", () => {
  test("写一条 run 记录并读回", async () => {
    const { writeRun, listRuns } = await import("./runlog");
    writeRun({
      inboxId: "01TEST", title: "看一眼", action: "git status", kind: "shell",
      exitCode: 0, durationMs: 12, stdout: "clean", stderr: "", timedOut: false, nowMs: 1_700_000_000_000,
    });
    const runs = listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0]!.inboxId).toBe("01TEST");
    expect(runs[0]!.exitCode).toBe(0);
    expect(runs[0]!.createdAt).toBe("2023-11-14T22:13:20.000Z");
  });
});

describe("markBlocked / listBlocked — 拦截队列", () => {
  test("把一条 pending 转入 blocked,带上拦截理由", async () => {
    const { writeDecision } = await import("./inbox");
    const { markBlocked, listBlocked } = await import("./runlog");
    const it = writeDecision({ title: "撤销", action: "git checkout -- .", nowMs: 1_700_000_000_000 });
    const ok = markBlocked(it.id, "git checkout -- 丢弃工作区改动");
    expect(ok).toBe(true);
    const blocked = listBlocked();
    expect(blocked.length).toBe(1);
    expect(blocked[0]!.id).toBe(it.id);
    expect(blocked[0]!.blockedReason).toBe("git checkout -- 丢弃工作区改动");
  });

  test("markBlocked 不存在的 id 返回 false", async () => {
    const { markBlocked } = await import("./runlog");
    expect(markBlocked("NOPE", "x")).toBe(false);
  });
});

describe("seenCommands — 已见命令集合(影子告警用)", () => {
  test("首次见到某前缀 isFirstSeen=true,记下后再问为 false", async () => {
    const { isFirstSeen, rememberCommand } = await import("./runlog");
    expect(isFirstSeen("git diff HEAD~1 -- a.ts")).toBe(true);
    rememberCommand("git diff HEAD~1 -- a.ts");
    // 同前缀(不同参数)应被视为见过
    expect(isFirstSeen("git diff HEAD~2 -- b.ts")).toBe(false);
  });

  test("不同命令前缀互不影响", async () => {
    const { isFirstSeen, rememberCommand } = await import("./runlog");
    rememberCommand("git status");
    expect(isFirstSeen("npm run build")).toBe(true);
  });
});
