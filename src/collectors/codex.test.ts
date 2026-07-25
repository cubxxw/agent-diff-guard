// codex.test.ts — Codex CLI 采集源单元测试(合成 rollout jsonl,不碰真实 ~/.codex)。
//
// 隔离:用 ADG_CODEX_HOME 把 codexSessionsDir() 重定向到临时目录;用 ADG_HOME 把
// 缓存写入也重定向到临时目录,跟其他测试隔离机制一致(参考 logger.ts/audit.ts)。

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionFile, collectCodex, codexSessionsDir } from "./codex";

let codexRoot: string; // ADG_CODEX_HOME(假 ~/.codex)
let adgHome: string; // ADG_HOME(隔离缓存)
let origCodex: string | undefined;
let origAdg: string | undefined;

beforeEach(() => {
  origCodex = process.env.ADG_CODEX_HOME;
  origAdg = process.env.ADG_HOME;
  codexRoot = mkdtempSync(join(tmpdir(), "adg-codex-"));
  adgHome = mkdtempSync(join(tmpdir(), "adg-home-"));
  process.env.ADG_CODEX_HOME = codexRoot;
  process.env.ADG_HOME = adgHome;
});
afterEach(() => {
  if (origCodex === undefined) delete process.env.ADG_CODEX_HOME;
  else process.env.ADG_CODEX_HOME = origCodex;
  if (origAdg === undefined) delete process.env.ADG_HOME;
  else process.env.ADG_HOME = origAdg;
  rmSync(codexRoot, { recursive: true, force: true });
  rmSync(adgHome, { recursive: true, force: true });
});

/** 在 ADG_CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl 写一个 rollout 文件。 */
function writeRollout(date: { y: string; m: string; d: string }, name: string, lines: object[]): string {
  const dir = join(codexRoot, "sessions", date.y, date.m, date.d);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `rollout-${name}.jsonl`);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return p;
}

function sessionMeta(cwd: string, sessionId = "sess-x") {
  return {
    timestamp: "2026-06-24T16:25:14.805Z",
    type: "session_meta",
    payload: { session_id: sessionId, cwd, originator: "codex-tui" },
  };
}
function userMessage(text: string, ts = "2026-06-24T16:26:00.000Z") {
  return { timestamp: ts, type: "event_msg", payload: { type: "user_message", message: text } };
}
function patchApplyEnd(changes: Record<string, { type: string; content: string }>) {
  return { type: "event_msg", payload: { type: "patch_apply_end", success: true, changes } };
}

test("codexSessionsDir 优先读 ADG_CODEX_HOME", () => {
  expect(codexSessionsDir()).toBe(join(codexRoot, "sessions"));
});

test("parseSessionFile:把 user_message → patch_apply_end 对齐成 turn", () => {
  const p = writeRollout({ y: "2026", m: "06", d: "24" }, "abc", [
    sessionMeta("/repo/app"),
    userMessage("重构登录表单"),
    patchApplyEnd({
      "/repo/app/src/login.ts": { type: "update", content: "..." },
      "/repo/app/src/login.test.ts": { type: "add", content: "..." },
    }),
    userMessage("再修个 bug"),
    patchApplyEnd({ "/repo/app/src/api.ts": { type: "update", content: "..." } }),
  ]);
  const { cwd, turns } = parseSessionFile(p);
  expect(cwd).toBe("/repo/app");
  expect(turns.length).toBe(2);
  expect(turns[0]!.task).toBe("重构登录表单");
  expect(turns[0]!.filesChanged).toEqual(["login.ts", "login.test.ts"]); // basename 去重
  expect(turns[0]!.cwd).toBe("/repo/app");
  expect(turns[1]!.task).toBe("再修个 bug");
  expect(turns[1]!.filesChanged).toEqual(["api.ts"]);
});

test("parseSessionFile:没产生 patch 的纯问答 turn 被丢弃", () => {
  const p = writeRollout({ y: "2026", m: "06", d: "24" }, "ask-only", [
    sessionMeta("/repo/x"),
    userMessage("这段代码什么意思"),
    // 没有 patch_apply_end —— 该 turn 应该不出现
    userMessage("改一下"),
    patchApplyEnd({ "/repo/x/b.ts": { type: "update", content: "..." } }),
  ]);
  const { turns } = parseSessionFile(p);
  expect(turns.length).toBe(1);
  expect(turns[0]!.task).toBe("改一下");
});

test("parseSessionFile:系统包裹消息不算用户任务", () => {
  const p = writeRollout({ y: "2026", m: "06", d: "24" }, "wrappers", [
    sessionMeta("/r"),
    userMessage("[Fact-Forcing Gate]\n准备事实"),
    userMessage("<system-reminder>背景</system-reminder>"),
    userMessage("真实任务"),
    patchApplyEnd({ "/r/a.ts": { type: "update", content: "..." } }),
  ]);
  const { turns } = parseSessionFile(p);
  expect(turns.length).toBe(1);
  expect(turns[0]!.task).toBe("真实任务");
});

test("parseSessionFile:turn_context 中途切 cwd 也能跟上", () => {
  const p = writeRollout({ y: "2026", m: "06", d: "24" }, "switch", [
    sessionMeta("/repo/first"),
    userMessage("活儿 A"),
    patchApplyEnd({ "/repo/first/a.ts": { type: "update", content: "..." } }),
    { type: "turn_context", payload: { cwd: "/repo/second", model: "gpt-5.5" } },
    userMessage("活儿 B"),
    patchApplyEnd({ "/repo/second/b.ts": { type: "update", content: "..." } }),
  ]);
  const { turns } = parseSessionFile(p);
  expect(turns.length).toBe(2);
  expect(turns[0]!.cwd).toBe("/repo/first");
  expect(turns[1]!.cwd).toBe("/repo/second");
});

test("parseSessionFile:坏行(JSON parse 失败)不拖垮整文件", () => {
  // 手写一个含坏行的 rollout
  const dir = join(codexRoot, "sessions", "2026", "06", "24");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "rollout-broken.jsonl");
  writeFileSync(
    p,
    [
      JSON.stringify(sessionMeta("/r")),
      "{not-json-at-all",
      JSON.stringify(userMessage("活儿")),
      JSON.stringify(patchApplyEnd({ "/r/a.ts": { type: "update", content: "x" } })),
    ].join("\n") + "\n",
    "utf8",
  );
  const { turns } = parseSessionFile(p);
  expect(turns.length).toBe(1);
  expect(turns[0]!.filesChanged).toEqual(["a.ts"]);
});

test("collectCodex:按 cwd 聚合,同仓库多 rollout 的 turns 合并", () => {
  writeRollout({ y: "2026", m: "06", d: "24" }, "s1", [
    sessionMeta("/repo/app"),
    userMessage("活 1", "2026-06-24T10:00:00.000Z"),
    patchApplyEnd({ "/repo/app/a.ts": { type: "update", content: "x" } }),
  ]);
  writeRollout({ y: "2026", m: "06", d: "25" }, "s2", [
    sessionMeta("/repo/app"),
    userMessage("活 2", "2026-06-25T10:00:00.000Z"),
    patchApplyEnd({ "/repo/app/b.ts": { type: "update", content: "x" } }),
  ]);
  writeRollout({ y: "2026", m: "06", d: "25" }, "s3", [
    sessionMeta("/repo/other"),
    userMessage("别的仓库", "2026-06-25T11:00:00.000Z"),
    patchApplyEnd({ "/repo/other/c.ts": { type: "update", content: "x" } }),
  ]);
  const repos = collectCodex();
  expect(repos.length).toBe(2);
  const app = repos.find((r) => r.project === "/repo/app")!;
  expect(app).toBeTruthy();
  expect(app.repoDir).toBe("/repo/app");
  expect(app.turns.length).toBe(2);
  expect(app.turns[0]!.task).toBe("活 1"); // 按时间升序
  expect(app.turns[1]!.task).toBe("活 2");
});

test("collectCodex:目录不存在时干净返回 [],不抛", () => {
  process.env.ADG_CODEX_HOME = join(codexRoot, "nope-does-not-exist");
  expect(collectCodex()).toEqual([]);
});

test("collectCodex:增量缓存命中时不重 parse(写第二次仍能复用)", () => {
  writeRollout({ y: "2026", m: "06", d: "24" }, "stable", [
    sessionMeta("/repo/cached"),
    userMessage("活儿"),
    patchApplyEnd({ "/repo/cached/x.ts": { type: "update", content: "x" } }),
  ]);
  const first = collectCodex();
  const second = collectCodex();
  // 两次结果同形:cache 命中不应改变输出
  expect(second.length).toBe(first.length);
  expect(second[0]!.turns[0]!.filesChanged).toEqual(["x.ts"]);
});

test("collectCodex:忽略日期格式外的杂目录(不抛、不算)", () => {
  // 在 sessions 下放一个非日期目录,应被静默跳过
  mkdirSync(join(codexRoot, "sessions", "junk-dir"), { recursive: true });
  writeRollout({ y: "2026", m: "06", d: "24" }, "ok", [
    sessionMeta("/r"),
    userMessage("干活儿"), // ≥2 字符,绕开 isRealTask 的最短长度门槛
    patchApplyEnd({ "/r/a.ts": { type: "update", content: "x" } }),
  ]);
  const repos = collectCodex();
  expect(repos.length).toBe(1);
});
