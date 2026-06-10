// context.ts — 把守门人的判断力"翻转"成编码前的输入端。
//
// 现有形态:agent 改完 → guard 检查(下游守门)。
// 这个模块做的是上游:在 agent 动手之前,给它一份"本仓库危险地图" ——
//   静态危险区(rules.ts 固化的 DevOps 判断)+ 本仓库历史命中(审计回流)。
// agent 把它读进 system prompt,就能"改之前避开雷",而不是"改完被刹"。
//
// 纯函数 + 渲染分离:buildDangerMap 只算数据,renderMarkdown/toJson 负责呈现。
// 这样既可测,又能同时服务 prompt 注入(markdown)与程序消费(json)。

import { SENSITIVE_PATH_RULES } from "./rules";
import type { GuardEvent } from "./event";

/** 一处静态危险区:来自 rules.ts 的固化判断,与扫描共用同一张表。 */
export interface DangerZone {
  rule: string;
  /** 人话:这类路径为什么危险 */
  why: string;
  /** 给 agent 看的、可读的路径形态描述(从正则反推的友好说明) */
  hint: string;
}

/** 本仓库历史上真实命中过的某条规则的统计。 */
export interface RepoHistoryRow {
  rule: string;
  /** 命中次数 */
  count: number;
  /** 其中 wake-you-up 级(被刹住)的次数 */
  wakeCount: number;
  /** 最近一次命中的日期 YYYY-MM-DD */
  lastSeen: string;
  /** 真实命中过的代表性路径(去重,最多几条),让 agent 知道具体在哪 */
  samplePaths: string[];
}

/** 完整的"本仓库危险地图"。 */
export interface DangerMap {
  repo: string | null;
  /** 静态危险区:无论历史如何,碰了就该确认的 */
  zones: DangerZone[];
  /** 本仓库历史命中:这个仓库实际踩过的雷,优先级更高 */
  history: RepoHistoryRow[];
  /** 参与统计的历史事件数(0 表示还没有审计数据) */
  eventsAnalyzed: number;
}

// 把规则正则翻译成 agent 看得懂的路径提示。
// 不试图通用反编译正则(脆),只为已知的几条规则配人话——清单短、可控。
const RULE_HINTS: Record<string, string> = {
  "ci-pipeline": ".github/workflows/ 下的 CI/CD 流水线",
  "container-build": "Dockerfile / docker-compose.yml",
  "iac-terraform": "*.tf / *.tfvars(Terraform)",
  "k8s-manifest": "k8s/ kubernetes/ manifests/ helm/ charts/ 部署清单",
  "env-file": ".env 及其变体",
  "dependency-manifest": "package.json / go.mod / Cargo.toml / requirements.txt 等依赖清单",
  "authz-surface": "路径含 auth/permission/rbac/policy/secret/credential",
};

/** 从固化规则表派生静态危险区(展示用,不含正则)。 */
export function staticZones(): DangerZone[] {
  return SENSITIVE_PATH_RULES.map((r) => ({
    rule: r.rule,
    why: r.why,
    hint: RULE_HINTS[r.rule] ?? "(见规则定义)",
  }));
}

/**
 * 从审计事件聚合出"本仓库历史命中"。
 * 只统计 repoRemote === repo 的事件(传 null 则统计全部,用于无 remote 的本地仓库)。
 * 注意:event 的隐私分区保证 findings[].path 是可记录的——路径可出区,内容永不出区。
 */
export function repoHistory(events: GuardEvent[], repo: string | null): RepoHistoryRow[] {
  const map = new Map<string, RepoHistoryRow & { _paths: Set<string> }>();
  for (const ev of events) {
    if (repo !== null && ev.repoRemote !== repo) continue;
    const date = ev.timestamp.slice(0, 10);
    for (const f of ev.findings) {
      let row = map.get(f.rule);
      if (!row) {
        row = { rule: f.rule, count: 0, wakeCount: 0, lastSeen: date, samplePaths: [], _paths: new Set() };
        map.set(f.rule, row);
      }
      row.count++;
      if (f.severity === "wake-you-up") row.wakeCount++;
      if (date > row.lastSeen) row.lastSeen = date;
      if (row._paths.size < 3) row._paths.add(f.path);
    }
  }
  return [...map.values()]
    .map(({ _paths, ...row }) => ({ ...row, samplePaths: [..._paths] }))
    .sort((a, b) => b.count - a.count);
}

export interface BuildDangerMapOpts {
  repo: string | null;
  events: GuardEvent[];
}

/** 组装完整危险地图。 */
export function buildDangerMap(o: BuildDangerMapOpts): DangerMap {
  const relevant = o.repo === null ? o.events : o.events.filter((e) => e.repoRemote === o.repo);
  return {
    repo: o.repo,
    zones: staticZones(),
    history: repoHistory(o.events, o.repo),
    eventsAnalyzed: relevant.length,
  };
}

/**
 * 渲染成 agent 可直接读进 system prompt 的 Markdown。
 * 措辞贴合产品哲学:这是"改之前的提醒",不是"禁止清单"——给理由,让 agent 自己判断。
 */
export function renderMarkdown(map: DangerMap): string {
  const lines: string[] = [];
  lines.push("# 本仓库改动守门约束(agent-diff-guard)");
  lines.push("");
  lines.push(
    "你正在对本仓库编码。以下是合并前会被守门人盯住的高危区。" +
      "动到这些地方**不是禁止**,但请在改动说明里讲清理由——否则合并前会被拎出来逼一次确认。"
  );
  lines.push("");

  lines.push("## 高危区(碰了几乎一定会被要求确认)");
  lines.push("");
  for (const z of map.zones) {
    lines.push(`- **${z.hint}** — ${z.why}`);
  }
  lines.push("");

  if (map.history.length > 0) {
    lines.push(`## 本仓库历史实际踩过的雷(基于 ${map.eventsAnalyzed} 次守门记录)`);
    lines.push("");
    lines.push("这些是这个仓库真实命中过的——优先级高于上面的通用清单,说明本仓库在此处尤其容易出事:");
    lines.push("");
    for (const h of map.history) {
      const sample = h.samplePaths.length > 0 ? ` (如 ${h.samplePaths.join(", ")})` : "";
      const wake = h.wakeCount > 0 ? `,其中 ${h.wakeCount} 次被刹住` : "";
      lines.push(`- \`${h.rule}\` — 命中 ${h.count} 次${wake},最近 ${h.lastSeen}${sample}`);
    }
    lines.push("");
  } else {
    lines.push("## 本仓库历史");
    lines.push("");
    lines.push("_暂无守门记录(这是本仓库第一次,或还没跑过 `agent-diff-guard check`)。上面的通用高危区仍然适用。_");
    lines.push("");
  }

  lines.push("## 自检");
  lines.push("");
  lines.push("- 我这次改动有没有触到上面的高危区?如果有,改动说明里讲清理由了吗?");
  lines.push("- 有没有为了让测试/CI 变绿而删测试或放宽断言?");
  lines.push("- 有没有顺手改了和当前任务无关的文件?");
  lines.push("");
  return lines.join("\n");
}

/** 渲染成 JSON(给程序消费,如 MCP server / CI)。 */
export function toJson(map: DangerMap): string {
  return JSON.stringify(map, null, 2);
}
