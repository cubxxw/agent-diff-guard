// insights.test.ts — 洞察引擎与密钥脱敏的单元测试(合成数据,不碰真实对话)。

import { test, expect } from "bun:test";
import { buildRepoInsight, redactSecrets } from "./insights";
import type { RepoTranscript } from "./transcript";

test("redactSecrets:各类密钥被打码,普通文本不动", () => {
  expect(redactSecrets("用 sk-proj-VMv9rn6aSt2zTgRxSdCG 调用")).toContain("[REDACTED]");
  expect(redactSecrets("token ghp_abcdefghijklmnopqrstuvwxyz12")).toContain("[REDACTED]");
  expect(redactSecrets("修复登录表单")).toBe("修复登录表单"); // 普通中文不动
  expect(redactSecrets("改 auth.ts")).toBe("改 auth.ts"); // 短文件名不误伤
  expect(redactSecrets("sk-proj-VMv9rn6aSt2zTgRxSdCGabcdef")).not.toContain("VMv9rn6aSt2zTgRxSdCG");
});

function rt(turns: { task: string; filesChanged: string[] }[]): RepoTranscript {
  return {
    project: "/Users/me/repo",
    repoDir: "/Users/me/repo",
    turns: turns.map((t) => ({ ...t, timestamp: "2026-06-10T00:00:00.000Z", gitBranch: "main", cwd: "/r" })),
  };
}

test("buildRepoInsight:聚合敏感文件触碰,按次数降序", () => {
  const ri = buildRepoInsight(
    rt([
      { task: "加个依赖", filesChanged: ["package.json"] },
      { task: "升级版本", filesChanged: ["package.json", "src/app.ts"] },
      { task: "改容器配置", filesChanged: ["Dockerfile"] },
      { task: "纯改样式", filesChanged: ["style.css"] }, // 不碰敏感区
    ])
  );
  expect(ri.turnCount).toBe(4);
  const dep = ri.evidence.find((e) => e.rule === "dependency-manifest");
  expect(dep?.hitCount).toBe(2); // package.json 碰了 2 次
  expect(dep?.sampleTasks).toContain("加个依赖");
  expect(dep?.sampleFiles).toContain("package.json");
  expect(ri.evidence.every((e) => !e.sampleFiles.includes("style.css"))).toBe(true);
});

test("buildRepoInsight:任务里的密钥在进 sampleTasks 时已脱敏", () => {
  const ri = buildRepoInsight(rt([{ task: "写入 .env: sk-proj-VMv9rn6aSt2zTgRxSdCGabcd", filesChanged: [".env"] }]));
  const env = ri.evidence.find((e) => e.rule === "env-file");
  expect(env).toBeTruthy();
  expect(env!.sampleTasks.some((t) => t.includes("[REDACTED]"))).toBe(true);
  expect(env!.sampleTasks.some((t) => t.includes("VMv9rn6aSt2zTgRxSdCG"))).toBe(false);
});

test("buildRepoInsight:无敏感触碰时 evidence 为空", () => {
  const ri = buildRepoInsight(rt([{ task: "改文档", filesChanged: ["README.md", "docs.md"] }]));
  expect(ri.evidence.length).toBe(0);
});
