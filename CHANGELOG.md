# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com) 与 [语义化版本](https://semver.org)。

## [Unreleased]

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
