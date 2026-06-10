# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com) 与 [语义化版本](https://semver.org)。

## [Unreleased]

### 新增:面板扩展为三标签(今日 Daily / 成本 / 守门)
- **今日 Daily**(`src/daily.ts`):对标 agentboard 的每日活跃度仪表盘。解析 `~/.claude/projects` session 日志,按天聚合 token(in/out/cache)、消息数(AI/User)、工具调用、活跃时长(消息时间戳聚集度估算,>5min 间隔算离开)、项目数、估算成本。支持按日期回看 + 30 天趋势 + 历史明细表。
- **成本 / Session**(`src/sessions.ts`):各项目/仓库累计 token 消耗排行 + 最近 session 列表,回答"哪个项目最烧钱"。
- 面板(`web/index.html`)重构为三标签页;`serve-local.ts` 新增 `/api/daily/*` 与 `/api/sessions/*` 路由,加 30s TTL 内存缓存(冷请求扫盘 ~10s → 热请求 ~17ms)。
- 隐私红线延续:session/成本数据只在本机聚合,不联网不上传;成本为按模型单价的估算。
- 新增 `src/sessions.test.ts` / `src/daily.test.ts`(含活跃时长算法测试)。

### 新增:本地审计面板
- **事件日志层**(`src/event.ts` / `src/logger.ts` / `src/id.ts` / `src/hash.ts`):每次 `check` 把一条只含元数据的 `GuardEvent` 追加到 `~/.agent-diff-guard/events.jsonl`。隐私红线:evidence 正文、task 原文、git email 原文绝不落盘(只记 hash 与统计),有单元测试守住。
- **聚合层**(`src/stats.ts`):ruleRank / timeline / dispositions / overview 四个纯函数聚合。
- **本地服务**(`src/serve-local.ts`):`agent-diff-guard serve` 用 `Bun.serve()` 起本地只读面板,实时聚合 events.jsonl,零上传、零依赖。
- **Web 面板**(`web/index.html`):单文件、零依赖、零构建。GitHub 暗色风,展示风险趋势(SVG 折线)、高发规则排行、放行审计流。服务 tech lead/合规的周期性审计,不是实时大屏。
- `cli.ts`:新增 `serve` 子命令;`check` 末尾落审计事件(失败不影响守门退出码)。
- 新增 `src/stats.test.ts` / `src/event.test.ts`(含隐私红线回归测试)。

### 工程化
- 补齐生产级开源仓库基建:LICENSE (MIT)、`tsconfig.json` (strict)、GitHub Actions CI(类型检查 + 测试 + 自我 dogfood)、CONTRIBUTING、issue/PR 模板。
- 新增 `docs/DESIGN.md`(产品设计与商业化方向)与 `docs/ROADMAP.md`(形态演进路线)。

## [0.0.1] - 2026-06-10

首个端到端跑通的单兵 dogfood 版本。

### 新增
- **规则引擎**(`src/rules.ts`):敏感路径(CI/CD、Dockerfile、Terraform、K8s、`.env`、依赖清单、鉴权路径)+ 内容级规则(删测试、疑似硬编码密钥)。
- **diff 解析**(`src/scan.ts`):把 `git diff -U0` 解析成结构化 `FileChange[]`。
- **偏离检测**(`src/scan.ts`):任务描述 vs 实际改动的词面关联,标出"顺手改"的任务范围外文件。
- **CLI**(`src/cli.ts`):`check --range --task --max`,退出码 0 放行 / 1 刹车。
- **pre-push hook** + `install.sh`:一行装到任意仓库,push 前自动刹车。
- 回归测试:命中用例 + 误报防线用例(后者与前者同等重要)。

[Unreleased]: https://github.com/cubxxw/agent-diff-guard/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/cubxxw/agent-diff-guard/releases/tag/v0.0.1
