---
name: 误报反馈 (False positive)
about: 守门人拦了一个本不该拦的正常改动
title: "[误报] "
labels: false-positive
---

> 误报是这个项目的头号敌人。报一个误报,比报十个新需求更有价值。

**被误拦的改动**
哪个文件、哪条规则(`rule` 字段)拦了它?贴一下 CLI 的输出。

**为什么这是正常改动**
说明这次改动其实是安全/预期内的。

**复现**
```bash
# 能复现的最小 diff 或 git range
```

**环境**
- agent-diff-guard 版本:
- 用的是哪个 agent 在改代码(Claude Code / Cursor / 其他):
