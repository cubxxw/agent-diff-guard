import { describe, expect, test } from "bun:test";
import {
  iterationDriftScore,
  updateCumulativeDrift,
  goalRelevance,
  driftVerdict,
} from "./drift";

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
