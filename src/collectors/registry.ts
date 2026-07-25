// collectors/registry.ts — 采集源注册表。
//
// 把所有 Collector 汇总成一份"全机器、跨 agent"的 transcript。新增一个 agent 的
// 支持,只需在这里把它的 collector 加进 COLLECTORS 数组 —— 主干、策略层、消费层
// 都不用动。这是插件式扩展的接入点。
//
// 合并语义:不同 agent 可能在同一个仓库里干活(你既用 Claude Code 又用 Cursor 改
// 同一个 repo)。registry 按仓库 key 合并它们的 turns,让消费层始终看到"一仓一条
// transcript",而不是按 agent 割裂。

import type { Collector, RepoTranscript, TaskTurn } from "./types";
import { claudeCodeCollector } from "./claude-code";
import { codexCollector } from "./codex";

/** 已注册的采集源。新 agent 在此登记即接入(无需改主干)。 */
export const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector];

/** 当前在本机可用的采集源(对应日志目录存在)。 */
export function availableCollectors(): Collector[] {
  return COLLECTORS.filter((c) => {
    try {
      return c.available();
    } catch {
      return false; // 探测失败按不可用处理,绝不拖垮其它源
    }
  });
}

/**
 * 跨所有可用 collector 采集,按仓库合并。
 * 仓库 key 优先用真实 repoDir(准确绝对路径);拿不到时退回 project(展示路径)。
 * 合并后 turns 按时间升序,让"飞行记录时间线"消费层拿到的就是有序的。
 */
export function collectAll(): RepoTranscript[] {
  const byRepo = new Map<string, { project: string; repoDir: string | null; turns: TaskTurn[] }>();

  for (const c of availableCollectors()) {
    let repos: RepoTranscript[];
    try {
      repos = c.collect();
    } catch {
      continue; // 单个源解析失败不影响其它源
    }
    for (const r of repos) {
      const key = r.repoDir ?? r.project;
      const existing = byRepo.get(key);
      if (existing) {
        existing.turns.push(...r.turns);
        // 真实 repoDir 一旦有人提供就保留(某些源可能拿不到 cwd)
        if (!existing.repoDir && r.repoDir) existing.repoDir = r.repoDir;
      } else {
        byRepo.set(key, { project: r.project, repoDir: r.repoDir, turns: [...r.turns] });
      }
    }
  }

  return [...byRepo.values()].map((v) => ({
    project: v.project,
    repoDir: v.repoDir,
    turns: v.turns.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
  }));
}
