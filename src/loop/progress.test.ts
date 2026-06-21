import { test, expect, describe } from "bun:test";
import { detectNoProgress, diffContentHash } from "./progress";

describe("detectNoProgress", () => {
  test("not stalled when history shorter than threshold", () => {
    const r = detectNoProgress({ recentDiffHashes: ["a", "a"] });
    expect(r.stalled).toBe(false);
    expect(r.stalledRounds).toBe(0);
  });

  test("stalled when same hash repeats >= threshold (default 3)", () => {
    const r = detectNoProgress({ recentDiffHashes: ["a", "b", "c", "c", "c"] });
    expect(r.stalled).toBe(true);
    expect(r.stalledRounds).toBe(3);
    expect(r.reason).toContain("3");
  });

  test("not stalled when latest differs", () => {
    const r = detectNoProgress({ recentDiffHashes: ["c", "c", "c", "d"] });
    expect(r.stalled).toBe(false);
  });

  test("custom threshold", () => {
    const r = detectNoProgress({ recentDiffHashes: ["x", "x"], staleThreshold: 2 });
    expect(r.stalled).toBe(true);
    expect(r.stalledRounds).toBe(2);
  });
});

describe("diffContentHash", () => {
  test("same paths (any order) → same hash", () => {
    expect(diffContentHash(["a.ts", "b.ts"])).toBe(diffContentHash(["b.ts", "a.ts"]));
  });

  test("different paths → different hash", () => {
    expect(diffContentHash(["a.ts"])).not.toBe(diffContentHash(["b.ts"]));
  });

  test("empty paths → stable hash", () => {
    expect(diffContentHash([])).toBe(diffContentHash([]));
  });
});
