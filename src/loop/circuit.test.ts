import { test, expect, describe } from "bun:test";
import { circuitBreakerCheck, recordToolCall, type ToolCallEntry } from "./circuit";

const ts = (n: number) => `2026-06-17T00:00:0${n}.000Z`;

function hist(...entries: [string, boolean][]): ToolCallEntry[] {
  return entries.map(([tool, success], i) => ({ tool, success, timestamp: ts(i) }));
}

describe("circuitBreakerCheck", () => {
  test("empty history → not tripped", () => {
    const r = circuitBreakerCheck([]);
    expect(r.tripped).toBe(false);
    expect(r.tool).toBeNull();
  });

  test("trailing success → not tripped, counter reset", () => {
    const r = circuitBreakerCheck(hist(["Edit", false], ["Edit", true]));
    expect(r.tripped).toBe(false);
    expect(r.consecutiveFailures).toBe(0);
  });

  test("same tool fails 3x consecutively → tripped", () => {
    const r = circuitBreakerCheck(hist(["Bash", false], ["Bash", false], ["Bash", false]));
    expect(r.tripped).toBe(true);
    expect(r.tool).toBe("Bash");
    expect(r.consecutiveFailures).toBe(3);
    expect(r.recommendation).toContain("safe mode");
  });

  test("different tool resets the run", () => {
    const r = circuitBreakerCheck(hist(["Bash", false], ["Bash", false], ["Edit", false]));
    expect(r.tripped).toBe(false);
    expect(r.consecutiveFailures).toBe(1);
    expect(r.tool).toBe("Edit");
  });

  test("custom threshold of 2", () => {
    const r = circuitBreakerCheck(hist(["Bash", false], ["Bash", false]), 2);
    expect(r.tripped).toBe(true);
  });
});

describe("recordToolCall", () => {
  test("appends immutably", () => {
    const h0: ToolCallEntry[] = [];
    const h1 = recordToolCall(h0, "Edit", true, ts(0));
    expect(h0.length).toBe(0);
    expect(h1.length).toBe(1);
    expect(h1[0]).toEqual({ tool: "Edit", success: true, timestamp: ts(0) });
  });

  test("caps history length", () => {
    let h: ToolCallEntry[] = [];
    for (let i = 0; i < 10; i++) h = recordToolCall(h, "Edit", true, ts(0), 5);
    expect(h.length).toBe(5);
  });
});
