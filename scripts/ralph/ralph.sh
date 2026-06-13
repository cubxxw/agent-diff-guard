#!/bin/bash
# Ralph - Autonomous AI agent loop for agent-diff-guard
# Each iteration: fresh Claude Code instance → implement single story → test → commit
# Usage: ./ralph.sh [max_iterations]
#   max_iterations  Max loop count (default: 10)

set -e
set -o pipefail

export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:$PATH"

MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --prd) PRD_ARG="$2"; shift 2 ;;
    --prd=*) PRD_ARG="${1#*=}"; shift ;;
    *) [[ "$1" =~ ^[0-9]+$ ]] && MAX_ITERATIONS="$1"; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"

PRD_FILE="${PRD_ARG:-$REPO_ROOT/prd.json}"

if [ ! -f "$PRD_FILE" ]; then
  echo "❌ PRD file not found: $PRD_FILE"
  exit 1
fi

# Init progress file
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# agent-diff-guard — Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$PROGRESS_FILE"
  echo "Tool: claude" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# Init CLAUDE.md if not exist
if [ ! -f "$SCRIPT_DIR/CLAUDE.md" ]; then
  cat > "$SCRIPT_DIR/CLAUDE.md" << 'CLAUDE_EOF'
# Ralph Agent Instructions — agent-diff-guard

## Your Task
1. Read PRD at `../../prd.json`
2. Read progress at `progress.txt` (Codebase Patterns section)
3. Check you're on correct branch from PRD `branchName`
4. Pick highest-priority story where `passes: false`
5. Implement that single story
6. Run: `cd /home/smile/agent-diff-guard && bun test && tsc --noEmit`
7. If checks pass, commit: `git add -A && git commit -m "feat: [ID] - [Title]"`
8. Update PRD to set `passes: true`
9. Append progress to `progress.txt`

## Quality
- `bun test && tsc --noEmit` must pass before commit
- This is a Bun/TypeScript project, no iOS build
- Keep changes focused on the story

## Stop Condition
If all stories pass, reply with: <promise>COMPLETE</promise>
CLAUDE_EOF
fi

echo "🚀 Ralph starting — Tool: claude, Max iterations: $MAX_ITERATIONS"
echo "📋 PRD: $PRD_FILE"
echo ""

# Cache TARGET_BRANCH at start (NEVER re-read from PRD — Claude Code may overwrite it)
TARGET_BRANCH=$(python3 -c "import json; f=open('$PRD_FILE'); print(json.load(f).get('branchName','main'))")
PRD_PROJECT=$(python3 -c "import json; f=open('$PRD_FILE'); print(json.load(f).get('project','agent-diff-guard'))")
PRD_DESC=$(python3 -c "import json; f=open('$PRD_FILE'); print(json.load(f).get('description',''))")
echo "🎯 Target branch: $TARGET_BRANCH"

# Verify/correct branch
CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
  if git -C "$REPO_ROOT" rev-parse --verify --quiet "$TARGET_BRANCH" >/dev/null; then
    echo "   ⚠️ Not on target branch ($CURRENT_BRANCH ≠ $TARGET_BRANCH) — switching"
    git -C "$REPO_ROOT" checkout "$TARGET_BRANCH"
  else
    echo "   ⚠️ Target branch $TARGET_BRANCH does not exist — creating from main"
    git -C "$REPO_ROOT" checkout -b "$TARGET_BRANCH" main
  fi
fi

for i in $(seq 1 $MAX_ITERATIONS); do
  echo "═══════════════════════════════════════════════════════════"
  echo "  Iteration $i / $MAX_ITERATIONS"
  echo "═══════════════════════════════════════════════════════════"

  # Guard: ensure correct branch
  CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
  if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    echo "   ⚠️ Branch drift: on $CURRENT_BRANCH, expected $TARGET_BRANCH — switching back"
    if git -C "$REPO_ROOT" rev-parse --verify --quiet "$TARGET_BRANCH" >/dev/null; then
      git -C "$REPO_ROOT" checkout "$TARGET_BRANCH"
    else
      git -C "$REPO_ROOT" checkout -b "$TARGET_BRANCH" main
    fi
  fi

  # Find next incomplete story
  STORY=$(python3 -c "
import json, sys
with open('$PRD_FILE') as f:
    prd = json.load(f)
items = prd.get('stories', prd.get('userStories', []))
incomplete = [s for s in items if not s['passes']]
if not incomplete:
    print('ALL_DONE')
    sys.exit(0)
story = incomplete[0]
print(json.dumps(story))
")

  if [ "$STORY" = "ALL_DONE" ]; then
    echo "✅ ALL STORIES COMPLETE!"
    echo "All stories pass: true" >> "$PROGRESS_FILE"
    exit 0
  fi

  STORY_ID=$(echo "$STORY" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  STORY_TITLE=$(echo "$STORY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name', d.get('title','')))")
  STORY_DESC=$(echo "$STORY" | python3 -c "import json,sys; print(json.load(sys.stdin)['description'])")
  STORY_ACCEPT=$(echo "$STORY" | python3 -c "
import json,sys
d = json.load(sys.stdin)
ac = d.get('acceptance', d.get('acceptanceCriteria', []))
if isinstance(ac, list):
    print('\\n'.join(f'- {a}' for a in ac))
else:
    print(ac)
")

  echo "📌 Story #$STORY_ID: $STORY_TITLE"
  echo "   $STORY_DESC"

  # Build the Claude Code prompt
  PROMPT="You are implementing a SINGLE user story from the agent-diff-guard PRD.

⚠️ CRITICAL: You are working on branch '$TARGET_BRANCH'. NEVER run git checkout, git switch, git branch, or any command that changes the current branch. NEVER push or pull. Only git add and git commit.

PROJECT: agent-diff-guard
DESCRIPTION: $PRD_DESC
Read CLAUDE.md at scripts/ralph/CLAUDE.md for instructions.

STORY #$STORY_ID: $STORY_TITLE
DESCRIPTION: $STORY_DESC
ACCEPTANCE CRITERIA:
$STORY_ACCEPT

Implement ONLY this story. Do NOT touch unrelated code. Keep changes focused and minimal.
After implementing:
1. Run verification: cd /home/smile/agent-diff-guard && bun test && tsc --noEmit
2. Print a summary of what you changed
3. The acceptance criteria must be satisfied
4. Then: git add -A && git commit -m 'feat: story #$STORY_ID — $STORY_TITLE'"

  echo "   🤖 Running Claude Code..."

  cd "$REPO_ROOT"

  if claude -p "$PROMPT" \
    --allowedTools "Read,Write,Edit,Bash" \
    --max-turns 60 \
    --effort high \
    --dangerously-skip-permissions 2>&1 | tee /tmp/ralph-output-$i.log; then

    echo "   ✅ Story #$STORY_ID implemented successfully"

    # Mark story as passes: true
    python3 -c "
import json
with open('$PRD_FILE') as f:
    prd = json.load(f)
for s in prd.get('stories', prd.get('userStories', [])):
    if s['id'] == '$STORY_ID':
        s['passes'] = True
        break
with open('$PRD_FILE', 'w') as f:
    json.dump(prd, f, indent=2)
"
    echo "   ✔️ Story #$STORY_ID marked as passes: true"

    # Log progress
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Story #$STORY_ID: $STORY_TITLE — PASSED" >> "$PROGRESS_FILE"

    # Git add + commit
    cd "$REPO_ROOT"
    if git diff --quiet && git diff --cached --quiet; then
      echo "   ⚠️ No changes to commit"
    else
      git add -A
      git commit -m "feat: story #$STORY_ID — $STORY_TITLE

$STORY_DESC"
      echo "   📝 Committed: story #$STORY_ID"
    fi

  else
    echo "   ❌ Story #$STORY_ID FAILED"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Story #$STORY_ID: $STORY_TITLE — FAILED (iteration $i)" >> "$PROGRESS_FILE"
  fi

  echo ""
done

echo "🏁 Ralph complete after $MAX_ITERATIONS iterations"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Ralph complete after $MAX_ITERATIONS iterations" >> "$PROGRESS_FILE"

# Report remaining
REMAINING=$(python3 -c "
import json
with open('$PRD_FILE') as f:
    prd = json.load(f)
remaining = [s.get('name', s.get('title', '?')) for s in prd.get('stories', prd.get('userStories', [])) if not s['passes']]
if remaining:
    print('Remaining: ' + ', '.join(remaining))
else:
    print('All complete! 🎉')
")
echo "📊 $REMAINING"
