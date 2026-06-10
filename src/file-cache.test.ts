// file-cache.test.ts — 增量磁盘缓存的正确性测试。
// 用临时 ADG_HOME(缓存落处)+ 临时 HOME(假 ~/.claude/projects)。
// 若本平台 homedir() 不读 HOME(无法隔离 projectsDir),相关断言跳过 —— 标记为已知限制。

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

let tmpAdg: string;
let tmpClaude: string;
const origAdg = process.env.ADG_HOME;
const origHome = process.env.HOME;

beforeEach(() => {
  tmpAdg = mkdtempSync(join(tmpdir(), "adg-fc-cache-"));
  process.env.ADG_HOME = tmpAdg;
  tmpClaude = mkdtempSync(join(tmpdir(), "adg-fc-home-"));
  process.env.HOME = tmpClaude;
  mkdirSync(join(tmpClaude, ".claude", "projects", "-proj-a"), { recursive: true });
});
afterEach(() => {
  if (origAdg === undefined) delete process.env.ADG_HOME; else process.env.ADG_HOME = origAdg;
  if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
  rmSync(tmpAdg, { recursive: true, force: true });
  rmSync(tmpClaude, { recursive: true, force: true });
});

function writeJsonl(file: string, lines: object[]) {
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

test("首跑解析、二跑命中、改文件后重解析", async () => {
  if (homedir() !== tmpClaude) return; // 平台不读 HOME,跳过
  const { incrementalByFile } = await import("./file-cache");
  const f = join(tmpClaude, ".claude", "projects", "-proj-a", "s1.jsonl");
  writeJsonl(f, [{ n: 1 }, { n: 2 }, { n: 3 }]);

  let parseCalls = 0;
  const parse = (fp: string) => { parseCalls++; return fp; };

  incrementalByFile("test-cache", parse);
  expect(parseCalls).toBe(1); // 首跑解析 1 个文件

  incrementalByFile("test-cache", parse);
  expect(parseCalls).toBe(1); // 二跑命中缓存,不再解析

  writeJsonl(f, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]); // size 变 → 指纹失效
  incrementalByFile("test-cache", parse);
  expect(parseCalls).toBe(2);
});

test("缓存文件落在 ADG_HOME,坏缓存降级为全量重建", async () => {
  if (homedir() !== tmpClaude) return;
  const { incrementalByFile } = await import("./file-cache");
  const f = join(tmpClaude, ".claude", "projects", "-proj-a", "s1.jsonl");
  writeJsonl(f, [{ n: 1 }]);

  let calls = 0;
  incrementalByFile("test-cache2", () => { calls++; return 1; });
  expect(calls).toBe(1);
  expect(existsSync(join(tmpAdg, "test-cache2.json"))).toBe(true); // 缓存落 ADG_HOME

  writeFileSync(join(tmpAdg, "test-cache2.json"), "{ broken json", "utf8"); // 写坏
  incrementalByFile("test-cache2", () => { calls++; return 1; });
  expect(calls).toBe(2); // 降级重建,再解析一次
});
