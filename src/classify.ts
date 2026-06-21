// classify.ts — run daemon 的安全保险丝:一条指令该自动执行还是拦成待批。
//
// 策略(产品定案):默认自动跑,只拦黑名单。吞吐优先。
// 但黑名单做厚、走模式匹配,并配合 runner 的「新命令影子告警」(见 runner.ts):
// 黑名单永远追不全,所以可观测性来补 —— 漏网的也要在事后能看见、能追。
//
// 纯函数、无副作用、无 IO。这样安全核心可被穷举单测,且行为可复现。

export type Kind = "shell" | "agent";
export type Verdict = "auto" | "blocked";

export interface ClassifyResult {
  verdict: Verdict;
  /** blocked 时给出人类可读的拦截理由(留痕用);auto 时为空 */
  reason: string;
}

// ── 破坏性模式黑名单 ──
// 每条 = [正则, 理由]。命中任意一条即 blocked。
// 只匹配「不可逆/能毁东西」的模式,不求全 —— 求不漏掉已知的致命操作。
const DANGER: Array<[RegExp, string]> = [
  // 删除类
  [/(^|[\s;&|])rm(\s|$)/, "rm 删除文件,不可逆"],
  [/-r[a-z]*f|-f[a-z]*r|--force\b|\s-f(\s|$)/, "带强制/递归删除标志(-rf/-f/--force)"],
  [/\bfind\b[^|]*-delete\b/, "find -delete 批量删除"],
  [/\btruncate\b/, "truncate 清空文件内容"],
  // git 不可逆操作
  [/git\s+reset\s+--hard/, "git reset --hard 丢弃提交与工作区"],
  [/git\s+push\s+.*(--force|-f)\b/, "git push --force 覆盖远端历史"],
  [/git\s+checkout\s+.*--\s/, "git checkout -- 丢弃工作区改动"],
  [/git\s+restore\b/, "git restore 丢弃改动"],
  [/git\s+clean\s+.*-[a-z]*f/, "git clean -f 删除未跟踪文件"],
  // 覆盖重定向(单 > 覆盖;>> 追加是安全的,故排除)
  [/[^>]>(?!>)\s*\S/, "> 覆盖重定向会清掉目标文件原内容"],
  // 提权 / 远程执行
  [/(^|[\s;&|])sudo(\s|$)/, "sudo 提权"],
  [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/, "curl/wget 管道直接执行远程脚本"],
  // 磁盘 / 权限 / 系统级
  [/(^|[\s;&|])dd(\s|$)/, "dd 直写设备,可毁数据"],
  [/\bmkfs\b/, "mkfs 格式化"],
  [/chmod\s+-R\b/, "chmod -R 递归改权限"],
  [/chown\s+-R\b/, "chown -R 递归改属主"],
  // fork 炸弹
  [/:\(\)\s*\{.*\|.*&.*\}/, "疑似 fork 炸弹"],
  [/>\s*\/dev\/sd|of=\/dev\//, "写裸设备"],
];

/**
 * 推断一条 action 是 shell 命令还是该交给 agent(claude)。
 * 显式 kind 永远优先。否则启发式:以常见命令名 / cd / ./ 开头 → shell,其余 → agent。
 */
export function detectKind(action: string, kind?: Kind): Kind {
  if (kind) return kind;
  // String(...) 防御:坏 inbox 文件可能把 action 写成 number/array/object,
  // (action || "").trim() 对非字符串会抛 TypeError、掀翻 daemon。强转兜底。
  const s = String(action ?? "").trim();
  if (!s) return "agent";
  // 以 shell 命令样式开头:命令名 + 空格/结尾,或 cd/./ 前缀
  const SHELL_HEAD = /^(cd|ls|cat|git|npm|bun|node|pnpm|yarn|grep|rg|find|echo|mkdir|cp|mv|rm|chmod|chown|curl|wget|dd|sudo|sh|bash|zsh|make|docker|kubectl)(\s|$)/;
  if (SHELL_HEAD.test(s)) return "shell";
  if (/^\.?\//.test(s)) return "shell"; // ./script 或 /abs/path
  return "agent";
}

/**
 * 安全分级。verdict=auto 可自动执行;blocked 需人工放行。
 *
 * 检查顺序(安全优先):
 *  1. 空指令 → blocked(不确定就别跑)。
 *  2. 黑名单无条件先扫 —— 不管被判 shell 还是 agent,只要文本里出现破坏性
 *     模式(rm -rf / fork 炸弹 / mkfs / 嵌在自然语言里的 rm…)一律 blocked。
 *     这一步先于 kind 路由,堵住「危险命令不以白名单命令名开头就绕过黑名单」的漏洞。
 *  3. 余下:agent 类默认 auto(交给 claude);shell 类也 auto(已过黑名单)。
 */
// 第二参数保留 kind 入口以备将来按 kind 细分策略;当前黑名单先行、不依赖它,故下划线标记。
export function classify(action: string, _opts: { kind?: Kind } = {}): ClassifyResult {
  const s = String(action ?? "").trim(); // 防御非字符串 action(见 detectKind 注释)
  if (!s) return { verdict: "blocked", reason: "空指令" };

  for (const [re, reason] of DANGER) {
    if (re.test(s)) return { verdict: "blocked", reason };
  }
  return { verdict: "auto", reason: "" };
}
