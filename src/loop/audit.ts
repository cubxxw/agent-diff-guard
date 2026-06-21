// audit.ts — Tamper-evident audit log for loop sessions (EU AI Act compliance).
//
// Uses SHA-256 hash chaining: each entry includes a hash of the previous entry,
// making any post-hoc modification detectable via verifyAuditChain().
//
// Design principles mirror logger.ts:
//   - JSONL format: zero-dependency, human-readable, one corrupt line ≠ total loss
//   - write failures are caught and warned, never thrown — auditing must not break main flow
//   - ADG_HOME env var isolates test runs from real ~/.agent-diff-guard data

import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logDir } from "../logger";
import { sha256prefix } from "../hash";

/** Path to the loop audit log file. */
function auditPath(): string {
  return join(logDir(), "loop-events.jsonl");
}

/**
 * A single tamper-evident audit log entry.
 * - seq: monotonically increasing sequence number (1-based)
 * - previousHash: hash of the previous entry, or "genesis" for the first entry
 * - hash: sha256prefix of the canonical JSON of this entry (excluding hash itself)
 */
export interface AuditEntry {
  seq: number;
  timestamp: string;
  sessionId: string;
  event: string;
  verdict?: string;
  previousHash: string;
  hash: string;
}

/**
 * Compute the hash for an entry from its canonical fields (excluding hash itself).
 * The canonical object is deterministic — same field order every time.
 */
async function computeHash(fields: {
  seq: number;
  timestamp: string;
  sessionId: string;
  event: string;
  verdict?: string;
  previousHash: string;
}): Promise<string> {
  // Build canonical object with consistent key order.
  const canonical: Record<string, unknown> = {
    seq: fields.seq,
    timestamp: fields.timestamp,
    sessionId: fields.sessionId,
    event: fields.event,
    previousHash: fields.previousHash,
  };
  if (fields.verdict !== undefined) {
    canonical.verdict = fields.verdict;
  }
  return sha256prefix(JSON.stringify(canonical), 64);
}

/**
 * Read all audit entries from loop-events.jsonl.
 * Lines that cannot be parsed are silently skipped (corrupt / partial writes).
 */
export function readAuditEntries(): AuditEntry[] {
  const path = auditPath();
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    console.warn("[adg] Failed to read audit log:", (e as Error).message);
    return [];
  }

  const entries: AuditEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Corrupt or partial line — skip silently.
    }
  }
  return entries;
}

/**
 * Append a new tamper-evident entry to loop-events.jsonl.
 *
 * Reads the last existing entry to obtain previousHash, then:
 *   1. Assigns seq = last.seq + 1 (or 1 for the first entry)
 *   2. Sets previousHash = last.hash (or "genesis" for the first entry)
 *   3. Computes hash over the canonical entry fields
 *   4. Appends the full entry as a JSON line
 *
 * Write failures are caught and warned — never thrown.
 */
export async function appendAuditEntry(opts: {
  sessionId: string;
  event: string;
  verdict?: string;
}): Promise<AuditEntry> {
  const existing = readAuditEntries();
  const last = existing.length > 0 ? existing[existing.length - 1] : null;

  const seq = last ? last.seq + 1 : 1;
  const previousHash = last ? last.hash : "genesis";
  const timestamp = new Date().toISOString();

  const fields = {
    seq,
    timestamp,
    sessionId: opts.sessionId,
    event: opts.event,
    verdict: opts.verdict,
    previousHash,
  };

  const hash = await computeHash(fields);

  const entry: AuditEntry = {
    seq,
    timestamp,
    sessionId: opts.sessionId,
    event: opts.event,
    previousHash,
    hash,
  };
  if (opts.verdict !== undefined) {
    entry.verdict = opts.verdict;
  }

  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(auditPath(), JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    console.warn("[adg] Audit log write failed (does not affect main flow):", (e as Error).message);
  }

  return entry;
}

/**
 * Verify the integrity of the entire audit chain.
 *
 * For each entry, re-computes the hash from its canonical fields and checks:
 *   1. hash matches the stored hash
 *   2. previousHash matches the hash of the preceding entry (or "genesis" for seq=1)
 *
 * Returns:
 *   - valid: true only if every entry passes both checks
 *   - brokenAt: seq number of the first broken entry, or null if chain is intact
 *   - total: number of entries examined
 */
export async function verifyAuditChain(): Promise<{
  valid: boolean;
  brokenAt: number | null;
  total: number;
}> {
  const entries = readAuditEntries();

  if (entries.length === 0) {
    return { valid: true, brokenAt: null, total: 0 };
  }

  let prevHash = "genesis";

  for (const entry of entries) {
    // Verify previousHash link.
    if (entry.previousHash !== prevHash) {
      return { valid: false, brokenAt: entry.seq, total: entries.length };
    }

    // Re-compute the expected hash from canonical fields.
    const fields = {
      seq: entry.seq,
      timestamp: entry.timestamp,
      sessionId: entry.sessionId,
      event: entry.event,
      verdict: entry.verdict,
      previousHash: entry.previousHash,
    };
    const expected = await computeHash(fields);

    if (entry.hash !== expected) {
      return { valid: false, brokenAt: entry.seq, total: entries.length };
    }

    prevHash = entry.hash;
  }

  return { valid: true, brokenAt: null, total: entries.length };
}
