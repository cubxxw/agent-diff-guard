// inbox.test.ts — 文件信箱读写与归档的单元测试。
// 用临时 HOME 隔离,避免污染真实 ~/.agent-diff-guard。

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
const origAdgHome = process.env.ADG_HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "adg-inbox-"));
  process.env.ADG_HOME = tmpHome; // logDir() 读 ADG_HOME 覆盖,隔离到临时目录
});
afterEach(() => {
  if (origAdgHome === undefined) delete process.env.ADG_HOME;
  else process.env.ADG_HOME = origAdgHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

// logDir() 每次调用都现读 ADG_HOME,所以 import 缓存不影响隔离。
test("writeDecision 写入 pending,listPending 读回", async () => {
  const { writeDecision, listPending } = await import("./inbox");
  writeDecision({ title: "收紧 ci 规则", action: "审查 .github/workflows 下的改动", nowMs: 1_700_000_000_000 });
  const items = listPending();
  expect(items.length).toBe(1);
  expect(items[0]!.title).toBe("收紧 ci 规则");
  expect(items[0]!.status).toBe("pending");
  expect(items[0]!.action).toContain(".github/workflows");
});

test("markDone 把指令从 pending 移到 done", async () => {
  const { writeDecision, listPending, markDone, pendingDir, doneDir } = await import("./inbox");
  const item = writeDecision({ title: "x", action: "y", nowMs: 1_700_000_000_001 });
  expect(markDone(item.id)).toBe(true);
  expect(listPending().length).toBe(0); // pending 已清空
  expect(existsSync(join(doneDir(), `${item.id}.json`))).toBe(true); // 归档存在
  expect(existsSync(join(pendingDir(), `${item.id}.json`))).toBe(false);
});

test("markDone 对不存在的 id 返回 false", async () => {
  const { markDone } = await import("./inbox");
  expect(markDone("nonexistent")).toBe(false);
});

test("markDone 拒绝路径遍历 id(安全:不越界写文件)", async () => {
  const { markDone } = await import("./inbox");
  // 非 ULID 格式一律拒绝,防 ../../foo 覆写区外文件
  expect(markDone("../../rule-overrides")).toBe(false);
  expect(markDone("../../../etc/passwd")).toBe(false);
  expect(markDone("a/b")).toBe(false);
  expect(markDone("../escape")).toBe(false);
});

test("listPending 空信箱返回空数组", async () => {
  const { listPending } = await import("./inbox");
  expect(listPending()).toEqual([]);
});
