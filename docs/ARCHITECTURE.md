# Architecture v0.1

## Hot path (no LLM)
State Ingest -> Safety Layer -> FSM/Rules -> Action Executor

## Cold path (async)
Battle Logs -> Optimizer -> Candidate Policy -> Canary Apply

## Data contracts
- state_snapshot
- battle_log
- policy_version
- decision_trace

## SLO targets
- Rule decision p95 <= 150ms
- Worker availability >= 99.9%
- Duplicate actions < 0.1%
