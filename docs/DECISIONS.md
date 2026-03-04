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
- Extended replay analyzer summary with deterministic operational counters: cooldown skips (`action_cooldown_active`), tick timeouts (`ETICK_TIMEOUT`), and lock-heartbeat failures (`tick_error.message` contains `lock heartbeat failed`).
- Updated replay CLI summary formatting and verification coverage (`npm run verify:replay`) to keep these counters regression-safe without changing existing summary fields.

## 2026-03-05
- Normalized action-executor idempotency key to battle/action fingerprint (`battleId + (idempotencyKey|id|action.type) + targetId`) instead of including `tickId`, so duplicate action suppression now works across adjacent ticks within the idempotency window.
- Kept deterministic behavior by preferring explicit action-level idempotency identifiers when available, with stable fallback to action type + target.
- Locked regression coverage in `npm run verify:cycle` by asserting a duplicate execute call with a different `tickId` is still skipped and reuses the original `actionKey`.
- Externalized activity probe endpoint order into `config/activity-endpoints.json` and made API probe load this file by default for ops-time reconfiguration without code edits.
- Locked deterministic fallback behavior to built-in endpoint candidates when endpoint config file is missing, unreadable, malformed JSON, empty, or schema-invalid.
- Added dedicated verification (`npm run verify:activity-config`) with a deterministic `data:` endpoint config to assert CLI-provided endpoint config path is honored end-to-end.
- Added deterministic FSM rule `recover-energy-safe-window` so low-energy snapshots with safe health choose `REST` (`RECOVER_ENERGY`) before `hold-default`, preserving higher-priority survival/defense ordering and improving uptime for future attack windows.
- Added per-run activity probe outcome logging to `logs/activity-probe.jsonl` with deterministic endpoint status counters (`total`, `ok`, `http_fail`, `network_fail`, `skipped`, `missing_api_key`) and compact per-endpoint statuses, while preserving API key masking and logging exactly once per `activity:fetch` run.
- Added `npm run verify:activity-log` to assert skip-API mode writes one probe-log record with correct deterministic counters using a temp log path override.
- Added deterministic size guard for `logs/activity-probe.jsonl`: before append, keep only newest complete JSONL tail within configured byte budget and then append the new masked record.
- Added activity probe log byte-budget overrides via env/CLI (`ACTIVITY_PROBE_LOG_MAX_BYTES`, `--activity-probe-log-max-bytes`) and defaulted max size to `256 KiB`.
- Added `npm run verify:activity-log-rotation` to assert oversized probe logs are truncated deterministically, final file size stays within limit, and newest appended record is retained.
- Added deterministic `activity_probe_summary` output for `activity:fetch` by scanning `logs/activity-probe.jsonl` over rolling lookback (default `6h`) and computing per-endpoint trailing consecutive non-`ok` streak + last status.
- Standardized probe-summary output contract to `{ lookback_hours, generated_at, endpoints:[{ endpoint, failure_streak, last_status }] }`, with malformed JSONL line tolerance and compact status normalization (`ok/http_fail/network_fail/skipped/missing_api_key`).
- Added optional probe-summary lookback overrides via env/CLI (`ACTIVITY_PROBE_SUMMARY_LOOKBACK_HOURS`, `--activity-probe-summary-lookback-hours`) while preserving deterministic default behavior.
- Added worker-level deterministic execution-failure circuit breaker with in-process state only (`WORKER_FAILURE_CIRCUIT_STREAK`, default `3`; `WORKER_FAILURE_CIRCUIT_COOLDOWN_MS`, default `30000`).
- Integrated the breaker into cycle/loop safety evaluation so post-streak ticks are safety-blocked with reason `execution_failure_circuit_open`, logged as `safety_evaluated` + `tick_blocked` + `tick_finished(executionStatus=skipped)`, and automatically cleared after cooldown.
- Extended cycle verification to lock the new behavior (`3x failed -> blocked -> cooldown clear`) and adjusted replay validation to accept blocked ticks that terminate with skipped `tick_finished`.
- Extended replay analyzer operational summary with deterministic `executionFailureCircuitOpen` counter for skipped action/tick paths where reason is `execution_failure_circuit_open` (tick-level dedup to avoid double counting).
- Updated replay summary formatter and verification coverage (`npm run verify:replay`, `npm run verify:cycle`) to lock this counter while preserving all existing summary fields.
- Added worker lock-heartbeat retry in loop (`WORKER_LOCK_HEARTBEAT_RETRIES`, default `1`; `WORKER_LOCK_HEARTBEAT_RETRY_DELAY_MS`, default `25`) so transient lock touch failures do not terminate the worker immediately.
- Kept deterministic fail-fast behavior for persistent heartbeat failure: after bounded retries, loop still emits `tick_error` with `lock heartbeat failed` and exits.
- Added lock acquisition dependency injection hook (`acquireLock`) in worker loop to enable deterministic reliability verification without filesystem race dependence.
- Hardened `activity_probe_summary` against test-only/non-production endpoint noise by applying a configured endpoint allowlist sourced from activity endpoint config (with deterministic fallback to built-in candidates).
- Added endpoint-template normalization (`hours=*`, `window=*h`) so allowlist matching remains stable across different runtime hour windows while still excluding unknown schemes like `data:`.
- Wired summary allowlist to the same config path used by API probing to keep probe execution and trailing-streak analytics aligned.
