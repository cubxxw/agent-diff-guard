// runner.test.ts — 单条决策处理流程 processOne 的单元测试。
// 真实跑无害 shell;agent 路径注入假执行器避免联网。临时 ADG_HOME 隔离。

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
const orig = process.env.ADG_HOME;
beforeEach(() => { tmpHome = mkdtempSync(join(tmpdir(), "adg-runner-")); process.env.ADG_HOME = tmpHome; });
afterEach(() => { if (orig === undefined) delete process.env.ADG_HOME; else process.env.ADG_HOME = orig; rmSync(tmpHome, { recursive: true, force: true }); });

describe("processOne — 安全 shell 决策自动执行并归档", () => {
  test("echo(无害)→ 执行 → 写 run 记录 → 从 pending 归档到 done", async () => {
    const { writeDecision, listPending, listDone } = await import("./inbox");
    const { processOne } = await import("./runner");
    const { listRuns } = await import("./runlog");

    const it = writeDecision({ title: "看状态", action: "echo adg-ok", nowMs: 1_700_000_000_000 });
    const r = await processOne(it);

    expect(r.outcome).toBe("executed");
    expect(listPending().length).toBe(0); // 已离开 pending
    expect(listDone().length).toBe(1);    // 进了 done
    const runs = listRuns();
    expect(runs.length).toBe(1);
    expect(runs[0]!.stdout).toContain("adg-ok");
    expect(runs[0]!.exitCode).toBe(0);
  });
});

describe("processOne — 黑名单决策被拦,不执行", () => {
  test("git checkout -- . → blocked → 转 blocked 队列,不进 done,无 run 记录", async () => {
    const { writeDecision, listPending, listDone } = await import("./inbox");
    const { processOne } = await import("./runner");
    const { listRuns, listBlocked } = await import("./runlog");

    const it = writeDecision({ title: "撤销", action: "git checkout -- .", nowMs: 1_700_000_000_000 });
    const r = await processOne(it);

    expect(r.outcome).toBe("blocked");
    expect(r.reason).toContain("checkout"); // 带拦截理由
    expect(listPending().length).toBe(0);
    expect(listDone().length).toBe(0);      // 没执行,不进 done
    expect(listBlocked().length).toBe(1);   // 进 blocked
    expect(listRuns().length).toBe(0);      // 没有执行留痕
  });
});

describe("processOne — agent 决策走注入的执行器", () => {
  test("kind=agent 用注入的 runClaude,不真的 spawn", async () => {
    const { writeDecision, listDone } = await import("./inbox");
    const { processOne } = await import("./runner");

    let calledWith = "";
    const fakeRunClaude = async (prompt: string) => {
      calledWith = prompt;
      return { exitCode: 0, stdout: "(agent 已分析)", stderr: "", timedOut: false, truncated: false, durationMs: 5 };
    };

    const it = writeDecision({ title: "调研", action: "审查 .github 下的改动", kind: "agent", nowMs: 1_700_000_000_000 });
    const r = await processOne(it, { runClaude: fakeRunClaude });

    expect(r.outcome).toBe("executed");
    expect(calledWith).toContain("审查");
    expect(listDone().length).toBe(1);
  });
});

describe("processOne — PAUSE 文件存在时只观察不执行", () => {
  test("有 PAUSE → outcome=paused,留在 pending", async () => {
    const { writeDecision, listPending } = await import("./inbox");
    const { processOne } = await import("./runner");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpHome, "PAUSE"), "", "utf8");

    const it = writeDecision({ title: "x", action: "echo x", nowMs: 1_700_000_000_000 });
    const r = await processOne(it);

    expect(r.outcome).toBe("paused");
    expect(listPending().length).toBe(1); // 没动,还在 pending
  });
});

describe("runDaemon — dry-run 单轮退出(防无限循环回归)", () => {
  test("dryRun 不改 pending,但必须只跑一轮就返回,不死循环", async () => {
    const { writeDecision, listPending } = await import("./inbox");
    const { runDaemon } = await import("./runner");

    writeDecision({ title: "安全", action: "echo x", nowMs: 1_700_000_000_000 });
    writeDecision({ title: "危险", action: "git checkout -- .", nowMs: 1_700_000_000_001 });

    // 不传 once,只传 dryRun。若 dry-run 未强制单轮,这里会无限循环卡死(测试超时即失败)。
    const results = await runDaemon({ dryRun: true });

    expect(results.length).toBe(2);        // 每条恰好分级一次,不重复
    expect(listPending().length).toBe(2);  // dry-run 不消费,pending 原样保留
    expect(results.find((r) => r.outcome === "blocked")).toBeTruthy(); // 危险那条判 blocked
  });
});
