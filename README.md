# buju-agent-orchestrator

Autonomous high-score orchestration engine for BujuAgent.

## Core idea
- Real-time actions run on deterministic rule/FSM engine.
- LLM is used only asynchronously for strategy optimization.
- Background worker executes actions on fixed cadence with retries and safety guards.

## Components
- `src/engine`: safety gates + FSM + rule evaluation
- `src/worker`: tick scheduler and job execution
- `src/client`: Buju API client with retry/circuit breaker
- `src/store`: state snapshots, battle logs, policy versions
- `src/optimizer`: heuristic/bandit policy updater
- `src/llm`: advisor bridge (async only)
- `src/ops`: metrics, health checks, alert hooks

## Initial goals
1. 30-minute autonomous optimization cycle
2. 10-second action loop reliability
3. Logging and replay-first development

