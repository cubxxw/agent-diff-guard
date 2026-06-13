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
