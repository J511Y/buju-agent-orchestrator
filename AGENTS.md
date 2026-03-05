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
- `docs/RUNBOOK_AUTONOMY.md`
- `docs/GRINDQUEST_SKILL_DOC_v1.11.1.md` (pinned)

At least once per day (or immediately after API schema-related failures), refresh source-of-truth schema from:
- `GET https://bujuagent.com/api/skill-doc/download`

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
   - Activity 수집 경로 변경 시: `npm run verify:activity`, `npm run verify:activity-config`, `npm run verify:activity-log`, `npm run verify:activity-log-rotation`, `npm run verify:activity-probe-summary`
   - 워커 safety gate/실패 복구 로직 변경 시: `npm run verify:cycle`, `npm run verify:worker`, `npm run verify:replay`
   - Safety Gate 용량 임계값(`pendingActionCount >= maxPendingActions`) 계약을 변경하면 README 반영 + `verify:cycle` 포화 경계 케이스를 갱신
   - 리플레이 요약 계약(지표/필드) 변경 시 README의 Worker Reliability 섹션을 함께 갱신(결정 규칙 분포 + invalid target/재시도 성공 등 운영 카운터 반영)
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

## Refactoring Doctrine (Mandatory)
향후 모든 개발 사이클에서 아래 원칙을 강제한다.

1. **단일 책임 원칙 우선**
   - 300라인 이상 파일 또는 3개 이상 책임(입출력/도메인로직/오케스트레이션)이 섞이면 분리 후보로 간주.
2. **얇은 엔트리, 두꺼운 모듈**
   - CLI/entry 파일은 파싱/호출/종료코드만 담당.
   - 실제 로직은 `scripts/lib/*` 또는 `src/*` 모듈로 이동.
3. **에러 경로 분리**
   - 네트워크/API, 파일 I/O, 도메인 검증 오류를 별도 타입/핸들러로 관리.
4. **출력 계약 보존**
   - 리팩토링 시 기존 JSON 스키마/CLI 옵션/반환 계약을 깨지 않는다.
5. **리팩토링 체크리스트 필수**
   - 책임 매핑표(전/후)
   - 최소 검증 명령 2개 이상
   - README 또는 docs 변경
6. **작은 PR/커밋 원칙**
   - 구조 개선과 기능 변경을 한 커밋에 섞지 않는다.
7. **서브에이전트 활용 기본값**
   - 중간 이상 리팩토링은 전담 서브에이전트로 실행하고, 완료 후 메인 에이전트가 리뷰/통합한다.
