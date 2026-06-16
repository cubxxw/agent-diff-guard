import { describe, expect, test } from "bun:test";
import {
  iterationDriftScore,
  updateCumulativeDrift,
  goalRelevance,
  driftVerdict,
  multiAgentDriftVector,
} from "./drift";
import { semanticDriftScore, semanticDriftScoreWithBackend } from "./semantic";

describe("iterationDriftScore", () => {
  test("all files match goal keywords → 0.0 (no drift)", () => {
    expect(
      iterationDriftScore(["Login.tsx", "AuthForm.tsx"], ["login", "auth"]),
    ).toBe(0.0);
  });

  test("no files match goal keywords → 1.0 (full drift)", () => {
    expect(
      iterationDriftScore(
        ["ci.yml", "docker-compose.yml"],
        ["login", "auth"],
      ),
    ).toBe(1.0);
  });

  test("partial match → 0.5", () => {
    expect(
      iterationDriftScore(["Login.tsx", "ci.yml"], ["login"]),
    ).toBe(0.5);
  });

  test("case-insensitive matching", () => {
    expect(
      iterationDriftScore(["LOGIN.tsx"], ["login"]),
    ).toBe(0.0);
  });

  test("empty changedFiles → 0", () => {
    expect(iterationDriftScore([], ["login"])).toBe(0);
  });

  test("empty goalKeywords → 0", () => {
    expect(iterationDriftScore(["Login.tsx"], [])).toBe(0);
  });

  test("both empty → 0", () => {
    expect(iterationDriftScore([], [])).toBe(0);
  });
});

describe("updateCumulativeDrift", () => {
  test("first iteration with full drift", () => {
    expect(updateCumulativeDrift(1.0, 0.0, 0.3)).toBeCloseTo(0.3);
  });

  test("recovery iteration with existing drift", () => {
    expect(updateCumulativeDrift(0.0, 0.6, 0.3)).toBeCloseTo(0.42);
  });

  test("clamps to [0, 1]", () => {
    expect(updateCumulativeDrift(0.0, 0.0, 0.3)).toBeGreaterThanOrEqual(0);
    expect(updateCumulativeDrift(1.0, 1.0, 0.3)).toBeLessThanOrEqual(1);
  });

  test("default alpha is 0.3", () => {
    expect(updateCumulativeDrift(1.0, 0.0)).toBeCloseTo(0.3);
  });
});

describe("goalRelevance", () => {
  test("all files relevant → 1.0", () => {
    expect(
      goalRelevance(["auth.ts", "login.tsx"], ["auth", "login"]),
    ).toBe(1.0);
  });

  test("no files relevant → 0.0", () => {
    expect(goalRelevance(["ci.yml"], ["auth"])).toBe(0.0);
  });

  test("deduplicates files", () => {
    expect(
      goalRelevance(["auth.ts", "auth.ts", "ci.yml"], ["auth"]),
    ).toBe(0.5);
  });

  test("empty inputs → 0", () => {
    expect(goalRelevance([], ["auth"])).toBe(0);
    expect(goalRelevance(["auth.ts"], [])).toBe(0);
  });
});

describe("driftVerdict", () => {
  test("low drift → pass", () => {
    expect(driftVerdict(0.0)).toBe("pass");
    expect(driftVerdict(0.3)).toBe("pass");
    expect(driftVerdict(0.39)).toBe("pass");
  });

  test("medium drift → warn", () => {
    expect(driftVerdict(0.4)).toBe("warn");
    expect(driftVerdict(0.5)).toBe("warn");
    expect(driftVerdict(0.7)).toBe("warn");
  });

  test("high drift → block", () => {
    expect(driftVerdict(0.71)).toBe("block");
    expect(driftVerdict(0.8)).toBe("block");
    expect(driftVerdict(1.0)).toBe("block");
  });
});

// ---------------------------------------------------------------------------
// LE-05: semanticDriftScore (TF-IDF)
// ---------------------------------------------------------------------------

describe("semanticDriftScore", () => {
  test("semantically related diff scores lower than unrelated diff", () => {
    const goal = "implement user authentication login feature with JWT tokens";
    // Diff that shares several goal terms: authentication, login, token
    const relatedDiff =
      "authentication login token user password session jwt";
    // Diff that shares no goal terms
    const unrelatedDiff =
      "deploy kubernetes cluster container orchestration scaling";
    const relatedScore = semanticDriftScore(relatedDiff, goal);
    const unrelatedScore = semanticDriftScore(unrelatedDiff, goal);
    expect(relatedScore).toBeLessThan(unrelatedScore);
  });

  test("completely unrelated diff scores high (> 0.5)", () => {
    const goal = "implement user authentication login feature";
    // Vocabulary is entirely different from the goal terms
    const diff =
      "deploy kubernetes cluster container orchestration scaling replication";
    const score = semanticDriftScore(diff, goal);
    expect(score).toBeGreaterThan(0.5);
  });

  test("empty diff → 0 (no drift, no info)", () => {
    expect(semanticDriftScore("", "add auth feature")).toBe(0);
  });

  test("empty goal → 0 (cannot determine drift)", () => {
    expect(semanticDriftScore("+ const x = 1;", "")).toBe(0);
  });

  test("both empty → 0", () => {
    expect(semanticDriftScore("", "")).toBe(0);
  });

  test("identical content → ~0 (no drift)", () => {
    const text = "authentication login user token session password";
    const score = semanticDriftScore(text, text);
    expect(score).toBeCloseTo(0, 10);
  });

  test("returns value in [0, 1]", () => {
    const score = semanticDriftScore("deploy kubernetes cluster", "user login auth");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// LE-09: multiAgentDriftVector
// ---------------------------------------------------------------------------

describe("multiAgentDriftVector", () => {
  test("empty input → magnitude 0", () => {
    const result = multiAgentDriftVector([]);
    expect(result.magnitude).toBe(0);
    expect(result.agents).toHaveLength(0);
  });

  test("single agent → magnitude equals its own drift", () => {
    const result = multiAgentDriftVector([
      { agent: "A", drift: 0.3, fileCategories: ["ci", "config"] },
    ]);
    expect(result.magnitude).toBeCloseTo(0.3);
    expect(result.direction).toBe("ci");
    expect(result.agents).toEqual(["A"]);
  });

  test("two agents same dominant category → drift accumulates (summed)", () => {
    const result = multiAgentDriftVector([
      { agent: "A", drift: 0.2, fileCategories: ["ci", "config"] },
      { agent: "B", drift: 0.25, fileCategories: ["ci", "test"] },
    ]);
    // Both dominant → "ci"; magnitudes should be summed: 0.45
    expect(result.magnitude).toBeCloseTo(0.45);
    expect(result.direction).toBe("ci");
    expect(result.agents).toContain("A");
    expect(result.agents).toContain("B");
  });

  test("drift accumulation caps at 1.0", () => {
    const result = multiAgentDriftVector([
      { agent: "A", drift: 0.7, fileCategories: ["ci"] },
      { agent: "B", drift: 0.6, fileCategories: ["ci"] },
    ]);
    expect(result.magnitude).toBe(1.0);
  });

  test("two agents different dominant categories → picks the higher one (max)", () => {
    // Agent A drifts toward "ci" (0.4), Agent B drifts toward "test" (0.2)
    const result = multiAgentDriftVector([
      { agent: "A", drift: 0.4, fileCategories: ["ci", "ci", "config"] },
      { agent: "B", drift: 0.2, fileCategories: ["test", "test", "docs"] },
    ]);
    // "ci" group accumulated = 0.4; "test" group accumulated = 0.2 → pick "ci"
    expect(result.magnitude).toBeCloseTo(0.4);
    expect(result.direction).toBe("ci");
    expect(result.agents).toEqual(["A"]);
  });

  test("three agents: two same direction, one divergent", () => {
    const result = multiAgentDriftVector([
      { agent: "A", drift: 0.3, fileCategories: ["config"] },
      { agent: "B", drift: 0.3, fileCategories: ["config"] },
      { agent: "C", drift: 0.5, fileCategories: ["auth", "login"] },  // dominant = "auth"
    ]);
    // "config" accumulates 0.6, "auth" stays 0.5 → winner is "config"
    expect(result.magnitude).toBeCloseTo(0.6);
    expect(result.direction).toBe("config");
    expect(result.agents).toContain("A");
    expect(result.agents).toContain("B");
    expect(result.agents).not.toContain("C");
  });

  test("agent with empty fileCategories → direction 'unknown'", () => {
    const result = multiAgentDriftVector([
      { agent: "X", drift: 0.4, fileCategories: [] },
    ]);
    expect(result.direction).toBe("unknown");
    expect(result.magnitude).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// LE-13: semanticDriftScoreWithBackend
// ---------------------------------------------------------------------------

describe("semanticDriftScoreWithBackend", () => {
  test("default backend (tfidf) returns same as semanticDriftScore", async () => {
    const diff = "user authentication login jwt token";
    const goal = "implement authentication feature";
    const expected = semanticDriftScore(diff, goal);
    const actual = await semanticDriftScoreWithBackend(diff, goal);
    expect(actual).toBeCloseTo(expected);
  });

  test("explicit tfidf backend works identically", async () => {
    const diff = "deploy kubernetes docker container";
    const goal = "user login feature";
    const expected = semanticDriftScore(diff, goal);
    const actual = await semanticDriftScoreWithBackend(diff, goal, { backend: "tfidf" });
    expect(actual).toBeCloseTo(expected);
  });

  test("embedding backend with mock embedFn — high similarity → low drift", async () => {
    // Mock embedFn returns orthogonal vectors for different inputs but parallel for same
    const authVec = [1, 0, 0, 1, 0]; // "auth-like" direction
    const mockEmbed = async (_text: string): Promise<number[]> => authVec;

    const score = await semanticDriftScoreWithBackend(
      "authentication login",
      "auth feature",
      { backend: "embedding", embedFn: mockEmbed },
    );
    // Identical vectors → cosine = 1 → drift = 0
    expect(score).toBeCloseTo(0);
  });

  test("embedding backend with mock embedFn — orthogonal vectors → high drift", async () => {
    // Two completely orthogonal vectors
    let callCount = 0;
    const mockEmbed = async (_text: string): Promise<number[]> => {
      callCount++;
      return callCount === 1 ? [1, 0, 0] : [0, 1, 0];
    };

    const score = await semanticDriftScoreWithBackend(
      "deploy ci pipeline",
      "auth login feature",
      { backend: "embedding", embedFn: mockEmbed },
    );
    // Orthogonal vectors → cosine = 0 → drift = 1
    expect(score).toBeCloseTo(1);
  });

  test("embedding backend without embedFn throws descriptive error", async () => {
    await expect(
      semanticDriftScoreWithBackend("diff", "goal", { backend: "embedding" }),
    ).rejects.toThrow("embedFn");
  });

  test("result is clamped to [0, 1] for embedding backend", async () => {
    // Return vectors with negative dot product (anti-parallel) — cosine will be negative
    let callCount = 0;
    const mockEmbed = async (_text: string): Promise<number[]> => {
      callCount++;
      return callCount === 1 ? [1, 0] : [-1, 0];
    };

    const score = await semanticDriftScoreWithBackend("a", "b", {
      backend: "embedding",
      embedFn: mockEmbed,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
