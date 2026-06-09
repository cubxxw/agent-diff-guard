# Contributing to agent-diff-guard

感谢你关注这个项目。它的目标很窄、很硬:**在 agent 时代当好一个守门人——抓得准 >> 抓得全**。

## 北极星:宁可漏,不可烦

这个项目唯一不可妥协的原则是**误报接近零**。一个老是误报的守门人,三天就会被关掉(狼来了)。

所以提规则类 PR 时,请记住:

- 新增一条规则,**必须同时附带「不误报」测试用例**——证明正常改动不会被它误伤。
- 如果你不确定一条规则会不会误报,它就还不够格进 `wake-you-up`。降到 `look-once`,或先不提。
- 我们宁可少抓一类雷,也不愿多烦用户一次。

## 开发环境

需要 [Bun](https://bun.sh) ≥ 1.3。

```bash
git clone https://github.com/cubxxw/agent-diff-guard
cd agent-diff-guard
bun install
bun test            # 跑测试(命中用例 + 误报防线用例)
bunx tsc --noEmit   # 类型检查
```

本地手动验一条改动:

```bash
bun src/cli.ts check --range HEAD --task "你这次改动想干什么"
```

## 提 PR 前

1. `bun test` 全绿(尤其是误报防线用例)。
2. `bunx tsc --noEmit` 无类型错。
3. Commit 用 [Conventional Commits](https://www.conventionalcommits.org):`feat:` `fix:` `refactor:` `docs:` `test:` `chore:`。
4. 在 PR 描述里说清:**这条改动会不会引入误报?为什么不会?**

## 规则贡献的判断标准

一条规则要进 `wake-you-up`,问自己三个问题:

1. **碰到它=高概率出事吗?** (不是"可能有关",是"几乎一定该让人看一眼")
2. **CI / lint / 类型检查能替代它吗?** 能的话就不该是我们的规则。
3. **它在 agent 时代才有意义吗?** 我们的护城河是"审 agent 改动"——越是 agent 独有的雷(删测试骗 CI、任务范围外顺手改、供应链注入),越值得做。

## 行为准则

对人友善,对规则苛刻。技术讨论欢迎尖锐,人身攻击不接受。
