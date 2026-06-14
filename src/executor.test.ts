// executor.test.ts — 执行引擎单元测试。
// 只测真实可控的 shell 路径(跑无害命令);agent 路径依赖外部 claude CLI,
// 只验证「构造了正确的 claude 调用参数」而不真的联网。

import { test, expect, describe } from "bun:test";
import { runShell, buildClaudeArgs } from "./executor";

describe("runShell — 真实跑无害 shell 命令", () => {
  test("echo 成功:退出码 0、stdout 抓到", async () => {
    const r = await runShell("echo adg-test-123");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("adg-test-123");
    expect(r.timedOut).toBe(false);
  });

  test("失败命令:非 0 退出码", async () => {
    const r = await runShell("exit 7");
    expect(r.exitCode).toBe(7);
  });

  test("stderr 被单独抓取", async () => {
    const r = await runShell("echo oops 1>&2");
    expect(r.stderr).toContain("oops");
  });

  test("超时:命令超过墙钟限制被 kill,timedOut=true", async () => {
    const r = await runShell("sleep 5", { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
  });

  test("stdout 超长被截断,标记 truncated", async () => {
    const r = await runShell("for i in $(seq 1 100000); do echo line$i; done", { maxOutput: 2000 });
    expect(r.stdout.length).toBeLessThanOrEqual(2000 + 64); // 截断 + 提示尾巴
    expect(r.truncated).toBe(true);
  });
});

describe("buildClaudeArgs — 构造 headless claude 调用参数", () => {
  test("默认带 -p 与提示词", () => {
    const args = buildClaudeArgs("审查改动");
    expect(args).toContain("-p");
    expect(args).toContain("审查改动");
  });

  test("默认 output-format=json、permission-mode 可控", () => {
    const args = buildClaudeArgs("看一眼", { permissionMode: "default" });
    expect(args.join(" ")).toContain("--output-format");
    expect(args.join(" ")).toContain("--permission-mode");
    expect(args).toContain("default");
  });
});
