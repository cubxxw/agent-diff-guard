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

// ── 分级:常规清单类只 look-once,不半夜叫醒(对齐"宁可漏不可烦") ────────
test("分级:装依赖(package.json)是 look-once,不是 wake", () => {
  const f = runRules([fc("package.json", { addedLines: ['    "lodash": "^4.17.21",'] })]);
  const dep = f.find((x) => x.rule === "dependency-manifest");
  expect(dep?.severity).toBe("look-once");
});

test("分级:改 Dockerfile 是 look-once;k8s 清单是 look-once", () => {
  const a = runRules([fc("Dockerfile")]);
  expect(a.find((x) => x.rule === "container-build")?.severity).toBe("look-once");
  const b = runRules([fc("k8s/deploy.yaml")]);
  expect(b.find((x) => x.rule === "k8s-manifest")?.severity).toBe("look-once");
});

test("分级:高危仍是 wake(env/iac/鉴权)", () => {
  expect(runRules([fc(".env.production")]).find((x) => x.rule === "env-file")?.severity).toBe("wake-you-up");
  expect(runRules([fc("infra/main.tf")]).find((x) => x.rule === "iac-terraform")?.severity).toBe("wake-you-up");
  expect(runRules([fc("src/auth/policy.ts")]).find((x) => x.rule === "authz-surface")?.severity).toBe("wake-you-up");
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
