// sessions-cache.ts — session 解析的增量磁盘缓存(薄封装,复用 file-cache 底座)。
//
// 全量扫 ~/.claude/projects 要分钟级;按文件指纹增量后,首跑后每次只算当天动过的文件,
// 实测 208s → 0.08s。底层遍历/指纹/读写都在 file-cache.ts,这里只接上 sessions 的解析器。

import { incrementalByFile } from "./file-cache";
import { parseSession, type SessionUsage } from "./sessions";

/**
 * 增量读取所有 session,语义等价于 sessions.allSessions(),但通常快几个数量级。
 * 每个文件解析出 SessionUsage|null;过滤掉无有效 usage 的(null 或全 0)。
 */
export function cachedAllSessions(): SessionUsage[] {
  const perFile = incrementalByFile<SessionUsage | null>("sessions-cache", (filePath, project, sessionId) =>
    parseSession(filePath, project, sessionId)
  );
  return perFile.filter(
    (s): s is SessionUsage => !!s && (s.inputTokens > 0 || s.outputTokens > 0 || s.messageCount > 0)
  );
}
