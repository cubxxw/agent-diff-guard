// sessions.test.ts — token/成本聚合的回归测试(用内存合成 session,不碰真实日志)。

import { test, expect } from "bun:test";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectUsage, usageOverview, recentSessions, parseSession, type SessionUsage } from "./sessions";

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

// parseSession 去重回归:Claude Code 把同一条 assistant 消息(同一 message.id)拆成
// 多行 jsonl 写入,每行携带相同 usage。必须按 message.id 去重,否则 token/成本/消息数翻倍。
test("parseSession: 同一 message.id 重复行只计一次 usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "adg-sess-"));
  const file = join(dir, "s.jsonl");
  // 两条不同消息;msg_A 重复出现 3 行(模拟思考块/工具调用分段),msg_B 出现 1 行。
  const lineA = JSON.stringify({
    type: "assistant", timestamp: "2026-06-23T03:00:00.000Z",
    message: { id: "msg_A", model: "claude-opus-4", usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 } },
  });
  const lineB = JSON.stringify({
    type: "assistant", timestamp: "2026-06-23T03:01:00.000Z",
    message: { id: "msg_B", model: "claude-opus-4", usage: { input_tokens: 20, output_tokens: 200, cache_read_input_tokens: 2000, cache_creation_input_tokens: 5 } },
  });
  try {
    writeFileSync(file, [lineA, lineA, lineA, lineB].join("\n"));
    const r = parseSession(file, "/p/x", "s")!;
    // 只能计 A(一次)+ B(一次),不是 A×3 + B。
    expect(r.outputTokens).toBe(300);          // 100 + 200,而非 100×3 + 200 = 500
    expect(r.cacheReadTokens).toBe(3000);      // 1000 + 2000,而非 1000×3 + 2000 = 5000
    expect(r.inputTokens).toBe(30);            // 10 + 20
    expect(r.messageCount).toBe(2);            // 两条不同消息,而非 4 行
    // 成本同样去重:A=(10+5)/1e6*15 + 100/1e6*75 + 1000/1e6*1.5 ; B 同理。重复行不得叠加。
    const expected = ((10 + 5) / 1e6) * 15 + (100 / 1e6) * 75 + (1000 / 1e6) * 1.5
                   + ((20 + 5) / 1e6) * 15 + (200 / 1e6) * 75 + (2000 / 1e6) * 1.5;
    expect(r.estCostUsd).toBeCloseTo(Math.round(expected * 100) / 100, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
