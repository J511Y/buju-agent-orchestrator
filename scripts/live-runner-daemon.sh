#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p logs

echo "[live-runner-daemon] started at $(date '+%F %T %z')" >> logs/live-runner-daemon.log

while true; do
  node scripts/live-strategy-runner.js >> logs/live-runner-daemon.log 2>&1 || true
  # small guard pause between cycles
  sleep 1
done
