// Push a MorningReport to one or more out-of-band channels so the user
// actually sees it without opening the panel. macOS notification + webhook
// (Slack/Discord-compatible JSON) are first-class; channels stay best-effort
// so a single broken target never blocks the others.

import type { MorningReport } from "./types";
import { renderReport } from "./report";

export type PushChannel =
  | { kind: "macos"; title?: string }
  | { kind: "webhook"; url: string }
  | { kind: "stdout" };

export interface PushResult {
  channel: string;
  ok: boolean;
  reason?: string;
}

export async function pushReport(
  report: MorningReport,
  channels: PushChannel[],
  opts?: { fetchImpl?: typeof fetch; spawnImpl?: typeof Bun.spawn },
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const ch of channels) {
    try {
      if (ch.kind === "stdout") {
        process.stdout.write(renderReport(report) + "\n");
        results.push({ channel: "stdout", ok: true });
      } else if (ch.kind === "macos") {
        await pushMacos(report, ch.title ?? "agent-diff-guard 晨报", opts?.spawnImpl);
        results.push({ channel: "macos", ok: true });
      } else if (ch.kind === "webhook") {
        await pushWebhook(report, ch.url, opts?.fetchImpl ?? fetch);
        results.push({ channel: "webhook:" + ch.url, ok: true });
      }
    } catch (e) {
      results.push({
        channel: ch.kind,
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

async function pushMacos(
  report: MorningReport,
  title: string,
  spawnImpl?: typeof Bun.spawn,
): Promise<void> {
  // osascript only available on darwin. Caller should gate by platform.
  const subtitle = `${report.recommendation} · drift ${(report.driftSummary.currentDrift * 100).toFixed(0)}% · budget ${(report.budgetSummary.budgetPct * 100).toFixed(0)}%`;
  const message = `${report.iterationsWhileAway} iterations${report.safeRollbackPoint ? ` · rollback ${report.safeRollbackPoint.commitHash.slice(0, 8)}` : ""}`;
  const script = `display notification ${escapeAppleScript(message)} with title ${escapeAppleScript(title)} subtitle ${escapeAppleScript(subtitle)}`;
  const spawn = spawnImpl ?? Bun.spawn;
  const proc = spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`osascript exit ${code}`);
}

function escapeAppleScript(s: string): string {
  // Wrap in quotes and escape backslashes + quotes for AppleScript string literals.
  // 换行在 AppleScript 字符串字面量里是语法错误(且是注入面)—— 折成空格,绝不留裸换行。
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "")
      .replace(/\n/g, " ") +
    '"'
  );
}

async function pushWebhook(
  report: MorningReport,
  url: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const text = renderReport(report);
  // Slack / Discord both accept { text: "..." } as the simplest payload.
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, report }),
  });
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
}
