/**
 * No-progress detection: identifies when an agent is making no meaningful
 * forward progress by detecting repeated diff content hashes across iterations.
 */

export interface NoProgressResult {
  stalled: boolean;
  stalledRounds: number;
  reason: string;
}

/**
 * Detect whether an agent loop has stalled by checking if recent diff hashes
 * are all identical.
 *
 * @param opts.recentDiffHashes - Recent per-iteration diff content hashes (oldest first)
 * @param opts.staleThreshold   - Number of consecutive identical hashes to consider stalled (default 3)
 */
export function detectNoProgress(opts: {
  recentDiffHashes: string[];
  staleThreshold?: number;
}): NoProgressResult {
  const threshold = opts.staleThreshold ?? 3;
  const hashes = opts.recentDiffHashes;

  if (hashes.length < threshold) {
    return {
      stalled: false,
      stalledRounds: 0,
      reason: "insufficient history to determine progress",
    };
  }

  // Count consecutive identical hashes from the tail
  const latest = hashes[hashes.length - 1];
  let count = 0;
  for (let i = hashes.length - 1; i >= 0; i--) {
    if (hashes[i] === latest) {
      count++;
    } else {
      break;
    }
  }

  const stalled = count >= threshold;
  return {
    stalled,
    stalledRounds: stalled ? count : 0,
    reason: stalled
      ? `same diff hash repeated for ${count} consecutive iterations`
      : "progress detected",
  };
}

/**
 * Compute a simple content hash for a list of changed file paths.
 * Stable across runs for the same set of paths.
 */
export function diffContentHash(paths: string[]): string {
  const sorted = [...paths].sort();
  // FNV-1a-like cheap hash — good enough for stale detection
  let h = 2166136261;
  const str = sorted.join("\0");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
