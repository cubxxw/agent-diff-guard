// pretool.ts — PreToolUse 守门:在 agent 动手【之前】刹车,而非事后告警。
//
// 为什么存在:PostToolUse(hook.ts)是事后的 —— diff 已经发生才提示,守门天然低频。
// 真正能"关键时刻刹车"的是 PreToolUse:Claude Code 在 Edit/Write/Bash/MCP 工具调用
// 执行【前】调用它,本 hook 返回结构化裁决,Claude Code 据此 allow / ask / deny。
//
// 隐私铁律如何成立:本 hook 只看 agent 自己声明的 tool_input —— 要改哪个文件路径、
// 要跑什么命令、要调哪个 MCP 工具。它【不读仓库 diff 正文、不读文件内容】,风险评分
// 完全基于"路径 + agent 声明的入参",所以 diff 正文绝不出本机。这正是 quickCheck 早已
// 验证的路径:pathFindings 只吃 file path,addedLines 为空也能判风险。
//
// 裁决映射(对齐"宁可漏不可烦",避免狼来了):
//   wake-you-up 命中 → ask  —— 升级人工确认。不直接 deny(太硬会误伤、会烦),
//                              把"是否放行"交给人,这才是"只把高危送到眼前"。
//   look-once / 无命中 → allow —— 平时放行,不打断心流。
// 这里【故意不默认 deny】:deny 是 agent 完全无法绕过的硬否决,留给未来"绝对红线"
// (如显式 policy 命中)再用;第一版守门人先用 ask,保住信任。

import { runRules, type FileChange, type Finding } from "../rules";

/** Claude Code PreToolUse 协议:hook 看到的输入。 */
export interface PreToolUseInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    /** Bash 工具的命令行 */
    command?: string;
    /** Write/Edit 声称要写入的新内容(agent 主动给的,非读文件) */
    content?: string;
    new_string?: string;
    /** MultiEdit 的多段编辑(payload 形状与 Edit 不同:是数组) */
    edits?: Array<{ old_string?: string; new_string?: string }>;
    [k: string]: unknown;
  };
}

/** Claude Code PreToolUse 协议:hook 返回的结构化裁决。 */
export interface PreToolUseDecision {
  /** allow=放行跳过提示;ask=升级人工审批;deny=取消并把 reason 回喂 agent。 */
  permissionDecision: "allow" | "ask" | "deny";
  /** 给人/给 agent 看的理由(ask/deny 时必给)。 */
  permissionDecisionReason: string;
  /** 命中的规则名(审计/调试用)。 */
  matchedRules: string[];
}

/** 文件编辑类工具:看 file_path 跑路径规则。 */
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

/** 是不是 MCP 工具调用(Claude Code 里 MCP 工具名形如 mcp__server__tool)。 */
export function isMcpTool(toolName: string | undefined): boolean {
  return typeof toolName === "string" && toolName.startsWith("mcp__");
}

/**
 * 把三种编辑工具的 payload 形状归一化成 {addedLines, removedLines}:
 *   Write       → content(整文件新内容)
 *   Edit        → new_string / old_string(单段替换)
 *   MultiEdit   → edits[](多段 {old_string,new_string})
 * 一处归一化,既补上 MultiEdit 的内容检测(此前只看顶层 new_string → 经 MultiEdit
 * 写密钥被静默放行),也防下一个工具形状再引入同类漏洞。只读 agent 声明的入参,
 * 不读仓库文件 —— 隐私铁律不动。
 */
function extractEditContent(ti: PreToolUseInput["tool_input"]): { addedLines: string[]; removedLines: string[] } {
  const t = ti ?? {};
  const added: string[] = [];
  const removed: string[] = [];
  if (typeof t.new_string === "string") added.push(...t.new_string.split("\n"));
  else if (typeof t.content === "string") added.push(...t.content.split("\n"));
  if (typeof t.old_string === "string") removed.push(...(t.old_string as string).split("\n"));
  if (Array.isArray(t.edits)) {
    for (const e of t.edits) {
      if (e && typeof e.new_string === "string") added.push(...e.new_string.split("\n"));
      if (e && typeof e.old_string === "string") removed.push(...e.old_string.split("\n"));
    }
  }
  return { addedLines: added, removedLines: removed };
}

/**
 * 纯函数:给一次工具调用,返回该不该刹车。无副作用、无 IO,便于测试。
 * 不读任何仓库文件 —— 只看 agent 声明的 tool_input。
 */
export function evaluatePreTool(input: PreToolUseInput): PreToolUseDecision {
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};

  // 文件编辑类:用 file_path 跑路径规则 + agent 声明的新内容跑内容规则。
  // Edit/Write/MultiEdit 三种 payload 形状由 extractEditContent 归一化,命中 wake → ask。
  if (tool && FILE_EDIT_TOOLS.has(tool) && ti.file_path) {
    const { addedLines, removedLines } = extractEditContent(ti);
    const fc: FileChange = { path: ti.file_path, kind: "modified", addedLines, removedLines };
    return decide(runRules([fc]), `改动 ${ti.file_path}`);
  }

  // Bash 命令:文件守门挡不住 `echo SECRET >> .env`、`rm -rf`、`git push --force`、
  // `curl|sh` 这类绕过路径。只拦【几乎一定该让人看一眼】的少数模式(宁可漏不可烦),
  // 其余放行。只看 agent 声明的 command 字符串,不执行、不读文件。
  if (tool === "Bash" && typeof ti.command === "string") {
    const hit = dangerousBashRule(ti.command);
    if (hit) {
      return {
        permissionDecision: "ask",
        permissionDecisionReason: `agent-diff-guard:Bash 命令触发高危守门 —— ${hit}。请确认这是当前任务真正需要的操作。`,
        matchedRules: ["bash-danger"],
      };
    }
    return { permissionDecision: "allow", permissionDecisionReason: "", matchedRules: [] };
  }

  // MCP 工具调用:作为一等治理面纳入,但【本层一律放行】。诚实说明:PreToolUse 这层
  // 不写审计(allow 路径无副作用),MCP 调用的留痕由 PostToolUse / 面板侧负责。
  // 不夸大风险(研究否决了 MCP 风险量级的强声明)。
  if (isMcpTool(tool)) {
    return {
      permissionDecision: "allow",
      permissionDecisionReason: "",
      matchedRules: ["mcp-governance"],
    };
  }

  // 其它工具(Read / 未知):本版不拦,放行。
  return { permissionDecision: "allow", permissionDecisionReason: "", matchedRules: [] };
}

/**
 * Bash 危险命令模式 —— 只拦"几乎一定该让人看一眼"的少数(对齐宁可漏不可烦,误报近零)。
 *
 * 【诚实定位】这是抓【无意的 reckless 命令】的安全网,不是对抗性防线:一个【刻意】要
 * 绕过的 agent 总能用变量/子shell/长选项/换非 sh 解释器轻松规避(基于命令字符串的检测
 * 本质如此)。真正的内容防线在 Edit/Write/MultiEdit 的内容规则。这里覆盖常见标准写法 +
 * 几个低成本就能堵的变体,不假装拦得住所有变形。命中返回理由,否则 null。
 */
function dangerousBashRule(cmd: string): string | null {
  const c = cmd.trim();
  // 递归强制删除:短选项(rm -rf / -r -f)与长选项(--recursive --force,任意顺序)都覆盖。
  if (/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\b[^\n]*-f|-f\b[^\n]*-r)\b/i.test(c) ||
      (/\brm\b[^\n]*--recursive\b/i.test(c) && /\brm\b[^\n]*--force\b/i.test(c)))
    return "递归强制删除(rm -rf)—— 误删几乎不可撤回";
  // git 强推/历史改写
  if (/\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i.test(c))
    return "git 强制推送 —— 可能覆盖远端历史,影响他人";
  if (/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i.test(c))
    return "git 硬重置 / 强制清理 —— 会丢弃未提交改动";
  // 管道远程脚本到解释器:不止 sh/bash/zsh,也覆盖 python/node/perl/ruby。
  if (/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?|node|perl|ruby)\b/i.test(c))
    return "把远程脚本直接管道给解释器执行 —— 供应链/RCE 风险";
  // 往敏感文件写入(.env 及其 .env.* 变体 / 密钥 / authorized_keys),重定向或 tee 都算。
  if (/(>>?|tee\b)\s*[^\n|]*(\.env(\.[\w.-]+)?\b|\.ssh\/|authorized_keys|id_rsa|\.pem\b|credentials)/i.test(c))
    return "向密钥/凭据/.env 文件写入 —— 高概率涉及敏感配置";
  // chmod 全局可写:777 / 0777(前导 0) / a+w / o+w。
  if (/\bchmod\s+(-R\s+)?(0?777|a\+w|o\+w)\b/i.test(c))
    return "chmod 放开全局写权限 —— 安全风险";
  return null;
}

/** 把规则命中翻译成 allow/ask 裁决。 */
function decide(findings: Finding[], what: string): PreToolUseDecision {
  const wake = findings.filter((f) => f.severity === "wake-you-up");
  const matchedRules = findings.map((f) => f.rule);
  if (wake.length > 0) {
    const why = wake.map((f) => f.why).join(";");
    return {
      permissionDecision: "ask",
      permissionDecisionReason: `agent-diff-guard:${what} 触发高危守门 —— ${why}。请确认这是当前任务真正需要的改动。`,
      matchedRules,
    };
  }
  // look-once 或无命中:平时放行(只在面板里留痕,不打断)。
  return { permissionDecision: "allow", permissionDecisionReason: "", matchedRules };
}

/** 把裁决包装成 Claude Code PreToolUse 协议的 stdout JSON。 */
export function toHookOutput(d: PreToolUseDecision): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: d.permissionDecision,
      permissionDecisionReason: d.permissionDecisionReason,
    },
  });
}

/**
 * stdin handler:读 Claude Code 传入的 PreToolUse JSON,评估,把裁决写到 stdout。
 * 任何异常都【放行】(fail-open)—— 守门人自己崩了绝不能卡住开发者的 agent。
 */
export async function handlePreToolUse(): Promise<void> {
  let raw = "";
  try {
    for await (const chunk of Bun.stdin.stream()) raw += new TextDecoder().decode(chunk);
  } catch {
    return; // 读不到输入 → 放行
  }

  let input: PreToolUseInput;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // 解析失败 → 放行
  }

  // 显式 fail-open:评估/输出若抛错,放行(不靠 import.meta.main 的 .catch 兜底,
  // 那是"意外正确";守门人崩了绝不能误拦或卡死 agent)。
  try {
    const decision = evaluatePreTool(input);
    // 只在 ask/deny(真正要打断)时输出裁决;allow 时静默(不打断、不刷屏)。
    if (decision.permissionDecision !== "allow") {
      process.stdout.write(toHookOutput(decision));
    }
  } catch {
    return; // 评估异常 → 放行
  }
}

if (import.meta.main) {
  handlePreToolUse().catch(() => {});
}
