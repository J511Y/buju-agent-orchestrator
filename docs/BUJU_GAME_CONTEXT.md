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
- Skill document source of truth: `GET /api/skill-doc/download` (latest checked: `grindquest v1.14.0`, pinned local doc still `v1.11.1`)
- Current key handling rule:
  - Never hardcode key in source/docs.
  - Use `.env` (`BUJU_API_KEY`) and mask logs.

## Known useful endpoints
- `GET /api/status`
- `GET /api/skill/list`
- `GET /api/game-data/areas/{area_id}`
- `POST /api/hunt` (requires JSON body: `monster_id`, `skill_id`)
- `POST /api/rest`
- `POST /api/move`
- `GET /api/skill-doc/download` (for schema/rate-limit updates)

## Gameplay policy anchors
1. Survival guard first (HP/resource thresholds)
2. Deterministic fast-path decisions (FSM/rules)
3. Async policy improvement (optimizer/LLM advisor)
4. Replayable logs for A/B and regression checks

## Progression heuristics (initial)
- Early: stable leveling + mutation risk prep
- Mid: EXP acceleration with controlled risk
- Late: high EXP/time while minimizing death penalties

## Operational update notes (2026-03-05)
- Confirmed from live API: `/api/hunt` without required fields returns `400 INVALID_INPUT`.
- Confirmed minimum safe hunt payload: `{"monster_id":"<id>","skill_id":"<skill_id>"}`.
- `GET /api/skill/list` currently returns usable skill IDs (e.g., `basic_attack`).
- `GET /api/game-data/areas/{current_area}` can be used to resolve valid monster IDs.

## Security note
A key was previously exposed in chat context. Rotation is strongly recommended.
