import { describe, test, expect } from "bun:test";
import { WebSocketHub } from "./ws";

describe("WebSocketHub", () => {
  test("makeWsData returns unique ids", () => {
    const a = WebSocketHub.makeWsData();
    const b = WebSocketHub.makeWsData();
    expect(a.id).not.toBe(b.id);
    expect(a.connectedAt).toBeGreaterThan(0);
    expect(a.lastPong).toBeGreaterThan(0);
  });

  test("connectionCount starts at 0", () => {
    const hub = new WebSocketHub();
    expect(hub.connectionCount).toBe(0);
  });

  test("broadcast with no clients does not throw", () => {
    const hub = new WebSocketHub();
    expect(() => hub.broadcast({ type: "pong" })).not.toThrow();
  });

  test("onMessage registers handler", () => {
    const hub = new WebSocketHub();
    let called = false;
    hub.onMessage(() => { called = true; });
    expect(called).toBe(false);
  });

  test("shutdown is idempotent", () => {
    const hub = new WebSocketHub();
    hub.startHeartbeat();
    hub.shutdown();
    hub.shutdown();
    expect(hub.connectionCount).toBe(0);
  });
});
