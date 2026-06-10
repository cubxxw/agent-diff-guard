// violations.test.ts — 越界检测 + policy 加载的单元测试(合成数据)。

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, parsePolicies, POLICY_FILE, type Policy } from "./policy";
import { detectViolations, summarizeViolations } from "./violations";
import type { TaskTurn } from "./transcript";

function turn(o: Partial<TaskTurn>): TaskTurn {
  return { task: "t", filesChanged: [], timestamp: "2026-06-10T12:00:00.000Z", gitBranch: "main", cwd: "/r", ...o };
}

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "adg-pol-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

test("loadPolicy:无文件返回空规矩(不造规矩)", () => {
  expect(loadPolicy(tmp).policies).toEqual([]);
});

test("loadPolicy:读取并校验合法规矩,丢弃坏的", () => {
  writeFileSync(join(tmp, POLICY_FILE), JSON.stringify({
    policies: [
      { kind: "frozen-path", name: "禁改部署", paths: ["deploy.sh"], reason: "发布脚本冻结" },
      { kind: "frozen-path", name: "缺 paths" }, // 坏:无 paths
      { kind: "freeze-window", name: "发布冻结", from: "2026-06-01T00:00:00Z", to: "2026-06-30T23:59:59Z", reason: "月末冻结" },
      { kind: "unknown-kind", name: "x" }, // 坏:未知类型
    ],
  }), "utf8");
  const ps = loadPolicy(tmp).policies;
  expect(ps.length).toBe(2); // 只留 2 条合法的
  expect(ps.map((p) => p.kind).sort()).toEqual(["freeze-window", "frozen-path"]);
});

test("parsePolicies:freeze-window 的 from>to 被拒", () => {
  const ps = parsePolicies({ policies: [{ kind: "freeze-window", name: "x", from: "2026-06-30T00:00:00Z", to: "2026-06-01T00:00:00Z", reason: "" }] });
  expect(ps.length).toBe(0);
});

test("frozen-path:改了被冻结的文件 → 越界", () => {
  const policies: Policy[] = [{ kind: "frozen-path", name: "禁改部署", paths: ["deploy.sh", "prod.env"], reason: "发布冻结" }];
  const turns = [
    turn({ task: "改部署脚本", filesChanged: ["deploy.sh", "readme.md"] }),
    turn({ task: "改文档", filesChanged: ["readme.md"] }), // 不碰冻结文件
  ];
  const v = detectViolations(turns, policies);
  expect(v.length).toBe(1);
  expect(v[0]!.offendingFiles).toEqual(["deploy.sh"]); // 只报命中的文件
  expect(v[0]!.policyName).toBe("禁改部署");
});

test("freeze-window:窗口内有改动 → 越界,窗口外不报", () => {
  const policies: Policy[] = [{ kind: "freeze-window", name: "发布冻结", from: "2026-06-10T00:00:00.000Z", to: "2026-06-10T23:59:59.000Z", reason: "" }];
  const inWindow = turn({ task: "窗口内改了东西", filesChanged: ["a.ts"], timestamp: "2026-06-10T12:00:00.000Z" });
  const outWindow = turn({ task: "窗口外", filesChanged: ["b.ts"], timestamp: "2026-06-11T12:00:00.000Z" });
  const v = detectViolations([inWindow, outWindow], policies);
  expect(v.length).toBe(1);
  expect(v[0]!.task).toBe("窗口内改了东西");
});

test("空 policy → 永不报越界(没规矩就没违规)", () => {
  expect(detectViolations([turn({ filesChanged: ["anything"] })], [])).toEqual([]);
});

test("summarizeViolations:按规矩聚合次数,降序", () => {
  const policies: Policy[] = [{ kind: "frozen-path", name: "禁改X", paths: ["x"], reason: "" }];
  const turns = [turn({ filesChanged: ["x1"] }), turn({ filesChanged: ["x2"] })];
  const sum = summarizeViolations(detectViolations(turns, policies));
  expect(sum[0]!.policyName).toBe("禁改X");
  expect(sum[0]!.count).toBe(2);
});
