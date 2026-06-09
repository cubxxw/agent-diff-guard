# agent-diff-guard

> 合并前的 **agent 改动守门人**。当 agent 在你没盯着时改了该看一眼的东西,它在合并前把那 1–3 处拎到你眼前,逼一次确认。平时安静放行,关键时刻刹车。

不是又一个通用 coding agent,也不是 dashboard。它站在一个 agent 时代才出现的新位置上:**一个人 × N 个 agent**——你的 agent 们够强了,但你不知道它们趁你没注意改了什么。OpenClaw / Claude Code / 各家 harness 的 KPI 是"让 agent 写出代码";一个怀疑 agent、要审 agent 的工具,它们结构上不会做。这个位置是空的。

## 它解决的那个瞬间

你派了 4 个 agent 去干活。一个本该只改文档,却顺手动了 CI;一个为了让测试变绿,直接把测试删了;一个新增了一行硬编码密钥。它们都会安静地通过 review 溜进主干——**直到出事你才知道**。

`agent-diff-guard` 在 `git push` 前拦住这一刻。

## 设计原则:宁可漏,不可烦

第一版只抓"几乎一定该让人看一眼"的改动,误报压到接近零。抓得准 >> 抓得全——因为一个老是误报的守门人,三天就会被关掉。

当前会半夜叫醒你的几类雷:
- 改动 CI/CD 流水线、Dockerfile、Terraform、K8s 清单
- 改动依赖清单(供应链)、`.env`、鉴权/权限/密钥相关路径
- 删除或大幅削减测试(agent 让 CI 变绿的廉价作弊)
- 新增疑似硬编码的密钥/令牌

加上一个 CI/lint 做不了、agent 时代独有的判断——**任务 vs 实际改动的偏离**:你声称的任务是 A,agent 却顺手改了和 A 无关的 B。

## 用法

```bash
# 手动扫当前改动
bun src/cli.ts check --range HEAD --task "本次任务的一句话描述"

# 装到任意仓库的 git hook(push 前自动刹车)
./install.sh /path/to/your/repo
```

被拦后,看一眼;确认无碍用 `git push --no-verify` 放行。

## 状态

v0.0.1 — 单兵 dogfood 阶段。规则引擎 + diff 解析 + 偏离检测 + pre-push hook 已端到端跑通。

### 已知待办(dogfood 暴露)
- [ ] 范围计算:同一 commit 内多类雷在增量 push 时可能漏报(`@{u}..HEAD` vs 全量)
- [ ] 偏离检测目前是词面关联,需升级为语义判断
- [ ] 规则可配置化(每个仓库自定义敏感路径)
- [ ] GitHub Marketplace 分发 / PR 评论形态(团队版留存抓手)
