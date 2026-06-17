/**
 * Tool-call circuit breaker for agent loops.
 *
 * One of the six production loop guardrails: when the same tool fails N times
 * in a row, trip the breaker and recommend degrading to a safe mode
 * (read-only tools, no delegation, capped retries).
 *
 * Pure functions — no IO.
 */

export interface ToolCallEntry {
  tool: string;
  success: boolean;
  timestamp: string;
}

export interface CircuitBreakerResult {
  tripped: boolean;
  tool: string | null;
  consecutiveFailures: number;
  recommendation: string;
}

/**
 * Inspect the tool-call history and trip the breaker when the most recent
 * tool has failed `failThreshold` times consecutively (default 3).
 *
 * Only the trailing run of a single tool matters: a success — or switching to
 * a different tool — resets the counter.
 */
export function circuitBreakerCheck(
  toolCallHistory: ToolCallEntry[],
  failThreshold = 3,
): CircuitBreakerResult {
  if (toolCallHistory.length === 0) {
    return {
      tripped: false,
      tool: null,
      consecutiveFailures: 0,
      recommendation: "no tool calls recorded",
    };
  }

  const latest = toolCallHistory[toolCallHistory.length - 1];
  if (!latest) {
    return {
      tripped: false,
      tool: null,
      consecutiveFailures: 0,
      recommendation: "no tool calls recorded",
    };
  }

  // A trailing success means the breaker is healthy.
  if (latest.success) {
    return {
      tripped: false,
      tool: latest.tool,
      consecutiveFailures: 0,
      recommendation: "last tool call succeeded",
    };
  }

  // Count consecutive trailing failures of the same tool.
  let count = 0;
  for (let i = toolCallHistory.length - 1; i >= 0; i--) {
    const e = toolCallHistory[i];
    if (e && e.tool === latest.tool && !e.success) {
      count++;
    } else {
      break;
    }
  }

  const tripped = count >= failThreshold;
  return {
    tripped,
    tool: latest.tool,
    consecutiveFailures: count,
    recommendation: tripped
      ? `${latest.tool} failed ${count}x consecutively — degrade to safe mode: read-only tools, no delegation, capped retries`
      : `monitoring ${latest.tool} (${count}/${failThreshold} consecutive failures)`,
  };
}

/**
 * Append a tool-call record to a history array (immutably), capping length.
 */
export function recordToolCall(
  history: ToolCallEntry[],
  tool: string,
  success: boolean,
  timestamp: string,
  cap = 500,
): ToolCallEntry[] {
  const next = [...history, { tool, success, timestamp }];
  return next.length > cap ? next.slice(-cap) : next;
}
