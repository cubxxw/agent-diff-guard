// ai.test.ts — AI 层纯函数测试(不触网:配置解析 / 输入聚合 / 隐私守护)。

import { test, expect } from "bun:test";
import { readAIConfig, isAIEnabled, buildAnalysisInput, assertNoSourceLeak, type AnalysisInput } from "./ai";
import type { GuardEvent } from "./event";

test("readAIConfig:无 key 返回 null,有 key 填默认值", () => {
  expect(readAIConfig({})).toBeNull();
  expect(isAIEnabled({})).toBe(false);
  const cfg = readAIConfig({ DEEPSEEK_API_KEY: "sk-test" });
  expect(cfg?.apiKey).toBe("sk-test");
  expect(cfg?.baseUrl).toBe("https://api.deepseek.com/v1"); // 默认
  expect(cfg?.model).toBe("deepseek-v4-pro"); // 默认
  expect(isAIEnabled({ DEEPSEEK_API_KEY: "sk-test" })).toBe(true);
});

test("readAIConfig:自定义 base/model 生效,尾斜杠被剥", () => {
  const cfg = readAIConfig({ DEEPSEEK_API_KEY: "k", DEEPSEEK_BASE_URL: "https://x.com/v1/", DEEPSEEK_MODEL: "m1" });
  expect(cfg?.baseUrl).toBe("https://x.com/v1");
  expect(cfg?.model).toBe("m1");
});

function ev(over: Partial<GuardEvent>): GuardEvent {
  return {
    id: "01", timestamp: "2026-06-10T00:00:00.000Z", cliVersion: "0.0.1",
    repoRemote: "github.com/me/repo", gitRange: "HEAD", taskDescHash: null, taskDescLen: null,
    summary: { totalFilesChanged: 1, wakeCount: 0, lookCount: 0, rulesTriggered: [] },
    findings: [], disposition: "auto-pass", authorHash: null, repoAlias: null, ...over,
  };
}

test("buildAnalysisInput:聚合计数、时间范围、处置统计", () => {
  const events = [
    ev({ timestamp: "2026-06-08T00:00:00.000Z", disposition: "blocked",
      findings: [{ rule: "ci-pipeline", severity: "wake-you-up", path: ".github/workflows/ci.yml", whySummary: "x", hasEvidence: false }] }),
    ev({ timestamp: "2026-06-10T00:00:00.000Z", disposition: "auto-pass",
      findings: [{ rule: "ci-pipeline", severity: "wake-you-up", path: ".github/workflows/deploy.yml", whySummary: "x", hasEvidence: false }] }),
  ];
  const input = buildAnalysisInput(events);
  expect(input.eventCount).toBe(2);
  expect(input.dateRange).toEqual({ from: "2026-06-08", to: "2026-06-10" });
  expect(input.blockedCount).toBe(1);
  expect(input.passCount).toBe(1);
  expect(input.rules[0]!.rule).toBe("ci-pipeline");
  expect(input.rules[0]!.count).toBe(2);
});

test("buildAnalysisInput:空事件不崩", () => {
  const input = buildAnalysisInput([]);
  expect(input.eventCount).toBe(0);
  expect(input.rules).toEqual([]);
});

test("assertNoSourceLeak:正常路径放行,含换行/超长串拦截", () => {
  const ok: AnalysisInput = { eventCount: 1, dateRange: { from: "2026-06-10", to: "2026-06-10" }, blockedCount: 0, passCount: 1,
    rules: [{ rule: "ci-pipeline", count: 1, wakeCount: 0, samplePaths: [".github/workflows/ci.yml"] }] };
  expect(() => assertNoSourceLeak(ok)).not.toThrow();

  const leak: AnalysisInput = { ...ok,
    rules: [{ rule: "x", count: 1, wakeCount: 0, samplePaths: ["const secret = 'abc'\nfunction leak() {}"] }] };
  expect(() => assertNoSourceLeak(leak)).toThrow();
});
