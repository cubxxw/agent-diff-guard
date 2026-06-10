// context.test.ts — 危险地图聚合与渲染的单元测试。

import { test, expect } from "bun:test";
import { buildDangerMap, repoHistory, staticZones, renderMarkdown } from "./context";
import type { GuardEvent } from "./event";

// 造一条最小可用的 GuardEvent(只填聚合关心的字段)。
function ev(over: Partial<GuardEvent>): GuardEvent {
  return {
    id: "01",
    timestamp: "2026-06-10T00:00:00.000Z",
    cliVersion: "0.0.1",
    repoRemote: "github.com/me/repo",
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

test("staticZones 覆盖全部敏感规则且带人话 hint", () => {
  const zones = staticZones();
  expect(zones.length).toBeGreaterThan(0);
  const ci = zones.find((z) => z.rule === "ci-pipeline");
  expect(ci?.hint).toContain(".github/workflows");
});

test("repoHistory 只统计目标仓库,按命中次数降序", () => {
  const events = [
    ev({
      repoRemote: "github.com/me/repo",
      findings: [{ rule: "ci-pipeline", severity: "wake-you-up", path: ".github/workflows/ci.yml", whySummary: "x", hasEvidence: false }],
    }),
    ev({
      repoRemote: "github.com/me/repo",
      timestamp: "2026-06-11T00:00:00.000Z",
      findings: [
        { rule: "ci-pipeline", severity: "wake-you-up", path: ".github/workflows/deploy.yml", whySummary: "x", hasEvidence: false },
        { rule: "env-file", severity: "wake-you-up", path: ".env", whySummary: "x", hasEvidence: false },
      ],
    }),
    // 别的仓库:必须被排除
    ev({ repoRemote: "github.com/other/repo", findings: [{ rule: "ci-pipeline", severity: "wake-you-up", path: "x", whySummary: "x", hasEvidence: false }] }),
  ];
  const h = repoHistory(events, "github.com/me/repo");
  const top = h[0]!;
  expect(top.rule).toBe("ci-pipeline");
  expect(top.count).toBe(2); // 两条本仓库的 ci 命中,不含 other/repo
  expect(top.lastSeen).toBe("2026-06-11"); // 取最近一次
  expect(top.samplePaths).toContain(".github/workflows/ci.yml");
});

test("repoHistory samplePaths 去重且封顶 3 条", () => {
  const events = [
    ev({
      findings: Array.from({ length: 5 }, (_, i) => ({
        rule: "ci-pipeline" as const,
        severity: "wake-you-up" as const,
        path: `.github/workflows/w${i}.yml`,
        whySummary: "x",
        hasEvidence: false,
      })),
    }),
  ];
  const h = repoHistory(events, "github.com/me/repo");
  expect(h[0]!.count).toBe(5);
  expect(h[0]!.samplePaths.length).toBe(3); // 封顶 3
});

test("buildDangerMap 无历史时 eventsAnalyzed=0,markdown 给出占位说明", () => {
  const map = buildDangerMap({ repo: "github.com/me/repo", events: [] });
  expect(map.eventsAnalyzed).toBe(0);
  expect(map.history.length).toBe(0);
  const md = renderMarkdown(map);
  expect(md).toContain("暂无守门记录");
  expect(md).toContain("高危区"); // 通用清单始终存在
});

test("renderMarkdown 有历史时列出真实命中,且不泄露代码正文", () => {
  const events = [
    ev({ findings: [{ rule: "hardcoded-secret", severity: "wake-you-up", path: "config.ts", whySummary: "x", hasEvidence: true }] }),
  ];
  const map = buildDangerMap({ repo: "github.com/me/repo", events });
  const md = renderMarkdown(map);
  expect(md).toContain("hardcoded-secret");
  expect(md).toContain("config.ts"); // 路径可出区
  // 渲染里不该出现 whySummary 之外的任何 evidence/代码字段(隐私分区)
  expect(md).not.toContain("hasEvidence");
});
