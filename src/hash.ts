// hash.ts — SHA-256 前缀工具(零依赖)。
//
// 用途:把"会标识个人/任务"的敏感原文(git email、task 描述)转成不可逆的短 hash,
// 既能在面板里按人/按任务聚合统计,又绝不泄露原文。这是隐私红线的技术落点:
// 上报的是 sha256(email) 的前 16 位,不是 email 本身。

/** 计算 input 的 SHA-256,返回十六进制的前 len 个字符(默认 16)。 */
export async function sha256prefix(input: string, len = 16): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, len);
}
