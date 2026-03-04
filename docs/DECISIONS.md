# Engineering Decisions

## 2026-03-03
- Adopted hot-path deterministic decisioning (FSM + safety gates), with async advisor path for strategy updates.
- Separated periodic autonomous execution from user-facing chat via cron isolated runs.
- Prioritized replayable logs and idempotent action execution before advanced optimization.

## 2026-03-04
- Implemented deterministic 10s worker loop skeleton with explicit tick IDs and serialized JSONL event logging (`tick_started` -> `tick_finished`).
- Added hard safety gates (`maintenance_mode`, `low_health`, `action_queue_saturated`, `cooldown_active`) to block risky actions before FSM evaluation.
- Added retry/backoff action executor with bounded attempts, retryable-error filtering, and idempotency window to reduce duplicate side effects.
- Standardized replay-friendly JSONL schema (`buju.worker.event.v1`) with recursive secret masking to keep logs usable without leaking credentials.
- Added `npm run verify:cycle` smoke verification for retry behavior, idempotency skip path, and secret masking regression coverage.
- Added replay analyzer utility for worker event JSONL logs with per-tick schema/order validation and concise KPI extraction (tick volume, blocked rate, action success/fail/skipped, top safety reasons).
- Added dedicated replay verification script (`npm run verify:replay`) to lock expected analyzer behavior on valid/invalid event streams.
- Added filesystem worker loop lock (`WORKER_LOCK_FILE`, stale TTL) to prevent concurrent loop instances and reclaim stale locks deterministically.
- Added per-tick timeout guard (`WORKER_TICK_TIMEOUT_MS`) so hung ticks emit `tick_error` with timeout code and loop advances to the next tick.
- Added reliability verification script (`npm run verify:worker`) covering live-lock denial, stale lock takeover, timeout recovery, and lock release on shutdown.
- Added in-process action cooldown guard (`ACTION_COOLDOWN_MS`, default `3000`) keyed by `action.type + action.targetId` to block repeated actions across ticks before execution.
- Standardized cooldown-block path as replay-safe JSONL records with `action_executed.status=skipped` and explicit reason `action_cooldown_active` (plus cooldown metadata) followed by `tick_finished`.
- Extended cycle verification (`npm run verify:cycle`) to assert second-tick cooldown blocking, no transport call on blocked tick, and persisted cooldown reason in JSONL.
- Added `scripts/fetch-activity.js` (`npm run activity:fetch`) to produce compact 1h KPI JSON via API-first probing of candidate `/api` activity endpoints, with deterministic fallback to local replay logs (`logs/worker-events.jsonl`) using `analyzeReplayRecords`.
- Standardized hourly activity output contract to `progress_delta`, `action_status_counts`, `known_outcomes`, `source`, `endpoint_statuses`; enforced API key non-disclosure by masking/sanitizing all surfaced strings.
- Added fallback-path verification script (`npm run verify:activity`) with synthetic temp JSONL to lock 1h window filtering and replay-derived KPI correctness.
