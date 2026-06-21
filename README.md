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

### 为什么是"边界闸门",而不是"逐行审查"

业界与学术对 agent loop 监督的一个被反复验证的结论是:让人**逐行审查每个 diff** 既不可持续也不可靠——人会疲劳、会橡皮图章。有效的做法是把人类判断上移到工作流的**两个边界**:开头定规约 / 护栏 / 依赖白名单,结尾验安全 / 结果。这正是本产品"平时放行、关键时刻刹车"哲学的背书。

在 loop 验证层(`agent-diff-guard loop`)里这两道边界闸门是显式的:

- **开头闸门** — `.loop-contract.yaml`(`src/loop/contract.ts`)要求每个无人值守 loop 启动前声明六个字段:`trigger / scope / action / budget / stop / escalate`。规约不全就不放行。
- **结尾闸门** — `loop verify`(`src/loop/verify.ts`)在 session 结束时跑一次**汇总验收**:把整个 session 的累计 drift、命中的 wake-you-up findings、policy 违规、预算消耗汇总成一个边界裁决 `pass / needs-review`。这与逐次迭代的 `loop check` 不同——它审的是**整个 session**,而不是每个 diff。

```bash
agent-diff-guard loop verify            # 对 active session 出结尾裁决(needs-review 时退出码 1)
agent-diff-guard loop verify --json     # 机器可读,便于接 CI / 通知
```

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
bun src/cli.ts --help        # 命令跑通
bun src/cli.ts doctor        # 接入自检:回答"我接好了吗"(事件/采集源/仓库)
```

> **命令读法**:本包尚未发布到 npm,全局命令 `agent-diff-guard` 默认不可用。
> 下文为简洁写作 `agent-diff-guard <cmd>`,**请读作 `bun src/cli.ts <cmd>`**(在本仓库目录下),
> 或自行设别名:`alias agent-diff-guard='bun /绝对路径/agent-diff-guard/src/cli.ts'`。
> "装好了"的真正里程碑不是看到 `--help`,而是 `doctor` 显示有守门事件 / 已识别采集源。

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

### 用法三:挂进 Claude Code,**编码前**实时刹车

pre-push 是"提交前"那道闸;再往前一步,可以在 agent **动手改文件之前**就刹车——
通过 Claude Code 的 PreToolUse hook。生成配置:

```bash
bun src/cli.ts loop install-hook --agent claude    # 输出一段 settings.json,贴进去即可
```

把输出贴进 `~/.claude/settings.json` 或 `<项目>/.claude/settings.json` 的 `hooks` 里。
高危改动(改 CI / 写密钥 / 动鉴权)在 agent 落笔前就弹人工确认(ask),平时静默放行。
只看 agent 声明的入参、不读 diff 正文,隐私不出本机。装完跑 `bun src/cli.ts doctor` 验证。

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

## 反过来用:把守门人变成 agent 的"编码前输入"

守门人平时是**下游**——agent 改完才检查。但它积累的判断("哪些路径碰了就出事"+"本仓库历史实际踩过哪些雷")正是 agent 动手前**最该先知道**的。`context` 子命令把这份"危险地图"翻出来,喂回 agent,让它**改之前避开雷**,而不是改完被刹:

```bash
agent-diff-guard context              # 输出 Markdown,直接读进 agent 的 system prompt
agent-diff-guard context --json       # 输出 JSON,给程序消费(MCP / CI)
agent-diff-guard context > .agent-guard.md   # 落盘,让 Claude Code / Cursor 当上下文加载
```

输出包含两部分:**通用高危区**(CI/容器/IaC/K8s/env/依赖/鉴权,来自固化规则)+ **本仓库历史实际命中**(从本机审计记录聚合,优先级更高——说明这个仓库在此处尤其容易出事)。和审计一样:**只输出路径与规则,绝不含代码正文**,所以可以放心交给任何 agent。

> 这把 agent-diff-guard 从"事后判官"变成了"事前顾问"。同一套固化的 DevOps 判断力,既守门、又能在 agent 编码时提前提醒。

## 🔌 MCP Server:让任何 agent 自己调用守门能力

上面的 `context` 是"用户手动喂给 agent"。再进一步:把 agent-diff-guard 包成 **MCP server**,让 **Claude Code / Cursor / Cline 等任何支持 MCP 的 agent 自己主动调用**——从"用户装的工具"升级成"agent 工具箱里的能力"。

暴露 4 个 tool:

| tool | agent 什么时候调 | 复用的能力 |
|---|---|---|
| `check_diff_risk` | 写完一段代码后、建议提交前 | 守门规则 + 偏离检测 |
| `get_repo_danger_map` | 开始编码前,先知道哪些区危险 | 危险地图 |
| `get_rule_insights` | 想知道某规则是真风险还是噪音 | 规则进化洞察(已脱敏) |
| `list_pending_decisions` | 取人在面板上下发的指令 | 信箱 |

**配置(跨 agent 通用,格式一致,只改路径)**:

```jsonc
// Claude Code: .mcp.json(项目根)或 ~/.claude.json
// Cursor:      .cursor/mcp.json
// Cline:       cline_mcp_settings.json
{
  "mcpServers": {
    "agent-diff-guard": {
      "command": "bun",
      "args": ["run", "/绝对路径/agent-diff-guard/src/mcp.ts"]
    }
  }
}
```

配好后,agent 在编码时就会自己调用——比如写完改动后调 `check_diff_risk`,合并前自己就发现"动了 CI / 加了密钥"。这正是 MCP 官方 roadmap 点名缺失的"audit trail / 守门"能力,以本地、跨 agent、不传代码正文的形态补上。

> 走 stdio transport,本机运行、零网络。stdout 只走协议、日志走 stderr。除规则进化洞察(opt-in,已脱敏)外,其余 tool 都只返回路径/规则元数据,不含代码正文。

## 🛡 飞行记录 · 越界检测:看着 agent 有没有越界

2025 年 Replit 的 AI agent 在被明确告知"代码冻结、未经许可不准改"的情况下,**删了客户的生产数据库,还撒谎说无法回滚**。问题不在"AI 不会干活",而在**没人盯着 agent 实际做了什么、有没有违反人定下的规矩**。

市面上的 AI 工具(CodeRabbit / Greptile)学的是**人写 PR 的偏好**;agent-diff-guard 的飞行记录抓的是**AI agent 实际越了什么界**——这是 agent 时代缺失的治理层。

**怎么用**:在仓库根放一个 `.agent-policy.json` 定义"规矩",记录仪就会从 session 历史里抓出违反(确定性检测,非 LLM,零误判;**只记录、不阻断**,供复盘):

```jsonc
{
  "policies": [
    {
      "kind": "frozen-path",
      "name": "禁动密钥与环境文件",
      "paths": [".env", "secret", "credential"],
      "reason": "生产密钥敏感,agent 改这些前必须人工确认"
    },
    {
      "kind": "freeze-window",
      "name": "发布冻结期",
      "from": "2026-06-28T00:00:00Z",
      "to": "2026-07-02T23:59:59Z",
      "reason": "季度发布冻结,期间不准有任何改动"
    }
  ]
}
```

面板的 **🛡 飞行记录 · 越界** 区会显示:哪个 agent、何时、违反了哪条规矩、改了什么、当时声称在做什么任务(密钥已脱敏)。这是把"宁可漏不可烦"的守门哲学,延展到 agent 行为治理的尺度——**你不是又一个替你干活的 AI,你是 agent 时代缺失的那个审计员**。

> 第一版支持两类确定性规矩:`frozen-path`(禁改路径/文件)、`freeze-window`(冻结时间窗)。规矩由你显式定义,没配置就没规矩——绝不无中生有地报警。

## 本地面板(只读、不联网、零上传)

```bash
bun src/cli.ts serve          # 默认 http://localhost:4757
bun src/cli.ts serve --port 8080
```

面板有三个标签页,全部本机只读、刷新看最新(周期性审计,不是实时盯的大屏):

> **关于加载速度**:成本/Daily 标签要解析 `~/.claude/projects` 下的全部 session 日志(可能几 GB)。**首次启动会扫一遍建缓存**(按文件数,几十秒到几分钟);之后用增量磁盘缓存(`~/.agent-diff-guard/*-cache.json`),**只重解析当天动过的文件**,再进面板基本秒开。缓存按文件 mtime/size 指纹失效,数据始终与日志一致;缓存损坏会自动降级为全量重建。

### 📊 今日 Daily
对标 agentboard 的"今天和 agent 干了多少活"。数据来自 `~/.claude/projects` 的 session 日志:

- **活跃时长**(按消息时间戳的聚集度估算,>5 分钟间隔算离开)+ 会话跨度 + 倍率
- **token 消耗**:总量 / 输入 / 输出 / 缓存读取 / 缓存命中率
- **消息数**(AI vs 你)、**工具调用数**、**项目数**、**估算成本**
- 顶部可选任意日期回看;下方是 30 天 token 趋势折线 + 历史每日明细表

### 🛡 守门审计
每次 `check` 都会把一条**只含元数据**的事件追加到 `~/.agent-diff-guard/events.jsonl`(绝不记录代码正文、密钥原文、任务原文 —— 只记 rule/path/时间/统计与 hash)。面板回答 tech lead / 合规的审计问题:

- **风险趋势** — 风险水位在升还是降?哪天异常爆发?
- **高发规则排行** — agent 最常碰哪类危险区?(密钥?CI?供应链?)
- **放行审计流** — 每条 wake-you-up 改动最终被拦了还是被谁放行了?

### 💰 成本 / Session
各项目/仓库的累计 token 消耗排行 + 最近 session 列表。回答"哪个项目最烧钱、哪个 session 在失控"。

## 🤖 AI 整理 + 回调终端(可选,需配 key)

守门审计标签下有一块 **AI 整理** 区,把闭环补完:面板不只是给你看历史,还能让 AI 把这堆审计元数据**总结成态势 + 可执行建议**,你在面板上点选后,建议会**回到终端的 Claude Code 继续执行**。

```
面板点「分析整理」→ DeepSeek 总结 → 摘要 + 几条建议卡片
   → 你点「发送到终端 Claude Code」→ 写入本地信箱
   → 终端 `agent-diff-guard inbox` 读到这条指令 → Claude Code 接着干
```

**启用方式**:复制 `.env.example` 为 `.env`,填入 `DEEPSEEK_API_KEY`。配了 key 面板就自动出现 AI 区;不配则这块隐藏,其余功能照常。

**终端侧消费**(闭环的另一端):
```bash
agent-diff-guard inbox                 # 列出面板下发的待办决策
agent-diff-guard inbox --json          # JSON 形式,给 Claude Code 程序消费
agent-diff-guard inbox --done <id>     # 处理完归档留痕
```
信箱在 `~/.agent-diff-guard/inbox/`(`pending/` 待办、`done/` 归档),纯文件、可审计——谁在何时让 agent 做了什么,都留痕。

> **AI 的隐私边界(重要)**:启用 AI 后,这是产品里**唯一会联网的一环**,而且只发送**去敏元数据**(规则名 / 文件路径 / 计数),由代码里的 `assertNoSourceLeak()` 在发送前断言把关——**绝不发送代码正文、密钥原文、任务原文、diff 内容**。不配 key 就完全不联网。`.env` 已被 `.gitignore`,key 绝不入库。

## 🔄 规则进化:会学习的守门人(闭环,需配 key)

静态规则的命门是:同一条规则在不同仓库,可能是真危险、也可能是纯噪音。**规则进化**让守门人从你的真实使用历史里学会区分这两者——这是市面上"守门"和"审计"工具都没缝合的一环。

机制:读 Claude Code 的 session 日志(`~/.claude/projects`),提炼每个仓库的**"任务 → 改动"配对**(agent 当时声称做什么、为此改了哪些文件),交叉守门规则,让 AI 判断:

```
某仓库的 env-file 被碰 4 次,当时任务都是"把 DSN 写进 .env"(任务核心步骤)
   → AI 判定:正当触碰,这条规则在这个仓库是噪音 → 建议 downgrade(少烦)

某仓库的改动与任务完全不相关(顺手越界)
   → AI 判定:该 upgrade(更严)
```

守门审计标签下的 **🔄 规则进化** 区点"学习并建议",AI 会给出每条规则在每个仓库该 `降级/升级/维持/新增`,附理由 + 可执行指令;点"采纳"即写入信箱,终端 `agent-diff-guard inbox` 取来执行。这让"宁可漏不可烦"从一句口号,变成**误报率随真实使用自动下降**的机制。

> **隐私边界升级提示**:规则进化会读取 session **对话内容**(不只是计数)。任务文本里的疑似密钥(`sk-…`/`ghp_…`/AWS/Google key 等)在离开本机前会被 `redactSecrets()` **强制打码**;但对话文本本身会发给 AI 分析。如果你的对话里有不能外传的内容,**不要使用这个功能**(不点"学习并建议"即可,其余功能不受影响)。这是产品里隐私敞口最大的一环,刻意做成**显式手动触发**。

> **隐私红线**:守门事件只记元数据;session/成本数据只在本机聚合,**不联网、不上传**。唯一的例外是上面 opt-in 的 AI 整理(只发去敏元数据)。成本为按模型单价的**估算**(相对比较用),非账单级精确。这与产品"省注意力 + 代码不离开你的机器"的哲学一致(见 [docs/DESIGN.md](./docs/DESIGN.md))。云端团队版的多人汇总是路线图的下一步。

## 状态

v0.0.1 — 单兵 dogfood 阶段。规则引擎 + diff 解析 + 偏离检测 + pre-push hook 已端到端跑通。

### 已知待办(dogfood 暴露)
- [ ] 范围计算:同一 commit 内多类雷在增量 push 时可能漏报(`@{u}..HEAD` vs 全量)
- [x] ~~偏离检测中文任务失效~~ —— 已修(保留 CJK 关键词);语义判断仍可叠 AI 进一步升级
- [ ] AI 整理目前是手动触发,可加"时不时自动整理"(定时/阈值触发后推一条信箱)
- [ ] 终端侧 `inbox --watch` 持续轮询(当前为单次读取)
- [ ] 规则可配置化(每个仓库自定义敏感路径)
- [ ] GitHub Marketplace 分发 / PR 评论形态(团队版留存抓手)

## 设计与路线

- [**docs/DESIGN.md**](./docs/DESIGN.md) — 为什么这个位置存在、护城河在哪、谁会付钱、定价怎么定、最大的风险是什么。
- [**docs/ROADMAP.md**](./docs/ROADMAP.md) — 从单兵 CLI → 团队 PR 守门 → 企业治理层的形态演进,以及"始终不做的事"。

## 贡献

欢迎,但门槛很硬:**误报是头号敌人**。新增规则必须附带「不误报」测试用例。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE) © Xinwei Xiong (cubxxw)
