// supervisor.ts — Agent Supervisor：持续运行的任务编排核心。
//
// 职责：
//   - 从 task-queue 取任务，调用 executor 执行 Claude Code headless
//   - 流式读取 stdout/stderr，通过 WebSocket Hub 实时推送到 web 面板
//   - PAUSE kill-switch 支持（~/.agent-diff-guard/PAUSE 存在时暂停）
//   - 全程留痕：run-events.jsonl + tasks/ 文件状态
//   - 串行执行：同时只有一个 agent 任务在跑
//
// 与 runner.ts 的区别：runner 处理的是 inbox 决策（面板→终端的旧桥），
// supervisor 处理的是 agent 任务（task-queue，支持流式输出和实时通信）。

import { join } from "node:path";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { logDir } from "./logger";
import {
  submitTask, nextPending, markRunning, markCompleted,
  cancelTask, recoverCrashed, listTasksPending,
  listTasksDone, toView, type AgentTask,
} from "./task-queue";
import { buildClaudeArgs, type ExecOpts, type ClaudeOpts } from "./executor";
import { WebSocketHub, type ClientMessage, type ServerMessage } from "./ws";
import type { ServerWebSocket } from "bun";
import type { WsData } from "./ws";
import pkg from "../package.json" with { type: "json" };

function findClaudeBin(): string {
  const known = [
    join(process.env.HOME ?? "", ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of known) {
    if (existsSync(p)) return p;
  }
  return "claude";
}

export interface SupervisorOpts {
  pollMs?: number;
  signal?: AbortSignal;
  claudeBin?: string;
  claudeOpts?: ClaudeOpts;
  execOpts?: ExecOpts;
}

export class Supervisor {
  private hub: WebSocketHub;
  private currentTask: AgentTask | null = null;
  private currentProc: { kill: (sig?: number) => void } | null = null;
  private running = false;

  constructor(hub: WebSocketHub) {
    this.hub = hub;
    this.hub.onMessage((msg, ws) => this.handleClientMessage(msg, ws));
  }

  private paused(): boolean {
    return existsSync(join(logDir(), "PAUSE"));
  }

  async start(opts: SupervisorOpts = {}): Promise<void> {
    const pollMs = opts.pollMs ?? 2000;
    this.running = true;

    const recovered = recoverCrashed();
    if (recovered > 0) {
      this.logEvent("recovered", `恢复 ${recovered} 个崩溃中断的任务到 pending 队列`);
    }

    this.hub.startHeartbeat();

    while (this.running && !opts.signal?.aborted) {
      if (this.paused()) {
        await sleep(pollMs, opts.signal);
        continue;
      }

      const task = nextPending();
      if (!task) {
        await sleep(pollMs, opts.signal);
        continue;
      }

      await this.executeTask(task, opts);
    }
  }

  stop(): void {
    this.running = false;
    if (this.currentProc) {
      try { this.currentProc.kill(9); } catch { /* noop */ }
    }
    this.hub.shutdown();
  }

  private async executeTask(task: AgentTask, opts: SupervisorOpts): Promise<void> {
    markRunning(task.id);
    this.currentTask = task;

    this.hub.broadcast({ type: "task:started", id: task.id });
    this.logEvent("task_started", `开始执行: ${task.title}`, task.id);

    const startMs = Date.now();
    const claudeBin = opts.claudeBin ?? findClaudeBin();
    const claudeOpts: ClaudeOpts = {
      permissionMode: "acceptEdits",
      outputFormat: "stream-json",
      ...opts.claudeOpts,
    };
    const execOpts: ExecOpts = {
      timeoutMs: 300_000,
      maxOutput: 128 * 1024,
      ...(task.repo ? { cwd: task.repo } : {}),
      ...opts.execOpts,
    };

    const args = buildClaudeArgs(task.prompt, claudeOpts);
    const cmd = [claudeBin, ...args];

    let exitCode = 1;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    try {
      const proc = Bun.spawn(cmd, {
        cwd: execOpts.cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      this.currentProc = proc;

      const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(9); } catch { /* noop */ }
      }, execOpts.timeoutMs ?? 300_000);

      const stdoutReader = this.streamOutput(task.id, "stdout", proc.stdout);
      const stderrReader = this.streamOutput(task.id, "stderr", proc.stderr);

      const [stdoutText, stderrText, code] = await Promise.all([
        stdoutReader,
        stderrReader,
        proc.exited,
      ]);
      clearTimeout(timer);

      stdout = this.clip(stdoutText, execOpts.maxOutput ?? 128 * 1024);
      stderr = this.clip(stderrText, execOpts.maxOutput ?? 128 * 1024);
      exitCode = timedOut ? 124 : code;
    } catch (e) {
      stderr = e instanceof Error ? e.message : String(e);
      this.logEvent("exec_failed", stderr, task.id);
    }

    this.currentProc = null;
    this.currentTask = null;

    const durationMs = Date.now() - startMs;
    markCompleted(task.id, { exitCode, stdout, stderr, durationMs });

    if (exitCode === 0) {
      this.hub.broadcast({ type: "task:complete", id: task.id, exitCode, durationMs });
      this.logEvent("task_complete", `成功完成: ${task.title} (${durationMs}ms)`, task.id);
    } else {
      const error = timedOut ? "执行超时被终止" : `exit code ${exitCode}`;
      this.hub.broadcast({ type: "task:failed", id: task.id, error });
      this.logEvent("task_failed", `失败: ${task.title} — ${error}`, task.id);
    }
  }

  private async streamOutput(
    taskId: string,
    stream: "stdout" | "stderr",
    readable: ReadableStream<Uint8Array>,
  ): Promise<string> {
    const decoder = new TextDecoder();
    let full = "";
    try {
      for await (const chunk of readable) {
        const text = decoder.decode(chunk, { stream: true });
        full += text;
        this.hub.broadcast({
          type: "task:output",
          id: taskId,
          stream,
          chunk: text,
          ts: Date.now(),
        });
      }
    } catch {
      // stream ended or errored
    }
    return full;
  }

  private clip(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max) + "\n…[输出已截断]";
  }

  private handleClientMessage(msg: ClientMessage, ws: ServerWebSocket<WsData>): void {
    switch (msg.type) {
      case "task:submit": {
        const { title, prompt, repo, priority } = msg.payload;
        if (!prompt?.trim()) {
          this.hub.send(ws, { type: "task:failed", id: "", error: "缺少 prompt" });
          return;
        }
        const task = submitTask({ title: title || "未命名任务", prompt, repo, priority });
        const view = toView(task);
        this.hub.send(ws, { type: "task:accepted", id: task.id, task: view });
        this.hub.broadcast({ type: "task:accepted", id: task.id, task: view });
        this.logEvent("task_submitted", `新任务: ${task.title}`, task.id);
        break;
      }

      case "task:cancel": {
        const ok = cancelTask(msg.id);
        if (ok) {
          this.hub.broadcast({ type: "task:failed", id: msg.id, error: "用户取消" });
          this.logEvent("task_cancelled", `取消任务: ${msg.id}`, msg.id);
        }
        if (!ok && this.currentTask?.id === msg.id && this.currentProc) {
          try { this.currentProc.kill(9); } catch { /* noop */ }
          this.logEvent("task_killed", `强制终止运行中任务: ${msg.id}`, msg.id);
        }
        break;
      }

      case "approval:decision": {
        this.hub.broadcast({
          type: "approval:resolved",
          id: msg.id,
          approved: msg.approved,
        });
        this.logEvent("approval", `审批决策: ${msg.id} → ${msg.approved ? "批准" : "拒绝"}`, msg.id);
        break;
      }

      default:
        break;
    }
  }

  getConnectedMessage(): ServerMessage {
    const active = this.currentTask ? toView(this.currentTask) : null;
    const pending = listTasksPending().map(toView);
    const done = listTasksDone(10).map(toView);
    return {
      type: "connected",
      version: pkg.version,
      activeTask: active,
      queue: [...(active ? [active] : []), ...pending, ...done],
    };
  }

  private logEvent(kind: string, detail: string, taskId?: string): void {
    try {
      mkdirSync(logDir(), { recursive: true });
      const line = JSON.stringify({
        source: "supervisor",
        kind,
        taskId,
        detail,
        at: new Date().toISOString(),
      }) + "\n";
      appendFileSync(join(logDir(), "run-events.jsonl"), line, "utf8");
    } catch {
      // logging must never crash supervisor
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
