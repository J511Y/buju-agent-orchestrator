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
