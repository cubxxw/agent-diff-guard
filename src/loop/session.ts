import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { LoopSessionSchema, type LoopSession } from "./types";
import { generateUlid } from "../id";
import { sha256prefix } from "../hash";
import { taskKeywords } from "../scan";
import { logDir } from "../logger";

export function loopsDir(): string {
  const dir = join(logDir(), "loops");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function startSession(opts: {
  goal: string;
  cwd: string;
  budgetTokens?: number | null;
  mode?: "attended" | "unattended";
}): Promise<LoopSession> {
  const existing = activeSessionForCwd(opts.cwd);
  if (existing) {
    throw new Error(
      `Already have active session ${existing.id} for cwd ${opts.cwd}`,
    );
  }

  const id = generateUlid();
  const now = new Date().toISOString();
  const keywords = taskKeywords(opts.goal);
  const goalHash = await sha256prefix(opts.goal);

  const session: LoopSession = {
    id,
    createdAt: now,
    updatedAt: now,
    goal: opts.goal,
    goalHash,
    goalKeywords: keywords,
    cwd: opts.cwd,
    repoRemote: null,
    budgetTokens: opts.budgetTokens ?? null,
    budgetWarnPct: 0.6,
    budgetBlockPct: 0.9,
    mode: opts.mode ?? "attended",
    status: "active",
    iterationCount: 0,
    cumulativeDrift: 0,
    driftHistory: [],
    tokenSpend: [],
    rollbackPoints: [],
    findingsLog: [],
    riskTrend: [],
  };

  const dir = loopsDir();
  const filePath = join(dir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(session, null, 2), "utf8");

  return session;
}

export function loadSession(id: string): LoopSession | null {
  const filePath = join(loopsDir(), `${id}.json`);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const result = LoopSessionSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

export function saveSession(session: LoopSession): void {
  session.updatedAt = new Date().toISOString();
  const dir = loopsDir();
  const filePath = join(dir, `${session.id}.json`);
  const tmpPath = join(dir, `${session.id}.tmp.json`);
  writeFileSync(tmpPath, JSON.stringify(session, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

export function stopSession(id: string): boolean {
  const session = loadSession(id);
  if (!session) return false;
  session.status = "stopped";
  saveSession(session);
  return true;
}

export function listSessions(): LoopSession[] {
  const dir = loopsDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".tmp.json"),
  );
  const sessions: LoopSession[] = [];
  for (const file of files) {
    const id = file.replace(".json", "");
    const s = loadSession(id);
    if (s) sessions.push(s);
  }
  return sessions;
}

export function activeSessionForCwd(cwd: string): LoopSession | null {
  return (
    listSessions().find(
      (s) => s.cwd === cwd && s.status === "active",
    ) ?? null
  );
}
