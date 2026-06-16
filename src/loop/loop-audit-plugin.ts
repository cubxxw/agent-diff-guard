/**
 * loop-audit-plugin.ts — Guard-readiness plugin for cobusgreyling/loop-engineering loop-audit.
 *
 * Computes an L0-L3 readiness score along four guard dimensions:
 *   1. Drift detection — active loop session exists
 *   2. Budget gate    — session has a token budget configured
 *   3. Emergency brake — session is running in unattended mode (brake enabled)
 *   4. PostToolUse hook — agent-diff-guard hook is installed in .claude/settings.json
 *
 * Usage:
 *   import { detectGuardCapabilities, computeGuardReadiness, guardReadinessJson } from "./loop-audit-plugin";
 *   const caps = detectGuardCapabilities(process.cwd());
 *   const result = computeGuardReadiness(caps);
 *   console.log(guardReadinessJson(result));
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activeSessionForCwd } from "./session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Readiness level: L0 = no guards, L3 = all guards present. */
export type ReadinessLevel = "L0" | "L1" | "L2" | "L3";

/** A single scored dimension in the guard-readiness report. */
export interface GuardDimension {
  name: string;
  present: boolean;
  weight: number;
}

/** Full guard-readiness report as consumed by loop-audit. */
export interface GuardReadiness {
  score: number;
  maxScore: number;
  level: ReadinessLevel;
  dimensions: GuardDimension[];
}

// ---------------------------------------------------------------------------
// Score → level mapping
// ---------------------------------------------------------------------------

function scoreToLevel(score: number): ReadinessLevel {
  if (score <= 0) return "L0";
  if (score === 1) return "L1";
  if (score === 2) return "L2";
  return "L3"; // 3 or 4
}

// ---------------------------------------------------------------------------
// Core computation (pure, no I/O)
// ---------------------------------------------------------------------------

export interface GuardCapabilities {
  hasDriftDetection: boolean;
  hasBudgetGate: boolean;
  hasEmergencyBrake: boolean;
  hasHookInstalled: boolean;
}

/**
 * Compute guard-readiness from a set of capability flags.
 * Each present dimension contributes +1 to the score (weight = 1 each).
 */
export function computeGuardReadiness(opts: GuardCapabilities): GuardReadiness {
  const dimensions: GuardDimension[] = [
    {
      name: "drift-detection",
      present: opts.hasDriftDetection,
      weight: 1,
    },
    {
      name: "budget-gate",
      present: opts.hasBudgetGate,
      weight: 1,
    },
    {
      name: "emergency-brake",
      present: opts.hasEmergencyBrake,
      weight: 1,
    },
    {
      name: "post-tool-use-hook",
      present: opts.hasHookInstalled,
      weight: 1,
    },
  ];

  const maxScore = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const score = dimensions.reduce(
    (sum, d) => sum + (d.present ? d.weight : 0),
    0,
  );
  const level = scoreToLevel(score);

  return { score, maxScore, level, dimensions };
}

// ---------------------------------------------------------------------------
// JSON serialisation (for loop-audit plugin protocol)
// ---------------------------------------------------------------------------

/**
 * Serialise a GuardReadiness report to a JSON string.
 * The output format is stable and suitable for consumption by loop-audit plugins.
 */
export function guardReadinessJson(r: GuardReadiness): string {
  return JSON.stringify(r, null, 2);
}

// ---------------------------------------------------------------------------
// Capability detection (I/O, errors are silently caught)
// ---------------------------------------------------------------------------

/**
 * Detect guard capabilities by inspecting the active loop session and the
 * project's .claude/settings.json file.
 *
 * All file reads are wrapped in try/catch; any I/O failure returns false for
 * the affected dimension rather than throwing.
 *
 * @param cwd  Working directory of the agent being audited.
 */
export function detectGuardCapabilities(cwd: string): GuardCapabilities {
  // --- 1 & 2 & 3: Inspect active loop session --------------------------
  let hasDriftDetection = false;
  let hasBudgetGate = false;
  let hasEmergencyBrake = false;

  try {
    const session = activeSessionForCwd(cwd);
    if (session) {
      // A session exists → drift detection is active
      hasDriftDetection = true;
      // Budget gate is active when a token budget has been set
      hasBudgetGate = session.budgetTokens != null && session.budgetTokens > 0;
      // Emergency brake fires in unattended mode
      hasEmergencyBrake = session.mode === "unattended";
    }
  } catch {
    // If session lookup fails, leave all three as false
  }

  // --- 4: Check .claude/settings.json for the hook ---------------------
  let hasHookInstalled = false;

  try {
    const settingsPath = join(cwd, ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      // Look for "agent-diff-guard" anywhere in the serialised settings
      hasHookInstalled =
        typeof parsed === "object" &&
        parsed !== null &&
        raw.includes("agent-diff-guard");
    }
  } catch {
    // Leave as false if the file is missing or unparseable
  }

  return {
    hasDriftDetection,
    hasBudgetGate,
    hasEmergencyBrake,
    hasHookInstalled,
  };
}
