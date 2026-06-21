// rule-overrides.test.ts — 规则覆盖层的核心契约。
//
// 验证不变量:
//   1. applyOverrides 对空覆盖是 no-op(不改任何 finding);
//   2. disable 剔除该规则命中;
//   3. downgrade 把 wake-you-up 降为 look-once,且只往更安静方向(不动 look-once);
//   4. 不可变:返回新数组/新对象,不改入参;
//   5. 只影响被覆盖的规则,其它规则原样保留。

import { test, expect, describe } from "bun:test";
import { applyOverrides, isOverrideAction, type RuleOverrides } from "./rule-overrides";
import type { Finding } from "./rules";

const wake = (rule: string, path = "a.ts"): Finding => ({ rule, severity: "wake-you-up", path, why: "w" });
const look = (rule: string, path = "b.ts"): Finding => ({ rule, severity: "look-once", path, why: "l" });
const ov = (overrides: RuleOverrides["overrides"]): RuleOverrides => ({ version: 1, overrides });

describe("applyOverrides", () => {
  test("空覆盖 → no-op(原样返回)", () => {
    const fs = [wake("ci-pipeline"), look("dependency-manifest")];
    expect(applyOverrides(fs, ov({}))).toEqual(fs);
  });

  test("disable → 剔除该规则命中,其它保留", () => {
    const fs = [wake("ci-pipeline"), wake("authz-surface")];
    const out = applyOverrides(fs, ov({ "ci-pipeline": { action: "disable" } }));
    expect(out.length).toBe(1);
    expect(out[0]!.rule).toBe("authz-surface");
  });

  test("downgrade → wake-you-up 降为 look-once", () => {
    const out = applyOverrides([wake("ci-pipeline")], ov({ "ci-pipeline": { action: "downgrade" } }));
    expect(out.length).toBe(1);
    expect(out[0]!.severity).toBe("look-once");
  });

  test("downgrade 对已是 look-once 的不变(只往更安静方向)", () => {
    const out = applyOverrides([look("dependency-manifest")], ov({ "dependency-manifest": { action: "downgrade" } }));
    expect(out[0]!.severity).toBe("look-once");
  });

  test("不可变:不修改入参 finding 对象", () => {
    const f = wake("ci-pipeline");
    applyOverrides([f], ov({ "ci-pipeline": { action: "downgrade" } }));
    expect(f.severity).toBe("wake-you-up"); // 原对象未被改
  });

  test("只影响被覆盖规则,混合场景", () => {
    const fs = [wake("ci-pipeline"), wake("authz-surface"), look("dependency-manifest")];
    const out = applyOverrides(fs, ov({ "ci-pipeline": { action: "disable" }, "authz-surface": { action: "downgrade" } }));
    expect(out.map((f) => `${f.rule}:${f.severity}`)).toEqual([
      "authz-surface:look-once",
      "dependency-manifest:look-once",
    ]);
  });
});

describe("isOverrideAction", () => {
  test("只接受 disable/downgrade", () => {
    expect(isOverrideAction("disable")).toBe(true);
    expect(isOverrideAction("downgrade")).toBe(true);
    expect(isOverrideAction("upgrade")).toBe(false);
    expect(isOverrideAction(null)).toBe(false);
    expect(isOverrideAction("")).toBe(false);
  });
});
