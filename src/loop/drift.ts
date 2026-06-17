/**
 * Cumulative drift detection for loop iterations.
 * All functions are pure — no IO, no imports.
 */

/**
 * Score how far this iteration's changed files drift from the goal.
 * Checks each filename for goal keyword matches (case-insensitive).
 * Returns 1 - (matched / total). Empty inputs → 0 (no drift).
 */
export function iterationDriftScore(
  changedFiles: string[],
  goalKeywords: string[],
): number {
  if (changedFiles.length === 0 || goalKeywords.length === 0) return 0;

  const lower = goalKeywords.map((k) => k.toLowerCase());
  let matched = 0;
  for (const file of changedFiles) {
    const fileLower = file.toLowerCase();
    if (lower.some((kw) => fileLower.includes(kw))) {
      matched++;
    }
  }
  return 1 - matched / changedFiles.length;
}

/**
 * EMA cumulative drift: alpha * current + (1-alpha) * previous, clamped to [0, 1].
 */
export function updateCumulativeDrift(
  iterationScore: number,
  previous: number,
  alpha = 0.3,
): number {
  const raw = alpha * iterationScore + (1 - alpha) * previous;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Global goal relevance across all changed files (deduplicated).
 * Returns ratio of files matching any goal keyword.
 */
export function goalRelevance(
  allChangedFiles: string[],
  goalKeywords: string[],
): number {
  const unique = [...new Set(allChangedFiles)];
  if (unique.length === 0 || goalKeywords.length === 0) return 0;

  const lower = goalKeywords.map((k) => k.toLowerCase());
  let matched = 0;
  for (const file of unique) {
    const fileLower = file.toLowerCase();
    if (lower.some((kw) => fileLower.includes(kw))) {
      matched++;
    }
  }
  return matched / unique.length;
}

/**
 * Map cumulative drift to a verdict.
 * <0.4 → pass, 0.4–0.7 → warn, >0.7 → block.
 */
export function driftVerdict(
  cumulative: number,
): "pass" | "warn" | "block" {
  if (cumulative < 0.4) return "pass";
  if (cumulative <= 0.7) return "warn";
  return "block";
}

/**
 * LE-09: Multi-agent cooperative drift accumulation detection.
 *
 * Each agent's drift is represented as a directional vector based on its
 * dominant file category (derived from `fileCategories`).
 *
 * When multiple agents share the same dominant category (same "direction"),
 * their drift magnitudes are summed (capped at 1.0) to reflect accumulated
 * risk. When agents drift in different directions, we take the maximum.
 *
 * @param driftByAgent - Array of per-agent drift inputs
 * @returns magnitude (0-1), direction (dominant category), agents (those that contributed)
 *
 * Example — two agents both drifting toward "ci":
 *   multiAgentDriftVector([
 *     { agent: "A", drift: 0.2, fileCategories: ["ci", "config"] },
 *     { agent: "B", drift: 0.25, fileCategories: ["ci", "test"] },
 *   ])
 *   // → { magnitude: 0.45, direction: "ci", agents: ["A", "B"] }
 */
export function multiAgentDriftVector(
  driftByAgent: { agent: string; drift: number; fileCategories: string[] }[],
): { magnitude: number; direction: string; agents: string[] } {
  if (driftByAgent.length === 0) {
    return { magnitude: 0, direction: "none", agents: [] };
  }

  // Determine the dominant category for each agent (highest frequency wins).
  function dominantCategory(categories: string[]): string {
    if (categories.length === 0) return "unknown";
    const freq = new Map<string, number>();
    for (const c of categories) {
      freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    let best: string = categories[0] ?? "unknown";
    let bestCount = 0;
    for (const [cat, count] of freq) {
      if (count > bestCount) {
        bestCount = count;
        best = cat;
      }
    }
    return best;
  }

  // Group agents by their dominant category.
  const groups = new Map<string, { agent: string; drift: number }[]>();
  for (const entry of driftByAgent) {
    const dir = dominantCategory(entry.fileCategories);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push({ agent: entry.agent, drift: entry.drift });
  }

  // Find the group with the highest accumulated drift.
  let bestDirection = "unknown";
  let bestMagnitude = 0;
  let bestAgents: string[] = [];

  for (const [direction, members] of groups) {
    // Same-direction agents: sum their drifts (additive accumulation), cap at 1.0.
    const accumulated = Math.min(
      1,
      members.reduce((sum, m) => sum + m.drift, 0),
    );
    if (accumulated > bestMagnitude) {
      bestMagnitude = accumulated;
      bestDirection = direction;
      bestAgents = members.map((m) => m.agent);
    }
  }

  return { magnitude: bestMagnitude, direction: bestDirection, agents: bestAgents };
}
