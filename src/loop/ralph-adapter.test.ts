import { describe, expect, it } from "bun:test";
import {
  parseImplementationPlan,
  planAlignmentScore,
  checkCompletionPromise,
} from "./ralph-adapter";

// ---------------------------------------------------------------------------
// parseImplementationPlan
// ---------------------------------------------------------------------------

describe("parseImplementationPlan", () => {
  it("returns empty tasks and null currentTask for empty content", () => {
    const result = parseImplementationPlan("");
    expect(result.tasks).toEqual([]);
    expect(result.currentTask).toBeNull();
  });

  it("parses a single undone task", () => {
    const content = "- [ ] Add authentication\n";
    const result = parseImplementationPlan(content);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toEqual({ text: "Add authentication", priority: 1, done: false });
    expect(result.currentTask).toBe("Add authentication");
  });

  it("parses a single done task (lowercase x)", () => {
    const content = "- [x] Setup database\n";
    const result = parseImplementationPlan(content);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toEqual({ text: "Setup database", priority: 1, done: true });
    expect(result.currentTask).toBeNull();
  });

  it("parses a single done task (uppercase X)", () => {
    const content = "- [X] Setup database\n";
    const result = parseImplementationPlan(content);
    expect(result.tasks[0].done).toBe(true);
    expect(result.currentTask).toBeNull();
  });

  it("extracts currentTask as first undone item in mixed list", () => {
    const content = [
      "# My Plan",
      "",
      "- [x] Step 1: Init repo",
      "- [x] Step 2: Setup CI",
      "- [ ] Step 3: Add auth",
      "- [ ] Step 4: Write tests",
    ].join("\n");

    const result = parseImplementationPlan(content);
    expect(result.tasks).toHaveLength(4);
    expect(result.tasks[0]).toMatchObject({ text: "Step 1: Init repo", done: true, priority: 1 });
    expect(result.tasks[1]).toMatchObject({ text: "Step 2: Setup CI", done: true, priority: 2 });
    expect(result.tasks[2]).toMatchObject({ text: "Step 3: Add auth", done: false, priority: 3 });
    expect(result.tasks[3]).toMatchObject({ text: "Step 4: Write tests", done: false, priority: 4 });
    expect(result.currentTask).toBe("Step 3: Add auth");
  });

  it("returns null currentTask when all tasks are done", () => {
    const content = [
      "- [x] Task A",
      "- [x] Task B",
      "- [x] Task C",
    ].join("\n");

    const result = parseImplementationPlan(content);
    expect(result.tasks).toHaveLength(3);
    expect(result.currentTask).toBeNull();
  });

  it("ignores non-checkbox lines (headers, blank lines, paragraphs)", () => {
    const content = [
      "# Implementation Plan",
      "",
      "This is a description.",
      "",
      "- [ ] Real task one",
      "  Some indented note",
      "- [x] Real task two",
    ].join("\n");

    const result = parseImplementationPlan(content);
    expect(result.tasks).toHaveLength(2);
    expect(result.currentTask).toBe("Real task one");
  });

  it("handles indented checkbox items", () => {
    const content = "  - [ ] Indented task\n";
    const result = parseImplementationPlan(content);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].text).toBe("Indented task");
  });
});

// ---------------------------------------------------------------------------
// planAlignmentScore
// ---------------------------------------------------------------------------

describe("planAlignmentScore", () => {
  it("returns 0 when changedFiles is empty", () => {
    expect(planAlignmentScore([], "implement authentication feature")).toBe(0);
  });

  it("returns 0 when currentTask yields no keywords (too short)", () => {
    // "fix" is only 3 chars, below the 4-char threshold in taskKeywords
    expect(planAlignmentScore(["src/auth.ts"], "fix")).toBe(0);
  });

  it("returns 1.0 when all files align with the task keywords", () => {
    // taskKeywords("implement authentication module") → ["implement","authentication","module"]
    // file paths must contain at least one keyword as a substring
    const score = planAlignmentScore(
      ["src/authentication.ts", "src/authentication-service.ts", "tests/authentication.test.ts"],
      "implement authentication module",
    );
    expect(score).toBe(1.0);
  });

  it("returns 0.0 when no files align with the task keywords", () => {
    const score = planAlignmentScore(
      [".github/workflows/ci.yml", "docker-compose.yml"],
      "implement authentication module",
    );
    expect(score).toBe(0.0);
  });

  it("returns partial score for partial alignment", () => {
    // 1 of 2 files contains "authentication" as a substring
    const score = planAlignmentScore(
      ["src/authentication.ts", "src/unrelated.ts"],
      "implement authentication feature",
    );
    expect(score).toBe(0.5);
  });

  it("is case-insensitive on file paths", () => {
    // "Authentication.ts" contains the keyword "authentication" case-insensitively
    const score = planAlignmentScore(
      ["src/Authentication.ts"],
      "implement authentication",
    );
    expect(score).toBe(1.0);
  });

  it("matches keywords as substrings in file paths", () => {
    // "budget" keyword should match "budget-service.ts"
    const score = planAlignmentScore(
      ["src/loop/budget-service.ts"],
      "implement budget tracking feature",
    );
    expect(score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// checkCompletionPromise
// ---------------------------------------------------------------------------

describe("checkCompletionPromise", () => {
  it("returns true when output contains the exact promise string", () => {
    const output = "Running tests...\nTASK COMPLETE: Add authentication\nDone.";
    expect(checkCompletionPromise(output, "TASK COMPLETE: Add authentication")).toBe(true);
  });

  it("returns false when promise is not in output", () => {
    const output = "Tests passed.\nAll checks green.";
    expect(checkCompletionPromise(output, "TASK COMPLETE: Add authentication")).toBe(false);
  });

  it("is case-sensitive", () => {
    const output = "task complete: add authentication";
    expect(checkCompletionPromise(output, "TASK COMPLETE: Add authentication")).toBe(false);
  });

  it("returns true for promise match at end of output", () => {
    const promise = "DONE";
    const output = "Building...\nDONE";
    expect(checkCompletionPromise(output, promise)).toBe(true);
  });

  it("returns false for empty output", () => {
    expect(checkCompletionPromise("", "TASK COMPLETE")).toBe(false);
  });

  it("returns true for empty promise string (always in any string)", () => {
    // Empty string is always a substring — document this edge case
    expect(checkCompletionPromise("any output", "")).toBe(true);
  });

  it("handles multi-line promise matching", () => {
    const output = "Step 1 done\nStep 2 done\nAll steps complete.";
    expect(checkCompletionPromise(output, "All steps complete.")).toBe(true);
  });
});
