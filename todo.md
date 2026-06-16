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

- [ ] **L04 `src/loop/budget.ts` — Token 预算守护**
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

- [ ] **L05 `src/loop/session.ts` — Session CRUD**
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

- [ ] **L06 `src/loop/check.ts` — 每轮迭代检查编排器**
  目的:Loop Guard 的核心,编排所有子系统产出 IterationResult。
  读:`src/loop/types.ts` — IterationResult schema。`src/loop/session.ts` — loadSession/saveSession。`src/loop/drift.ts` — iterationDriftScore/updateCumulativeDrift。`src/loop/budget.ts` — budgetStatus。`src/scan.ts` — parseDiff。`src/rules.ts` — runRules。`src/violations.ts` — detectViolations。`src/policy.ts` — loadPolicy。`src/event.ts` — buildFindingMeta。
  建:`src/loop/check.ts` (~250 行) + `src/loop/check.test.ts`。内容:
  - `checkIteration(opts: { sessionId: string; task?: string; deps?: {...} }): Promise<IterationResult>` — 编排:loadSession → parseDiff("HEAD",cwd) → runRules(changes) → loadPolicy(cwd)+detectViolations → iterationDriftScore → updateCumulativeDrift → budgetStatus → composite verdict(worst of all) → 如 all pass 记录 rollbackPoint → 追加 history arrays → saveSession → append loop event → return。
  - `quickCheck(opts: { cwd, filePath, sessionId? }): HookResult` — 只对 filePath 跑路径规则 regex match。不加载 session/budget/drift。< 500ms。
  依赖:import from `./types`, `./session`, `./drift`, `./budget`, `../scan`, `../rules`, `../violations`, `../policy`, `../event`, `../logger`。
  测试覆盖:用 mock deps 注入 parseDiff 结果。无 findings+drift pass+budget pass → verdict "pass"。有 wake finding → "block"。drift warn+budget pass → "warn"。quickCheck 对敏感路径返回 warn。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/check.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [ ] **L07 `src/loop/overnight.ts` — 无人值守模式**
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

- [ ] **L08 `src/loop/report.ts` — 晨报生成器**
  目的:从 LoopSession 状态生成 MorningReport。
  读:`src/loop/types.ts` — LoopSession, MorningReport。`docs/LOOP-DESIGN.md` §4 report.ts spec。
  建:`src/loop/report.ts` (~180 行) + `src/loop/report.test.ts`。内容:
  - `generateReport(session, opts?): MorningReport` — topFindings 按 rule:path 去重取 top 5,driftSummary stable/drifting/diverged,budgetSummary,safeRollbackPoint,recommendation(emergencyBraked→"rollback", diverged→"review-and-continue", else→"continue")。
  - `renderReport(report): string` — 人类可读 terminal 输出。
  - `reportToJson(report): string` — JSON.stringify。
  依赖:import from `./types` only。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/loop/report.test.ts 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

- [ ] **L09 `src/loop-cli.ts` — CLI 子命令**
  目的:`agent-diff-guard loop start/check/status/report/stop/list/install-hook` 全部子命令。
  读:`src/cli.ts` — 现有参数解析风格(rawArgs 手动解析)和 render 风格(C.bold/C.dim)。`src/loop/session.ts`、`src/loop/check.ts`、`src/loop/report.ts`。
  建:`src/loop-cli.ts` (~250 行)。内容:
  - `handleLoopCommand(args: string[]): Promise<void>` — 解析第一个参数为子命令,分派。
  - `start`: --goal(必填)、--budget(支持 500k/1m 缩写)、--mode、--cwd。调用 startSession。
  - `check`: --session(默认 activeSessionForCwd)、--task、--json。调用 checkIteration。exit 1 if block。
  - `status`/`report`/`stop`/`list`/`install-hook`: 各自逻辑。
  依赖:import from `./loop/session`, `./loop/check`, `./loop/report`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts loop --help 2>&1 | grep -q 'loop' && echo PASS || echo FAIL`

- [ ] **L10 `src/loop-mcp.ts` — MCP tool registration**
  目的:注册 `guard_loop_iteration` 和 `loop_status` 两个 MCP tools。
  读:`src/mcp.ts` — 现有 tool 注册模式(server.registerTool + z.object inputSchema)。`docs/LOOP-DESIGN.md` §5 MCP tools spec。
  建:`src/loop-mcp.ts` (~180 行)。内容:
  - `registerLoopTools(server: McpServer): void`
  - Tool `guard_loop_iteration`: inputSchema { session_id?, goal?, cwd?, budget_tokens?, mode?, task? }。无 session_id → startSession → checkIteration。有 session_id → checkIteration。
  - Tool `loop_status`: inputSchema { session_id, format?(summary/full/morning-report) }。
  依赖:import `McpServer` from `@modelcontextprotocol/sdk`, `z` from `zod`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun -e "import { registerLoopTools } from './src/loop-mcp'; console.log('export ok:', typeof registerLoopTools)" 2>&1 | grep -q 'export ok: function' && echo PASS || echo FAIL`

- [ ] **L11 `src/loop/hook.ts` — PostToolUse hook adapter**
  目的:< 500ms Claude Code PostToolUse hook。
  读:`src/loop/check.ts` — quickCheck。
  建:`src/loop/hook.ts` (~100 行) + `hooks/post-tool-use` (shell shim)。内容:
  - `handlePostToolUse(): Promise<void>` — 从 stdin 读 JSON,提取 tool_input.file_path,调 quickCheck。exit 0 always。
  - `hookConfig(guardCliPath: string)` — 返回 Claude Code settings.json hooks 配置。
  依赖:import from `./check` only。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && echo '{"tool_name":"Edit","tool_input":{"file_path":"src/rules.ts"}}' | timeout 2 bun run src/loop/hook.ts 2>/dev/null; test $? -eq 0 && echo PASS || echo FAIL`

---

## Phase 4 — Glue (接线)

- [ ] **L12 `src/cli.ts` 加 loop 子命令路由**
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

- [ ] **L13 `src/mcp.ts` 注册 loop tools**
  目的:MCP server 暴露 guard_loop_iteration 和 loop_status。
  读:`src/mcp.ts` — Tool 4 结束后、main() 前。顶部 import 区。
  改:顶部加 `import { registerLoopTools } from "./loop-mcp";`。Tool 4 块后加 `registerLoopTools(server);`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'registerLoopTools' src/mcp.ts && echo PASS || echo FAIL`

- [ ] **L14 `src/event.ts` 加 loopSessionId 可选字段**
  目的:GuardEvent 关联 loop session,供审计查询。
  读:`src/event.ts:45-62` — GuardEvent interface。
  改:`repoAlias: string | null;` 后加 `loopSessionId?: string;`。`BuildEventOpts` 加同名字段,函数体赋值。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'loopSessionId' src/event.ts && bun test 2>&1 | tail -1 | grep -q ' 0 fail' && echo PASS || echo FAIL`

---

## Phase 5 — Integration Test

- [ ] **L15 端到端集成测试:loop start → check × 3 → report → stop**
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
