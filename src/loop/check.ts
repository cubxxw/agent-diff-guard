import type { IterationResult, HookResult } from "./types";
import { loadSession, saveSession } from "./session";
import {
  iterationDriftScore,
  updateCumulativeDrift,
  goalRelevance,
  driftVerdict,
} from "./drift";
import { budgetStatus } from "./budget";
import { parseDiff } from "../scan";
import { runRules, pathFindings } from "../rules";
import type { FileChange, Finding } from "../rules";
import { detectViolations } from "../violations";
import { loadPolicy } from "../policy";
import { buildFindingMeta } from "../event";

const HISTORY_CAP = 500;

function worstVerdict(
  ...verdicts: ("pass" | "warn" | "block")[]
): "pass" | "warn" | "block" {
  if (verdicts.includes("block")) return "block";
  if (verdicts.includes("warn")) return "warn";
  return "pass";
}

export interface CheckDeps {
  parseDiff: (range: string, cwd: string) => FileChange[];
  runRules: (changes: FileChange[]) => Finding[];
  loadPolicy: (repoDir: string) => ReturnType<typeof loadPolicy>;
  detectViolations: typeof detectViolations;
  buildFindingMeta: typeof buildFindingMeta;
}

const defaultDeps: CheckDeps = {
  parseDiff,
  runRules,
  loadPolicy,
  detectViolations,
  buildFindingMeta,
};

export async function checkIteration(opts: {
  sessionId: string;
  task?: string;
  deps?: Partial<CheckDeps>;
}): Promise<IterationResult> {
  const deps = { ...defaultDeps, ...opts.deps };

  const session = loadSession(opts.sessionId);
  if (!session) {
    throw new Error(`Session ${opts.sessionId} not found`);
  }

  session.iterationCount++;
  const iteration = session.iterationCount;
  const now = new Date().toISOString();

  // 1. Diff check
  const changes = deps.parseDiff("HEAD", session.cwd);
  const findings = deps.runRules(changes);
  const findingMetas = findings.map(deps.buildFindingMeta);
  const wakeFindings = findings.filter((f) => f.severity === "wake-you-up").length;
  const lookFindings = findings.filter((f) => f.severity === "look-once").length;

  // 2. Policy check
  const policySet = deps.loadPolicy(session.cwd);
  const changedFileNames = changes.map((c) => c.path.split("/").pop() || c.path);
  const taskTurns = [
    {
      task: opts.task || session.goal,
      filesChanged: changedFileNames,
      timestamp: now,
      gitBranch: null,
      cwd: session.cwd,
    },
  ];
  const violations = deps.detectViolations(taskTurns, policySet.policies);

  // 3. Drift check
  const changedPaths = changes.map((c) => c.path);
  const iterDrift = iterationDriftScore(changedPaths, session.goalKeywords);
  const cumDrift = updateCumulativeDrift(iterDrift, session.cumulativeDrift);
  session.cumulativeDrift = cumDrift;
  const relevance = goalRelevance(changedPaths, session.goalKeywords);
  const driftVerd = driftVerdict(cumDrift);

  // 4. Budget check
  const totalTokensUsed = session.tokenSpend.reduce(
    (sum, e) => sum + e.inputTokens + e.outputTokens,
    0,
  );
  const budget = budgetStatus(
    totalTokensUsed,
    session.budgetTokens,
    session.budgetWarnPct,
    session.budgetBlockPct,
    session.tokenSpend,
  );

  // 5. Composite verdict
  const diffVerdict: "pass" | "warn" | "block" =
    wakeFindings > 0 ? "block" : lookFindings > 0 ? "warn" : "pass";
  const policyVerdict: "pass" | "warn" | "block" =
    violations.length > 0 ? "block" : "pass";

  const verdict = worstVerdict(
    diffVerdict,
    driftVerd,
    budget.verdict,
    policyVerdict,
  );

  const verdictReasons: string[] = [];
  if (diffVerdict !== "pass")
    verdictReasons.push(`${wakeFindings} wake-you-up finding(s)`);
  if (driftVerd !== "pass")
    verdictReasons.push(`drift ${driftVerd}: cumulative=${cumDrift.toFixed(2)}`);
  if (budget.verdict !== "pass")
    verdictReasons.push(`budget ${budget.verdict}: ${(budget.budgetPct * 100).toFixed(0)}%`);
  if (policyVerdict !== "pass")
    verdictReasons.push(`${violations.length} policy violation(s)`);
  if (verdictReasons.length === 0) verdictReasons.push("all checks passed");

  // 6. Rollback point if all pass
  if (verdict === "pass") {
    session.rollbackPoints.push({
      iteration,
      timestamp: now,
      commitHash: "HEAD",
    });
    if (session.rollbackPoints.length > HISTORY_CAP) {
      session.rollbackPoints = session.rollbackPoints.slice(-HISTORY_CAP);
    }
  }

  // 7. Append history arrays
  session.driftHistory.push({
    iteration,
    timestamp: now,
    iterationDrift: iterDrift,
    cumulativeDrift: cumDrift,
    goalRelevance: relevance,
  });
  if (session.driftHistory.length > HISTORY_CAP) {
    session.driftHistory = session.driftHistory.slice(-HISTORY_CAP);
  }

  for (const f of findings) {
    session.findingsLog.push({
      iteration,
      timestamp: now,
      rule: f.rule,
      severity: f.severity,
      path: f.path,
      whySummary: f.why.slice(0, 80),
    });
  }
  if (session.findingsLog.length > HISTORY_CAP) {
    session.findingsLog = session.findingsLog.slice(-HISTORY_CAP);
  }

  session.riskTrend.push({
    iteration,
    timestamp: now,
    verdict,
    wakeCount: wakeFindings,
    lookCount: lookFindings,
    cumulativeDrift: cumDrift,
    budgetPct: budget.budgetPct,
  });
  if (session.riskTrend.length > HISTORY_CAP) {
    session.riskTrend = session.riskTrend.slice(-HISTORY_CAP);
  }

  // 8. Save session
  saveSession(session);

  return {
    sessionId: session.id,
    iteration,
    timestamp: now,
    verdict,
    verdictReasons,
    diffCheck: {
      filesChanged: changes.length,
      wakeFindings,
      lookFindings,
      findings: findingMetas,
    },
    driftCheck: {
      iterationDrift: iterDrift,
      cumulativeDrift: cumDrift,
      goalRelevance: relevance,
    },
    budgetCheck: {
      tokensUsed: totalTokensUsed,
      budgetTotal: session.budgetTokens,
      budgetPct: budget.budgetPct,
      estimatedIterationsRemaining: budget.estimatedIterationsRemaining,
      tokensPerIteration: budget.tokensPerIteration,
    },
    policyCheck: {
      violationCount: violations.length,
      violations: violations.map((v) => ({
        policyName: v.policyName,
        offendingFiles: v.offendingFiles,
      })),
    },
  };
}

/**
 * Fast path for PostToolUse hook: only run path rules on a single file.
 * No session/budget/drift loading. Target < 500ms.
 */
export function quickCheck(opts: {
  cwd: string;
  filePath: string;
  sessionId?: string;
}): HookResult {
  const start = performance.now();

  const fc: FileChange = {
    path: opts.filePath,
    kind: "modified",
    addedLines: [],
    removedLines: [],
  };

  const findings = pathFindings(fc);
  const verdict: "pass" | "warn" | "block" =
    findings.some((f) => f.severity === "wake-you-up")
      ? "warn"
      : "pass";

  const notes = findings.map((f) => `${f.rule}: ${f.why}`);
  const elapsedMs = Math.round(performance.now() - start);

  return { verdict, notes, elapsedMs };
}
