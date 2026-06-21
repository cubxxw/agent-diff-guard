// event.test.ts — 守门事件构造的测试,重点守"隐私红线"。
// 最重要的一条:evidence 正文、task 原文绝不能出现在序列化结果里。

import { test, expect } from "bun:test";
import { buildEvent, buildFindingMeta } from "./event";
import type { Finding, FileChange } from "./rules";

const SECRET_EVIDENCE = 'const apiKey = "sk_live_THIS_MUST_NEVER_BE_LOGGED_xyz";';

test("buildFindingMeta: evidence 正文被剥成 hasEvidence 布尔", () => {
  const f: Finding = { rule: "hardcoded-secret", severity: "wake-you-up", path: "c.ts", why: "x", evidence: SECRET_EVIDENCE };
  const meta = buildFindingMeta(f);
  expect(meta.hasEvidence).toBe(true);
  // meta 里不该有 evidence 字段
  expect((meta as unknown as Record<string, unknown>).evidence).toBeUndefined();
  expect(JSON.stringify(meta)).not.toContain("sk_live");
});

test("隐私红线:序列化后的事件不含 evidence 正文,也不含 task 原文", async () => {
  const TASK = "SUPER_SECRET_TASK_DESCRIPTION_12345";
  const changes: FileChange[] = [{ path: "c.ts", kind: "modified", addedLines: [], removedLines: [] }];
  const findings: Finding[] = [
    { rule: "hardcoded-secret", severity: "wake-you-up", path: "c.ts", why: "y", evidence: SECRET_EVIDENCE },
  ];
  const event = await buildEvent({
    cliVersion: "0.0.2", gitRange: "HEAD", task: TASK, changes, findings,
    disposition: "blocked", nowMs: 1_749_500_000_000,
  });
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain("sk_live");
  expect(serialized).not.toContain("SUPER_SECRET_TASK");
  // 但 task 的 hash 和长度被保留(可统计)
  expect(event.taskDescHash).not.toBeNull();
  expect(event.taskDescLen).toBe(TASK.length);
});

test("buildEvent: 统计数与 disposition 正确", async () => {
  const changes: FileChange[] = [
    { path: "a.yml", kind: "modified", addedLines: [], removedLines: [] },
    { path: "b.ts", kind: "modified", addedLines: [], removedLines: [] },
  ];
  const findings: Finding[] = [
    { rule: "ci-pipeline", severity: "wake-you-up", path: "a.yml", why: "" },
    { rule: "task-drift", severity: "look-once", path: "b.ts", why: "" },
  ];
  const event = await buildEvent({
    cliVersion: "0.0.2", gitRange: "HEAD", task: undefined, changes, findings,
    disposition: "blocked", nowMs: 1_749_500_000_000,
  });
  expect(event.summary.wakeCount).toBe(1);
  expect(event.summary.lookCount).toBe(1);
  expect(event.summary.totalFilesChanged).toBe(2);
  expect(event.summary.rulesTriggered.sort()).toEqual(["ci-pipeline", "task-drift"]);
  expect(event.id).toHaveLength(26); // ULID
  expect(event.timestamp).toBe(new Date(1_749_500_000_000).toISOString());
});

test("buildEvent: commitHash 透传(传入则保留,不传则 null —— 向后兼容)", async () => {
  const changes: FileChange[] = [{ path: "a.ts", kind: "modified", addedLines: [], removedLines: [] }];
  // 传入 commitHash → 原样落盘
  const withHash = await buildEvent({
    cliVersion: "0.0.2", gitRange: "HEAD", task: undefined, changes, findings: [],
    disposition: "auto-pass", commitHash: "a2fae93", nowMs: 1_749_500_000_000,
  });
  expect(withHash.commitHash).toBe("a2fae93");
  // 不传 commitHash → null(模拟空仓/不在 git 里),不报错
  const noHash = await buildEvent({
    cliVersion: "0.0.2", gitRange: "HEAD", task: undefined, changes, findings: [],
    disposition: "auto-pass", nowMs: 1_749_500_000_000,
  });
  expect(noHash.commitHash).toBeNull();
});
