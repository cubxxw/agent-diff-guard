// rules.test.ts — 守门人判断力的回归测试。
// 第一版命门是"宁可漏不可烦",所以这里既测"真该报的报到了",
// 也测"正常改动不许误报"(误报用例和命中用例一样重要)。

import { test, expect } from "bun:test";
import { runRules, type FileChange } from "./rules";

function fc(p: string, over: Partial<FileChange> = {}): FileChange {
  return { path: p, kind: "modified", addedLines: [], removedLines: [], ...over };
}

test("命中:改动 CI 流水线该半夜惊醒", () => {
  const f = runRules([fc(".github/workflows/deploy.yml")]);
  expect(f.some((x) => x.rule === "ci-pipeline" && x.severity === "wake-you-up")).toBe(true);
});

test("命中:改 Terraform 该看一眼", () => {
  const f = runRules([fc("infra/main.tf")]);
  expect(f.some((x) => x.rule === "iac-terraform")).toBe(true);
});

test("命中:删测试 = agent 让 CI 变绿的廉价作弊", () => {
  const f = runRules([fc("src/auth.test.ts", { kind: "deleted" })]);
  expect(f.some((x) => x.rule === "test-deleted")).toBe(true);
});

test("命中:疑似硬编码密钥", () => {
  const f = runRules([
    fc("src/config.ts", { addedLines: ['const apiKey = "sk_live_a1b2c3d4e5f6g7h8";'] }),
  ]);
  expect(f.some((x) => x.rule === "hardcoded-secret")).toBe(true);
});

// ── 误报防线:这些是正常改动,一条都不许报 ──────────────────────────
test("不误报:普通业务代码改动", () => {
  const f = runRules([
    fc("src/components/Button.tsx", { addedLines: ["return <button>{label}</button>;"] }),
  ]);
  expect(f.length).toBe(0);
});

test("不误报:示例/占位的假密钥", () => {
  const f = runRules([
    fc("README.md", { addedLines: ['apiKey = "your-api-key-here-example"'] }),
  ]);
  expect(f.length).toBe(0);
});

test("不误报:正常补充测试(新增而非删除)", () => {
  const f = runRules([
    fc("src/foo.test.ts", { kind: "added", addedLines: ["test('x', () => {})"] }),
  ]);
  expect(f.length).toBe(0);
});
