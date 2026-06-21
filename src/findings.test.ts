// findings.test.ts — 审查队列三源合成的核心契约。
//
// 重点验证报告里那条最致命的断裂:"被刹住(blocked/wake)"必须能回流成"待裁决"。
// 用注入的 events + 空 transcripts(无 live)隔离 history 与 demo 两条路径。

import { test, expect, describe } from "bun:test";
import { buildQueue } from "./findings";
import type { GuardEvent } from "./event";

function blockedEvent(over: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: "01TESTID0000000000000000AB",
    timestamp: "2026-06-10T03:14:37.641Z",
    cliVersion: "0.0.1",
    repoRemote: "github.com/cubxxw/agent-diff-guard",
    gitRange: "HEAD~1..HEAD",
    taskDescHash: "c58fcac079e6ea1c",
    taskDescLen: 12,
    summary: { totalFilesChanged: 2, wakeCount: 1, lookCount: 0, rulesTriggered: ["hardcoded-secret"] },
    findings: [
      { rule: "hardcoded-secret", severity: "wake-you-up", path: "README.md", whySummary: "新增疑似密钥", hasEvidence: true },
    ],
    disposition: "blocked",
    authorHash: null,
    repoAlias: null,
    ...over,
  };
}

describe("buildQueue 三源合成", () => {
  test("默认不回流 history:仅 includeHistory 才把 blocked 历史放进队列", () => {
    // 默认(includeHistory 省略):history 不进队列 → 空 live + 空 = demo 兜底关掉后为空
    const def = buildQueue({ transcripts: [], events: [blockedEvent()], noDemo: true });
    expect(def).toEqual([]);
  });

  test("history 回流:includeHistory:true 时 blocked 事件的 wake 命中变成 origin=history 队列项", () => {
    const q = buildQueue({ transcripts: [], events: [blockedEvent()], noDemo: true, includeHistory: true });
    expect(q.length).toBe(1);
    const f = q[0]!;
    expect(f.origin).toBe("history");
    expect(f.level).toBe("wake");
    expect(f.rule).toBe("hardcoded-secret");
    expect(f.file).toBe("README.md");
    // 隐私铁律:历史无正文可重放
    expect(f.diff).toEqual([]);
    // task 只给可读占位,不假装有原文
    expect(f.task).toContain("审计层未留原文");
  });

  test("只回流 blocked + wake:auto-pass 与 look-once 不进队列", () => {
    const passed = blockedEvent({ id: "01PASS", disposition: "auto-pass" });
    const lookOnly = blockedEvent({
      id: "01LOOK",
      findings: [{ rule: "dependency-manifest", severity: "look-once", path: "package.json", whySummary: "依赖变更", hasEvidence: false }],
    });
    const q = buildQueue({ transcripts: [], events: [passed, lookOnly], noDemo: true, includeHistory: true });
    expect(q.length).toBe(0);
  });

  test("demo 兜底:live+history 全空时注入演示种子", () => {
    const q = buildQueue({ transcripts: [], events: [] });
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((f) => f.origin === "demo")).toBe(true);
    // 有 wake 也有 look,能演示完整队列形态
    expect(q.some((f) => f.level === "wake")).toBe(true);
    expect(q.some((f) => f.level === "look")).toBe(true);
  });

  test("noDemo 关掉兜底:全空就是空", () => {
    const q = buildQueue({ transcripts: [], events: [], noDemo: true });
    expect(q).toEqual([]);
  });

  test("证据字段:demo 项带 commit/agent/disposable=uncommitted(演示也展示完整证据形态)", () => {
    const q = buildQueue({ transcripts: [], events: [] });
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((f) => f.disposable === "uncommitted")).toBe(true);
    expect(q.every((f) => typeof f.commit === "string" && f.commit!.length > 0)).toBe(true);
    expect(q.every((f) => f.agent === "Claude Code")).toBe(true);
  });

  test("证据字段:history 回流项 disposable=history(已落地、裁决仅记录、不可逆)", () => {
    const q = buildQueue({ transcripts: [], events: [blockedEvent()], noDemo: true, includeHistory: true });
    expect(q.length).toBe(1);
    expect(q[0]!.disposable).toBe("history");
    // 隐私铁律:历史不回放 commit/agent 正文
    expect(q[0]!.commit).toBeNull();
    expect(q[0]!.agent).toBeNull();
  });

  test("聚合去重:同一 repo:rule:file 被刹多次只出 1 条,hitCount 累加", () => {
    // 三次 blocked,同一处 README.md@hardcoded-secret(默认 blockedEvent 即此)
    const e1 = blockedEvent({ id: "01HIT1", timestamp: "2026-06-08T01:00:00.000Z" });
    const e2 = blockedEvent({ id: "01HIT2", timestamp: "2026-06-09T01:00:00.000Z" });
    const e3 = blockedEvent({ id: "01HIT3", timestamp: "2026-06-10T01:00:00.000Z" });
    const q = buildQueue({ transcripts: [], events: [e3, e1, e2], noDemo: true, includeHistory: true });
    expect(q.length).toBe(1);
    const f = q[0]!;
    expect(f.hitCount).toBe(3);
    // firstSeen 取最早,timestamp(展示)取最近 —— 与事件乱序输入无关
    expect(f.firstSeen).toBe("2026-06-08T01:00:00.000Z");
    expect(f.timestamp).toBe("2026-06-10T01:00:00.000Z");
  });

  test("排序:wake 在 look 之前", () => {
    const twoWake = blockedEvent({
      id: "01MULTI",
      findings: [
        { rule: "ci-pipeline", severity: "wake-you-up", path: ".github/workflows/x.yml", whySummary: "改 CI", hasEvidence: false },
        { rule: "hardcoded-secret", severity: "wake-you-up", path: "a.ts", whySummary: "密钥", hasEvidence: false },
      ],
    });
    const q = buildQueue({ transcripts: [], events: [twoWake], noDemo: true, includeHistory: true });
    expect(q.length).toBe(2);
    expect(q.every((f) => f.level === "wake")).toBe(true);
  });
});
