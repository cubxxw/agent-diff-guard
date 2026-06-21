// stats.test.ts — 面板聚合的回归测试。

import { test, expect } from "bun:test";
import { ruleRank, timeline, dispositions, overview } from "./stats";
import type { GuardEvent } from "./event";

function ev(over: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: "01HV9K2M3P4Q5R6S7T8U9V0W1X",
    timestamp: "2026-06-10T03:00:00.000Z",
    cliVersion: "0.0.2",
    repoRemote: "github.com/acme/api",
    gitRange: "HEAD",
    taskDescHash: null,
    taskDescLen: null,
    summary: { totalFilesChanged: 1, wakeCount: 0, lookCount: 0, rulesTriggered: [] },
    findings: [],
    disposition: "auto-pass",
    authorHash: null,
    repoAlias: null,
    ...over,
  };
}

test("ruleRank: 按命中次数降序,wakeCount 单独计", () => {
  const events = [
    ev({ findings: [{ rule: "ci-pipeline", severity: "wake-you-up", path: "a.yml", whySummary: "", hasEvidence: false }] }),
    ev({ findings: [
      { rule: "ci-pipeline", severity: "wake-you-up", path: "b.yml", whySummary: "", hasEvidence: false },
      { rule: "task-drift", severity: "look-once", path: "c.ts", whySummary: "", hasEvidence: false },
    ] }),
  ];
  const r = ruleRank(events);
  expect(r[0]).toEqual({ rule: "ci-pipeline", count: 2, wakeCount: 2 });
  expect(r[1]).toEqual({ rule: "task-drift", count: 1, wakeCount: 0 });
});

test("timeline: 按天聚合,日期升序", () => {
  const events = [
    ev({ timestamp: "2026-06-09T10:00:00.000Z", summary: { totalFilesChanged: 1, wakeCount: 2, lookCount: 0, rulesTriggered: [] }, disposition: "blocked" }),
    ev({ timestamp: "2026-06-10T11:00:00.000Z", summary: { totalFilesChanged: 1, wakeCount: 0, lookCount: 1, rulesTriggered: [] }, disposition: "auto-pass" }),
  ];
  const t = timeline(events);
  expect(t.map((x) => x.date)).toEqual(["2026-06-09", "2026-06-10"]);
  expect(t[0]!.wakeCount).toBe(2);
  expect(t[1]!.passCount).toBe(1);
  expect(t[0]!.eventCount).toBe(1);
  expect(t[1]!.eventCount).toBe(1);
});

test("timeline: eventCount 是扫描次数,与 wakeCount 解耦", () => {
  const events = [
    ev({ timestamp: "2026-06-11T08:00:00.000Z", summary: { totalFilesChanged: 1, wakeCount: 2, lookCount: 0, rulesTriggered: [] }, disposition: "blocked" }),
    ev({ timestamp: "2026-06-11T09:00:00.000Z", summary: { totalFilesChanged: 1, wakeCount: 0, lookCount: 0, rulesTriggered: [] }, disposition: "auto-pass" }),
  ];
  const t = timeline(events);
  expect(t).toHaveLength(1);
  expect(t[0]!.eventCount).toBe(2);
});

test("dispositions: 时间倒序", () => {
  const events = [
    ev({ id: "A", timestamp: "2026-06-09T10:00:00.000Z" }),
    ev({ id: "B", timestamp: "2026-06-10T10:00:00.000Z" }),
  ];
  const d = dispositions(events);
  expect(d[0]!.id).toBe("B");
  expect(d[1]!.id).toBe("A");
});

test("dispositions: commitHash 透传(有则保留,老事件无该字段 → null)", () => {
  const d = dispositions([
    ev({ id: "withHash", commitHash: "a2fae93" }),
    ev({ id: "noHash" }), // ev() 默认不带 commitHash,模拟老事件
  ]);
  const byId = Object.fromEntries(d.map((x) => [x.id, x]));
  expect(byId.withHash!.commitHash).toBe("a2fae93");
  expect(byId.noHash!.commitHash).toBeNull();
});

test("overview: 总量与放行率", () => {
  const events = [
    ev({ disposition: "auto-pass", summary: { totalFilesChanged: 1, wakeCount: 0, lookCount: 0, rulesTriggered: [] } }),
    ev({ disposition: "blocked", summary: { totalFilesChanged: 1, wakeCount: 3, lookCount: 0, rulesTriggered: [] } }),
  ];
  const o = overview(events);
  expect(o.totalScans).toBe(2);
  expect(o.totalWake).toBe(3);
  expect(o.totalBlocked).toBe(1);
  expect(o.passRate).toBe(0.5);
});

test("空事件:overview 不崩,放行率为 1", () => {
  const o = overview([]);
  expect(o.totalScans).toBe(0);
  expect(o.passRate).toBe(1);
});
