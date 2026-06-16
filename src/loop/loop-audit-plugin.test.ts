/**
 * loop-audit-plugin.test.ts — Unit tests for the guard-readiness plugin.
 *
 * Covers:
 *   - computeGuardReadiness: all four level boundaries (L0/L1/L2/L3)
 *   - guardReadinessJson: output is valid JSON with expected fields
 *   - detectGuardCapabilities: no session → all false; bad cwd → all false
 */

import { describe, expect, it } from "bun:test";
import {
  computeGuardReadiness,
  detectGuardCapabilities,
  guardReadinessJson,
  type GuardReadiness,
} from "./loop-audit-plugin";

// ---------------------------------------------------------------------------
// computeGuardReadiness — level boundary tests
// ---------------------------------------------------------------------------

describe("computeGuardReadiness", () => {
  it("returns L0 when no capabilities are present (score=0)", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: false,
      hasBudgetGate: false,
      hasEmergencyBrake: false,
      hasHookInstalled: false,
    });

    expect(r.score).toBe(0);
    expect(r.maxScore).toBe(4);
    expect(r.level).toBe("L0");
    expect(r.dimensions).toHaveLength(4);
    expect(r.dimensions.every((d) => !d.present)).toBe(true);
  });

  it("returns L1 when exactly one capability is present (score=1)", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: false,
      hasEmergencyBrake: false,
      hasHookInstalled: false,
    });

    expect(r.score).toBe(1);
    expect(r.level).toBe("L1");
  });

  it("returns L2 when exactly two capabilities are present (score=2)", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: true,
      hasEmergencyBrake: false,
      hasHookInstalled: false,
    });

    expect(r.score).toBe(2);
    expect(r.level).toBe("L2");
  });

  it("returns L3 when three capabilities are present (score=3)", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: true,
      hasEmergencyBrake: true,
      hasHookInstalled: false,
    });

    expect(r.score).toBe(3);
    expect(r.level).toBe("L3");
  });

  it("returns L3 when all four capabilities are present (score=4)", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: true,
      hasEmergencyBrake: true,
      hasHookInstalled: true,
    });

    expect(r.score).toBe(4);
    expect(r.maxScore).toBe(4);
    expect(r.level).toBe("L3");
    expect(r.dimensions.every((d) => d.present)).toBe(true);
  });

  it("dimension names are stable and in expected order", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: false,
      hasBudgetGate: false,
      hasEmergencyBrake: false,
      hasHookInstalled: false,
    });

    const names = r.dimensions.map((d) => d.name);
    expect(names).toEqual([
      "drift-detection",
      "budget-gate",
      "emergency-brake",
      "post-tool-use-hook",
    ]);
  });

  it("each dimension has weight=1", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: false,
      hasEmergencyBrake: true,
      hasHookInstalled: false,
    });

    expect(r.dimensions.every((d) => d.weight === 1)).toBe(true);
  });

  it("correctly maps individual capability flags to dimensions", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: false,
      hasEmergencyBrake: true,
      hasHookInstalled: false,
    });

    const byName = Object.fromEntries(r.dimensions.map((d) => [d.name, d]));
    expect(byName["drift-detection"].present).toBe(true);
    expect(byName["budget-gate"].present).toBe(false);
    expect(byName["emergency-brake"].present).toBe(true);
    expect(byName["post-tool-use-hook"].present).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// guardReadinessJson — output format tests
// ---------------------------------------------------------------------------

describe("guardReadinessJson", () => {
  it("returns valid JSON", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: false,
      hasEmergencyBrake: false,
      hasHookInstalled: false,
    });

    const json = guardReadinessJson(r);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("round-trips the GuardReadiness object", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: true,
      hasBudgetGate: true,
      hasEmergencyBrake: false,
      hasHookInstalled: true,
    });

    const parsed = JSON.parse(guardReadinessJson(r)) as GuardReadiness;
    expect(parsed.score).toBe(r.score);
    expect(parsed.maxScore).toBe(r.maxScore);
    expect(parsed.level).toBe(r.level);
    expect(parsed.dimensions).toHaveLength(4);
  });

  it("output includes top-level keys: score, maxScore, level, dimensions", () => {
    const r = computeGuardReadiness({
      hasDriftDetection: false,
      hasBudgetGate: false,
      hasEmergencyBrake: false,
      hasHookInstalled: false,
    });

    const parsed = JSON.parse(guardReadinessJson(r)) as Record<string, unknown>;
    expect("score" in parsed).toBe(true);
    expect("maxScore" in parsed).toBe(true);
    expect("level" in parsed).toBe(true);
    expect("dimensions" in parsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectGuardCapabilities — filesystem tests (no active session scenario)
// ---------------------------------------------------------------------------

describe("detectGuardCapabilities", () => {
  it("returns all-false for a non-existent cwd (no session, no settings)", () => {
    // Use a path that definitely has no active session and no settings file
    const caps = detectGuardCapabilities("/tmp/__nonexistent_guard_test__");

    expect(caps.hasDriftDetection).toBe(false);
    expect(caps.hasBudgetGate).toBe(false);
    expect(caps.hasEmergencyBrake).toBe(false);
    expect(caps.hasHookInstalled).toBe(false);
  });

  it("returns all-false for the OS temp dir (no session, no guard settings)", () => {
    const caps = detectGuardCapabilities("/tmp");

    // /tmp has no active loop session
    expect(caps.hasDriftDetection).toBe(false);
    // All should be false with no session
    expect(caps.hasBudgetGate).toBe(false);
    expect(caps.hasEmergencyBrake).toBe(false);
    // /tmp likely has no .claude/settings.json with agent-diff-guard
    expect(caps.hasHookInstalled).toBe(false);
  });

  it("does not throw for any input string", () => {
    // Verify error handling: even weird paths must not throw
    expect(() => detectGuardCapabilities("")).not.toThrow();
    expect(() => detectGuardCapabilities("/totally/fake/path/xyz")).not.toThrow();
  });

  it("returns a GuardCapabilities-shaped object", () => {
    const caps = detectGuardCapabilities("/tmp");

    expect(typeof caps.hasDriftDetection).toBe("boolean");
    expect(typeof caps.hasBudgetGate).toBe("boolean");
    expect(typeof caps.hasEmergencyBrake).toBe("boolean");
    expect(typeof caps.hasHookInstalled).toBe("boolean");
  });
});
