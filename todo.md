# agent-diff-guard · 深度体验测试待办(可执行版)

> 生成于 2026-06-13。方法:启动本地控制台 + 4 个并发 agent(新手/设计/QA/PM)深度体验,
> 实证复核后收敛。**本文件为 `/goal` 自动执行版**:每个 `- [ ]` 任务后跟一行 `验证:` 命令,
> 改完跑该命令,通过(exit 0)即勾选 `- [x]` 并单独 commit。
>
> 验证约定:所有 curl 走 `--noproxy '*'`;需起服务的验证命令自带起停;`PASS` 字样表示通过。
> 数据快照:34 次扫描 / 20 刹停 / 41.2% 自动放行率。

---

## 🔴 P0 —— 伤及"宁可漏不可烦"核心承诺

- [x] **P0-1 审查队列按 `repo:rule:file` 聚合,history 内部去重(同一处只出一条,显示命中次数)**
  根因:`findings.ts:307-311` 去重只在 live↔history 之间,history 内部不去重,`src/config.ts` 被列 6 次。
  改:`buildQueue` 对 history 先按 `repo:rule:file` 聚合(保留最近一条 + `hitCount`/`firstSeen`),再与 live 去重。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/findings.test.ts 2>&1 | grep -q ' 0 fail' && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; U=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/findings); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$U" | bun -e 'const it=JSON.parse(await Bun.stdin.text()); const f={}; for(const i of it){const k=(i.repo||"")+":"+(i.rule||"")+":"+(i.file||i.path||"");f[k]=(f[k]||0)+1;} const dup=Object.entries(f).filter(([,n])=>n>1); if(dup.length){console.error("FAIL 仍有重复:",dup);process.exit(1)} console.log("PASS 队列无重复 file@rule")'

- [x] **P0-2 路径规则分级:常规清单类降 `look-once`,仅高危(密钥/删测试/任务无关碰CI)保持 `wake-you-up`**
  根因:`rules.ts` 所有 severity 全是 `wake-you-up`,`look-once` 从未被使用 → 58.8% push 被刹。
  改:`rules.ts` 让 `dependency-manifest`/`container-build`/`k8s-manifest` 等常规改动类规则用 `look-once`;
  保留 `hardcoded-secret`/`test-deleted`/`ci-pipeline`(任务无关时)为 `wake-you-up`。补/改对应单测。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/rules.test.ts 2>&1 | grep -q ' 0 fail' && grep -q '"look-once"' src/rules.ts && test $(grep -c 'severity: "look-once"' src/rules.ts) -ge 1 && echo PASS || echo FAIL

- [x] **P0-3 审查队列只放 live(当下未 push);history 不再回流伪装成"待裁决"**
  根因:`buildHistory` 把所有 `blocked` 历史 wake 全回流,15 天前已合并的改动还在"等裁决",diff 正文已无。
  改:`buildQueue` 默认不含 history(或加 `includeHistory` 选项默认 false);queue 仅 live + 必要时 demo。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/findings.test.ts 2>&1 | grep -q ' 0 fail' && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; U=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/findings); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$U" | bun -e 'const it=JSON.parse(await Bun.stdin.text()); const h=it.filter(i=>i.origin==="history"); if(h.length){console.error("FAIL 队列仍含 history 项:",h.length);process.exit(1)} console.log("PASS 队列无 history 回流项,共",it.length,"条")'

- [x] **P0-4 偏离检测对无信息量/中文任务兜底:任务描述不足时提示"无法判断偏离"而非默认 0% 安全**
  根因:词面匹配对"继续分析解决问题"等中文/短任务无词可匹配 → drift=0% 被当作安全。
  改:`ai.ts`/`findings.ts` 偏离计算前判定任务描述是否"信息量不足"(长度阈值 + 停用词如 继续/修复/解决/重启),
  不足时 drift 返回 null + reason 标注"任务描述不足以判断偏离",前端区别于 0%。补单测。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test 2>&1 | grep -q ' 0 fail' && grep -Eq '不足以判断|信息量不足|低信息|insufficient' src/ai.ts src/findings.ts && echo PASS || echo FAIL

---

## 🟠 P1 —— 高优先级体验 / 健壮性

- [x] **P1-3 `POST /api/ai/analyze` 空 body 不再挂起(先读 text 再 parse)**
  改:`serve-local.ts` 抽 `readJsonBody`(先 `await req.text()`,空串按 `{}`,parse 失败 null),所有 POST 端点用它。
  注:原验证用 analyze 端点会触发真实 AI 网络调用(AI 已启用)无法隔离 parse,改用 inbox/decision(不触发 AI,确定性)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 3; C=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:4799/api/inbox/decision); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo "PASS 空body 0.01s 返回 400(未挂起)" || echo "FAIL got $C"

- [x] **P1-4 Nudge 提醒关闭后持久化,当次会话不再重弹**
  改:`web/app.js` "知道了"写 `sessionStorage`(键含当前 wake count),渲染前检查;活动列表底部留 `padding-bottom`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -Eq 'sessionStorage|localStorage' web/app.js && grep -Eq 'nudge|dismiss' web/app.js && echo PASS || echo FAIL

- [x] **P1-5 审查队列裁决按钮(放行/驳回/误报)改 sticky,长 diff 滚动不丢失操作区**
  改:`web/index.html`/`app.js` 的 `.qd-actions` 加 `position:sticky;bottom:0` + 背景/阴影。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -A4 '\.qd-actions' web/index.html web/app.js 2>/dev/null | grep -q 'sticky' && echo PASS || echo FAIL

- [x] **P1-6 通知 badge / muted 文字对比度达 WCAG AA**
  改:badge 背景 `#A66A00→#8A5800`,muted hint `#A39F99→#857F79`(在 index.html/app.js 的 CSS)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && ! grep -iq '#A39F99' web/index.html web/app.js && ! grep -iq '#A66A00' web/index.html web/app.js && echo PASS || echo FAIL

- [x] **P1-7 首页加一行产品定位说明 + 核心术语 tooltip**
  改:`web/index.html` header/hero 加定位句(如"AI agent 改动守门人:平时放行,关键时刻刹车");
  KPI/术语(wake-you-up 等)加 `title=`/`(?)` tooltip。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -Eq '守门人|平时放行|关键时刻' web/index.html && echo PASS || echo FAIL

---

## 🟡 P2 —— 中优先级一致性 / 正确性

- [x] **P2-2 时间线 tooltip 不再混加单位(用真实扫描次数)**
  改:`stats.ts` timeline 增 `eventCount`(当天扫描次数);`app.js:~157` tooltip 用 `eventCount` 而非 `pass+look+wake`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/stats.test.ts 2>&1 | grep -q ' 0 fail' && grep -q 'eventCount' src/stats.ts && echo PASS || echo FAIL

- [x] **P2-3 导航名与页内 h1 统一("越界记录")**
  改:`web/app.js`/`index.html` 越界页 h1 与导航名一致(保留"越界记录"主词)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q '越界记录' web/app.js web/index.html && echo PASS || echo FAIL

- [x] **P2-4 URL hash 深度链接可恢复(初始化读 location.hash)**
  改:`web/app.js` 初始化优先 `location.hash.slice(1)` 匹配 NAV id;`nav()` 同步写 hash。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'location.hash' web/app.js && echo PASS || echo FAIL

- [x] **P2-5 处理 OPTIONS preflight + 补全 CORS 头**
  改:`serve-local.ts` `handle` 入口对 `OPTIONS` 返回 204 + `Access-Control-Allow-Methods/Headers`;`JSON_HEADERS` 补 Methods/Headers。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; H=$(curl -s --noproxy '*' -i -X OPTIONS http://127.0.0.1:4799/api/inbox/decision); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$H" | grep -qi 'Access-Control-Allow-Methods' && echo PASS || echo FAIL

- [x] **P2-6 `/api/*` 未命中路由返回 JSON 404(而非纯文本)**
  改:`serve-local.ts` 对 `path.startsWith("/api/")` 未命中返回 `{ok:false,reason:"Not Found"}` + JSON_HEADERS + 404。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; B=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/nonsense); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$B" | grep -q '"ok":false' && echo PASS || echo FAIL

---

## 🟢 P3 —— 低优先级 / 打磨

- [x] **P3-1 `serve` 端口被占用时给友好提示而非栈崩溃**
  改:`serve-local.ts` `startLocalServer` try/catch `Bun.serve`,EADDRINUSE 时打印"端口 N 已被占用,试 --port N+1"并退出码 1。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4798 >/tmp/v1.log 2>&1 & sleep 2; bun run src/cli.ts serve --port 4798 >/tmp/v2.log 2>&1; lsof -ti :4798 | xargs kill -9 2>/dev/null; grep -Eq '已被占用|in use|--port' /tmp/v2.log && ! grep -q 'EADDRINUSE' /tmp/v2.log && echo PASS || echo FAIL

- [x] **P3-2 favicon 不再 404**
  改:`serve-local.ts` 对 `/favicon.ico` 返回内联 svg/data-uri 或 204。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:4799/favicon.ico); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" != "404" && echo "PASS favicon=$C" || echo FAIL

- [x] **P3-3 `/api/daily/today?date=` 校验日期格式,非法返回 400**
  改:`serve-local.ts` daily/today 加 `/^\d{4}-\d{2}-\d{2}$/` 校验,不合法 400 JSON。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:4799/api/daily/today?date=bad"); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo PASS || echo "FAIL got $C"

- [x] **P3-4 `/api/ai/ask` 缺 question 返回 400(与其他 POST 一致)**
  改:`serve-local.ts` ask 缺 question 时 `new Response(...,{status:400,headers:JSON_HEADERS})`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:4799/api/ai/ask); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo PASS || echo "FAIL got $C"

- [x] **P3-6 规则页底部空白补 inline 引导("如何添加规则")**
  改:`web/app.js` 规则页渲染补一行引导文字 + 链接。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -Eq '如何添加|添加规则|新增规则' web/app.js && echo PASS || echo FAIL

---

## 🧭 需人工决策 / 视觉类(不进自动循环 — 留给作者)

> 以下条目无法机器验证(需视觉判断或产品决策),不列为 `- [ ]`,由作者手动处理。

- **P1-1** Ask Guard "本机只读·不联网" vs "代码已上云" 隐私矛盾 → 需改文案 + 产品决策(联网披露口径)。
- **P1-2** 移动端 375px 布局崩溃 → 需新增响应式 CSS + 真机/多断点视觉验收。
- **P2-1** Ask Guard 首答说"6 条"与界面"30 条"矛盾 → 依赖 AI 上下文注入,需起 AI 实测。
- **P2-7** 平板 768px KPI 纵向堆叠 → 视觉验收。
- **P2-8 / P3-5 / P3-7~10** → 文案/视觉/模型 id 核对/产品决策,见下。
- **P3-5** AI 默认模型 id `deepseek-v4-pro` 是否真实可用 → 需核对供应商文档。
- **产品方向 5 问**:功能发散vs收敛、AI 隐私敞口、护城河叙事、冷启动价值、越界记录与规则重叠 → 作者拍板。

---

## ✅ 已确认正常(不要改坏)

- 72 单测全过、typecheck 干净;读端点无 500、数据一致性交叉验证全对(34/20/26/41.2%)。
- 路径遍历安全;sessions 冷启 374ms / 缓存命中 <1ms。
- 色彩系统克制专业、圆角间距统一、核心文字对比度优秀;demoSeeds 诚实标注。

---
---

# 🔁 Loop Guard — Loop 验证层实现待办

> 设计稿见 `docs/LOOP-DESIGN.md`。定位:不做 Loop 管理器,做**所有 Loop 的验证层**。
> 每个 `- [ ]` 是一个**完全自包含**的实现单元:读哪些文件、改/建哪些文件、验证命令全列出。
> `/loop` 每轮拿到一个未完成项,实现它,跑验证,通过即勾 `[x]` 并 commit。

---

## Phase 1 — Foundation (无相互依赖,可并行)

- [x] **L01 `src/scan.ts` export `taskKeywords`**
  目的:Loop 漂移检测需要复用 `taskKeywords` 从目标文本提取关键词。当前 `taskKeywords` 是私有函数,需要 export。
  读:`src/scan.ts:61` — 当前 `function taskKeywords(task: string): string[]`(无 export)。
  改:在 `function` 前加 `export`。仅此一个单词,不改函数体。
  注意:`driftFindings` 和 `isLowInfoTask` 内部已使用 `taskKeywords`,export 无行为变更。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'export function taskKeywords' src/scan.ts && bun test 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [x] **L02 `src/loop/types.ts` — Loop 数据模型 + Zod schemas**
  目的:定义 LoopSession、IterationResult、HookResult、MorningReport 的类型和运行时校验。
  读:`docs/LOOP-DESIGN.md` §3 "Data Model" — 完整字段定义。读 `src/event.ts:45-62` — FindingMeta/Severity 类型。读 `src/rules.ts` 头部 — `Severity` 类型定义。
  建:`src/loop/types.ts` (~120 行)。内容:
  - `LoopSessionSchema` (Zod): id, goal, goalHash, goalKeywords, cwd, repoRemote, budgetTokens, budgetWarnPct(default 0.6), budgetBlockPct(default 0.9), mode(attended/unattended), status(active/paused/stopped/emergency-braked), iterationCount, cumulativeDrift, driftHistory[], tokenSpend[], rollbackPoints[], findingsLog[], riskTrend[], createdAt, updatedAt
  - `IterationResultSchema` (Zod): sessionId, iteration, timestamp, verdict(pass/warn/block), verdictReasons[], diffCheck, driftCheck, budgetCheck, policyCheck
  - `HookResult` interface: verdict, notes[], elapsedMs
  - `MorningReport` interface: sessionId, generatedAt, iterationsWhileAway, topFindings[], driftSummary, budgetSummary, safeRollbackPoint, emergencyBrakeTriggered, recommendation
  - Export 所有 types: `LoopSession`, `IterationResult`, `HookResult`, `MorningReport`
  依赖:只 import `zod`(已在 package.json)。不 import 项目内其他模块(纯类型文件)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun -e "import { LoopSessionSchema, IterationResultSchema } from './src/loop/types'; console.log('schemas ok:', typeof LoopSessionSchema.parse, typeof IterationResultSchema.parse)" 2>&1 | grep -q 'schemas ok' && echo PASS || echo FAIL`

- [x] **L03 `src/loop/drift.ts` — 累积漂移检测引擎**
  目的:Loop 跨轮累积漂移检测。每轮算本轮 drift,EMA 累积,全局 goalRelevance。
  读:`src/scan.ts:61-69` — `taskKeywords` 实现(拉丁词 ≥4 字 + CJK ≥2 字)。读 `docs/LOOP-DESIGN.md` §4 drift.ts spec。
  建:`src/loop/drift.ts` (~140 行) + `src/loop/drift.test.ts`。内容:
  - `iterationDriftScore(changedFiles: string[], goalKeywords: string[]): number` — 对每个文件名检查是否包含任一 goalKeyword(大小写不敏感)。drift = 1 - (匹配文件数 / 总文件数)。空 goalKeywords 或空 changedFiles 返回 0。
  - `updateCumulativeDrift(iterationScore: number, previous: number, alpha = 0.3): number` — `alpha * iterationScore + (1 - alpha) * previous`,clamp to [0, 1]。
  - `goalRelevance(allChangedFiles: string[], goalKeywords: string[]): number` — 去重后匹配率。
  - `driftVerdict(cumulative: number): "pass" | "warn" | "block"` — <0.4 pass, 0.4-0.7 warn, >0.7 block。
  依赖:无(纯函数,不 import 任何模块)。
  测试覆盖:
  - `iterationDriftScore(["Login.tsx","AuthForm.tsx"], ["login","auth"])` → 0.0
  - `iterationDriftScore(["ci.yml","docker-compose.yml"], ["login","auth"])` → 1.0
  - `iterationDriftScore(["Login.tsx","ci.yml"], ["login"])` → 0.5
  - `updateCumulativeDrift(1.0, 0.0, 0.3)` → 0.3
  - `updateCumulativeDrift(0.0, 0.6, 0.3)` → 0.42
  - `driftVerdict(0.3)` → "pass", `driftVerdict(0.5)` → "warn", `driftVerdict(0.8)` → "block"
  - 边界:空数组返回 0
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/drift.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [x] **L04 `src/loop/budget.ts` — Token 预算守护**
  目的:提供预算状态判定函数。
  读:`src/sessions.ts:14-27` — `PRICE_PER_MTOK` 定价表 + `modelFamily()` 归一。`src/sessions.ts:28-50` — `ProjectUsage`/`SessionUsage` 接口。读 `docs/LOOP-DESIGN.md` §4 budget.ts spec。
  建:`src/loop/budget.ts` (~120 行) + `src/loop/budget.test.ts`。内容:
  - `interface TokenSpendSnapshot { inputTokens: number; outputTokens: number; cacheReadTokens: number; estCostUsd: number }`
  - `interface BudgetStatus { budgetPct: number; verdict: "pass"|"warn"|"block"; tokensPerIteration: number; estimatedIterationsRemaining: number|null }`
  - `budgetStatus(tokensUsed: number, budgetTotal: number|null, warnPct: number, blockPct: number, tokenHistory: {iteration:number; inputTokens:number; outputTokens:number}[]): BudgetStatus` — budgetPct = tokensUsed/(budgetTotal||Infinity)。tokensPerIteration = 最近 5 轮(input+output)移动平均。verdict: <warnPct pass, <blockPct warn, else block。
  依赖:无外部依赖(纯计算函数)。
  测试覆盖:
  - `budgetStatus(300000, 500000, 0.6, 0.9, [{...},{...}])` — budgetPct=0.6, verdict="warn"
  - `budgetStatus(50000, null, 0.6, 0.9, [])` — budgetPct=0, verdict="pass"
  - `budgetStatus(460000, 500000, 0.6, 0.9, [...])` — verdict="block"
  - tokensPerIteration 移动平均计算正确性
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/budget.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

---

## Phase 2 — Core (顺序依赖,依赖 Phase 1)

- [x] **L05 `src/loop/session.ts` — Session CRUD**
  目的:Loop session 的创建、加载、保存、停止、列表。
  读:`src/loop/types.ts` — LoopSession schema。`src/id.ts` — `generateUlid`。`src/hash.ts` — `sha256prefix`。`src/scan.ts` — `taskKeywords`(已 export)。`src/logger.ts` — `logDir()` 获取 `~/.agent-diff-guard` 基础目录。
  建:`src/loop/session.ts` (~200 行) + `src/loop/session.test.ts`。内容:
  - `loopsDir(): string` — `join(logDir(), "loops")`,不存在则 mkdirSync。
  - `startSession(opts: { goal, cwd, budgetTokens?, mode? }): Promise<LoopSession>` — 生成 ULID,提取 goalKeywords(taskKeywords(goal)),sha256prefix(goal) → goalHash。检查 activeSessionForCwd(cwd) 是否已有 active → 有则抛错。写 `loops/<id>.json`。
  - `loadSession(id: string): LoopSession | null` — 读文件,用 LoopSessionSchema.safeParse 验证。
  - `saveSession(session: LoopSession): void` — 更新 updatedAt,写到 `.tmp.json` 再 renameSync(原子写)。
  - `stopSession(id: string): boolean` — load → status="stopped" → save。
  - `listSessions(): LoopSession[]` — readdirSync loops/,parse 每个 .json。
  - `activeSessionForCwd(cwd: string): LoopSession | null` — listSessions().find(s => s.cwd===cwd && s.status==="active")。
  依赖:import from `./types`, `../id`, `../hash`, `../scan`, `../logger`, `node:fs`, `node:path`。
  测试覆盖:用 `$ADG_HOME` 环境变量指向 tmpdir。startSession 创建文件、loadSession 读回一致、stopSession 改 status、activeSessionForCwd 找到/找不到、同 cwd 不能两个 active(抛错)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/session.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [x] **L06 `src/loop/check.ts` — 每轮迭代检查编排器**
  目的:Loop Guard 的核心,编排所有子系统产出 IterationResult。
  读:`src/loop/types.ts` — IterationResult schema。`src/loop/session.ts` — loadSession/saveSession。`src/loop/drift.ts` — iterationDriftScore/updateCumulativeDrift。`src/loop/budget.ts` — budgetStatus。`src/scan.ts` — parseDiff。`src/rules.ts` — runRules。`src/violations.ts` — detectViolations。`src/policy.ts` — loadPolicy。`src/event.ts` — buildFindingMeta。
  建:`src/loop/check.ts` (~250 行) + `src/loop/check.test.ts`。内容:
  - `checkIteration(opts: { sessionId: string; task?: string; deps?: {...} }): Promise<IterationResult>` — 编排:loadSession → parseDiff("HEAD",cwd) → runRules(changes) → loadPolicy(cwd)+detectViolations → iterationDriftScore → updateCumulativeDrift → budgetStatus → composite verdict(worst of all) → 如 all pass 记录 rollbackPoint → 追加 history arrays → saveSession → append loop event → return。
  - `quickCheck(opts: { cwd, filePath, sessionId? }): HookResult` — 只对 filePath 跑路径规则 regex match。不加载 session/budget/drift。< 500ms。
  依赖:import from `./types`, `./session`, `./drift`, `./budget`, `../scan`, `../rules`, `../violations`, `../policy`, `../event`, `../logger`。
  测试覆盖:用 mock deps 注入 parseDiff 结果。无 findings+drift pass+budget pass → verdict "pass"。有 wake finding → "block"。drift warn+budget pass → "warn"。quickCheck 对敏感路径返回 warn。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/check.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [x] **L07 `src/loop/overnight.ts` — 无人值守模式**
  目的:unattended 模式下静默收集 block,紧急制动条件触发真正停止。
  读:`src/loop/types.ts` — LoopSession, IterationResult。`src/loop/session.ts` — saveSession。`src/logger.ts` — logDir(PAUSE 文件路径)。`src/runner.ts:~20-30` — PAUSE kill-switch 约定。
  建:`src/loop/overnight.ts` (~120 行) + `src/loop/overnight.test.ts`。内容:
  - `shouldEmergencyBrake(session: LoopSession): { brake: boolean; reason: string }` — ①最近 3 条 riskTrend 连续 verdict==="block" ②cumulativeDrift>0.8 ③最后一条 tokenSpend budgetPct>0.95 ④findingsLog 最后一条 severity==="wake-you-up" 且命中 frozen-path。
  - `executeEmergencyBrake(session, reason): void` — status="emergency-braked" → saveSession → writeFileSync PAUSE 文件 → append emergency event。
  - `unattendedVerdictOverride(result, session): IterationResult` — unattended && block && !emergency → 降为 warn。
  依赖:import from `./types`, `./session`, `../logger`, `node:fs`, `node:path`。
  测试覆盖:3 consecutive blocks → brake=true。2 blocks → false。cumulativeDrift 0.81 → true。unattended block→warn, attended block→block。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/overnight.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

---

## Phase 3 — Interfaces (可并行,依赖 Phase 2)

- [x] **L08 `src/loop/report.ts` — 晨报生成器**
  目的:从 LoopSession 状态生成 MorningReport。
  读:`src/loop/types.ts` — LoopSession, MorningReport。`docs/LOOP-DESIGN.md` §4 report.ts spec。
  建:`src/loop/report.ts` (~180 行) + `src/loop/report.test.ts`。内容:
  - `generateReport(session, opts?): MorningReport` — topFindings 按 rule:path 去重取 top 5,driftSummary stable/drifting/diverged,budgetSummary,safeRollbackPoint,recommendation(emergencyBraked→"rollback", diverged→"review-and-continue", else→"continue")。
  - `renderReport(report): string` — 人类可读 terminal 输出。
  - `reportToJson(report): string` — JSON.stringify。
  依赖:import from `./types` only。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/report.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [x] **L09 `src/loop-cli.ts` — CLI 子命令**
  目的:`agent-diff-guard loop start/check/status/report/stop/list/install-hook` 全部子命令。
  读:`src/cli.ts` — 现有参数解析风格(rawArgs 手动解析)和 render 风格(C.bold/C.dim)。`src/loop/session.ts`、`src/loop/check.ts`、`src/loop/report.ts`。
  建:`src/loop-cli.ts` (~250 行)。内容:
  - `handleLoopCommand(args: string[]): Promise<void>` — 解析第一个参数为子命令,分派。
  - `start`: --goal(必填)、--budget(支持 500k/1m 缩写)、--mode、--cwd。调用 startSession。
  - `check`: --session(默认 activeSessionForCwd)、--task、--json。调用 checkIteration。exit 1 if block。
  - `status`/`report`/`stop`/`list`/`install-hook`: 各自逻辑。
  依赖:import from `./loop/session`, `./loop/check`, `./loop/report`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts loop --help 2>&1 | grep -q 'loop' && echo PASS || echo FAIL`

- [x] **L10 `src/loop-mcp.ts` — MCP tool registration**
  目的:注册 `guard_loop_iteration` 和 `loop_status` 两个 MCP tools。
  读:`src/mcp.ts` — 现有 tool 注册模式(server.registerTool + z.object inputSchema)。`docs/LOOP-DESIGN.md` §5 MCP tools spec。
  建:`src/loop-mcp.ts` (~180 行)。内容:
  - `registerLoopTools(server: McpServer): void`
  - Tool `guard_loop_iteration`: inputSchema { session_id?, goal?, cwd?, budget_tokens?, mode?, task? }。无 session_id → startSession → checkIteration。有 session_id → checkIteration。
  - Tool `loop_status`: inputSchema { session_id, format?(summary/full/morning-report) }。
  依赖:import `McpServer` from `@modelcontextprotocol/sdk`, `z` from `zod`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun -e "import { registerLoopTools } from './src/loop-mcp'; console.log('export ok:', typeof registerLoopTools)" 2>&1 | grep -q 'export ok: function' && echo PASS || echo FAIL`

- [x] **L11 `src/loop/hook.ts` — PostToolUse hook adapter**
  目的:< 500ms Claude Code PostToolUse hook。
  读:`src/loop/check.ts` — quickCheck。
  建:`src/loop/hook.ts` (~100 行) + `hooks/post-tool-use` (shell shim)。内容:
  - `handlePostToolUse(): Promise<void>` — 从 stdin 读 JSON,提取 tool_input.file_path,调 quickCheck。exit 0 always。
  - `hookConfig(guardCliPath: string)` — 返回 Claude Code settings.json hooks 配置。
  依赖:import from `./check` only。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && echo '{"tool_name":"Edit","tool_input":{"file_path":"src/rules.ts"}}' | timeout 2 bun run src/loop/hook.ts 2>/dev/null; test $? -eq 0 && echo PASS || echo FAIL`

---

## Phase 4 — Glue (接线)

- [x] **L12 `src/cli.ts` 加 loop 子命令路由**
  目的:让 `agent-diff-guard loop ...` 到达 loop-cli.ts。
  读:`src/cli.ts:232-235` — run block `return;` 之后、unknown command check 之前。
  改:在 line 232 `return;`(run block 结尾)之后、line 234 unknown check 之前,插入:
  ```typescript
  if (cmd === "loop") {
    const { handleLoopCommand } = await import("./loop-cli");
    await handleLoopCommand(rawArgs.slice(1));
    return;
  }
  ```
  同时在 HELP 字符串追加 `  agent-diff-guard loop [子命令]     Loop 验证层:start/check/status/report/stop/list`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts loop list 2>&1 | grep -vq '未知命令' && echo PASS || echo FAIL`

- [x] **L13 `src/mcp.ts` 注册 loop tools**
  目的:MCP server 暴露 guard_loop_iteration 和 loop_status。
  读:`src/mcp.ts` — Tool 4 结束后、main() 前。顶部 import 区。
  改:顶部加 `import { registerLoopTools } from "./loop-mcp";`。Tool 4 块后加 `registerLoopTools(server);`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'registerLoopTools' src/mcp.ts && echo PASS || echo FAIL`

- [x] **L14 `src/event.ts` 加 loopSessionId 可选字段**
  目的:GuardEvent 关联 loop session,供审计查询。
  读:`src/event.ts:45-62` — GuardEvent interface。
  改:`repoAlias: string | null;` 后加 `loopSessionId?: string;`。`BuildEventOpts` 加同名字段,函数体赋值。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'loopSessionId' src/event.ts && bun test 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

---

## Phase 5 — Integration Test

- [x] **L15 端到端集成测试:loop start → check × 3 → report → stop**
  目的:验证完整 loop 生命周期。
  读:所有 `src/loop/*.ts` + `src/loop-cli.ts`。
  建:`src/loop/integration.test.ts` (~150 行)。用 `$ADG_HOME` 指向 tmpdir。在有 git history 的 temp repo 中:
  1. `loop start --goal "add auth feature" --budget 100000` → 拿 session ID
  2. 创建 on-goal 文件 `auth.ts`,commit,`loop check` → verdict pass
  3. 创建 off-goal 文件 `.github/workflows/ci.yml`,commit,`loop check` → drift 上升
  4. `loop report --json` → 有 driftSummary + topFindings
  5. `loop stop` → status=stopped
  6. `loop list --json` → 包含该 session
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/integration.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

---

## 🔵 Loop Ecosystem — Loop 生态集成方向

> 研究背景见 [docs/LOOP-ECOSYSTEM-RESEARCH.md](docs/LOOP-ECOSYSTEM-RESEARCH.md)
> 基于 2026-06-17 深度研究：21 来源 / 105 claims / 103 agent 对抗验证
> 定位：agent-diff-guard 不做 Loop 管理器，做**所有 Loop 的验证层**

### 近期（1-2 周）：立即可做

- [ ] **LE-01 OpenTelemetry span attributes export**
  目的：让 Datadog/Phoenix/Langfuse 自动消费 guard verdict 数据，不需自建可观测性。
  改：`src/loop/check.ts` 的 `IterationResult` 附带标准 OTEL 属性（`guard.drift.cumulative`、`guard.budget.pct`、`guard.verdict`）。
  MCP tool response 中附带这些字段作为 structured span annotations。
  依赖：无新依赖，只在 MCP response JSON 中加字段。
  参考：Datadog MCP 协议级追踪已确认自动追踪 MCP tool calls（2-0 验证）。

- [ ] **LE-02 loop-events.jsonl hash chaining（tamper-evident 审计日志）**
  目的：满足 EU AI Act 对 append-only、tamper-evident 审计日志的要求（SHA-256 hash chaining，6 月最低保留期）。
  改：`src/logger.ts`（或新建 `src/loop/audit.ts`）每条日志加 `previousHash: string` 字段，值为上一条日志的 SHA-256 hex prefix。首条日志 previousHash 为 `"genesis"`。
  验证：读 loop-events.jsonl → 逐行验证 hash chain 完整性。
  参考：72% 组织用 agentic AI，仅 26% 有治理策略 — 先行者优势。

- [ ] **LE-03 `/api/loops` 端点 + Web UI Loop Monitor 页**
  目的：跨 Loop 全局风险视图 — 汇总所有 active session 的 drift/budget/verdict。
  改：`src/serve-local.ts` 加 `GET /api/loops` → 调 `listSessions()` 返回 session 列表含最新 drift/budget snapshot。
  `web/app.js` + `web/index.html` 加 "Loop Monitor" 导航项和页面，展示 session 卡片（状态/漂移趋势/预算余量/最近 verdict）。
  依赖：L05 session.ts `listSessions()` 已实现。

- [ ] **LE-04 跨 session token 花费报警**
  目的：当同一 repo 下所有 loop session 的总 token 花费超过日预算（如 $50）时，跨 session 报警。
  改：`src/loop/check.ts` 的 `checkIteration()` 中，调 `listSessions()` 汇总同 cwd 下所有 active session 的 tokenSpend 总和，超阈值时在 verdictReasons 中追加跨 session 警告。
  可配置阈值（环境变量或 `.agent-diff-guard.toml`）。

### 中期（1-2 月）：差异化建设

- [ ] **LE-05 语义级漂移检测 v1（TF-IDF）**
  目的：当前 drift.ts 基于文件名 vs 关键词的词面匹配，对"optimization drift"（agent 对不完美 spec 的渐进偏离）检测不足。
  改：`src/loop/drift.ts` 新增 `semanticDriftScore(diffContent: string, goalText: string): number`。
  用 TF-IDF（纯 JS 实现，无外部依赖）对比 diff 内容与 goal 的语义距离。
  保持 <100ms 延迟（不引入 LLM 调用）。
  保留原有 `iterationDriftScore()` 作为 fallback，新分数加权合并。
  补单测：验证语义相关 diff 分低、无关 diff 分高。

- [ ] **LE-06 Gas Town 集成 — Witness 角色适配器**
  目的：Gas Town 跑 20-30 个并行 Claude Code 实例，缺乏内建的漂移检测和预算护栏（3-0 验证确认）。
  建：`src/loop/gastown-adapter.ts`（~200L）
  - 读 Gas Town Beads（Git-backed JSON，一行一个 issue）→ 提取 task assignment
  - 为每个 Polecat（工人 agent）创建对应的 loop session
  - 在 Refinery 合并前检查每个 Polecat 的 diff → 调 checkIteration()
  - 检测跨 Polecat 漂移叠加（agent A 偏 10% + agent B 偏 10% 同方向 → 实际偏 40%？）
  CLI 子命令：`agent-diff-guard loop gastown --beads-dir <path>`
  依赖：Gas Town 需本地安装（开发时 mock Beads JSON）。
  参考：Gas Town 15.9k stars，是 Claude Code 生态最大的多 agent 编排系统。

- [ ] **LE-07 loop-audit guard-readiness 插件**
  目的：cobusgreyling/loop-engineering 的 loop-audit 做 L0-L3 就绪度评分（3-0 验证确认），agent-diff-guard 可贡献 "guard" 评分维度。
  建：`src/loop/loop-audit-plugin.ts`（~100L）→ 导出 JSON 格式的 guard-readiness score：
  - 是否有漂移检测 → +1
  - 是否有预算闸 → +1
  - 是否有紧急制动 → +1
  - 是否有 PostToolUse hook 安装 → +1
  CLI 子命令：`agent-diff-guard loop audit --json`
  评估：向 cobusgreyling/loop-engineering 提交 PR 支持 plugin 机制。

- [ ] **LE-08 Ralph 循环 between-iteration gate 增强**
  目的：Ralph 循环每轮 fresh context，状态全在磁盘上，天然需要外部验证层。
  改：在 `docs/LOOP-DESIGN.md` 第 5 节已有的 shell 集成示例基础上：
  - `src/loop/ralph-adapter.ts`（~100L）：读 `IMPLEMENTATION_PLAN.md` → 提取当前 task → 跟 drift goalKeywords 对齐
  - 支持 Ralphify 的 completion-promise 模式（exact string matching）
  - 在 `loop check` 输出中加 ralph-specific 字段（current_task、plan_alignment_score）
  参考：Ralphify 是 Ralph 循环的最活跃 CLI wrapper。

- [ ] **LE-09 多 agent 协同漂移叠加检测**
  目的：Gas Town 场景下，多个 agent 各自偏离 10% 但方向一致，合计可能已经偏了 40%——需要向量级的漂移叠加检测。
  改：`src/loop/drift.ts` 新增 `multiAgentDriftVector(sessions: LoopSession[]): { magnitude: number; direction: string; agents: string[] }`。
  将每个 session 的 drift 表示为方向向量（基于变更文件的类别分布），检测方向一致性。
  当多个 session 的 drift 向量夹角 < 30° 时，漂移 magnitude 按叠加而非独立计算。
  补单测。

### 长期（3-6 月）：生态卡位

- [ ] **LE-10 Loop Contract 标准化（.loop-contract.yaml）**
  目的：定义生产 loop 的 6 个必填字段标准（TRIGGER / SCOPE / ACTION / BUDGET / STOP / ESCALATE）。
  建：`src/loop/contract.ts`（~150L）— 解析 `.loop-contract.yaml` → 验证字段完整性 → 与 loop session 配置对齐。
  CLI 子命令：`agent-diff-guard loop contract validate`
  推动社区采纳：写 spec 文档 + 示例模板。
  参考：多个来源共同指向 loop 需要"合同"式的声明性定义。

- [ ] **LE-11 EU AI Act compliance export**
  目的：一键导出符合审计要求的 loop 执行记录（依赖 LE-02 hash chaining 先完成）。
  建：`src/loop/compliance-export.ts`（~200L）
  - 导出格式：JSON-LD 或 CSV，包含六大审计类别（Identity / Input-Prompt / Tool Invocations / Decision Points / Outputs / Latency-Metadata）
  - hash chain 完整性验证报告
  - 时间范围筛选（默认 6 个月）
  CLI 子命令：`agent-diff-guard loop export --format jsonld --since 2026-01-01`

- [ ] **LE-12 Morning Triage Loop skill 模板**
  目的：提供一个开箱即用的 Claude Code skill，实现 Osmani 框架的标准 morning triage loop 形状。
  建：`.claude/skills/morning-guard-triage/SKILL.md`
  - 读昨日 loop session → 生成 report → 高风险项进审查队列
  - 自动创建 worktree 隔离的修复任务
  - 结果汇总到 Slack/Linear（通过 MCP connector）
  依赖：report.ts 晨报已实现，需 MCP connector 配置。

- [ ] **LE-13 语义级漂移检测 v2（Embedding）**
  目的：LE-05 的升级版，用轻量 embedding 模型替代 TF-IDF，提高语义漂移检测精度。
  改：`src/loop/drift.ts` 的 `semanticDriftScore()` 支持可选的 embedding 后端：
  - 本地模式：sentence-transformers（通过 ONNX runtime，纯 JS）
  - 云端模式：用户自带 API key（Anthropic/OpenAI embedding endpoint）
  保持 <200ms 延迟。
  可配置开关（默认关闭，需显式 opt-in）。

- [ ] **LE-14 AgentGuard47 互操作层**
  目的：AgentGuard47 是 Python 生态的运行时护栏（预算硬上限 / loop 检测 / 重试限制），与 agent-diff-guard（TypeScript/diff 分析/漂移检测）互补。
  建：`src/loop/agentguard-bridge.ts`（~100L）
  - 读 AgentGuard47 的 JSONL trace 文件 → 提取 budget events → 喂给 budget.ts
  - 双向：agent-diff-guard 的 verdict 可写入 AgentGuard47 trace format
  - MCP tool：`guard_agentguard_sync` — 同步两个系统的 budget 状态
  依赖：AgentGuard47 的 JSONL trace 格式需稳定（当前 v1.2.13）。

- [ ] **LE-15 无进展检测（No-Progress Detection）**
  目的：生产 loop 六大护栏之一——检测 agent 是否在做无用功（重复错误、空 commit、相同 diff 反复出现）。
  改：`src/loop/check.ts` 新增 no-progress 检查维度：
  - 连续 N 轮（默认 3）的 diff 内容 hash 相同 → block
  - 连续 N 轮的 test 结果不变（同样的失败） → warn
  - 连续 N 轮 0 文件变更 → block
  在 IterationResult 中加 `progressCheck: { stalled: boolean; stalledRounds: number; reason: string }`。
  补单测。

- [ ] **LE-16 Tool Call 熔断器（Circuit Breaker）**
  目的：生产 loop 六大护栏之一——同一 tool 连续失败 N 次时降级到安全模式。
  改：`src/loop/session.ts` 的 LoopSession 新增 `toolCallHistory: { tool: string; success: boolean; timestamp: string }[]`。
  `src/loop/check.ts` 新增熔断检查：同一 tool 连续失败 3 次 → verdict 追加降级建议（read-only tools、no delegation、capped retries）。
  参考：Oracle Runtime Budget Guardrails 框架定义的三级降级策略。

- [ ] **LE-17 跨 agent 中立性适配（Cursor / Codex / Copilot）**
  目的：ROADMAP.md §3.3 的延伸——agent-diff-guard 作为中立第三方守门人，不仅守护 Claude Code。
  改：`src/loop/hook.ts` 增加对其他 agent 的 hook 适配：
  - Cursor：通过 `.cursorrules` 集成
  - Codex CLI：通过 post-execution hook
  - GitHub Copilot：通过 GitHub Actions
  每种适配器一个文件，统一调 `checkIteration()`。
  CLI 子命令：`agent-diff-guard loop install-hook --agent cursor|codex|copilot`

- [ ] **LE-18 Loop Readiness Dashboard Widget**
  目的：在 Web UI 首页加一个"Loop 就绪度"小组件，显示当前 repo 的 loop 准备程度（类似 loop-audit 的 L0-L3）。
  改：`web/app.js` 首页加 widget：
  - L0: 无 loop 配置
  - L1: 有 guard hook 安装
  - L2: 有 budget + drift 配置
  - L3: 有 emergency brake + 晨报 + 跨 session 监控
  数据来自 `GET /api/loops` + hook 安装状态检查。
