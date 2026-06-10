// file-cache.ts — 按文件指纹的通用增量磁盘缓存。
//
// 动机:~/.claude/projects 可能堆到几 GB、上千个 jsonl,全量重解析要分钟级,
// 面板每次刷新都重扫会卡死单线程事件循环。但一个 session 的 jsonl 一旦不再被写,
// 内容就不会变 —— 按 (mtimeMs, size) 做指纹,指纹没变就直接复用上次的解析结果,
// 每次只重解析当天动过的那几个文件。
//
// 这是 sessions 与 daily 共用的底座:两者都遍历同一批文件、只是"单文件解析"不同。
// 泛型 incrementalByFile 吃一个 parse(filePath, project, fileName) => T,各自传入自己的解析器。
// 缓存按 cacheName 分文件存(sessions-cache.json / daily-cache.json),互不干扰。

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { logDir } from "./logger";

/** Claude Code 项目日志根目录(sessions/daily 共用同一遍历起点)。 */
export function projectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/** 目录名 "-Users-foo-bar" → 路径 "/Users/foo/bar"(尽力还原,仅用于显示)。 */
export function decodeProject(dirName: string): string {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

// 版本 3:transcript 的 TaskTurn 新增 cwd 字段,撞版本让旧 transcript 缓存失效重建。
// (版本 2:从早期 sessions-cache 的 {session} 键迁移到统一的 {value} 键。)
const CACHE_VERSION = 3;
interface CacheEntry<T> {
  mtimeMs: number;
  size: number;
  value: T; // 该文件的解析结果(任意形状:单个 session,或一组 MsgRecord)
}
type CacheMap<T> = Record<string, CacheEntry<T>>; // key = 文件绝对路径
interface CacheFile<T> {
  version: number;
  entries: CacheMap<T>;
}

function cachePath(cacheName: string): string {
  return join(logDir(), `${cacheName}.json`);
}

/** 读磁盘缓存。任何问题(不存在/坏/版本不符)都返回空 map → 退化为全量重建。 */
function loadCache<T>(cacheName: string): CacheMap<T> {
  const p = cachePath(cacheName);
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as CacheFile<T>;
    if (data.version !== CACHE_VERSION || typeof data.entries !== "object") return {};
    return data.entries ?? {};
  } catch {
    return {};
  }
}

/** 写磁盘缓存。失败只 warn,绝不抛出影响面板。 */
function saveCache<T>(cacheName: string, entries: CacheMap<T>): void {
  try {
    mkdirSync(logDir(), { recursive: true });
    writeFileSync(cachePath(cacheName), JSON.stringify({ version: CACHE_VERSION, entries }), "utf8");
  } catch (e) {
    console.warn(`[adg] ${cacheName} 缓存写入失败(不影响结果):`, (e as Error).message);
  }
}

/**
 * 遍历 projectsDir 下所有 *.jsonl,对每个文件:指纹未变 → 复用缓存的 value;
 * 否则调 parse 重解析。返回每个文件 value 组成的数组(顺序按遍历序)。
 *
 * @param cacheName  缓存文件名(不含扩展名),不同消费者用不同名字隔离
 * @param parse      单文件解析器:(绝对路径, 解码后项目名, 文件名去扩展) => 该文件的结果
 */
export function incrementalByFile<T>(
  cacheName: string,
  parse: (filePath: string, project: string, fileName: string) => T
): T[] {
  const root = projectsDir();
  if (!existsSync(root)) return [];

  const oldCache = loadCache<T>(cacheName);
  const newCache: CacheMap<T> = {};
  const out: T[] = [];

  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }

  let reparsed = 0;
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    const project = decodeProject(dir);
    for (const f of files) {
      const filePath = join(dirPath, f);
      let mtimeMs = 0;
      let size = 0;
      try {
        const st = statSync(filePath);
        mtimeMs = st.mtimeMs;
        size = st.size;
      } catch {
        continue; // 文件刚被删等竞态,跳过
      }

      const hit = oldCache[filePath];
      let entry: CacheEntry<T>;
      // 命中条件:指纹一致 且 value 字段存在。后者防旧版/异格式缓存被静默复用为 undefined
      // (CACHE_VERSION 之外的二道防线 —— 字段重命名时也能自愈)。
      if (hit && hit.mtimeMs === mtimeMs && hit.size === size && "value" in hit) {
        entry = hit; // 复用,不读文件内容
      } else {
        entry = { mtimeMs, size, value: parse(filePath, project, f.replace(/\.jsonl$/, "")) };
        reparsed++;
      }
      newCache[filePath] = entry;
      out.push(entry.value);
    }
  }

  // 有变动(重解析过 或 文件数变了 → 含删除)才回写,全命中时省一次写盘。
  if (reparsed > 0 || Object.keys(oldCache).length !== Object.keys(newCache).length) {
    saveCache(cacheName, newCache);
  }
  return out;
}
