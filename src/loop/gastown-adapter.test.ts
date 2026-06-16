import { describe, test, expect } from "bun:test";
import {
  parseBeads,
  beadsToSessions,
  crossAgentDriftHint,
  type BeadIssue,
} from "./gastown-adapter";

// ---------------------------------------------------------------------------
// parseBeads
// ---------------------------------------------------------------------------

describe("parseBeads", () => {
  test("parses a single valid JSONL line", () => {
    const input = JSON.stringify({
      id: "BEAD-001",
      assignee: "agent-alpha",
      task: "Implement login flow",
      status: "open",
    });

    const result = parseBeads(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "BEAD-001",
      assignee: "agent-alpha",
      task: "Implement login flow",
      status: "open",
    });
  });

  test("parses multiple valid lines", () => {
    const lines = [
      JSON.stringify({ id: "B-1", assignee: "alpha", task: "Task A", status: "open" }),
      JSON.stringify({ id: "B-2", assignee: "beta", task: "Task B", status: "in-progress" }),
      JSON.stringify({ id: "B-3", assignee: "gamma", task: "Task C", status: "done" }),
    ].join("\n");

    const result = parseBeads(lines);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("B-1");
    expect(result[1]!.id).toBe("B-2");
    expect(result[2]!.id).toBe("B-3");
  });

  test("skips blank lines", () => {
    const input = [
      JSON.stringify({ id: "B-1", assignee: "alpha", task: "Task A", status: "open" }),
      "",
      "   ",
      JSON.stringify({ id: "B-2", assignee: "beta", task: "Task B", status: "open" }),
    ].join("\n");

    const result = parseBeads(input);

    expect(result).toHaveLength(2);
  });

  test("skips malformed JSON lines", () => {
    const input = [
      JSON.stringify({ id: "B-1", assignee: "alpha", task: "Task A", status: "open" }),
      "{bad json",
      "not json at all",
      JSON.stringify({ id: "B-2", assignee: "beta", task: "Task B", status: "open" }),
    ].join("\n");

    const result = parseBeads(input);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("B-1");
    expect(result[1]!.id).toBe("B-2");
  });

  test("skips lines missing required fields", () => {
    const missingId = JSON.stringify({ assignee: "alpha", task: "Task", status: "open" });
    const missingAssignee = JSON.stringify({ id: "B-2", task: "Task", status: "open" });
    const missingTask = JSON.stringify({ id: "B-3", assignee: "alpha", status: "open" });
    const missingStatus = JSON.stringify({ id: "B-4", assignee: "alpha", task: "Task" });
    const valid = JSON.stringify({ id: "B-5", assignee: "alpha", task: "Task", status: "open" });

    const input = [missingId, missingAssignee, missingTask, missingStatus, valid].join("\n");

    const result = parseBeads(input);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("B-5");
  });

  test("skips lines with empty string required fields", () => {
    const emptyId = JSON.stringify({ id: "", assignee: "alpha", task: "Task", status: "open" });
    const valid = JSON.stringify({ id: "B-1", assignee: "alpha", task: "Task", status: "open" });

    const result = parseBeads([emptyId, valid].join("\n"));

    expect(result).toHaveLength(1);
  });

  test("collects extra fields in extras bag", () => {
    const input = JSON.stringify({
      id: "B-1",
      assignee: "alpha",
      task: "Task A",
      status: "open",
      priority: "high",
      labels: ["auth", "backend"],
    });

    const result = parseBeads(input);

    expect(result).toHaveLength(1);
    expect(result[0]!.extras["priority"]).toBe("high");
    expect(result[0]!.extras["labels"]).toEqual(["auth", "backend"]);
  });

  test("returns empty array for empty input", () => {
    expect(parseBeads("")).toHaveLength(0);
    expect(parseBeads("   \n  \n  ")).toHaveLength(0);
  });

  test("skips non-object JSON values (array, string, number)", () => {
    const input = [
      "[1, 2, 3]",
      '"just a string"',
      "42",
      JSON.stringify({ id: "B-1", assignee: "alpha", task: "Task", status: "open" }),
    ].join("\n");

    const result = parseBeads(input);

    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// beadsToSessions
// ---------------------------------------------------------------------------

describe("beadsToSessions", () => {
  const makeBeads = (...overrides: Partial<BeadIssue>[]): BeadIssue[] =>
    overrides.map((o, i) => ({
      id: `B-${i + 1}`,
      assignee: `agent-${i + 1}`,
      task: `Task ${i + 1}`,
      status: "open",
      extras: {},
      ...o,
    }));

  test("maps each bead to a session params object", () => {
    const beads = makeBeads(
      { id: "BEAD-001", assignee: "agent-alpha", task: "Implement login" },
      { id: "BEAD-002", assignee: "agent-beta", task: "Write tests" },
    );

    const sessions = beadsToSessions(beads, "/projects/my-app");

    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      assignee: "agent-alpha",
      goal: "Implement login",
      beadId: "BEAD-001",
    });
    expect(sessions[1]).toMatchObject({
      assignee: "agent-beta",
      goal: "Write tests",
      beadId: "BEAD-002",
    });
  });

  test("cwd is base + assignee slug", () => {
    const beads = makeBeads({ assignee: "Polecat Alpha" });

    const sessions = beadsToSessions(beads, "/projects/app");

    expect(sessions[0]!.cwd).toBe("/projects/app/polecat-alpha");
  });

  test("slug removes special characters and lowercases", () => {
    const beads = makeBeads({ assignee: "Agent_X 2.0!" });

    const sessions = beadsToSessions(beads, "/base");

    // "agent_x 2.0!" -> "agent-x-2-0"
    expect(sessions[0]!.cwd).toBe("/base/agent-x-2-0");
  });

  test("returns empty array for empty beads", () => {
    expect(beadsToSessions([], "/projects/app")).toHaveLength(0);
  });

  test("goal is set from bead task field", () => {
    const beads = makeBeads({ task: "Refactor auth module to use JWT" });

    const sessions = beadsToSessions(beads, "/repo");

    expect(sessions[0]!.goal).toBe("Refactor auth module to use JWT");
  });
});

// ---------------------------------------------------------------------------
// crossAgentDriftHint
// ---------------------------------------------------------------------------

describe("crossAgentDriftHint", () => {
  test("returns no warning for empty map", () => {
    const result = crossAgentDriftHint({});

    expect(result.warning).toBeNull();
    expect(result.magnitude).toBe(0);
    expect(result.agents).toHaveLength(0);
  });

  test("returns no warning for single drifting agent", () => {
    const result = crossAgentDriftHint({ "agent-alpha": 0.8 });

    expect(result.warning).toBeNull();
    expect(result.magnitude).toBe(0);
    expect(result.agents).toEqual(["agent-alpha"]);
  });

  test("returns no warning when only one agent exceeds threshold", () => {
    const result = crossAgentDriftHint({
      "agent-alpha": 0.9,
      "agent-beta": 0.2, // below threshold
    });

    expect(result.warning).toBeNull();
  });

  test("returns warning when two agents both exceed threshold", () => {
    const result = crossAgentDriftHint({
      "agent-alpha": 0.6,
      "agent-beta": 0.7,
    });

    expect(result.warning).not.toBeNull();
    expect(result.agents).toContain("agent-alpha");
    expect(result.agents).toContain("agent-beta");
  });

  test("single agent below threshold causes no warning", () => {
    const result = crossAgentDriftHint({
      "agent-a": 0.5,
      "agent-b": 0.3, // below threshold — not counted
    });

    // Only a drifts, so single agent -> no warning
    expect(result.warning).toBeNull();
    expect(result.magnitude).toBe(0);
  });

  test("magnitude sums drifting agents and is capped at 1.0", () => {
    const result = crossAgentDriftHint({
      "agent-alpha": 0.8,
      "agent-beta": 0.9,
      "agent-gamma": 0.7,
    });

    expect(result.warning).not.toBeNull();
    // 0.8 + 0.9 + 0.7 = 2.4, capped at 1.0
    expect(result.magnitude).toBe(1.0);
  });

  test("magnitude equals exact sum when under 1.0", () => {
    const result = crossAgentDriftHint({
      "alpha": 0.5,
      "beta": 0.3, // below threshold
      "gamma": 0.41,
    });

    // alpha (0.5) and gamma (0.41) exceed 0.4 -> 0.5 + 0.41 = 0.91
    expect(result.magnitude).toBeCloseTo(0.91, 5);
    expect(result.warning).not.toBeNull();
  });

  test("agents below threshold are not included in drifting agents list", () => {
    const result = crossAgentDriftHint({
      "safe-agent": 0.1,
      "drifter-1": 0.5,
      "drifter-2": 0.6,
    });

    expect(result.agents).not.toContain("safe-agent");
    expect(result.agents).toContain("drifter-1");
    expect(result.agents).toContain("drifter-2");
  });

  test("warning message mentions all drifting agents", () => {
    const result = crossAgentDriftHint({
      "alpha": 0.6,
      "beta": 0.7,
    });

    expect(result.warning).toContain("alpha");
    expect(result.warning).toContain("beta");
  });

  test("agents exactly at threshold (0.4) are not considered drifting", () => {
    const result = crossAgentDriftHint({
      "agent-a": 0.4, // exactly at threshold — not over
      "agent-b": 0.4, // exactly at threshold — not over
    });

    expect(result.warning).toBeNull();
    expect(result.magnitude).toBe(0);
  });
});
