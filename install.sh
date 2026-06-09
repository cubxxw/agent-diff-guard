#!/usr/bin/env bash
# install.sh — 把 agent-diff-guard 守门人装到目标仓库的 git hook。
#
# 用法:
#   ./install.sh /path/to/target-repo
#   ./install.sh            # 默认装到当前目录的仓库
#
# 做两件事:
#   1. 让 hook 通过 AGENT_DIFF_GUARD_CLI 指向本仓库的 cli(无需全局 npm 安装)
#   2. 把 hooks/pre-push 复制进目标仓库的 .git/hooks/ 并赋可执行

set -euo pipefail

GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$(pwd)}"

GIT_DIR="$(git -C "$TARGET" rev-parse --git-dir 2>/dev/null || true)"
if [ -z "$GIT_DIR" ]; then
  echo "✗ $TARGET 不是一个 git 仓库" >&2
  exit 1
fi
# rev-parse 给的可能是相对路径,转成绝对
case "$GIT_DIR" in /*) : ;; *) GIT_DIR="$TARGET/$GIT_DIR" ;; esac

HOOK_DST="$GIT_DIR/hooks/pre-push"
mkdir -p "$GIT_DIR/hooks"

# 生成一个薄包装:注入 CLI 路径后调用真正的 hook 逻辑
cat > "$HOOK_DST" <<EOF
#!/usr/bin/env bash
export AGENT_DIFF_GUARD_CLI="bun $GUARD_DIR/src/cli.ts"
exec "$GUARD_DIR/hooks/pre-push" "\$@"
EOF
chmod +x "$HOOK_DST" "$GUARD_DIR/hooks/pre-push"

echo "✓ 已在 $TARGET 安装 agent-diff-guard pre-push 守门人"
echo "  CLI: bun $GUARD_DIR/src/cli.ts"
echo "  下次 git push 前会自动检查;被拦后可用 git push --no-verify 放行。"
