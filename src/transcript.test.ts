// transcript.test.ts — "任务→改动"提取的单元测试(合成 jsonl,不碰真实 session)。

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscriptFile } from "./transcript";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "adg-tr-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

/** 写一个合成 session jsonl,返回路径。 */
function writeSession(lines: object[]): string {
  const p = join(tmp, "s.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return p;
}

function userMsg(text: string, extra: object = {}) {
  return { type: "user", timestamp: "2026-06-10T00:00:00.000Z", gitBranch: "main", message: { role: "user", content: text }, ...extra };
}
function assistantEdit(file: string) {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: file } }] } };
}

test("把用户任务与其后的文件改动对齐", () => {
  const p = writeSession([
    userMsg("重构登录表单"),
    assistantEdit("/repo/src/login.ts"),
    assistantEdit("/repo/src/login.test.ts"),
    userMsg("再修个 bug"),
    assistantEdit("/repo/src/api.ts"),
  ]);
  const turns = parseTranscriptFile(p);
  expect(turns.length).toBe(2);
  expect(turns[0]!.task).toBe("重构登录表单");
  expect(turns[0]!.filesChanged).toEqual(["login.ts", "login.test.ts"]); // 去路径
  expect(turns[1]!.task).toBe("再修个 bug");
  expect(turns[1]!.filesChanged).toEqual(["api.ts"]);
});

test("系统包裹消息不算用户任务", () => {
  const p = writeSession([
    userMsg("<command-name>/clear</command-name>"),
    userMsg("<task-notification>done</task-notification>"),
    userMsg("<system-reminder>背景</system-reminder>"),
    userMsg("真实任务", {}),
    assistantEdit("/repo/a.ts"),
  ]);
  const turns = parseTranscriptFile(p);
  expect(turns.length).toBe(1);
  expect(turns[0]!.task).toBe("真实任务");
});

test("没产生改动的纯问答 turn 被过滤", () => {
  const p = writeSession([
    userMsg("解释一下这段代码"), // 无后续 edit
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "这段代码..." }] } },
    userMsg("改一下"),
    assistantEdit("/repo/b.ts"),
  ]);
  const turns = parseTranscriptFile(p);
  expect(turns.length).toBe(1); // 只保留有改动的
  expect(turns[0]!.task).toBe("改一下");
});

test("Write/MultiEdit 也被识别为改动", () => {
  const p = writeSession([
    userMsg("建文件"),
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/r/new.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "MultiEdit", input: { file_path: "/r/multi.ts" } }] } },
  ]);
  const turns = parseTranscriptFile(p);
  expect(turns[0]!.filesChanged).toEqual(["new.ts", "multi.ts"]);
});
