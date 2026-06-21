import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoopSession, IterationResult } from "./types";
import { saveSession } from "./session";
import { logDir } from "../logger";

/**
 * Check whether an emergency brake should be applied.
 * Triggers:
 *  1. Last 3 riskTrend entries all verdict==="block"
 *  2. cumulativeDrift > 0.8
 *  3. Last riskTrend entry budgetPct > 0.95
 *  4. Last findingsLog entry severity==="wake-you-up" AND rule matches "frozen-path"
 */
export function shouldEmergencyBrake(
  session: LoopSession,
): { brake: boolean; reason: string } {
  const { riskTrend, cumulativeDrift, findingsLog } = session;

  // 1. 3 consecutive blocks
  if (riskTrend.length >= 3) {
    const last3 = riskTrend.slice(-3);
    if (last3.every((r) => r.verdict === "block")) {
      return { brake: true, reason: "3 consecutive block verdicts" };
    }
  }

  // 2. Cumulative drift > 0.8
  if (cumulativeDrift > 0.8) {
    return {
      brake: true,
      reason: `cumulative drift ${cumulativeDrift.toFixed(2)} > 0.8`,
    };
  }

  // 3. Budget > 95%
  if (riskTrend.length > 0) {
    const last = riskTrend[riskTrend.length - 1]!;
    if (last.budgetPct > 0.95) {
      return {
        brake: true,
        reason: `budget at ${(last.budgetPct * 100).toFixed(0)}% > 95%`,
      };
    }
  }

  // 4. Last finding is wake-you-up + frozen-path
  if (findingsLog.length > 0) {
    const lastFinding = findingsLog[findingsLog.length - 1]!;
    if (
      lastFinding.severity === "wake-you-up" &&
      lastFinding.rule.includes("frozen-path")
    ) {
      return {
        brake: true,
        reason: `frozen-path wake-you-up on ${lastFinding.path}`,
      };
    }
  }

  return { brake: false, reason: "" };
}

/**
 * Execute emergency brake: mark session, write PAUSE file.
 */
export function executeEmergencyBrake(
  session: LoopSession,
  reason: string,
): void {
  session.status = "emergency-braked";
  saveSession(session);

  const pausePath = join(logDir(), "PAUSE");
  writeFileSync(
    pausePath,
    `emergency-brake: ${reason}\nsession: ${session.id}\nat: ${new Date().toISOString()}\n`,
    "utf8",
  );
}

/**
 * In unattended mode, downgrade block → warn unless emergency brake triggers.
 * Attended mode: return as-is.
 */
export function unattendedVerdictOverride(
  result: IterationResult,
  session: LoopSession,
): IterationResult {
  if (session.mode !== "unattended") return result;
  if (result.verdict !== "block") return result;

  const emergency = shouldEmergencyBrake(session);
  if (emergency.brake) return result;

  return {
    ...result,
    verdict: "warn",
    verdictReasons: [
      ...result.verdictReasons,
      "unattended: block downgraded to warn",
    ],
  };
}
