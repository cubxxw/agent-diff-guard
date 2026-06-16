import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAuditEntry,
  verifyAuditChain,
  readAuditEntries,
} from "./audit";

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `adg-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  process.env.ADG_HOME = testDir;
});

afterEach(() => {
  delete process.env.ADG_HOME;
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("appendAuditEntry", () => {
  test("first entry has previousHash='genesis' and seq=1", async () => {
    const entry = await appendAuditEntry({
      sessionId: "sess-001",
      event: "loop_start",
    });

    expect(entry.seq).toBe(1);
    expect(entry.previousHash).toBe("genesis");
    expect(entry.sessionId).toBe("sess-001");
    expect(entry.event).toBe("loop_start");
    expect(entry.hash).toBeTruthy();
    expect(entry.hash.length).toBe(64);
    expect(entry.timestamp).toBeTruthy();
  });

  test("second entry's previousHash equals first entry's hash", async () => {
    const first = await appendAuditEntry({
      sessionId: "sess-001",
      event: "loop_start",
    });
    const second = await appendAuditEntry({
      sessionId: "sess-001",
      event: "loop_iteration",
      verdict: "approve",
    });

    expect(second.seq).toBe(2);
    expect(second.previousHash).toBe(first.hash);
    expect(second.verdict).toBe("approve");
  });

  test("appends multiple entries with correct seq chain", async () => {
    await appendAuditEntry({ sessionId: "s1", event: "start" });
    await appendAuditEntry({ sessionId: "s1", event: "check" });
    await appendAuditEntry({ sessionId: "s1", event: "end" });

    const all = readAuditEntries();
    expect(all.length).toBe(3);
    expect(all[0].seq).toBe(1);
    expect(all[1].seq).toBe(2);
    expect(all[2].seq).toBe(3);
    // Each entry's previousHash links to the prior entry's hash.
    expect(all[1].previousHash).toBe(all[0].hash);
    expect(all[2].previousHash).toBe(all[1].hash);
  });
});

describe("verifyAuditChain", () => {
  test("returns valid=true with 0 entries", async () => {
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(result.total).toBe(0);
  });

  test("returns valid=true for intact chain", async () => {
    await appendAuditEntry({ sessionId: "s1", event: "start" });
    await appendAuditEntry({ sessionId: "s1", event: "middle" });
    await appendAuditEntry({ sessionId: "s1", event: "end" });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
    expect(result.total).toBe(3);
  });

  test("detects tampering of a middle entry's stored hash", async () => {
    await appendAuditEntry({ sessionId: "s1", event: "start" });
    await appendAuditEntry({ sessionId: "s1", event: "middle" });
    await appendAuditEntry({ sessionId: "s1", event: "end" });

    // Mutate the second entry's stored hash directly.
    const auditFile = join(testDir, "loop-events.jsonl");
    const raw = readFileSync(auditFile, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());

    const second = JSON.parse(lines[1]);
    second.hash = "0000000000000000000000000000000000000000000000000000000000000000";
    lines[1] = JSON.stringify(second);

    writeFileSync(auditFile, lines.join("\n") + "\n", "utf8");

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    // seq=2 stored hash is wrong → detected at seq=2.
    expect(result.brokenAt).toBe(2);
    expect(result.total).toBe(3);
  });

  test("detects tampering of a middle entry's event field", async () => {
    await appendAuditEntry({ sessionId: "s1", event: "start" });
    await appendAuditEntry({ sessionId: "s1", event: "middle" });
    await appendAuditEntry({ sessionId: "s1", event: "end" });

    // Change seq=2's event field without updating its hash.
    const auditFile = join(testDir, "loop-events.jsonl");
    const raw = readFileSync(auditFile, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());

    const second = JSON.parse(lines[1]);
    second.event = "TAMPERED";
    lines[1] = JSON.stringify(second);

    writeFileSync(auditFile, lines.join("\n") + "\n", "utf8");

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });
});

describe("readAuditEntries", () => {
  test("returns empty array when file does not exist", () => {
    const entries = readAuditEntries();
    expect(entries).toEqual([]);
  });

  test("reads back all appended entries", async () => {
    await appendAuditEntry({ sessionId: "s1", event: "start" });
    await appendAuditEntry({ sessionId: "s1", event: "end", verdict: "approve" });

    const entries = readAuditEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].event).toBe("start");
    expect(entries[1].event).toBe("end");
    expect(entries[1].verdict).toBe("approve");
  });

  test("skips corrupt lines without throwing", () => {
    mkdirSync(testDir, { recursive: true });
    const auditFile = join(testDir, "loop-events.jsonl");
    writeFileSync(
      auditFile,
      '{"seq":1,"timestamp":"t","sessionId":"s","event":"ok","previousHash":"genesis","hash":"abc"}\n' +
        "NOT VALID JSON\n" +
        '{"seq":2,"timestamp":"t","sessionId":"s","event":"ok2","previousHash":"abc","hash":"def"}\n',
      "utf8",
    );

    const entries = readAuditEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].event).toBe("ok");
    expect(entries[1].event).toBe("ok2");
  });
});
