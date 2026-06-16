import { z } from "zod/v4";

// -- Sub-schemas --

const SeveritySchema = z.enum(["wake-you-up", "look-once"]);

const DriftEntrySchema = z.object({
  iteration: z.number(),
  timestamp: z.string(),
  iterationDrift: z.number(),
  cumulativeDrift: z.number(),
  goalRelevance: z.number(),
});

const TokenEntrySchema = z.object({
  iteration: z.number(),
  timestamp: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().default(0),
  estCostUsd: z.number().default(0),
});

const RollbackEntrySchema = z.object({
  iteration: z.number(),
  timestamp: z.string(),
  commitHash: z.string(),
});

const FindingLogEntrySchema = z.object({
  iteration: z.number(),
  timestamp: z.string(),
  rule: z.string(),
  severity: SeveritySchema,
  path: z.string(),
  whySummary: z.string(),
});

const RiskTrendEntrySchema = z.object({
  iteration: z.number(),
  timestamp: z.string(),
  verdict: z.enum(["pass", "warn", "block"]),
  wakeCount: z.number(),
  lookCount: z.number(),
  cumulativeDrift: z.number(),
  budgetPct: z.number(),
});

// -- LoopSession --

export const LoopSessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),

  goal: z.string(),
  goalHash: z.string(),
  goalKeywords: z.array(z.string()),

  cwd: z.string(),
  repoRemote: z.string().nullable(),
  budgetTokens: z.number().nullable(),
  budgetWarnPct: z.number().default(0.6),
  budgetBlockPct: z.number().default(0.9),
  mode: z.enum(["attended", "unattended"]),

  status: z.enum(["active", "paused", "stopped", "emergency-braked"]),
  iterationCount: z.number().default(0),
  cumulativeDrift: z.number().default(0),

  driftHistory: z.array(DriftEntrySchema).default([]),
  tokenSpend: z.array(TokenEntrySchema).default([]),
  rollbackPoints: z.array(RollbackEntrySchema).default([]),
  findingsLog: z.array(FindingLogEntrySchema).default([]),
  riskTrend: z.array(RiskTrendEntrySchema).default([]),
});

export type LoopSession = z.infer<typeof LoopSessionSchema>;

// -- IterationResult --

const FindingMetaSchema = z.object({
  rule: z.string(),
  severity: SeveritySchema,
  path: z.string(),
  whySummary: z.string(),
  hasEvidence: z.boolean(),
});

export const IterationResultSchema = z.object({
  sessionId: z.string(),
  iteration: z.number(),
  timestamp: z.string(),
  verdict: z.enum(["pass", "warn", "block"]),
  verdictReasons: z.array(z.string()),

  diffCheck: z.object({
    filesChanged: z.number(),
    wakeFindings: z.number(),
    lookFindings: z.number(),
    findings: z.array(FindingMetaSchema),
  }),

  driftCheck: z.object({
    iterationDrift: z.number(),
    cumulativeDrift: z.number(),
    goalRelevance: z.number(),
  }),

  budgetCheck: z.object({
    tokensUsed: z.number(),
    budgetTotal: z.number().nullable(),
    budgetPct: z.number(),
    estimatedIterationsRemaining: z.number().nullable(),
    tokensPerIteration: z.number(),
  }),

  policyCheck: z.object({
    violationCount: z.number(),
    violations: z.array(
      z.object({
        policyName: z.string(),
        offendingFiles: z.array(z.string()),
      }),
    ),
  }),
});

export type IterationResult = z.infer<typeof IterationResultSchema>;

// -- HookResult (lightweight for < 500ms path) --

export interface HookResult {
  verdict: "pass" | "warn" | "block";
  notes: string[];
  elapsedMs: number;
}

// -- MorningReport --

export interface MorningReport {
  sessionId: string;
  generatedAt: string;
  iterationsWhileAway: number;
  topFindings: {
    rule: string;
    path: string;
    severity: "wake-you-up" | "look-once";
    count: number;
  }[];
  driftSummary: {
    status: "stable" | "drifting" | "diverged";
    currentDrift: number;
    trend: "improving" | "stable" | "worsening";
  };
  budgetSummary: {
    tokensUsed: number;
    budgetTotal: number | null;
    budgetPct: number;
    estimatedIterationsRemaining: number | null;
  };
  safeRollbackPoint: {
    iteration: number;
    commitHash: string;
  } | null;
  emergencyBrakeTriggered: boolean;
  recommendation: "continue" | "review-and-continue" | "rollback" | "stop";
}
