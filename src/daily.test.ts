// daily.test.ts — 每日活跃度聚合的回归测试(内存合成记录,不碰真实日志)。

import { test, expect } from "bun:test";
import { dailyStats, dayStat, type MsgRecord } from "./daily";

const T = (iso: string) => new Date(iso).getTime();

function rec(over: Partial<MsgRecord> = {}): MsgRecord {
  return {
    ts: T("2026-06-10T03:00:00Z"), date: "2026-06-10", role: "ai",
    project: "/p/a", model: "claude-opus-4-7",
    input: 100, output: 200, cacheRead: 1000, cacheCreate: 50, toolCalls: 1, cost: 0.5, ...over,
  };
}

test("dailyStats: 按天聚合 token/消息/工具", () => {
  const recs = [
    rec({ date: "2026-06-10", role: "ai", output: 200, toolCalls: 2 }),
    rec({ date: "2026-06-10", role: "user", output: 0, toolCalls: 0 }),
    rec({ date: "2026-06-09", role: "ai", output: 100, toolCalls: 1 }),
  ];
  const stats = dailyStats(recs);
  expect(stats[0]!.date).toBe("2026-06-10"); // 降序,最近在前
  expect(stats[0]!.messages.ai).toBe(1);
  expect(stats[0]!.messages.user).toBe(1);
  expect(stats[0]!.messages.total).toBe(2);
  expect(stats[0]!.toolCalls).toBe(2);
  expect(stats[1]!.date).toBe("2026-06-09");
});

test("活跃时长:相邻间隔 <=5min 累加,>5min 不算", () => {
  const recs = [
    rec({ ts: T("2026-06-10T03:00:00Z") }),
    rec({ ts: T("2026-06-10T03:02:00Z") }), // +2min 算
    rec({ ts: T("2026-06-10T03:30:00Z") }), // +28min 不算(离开了)
    rec({ ts: T("2026-06-10T03:33:00Z") }), // +3min 算
  ];
  const s = dailyStats(recs)[0]!;
  expect(s.activeMs).toBe((2 + 3) * 60 * 1000); // 只累加 2min + 3min
  expect(s.sessionSpanMs).toBe(33 * 60 * 1000); // 首尾跨度 33min
});

test("token 总量 = in+out+cacheRead+cacheCreate", () => {
  const s = dailyStats([rec({ input: 10, output: 20, cacheRead: 30, cacheCreate: 40 })])[0]!;
  expect(s.tokens.total).toBe(100);
});

test("dayStat: 不存在的日期返回零壳", () => {
  const d = dayStat("2099-01-01", []);
  expect(d.date).toBe("2099-01-01");
  expect(d.tokens.total).toBe(0);
  expect(d.messages.total).toBe(0);
});

test("多项目去重计数", () => {
  const recs = [
    rec({ project: "/p/a" }), rec({ project: "/p/a" }), rec({ project: "/p/b" }),
  ];
  expect(dailyStats(recs)[0]!.projects).toBe(2);
});
