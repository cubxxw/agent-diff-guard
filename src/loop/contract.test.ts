import { describe, expect, test } from "bun:test";
import {
  parseContract,
  validateContract,
  contractTemplate,
  type LoopContract,
} from "./contract";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid flat YAML for a loop contract. */
const VALID_YAML = `
trigger: git pre-push hook
scope: repo my-org/my-repo
action: read diff and classify risk
budget_tokens: 50000
stop: all findings resolved
escalate: notify @on-call via Slack
`;

/** Full contract with both budget fields set. */
const FULL_YAML = `
# Example with both budget caps
trigger: cron every 30 minutes
scope: /src/payments
action: scan for drift and block if wake-you-up
budget_tokens: 100000
budget_iterations: 10
stop: iteration limit reached
escalate: create GitHub issue and halt
`;

// ---------------------------------------------------------------------------
// parseContract — valid inputs
// ---------------------------------------------------------------------------

describe("parseContract — valid input", () => {
  test("parses a minimal valid contract (tokens only)", () => {
    const result = parseContract(VALID_YAML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contract.trigger).toBe("git pre-push hook");
    expect(result.contract.scope).toBe("repo my-org/my-repo");
    expect(result.contract.action).toBe("read diff and classify risk");
    expect(result.contract.budget.tokens).toBe(50000);
    expect(result.contract.budget.iterations).toBeUndefined();
    expect(result.contract.stop).toBe("all findings resolved");
    expect(result.contract.escalate).toBe("notify @on-call via Slack");
  });

  test("parses a full contract with both budget caps", () => {
    const result = parseContract(FULL_YAML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contract.budget.tokens).toBe(100000);
    expect(result.contract.budget.iterations).toBe(10);
  });

  test("ignores comment lines and blank lines", () => {
    const yaml = `
# this is a comment
trigger: hook

scope: /my-repo
action: scan
budget_iterations: 5
stop: done
escalate: page on-call
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(true);
  });

  test("handles values that contain colons (e.g. URLs)", () => {
    const yaml = `
trigger: webhook https://example.com/push
scope: /repo
action: diff check
budget_tokens: 1000
stop: pass
escalate: alert
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The full value after the first colon should be preserved.
    expect(result.contract.trigger).toBe("webhook https://example.com/push");
  });

  test("strips surrounding quotes from values", () => {
    const yaml = `
trigger: "pre-push"
scope: '/src'
action: scan
budget_tokens: 200
stop: "done"
escalate: 'halt'
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.trigger).toBe("pre-push");
    expect(result.contract.scope).toBe("/src");
    expect(result.contract.stop).toBe("done");
    expect(result.contract.escalate).toBe("halt");
  });
});

// ---------------------------------------------------------------------------
// parseContract — missing fields
// ---------------------------------------------------------------------------

describe("parseContract — missing fields", () => {
  test("returns errors for all missing fields on empty input", () => {
    const result = parseContract("");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("missing required field: trigger");
    expect(result.errors).toContain("missing required field: scope");
    expect(result.errors).toContain("missing required field: action");
    expect(result.errors).toContain("missing required field: stop");
    expect(result.errors).toContain("missing required field: escalate");
    expect(result.errors.some((e) => e.includes("budget"))).toBe(true);
  });

  test("reports missing trigger", () => {
    const yaml = VALID_YAML.replace(/^trigger:.*$/m, "");
    const result = parseContract(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("missing required field: trigger");
  });

  test("reports missing budget when neither budget_tokens nor budget_iterations present", () => {
    const yaml = `
trigger: hook
scope: /repo
action: scan
stop: done
escalate: halt
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("budget"))).toBe(true);
  });

  test("reports invalid budget_tokens value", () => {
    const yaml = `
trigger: hook
scope: /repo
action: scan
budget_tokens: -5
stop: done
escalate: halt
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("budget_tokens"))).toBe(true);
  });

  test("reports invalid budget_iterations value", () => {
    const yaml = `
trigger: hook
scope: /repo
action: scan
budget_iterations: abc
stop: done
escalate: halt
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("budget_iterations"))).toBe(true);
  });

  test("accepts contract with only budget_iterations (no budget_tokens)", () => {
    const yaml = `
trigger: hook
scope: /repo
action: scan
budget_iterations: 10
stop: done
escalate: halt
`;
    const result = parseContract(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.budget.iterations).toBe(10);
    expect(result.contract.budget.tokens).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateContract
// ---------------------------------------------------------------------------

describe("validateContract", () => {
  const valid: LoopContract = {
    trigger: "git pre-push",
    scope: "/my-repo",
    action: "scan diff",
    budget: { tokens: 10000 },
    stop: "findings clear",
    escalate: "halt",
  };

  test("returns empty array for a fully valid contract", () => {
    expect(validateContract(valid)).toEqual([]);
  });

  test("reports missing trigger", () => {
    const errors = validateContract({ ...valid, trigger: "" });
    expect(errors).toContain("missing required field: trigger");
  });

  test("reports missing scope", () => {
    const errors = validateContract({ ...valid, scope: undefined });
    expect(errors).toContain("missing required field: scope");
  });

  test("reports missing action", () => {
    const errors = validateContract({ ...valid, action: "" });
    expect(errors).toContain("missing required field: action");
  });

  test("reports missing stop", () => {
    const errors = validateContract({ ...valid, stop: "" });
    expect(errors).toContain("missing required field: stop");
  });

  test("reports missing escalate", () => {
    const errors = validateContract({ ...valid, escalate: undefined });
    expect(errors).toContain("missing required field: escalate");
  });

  test("reports missing budget object", () => {
    const errors = validateContract({ ...valid, budget: undefined });
    expect(errors.some((e) => e.includes("budget"))).toBe(true);
  });

  test("reports budget with no caps", () => {
    const errors = validateContract({ ...valid, budget: {} });
    expect(errors.some((e) => e.includes("budget"))).toBe(true);
  });

  test("reports budget.tokens <= 0", () => {
    const errors = validateContract({ ...valid, budget: { tokens: 0 } });
    expect(errors.some((e) => e.includes("budget"))).toBe(true);
  });

  test("reports budget.iterations <= 0", () => {
    const errors = validateContract({ ...valid, budget: { iterations: -1 } });
    expect(errors.some((e) => e.includes("budget"))).toBe(true);
  });

  test("accepts contract with only iterations budget", () => {
    const errors = validateContract({ ...valid, budget: { iterations: 5 } });
    expect(errors).toEqual([]);
  });

  test("accumulates multiple errors", () => {
    const errors = validateContract({});
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// contractTemplate — round-trip test
// ---------------------------------------------------------------------------

describe("contractTemplate", () => {
  test("returns a non-empty string", () => {
    const tmpl = contractTemplate();
    expect(typeof tmpl).toBe("string");
    expect(tmpl.length).toBeGreaterThan(0);
  });

  test("round-trip: template parses successfully with parseContract", () => {
    const tmpl = contractTemplate();
    const result = parseContract(tmpl);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      // Surface errors for easier debugging if the test fails.
      throw new Error(
        `contractTemplate() failed parseContract: ${result.errors.join(", ")}`,
      );
    }
  });

  test("template contains all six required section headings", () => {
    const tmpl = contractTemplate();
    for (const keyword of [
      "TRIGGER",
      "SCOPE",
      "ACTION",
      "BUDGET",
      "STOP",
      "ESCALATE",
    ]) {
      expect(tmpl).toContain(keyword);
    }
  });
});
