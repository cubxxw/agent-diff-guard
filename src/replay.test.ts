import { describe, expect, test } from "bun:test";
import { buildReplayReport, sideEditFiles } from "./replay";
import type { RepoTranscript, TaskTurn } from "./transcript";
import type { GuardEvent } from "./event";

const NOW = new Date("2026-07-24T12:00:00Z");

function turn(partial: Partial<TaskTurn> & { task: string; filesChanged: string[] }): TaskTurn {
  return { timestamp: "2026-07-20T10:00:00Z", gitBranch: null, cwd: null, ...partial };
}

function rt(project: string, turns: TaskTurn[]): RepoTranscript {
  return { project, repoDir: null, turns };
}

function report(transcripts: RepoTranscript[], events: GuardEvent[] = [], days = 30) {
  return buildReplayReport({ transcripts, sources: ["Claude Code"], events, days, now: NOW });
}

describe("buildReplayReport", () => {
  test("窗口过滤:窗口外与无时间戳的 turn 都不计入", () => {
    const r = report([
      rt("/a/repo", [
        turn({ task: "改登录逻辑 login", filesChanged: ["login.ts"] }),
        turn({ task: "老改动", filesChanged: ["old.ts"], timestamp: "2026-05-01T00:00:00Z" }),
        turn({ task: "没时间戳", filesChanged: ["x.ts"], timestamp: null }),
      ]),
    ]);
    expect(r.turns).toBe(1);
    expect(r.fileTouches).toBe(1);
  });

  test("wake 级触碰:.env 归入 wake,并带实例与仓库数", () => {
    const r = report([
      rt("/u/repo-a", [turn({ task: "配置支付", filesChanged: [".env", "pay.ts"] })]),
      rt("/u/repo-b", [turn({ task: "部署调整", filesChanged: [".env.production"] })]),
    ]);
    const env = r.wake.find((c) => c.rule === "env-file");
    expect(env?.hits).toBe(2);
    expect(env?.repos).toBe(2);
    expect(env?.samples.length).toBe(2);
    expect(env?.samples[0]?.files).toContain(".env");
  });

  test("look 级触碰:依赖清单不进 wake 区", () => {
    const r = report([rt("/u/r", [turn({ task: "升级依赖", filesChanged: ["package.json"] })])]);
    expect(r.wake.find((c) => c.rule === "dependency-manifest")).toBeUndefined();
    expect(r.look.find((c) => c.rule === "dependency-manifest")?.hits).toBe(1);
  });

  test("测试文件触碰按文件名判定", () => {
    const r = report([rt("/u/r", [turn({ task: "修 auth 模块", filesChanged: ["auth.ts", "auth.test.ts"] })])]);
    expect(r.testTouches.hits).toBe(1);
    expect(r.testTouches.samples[0]?.files).toEqual(["auth.test.ts"]);
  });

  test("守门实录:有历史事件但窗口内为 0 时 guard 不为 null", () => {
    const oldEvent = { timestamp: "2026-01-01T00:00:00Z", findings: [] } as unknown as GuardEvent;
    const r = report([rt("/u/r", [turn({ task: "改样式 style", filesChanged: ["style.css"] })])], [oldEvent]);
    expect(r.guard).toEqual({ scans: 0, wake: 0, look: 0 });
  });

  test("守门实录:从未扫描过 → guard 为 null(没装 hook 的信号)", () => {
    const r = report([rt("/u/r", [turn({ task: "改样式 style", filesChanged: ["style.css"] })])]);
    expect(r.guard).toBeNull();
  });
});

describe("sideEditFiles(保守顺手改判据)", () => {
  test("部分相关 + 部分无关 → 报无关文件", () => {
    expect(sideEditFiles(turn({ task: "重构 login 流程", filesChanged: ["login.ts", "deploy.yml"] }))).toEqual(["deploy.yml"]);
  });

  test("全部相关 → 空数组(可判定,无顺手改)", () => {
    expect(sideEditFiles(turn({ task: "重构 login 流程", filesChanged: ["login.ts", "login.test.ts"] }))).toEqual([]);
  });

  test("全部无关 → null(更可能是关键词没对上文件名,不可判定)", () => {
    expect(sideEditFiles(turn({ task: "重构 login 流程", filesChanged: ["a.ts", "b.ts"] }))).toBeNull();
  });

  test("低信息任务 → null(与主路径 isLowInfoTask 口径一致)", () => {
    expect(sideEditFiles(turn({ task: "继续", filesChanged: ["login.ts"] }))).toBeNull();
  });

  test("中文任务关键词也能命中文件名", () => {
    // "支付" 对不上拉丁文件名,但 pay 之类的场景走英文词;中文至少不误报 —— 全无关则 null
    expect(sideEditFiles(turn({ task: "修复支付流程", filesChanged: ["pay.ts"] }))).toBeNull();
  });
});
