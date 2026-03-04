# Runbook: Autonomous Development Cycle

## Purpose
Standard operating procedure for 30-minute autonomous development cycles.

## Normal flow
1. Sync repository state
2. Run Codex/OMX task prompt
3. Execute minimal verification
4. Update decision and ops logs
5. Commit and push

## Failure handling
- Codex/OMX command failure:
  - Record failure in `docs/OPS_LOG.md`
  - Retry once with narrowed task scope
- Test failure:
  - Revert risky change or add fix in same cycle
  - Record root cause in `docs/DECISIONS.md`
- Push failure:
  - Keep local commit
  - Log pending push in `docs/OPS_LOG.md`

## Rollback
- Revert last policy/engine commit
- Re-run minimal verification
- Push rollback commit with reason

## Guardrails
- No secrets in repository
- No LLM in hot-path runtime decision
- Every cycle must leave traceable logs
