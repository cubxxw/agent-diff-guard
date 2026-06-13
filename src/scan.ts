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
      const path = m?.[2] ?? line.slice("diff --git ".length);
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

/**
 * 从一段任务描述里抽出有意义的关键词(粗糙但够用)。
 *
 * 切词同时保留拉丁词与 CJK 段:旧版只按 [^a-z0-9_] 切,会把中文/日文整段丢弃,
 * 导致中文任务描述下偏离检测彻底失效(kws 为空 → 直接放过)。
 * 拉丁词要求 ≥4 字(滤掉 the/fix);CJK 段要求 ≥2 字(一个汉字太短易误命中,两字起更像实词)。
 */
function taskKeywords(task: string): string[] {
  const latin = task
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 4);
  // 抓连续的 CJK 片段(中文/日文假名/韩文),≥2 字才算关键词
  const cjk = task.match(/[一-鿿぀-ヿ가-힯]{2,}/g) ?? [];
  return Array.from(new Set([...latin, ...cjk]));
}

// 无信息量的任务停用词:这些词本身不指向任何具体改动范围,
// 任务描述若只由它们(+ 标点)构成,词面偏离检测无从判断 —— 不能默认"0% 偏离=安全"。
const LOW_INFO_TOKENS = [
  "继续", "接着", "修复", "修改", "解决", "问题", "重启", "重新启动", "从新启动", "启动",
  "优化", "处理", "完成", "实现", "更新", "调整", "下一步", "继续做",
  "continue", "fix", "fixit", "redo", "retry", "again", "proceed", "resume", "done",
];

/**
 * 判断任务描述是否"信息量不足以做偏离检测"。
 * 触发条件(任一):trim 后过短(<4 字),或抽不出有效关键词,
 * 或所有关键词都落在停用词表里(如"继续分析解决问题"——全是无指向的动词/名词)。
 * 这是 P0-4 的核心:低信息任务不应被判 0% 偏离(假安全),而应明确标"无法判断"。
 */
export function isLowInfoTask(task: string | undefined): boolean {
  if (!task) return true;
  const t = task.trim();
  if (t.length < 4) return true;
  const kws = taskKeywords(t);
  if (kws.length === 0) return true;
  // 每个关键词若都包含/等于某个停用词,则视为无指向
  const meaningful = kws.filter((kw) => !LOW_INFO_TOKENS.some((s) => kw === s || kw.includes(s)));
  return meaningful.length === 0;
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
