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
