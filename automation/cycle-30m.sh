#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

STAMP="$(date '+%Y-%m-%d %H:%M:%S %z')"

echo "[$STAMP] Starting 30-minute autonomous cycle"

echo "[1/6] Pull latest"
git pull --rebase || true

echo "[2/6] Select task prompt"
TASK_PROMPT_FILE="automation/prompts/cycle-task.md"
if [[ ! -f "$TASK_PROMPT_FILE" ]]; then
  echo "Missing $TASK_PROMPT_FILE" >&2
  exit 1
fi

echo "[3/6] Run Codex exec"
codex exec --full-auto "$(cat "$TASK_PROMPT_FILE")"

echo "[4/6] Minimal verification"
if [[ -f package.json ]]; then
  npm run -s test || true
fi

echo "[5/6] Ensure logs are updated"
[[ -f docs/DECISIONS.md ]] || touch docs/DECISIONS.md
[[ -f docs/OPS_LOG.md ]] || touch docs/OPS_LOG.md
[[ -f docs/EXPERIMENTS.md ]] || touch docs/EXPERIMENTS.md

echo "[6/6] Commit + push if changed"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "chore: autonomous 30m cycle update"
  git push || echo "Push failed; check auth/network"
else
  echo "No changes to commit"
fi

echo "Cycle done"
