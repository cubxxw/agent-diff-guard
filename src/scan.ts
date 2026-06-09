// scan.ts — 把 git diff 解析成结构化的 FileChange[],并做"任务 vs 改动"偏离检测。
//
// 偏离检测是这个产品真正的差异化(CI/lint 做不了的):
// agent 本来的任务是 A,却顺手改了和 A 无关的 B —— 这是 agent 时代独有的雷。
// 第一版用最粗糙但真实的形式:从任务描述抓关键词,标出"和任务毫无词面关联"的改动文件。

import { spawnSync } from "node:child_process";
import type { FileChange, Finding } from "./rules";

/** 跑 git 命令,返回 stdout(失败抛错) */
function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/**
 * 解析 `git diff <range> --unified=0` 的输出为 FileChange[]。
 * 用 -U0 让我们只拿到真正改动的行,减少噪音。
 */
export function parseDiff(range: string, cwd: string): FileChange[] {
  const raw = git(["diff", range, "--unified=0", "--no-color"], cwd);
  const lines = raw.split("\n");
  const changes: FileChange[] = [];
  let cur: FileChange | null = null;

  const push = () => { if (cur) changes.push(cur); };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      push();
      // diff --git a/path b/path
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const path = m ? m[2] : line.slice("diff --git ".length);
      cur = { path, kind: "modified", addedLines: [], removedLines: [] };
    } else if (!cur) {
      continue;
    } else if (line.startsWith("new file")) {
      cur.kind = "added";
    } else if (line.startsWith("deleted file")) {
      cur.kind = "deleted";
    } else if (line.startsWith("rename ")) {
      cur.kind = "renamed";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      cur.addedLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      cur.removedLines.push(line.slice(1));
    }
  }
  push();
  return changes;
}

/** 从一段任务描述里抽出有意义的关键词(粗糙但够用) */
function taskKeywords(task: string): string[] {
  return Array.from(
    new Set(
      task
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length >= 4) // 丢掉 the/fix/and 这类短词
    )
  );
}

/**
 * 偏离检测:声称的任务里一个关键词都没出现在文件路径上的改动 = 可疑的"顺手改"。
 * 保守:只有当 task 非空、且确实有改动文件时才报;命中也只标 look-once,不阻断。
 * 这是种子版本 —— 真正的语义偏离以后可以叠模型,但第一版先用词面关联跑通闭环。
 */
export function driftFindings(changes: FileChange[], task: string | undefined): Finding[] {
  if (!task || !task.trim()) return [];
  const kws = taskKeywords(task);
  if (kws.length === 0) return [];

  const out: Finding[] = [];
  for (const fc of changes) {
    const p = fc.path.toLowerCase();
    const related = kws.some((kw) => p.includes(kw));
    if (!related) {
      out.push({
        rule: "task-drift",
        severity: "look-once",
        path: fc.path,
        why: `改动文件与声称的任务无明显关联(任务关键词: ${kws.slice(0, 6).join(", ")}) —— agent 可能顺手改了任务范围外的东西`,
      });
    }
  }
  // 全部偏离往往说明任务描述太抽象(关键词没用),这种情况整体压制,避免刷屏
  if (out.length === changes.length && changes.length > 2) return [];
  return out;
}
