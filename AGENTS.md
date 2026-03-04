# AGENTS.md

이 문서는 **자동화 에이전트(코덱스/OMX 포함)** 전용 실행 가이드입니다.

## Mission
- BujuAgent 점수 극대화 자동운영 엔진을 지속 개선한다.
- 실시간 판단은 FSM/Rules로 처리하고, LLM은 비동기 전략 개선에만 사용한다.

## Non-Negotiables
1. API 키/시크릿은 절대 커밋하지 않는다.
2. 로그/출력에 키는 반드시 마스킹한다.
3. 실시간 경로(틱 루프)에 LLM 호출을 넣지 않는다.
4. 변경은 항상 커밋 단위로 남긴다.
5. 실패/차단 시 원인과 다음 액션을 `docs/OPS_LOG.md`에 기록한다.


## Required Domain Context (Buju-specific)
Before implementing any feature, read:
- `docs/BUJU_GAME_CONTEXT.md`
- `docs/ARCHITECTURE.md`

Agent tasks must stay aligned with the Buju objective: maximize in-game score via autonomous, robust operation.

## 30-min Autonomous Cycle (Standard)
매 사이클마다 아래 순서를 지킨다.

1. 현재 상태 점검
   - 최근 커밋/브랜치 상태 확인
   - `docs/BUJU_GAME_CONTEXT.md`, `docs/DECISIONS.md`, `docs/OPS_LOG.md` 확인
2. 우선순위 작업 1~2개 선택
   - engine 안정성
   - worker 신뢰성(재시도/락/타임아웃)
   - 로그/리플레이/테스트 강화
3. 구현 + 최소 검증
   - 로컬 실행 또는 최소 테스트
4. 문서화
   - 결정사항 `docs/DECISIONS.md`
   - 운영 이벤트 `docs/OPS_LOG.md`
5. 커밋/푸시
   - 작은 단위로 커밋
   - 원격 푸시 시도, 실패 시 OPS_LOG에 기록

## Execution via Codex/OMX
가능하면 아래 방식 중 하나로 작업한다.

### A) Codex CLI
```bash
codex exec --full-auto "<task prompt>"
```

### B) OMX
```bash
omx /autopilot "<task prompt>"
```
또는 환경에 맞는 OMX 명령으로 동등한 작업을 수행한다.

## Commit Convention
- `feat:` 기능 추가
- `fix:` 버그 수정
- `refactor:` 구조 개선(동작 변화 없음)
- `docs:` 문서 변경
- `chore:` 설정/빌드/기타

## DoD per Cycle
- 코드/문서에 의미 있는 개선 1건 이상
- 커밋 1개 이상
- 의사결정 또는 운영 로그 업데이트

## Current Focus
1. FSM + Safety Gate 구체화
2. 10초 틱 워커 안정화
3. 재시도/백오프 + idempotency
4. replay 가능한 JSONL 로그 포맷 고정
