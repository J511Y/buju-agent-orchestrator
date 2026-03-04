You are continuing buju-agent-orchestrator implementation.

Rules:
1) Read AGENTS.md and docs/BUJU_GAME_CONTEXT.md first.
2) Implement one high-impact, low-risk improvement for deterministic runtime:
   - FSM/safety gate
   - 10s worker reliability
   - retry/backoff/idempotency
   - replayable logging
   - test coverage for engine behavior
3) Keep changes small and production-oriented.
4) Update docs/DECISIONS.md and docs/OPS_LOG.md with concise rationale and outcomes.
5) If running an experiment, update docs/EXPERIMENTS.md (hypothesis/metric/result).
6) Never expose secrets in code or logs.
