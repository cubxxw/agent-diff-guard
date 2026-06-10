// daily-cache.ts — daily 消息记录的增量磁盘缓存(薄封装,复用 file-cache 底座)。
//
// 同 sessions-cache 的思路:按文件指纹增量,只重解析当天动过的文件。
// 区别只在单文件解析器产出 MsgRecord[](每文件多条),而非单个聚合对象。

import { incrementalByFile } from "./file-cache";
import { parseRecordsFile, type MsgRecord } from "./daily";

/**
 * 增量读取所有消息记录,语义等价于 daily.allRecords(),但通常快几个数量级。
 * sinceMs:可选,只保留 ts >= sinceMs 的记录(面板只看近 N 天时省内存与传输)。
 * 注意 since 过滤在合并后做 —— 缓存里始终存全量,避免不同 since 互相污染缓存。
 */
export function cachedAllRecords(sinceMs?: number): MsgRecord[] {
  const perFile = incrementalByFile<MsgRecord[]>("daily-cache", (filePath, project) =>
    parseRecordsFile(filePath, project)
  );
  const out: MsgRecord[] = [];
  for (const recs of perFile) {
    for (const r of recs) {
      if (sinceMs === undefined || r.ts >= sinceMs) out.push(r);
    }
  }
  return out;
}
