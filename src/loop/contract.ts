// contract.ts — LoopContract definition and .loop-contract.yaml parser/validator.
//
// A "loop contract" declares the six mandatory fields that every production loop
// MUST specify before it can be started in unattended mode:
//
//   TRIGGER  — what event/condition causes the loop to fire
//   SCOPE    — which repository / directory / subsystem is in play
//   ACTION   — what the loop agent is allowed to do
//   BUDGET   — token and/or iteration caps (at least one required)
//   STOP     — explicit stop condition (success or safety limit)
//   ESCALATE — what happens when the stop condition cannot be met
//
// These match the six-field "loop contract" standard described in LE-10.
//
// Parsing strategy:
//   - No external YAML library; we parse a flat key:value subset.
//   - Nested budget fields are represented as budget_tokens / budget_iterations
//     (underscore-separated flat keys) to keep the parser trivial.
//   - Lines starting with "#" are comments and are ignored.
//   - Empty lines are ignored.
//   - Any line that doesn't match "key: value" is ignored (lenient read,
//     strict validate — errors list missing required keys).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The six mandatory fields of a loop contract. */
export interface LoopContract {
  /** What event or condition causes the loop to fire. */
  trigger: string;
  /** Which repository / directory / subsystem is in play. */
  scope: string;
  /** What the loop agent is allowed to do. */
  action: string;
  /** Resource caps — at least one of tokens or iterations must be set. */
  budget: {
    tokens?: number;
    iterations?: number;
  };
  /** Explicit stop condition (success or safety limit). */
  stop: string;
  /** What happens when the stop condition cannot be met. */
  escalate: string;
}

/** Successful parse result. */
export type ParseOk = { ok: true; contract: LoopContract };
/** Failed parse result with list of validation errors. */
export type ParseErr = { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Minimal flat YAML parser
// ---------------------------------------------------------------------------

/** Parse a flat key:value YAML subset. Returns a string→string map. */
function parseFlat(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip blank lines and comments.
    if (line === "" || line.startsWith("#")) continue;

    // Match "key: value" — value may contain colons.
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // Strip optional surrounding quotes (single or double).
    const stripped =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;

    if (key) {
      result[key] = stripped;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the content of a `.loop-contract.yaml` file.
 *
 * The format is a flat key:value YAML subset.  Nested budget fields use the
 * flat keys `budget_tokens` and `budget_iterations`.
 *
 * Returns `{ ok: true, contract }` on success, or
 * `{ ok: false, errors }` listing every missing / invalid field.
 */
export function parseContract(content: string): ParseOk | ParseErr {
  const flat = parseFlat(content);
  const errors: string[] = [];

  // Collect required string fields.
  const trigger = flat["trigger"] ?? "";
  const scope = flat["scope"] ?? "";
  const action = flat["action"] ?? "";
  const stop = flat["stop"] ?? "";
  const escalate = flat["escalate"] ?? "";

  if (!trigger) errors.push("missing required field: trigger");
  if (!scope) errors.push("missing required field: scope");
  if (!action) errors.push("missing required field: action");
  if (!stop) errors.push("missing required field: stop");
  if (!escalate) errors.push("missing required field: escalate");

  // Budget requires at least one of budget_tokens / budget_iterations.
  const tokensRaw = flat["budget_tokens"];
  const itersRaw = flat["budget_iterations"];

  let tokens: number | undefined;
  let iterations: number | undefined;

  if (tokensRaw !== undefined) {
    const n = Number(tokensRaw);
    if (!Number.isFinite(n) || n <= 0) {
      errors.push("budget_tokens must be a positive number");
    } else {
      tokens = n;
    }
  }

  if (itersRaw !== undefined) {
    const n = Number(itersRaw);
    if (!Number.isFinite(n) || n <= 0) {
      errors.push("budget_iterations must be a positive number");
    } else {
      iterations = n;
    }
  }

  if (tokens === undefined && iterations === undefined) {
    errors.push(
      "missing required field: budget (set budget_tokens and/or budget_iterations)",
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const contract: LoopContract = {
    trigger,
    scope,
    action,
    budget: { tokens, iterations },
    stop,
    escalate,
  };

  return { ok: true, contract };
}

/**
 * Validate a (possibly partial) `LoopContract` object.
 *
 * Returns an array of human-readable error strings.
 * An empty array means the contract is valid.
 */
export function validateContract(contract: Partial<LoopContract>): string[] {
  const errors: string[] = [];

  if (!contract.trigger || typeof contract.trigger !== "string") {
    errors.push("missing required field: trigger");
  }

  if (!contract.scope || typeof contract.scope !== "string") {
    errors.push("missing required field: scope");
  }

  if (!contract.action || typeof contract.action !== "string") {
    errors.push("missing required field: action");
  }

  if (!contract.stop || typeof contract.stop !== "string") {
    errors.push("missing required field: stop");
  }

  if (!contract.escalate || typeof contract.escalate !== "string") {
    errors.push("missing required field: escalate");
  }

  // Budget: must be an object with at least one positive numeric cap.
  if (!contract.budget || typeof contract.budget !== "object") {
    errors.push(
      "missing required field: budget (set budget.tokens and/or budget.iterations)",
    );
  } else {
    const { tokens, iterations } = contract.budget;
    const hasTokens =
      tokens !== undefined && Number.isFinite(tokens) && tokens > 0;
    const hasIterations =
      iterations !== undefined &&
      Number.isFinite(iterations) &&
      iterations > 0;

    if (!hasTokens && !hasIterations) {
      errors.push(
        "budget must specify at least one positive cap: tokens or iterations",
      );
    }
    if (tokens !== undefined && (!Number.isFinite(tokens) || tokens <= 0)) {
      errors.push("budget.tokens must be a positive number");
    }
    if (
      iterations !== undefined &&
      (!Number.isFinite(iterations) || iterations <= 0)
    ) {
      errors.push("budget.iterations must be a positive number");
    }
  }

  return errors;
}

/**
 * Return an annotated `.loop-contract.yaml` template string.
 *
 * This template can be parsed successfully by `parseContract`.
 */
export function contractTemplate(): string {
  return `# .loop-contract.yaml — Loop Contract (LE-10 standard)
#
# Six mandatory fields must be present for a production loop to be approved.
# Use flat key: value format; budget is split into budget_tokens / budget_iterations.

# TRIGGER: What event or condition causes this loop to fire.
# Examples: "git pre-push hook", "cron every 30 minutes", "PR opened"
trigger: git pre-push hook

# SCOPE: Which repository / directory / subsystem is in play.
# Be as specific as possible to limit blast radius.
# Examples: "repo: my-org/my-repo, branch: main", "/src/payments"
scope: repo my-org/my-repo

# ACTION: What the loop agent is allowed to do in each iteration.
# Use imperative language; list tools / capabilities explicitly.
# Examples: "read diff, classify risk, block push if wake-you-up finding"
action: read diff, classify risk, block push if wake-you-up finding detected

# BUDGET: Resource caps. At least one of budget_tokens / budget_iterations
# must be set. The loop will stop automatically when a cap is reached.
budget_tokens: 50000
budget_iterations: 20

# STOP: Explicit stop condition — what constitutes success or safety limit.
# The loop terminates when this condition is met.
# Examples: "all findings resolved", "iteration limit reached", "human approval"
stop: all findings resolved or iteration limit reached

# ESCALATE: What happens when the stop condition cannot be met within budget.
# Must name a human or automated action that takes over.
# Examples: "notify @on-call via Slack", "create GitHub issue", "halt and wait"
escalate: notify @on-call via Slack and halt loop
`;
}
