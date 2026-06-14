// inbox.ts — 面板与终端之间的文件信箱。
//
// 为什么是文件信箱:浏览器(面板)和终端(Claude Code)是两个进程,需要一座桥。
// 文件是最朴素、零网络、可审计的桥 —— 面板把用户的决策写成一个 json,终端这边
// 轮询/读取这个目录拿到指令,处理完归档。和这个项目"克制、不引重依赖"的气质一致,
// 也天然延续了 events.jsonl 的"本机、可读、可审计"风格。
//
// 目录结构(在 ~/.agent-diff-guard/inbox/ 下):
//   pending/<ulid>.json   面板写入、等待终端消费的决策
//   done/<ulid>.json      终端已消费、归档留痕(可审计:谁在何时让 agent 做了什么)
//
// 铁律延续:这里只搬运"决策指令"(自然语言 + 元数据),不含代码正文。

import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { logDir } from "./logger";
import { generateUlid } from "./id";

/** 一条信箱指令:面板下发给终端 Claude Code 的决策。 */
export interface InboxItem {
  id: string; // ULID
  createdAt: string; // ISO 8601
  /** 来源建议的标题(给人看的) */
  title: string;
  /** 要终端执行的自然语言指令(直接可作为 Claude Code 的输入) */
  action: string;
  /**
   * 执行引擎提示(可选,run daemon 用):
   *   shell = action 是 shell 命令,直接 bash -lc 跑
   *   agent = action 是自然语言,交给 claude headless
   * 缺省时 run daemon 用 detectKind() 启发式推断。不破坏既有写入者。
   */
  kind?: "shell" | "agent";
  /** 这条决策的上下文:基于哪些规则/统计得出(去敏元数据,便于终端理解与留痕) */
  context: {
    rules?: string[];
    note?: string;
    urgency?: "high" | "medium" | "low";
  };
  /** 消费状态 */
  status: "pending" | "done";
}

export function inboxDir(): string {
  return join(logDir(), "inbox");
}
export function pendingDir(): string {
  return join(inboxDir(), "pending");
}
export function doneDir(): string {
  return join(inboxDir(), "done");
}

/**
 * 写一条决策到 pending/。返回写入的 InboxItem。
 * nowMs 可注入用于测试(项目里 ulid/时间都走可注入,延续这一约定)。
 */
export function writeDecision(
  o: { title: string; action: string; kind?: InboxItem["kind"]; context?: InboxItem["context"]; nowMs?: number }
): InboxItem {
  const nowMs = o.nowMs ?? Date.now();
  const item: InboxItem = {
    id: generateUlid(nowMs),
    createdAt: new Date(nowMs).toISOString(),
    title: o.title,
    action: o.action,
    ...(o.kind ? { kind: o.kind } : {}), // 仅在显式指定时写入,保持旧数据形状不变
    context: o.context ?? {},
    status: "pending",
  };
  mkdirSync(pendingDir(), { recursive: true });
  writeFileSync(join(pendingDir(), `${item.id}.json`), JSON.stringify(item, null, 2), "utf8");
  return item;
}

/** 列出 pending/ 里所有待消费指令,按 id(即时间)升序。坏文件跳过。 */
export function listPending(): InboxItem[] {
  const dir = pendingDir();
  if (!existsSync(dir)) return [];
  const out: InboxItem[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  for (const f of files.sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as InboxItem);
    } catch {
      // 坏行/半写文件跳过,不拖垮整个读取
    }
  }
  return out;
}

/** 列出 done/ 里所有已归档指令,按 id(即时间)升序。坏文件跳过。 */
export function listDone(): InboxItem[] {
  const dir = doneDir();
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: InboxItem[] = [];
  for (const f of files.sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as InboxItem);
    } catch {
      // 坏行/半写文件跳过
    }
  }
  return out;
}

/**
 * 标记一条指令为已消费:从 pending/ 移到 done/(改 status 后归档)。
 * 返回 true 表示成功移动,false 表示该 id 不存在于 pending。
 */
export function markDone(id: string): boolean {
  const src = join(pendingDir(), `${id}.json`);
  if (!existsSync(src)) return false;
  mkdirSync(doneDir(), { recursive: true });
  try {
    const item = JSON.parse(readFileSync(src, "utf8")) as InboxItem;
    item.status = "done";
    writeFileSync(src, JSON.stringify(item, null, 2), "utf8");
    renameSync(src, join(doneDir(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
