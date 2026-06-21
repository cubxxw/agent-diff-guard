/**
 * Gas Town integration adapter — Witness role.
 *
 * Gas Town stores per-agent task assignments as Git-backed JSONL files
 * ("Beads"). Each line in the file is one issue/task JSON object.
 *
 * This module:
 *  1. Parses raw JSONL bead content into BeadIssue records.
 *  2. Maps BeadIssue records to loop-session startup parameters.
 *  3. Detects cross-agent drift alignment (Polecat synchronisation risk).
 *
 * All functions are pure — no IO, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single Gas Town issue/task record extracted from one JSONL line.
 * Additional fields in the raw JSON are preserved via the `extras` bag.
 */
export interface BeadIssue {
  /** Stable identifier for this bead (e.g. "BEAD-001"). */
  id: string;
  /** The Polecat agent (or human) this task is assigned to. */
  assignee: string;
  /** Human-readable task description sent to the agent as a goal. */
  task: string;
  /** Current lifecycle status (e.g. "open", "in-progress", "done"). */
  status: string;
  /** Any additional fields present in the raw bead record. */
  extras: Record<string, unknown>;
}

/**
 * Startup parameters for one loop session derived from a BeadIssue.
 */
export interface BeadSessionParams {
  /** Which agent / Polecat should run this session. */
  assignee: string;
  /** Goal text forwarded as the loop session's `goal` field. */
  goal: string;
  /** The originating bead id, carried for traceability. */
  beadId: string;
  /** Working directory inferred from `cwd` + assignee slug. */
  cwd: string;
}

/**
 * Result of a cross-agent drift alignment check.
 */
export interface CrossAgentDriftHint {
  /**
   * Combined drift magnitude (sum of per-agent drifts, capped at 1.0).
   * 0 when no warning is triggered.
   */
  magnitude: number;
  /** Agents whose individual drift exceeded the threshold. */
  agents: string[];
  /**
   * Human-readable warning string, or null when no anomaly detected.
   * Non-null only when at least MIN_AGENTS_FOR_WARNING agents exceed the drift threshold.
   */
  warning: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum drift score (exclusive) to consider an agent as drifting. */
const DRIFT_THRESHOLD = 0.4;

/** Minimum number of agents that must be drifting to emit a warning. */
const MIN_AGENTS_FOR_WARNING = 2;

// ---------------------------------------------------------------------------
// parseBeads
// ---------------------------------------------------------------------------

/**
 * Parse JSONL bead content into an array of BeadIssue records.
 *
 * Rules:
 * - Each non-empty line is parsed as JSON independently.
 * - Lines that fail JSON.parse, or that lack required string fields
 *   (`id`, `assignee`, `task`, `status`), are silently skipped.
 * - Extra fields are collected in `extras`.
 *
 * @param beadsContent - Raw JSONL string (one JSON object per line).
 * @returns Array of successfully parsed BeadIssue records.
 */
export function parseBeads(beadsContent: string): BeadIssue[] {
  const lines = beadsContent.split("\n");
  const results: BeadIssue[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue; // skip blank lines

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Malformed JSON — skip this line
      continue;
    }

    if (!isRecord(parsed)) continue;

    const { id, assignee, task, status, ...rest } = parsed;

    // All four required fields must be non-empty strings
    if (
      typeof id !== "string" || id.length === 0 ||
      typeof assignee !== "string" || assignee.length === 0 ||
      typeof task !== "string" || task.length === 0 ||
      typeof status !== "string" || status.length === 0
    ) {
      continue;
    }

    results.push({
      id,
      assignee,
      task,
      status,
      extras: rest as Record<string, unknown>,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// beadsToSessions
// ---------------------------------------------------------------------------

/**
 * Map an array of BeadIssue records to loop-session startup parameters.
 *
 * Each bead becomes exactly one session entry. The working directory is
 * derived by appending a URL-safe slug of the assignee name to `cwd`:
 *   `<cwd>/<assignee-slug>`
 *
 * This keeps each agent's workspace isolated while sharing the same
 * project root.
 *
 * @param beads - Parsed bead issues (from `parseBeads`).
 * @param cwd   - Base working directory of the project.
 * @returns Array of session startup parameter objects.
 */
export function beadsToSessions(
  beads: BeadIssue[],
  cwd: string,
): BeadSessionParams[] {
  return beads.map((bead) => ({
    assignee: bead.assignee,
    goal: bead.task,
    beadId: bead.id,
    cwd: `${cwd}/${toSlug(bead.assignee)}`,
  }));
}

// ---------------------------------------------------------------------------
// crossAgentDriftHint
// ---------------------------------------------------------------------------

/**
 * Detect synchronised (aligned) cross-agent drift.
 *
 * When multiple agents drift in the same direction simultaneously, the
 * combined signal is stronger than any single-agent warning — the team as
 * a whole may be chasing a shared distraction or mis-specification.
 *
 * Algorithm:
 *  1. Collect agents whose drift score exceeds DRIFT_THRESHOLD (0.4).
 *  2. If fewer than MIN_AGENTS_FOR_WARNING (2) are drifting, return no-op.
 *  3. Otherwise sum all drifting scores, clamp to [0, 1], and emit warning.
 *
 * @param driftByAssignee - Map of assignee name to cumulative drift score.
 * @returns CrossAgentDriftHint with magnitude, agents list, and warning.
 */
export function crossAgentDriftHint(
  driftByAssignee: Record<string, number>,
): CrossAgentDriftHint {
  // Identify agents whose drift is above threshold
  const driftingAgents = Object.entries(driftByAssignee)
    .filter(([, score]) => score > DRIFT_THRESHOLD)
    .map(([agent]) => agent);

  if (driftingAgents.length < MIN_AGENTS_FOR_WARNING) {
    // Not enough agents drifting — no cross-agent signal
    return { magnitude: 0, agents: driftingAgents, warning: null };
  }

  // Sum of all drifting scores, capped at 1.0
  const rawSum = driftingAgents.reduce(
    (acc, agent) => acc + (driftByAssignee[agent] ?? 0),
    0,
  );
  const magnitude = Math.min(1.0, rawSum);

  const warning =
    `Cross-agent drift detected: ${driftingAgents.join(", ")} ` +
    `are all drifting beyond ${DRIFT_THRESHOLD} ` +
    `(combined magnitude ${magnitude.toFixed(2)}). ` +
    `Review shared goal alignment before continuing.`;

  return { magnitude, agents: driftingAgents, warning };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Type guard: checks that `v` is a plain object (not null, not array).
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Convert an arbitrary string to a URL-safe lowercase slug.
 * Replaces non-alphanumeric characters with hyphens and trims edges.
 *
 * Example: "Polecat Alpha" → "polecat-alpha"
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
