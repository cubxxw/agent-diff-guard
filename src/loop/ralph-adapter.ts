/**
 * Ralph loop between-iteration gate adapter.
 *
 * Provides helpers for reading Ralph's IMPLEMENTATION_PLAN.md,
 * computing plan-alignment scores, and checking completion promises.
 * All functions are pure — no IO, no side effects.
 */

import { taskKeywords } from "../scan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single task item parsed from IMPLEMENTATION_PLAN.md. */
export interface PlanTask {
  text: string;
  priority: number; // 1-based position in the plan (lower = higher priority)
  done: boolean;
}

/** Structured result from parsing IMPLEMENTATION_PLAN.md. */
export interface ParsedPlan {
  tasks: PlanTask[];
  /** The first undone task, or null when all tasks are complete. */
  currentTask: string | null;
}

/**
 * Ralph-specific extra fields surfaced in loop check output.
 * Consumers can merge this into IterationResult or log it separately.
 */
export interface RalphCheckExtra {
  currentTask: string | null;
  planAlignmentScore: number;
  completionReached: boolean;
}

// ---------------------------------------------------------------------------
// parseImplementationPlan
// ---------------------------------------------------------------------------

/**
 * Parse the content of an IMPLEMENTATION_PLAN.md file.
 *
 * Recognises markdown checkbox list items:
 *   - `- [ ] Task description`  → undone
 *   - `- [x] Task description`  → done (case-insensitive: [X] also accepted)
 *
 * Lines that do not match the checkbox pattern are silently ignored.
 * `currentTask` is the text of the first undone task, or null if all done.
 *
 * @param content - Raw text content of IMPLEMENTATION_PLAN.md.
 */
export function parseImplementationPlan(content: string): ParsedPlan {
  const tasks: PlanTask[] = [];
  let priority = 0;

  for (const line of content.split("\n")) {
    // Match "- [ ] ..." (undone) or "- [x] ..." / "- [X] ..." (done)
    const match = line.match(/^\s*-\s+\[([xX\s])\]\s+(.+)$/);
    if (!match) continue;

    priority++;
    const done = match[1].trim().toLowerCase() === "x";
    const text = match[2].trim();
    tasks.push({ text, priority, done });
  }

  const firstUndone = tasks.find((t) => !t.done);
  return {
    tasks,
    currentTask: firstUndone ? firstUndone.text : null,
  };
}

// ---------------------------------------------------------------------------
// planAlignmentScore
// ---------------------------------------------------------------------------

/**
 * Calculate how well the changed files align with the current Ralph task.
 *
 * Algorithm (mirrors drift.ts `iterationDriftScore` but returns alignment,
 * not drift — i.e. higher is better):
 *   1. Extract keywords from `currentTask` using `taskKeywords()` from scan.ts.
 *   2. For each changed file path, check whether any keyword appears
 *      (case-insensitive substring match).
 *   3. Return `matchedFiles / totalFiles`.
 *
 * Edge cases:
 *   - Empty `changedFiles` → 0 (nothing to align).
 *   - No keywords extracted from `currentTask` → 0 (cannot judge alignment).
 *
 * @param changedFiles - List of file paths changed in this iteration.
 * @param currentTask  - The current task text from the implementation plan.
 * @returns Alignment score in [0, 1].
 */
export function planAlignmentScore(
  changedFiles: string[],
  currentTask: string,
): number {
  if (changedFiles.length === 0) return 0;

  const keywords = taskKeywords(currentTask);
  if (keywords.length === 0) return 0;

  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  let matched = 0;

  for (const file of changedFiles) {
    const fileLower = file.toLowerCase();
    if (lowerKeywords.some((kw) => fileLower.includes(kw))) {
      matched++;
    }
  }

  return matched / changedFiles.length;
}

// ---------------------------------------------------------------------------
// checkCompletionPromise
// ---------------------------------------------------------------------------

/**
 * Check whether an agent's output satisfies a Ralphify completion promise.
 *
 * Uses exact substring matching: `output` must contain `promise` as a
 * literal substring (case-sensitive).  This mirrors the Ralphify convention
 * where the agent is expected to emit a specific sentinel string when a task
 * is done (e.g. "TASK COMPLETE: <task-name>").
 *
 * @param output  - Full stdout / text output from the loop agent.
 * @param promise - The exact completion-promise string to look for.
 * @returns true when `promise` appears somewhere inside `output`.
 */
export function checkCompletionPromise(output: string, promise: string): boolean {
  return output.includes(promise);
}
