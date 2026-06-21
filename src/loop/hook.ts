import { quickCheck } from "./check";
import { activeSessionForCwd } from "./session";

export async function handlePostToolUse(): Promise<void> {
  let raw = "";
  for await (const chunk of Bun.stdin.stream()) {
    raw += new TextDecoder().decode(chunk);
  }

  let parsed: { tool_name?: string; tool_input?: { file_path?: string } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const filePath = parsed?.tool_input?.file_path;
  if (!filePath) return;

  const cwd = process.cwd();
  const session = activeSessionForCwd(cwd);
  const sessionId = session?.id;

  const result = quickCheck({ cwd, filePath, sessionId });

  if (result.verdict !== "pass") {
    console.error(
      `[agent-diff-guard hook] ${result.verdict}: ${result.notes.join("; ")} (${result.elapsedMs}ms)`,
    );
  }
}

// 注:hook 配置生成统一走 adapters.ts(claudeSnippet 等),含正确的字符串 matcher +
// 绝对路径。本文件只负责 PostToolUse 的 stdin 消费(handlePostToolUse)。

if (import.meta.main) {
  handlePostToolUse().catch(() => {});
}
