// decisions.test.ts — 人工裁决理由落盘/读回的单元测试(证据链)。
// 用临时 HOME 隔离,避免污染真实 ~/.agent-diff-guard。

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
const origAdgHome = process.env.ADG_HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "adg-decisions-"));
  process.env.ADG_HOME = tmpHome; // logDir() 读 ADG_HOME 覆盖,隔离到临时目录
});
afterEach(() => {
  if (origAdgHome === undefined) delete process.env.ADG_HOME;
  else process.env.ADG_HOME = origAdgHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

test("appendDecision 落盘,readDecisions 读回(reason 持久化)", async () => {
  const { appendDecision, readDecisions, decisionsPath } = await import("./decisions");
  const rec = appendDecision({ targetId: "F1", disposition: "approved", reason: "确认与任务相关,放行", nowMs: 1_700_000_000_000 });
  expect(rec.targetId).toBe("F1");
  expect(rec.disposition).toBe("approved");
  expect(rec.reason).toBe("确认与任务相关,放行");
  expect(existsSync(decisionsPath())).toBe(true);
  const all = readDecisions();
  expect(all.length).toBe(1);
  expect(all[0]!.reason).toBe("确认与任务相关,放行");
  expect(all[0]!.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
});

test("latestDecisionsById:同一 id 多次裁决,后写覆盖先写", async () => {
  const { appendDecision, latestDecisionsById } = await import("./decisions");
  appendDecision({ targetId: "F2", disposition: "rejected", reason: "先驳回", nowMs: 1_700_000_000_001 });
  appendDecision({ targetId: "F2", disposition: "approved", reason: "改主意放行", nowMs: 1_700_000_000_002 });
  const map = latestDecisionsById();
  expect(map.F2!.disposition).toBe("approved");
  expect(map.F2!.reason).toBe("改主意放行");
});

test("isDecisionKind 只接受合法枚举", async () => {
  const { isDecisionKind } = await import("./decisions");
  expect(isDecisionKind("approved")).toBe(true);
  expect(isDecisionKind("rejected")).toBe(true);
  expect(isDecisionKind("fp")).toBe(true);
  expect(isDecisionKind("blocked")).toBe(false);
  expect(isDecisionKind(undefined)).toBe(false);
});

test("reason 超长被截断到 500 字,不撑爆日志", async () => {
  const { appendDecision } = await import("./decisions");
  const rec = appendDecision({ targetId: "F3", disposition: "fp", reason: "x".repeat(2000) });
  expect(rec.reason.length).toBe(500);
});

test("缺 reason 时落空串,不报错", async () => {
  const { appendDecision } = await import("./decisions");
  const rec = appendDecision({ targetId: "F4", disposition: "approved" });
  expect(rec.reason).toBe("");
});
