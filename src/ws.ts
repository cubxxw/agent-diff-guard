// ws.ts — WebSocket Hub：web 面板与 agent supervisor 之间的实时双向通道。
//
// Bun.serve 原生 WebSocket（零依赖），职责：
//   - 连接管理：跟踪所有活跃 client，断开自动清理
//   - 心跳：30s ping/pong，60s 无响应踢掉（检测僵尸连接）
//   - 广播：supervisor → 所有 web client（任务状态、输出流、审批请求）
//   - 点对点：web client → supervisor（提交任务、审批决策、取消任务）
//
// 消息协议：JSON，type 字段路由。见 ClientMessage / ServerMessage 类型。

import type { ServerWebSocket } from "bun";

// ── 消息协议 ──

export type ClientMessage =
  | { type: "task:submit"; payload: { title: string; prompt: string; repo?: string; priority?: 1 | 2 | 3 } }
  | { type: "task:cancel"; id: string }
  | { type: "approval:decision"; id: string; approved: boolean; note?: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "task:accepted"; id: string; task: AgentTaskView }
  | { type: "task:started"; id: string }
  | { type: "task:output"; id: string; stream: "stdout" | "stderr"; chunk: string; ts: number }
  | { type: "task:complete"; id: string; exitCode: number; durationMs: number }
  | { type: "task:failed"; id: string; error: string }
  | { type: "approval:required"; id: string; action: string; reason: string }
  | { type: "approval:resolved"; id: string; approved: boolean }
  | { type: "connected"; version: string; activeTask: AgentTaskView | null; queue: AgentTaskView[] }
  | { type: "pong" };

export interface AgentTaskView {
  id: string;
  title: string;
  prompt: string;
  repo?: string;
  priority: 1 | 2 | 3;
  status: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

// ── Hub 实现 ──

export type MessageHandler = (msg: ClientMessage, ws: ServerWebSocket<WsData>) => void;

export interface WsData {
  id: string;
  connectedAt: number;
  lastPong: number;
}

let clientCounter = 0;

export class WebSocketHub {
  private clients = new Set<ServerWebSocket<WsData>>();
  private handler: MessageHandler | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  handleOpen(ws: ServerWebSocket<WsData>): void {
    this.clients.add(ws);
  }

  handleClose(ws: ServerWebSocket<WsData>): void {
    this.clients.delete(ws);
  }

  handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: "error", reason: "invalid JSON" }));
      return;
    }

    if (msg.type === "ping") {
      ws.data.lastPong = Date.now();
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    this.handler?.(msg, ws);
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  send(ws: ServerWebSocket<WsData>, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      this.clients.delete(ws);
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const ws of this.clients) {
        if (now - ws.data.lastPong > 60_000) {
          try { ws.close(1001, "heartbeat timeout"); } catch { /* noop */ }
          this.clients.delete(ws);
        }
      }
    }, 30_000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  shutdown(): void {
    this.stopHeartbeat();
    for (const ws of this.clients) {
      try { ws.close(1001, "server shutting down"); } catch { /* noop */ }
    }
    this.clients.clear();
  }

  static makeWsData(): WsData {
    return {
      id: `ws-${++clientCounter}`,
      connectedAt: Date.now(),
      lastPong: Date.now(),
    };
  }
}
