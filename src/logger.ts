// logger.ts — 守门事件的本地落盘与读取。
//
// 落盘格式:JSONL(每行一个 GuardEvent),追加写入 ~/.agent-diff-guard/events.jsonl。
// 为什么是 JSONL 而非 DB:零依赖、人可读、坏一行不影响其余、天然支持流式追加 ——
// 和这个项目"克制、不引重依赖"的气质一致。云端化时再迁 SQLite(见架构蓝图 Layer 3)。
//
// 铁律:写日志失败绝不能影响守门主流程的退出码。日志是观测,不是守门本身。

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import type { GuardEvent } from "./event";

/** 日志根目录:~/.agent-diff-guard */
export function logDir(): string {
  return join(homedir(), ".agent-diff-guard");
}

/** 事件日志文件路径 */
export function eventsPath(): string {
  return join(logDir(), "events.jsonl");
}

/**
 * 追加一条事件到 events.jsonl。
 * 同步实现:调用点在 CLI 退出前,需保证写完;但用 try/catch 兜底,
 * 任何失败只 warn,绝不抛出影响退出码。
 */
export function appendEvent(event: GuardEvent): void {
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(eventsPath(), JSON.stringify(event) + "\n", "utf8");
  } catch (e) {
    console.warn("[adg] 事件日志写入失败(不影响守门结果):", (e as Error).message);
  }
}

/**
 * 读回所有事件。坏掉的行(JSON parse 失败)跳过,不让一行损坏拖垮整个面板。
 * since:可选,只返回 timestamp >= since 的事件(ISO 8601 字符串比较即时间比较)。
 */
export function readEvents(opts: { since?: string } = {}): GuardEvent[] {
  const path = eventsPath();
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    console.warn("[adg] 读取事件日志失败:", (e as Error).message);
    return [];
  }

  const out: GuardEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as GuardEvent;
      if (opts.since && ev.timestamp < opts.since) continue;
      out.push(ev);
    } catch {
      // 坏行跳过(可能是写入中断的半行)
    }
  }
  return out;
}
