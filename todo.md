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

- [ ] **P0-3 审查队列只放 live(当下未 push);history 不再回流伪装成"待裁决"**
  根因:`buildHistory` 把所有 `blocked` 历史 wake 全回流,15 天前已合并的改动还在"等裁决",diff 正文已无。
  改:`buildQueue` 默认不含 history(或加 `includeHistory` 选项默认 false);queue 仅 live + 必要时 demo。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/findings.test.ts 2>&1 | grep -q ' 0 fail' && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; U=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/findings); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$U" | bun -e 'const it=JSON.parse(await Bun.stdin.text()); const h=it.filter(i=>i.origin==="history"); if(h.length){console.error("FAIL 队列仍含 history 项:",h.length);process.exit(1)} console.log("PASS 队列无 history 回流项,共",it.length,"条")'

- [ ] **P0-4 偏离检测对无信息量/中文任务兜底:任务描述不足时提示"无法判断偏离"而非默认 0% 安全**
  根因:词面匹配对"继续分析解决问题"等中文/短任务无词可匹配 → drift=0% 被当作安全。
  改:`ai.ts`/`findings.ts` 偏离计算前判定任务描述是否"信息量不足"(长度阈值 + 停用词如 继续/修复/解决/重启),
  不足时 drift 返回 null + reason 标注"任务描述不足以判断偏离",前端区别于 0%。补单测。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test 2>&1 | grep -q ' 0 fail' && grep -Eq '不足以判断|信息量不足|低信息|insufficient' src/ai.ts src/findings.ts && echo PASS || echo FAIL

---

## 🟠 P1 —— 高优先级体验 / 健壮性

- [ ] **P1-3 `POST /api/ai/analyze` 空 body 不再挂起(先读 text 再 parse)**
  改:`serve-local.ts` 把 `await req.json()` 改为 `const t=await req.text(); const body=t?JSON.parse(t):{}`(analyze + ask 等所有 POST)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:4799/api/ai/analyze); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" != "000" && echo "PASS 空body返回 $C(未挂起)" || echo "FAIL 仍挂起/超时"

- [ ] **P1-4 Nudge 提醒关闭后持久化,当次会话不再重弹**
  改:`web/app.js` "知道了"写 `sessionStorage`(键含当前 wake count),渲染前检查;活动列表底部留 `padding-bottom`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -Eq 'sessionStorage|localStorage' web/app.js && grep -Eq 'nudge|dismiss' web/app.js && echo PASS || echo FAIL

- [ ] **P1-5 审查队列裁决按钮(放行/驳回/误报)改 sticky,长 diff 滚动不丢失操作区**
  改:`web/index.html`/`app.js` 的 `.qd-actions` 加 `position:sticky;bottom:0` + 背景/阴影。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -A4 '\.qd-actions' web/index.html web/app.js 2>/dev/null | grep -q 'sticky' && echo PASS || echo FAIL

- [ ] **P1-6 通知 badge / muted 文字对比度达 WCAG AA**
  改:badge 背景 `#A66A00→#8A5800`,muted hint `#A39F99→#857F79`(在 index.html/app.js 的 CSS)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && ! grep -iq '#A39F99' web/index.html web/app.js && ! grep -iq '#A66A00' web/index.html web/app.js && echo PASS || echo FAIL

- [ ] **P1-7 首页加一行产品定位说明 + 核心术语 tooltip**
  改:`web/index.html` header/hero 加定位句(如"AI agent 改动守门人:平时放行,关键时刻刹车");
  KPI/术语(wake-you-up 等)加 `title=`/`(?)` tooltip。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -Eq '守门人|平时放行|关键时刻' web/index.html && echo PASS || echo FAIL

---

## 🟡 P2 —— 中优先级一致性 / 正确性

- [ ] **P2-2 时间线 tooltip 不再混加单位(用真实扫描次数)**
  改:`stats.ts` timeline 增 `eventCount`(当天扫描次数);`app.js:~157` tooltip 用 `eventCount` 而非 `pass+look+wake`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun test src/stats.test.ts 2>&1 | grep -q ' 0 fail' && grep -q 'eventCount' src/stats.ts && echo PASS || echo FAIL

- [ ] **P2-3 导航名与页内 h1 统一("越界记录")**
  改:`web/app.js`/`index.html` 越界页 h1 与导航名一致(保留"越界记录"主词)。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q '越界记录' web/app.js web/index.html && echo PASS || echo FAIL

- [ ] **P2-4 URL hash 深度链接可恢复(初始化读 location.hash)**
  改:`web/app.js` 初始化优先 `location.hash.slice(1)` 匹配 NAV id;`nav()` 同步写 hash。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && grep -q 'location.hash' web/app.js && echo PASS || echo FAIL

- [ ] **P2-5 处理 OPTIONS preflight + 补全 CORS 头**
  改:`serve-local.ts` `handle` 入口对 `OPTIONS` 返回 204 + `Access-Control-Allow-Methods/Headers`;`JSON_HEADERS` 补 Methods/Headers。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; H=$(curl -s --noproxy '*' -i -X OPTIONS http://127.0.0.1:4799/api/inbox/decision); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$H" | grep -qi 'Access-Control-Allow-Methods' && echo PASS || echo FAIL

- [ ] **P2-6 `/api/*` 未命中路由返回 JSON 404(而非纯文本)**
  改:`serve-local.ts` 对 `path.startsWith("/api/")` 未命中返回 `{ok:false,reason:"Not Found"}` + JSON_HEADERS + 404。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; B=$(curl -s --noproxy '*' http://127.0.0.1:4799/api/nonsense); lsof -ti :4799 | xargs kill -9 2>/dev/null; echo "$B" | grep -q '"ok":false' && echo PASS || echo FAIL

---

## 🟢 P3 —— 低优先级 / 打磨

- [ ] **P3-1 `serve` 端口被占用时给友好提示而非栈崩溃**
  改:`serve-local.ts` `startLocalServer` try/catch `Bun.serve`,EADDRINUSE 时打印"端口 N 已被占用,试 --port N+1"并退出码 1。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4798 >/tmp/v1.log 2>&1 & sleep 2; bun run src/cli.ts serve --port 4798 >/tmp/v2.log 2>&1; lsof -ti :4798 | xargs kill -9 2>/dev/null; grep -Eq '已被占用|in use|--port' /tmp/v2.log && ! grep -q 'EADDRINUSE' /tmp/v2.log && echo PASS || echo FAIL

- [ ] **P3-2 favicon 不再 404**
  改:`serve-local.ts` 对 `/favicon.ico` 返回内联 svg/data-uri 或 204。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:4799/favicon.ico); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" != "404" && echo "PASS favicon=$C" || echo FAIL

- [ ] **P3-3 `/api/daily/today?date=` 校验日期格式,非法返回 400**
  改:`serve-local.ts` daily/today 加 `/^\d{4}-\d{2}-\d{2}$/` 校验,不合法 400 JSON。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:4799/api/daily/today?date=bad"); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo PASS || echo "FAIL got $C"

- [ ] **P3-4 `/api/ai/ask` 缺 question 返回 400(与其他 POST 一致)**
  改:`serve-local.ts` ask 缺 question 时 `new Response(...,{status:400,headers:JSON_HEADERS})`。
  验证: `cd /Users/xiongxinwei/data/mine/cubxxw/personal/agent-diff-guard && bun run src/cli.ts serve --port 4799 >/tmp/v.log 2>&1 & sleep 2; C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:4799/api/ai/ask); lsof -ti :4799 | xargs kill -9 2>/dev/null; test "$C" = "400" && echo PASS || echo "FAIL got $C"

- [ ] **P3-6 规则页底部空白补 inline 引导("如何添加规则")**
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
