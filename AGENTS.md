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
- `docs/GRINDQUEST_SKILL_DOC_v1.11.1.md` (runtime contract pinned; live source latest check: `v1.15.0`)

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
   - Live runner(`scripts/live-action-tick.js`, `scripts/live-strategy-runner.js`, `scripts/live-runner-daemon.sh`) 변경 시: dry-run 출력 확인 + 로그 경로(`logs/live-runner-daemon.log`) 및 단일 인스턴스 PID 락(`logs/live-runner-daemon.lock`) 동작 확인 + 전투 진입 계약(`BUJU_USE_COMBAT_START=1` 기본값에서는 `combat/start`의 `monster_id`,`area` + `combat/strategy` payload 변경/refresh tick 조건부 갱신 적용, hunt 예산 0일 때 strategy 호출 생략, `combat/start` 404·`API_DEPRECATED`·429 시 필요 폴백 `hunt`, 토글 비활성화 시 `hunt`(`monster_id`,`skill_id`) 경로 유지) 유지 확인 + `combat/start` 429 연속 시 streak 기반 적응형 stall cooldown(기본 `BUJU_STALL_429_COOLDOWN_TICKS` + 최대 6 tick) 적용 유지 확인 + 안전 후퇴 계약(최근 8틱 패배/위험 항복 누적 3회 이상 시 `move_safety_retreat`로 `BUJU_AREA_LV1` 강제) + 무장 공백 이동 안전 계약(방어구 미착용 상태에서 `move_no_armor_retreat`로 `BUJU_AREA_LV1` 강제) + 저레벨 이동 폴백 계약(`level < BUJU_MOVE_LEVEL_2`이고 현재 지역이 `BUJU_AREA_LV1`이 아니면 `move_threshold_fallback`으로 `BUJU_AREA_LV1` 강제) + 몬스터 안전 선택 계약(레벨 격차 + 공격력 가드 + hard danger cap 동시 적용, 안전 필터 미충족 시 최저 위험 몬스터 폴백) 유지 확인
   - 인벤토리 정리/슬롯 판단 로직 변경 시: `inventory.slots.used` 우선 사용 계약과 폴백(`inventory_count`/목록 길이), 전투 중 판매 불가 시 surrender 경유 정리 경로를 README 정책과 동기화
   - 시즌 리셋 안전장치(장비 공백 시 전투 중단/재장착, 위험 전투 즉시 항복) 변경 시 surrender 트리거 기준(HP/몬스터 위험도)과 README 운영 정책을 함께 갱신
   - 저체력 항복 게이트는 `max(0.4, BUJU_LOW_HP_RATIO + 0.05)` 계약을 기본으로 유지하고, 수식 변경 시 README/DECISIONS 동시 갱신
   - 인벤토리 매각 정책 변경 시: 장착 대비 열위 장비 우선 정리, 장착본(item_id 중복 스택) 예약 보전, trigger/target 슬롯(예: 10→8) 의도를 README와 함께 동기화
   - `config/strategy.env` 튜닝 변경 시: 기본 페이싱(`BUJU_BASE_DELAY_MS`)/사이클 쿼터(`BUJU_MAX_ACTIONS_PER_CYCLE`)/구매 쿨다운(`BUJU_BUY_COOLDOWN_TICKS`)/이동 임계(`BUJU_MOVE_LEVEL_*`, `BUJU_AREA_LV*`)/안전 사냥 간격(`BUJU_MAX_SAFE_MONSTER_LEVEL_GAP`)/인벤토리 임계값(`BUJU_INV_*`)/포션 사용량(`BUJU_POTION_USE_MAX_QUANTITY`)·포션 재고(`BUJU_MIN_HP_POTION_S`, `BUJU_MIN_MP_POTION_S`)·저체력 임계(`BUJU_LOW_HP_RATIO`, `BUJU_LOW_HP_POTION_RATIO`)·최소 구매 수량(`BUJU_MIN_BUY_QTY`)/골드 예비금(`BUJU_MIN_GOLD_RESERVE`, `BUJU_MUTATION_MIN_GOLD_RESERVE`)/anti-stall(`BUJU_STALL_*`)/전략 갱신 주기(`BUJU_COMBAT_STRATEGY_REFRESH_TICKS`)/재시도·백오프(`BUJU_RETRY_MAX_ATTEMPTS`, `BUJU_BACKOFF_*`)/전투 진입 토글(`BUJU_USE_COMBAT_START`)/강화 안전장치(`BUJU_ENHANCE_*`) 의도와 README Live Strategy Runner 정책 설명을 함께 동기화
  - README의 "현재 기본값" 표기(특히 `BUJU_BASE_DELAY_MS`, `BUJU_MAX_ACTIONS_PER_CYCLE`, `BUJU_POTION_USE_MAX_QUANTITY`, `BUJU_MIN_GOLD_RESERVE`, `BUJU_MUTATION_MIN_GOLD_RESERVE`, `BUJU_STALL_429_COOLDOWN_TICKS`, `BUJU_COMBAT_STRATEGY_REFRESH_TICKS`, `BUJU_BACKOFF_BASE_MS`, `BUJU_USE_COMBAT_START`)가 `config/strategy.env` 실값과 일치하는지 함께 확인
   - 단, 인벤토리 안전 불변식(판매 트리거/목표 10→8, tick당 정리 10회)은 코드 하드제약이다. 관련 env 값이 존재해도 실행 경로에서 오버라이드되지 않음을 문서에 명시한다.
   - 라이브 정책이 API 메커닉(v1.14+ 전투 중 상점 제한, `rest` 400 soft-fail 등)을 반영하도록 유지하고, 제약 변경 시 BUJU_GAME_CONTEXT/README 동시 갱신
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
