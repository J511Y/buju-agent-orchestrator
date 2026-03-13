#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p logs

LOCK_FILE="logs/live-runner-daemon.lock"
if [[ -f "$LOCK_FILE" ]]; then
  OLD_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[live-runner-daemon] already running pid=$OLD_PID, exiting" >> logs/live-runner-daemon.log
    exit 0
  fi
fi

echo $$ > "$LOCK_FILE"
cleanup() { rm -f "$LOCK_FILE"; }
trap cleanup EXIT INT TERM

echo "[live-runner-daemon] started at $(date '+%F %T %z') pid=$$" >> logs/live-runner-daemon.log

while true; do
  node scripts/live-strategy-runner.js >> logs/live-runner-daemon.log 2>&1 || true
  # small guard pause between cycles
  sleep 1
done
