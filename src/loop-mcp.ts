import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import {
  startSession,
  loadSession,
  activeSessionForCwd,
} from "./loop/session";
import { checkIteration } from "./loop/check";
import { generateReport, renderReport } from "./loop/report";

export function registerLoopTools(server: McpServer): void {
  // ── Tool: guard_loop_iteration ──────────────────────────────────────
  server.registerTool(
    "guard_loop_iteration",
    {
      title: "Loop 迭代守卫",
      description:
        "Run one iteration of the Loop Guard: diff check, drift detection, budget tracking, and policy enforcement. " +
        "If no session_id is given but goal+cwd are provided, a new session is started automatically. " +
        "Returns the iteration result with a verdict (pass/warn/block) and reasons.",
      inputSchema: {
        session_id: z
          .string()
          .optional()
          .describe(
            "Existing loop session ID. If omitted, a new session is started using goal+cwd.",
          ),
        goal: z
          .string()
          .optional()
          .describe(
            "Goal description for the loop. Required when starting a new session (no session_id).",
          ),
        cwd: z
          .string()
          .optional()
          .describe("Working directory. Defaults to server cwd."),
        budget_tokens: z
          .number()
          .optional()
          .describe("Total token budget for the session."),
        mode: z
          .enum(["attended", "unattended"])
          .optional()
          .describe("Session mode. Defaults to attended."),
        task: z
          .string()
          .optional()
          .describe(
            "Current task/step description for drift detection within this iteration.",
          ),
      },
    },
    async ({ session_id, goal, cwd, budget_tokens, mode, task }) => {
      const dir = cwd || process.cwd();

      let sessionId = session_id;

      if (!sessionId) {
        const existing = activeSessionForCwd(dir);
        if (existing) {
          sessionId = existing.id;
        } else {
          if (!goal) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: either session_id or goal is required to start a loop session.",
                },
              ],
            };
          }
          const session = await startSession({
            goal,
            cwd: dir,
            budgetTokens: budget_tokens,
            mode: mode ?? "attended",
          });
          sessionId = session.id;
        }
      }

      const result = await checkIteration({ sessionId, task });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ── Tool: loop_status ───────────────────────────────────────────────
  server.registerTool(
    "loop_status",
    {
      title: "Loop 状态查询",
      description:
        "Get the current status of a loop session. Supports summary, full, and morning-report formats.",
      inputSchema: {
        session_id: z
          .string()
          .describe("Loop session ID to query."),
        format: z
          .enum(["summary", "full", "morning-report"])
          .optional()
          .describe(
            "Output format: summary (default, key metrics only), full (entire session JSON), morning-report (human-readable report).",
          ),
      },
    },
    async ({ session_id, format }) => {
      const session = loadSession(session_id);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session ${session_id} not found.`,
            },
          ],
        };
      }

      const fmt = format ?? "summary";

      if (fmt === "full") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(session, null, 2),
            },
          ],
        };
      }

      if (fmt === "morning-report") {
        const report = generateReport(session);
        return {
          content: [
            {
              type: "text" as const,
              text: renderReport(report),
            },
          ],
        };
      }

      // summary
      const summary = {
        id: session.id,
        status: session.status,
        goal: session.goal,
        iterationCount: session.iterationCount,
        cumulativeDrift: session.cumulativeDrift,
        mode: session.mode,
        budgetTokens: session.budgetTokens,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );
}
