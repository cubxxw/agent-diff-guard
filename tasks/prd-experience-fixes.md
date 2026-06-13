# PRD: agent-diff-guard 深度体验修复

## Introduction

2026-06-13 的一轮深度体验测试(启动本地控制台 + 4 个并发 agent 以新手/设计/QA/PM 四视角走查)
暴露了一批问题。其中最严重的是:产品定位为「平时放行,关键时刻刹车,宁可漏不可烦」,
但实测**审查队列 30 条全红、同一处文件重复 6 次、58.8% 的 push 被刹** —— 产品正在亲手制造
它最怕的告警疲劳。

本 PRD 把这些发现整理为可实现、可验证的用户故事,覆盖从核心价值修复(P0)到健壮性(P1)、
一致性(P2)、打磨(P3)的全部可机器验证项,并把无法机器验证的视觉/文案/产品决策
留在 Non-Goals 与 Open Questions。

**实现者注意**:每个 user story 的 acceptance criteria 末尾给出了**可直接运行的验证命令**,
打印 `PASS` 即视为该项通过。所有 curl 命令走 `--noproxy '*'`(本机系统代理会劫持 localhost)。
命令均假定工作目录为仓库根 `/Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard`。

数据快照(测试时):34 次扫描 / 20 刹停 / 26 wake / 41.2% 自动放行率 / 4 仓库。

## Goals

- **G1 — 让队列回归「1-3 处不刷屏」**:审查队列不再把历史旧账全摊开,同一处只出一条。
- **G2 — 让「宁可漏不可烦」在数据上成立**:常规改动降级,只有真高危才半夜叫醒。
- **G3 — 让护城河(偏离检测)真正生效**:无信息量任务不再被默认判为「安全」。
- **G4 — 修掉会挂起/崩溃/阻断的健壮性缺陷**:空 body、端口占用、CORS、404 格式。
- **G5 — 降低新手认知门槛**:首页有定位说明,术语有解释,联网有披露。
- **G6 — 不破坏已验证的正确性**:72 单测全过、数据一致性、路径遍历安全须保持。

## User Stories

> 顺序即建议实现顺序。P0-1 与 P0-3 按决策「先聚合,再默认排除」协同:US-001 给 history 加聚合
> (复用到守门记录页),US-003 把 history 默认移出审查队列。

### US-001: 审查队列按 `repo:rule:file` 聚合,history 内部去重
**Description:** As a 用户, I want 同一处改动在队列里只出现一条(带命中次数), so that 我不会被 30 个重复红徽章淹没、学会无脑全放行。

**根因:** `findings.ts:307-311` 去重只在 live↔history 之间,history 内部不去重,`src/config.ts@hardcoded-secret` 被列 6 次。

**Acceptance Criteria:**
- [ ] `buildHistory`(或 `buildQueue`)对 history 项按 `repo:rule:file` 聚合,保留最近一条
- [ ] `QueueFinding` 增 `hitCount`(命中次数)与 `firstSeen`(最早时间)字段,聚合时填充
- [ ] 聚合逻辑可被「守门记录」页复用(导出为独立函数)
- [ ] `bun test src/findings.test.ts` 通过(补一条「同 file+rule 多次 blocked 聚合成 1 条且 hitCount>1」的断言)
- [ ] 验证: `bun test src/findings.test.ts 2>&1 | grep -q ' 0 fail' && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; U=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/findings); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$U" | bun -e 'const it=JSON.parse(await Bun.stdin.text());const f={};for(const i of it){const k=(i.repo||"")+":"+(i.rule||"")+":"+(i.file||i.path||"");f[k]=(f[k]||0)+1}const d=Object.entries(f).filter(([,n])=>n>1);if(d.length){console.error("FAIL",d);process.exit(1)}console.log("PASS 队列无重复 file@rule")'`

### US-002: 路径规则分级,常规清单类降为 `look-once`
**Description:** As a 用户, I want 装依赖、改 CI 配置这类常规操作不被「半夜叫醒」, so that 真正的 wake 只留给硬编码密钥/删测试/任务无关碰 CI 这类几乎一定该看的事。

**根因:** `rules.ts` 所有 `severity` 全是 `"wake-you-up"`,`look-once` 从未被使用 → 58.8% push 被刹。

**Acceptance Criteria:**
- [ ] `dependency-manifest`、`container-build`、`k8s-manifest` 等「常规也会动」的规则改用 `look-once`
- [ ] `hardcoded-secret`、`test-deleted` 保持 `wake-you-up`;`ci-pipeline` 在任务无关时 `wake`(可暂保持 wake)
- [ ] `rules.ts` 中至少有 1 处 `severity: "look-once"` 实际赋值
- [ ] `bun test src/rules.test.ts` 通过(补/改对应分级断言)
- [ ] 验证: `bun test src/rules.test.ts 2>&1 | grep -q ' 0 fail' && grep -q '"look-once"' src/rules.ts && test $(grep -c 'severity: "look-once"' src/rules.ts) -ge 1 && echo PASS || echo FAIL`

### US-003: 审查队列默认只放 live;history 移出队列
**Description:** As a 用户, I want 队列里只有「当下还没 push、能真正裁决」的改动, so that 我不会对着 15 天前已合并、连 diff 正文都没有的旧账点「放行/驳回」。

**根因:** `buildHistory` 把所有 `blocked` 历史 wake 全回流成「待裁决」,队列永远涨、清不掉。

**Acceptance Criteria:**
- [ ] `buildQueue` 默认不含 history(加 `includeHistory` 选项,默认 `false`)
- [ ] 队列为 live + 必要时 demo 兜底;history 聚合数据(US-001 的产物)改由「守门记录」页消费
- [ ] `bun test src/findings.test.ts` 通过(更新断言:默认 buildQueue 不返回 origin=history;显式传 includeHistory:true 才返回)
- [ ] 验证: `bun test src/findings.test.ts 2>&1 | grep -q ' 0 fail' && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; U=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/findings); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$U" | bun -e 'const it=JSON.parse(await Bun.stdin.text());const h=it.filter(i=>i.origin==="history");if(h.length){console.error("FAIL history",h.length);process.exit(1)}console.log("PASS 无 history 回流,共",it.length)'`

### US-004: 偏离检测对无信息量/中文任务兜底
**Description:** As a 用户, I want 当任务描述是「继续分析解决问题」这种零信息量内容时,产品明确告诉我「无法判断偏离」, so that 我不会被一个假的「drift 0% = 安全」误导,而护城河功能不再形同虚设。

**根因:** 词面匹配对中文/短任务无词可匹配 → drift 返回 0 被当作安全;`task-drift` 全局只命中 1 次。

**Acceptance Criteria:**
- [ ] 偏离计算前判定任务描述是否「信息量不足」(长度阈值 + 停用词:继续/修复/解决/重启/重新启动 等)
- [ ] 信息量不足时 `drift` 返回 `null`,并在 `reason` 标注「任务描述不足以判断偏离」
- [ ] 前端对 `drift=null` 的展示区别于 `drift=0`(不显示「0% 偏离」绿色安全态)
- [ ] 补单测覆盖「低信息任务 → drift=null + 提示」
- [ ] `bun test` 全过
- [ ] 验证: `bun test 2>&1 | grep -q ' 0 fail' && grep -Eq '不足以判断|信息量不足|低信息|insufficient' src/ai.ts src/findings.ts && echo PASS || echo FAIL`

### US-005: `POST /api/ai/analyze` 空 body 不再挂起
**Description:** As a 前端/调用方, I want 空 body 的 POST 立即返回而非挂起 10 秒, so that 不会因网络层 pending 永久卡住。

**根因:** `serve-local.ts:205` `await req.json()` 对空 body 流不抛异常,catch 永不触发。

**Acceptance Criteria:**
- [ ] 所有 POST 端点先 `await req.text()`,空串按 `{}` 处理,再 `JSON.parse`
- [ ] 空 body POST 在 5 秒内返回(非 `000` 超时)
- [ ] 验证: `bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:4799/api/ai/analyze); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" != "000" && echo "PASS $C" || echo "FAIL 挂起"`

### US-006: Nudge 提醒关闭后持久化,当次会话不再重弹
**Description:** As a 用户, I want 点过「知道了」的提醒不要每次切页都重新弹出, so that 这个号称「宁可漏不可烦」的产品自己别变成骚扰源。

**Acceptance Criteria:**
- [ ] 「知道了」点击后写入 `sessionStorage`(键含当前 wake count),渲染前检查跳过
- [ ] 活动列表底部留 `padding-bottom`,避免 nudge 遮挡右侧第 3~5 条活动
- [ ] 验证: `grep -Eq 'sessionStorage|localStorage' web/app.js && grep -Eq 'nudge|dismiss' web/app.js && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill(切页 ≥3 次确认不重弹)

### US-007: 审查队列裁决按钮改 sticky
**Description:** As a 用户, I want 读长 diff 时放行/驳回/误报按钮始终可见, so that 不必滚回顶部才能裁决。

**Acceptance Criteria:**
- [ ] `.qd-actions` 加 `position:sticky;bottom:0` + 背景 + 顶部阴影(防内容透显)
- [ ] 验证: `grep -A4 '\.qd-actions' web/index.html web/app.js 2>/dev/null | grep -q 'sticky' && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill(滚动长 diff 确认按钮固定)

### US-008: 通知 badge / muted 文字对比度达 WCAG AA
**Description:** As a 视障/弱光环境用户, I want 角标和提示文字看得清, so that 关键信息不被低对比度埋没。

**Acceptance Criteria:**
- [ ] badge 橙底从 `#A66A00` 调深到 `#8A5800`(白字对比度 ≥4.5:1)
- [ ] muted hint 从 `#A39F99` 调深到 `#857F79`(配米底 ≥4.5:1)
- [ ] 验证: `! grep -iq '#A39F99' web/index.html web/app.js && ! grep -iq '#A66A00' web/index.html web/app.js && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill(抽查对比度)

### US-009: 首页加产品定位说明 + 核心术语 tooltip
**Description:** As a 新用户, I want 5 秒内看懂这是什么产品、wake-you-up 之类术语是什么意思, so that 头 5 分钟不再一片迷雾。

**Acceptance Criteria:**
- [ ] header/hero 加定位句(如「AI agent 改动守门人:平时放行,关键时刻刹车」)
- [ ] KPI/术语(wake-you-up / look-once / 越界 / 终端信箱)加 `title=` 或 `(?)` tooltip
- [ ] 验证: `grep -Eq '守门人|平时放行|关键时刻' web/index.html && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill

### US-010: 时间线 tooltip 用真实扫描次数
**Description:** As a 用户, I want 时间线 tooltip 的「共 N 次扫描」是真实扫描次数, so that 不被「pass+look+wake 混加」的错误数字误导(6/10 实际 6 次却显示 9)。

**Acceptance Criteria:**
- [ ] `stats.ts` 的 timeline 增 `eventCount`(当天实际扫描次数)字段
- [ ] `app.js`(约 157 行)tooltip 改用 `eventCount`,不再 `pass+look+wake`
- [ ] `bun test src/stats.test.ts` 通过(补 eventCount 断言)
- [ ] 验证: `bun test src/stats.test.ts 2>&1 | grep -q ' 0 fail' && grep -q 'eventCount' src/stats.ts && echo PASS || echo FAIL`

### US-011: 导航名与页内 h1 统一(「越界记录」)
**Description:** As a 用户, I want 点「越界记录」进去标题还是「越界记录」, so that 不会以为进错了页面。

**Acceptance Criteria:**
- [ ] 越界页 h1 与导航名一致,保留「越界记录」主词
- [ ] 验证: `grep -q '越界记录' web/app.js web/index.html && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill

### US-012: URL hash 深度链接可恢复
**Description:** As a 用户, I want 复制 `/#danger` 链接给别人能直达危险地图、刷新也停在原页, so that 深度链接可分享。

**Acceptance Criteria:**
- [ ] 页面初始化优先读 `location.hash.slice(1)` 匹配 NAV id 作为初始路由
- [ ] `nav()` 切页时同步写 `location.hash`
- [ ] 验证: `grep -q 'location.hash' web/app.js && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill

### US-013: 处理 OPTIONS preflight + 补全 CORS 头
**Description:** As a 跨端口前端调用方, I want preflight 不被 404 阻断, so that Vite dev 等不同端口下 POST 端点可用。

**Acceptance Criteria:**
- [ ] `handle` 入口对 `OPTIONS` 返回 204 + `Access-Control-Allow-Methods` + `Access-Control-Allow-Headers`
- [ ] `JSON_HEADERS` 补全 Methods/Headers
- [ ] 验证: `bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; H=$(curl -s --noproxy '*' -i -X OPTIONS http://127.0.0.1:4799/api/inbox/decision); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$H" | grep -qi 'Access-Control-Allow-Methods' && echo PASS || echo FAIL`

### US-014: `/api/*` 未命中路由返回 JSON 404
**Description:** As a 调用方, I want API 404 也是 JSON, so that 客户端能统一解析错误而不在纯文本上崩。

**Acceptance Criteria:**
- [ ] `path.startsWith("/api/")` 未命中时返回 `{ok:false,reason:"Not Found"}` + `JSON_HEADERS` + 404
- [ ] 非 `/api/` 路径维持现有静态文件 404 行为
- [ ] 验证: `bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; B=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/nonsense); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$B" | grep -q '"ok":false' && echo PASS || echo FAIL`

### US-015: `serve` 端口被占用时给友好提示而非栈崩溃
**Description:** As a 用户, I want 端口被占用时看到清晰提示, so that 不被一堆 EADDRINUSE 栈吓到。

**Acceptance Criteria:**
- [ ] `startLocalServer` try/catch `Bun.serve`,EADDRINUSE 时打印「端口 N 已被占用,试 `--port N+1`」并 `process.exit(1)`
- [ ] 不再打印原始 `EADDRINUSE` 栈
- [ ] 验证: `bun run src/cli.ts serve --port 4798 >/tmp/v1.log 2>&1 & sleep 2; bun run src/cli.ts serve --port 4798 >/tmp/v2.log 2>&1; lsof -ti :4798 | xargs kill -9 2>/dev/null; grep -Eq '已被占用|in use|--port' /tmp/v2.log && ! grep -q 'EADDRINUSE' /tmp/v2.log && echo PASS || echo FAIL`

### US-016: favicon 不再 404
**Description:** As a 用户, I want 控制台不在 console 报 favicon 404, so that 控制台干净无噪音。

**Acceptance Criteria:**
- [ ] `/favicon.ico` 返回内联 svg/data-uri 或 204
- [ ] 验证: `bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:4799/favicon.ico); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" != "404" && echo "PASS $C" || echo FAIL`

### US-017: `/api/daily/today?date=` 校验日期格式
**Description:** As a 调用方, I want 非法日期返回 400 而非全零 200, so that 能区分「该天零数据」和「日期格式错」。

**Acceptance Criteria:**
- [ ] daily/today 加 `/^\d{4}-\d{2}-\d{2}$/` 校验,不合法返回 400 JSON
- [ ] 合法日期行为不变
- [ ] 验证: `bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:4799/api/daily/today?date=bad"); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo PASS || echo "FAIL $C"`

### US-018: `/api/ai/ask` 缺 question 返回 400
**Description:** As a 调用方, I want 缺 question 返回 400(与 inbox/decision 一致), so that 错误码语义统一。

**Acceptance Criteria:**
- [ ] ask 缺 question 时 `new Response(...,{status:400,headers:JSON_HEADERS})`
- [ ] 验证: `bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:4799/api/ai/ask); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo PASS || echo "FAIL $C"`

### US-019: 规则页底部空白补 inline 引导
**Description:** As a 用户, I want 规则页底部别一片空白, so that 不显未完成、并知道怎么加规则。

**Acceptance Criteria:**
- [ ] 规则页渲染补一行引导文字 + 链接(如「如何添加规则」)
- [ ] 验证: `grep -Eq '如何添加|添加规则|新增规则' web/app.js && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill

### US-020: AI 联网调用前显式隐私披露
**Description:** As a 注重代码隐私的用户, I want 在把代码发给 DeepSeek 之前就被告知, so that 不会在「本机只读·不联网」标语下被意外上云。
(决策:AI 功能全部保留,只加披露。)

**Acceptance Criteria:**
- [ ] Ask Guard 对话框打开时,输入框上方静态显示「问题与相关代码上下文将发送到 <模型/供应商>」
- [ ] 侧边栏标语从「本机只读 · 不联网」改为准确描述(如「数据本地存储 · Ask Guard 联网除外」)
- [ ] 所有联网 AI 入口(整理/规则进化/Ask Guard)均有一致的事前披露
- [ ] 验证: `grep -Eq '将发送|联网除外|上云|发送到' web/index.html web/app.js && echo PASS || echo FAIL`
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: 审查队列必须对 history 项按 `repo:rule:file` 聚合为单条,并暴露 `hitCount`/`firstSeen`。(US-001)
- FR-2: 审查队列默认只返回 live 来源;history 仅在 `includeHistory:true` 时返回,默认供「守门记录」页。(US-003)
- FR-3: 路径规则的 `severity` 必须区分使用 `wake-you-up` 与 `look-once`,常规清单类用后者。(US-002)
- FR-4: 偏离检测在任务描述信息量不足时返回 `drift=null` + 文案提示,前端区别于 `drift=0`。(US-004)
- FR-5: 所有 POST 端点必须先读 text 再 parse,空 body 不得挂起。(US-005)
- FR-6: `OPTIONS` 请求返回 204 + 完整 CORS 头;`JSON_HEADERS` 含 Methods/Headers。(US-013)
- FR-7: `/api/*` 未命中返回 JSON 格式 404。(US-014)
- FR-8: `serve` 端口占用时友好提示并退出码 1,不打印原始栈。(US-015)
- FR-9: `/favicon.ico` 不返回 404。(US-016)
- FR-10: `/api/daily/today` 校验日期格式,非法 400。(US-017)
- FR-11: `/api/ai/ask` 缺 question 返回 400。(US-018)
- FR-12: 前端:nudge 关闭持久化、裁决按钮 sticky、hash 路由可恢复、对比度达标、首页定位说明、术语 tooltip、时间线真实计数、导航/h1 一致、规则页引导、AI 隐私披露。(US-006~012, 019, 020)
- FR-13: 不得破坏现有 72 单测、数据一致性(34/20/26/41.2% 口径)、路径遍历安全。(全局回归)

## Non-Goals (Out of Scope)

- **移动端响应式重写(P1-2 / P2-7)**:375px 崩溃、768px KPI 堆叠需新增整套响应式 CSS + 真机视觉验收,
  不在本轮可机器验证范围内,单独立项。
- **AI 上下文注入修复的 AI 实测(P2-1)**:Ask Guard「6 条 vs 30 条」需起真实 AI 服务断言回答内容,
  本 PRD 只在 US-020 修披露;数字一致性单列后续。
- **功能收敛/砍页面**:用量与成本页、越界记录与规则合并等属产品方向决策,见 Open Questions,本轮不动。
- **AI 默认模型 id 核对(P3-5)**:需核对供应商文档,非代码改动,留 Open Question。
- **不改 AI 开关默认值**:决策为「保留全部,只加披露」,不把 AI 改为默认 opt-in。

## Design Considerations

- 复用现有暖棕/米色设计系统与组件,不引入新视觉语言(测试确认其克制专业、无 AI slop)。
- 对比度调整只动颜色值,不动版式。
- nudge/sticky/tooltip 复用既有组件类,避免新增样式碎片。
- 「守门记录」页消费 US-001 的聚合数据,与审查队列共享聚合函数。

## Technical Considerations

- 运行时:bun + TypeScript,`Bun.serve`。验证命令依赖本机 `--noproxy '*'`(系统代理劫持 localhost)。
- 隐私铁律:`events.jsonl` 只存元数据无 diff 正文;live 正文只流 localhost,绝不上报。聚合/排除逻辑不得违反。
- 验证端口统一用 4799/4798,命令自带起停,避免与默认 4757 冲突。
- 每个 US 完成后单独 git commit;全部完成后跑一次 `bun test` 全量 + `tsc --noEmit` 回归。

## Success Metrics

- 审查队列条数从「32 条含 11 个唯一项重复」降到「仅 live + 唯一项」,无重复 file@rule。
- `look-once` 在 rules.ts 实际被使用 ≥1 处;自动放行率随常规改动降级而上升(目标 >60%)。
- 偏离检测对低信息任务不再输出 0% 安全态。
- 所有 P0~P3 验证命令打印 `PASS`;`bun test` 保持 0 fail;`tsc --noEmit` 干净。
- 新用户首屏能在 5 秒内读到产品定位句。

## Open Questions

> 来自 PM 视角的 5 个产品方向问题,需作者拍板,本 PRD 不预设方向:

1. **功能发散 vs 收敛**:8 个页面仅 2~3 个服务核心价值,README 写「不是又一个 dashboard」却在变 dashboard。
   是否把「用量与成本」整条分区拆为独立 opt-in 插件?
2. **AI 隐私敞口**:3 个 AI 功能叠加与「代码不离开机器」叙事冲突。US-020 只加披露;
   是否进一步把 Ask Guard 对话窗砍掉、只留「规则进化」?
3. **护城河叙事重心**:MCP `check_diff_risk`(让 agent 自审,有利益冲突、易被 Claude Code 原生吃掉)
   vs pre-push hook 的强制人确认(agent 绕不过)。叙事是否收回到后者?
4. **冷启动价值**:首日 events.jsonl 为空全是 demo。是否首次安装扫最近 N 个 commit 历史,
   30 秒内产出真实回顾,把 aha moment 提前?
5. **越界记录(飞行记录)与守门规则高度重叠**(都盯 `.env`/secret)。
   是否合并为「碰冻结路径 = 更高优先级 wake」,避免两处维护两套敏感路径定义?

附:**AI 默认模型 id** `deepseek-v4-pro` 是否为真实可用值需核对(发错则静默降级,体验是「点了没反应」)。
