// stats.ts — 把事件流聚合成面板要的几个视图(纯函数,可测试)。
//
// 面板服务的是 tech lead / 合规的"周期性审计",不是个人实时盯屏。
// 所以这里全是"过去 N 天的汇总趋势",不是"此刻状态"。每个聚合回答一个管理问题:
//   ruleRank   —— 我们的 agent 最常碰哪类危险区?
//   timeline   —— 风险水位在升还是降?哪天异常爆发?
//   dispositions—— 每条 wake-you-up 最终被拦了还是被放行了?(合规审计流)

import type { GuardEvent } from "./event";

export interface RuleRankRow {
  rule: string;
  count: number;
  wakeCount: number;
}

export interface TimelineRow {
  date: string; // YYYY-MM-DD
  wakeCount: number;
  lookCount: number;
  passCount: number; // disposition === auto-pass 的事件数
  eventCount: number; // 当天实际扫描次数(= 事件数)。tooltip 用它,不要 wake+look+pass 混加(单位不同)
}

export interface DispositionRow {
  id: string;
  timestamp: string;
  repoAlias: string | null;
  gitRange: string;
  wakeCount: number;
  rulesTriggered: string[];
  disposition: GuardEvent["disposition"];
  // 下钻用:仓库与每条命中的元数据(隐私铁律:无 diff/task 正文,只有路径与 why 摘要)
  repoRemote: string | null;
  taskDescLen: number | null;
  totalFilesChanged: number;
  lookCount: number;
  findings: { rule: string; severity: GuardEvent["findings"][number]["severity"]; path: string; whySummary: string }[];
}

/** 高发规则排行:按 rule 命中次数降序。 */
export function ruleRank(events: GuardEvent[]): RuleRankRow[] {
  const map = new Map<string, RuleRankRow>();
  for (const ev of events) {
    for (const f of ev.findings) {
      const row = map.get(f.rule) ?? { rule: f.rule, count: 0, wakeCount: 0 };
      row.count++;
      if (f.severity === "wake-you-up") row.wakeCount++;
      map.set(f.rule, row);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 时间趋势:按天聚合 wake/look/pass 数,日期升序。 */
export function timeline(events: GuardEvent[]): TimelineRow[] {
  const map = new Map<string, TimelineRow>();
  for (const ev of events) {
    const date = ev.timestamp.slice(0, 10); // YYYY-MM-DD
    const row = map.get(date) ?? { date, wakeCount: 0, lookCount: 0, passCount: 0, eventCount: 0 };
    row.wakeCount += ev.summary.wakeCount;
    row.lookCount += ev.summary.lookCount;
    row.eventCount++; // 每个事件 = 一次扫描
    if (ev.disposition === "auto-pass") row.passCount++;
    map.set(date, row);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 放行审计流:最近 limit 条事件,时间倒序。 */
export function dispositions(events: GuardEvent[], limit = 200): DispositionRow[] {
  return [...events]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((ev) => ({
      id: ev.id,
      timestamp: ev.timestamp,
      repoAlias: ev.repoAlias,
      gitRange: ev.gitRange,
      wakeCount: ev.summary.wakeCount,
      rulesTriggered: ev.summary.rulesTriggered,
      disposition: ev.disposition,
      repoRemote: ev.repoRemote,
      taskDescLen: ev.taskDescLen,
      totalFilesChanged: ev.summary.totalFilesChanged,
      lookCount: ev.summary.lookCount,
      findings: ev.findings.map((f) => ({ rule: f.rule, severity: f.severity, path: f.path, whySummary: f.whySummary })),
    }));
}

/** 顶部概览卡片用的总量统计。 */
export function overview(events: GuardEvent[]): {
  totalScans: number;
  totalWake: number;
  totalBlocked: number;
  passRate: number; // auto-pass 占比,0-1
} {
  const totalScans = events.length;
  const totalWake = events.reduce((s, e) => s + e.summary.wakeCount, 0);
  const totalBlocked = events.filter((e) => e.disposition === "blocked").length;
  const passed = events.filter((e) => e.disposition === "auto-pass").length;
  return {
    totalScans,
    totalWake,
    totalBlocked,
    passRate: totalScans === 0 ? 1 : passed / totalScans,
  };
}
