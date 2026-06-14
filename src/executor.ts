// executor.ts — run daemon 的执行引擎。把一条决策真的跑起来。
//
// 两条路径:
//   shell 类 → bash -lc "<action>"(已过 classify 黑名单)
//   agent 类 → claude -p "<action>"(headless,自然语言交给 Claude Code 自己理解执行)
//
// 共同护栏:墙钟超时(超时 kill)、输出截断(防一条命令刷爆内存/日志)。
// 不落盘 —— 返回结构化结果,留痕交给 runner。

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** 墙钟耗时(毫秒) */
  durationMs: number;
}

export interface ExecOpts {
  /** 墙钟超时,默认 120s */
  timeoutMs?: number;
  /** stdout/stderr 各自最大保留字节,超出截断,默认 64KB */
  maxOutput?: number;
  /** 工作目录,默认继承当前进程 */
  cwd?: string;
}

const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024;

function clip(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max) + "\n…[输出已截断]", truncated: true };
}

/**
 * spawn 一个子进程并等它结束/超时。这是 runShell / runClaude 共用的底座。
 */
async function spawnAndWait(cmd: string[], opts: ExecOpts, startMs: number): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxOutput = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;

  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9); // SIGKILL,确保 sleep 这类也被掐断
  }, timeoutMs);

  const [stdoutRaw, stderrRaw, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  const out = clip(stdoutRaw, maxOutput);
  const err = clip(stderrRaw, maxOutput);
  return {
    exitCode: timedOut ? 124 : exitCode, // 124 = 超时(沿用 GNU timeout 约定)
    stdout: out.text,
    stderr: err.text,
    timedOut,
    truncated: out.truncated || err.truncated,
    durationMs: Date.now() - startMs,
  };
}

/** shell 路径:用 bash -lc 跑(支持 && / | / 重定向等组合)。 */
export function runShell(action: string, opts: ExecOpts = {}): Promise<ExecResult> {
  return spawnAndWait(["bash", "-lc", action], opts, Date.now());
}

export interface ClaudeOpts {
  /** claude 权限模式。default=正常权限提示;acceptEdits;bypassPermissions(危险,慎用) */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  /** 输出格式,默认 json(便于程序解析) */
  outputFormat?: "text" | "json" | "stream-json";
}

/**
 * 构造 headless claude 调用参数。抽成纯函数便于单测,不真的 spawn。
 * 默认 --permission-mode default —— 即便 daemon 全自动,也不默认越权;
 * 要让 claude 真动手改文件,需调用方显式传 acceptEdits/bypassPermissions。
 */
export function buildClaudeArgs(prompt: string, opts: ClaudeOpts = {}): string[] {
  const args = ["-p", prompt, "--output-format", opts.outputFormat ?? "json"];
  args.push("--permission-mode", opts.permissionMode ?? "default");
  return args;
}

/** agent 路径:headless 调 claude。bin 可注入用于测试(默认 "claude")。 */
export function runClaude(
  prompt: string,
  opts: ExecOpts & ClaudeOpts = {},
  bin = "claude",
): Promise<ExecResult> {
  const args = buildClaudeArgs(prompt, opts);
  return spawnAndWait([bin, ...args], opts, Date.now());
}
