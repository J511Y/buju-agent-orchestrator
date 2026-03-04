# Engineering Decisions

## 2026-03-03
- Adopted hot-path deterministic decisioning (FSM + safety gates), with async advisor path for strategy updates.
- Separated periodic autonomous execution from user-facing chat via cron isolated runs.
- Prioritized replayable logs and idempotent action execution before advanced optimization.
