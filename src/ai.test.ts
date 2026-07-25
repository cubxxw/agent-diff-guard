// ai.test.ts — AI 层纯函数测试(不触网:配置解析 / 输入聚合 / 隐私守护)。

import { test, expect } from "bun:test";
import { readAIConfig, isAIEnabled, buildAnalysisInput, assertNoSourceLeak, deepCodeAllowed, answerAskGuard, type AnalysisInput } from "./ai";
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

// ── Ask Guard 隐私开关:代码上云必须显式同意 ──
test("deepCodeAllowed:默认关,只有 ADG_AI_CLOUD_DEEPCODE=1 才开", () => {
  expect(deepCodeAllowed({})).toBe(false);
  expect(deepCodeAllowed({ ADG_AI_CLOUD_DEEPCODE: "0" })).toBe(false);
  expect(deepCodeAllowed({ ADG_AI_CLOUD_DEEPCODE: "true" })).toBe(false); // 必须精确 "1"
  expect(deepCodeAllowed({ ADG_AI_CLOUD_DEEPCODE: "1" })).toBe(true);
});

test("answerAskGuard:无 config 直接返回 null(降级,不触网)", async () => {
  const reply = await answerAskGuard("本周态势如何", { route: "overview" }, { config: null });
  expect(reply).toBeNull();
});

test("answerAskGuard:空问题返回 null", async () => {
  const reply = await answerAskGuard("   ", { route: "overview" }, { config: { apiKey: "k", baseUrl: "https://x", model: "m" } });
  expect(reply).toBeNull();
});

// 上游故障降级:网关把错误塞进 200 响应(content / error 字段)或返回非 2xx 时,
// 必须降级为 null —— 不能把 "... reasoning engine returned an error" 当成回答透传到面板。
const CFG = { apiKey: "k", baseUrl: "https://x", model: "m" };
function withMockFetch(makeResponse: () => Response | Promise<Response>, fn: () => Promise<void>) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => makeResponse()) as unknown as typeof fetch;
  return fn().finally(() => { globalThis.fetch = orig; });
}

test("answerAskGuard:上游把错误塞进 200 content → 降级 null(根因路径)", async () => {
  await withMockFetch(
    () => new Response(JSON.stringify({ choices: [{ message: { content: "Vantage's reasoning engine returned an error" } }] }), { status: 200 }),
    async () => {
      const reply = await answerAskGuard("态势如何", { route: "overview" }, { config: CFG });
      expect(reply).toBeNull();
    }
  );
});

test("answerAskGuard:上游 200 但带 error 字段 → 降级 null", async () => {
  await withMockFetch(
    () => new Response(JSON.stringify({ error: { message: "internal server error" } }), { status: 200 }),
    async () => {
      const reply = await answerAskGuard("态势如何", { route: "overview" }, { config: CFG });
      expect(reply).toBeNull();
    }
  );
});

test("answerAskGuard:上游非 2xx → 降级 null", async () => {
  await withMockFetch(
    () => new Response("upstream 503", { status: 503 }),
    async () => {
      const reply = await answerAskGuard("态势如何", { route: "overview" }, { config: CFG });
      expect(reply).toBeNull();
    }
  );
});

test("answerAskGuard:正常 JSON 回答正常返回(不误杀)", async () => {
  await withMockFetch(
    () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ kind: "p", text: "一切正常" }] }) } }] }), { status: 200 }),
    async () => {
      const reply = await answerAskGuard("态势如何", { route: "overview" }, { config: CFG });
      expect(reply).not.toBeNull();
      expect(reply?.blocks?.[0]).toMatchObject({ kind: "p", text: "一切正常" });
    }
  );
});
