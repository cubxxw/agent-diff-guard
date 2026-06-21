import type { IterationResult, HookResult, LoopSession } from "./types";
import { loadSession, saveSession, listSessions } from "./session";
import {
  iterationDriftScore,
  updateCumulativeDrift,
  goalRelevance,
  driftVerdict,
} from "./drift";
import { budgetStatus } from "./budget";
import { iterationResultToOtelAttributes } from "./otel";
import { detectNoProgress, diffContentHash } from "./progress";
import { circuitBreakerCheck } from "./circuit";
import { parseDiff } from "../scan";
import { runRules, pathFindings } from "../rules";
import type { FileChange, Finding } from "../rules";
import { detectViolations } from "../violations";
import { loadPolicy } from "../policy";
import { buildFindingMeta } from "../event";
import { spawnSync } from "node:child_process";

const HISTORY_CAP = 500;

/** 解析仓库当前 HEAD 的 short SHA;拿不到(非 git 仓库/git 不可用)时返回 null。 */
function headSha(cwd: string): string | null {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" });
    if (r.status !== 0) return null;
    const sha = r.stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/** LE-04: env-configurable daily cross-session token budget (0/unset = unlimited). */
function dailyTokenBudget(): number | null {
  const raw = process.env.ADG_DAILY_TOKEN_BUDGET?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
  listSessions: () => LoopSession[];
}

const defaultDeps: CheckDeps = {
  parseDiff,
  runRules,
  loadPolicy,
  detectViolations,
  buildFindingMeta,
  listSessions,
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

  // 5a. No-progress detection (LE-15)
  const diffHash = diffContentHash(changedPaths);
  session.diffHashHistory.push(diffHash);
  if (session.diffHashHistory.length > HISTORY_CAP) {
    session.diffHashHistory = session.diffHashHistory.slice(-HISTORY_CAP);
  }
  const progress = detectNoProgress({ recentDiffHashes: session.diffHashHistory });
  const progressVerdict: "pass" | "warn" | "block" = progress.stalled
    ? changes.length === 0
      ? "block"
      : "warn"
    : "pass";

  // 5b. Circuit breaker (LE-16) — reads the session's recorded tool-call outcomes
  const circuit = circuitBreakerCheck(session.toolCallHistory);
  const circuitVerdict: "pass" | "warn" | "block" = circuit.tripped ? "warn" : "pass";

  // 5c. Cross-session token spend (LE-04)
  const dailyBudget = dailyTokenBudget();
  const activeSiblings = deps
    .listSessions()
    .filter((s) => s.cwd === session.cwd && s.status === "active");
  const totalTokensAcrossSessions = activeSiblings.reduce(
    (sum, s) =>
      sum +
      s.tokenSpend.reduce((t, e) => t + e.inputTokens + e.outputTokens, 0),
    0,
  );
  const overThreshold =
    dailyBudget != null && totalTokensAcrossSessions > dailyBudget;

  // 6. Composite verdict
  const diffVerdict: "pass" | "warn" | "block" =
    wakeFindings > 0 ? "block" : lookFindings > 0 ? "warn" : "pass";
  const policyVerdict: "pass" | "warn" | "block" =
    violations.length > 0 ? "block" : "pass";
  const crossSessionVerdict: "pass" | "warn" | "block" = overThreshold
    ? "warn"
    : "pass";

  const verdict = worstVerdict(
    diffVerdict,
    driftVerd,
    budget.verdict,
    policyVerdict,
    progressVerdict,
    circuitVerdict,
    crossSessionVerdict,
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
  if (progressVerdict !== "pass")
    verdictReasons.push(`no-progress: ${progress.reason}`);
  if (circuitVerdict !== "pass")
    verdictReasons.push(`circuit: ${circuit.recommendation}`);
  if (crossSessionVerdict !== "pass")
    verdictReasons.push(
      `cross-session token budget exceeded: ${totalTokensAcrossSessions} > ${dailyBudget}`,
    );
  if (verdictReasons.length === 0) verdictReasons.push("all checks passed");

  // 7. Rollback point if all pass
  if (verdict === "pass") {
    session.rollbackPoints.push({
      iteration,
      timestamp: now,
      // 落【真实 short SHA】而非字面 "HEAD" —— 晨报的"安全回滚点"要能真的 git reset 回去;
      // 写死 "HEAD" 时复制出来是空操作(HEAD 早已前移)。解析失败才退回 "HEAD"(兼容)。
      commitHash: headSha(session.cwd) ?? "HEAD",
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

  const result: IterationResult = {
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
    // LE-15 / LE-16 / LE-04
    progressCheck: {
      stalled: progress.stalled,
      stalledRounds: progress.stalledRounds,
      reason: progress.reason,
    },
    circuitCheck: {
      tripped: circuit.tripped,
      tool: circuit.tool,
      consecutiveFailures: circuit.consecutiveFailures,
      recommendation: circuit.recommendation,
    },
    crossSessionCheck: {
      totalTokensAcrossSessions,
      activeSessionCount: activeSiblings.length,
      overThreshold,
    },
  };

  // LE-01: attach OTEL span attributes (computed from the full result)
  result.otelAttributes = iterationResultToOtelAttributes(result);

  return result;
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
