// agentguard-bridge.test.ts — Unit tests for the AgentGuard47 interop layer.

import { describe, test, expect } from "bun:test";
import {
  parseAgentGuardTrace,
  extractBudgetSpend,
  verdictToAgentGuardEvent,
  type AgentGuardEvent,
} from "./agentguard-bridge";

// ─── parseAgentGuardTrace ─────────────────────────────────────────────────────

describe("parseAgentGuardTrace", () => {
  test("parses valid JSONL with multiple events", () => {
    const content = [
      JSON.stringify({ type: "budget_update", timestamp: "2026-06-17T10:00:00.000Z", tokens: 100, budget_used_usd: 0.002 }),
      JSON.stringify({ type: "tool_call", timestamp: "2026-06-17T10:01:00.000Z", tool: "read_file", success: true }),
    ].join("\n");

    const events = parseAgentGuardTrace(content);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("budget_update");
    expect(events[1].tool).toBe("read_file");
  });

  test("skips blank lines without error", () => {
    const content = [
      "",
      JSON.stringify({ type: "budget_update", timestamp: "2026-06-17T10:00:00.000Z" }),
      "   ",
      JSON.stringify({ type: "tool_call", timestamp: "2026-06-17T10:01:00.000Z" }),
      "",
    ].join("\n");

    const events = parseAgentGuardTrace(content);
    expect(events).toHaveLength(2);
  });

  test("skips malformed JSON lines and continues parsing", () => {
    const content = [
      JSON.stringify({ type: "budget_update", timestamp: "2026-06-17T10:00:00.000Z", tokens: 50 }),
      "{this is not valid json",
      "null",
      JSON.stringify({ type: "guard_verdict", timestamp: "2026-06-17T10:02:00.000Z" }),
    ].join("\n");

    const events = parseAgentGuardTrace(content);
    // "null" parses as null (not an object with type/timestamp) so it is skipped too
    expect(events).toHaveLength(2);
    expect(events[0].tokens).toBe(50);
    expect(events[1].type).toBe("guard_verdict");
  });

  test("skips lines missing required fields (type or timestamp)", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-06-17T10:00:00.000Z" }), // missing type
      JSON.stringify({ type: "budget_update" }),                   // missing timestamp
      JSON.stringify({ type: "tool_call", timestamp: "2026-06-17T10:01:00.000Z" }), // valid
    ].join("\n");

    const events = parseAgentGuardTrace(content);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_call");
  });

  test("returns empty array for empty content", () => {
    expect(parseAgentGuardTrace("")).toHaveLength(0);
    expect(parseAgentGuardTrace("   \n   \n")).toHaveLength(0);
  });

  test("preserves extra/unknown fields from future schema versions", () => {
    const content = JSON.stringify({
      type: "budget_update",
      timestamp: "2026-06-17T10:00:00.000Z",
      future_field: "hello",
      nested: { a: 1 },
    });

    const events = parseAgentGuardTrace(content);
    expect(events).toHaveLength(1);
    expect(events[0].future_field).toBe("hello");
  });
});

// ─── extractBudgetSpend ───────────────────────────────────────────────────────

describe("extractBudgetSpend", () => {
  test("aggregates tokens and cost from multiple events", () => {
    const events: AgentGuardEvent[] = [
      { type: "budget_update", timestamp: "2026-06-17T10:00:00.000Z", tokens: 100, budget_used_usd: 0.002 },
      { type: "budget_update", timestamp: "2026-06-17T10:01:00.000Z", tokens: 200, budget_used_usd: 0.004 },
      { type: "tool_call",     timestamp: "2026-06-17T10:02:00.000Z", tokens: 50,  budget_used_usd: 0.001 },
    ];

    const spend = extractBudgetSpend(events);
    expect(spend.inputTokens).toBe(350);
    expect(spend.outputTokens).toBe(0); // no output split in AgentGuard47
    expect(spend.estCostUsd).toBeCloseTo(0.007, 6);
  });

  test("skips events with missing or zero tokens/cost", () => {
    const events: AgentGuardEvent[] = [
      { type: "tool_call", timestamp: "2026-06-17T10:00:00.000Z" }, // no tokens, no cost
      { type: "budget_update", timestamp: "2026-06-17T10:01:00.000Z", tokens: 0, budget_used_usd: 0 },
      { type: "budget_update", timestamp: "2026-06-17T10:02:00.000Z", tokens: 42, budget_used_usd: 0.001 },
    ];

    const spend = extractBudgetSpend(events);
    expect(spend.inputTokens).toBe(42);
    expect(spend.estCostUsd).toBeCloseTo(0.001, 6);
  });

  test("returns zero spend for empty event list", () => {
    const spend = extractBudgetSpend([]);
    expect(spend.inputTokens).toBe(0);
    expect(spend.outputTokens).toBe(0);
    expect(spend.estCostUsd).toBe(0);
  });

  test("outputTokens is always 0 (not tracked by AgentGuard47)", () => {
    const events: AgentGuardEvent[] = [
      { type: "budget_update", timestamp: "2026-06-17T10:00:00.000Z", tokens: 1000, budget_used_usd: 0.02 },
    ];
    expect(extractBudgetSpend(events).outputTokens).toBe(0);
  });
});

// ─── verdictToAgentGuardEvent ─────────────────────────────────────────────────

describe("verdictToAgentGuardEvent", () => {
  test("creates a guard_verdict event with correct type", () => {
    const ev = verdictToAgentGuardEvent("pass", "no risky patterns found");
    expect(ev.type).toBe("guard_verdict");
  });

  test("timestamp is a valid ISO 8601 string close to now", () => {
    const before = Date.now();
    const ev = verdictToAgentGuardEvent("warn", "drift detected");
    const after = Date.now();

    const ts = new Date(ev.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100); // allow tiny clock slack
  });

  test("pass verdict sets success=true", () => {
    const ev = verdictToAgentGuardEvent("pass", "ok");
    expect(ev.success).toBe(true);
  });

  test("warn verdict sets success=true (warn is not a block)", () => {
    const ev = verdictToAgentGuardEvent("warn", "elevated risk");
    expect(ev.success).toBe(true);
  });

  test("block verdict sets success=false", () => {
    const ev = verdictToAgentGuardEvent("block", "danger: secret exposed");
    expect(ev.success).toBe(false);
  });

  test("round-trip: event is parseable by parseAgentGuardTrace", () => {
    const original = verdictToAgentGuardEvent("block", "test reason");
    const line = JSON.stringify(original);
    const parsed = parseAgentGuardTrace(line);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("guard_verdict");
    expect(parsed[0].adg_verdict).toBe("block");
    expect(parsed[0].adg_reason).toBe("test reason");
    expect(parsed[0].success).toBe(false);
  });

  test("embeds adg_verdict and adg_reason fields", () => {
    const ev = verdictToAgentGuardEvent("warn", "budget 80%");
    expect(ev.adg_verdict).toBe("warn");
    expect(ev.adg_reason).toBe("budget 80%");
  });
});
