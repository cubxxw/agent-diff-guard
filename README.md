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

## 快速开始

### 前置要求

只需要 [Bun](https://bun.sh) ≥ 1.3(规则引擎和 CLI 都是零运行时依赖的 TypeScript)。

```bash
curl -fsSL https://bun.sh/install | bash   # 没装 Bun 的话
```

### 安装

```bash
git clone https://github.com/cubxxw/agent-diff-guard
cd agent-diff-guard
bun install
bun src/cli.ts --help     # 看到帮助 = 装好了
```

### 用法一:手动扫一次当前改动

在**你自己的项目**里,让 agent 改完代码后、push 之前:

```bash
bun /path/to/agent-diff-guard/src/cli.ts check \
  --range HEAD \
  --task "你这次让 agent 干的事,一句话"
```

- `--range`:要检查的范围。`HEAD` = 当前所有改动;`@{u}..HEAD` = 领先远端的改动。
- `--task`:你声称的任务。给了它,守门人才能做「任务 vs 实际改动」的偏离检测。
- 退出码:`0` 放行 / `1` 该看一眼 / `2` 用法或读取错误。

### 用法二:装成 pre-push hook(push 前自动刹车,推荐)

```bash
# 在 agent-diff-guard 目录下,把守门人装到目标仓库
./install.sh /path/to/your/repo
```

装好后,每次 `git push` 前守门人会自动跑。平时静默放行;只有发现该看一眼的改动时才刹车。

## 看懂输出

**没事时**(绝大多数 push)——一行,放行:

```
✓ agent-diff-guard: 这批改动没有该半夜惊醒的东西,放行。
```

**有事时**——把最该看的拎到你眼前(最多 3 处,绝不刷屏):

```
  agent-diff-guard — 合并前请看一眼

  ● .github/workflows/deploy.yml  [ci-pipeline]
    改动了 CI/CD 流水线 —— agent 动这里可能改变构建/发布/权限行为

  ● config.ts  [hardcoded-secret]
    新增了疑似硬编码的密钥/令牌 —— 一旦合并入库几乎不可撤回
    ↳ const apiKey = "sk_live_a1b2c3d4e5f6g7h8i9";

  ● foo.test.ts  [test-deleted]
    删除或大幅削减了测试 —— agent 可能在用'删测试'来让 CI 变绿
```

> 上面这个例子来自一次真实场景:agent 声称"更新文档措辞",实则动了 CI、删了测试、加了硬编码密钥。守门人在 push 前把这三处刹住了。

**被拦后怎么办:** 看一眼那 1–3 处。确认确实没问题,就用 `git push --no-verify` 显式放行。守门人的工作不是替你拍板,是逼你在合并前**有意识地看一次**。

## 状态

v0.0.1 — 单兵 dogfood 阶段。规则引擎 + diff 解析 + 偏离检测 + pre-push hook 已端到端跑通。

### 已知待办(dogfood 暴露)
- [ ] 范围计算:同一 commit 内多类雷在增量 push 时可能漏报(`@{u}..HEAD` vs 全量)
- [ ] 偏离检测目前是词面关联,需升级为语义判断
- [ ] 规则可配置化(每个仓库自定义敏感路径)
- [ ] GitHub Marketplace 分发 / PR 评论形态(团队版留存抓手)

## 设计与路线

- [**docs/DESIGN.md**](./docs/DESIGN.md) — 为什么这个位置存在、护城河在哪、谁会付钱、定价怎么定、最大的风险是什么。
- [**docs/ROADMAP.md**](./docs/ROADMAP.md) — 从单兵 CLI → 团队 PR 守门 → 企业治理层的形态演进,以及"始终不做的事"。

## 贡献

欢迎,但门槛很硬:**误报是头号敌人**。新增规则必须附带「不误报」测试用例。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE) © Xinwei Xiong (cubxxw)
