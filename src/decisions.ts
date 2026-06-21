// decisions.ts — 人工裁决理由的本地落盘与读取(守门记录证据链)。
//
// 为什么要这个文件:审批理由(放行/驳回/误报的"为什么")原本只活在前端 localStorage,
// 换台机器、清缓存就丢 —— 没法当审计证据。这里把理由落成本机 JSONL,和 events.jsonl
// 同一气质(本机、可读、可审计、坏一行不拖垮其余)。
//
// 隐私铁律延续:只存"裁决元数据"(命中 id / 处置 / 理由文字 / 时间),不碰 diff 正文。
// 理由是人主动写下的留痕文字,不是代码 —— 与铁律不冲突。
//
// 落盘:追加写入 ~/.agent-diff-guard/decisions.jsonl(每行一条 DecisionRecord)。

import { join } from "node:path";
import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { logDir } from "./logger";

/** 人工对某条命中的裁决类型(与前端 DECISION_LABEL 对齐) */
export type DecisionKind = "approved" | "rejected" | "fp";

/** 一条人工裁决记录(落盘 + 面板回显的共同结构) */
export interface DecisionRecord {
  /** 关联的命中/事件 id(前端队列项或审计行的 id) */
  targetId: string;
  /** 处置:放行 / 驳回 / 误报 */
  disposition: DecisionKind;
  /** 人工写下的理由(留痕文字,非代码) */
  reason: string;
  /** 裁决时间 ISO 8601 */
  timestamp: string;
}

/** 裁决日志文件路径 */
export function decisionsPath(): string {
  return join(logDir(), "decisions.jsonl");
}

const REASON_MAX = 500; // 理由文字上限,防止异常长输入撑爆日志

const VALID_KINDS: readonly DecisionKind[] = ["approved", "rejected", "fp"];

/** disposition 是否合法 */
export function isDecisionKind(x: unknown): x is DecisionKind {
  return typeof x === "string" && VALID_KINDS.includes(x as DecisionKind);
}

/**
 * 追加一条裁决到 decisions.jsonl。
 * 同步实现,try/catch 兜底:写失败只 warn,绝不抛出(观测不是主流程)。
 * nowMs 可注入用于测试(延续项目里时间可注入的约定)。
 */
export function appendDecision(
  o: { targetId: string; disposition: DecisionKind; reason?: string; nowMs?: number }
): DecisionRecord {
  const nowMs = o.nowMs ?? Date.now();
  const record: DecisionRecord = {
    targetId: o.targetId,
    disposition: o.disposition,
    reason: (o.reason ?? "").slice(0, REASON_MAX),
    timestamp: new Date(nowMs).toISOString(),
  };
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(decisionsPath(), JSON.stringify(record) + "\n", "utf8");
  } catch (e) {
    console.warn("[adg] 裁决日志写入失败(不影响面板):", (e as Error).message);
  }
  return record;
}

/**
 * 读回所有裁决记录。坏行跳过。
 * 同一 targetId 可能有多条(改主意了)——返回全部,顺序即写入顺序(时间升序)。
 */
export function readDecisions(): DecisionRecord[] {
  const path = decisionsPath();
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    console.warn("[adg] 读取裁决日志失败:", (e as Error).message);
    return [];
  }
  const out: DecisionRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DecisionRecord);
    } catch {
      // 坏行/半写跳过
    }
  }
  return out;
}

/**
 * 聚合成 { targetId → 最新一条裁决 } 的 map,给面板按 id 直接查最终裁决。
 * 同一 id 多条时,后写的覆盖先写的(最后的决定算数)。
 */
export function latestDecisionsById(): Record<string, DecisionRecord> {
  const map: Record<string, DecisionRecord> = {};
  for (const d of readDecisions()) {
    map[d.targetId] = d; // 顺序即时间,后者覆盖
  }
  return map;
}
