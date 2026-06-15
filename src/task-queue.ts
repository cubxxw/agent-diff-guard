// task-queue.ts — Agent 任务队列：文件持久化、优先级、生命周期管理。
//
// 目录结构（在 ~/.agent-diff-guard/tasks/ 下）：
//   pending/<ulid>.json   等待执行
//   running/<ulid>.json   正在执行（同时只有一个）
//   done/<ulid>.json      执行完成（成功或失败）
//
// 延续 inbox.ts 的「文件即桥、本机可审计」风格。

import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { logDir } from "./logger";
import { generateUlid } from "./id";
import type { AgentTaskView } from "./ws";

// ── AgentTask 接口 ──

export interface AgentTask {
  id: string;
  createdAt: string;
  title: string;
  prompt: string;
  repo?: string;
  priority: 1 | 2 | 3;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  approvals?: Array<{ id: string; action: string; decision: "approved" | "rejected"; at: string }>;
}

// ── 路径 ──

function tasksDir(): string { return join(logDir(), "tasks"); }
function taskPendingDir(): string { return join(tasksDir(), "pending"); }
function taskRunningDir(): string { return join(tasksDir(), "running"); }
function taskDoneDir(): string { return join(tasksDir(), "done"); }

// ── 队列操作 ──

export function submitTask(o: {
  title: string;
  prompt: string;
  repo?: string;
  priority?: 1 | 2 | 3;
  nowMs?: number;
}): AgentTask {
  const nowMs = o.nowMs ?? Date.now();
  const task: AgentTask = {
    id: generateUlid(nowMs),
    createdAt: new Date(nowMs).toISOString(),
    title: o.title,
    prompt: o.prompt,
    ...(o.repo ? { repo: o.repo } : {}),
    priority: o.priority ?? 2,
    status: "pending",
  };
  mkdirSync(taskPendingDir(), { recursive: true });
  writeFileSync(join(taskPendingDir(), `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
  return task;
}

export function nextPending(): AgentTask | null {
  const all = readJsonDir<AgentTask>(taskPendingDir());
  if (all.length === 0) return null;
  all.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });
  return all[0] ?? null;
}

export function listTasksPending(): AgentTask[] {
  return readJsonDir<AgentTask>(taskPendingDir());
}

export function listTasksRunning(): AgentTask[] {
  return readJsonDir<AgentTask>(taskRunningDir());
}

export function listTasksDone(limit = 50): AgentTask[] {
  return readJsonDir<AgentTask>(taskDoneDir()).slice(-limit).reverse();
}

export function findTask(id: string): AgentTask | null {
  for (const dir of [taskPendingDir(), taskRunningDir(), taskDoneDir()]) {
    const p = join(dir, `${id}.json`);
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as AgentTask;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function markRunning(id: string, nowMs?: number): boolean {
  const src = join(taskPendingDir(), `${id}.json`);
  if (!existsSync(src)) return false;
  mkdirSync(taskRunningDir(), { recursive: true });
  try {
    const task = JSON.parse(readFileSync(src, "utf8")) as AgentTask;
    task.status = "running";
    task.startedAt = new Date(nowMs ?? Date.now()).toISOString();
    writeFileSync(src, JSON.stringify(task, null, 2), "utf8");
    renameSync(src, join(taskRunningDir(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export function markCompleted(id: string, result: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  nowMs?: number;
}): boolean {
  const src = join(taskRunningDir(), `${id}.json`);
  if (!existsSync(src)) return false;
  mkdirSync(taskDoneDir(), { recursive: true });
  try {
    const task = JSON.parse(readFileSync(src, "utf8")) as AgentTask;
    task.status = result.exitCode === 0 ? "done" : "failed";
    task.finishedAt = new Date(result.nowMs ?? Date.now()).toISOString();
    task.exitCode = result.exitCode;
    if (result.stdout !== undefined) task.stdout = result.stdout;
    if (result.stderr !== undefined) task.stderr = result.stderr;
    if (result.durationMs !== undefined) task.durationMs = result.durationMs;
    writeFileSync(src, JSON.stringify(task, null, 2), "utf8");
    renameSync(src, join(taskDoneDir(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export function cancelTask(id: string, nowMs?: number): boolean {
  const src = join(taskPendingDir(), `${id}.json`);
  if (!existsSync(src)) return false;
  mkdirSync(taskDoneDir(), { recursive: true });
  try {
    const task = JSON.parse(readFileSync(src, "utf8")) as AgentTask;
    task.status = "cancelled";
    task.finishedAt = new Date(nowMs ?? Date.now()).toISOString();
    writeFileSync(src, JSON.stringify(task, null, 2), "utf8");
    renameSync(src, join(taskDoneDir(), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export function recoverCrashed(): number {
  const running = readJsonDir<AgentTask>(taskRunningDir());
  let recovered = 0;
  for (const task of running) {
    const src = join(taskRunningDir(), `${task.id}.json`);
    task.status = "pending";
    delete task.startedAt;
    mkdirSync(taskPendingDir(), { recursive: true });
    try {
      writeFileSync(src, JSON.stringify(task, null, 2), "utf8");
      renameSync(src, join(taskPendingDir(), `${task.id}.json`));
      recovered++;
    } catch {
      // skip
    }
  }
  return recovered;
}

export function toView(task: AgentTask): AgentTaskView {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    repo: task.repo,
    priority: task.priority,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    exitCode: task.exitCode,
  };
}

// ── 共用 ──

function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const f of files.sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
    } catch {
      // skip bad files
    }
  }
  return out;
}
