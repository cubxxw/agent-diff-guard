// id.ts — 事件 ID 生成(ULID,零依赖)。
//
// ULID = 48-bit 毫秒时间戳 + 80-bit 随机,Crockford Base32 编码成 26 字符。
// 选它而非 UUID:天然按时间有序,字符串比较即时间比较 —— 上报游标(reporter)
// 可以直接用 `id > lastReportedId` 判断"哪些是新事件",无需额外时间字段。

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32(无 I L O U)
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10; // 编码 48-bit 时间戳需要 10 个 base32 字符
const RANDOM_LEN = 16; // 80-bit 随机需要 16 个

function encodeTime(now: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = now % ENCODING_LEN;
    out = ENCODING[mod] + out;
    now = (now - mod) / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    // 取每个随机字节落到 base32 字母表(轻微偏置可接受:仅用于去重,非密码学用途)
    out += ENCODING[bytes[i]! % ENCODING_LEN];
  }
  return out;
}

/** 生成一个 26 字符、按时间有序的 ULID。`nowMs` 可注入用于测试。 */
export function generateUlid(nowMs: number = Date.now()): string {
  return encodeTime(nowMs) + encodeRandom();
}
