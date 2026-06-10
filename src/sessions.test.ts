// sessions.test.ts — token/成本聚合的回归测试(用内存合成 session,不碰真实日志)。

import { test, expect } from "bun:test";
import { projectUsage, usageOverview, recentSessions, type SessionUsage } from "./sessions";

function s(over: Partial<SessionUsage> = {}): SessionUsage {
  return {
    sessionId: "sess-1", project: "/p/a", model: "claude-opus-4-7",
    messageCount: 5, inputTokens: 100, outputTokens: 200,
    cacheReadTokens: 50, cacheCreationTokens: 10, estCostUsd: 1.5,
    lastActivity: "2026-06-10T03:00:00.000Z", ...over,
  };
}

test("projectUsage: 按成本降序聚合同项目的多个 session", () => {
  const sessions = [
    s({ project: "/p/cheap", estCostUsd: 1, outputTokens: 100 }),
    s({ project: "/p/expensive", estCostUsd: 50, outputTokens: 5000 }),
    s({ project: "/p/expensive", estCostUsd: 30, outputTokens: 3000 }),
  ];
  const r = projectUsage(sessions);
  expect(r[0]!.project).toBe("/p/expensive");
  expect(r[0]!.estCostUsd).toBe(80);
  expect(r[0]!.sessionCount).toBe(2);
  expect(r[0]!.outputTokens).toBe(8000);
  expect(r[1]!.project).toBe("/p/cheap");
});

test("usageOverview: 总量与去重项目数", () => {
  const sessions = [
    s({ project: "/p/a", outputTokens: 100, estCostUsd: 1 }),
    s({ project: "/p/a", outputTokens: 200, estCostUsd: 2 }),
    s({ project: "/p/b", outputTokens: 300, estCostUsd: 3 }),
  ];
  const o = usageOverview(sessions);
  expect(o.totalProjects).toBe(2);
  expect(o.totalSessions).toBe(3);
  expect(o.totalOutputTokens).toBe(600);
  expect(o.estCostUsd).toBe(6);
});

test("recentSessions: 按最后活动时间倒序", () => {
  const sessions = [
    s({ sessionId: "old", lastActivity: "2026-06-08T00:00:00.000Z" }),
    s({ sessionId: "new", lastActivity: "2026-06-10T00:00:00.000Z" }),
  ];
  const r = recentSessions(sessions);
  expect(r[0]!.sessionId).toBe("new");
  expect(r[1]!.sessionId).toBe("old");
});

test("空输入不崩", () => {
  expect(projectUsage([])).toEqual([]);
  expect(usageOverview([]).totalProjects).toBe(0);
  expect(recentSessions([])).toEqual([]);
});
