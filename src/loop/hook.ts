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

export function hookConfig(guardCliPath: string) {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: { tool_name: "Edit|Write|MultiEdit" },
          hooks: [
            {
              type: "command",
              command: `echo $TOOL_INPUT | bun run ${guardCliPath}`,
            },
          ],
        },
      ],
    },
  };
}

if (import.meta.main) {
  handlePostToolUse().catch(() => {});
}
