// runlog.ts — run daemon 的三件持久化:执行留痕、blocked 队列、已见命令集合。
//
// 延续 inbox.ts 的「文件即桥、本机可审计」风格,全是本地 json,坏文件跳过。
//   runs/<ulid>.json          每条执行的留痕(命令、退出码、输出截断、耗时)
//   inbox/blocked/<ulid>.json 被安全闸门拦下的决策(带拦截理由,等人工放行)
//   seen-commands.json        见过的命令前缀集合(影子告警:首次出现的新命令要告警)

import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { logDir } from "./logger";
import { generateUlid } from "./id";
import { inboxDir, pendingDir, type InboxItem } from "./inbox";

// ── 路径 ──
export function runsDir(): string { return join(logDir(), "runs"); }
export function blockedDir(): string { return join(inboxDir(), "blocked"); }
function seenPath(): string { return join(logDir(), "seen-commands.json"); }

// ── 执行留痕 ──
export interface RunRecord {
  id: string; // ULID(本条 run 自己的 id)
  inboxId: string; // 对应的决策 id
  createdAt: string; // ISO 8601
  title: string;
  action: string;
  kind: "shell" | "agent";
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function writeRun(o: {
  inboxId: string; title: string; action: string; kind: "shell" | "agent";
  exitCode: number; durationMs: number; stdout: string; stderr: string; timedOut: boolean;
  nowMs?: number;
}): RunRecord {
  const nowMs = o.nowMs ?? Date.now();
  const rec: RunRecord = {
    id: generateUlid(nowMs),
    inboxId: o.inboxId,
    createdAt: new Date(nowMs).toISOString(),
    title: o.title, action: o.action, kind: o.kind,
    exitCode: o.exitCode, durationMs: o.durationMs,
    stdout: o.stdout, stderr: o.stderr, timedOut: o.timedOut,
  };
  mkdirSync(runsDir(), { recursive: true });
  writeFileSync(join(runsDir(), `${rec.id}.json`), JSON.stringify(rec, null, 2), "utf8");
  return rec;
}

/** 列出所有 run 记录,按 id(时间)升序。坏文件跳过。 */
export function listRuns(): RunRecord[] {
  return readJsonDir<RunRecord>(runsDir());
}

// ── blocked 队列 ──
export interface BlockedItem extends InboxItem {
  blockedReason: string;
  blockedAt: string; // ISO 8601
}

/** 把一条 pending 决策转入 blocked/(带拦截理由)。返回是否成功。 */
export function markBlocked(id: string, reason: string, nowMs?: number): boolean {
  const src = join(pendingDir(), `${id}.json`);
  if (!existsSync(src)) return false;
  mkdirSync(blockedDir(), { recursive: true });
  try {
    const item = JSON.parse(readFileSync(src, "utf8")) as InboxItem;
    const blocked: BlockedItem = {
      ...item,
      blockedReason: reason,
      blockedAt: new Date(nowMs ?? Date.now()).toISOString(),
    };
    // 先写带拦截理由的到 blocked/,再删 pending 源(顺序:确保不丢)
    writeFileSync(join(blockedDir(), `${id}.json`), JSON.stringify(blocked, null, 2), "utf8");
    rmSync(src, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function listBlocked(): BlockedItem[] {
  return readJsonDir<BlockedItem>(blockedDir());
}

// ── 已见命令集合(影子告警) ──
// 取 action 的「命令前缀」(前两个 token,如 "git diff" / "npm run")作为指纹。
// 首次出现且不在黑名单的命令,runner 会先告警再跑 —— 黑名单追不全,可观测性来补。
function commandPrefix(action: string): string {
  return (action || "").trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase();
}

function readSeen(): Set<string> {
  try {
    if (!existsSync(seenPath())) return new Set();
    const arr = JSON.parse(readFileSync(seenPath(), "utf8")) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function isFirstSeen(action: string): boolean {
  return !readSeen().has(commandPrefix(action));
}

export function rememberCommand(action: string): void {
  const seen = readSeen();
  seen.add(commandPrefix(action));
  try {
    mkdirSync(logDir(), { recursive: true });
    writeFileSync(seenPath(), JSON.stringify([...seen], null, 2), "utf8");
  } catch {
    // 记不住就记不住,不拖垮主流程(下次会再告警一次,无害)
  }
}

// ── 共用:读一个目录下所有 json,按文件名升序,坏文件跳过 ──
function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const f of files.sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as T);
    } catch {
      // 坏行/半写跳过
    }
  }
  return out;
}
