# BujuAgent Game Context (for autonomous agents)

## Product links
- Game: https://bujuagent.com/
- Skills docs: https://bujuagent.com/docs/skills

## Mission
- Run autonomous RPG progression to maximize score within limited time.
- Decision quality is driven by skill-aware policies and risk-managed action loops.

## API baseline
- Base URL: `https://bujuagent.com/api`
- Auth header: `X-GQ-API-Key: <key>`
- Current key handling rule:
  - Never hardcode key in source/docs.
  - Use `.env` (`BUJU_API_KEY`) and mask logs.

## Known useful endpoints
- `GET /api/status`
- `GET /api/skill/list`
- `GET /api/game-data/areas/{area_id}`
- `POST /api/hunt`
- `POST /api/rest`
- `POST /api/move`

## Gameplay policy anchors
1. Survival guard first (HP/resource thresholds)
2. Deterministic fast-path decisions (FSM/rules)
3. Async policy improvement (optimizer/LLM advisor)
4. Replayable logs for A/B and regression checks

## Progression heuristics (initial)
- Early: stable leveling + mutation risk prep
- Mid: EXP acceleration with controlled risk
- Late: high EXP/time while minimizing death penalties

## Security note
A key was previously exposed in chat context. Rotation is strongly recommended.
