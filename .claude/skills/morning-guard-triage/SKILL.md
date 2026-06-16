---
name: morning-guard-triage
description: 每天早晨自动巡查所有昨日 loop session，生成守门晨报，将 verdict=block/warn 的高风险发现汇总为结构化状态文件，并可选地将值得修复的项推入隔离 worktree 或 Slack/Linear。
trigger: /morning-guard-triage
---

# /morning-guard-triage

**设计一次，每天自动跑**。这是 agent-diff-guard Loop Guard 层的标准晨间巡查 skill——呼应 Loop Engineering 的核心理念：agent 在你睡觉时持续迭代，你醒来时需要一份精确到"该看什么"的简报，而不是翻阅 50 条 commit log。

---

## 标准 Morning Triage Loop 形状（Osmani 框架）

```
┌────────────────────────────────────────────────────────┐
│  Morning Triage Loop                                   │
│                                                        │
│  1. list sessions   →  找出昨日 / 活跃的 loop session  │
│  2. report per session  →  生成晨报（drift/budget/findings）│
│  3. aggregate        →  汇总 block/warn 项到 PROGRESS.md│
│  4. [可选] worktree  →  为值得修复的项创建隔离分支      │
│  5. [可选] notify    →  推送摘要到 Slack / Linear       │
└────────────────────────────────────────────────────────┘
```

每个步骤独立可跳过，无副作用（只读 + 写本地文件），适合作为 cron job 或 Claude Code `/loop` 的 post-iteration hook 运行。

---

## 步骤详解与 Bash 命令示例

### 步骤 1：读昨日所有 loop session

```bash
# 列出所有 session（JSON 格式便于后续处理）
SESSIONS=$(agent-diff-guard loop list --json)

# 筛选昨日活跃 / 今日仍在运行的 session（jq 过滤）
ACTIVE_IDS=$(echo "$SESSIONS" | jq -r '.[] | select(.status == "active" or .status == "emergency-braked") | .id')

echo "待巡查 sessions："
echo "$ACTIVE_IDS"
```

### 步骤 2：对每个 session 生成晨报

```bash
REPORT_DIR=".agent-guard/morning-$(date +%Y%m%d)"
mkdir -p "$REPORT_DIR"

for SID in $ACTIVE_IDS; do
  # 生成 JSON 晨报（含 topFindings / driftSummary / budgetSummary / recommendation）
  agent-diff-guard loop report --session "$SID" --json > "$REPORT_DIR/$SID.json"

  # 同时生成人类可读版本
  agent-diff-guard loop report --session "$SID" > "$REPORT_DIR/$SID.txt"

  echo "✓ $SID 晨报已写入 $REPORT_DIR/"
done
```

`generateReport()` 输出字段说明（来自 `src/loop/report.ts`）：

| 字段 | 含义 |
|---|---|
| `topFindings` | Top-5 高频发现（rule × path × count） |
| `driftSummary.status` | `stable` / `drifting` / `diverged` |
| `budgetSummary.budgetPct` | token 消耗百分比 |
| `recommendation` | `continue` / `review-and-continue` / `rollback` / `stop` |
| `emergencyBrakeTriggered` | 是否触发了紧急制动 |

### 步骤 3：汇总高风险项 → PROGRESS.md 状态文件

```bash
PROGRESS_FILE="MORNING-TRIAGE-$(date +%Y%m%d).md"

{
  echo "# Morning Guard Triage — $(date +%Y-%m-%d)"
  echo ""
  echo "> 自动生成。verdict=block 的项需人工确认。"
  echo ""

  for SID in $ACTIVE_IDS; do
    R="$REPORT_DIR/$SID.json"
    echo "## $SID"
    echo "- recommendation: $(jq -r '.recommendation' "$R")"
    echo "- drift: $(jq -r '.driftSummary.status' "$R") / $(jq -r '(.driftSummary.currentDrift * 100 | floor | tostring) + "%"' "$R")"
    echo "- budget: $(jq -r '(.budgetSummary.budgetPct * 100 | floor | tostring) + "%"' "$R") used"
    echo "- emergency_brake: $(jq -r '.emergencyBrakeTriggered' "$R")"
    echo ""
    echo "### wake-you-up 发现"
    jq -r '.topFindings[] | select(.severity=="wake-you-up") | "- [ ] `\(.rule)` @ `\(.path)` ×\(.count)"' "$R"
    echo ""
  done
} > "$PROGRESS_FILE"

echo "✓ 状态文件：$PROGRESS_FILE"
```

### 步骤 4（可选）：为值得修复的发现创建隔离 worktree

```bash
# 仅对 recommendation=rollback 或 review-and-continue 的 session 创建 worktree
for SID in $ACTIVE_IDS; do
  REC=$(jq -r '.recommendation' "$REPORT_DIR/$SID.json")

  if [ "$REC" = "rollback" ] || [ "$REC" = "review-and-continue" ]; then
    BRANCH="fix/loop-triage-$SID-$(date +%Y%m%d)"
    git worktree add "../worktrees/$BRANCH" -b "$BRANCH"
    echo "✓ Worktree 已创建：../worktrees/$BRANCH（session=$SID）"
  fi
done
```

### 步骤 5（可选）：通过 MCP connector 推送到 Slack / Linear

```bash
# 需先配置 MCP connector（Slack / Linear webhook）
# 在 claude_desktop_config.json 中添加对应 MCP server

# 如已配置 Slack MCP server，在 Claude 对话中调用：
# mcp__slack__post_message channel="#guard-alerts" text="$(cat MORNING-TRIAGE-YYYYMMDD.md | head -40)"

# 如已配置 Linear MCP server，为每个 block 项创建 issue：
# mcp__linear__create_issue title="[Loop Guard] $SID 触发 rollback" description="..."
echo "ℹ️  MCP 推送步骤需在 Claude 对话上下文中执行（非纯 bash）"
```

---

## 完整一键脚本

```bash
#!/usr/bin/env bash
# morning-guard-triage.sh — 晨间守门巡查
# 用法：bash morning-guard-triage.sh
# 建议：加入 crontab: 0 8 * * 1-5 bash /path/to/morning-guard-triage.sh

set -euo pipefail

DATE=$(date +%Y%m%d)
REPORT_DIR=".agent-guard/morning-$DATE"
PROGRESS_FILE="MORNING-TRIAGE-$DATE.md"

mkdir -p "$REPORT_DIR"

echo "=== Morning Guard Triage $DATE ==="

# 1. 列出 session
SESSIONS=$(agent-diff-guard loop list --json)
ACTIVE_IDS=$(echo "$SESSIONS" | jq -r '.[] | select(.status == "active" or .status == "emergency-braked") | .id')

if [ -z "$ACTIVE_IDS" ]; then
  echo "✓ 无活跃 session，今日无需巡查。"
  exit 0
fi

# 2. 生成晨报
for SID in $ACTIVE_IDS; do
  agent-diff-guard loop report --session "$SID" --json > "$REPORT_DIR/$SID.json"
  agent-diff-guard loop report --session "$SID"        > "$REPORT_DIR/$SID.txt"
done

# 3. 汇总到 PROGRESS.md
{
  echo "# Morning Guard Triage — $(date +%Y-%m-%d)"
  echo ""
  echo "> 自动生成。verdict=block 的项需人工确认。"
  echo ""

  for SID in $ACTIVE_IDS; do
    R="$REPORT_DIR/$SID.json"
    echo "## $SID"
    echo "- recommendation: $(jq -r '.recommendation' "$R")"
    echo "- drift: $(jq -r '.driftSummary.status' "$R") / $(jq -r '(.driftSummary.currentDrift * 100 | floor | tostring) + "%"' "$R")"
    echo "- budget: $(jq -r '(.budgetSummary.budgetPct * 100 | floor | tostring) + "%"' "$R") used"
    echo "- emergency_brake: $(jq -r '.emergencyBrakeTriggered' "$R")"
    echo ""
    echo "### wake-you-up 发现"
    jq -r '.topFindings[] | select(.severity=="wake-you-up") | "- [ ] `\(.rule)` @ `\(.path)` ×\(.count)"' "$R"
    echo ""
  done
} > "$PROGRESS_FILE"

echo "✓ 状态文件：$PROGRESS_FILE"

# 4. [可选] worktree（取消注释启用）
# for SID in $ACTIVE_IDS; do
#   REC=$(jq -r '.recommendation' "$REPORT_DIR/$SID.json")
#   if [ "$REC" = "rollback" ] || [ "$REC" = "review-and-continue" ]; then
#     git worktree add "../worktrees/fix-$SID-$DATE" -b "fix/loop-$SID-$DATE"
#   fi
# done

echo "=== Triage 完成 ==="
```

---

## PROGRESS.md 状态文件模板

以下为自动生成的 `MORNING-TRIAGE-YYYYMMDD.md` 示例：

```markdown
# Morning Guard Triage — 2026-06-18

> 自动生成。verdict=block 的项需人工确认。

## 01JXYZ...（session id）
- recommendation: **review-and-continue**
- drift: drifting / 62%
- budget: 74% used
- emergency_brake: false

### wake-you-up 发现
- [ ] `hardcoded-secret` @ `src/config.ts` ×3
- [ ] `test-deleted` @ `src/auth/auth.test.ts` ×1

## 01JABC...（另一个 session）
- recommendation: continue
- drift: stable / 12%
- budget: 31% used
- emergency_brake: false

### wake-you-up 发现
（无）
```

---

## 触发方式

| 方式 | 命令 |
|---|---|
| 手动触发 | `bash morning-guard-triage.sh` |
| cron（工作日早 8 点） | `0 8 * * 1-5 bash /path/to/morning-guard-triage.sh` |
| Claude Code skill | `/morning-guard-triage` |
| PostToolUse hook | 在 `settings.json` 中注册（需配合 `agent-diff-guard loop install-hook`） |

---

## 依赖与前置条件

1. `agent-diff-guard` CLI 已安装并可执行（`bun run src/cli.ts` 或全局安装）
2. 至少存在一个已启动的 loop session（`agent-diff-guard loop start --goal "..." --budget 500k`）
3. `jq` 命令可用（`brew install jq` / `apt install jq`）
4. （步骤 5）Slack / Linear MCP server 已在 `claude_desktop_config.json` 中配置

---

## Loop Engineering 对应关系

> "Build the guard for the loop, not the loop itself."  
> — agent-diff-guard LOOP-DESIGN.md

本 skill 不是 loop 管理器，是**所有 loop 的验证层晨报入口**：

| Loop 失败模式 | 本 skill 的回应 |
|---|---|
| Goal drift | 晨报 `driftSummary` 标红 `diverged`，推进审查队列 |
| Token explosion | 晨报 `budgetSummary.budgetPct > 90%` 时输出 `stop` 建议 |
| Verification absence | 把昨夜 agent 产出的 `wake-you-up` 发现变成今早的 `- [ ]` checklist |
