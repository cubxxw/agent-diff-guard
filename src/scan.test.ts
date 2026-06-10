// scan.test.ts — 偏离检测的行为测试,重点覆盖中文任务(旧版会整段失效)。

import { test, expect } from "bun:test";
import { driftFindings } from "./scan";
import type { FileChange } from "./rules";

function fc(path: string): FileChange {
  return { path, kind: "modified", addedLines: [], removedLines: [] };
}

test("中文任务:与任务无关的改动应被标为偏离(回归 — 旧版中文整段丢失)", () => {
  // 任务讲的是"登录表单",却改了 payment/billing —— 应命中偏离
  const changes = [fc("src/login/form.ts"), fc("src/payment/billing.ts")];
  const out = driftFindings(changes, "重构登录表单的校验逻辑");
  const drifted = out.map((f) => f.path);
  // 本用例的关键价值:中文任务下 kws 非空 → 偏离检测真正运行,
  // 而不是像旧版那样因切词丢光中文直接 return 空。
  expect(out.length).toBeGreaterThan(0);
  expect(drifted).toContain("src/payment/billing.ts");
});

test("空任务:不做偏离检测", () => {
  expect(driftFindings([fc("a.ts")], undefined)).toEqual([]);
  expect(driftFindings([fc("a.ts")], "   ")).toEqual([]);
});

test("英文任务仍按原逻辑工作", () => {
  const changes = [fc("src/auth/login.ts"), fc("docs/readme.md")];
  const out = driftFindings(changes, "refactor login authentication flow");
  // login 路径含 "login" 关键词 → 相关,不报;docs/readme 无关 → 报
  expect(out.map((f) => f.path)).toContain("docs/readme.md");
  expect(out.map((f) => f.path)).not.toContain("src/auth/login.ts");
});

test("全部偏离且改动数>2:整体压制避免刷屏", () => {
  const changes = [fc("a.ts"), fc("b.ts"), fc("c.ts")];
  // 任务关键词和任何路径都不沾边 → 本会全部偏离 → 压制为空
  const out = driftFindings(changes, "完全无关的任务描述内容");
  expect(out).toEqual([]);
});
