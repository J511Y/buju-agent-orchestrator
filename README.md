# buju-agent-orchestrator

BujuAgent 고득점 자동운영을 위한 백엔드 오케스트레이터입니다.

이 문서는 **일반 개발자용**입니다.  
에이전트 실행 지침은 [`AGENTS.md`](./AGENTS.md)를 참고하세요.

## 목표
- 실시간 액션 판단을 LLM 의존에서 분리
- 결정 경로를 FSM/룰엔진 중심으로 고속화
- 10초 틱 기반 안정 운영 + 재시도/복구 자동화

## 아키텍처 개요
- **Hot path (실시간):** State Ingest → Safety Gate(실행 실패 서킷 브레이커 포함) → FSM/Rules → Action Executor
- **Cold path (비동기):** Battle Logs → Optimizer → Policy Update
- **LLM 역할:** 예외/전략 조정(비동기), 실시간 경로에서 제외

자세한 내용은 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

## 디렉토리 구조
- `src/engine`: 안전 규칙, FSM, 룰 평가기
- `src/worker`: 10초 틱 워커, 스케줄/락
- `src/client`: Buju API 클라이언트(재시도/백오프)
- `src/store`: 상태 스냅샷/전투 로그/정책 버전
- `src/optimizer`: 휴리스틱/밴딧 기반 정책 튜닝
- `src/llm`: 비동기 어드바이저 연동
- `src/ops`: 메트릭, 헬스체크, 알림 훅

## 빠른 시작
```bash
npm install
npm run dev
```

## 개발 원칙
1. 실시간 경로에서 블로킹 I/O 최소화
2. 모든 의사결정은 추적 가능해야 함(why-log)
3. 재현 가능한 로그(JSONL) 우선
4. 정책 변경은 버전 관리 + 롤백 가능해야 함

## 운영 원칙
- 키/토큰 하드코딩 금지 (`.env` 사용)
- 로그에 민감정보 마스킹
- 카나리 배포 + 자동 롤백 기준 유지

## 로드맵
[`docs/ROADMAP.md`](./docs/ROADMAP.md) 참고

## 기여
- 이슈 기반으로 작업 단위를 분리해 진행
- 작은 PR, 명확한 커밋 메시지 권장

## Worker Reliability
- 워커/루프 신뢰성 최소 검증:
  - `npm run verify:cycle`
  - `npm run verify:worker`
  - `npm run verify:replay`
- `verify:replay` 요약은 결정 규칙 분포/서킷 차단 지표와 운영 카운터(예: invalid target 차단, 재시도 후 성공)를 포함하며, 회귀 감지 기준으로 유지한다.
- Safety Gate의 큐 포화 기준은 `pendingActionCount >= maxPendingActions`이며, 용량 도달 시 즉시 `action_queue_saturated`로 차단한다.

## Live Strategy Runner (Rule-based)
- 단발 틱 실행(기본 2틱): `node scripts/live-action-tick.js [ticks]`
- 연속 전략 실행: `node scripts/live-strategy-runner.js`
- 데몬 실행(로그: `logs/live-runner-daemon.log`): `bash scripts/live-runner-daemon.sh`
  - 단일 인스턴스 가드: `logs/live-runner-daemon.lock` PID 락이 살아있으면 중복 실행을 건너뜀
- 운영 설정: `config/strategy.env` (민감정보는 `.env`의 `BUJU_API_KEY`만 사용, 커밋 금지)
- 주요 튜닝 키: `BUJU_BASE_DELAY_MS`, `BUJU_MAX_ACTIONS_PER_CYCLE`, `BUJU_BUY_COOLDOWN_TICKS`, `BUJU_MOVE_LEVEL_*`, `BUJU_AREA_LV*`, `BUJU_MAX_SAFE_MONSTER_LEVEL_GAP`, `BUJU_INV_SURRENDER_SLOTS`, `BUJU_MIN_HP_POTION_S`, `BUJU_MIN_MP_POTION_S`, `BUJU_MIN_BUY_QTY`, `BUJU_LOW_HP_RATIO`, `BUJU_LOW_HP_POTION_RATIO`, `BUJU_MIN_GOLD_RESERVE`, `BUJU_MUTATION_MIN_GOLD_RESERVE`, `BUJU_POTION_USE_MAX_QUANTITY`, `BUJU_STALL_*`, `BUJU_RETRY_MAX_ATTEMPTS`, `BUJU_BACKOFF_*`, `BUJU_USE_COMBAT_START`, `BUJU_ENHANCE_*`
- 하드 인벤토리 안전 불변식(환경변수로 오버라이드하지 않음): 판매 트리거/목표 슬롯은 10→8, 정리 반복 상한은 tick당 10회로 고정
- 현재 우선순위 정책:
  - 인벤토리 위험 선차단(기본 10→8 슬롯 정리 모드): 현재 장착 대비 열위 장비 전량 우선 매각, 이후 필요 시 저티어 장비 batch 판매
  - 매각 시 장착본 보전 규칙 적용: 장착 중인 item_id와 겹치는 스택은 장착 수량만큼 예약해 오매각 방지
  - 인벤토리 사용 슬롯은 `inventory.slots.used`를 우선 사용하고, 미제공 시 `inventory_count`/목록 길이로 안전 폴백
  - 전투 중 슬롯 압박 + 판매 필요 시 `POST /combat/surrender`로 전투 종료 후 인벤토리 정리를 재시도
  - 시즌 리셋/장비 공백 구간에서는 무기·방어구 미착용 시 전투를 우선 중단하고 장착 완료 후 사냥을 재개
  - 방어구 미착용 상태에서 현재 지역이 `BUJU_AREA_LV1`이 아니면 `move_no_armor_retreat`로 `BUJU_AREA_LV1` 강제 복귀(장비 복구 전 이동 리스크 차단)
  - 현재 전투 몬스터 위험도(레벨/공격력/체력) 초과 시 `POST /combat/surrender`로 즉시 이탈해 연속 사망을 방지
  - 전투 중 저체력 항복 임계는 고정값이 아닌 `max(0.4, BUJU_LOW_HP_RATIO + 0.05)` 적응형 게이트로 유지해 과도한 항복/재진입 반복을 줄임
  - 최근 8틱 기준 패배 또는 위험 항복 누적이 3회 이상이면 `BUJU_AREA_LV1`로 안전 후퇴(`move_safety_retreat`) 후 정상 지역 진행으로 복귀
  - `level < BUJU_MOVE_LEVEL_2` 구간에서 현재 지역이 `BUJU_AREA_LV1`이 아니면 임계 기반 지역 폴백(`move_threshold_fallback`)으로 저레벨 과위험 이동을 차단
  - 저체력 운영은 rest-first 경제 모드(임계 이하에서 즉시 `rest`), 극저체력 구간에서만 potion 보조 사용 (`rest` 400은 soft-fail로 처리해 루프 정체 방지, 현재 기본값: `BUJU_POTION_USE_MAX_QUANTITY=3`)
  - 루틴 포션 바닥 보충(`hp_potion_s`, `mp_potion_s`)은 `BUJU_MIN_GOLD_RESERVE`를 침범하지 않는 범위에서만 수행
  - mutation 방어 부적(`mutation_shield_charm`) 확보는 일반 예비금과 분리된 하한(`min(BUJU_MIN_GOLD_RESERVE, BUJU_MUTATION_MIN_GOLD_RESERVE)`)으로 판단해 이동 중 연속 사망 리스크를 우선 차단
  - 중반 레벨 이상에서는 블랙스미스 NPC + 주문서 보유 + 골드 예비금 조건을 동시에 만족할 때만 안전 강화(`enhance`)를 수행
  - 전투 진입 경로는 `BUJU_USE_COMBAT_START` 토글로 운영한다(현재 기본값: `1`). 기본값에서는 `POST /combat/start`(`monster_id`,`area`) + `POST /combat/strategy` 조건부 갱신(payload 변경 또는 `BUJU_COMBAT_STRATEGY_REFRESH_TICKS` 경과)을 적용하고, 토글 비활성화 시 `POST /hunt`(`monster_id`,`skill_id`) 경로로 동작한다
  - `hunt` 예산이 0이면 `/combat/strategy` 갱신 호출까지 생략하고 `wait_hunt_rate_limit`로 대기(제어 호출 churn 최소화)
  - `POST /combat/start`가 404 또는 `API_DEPRECATED` 응답이면 `POST /hunt`(`monster_id`,`skill_id`)로 자동 폴백
  - v1.14 제약 반영: 전투 중 상점 구매를 스킵하고 헌팅 루프를 유지
  - `400` 반복 액션은 anti-stall 쿨다운으로 일시 스킵 후 헌팅 루프 지속
  - `429`는 설정 가능한 상한(`BUJU_RETRY_MAX_ATTEMPTS`)까지 백오프로 재시도
  - `POST /combat/start`가 `429`를 반환하면 같은 틱에서 1회 `POST /hunt` 폴백(`hunt_on_combat_start_rate_limit`)을 시도해 순수 대기 비율을 낮춤
  - `/api/status.rate_limits` 기반 사전 예산 체크로 잔여 호출 0인 액션은 선제 스킵(불필요한 429/400 감소)
  - `BUJU_BASE_DELAY_MS`는 rate-limit 병목 완화를 위한 기본 페이싱 제어값으로 운영하며, 변화 시 소폭/가역 튜닝을 우선 (현재 기본값: `5600`)
  - `BUJU_MAX_ACTIONS_PER_CYCLE`는 rate-limit 구간에서 사이클당 burst를 줄이기 위한 1차 쿼터 제어값으로 운영 (현재 기본값: `1`)
  - 지역 이동 임계(`BUJU_MOVE_LEVEL_*`/`BUJU_AREA_LV*`)와 안전 사냥 간격(`BUJU_MAX_SAFE_MONSTER_LEVEL_GAP`)은 연속 패배/과위험 전투를 줄이기 위한 보수적 기본값으로 유지(현재 기본값 예: `BUJU_MOVE_LEVEL_2=30`)
  - 몬스터 선택 안전 필터는 레벨 격차 + 공격력 가드 + hard danger cap(압박/무장 상태 반영) 3중 게이트를 함께 사용하며, 안전 필터가 비면 최저 위험 몬스터 우선으로 폴백
  - 위험 전투 압박(최근 패배 1회 이상 또는 최근 4틱 위험 항복 2회 이상) 구간에서는 효율 점수보다 안전성을 우선해 단일 최저 위험 몬스터로 타깃을 수축
  - `BUJU_STALL_429_COOLDOWN_TICKS`/`BUJU_RETRY_MAX_ATTEMPTS`/`BUJU_BACKOFF_*` 조합으로 429 루프를 냉각하며, 반복 구간에서는 액션 빈도를 낮춰 재진입(현재 기본값 예: `BUJU_STALL_429_COOLDOWN_TICKS=48`, `BUJU_COMBAT_STRATEGY_REFRESH_TICKS=52`, `BUJU_BACKOFF_BASE_MS=2200`)
  - 구매/회복 정책은 골드 예비금 하한(`BUJU_MIN_GOLD_RESERVE=430`, `BUJU_MUTATION_MIN_GOLD_RESERVE=260`)을 기준으로 유지해 전투 유동성과 mutation 리스크 방어를 함께 보전
  - `combat/start` 429가 연속되면 연속 횟수(최대 +6 tick)를 더한 적응형 쿨다운을 추가 적용해 즉시 재시도 폭주를 억제

## Activity KPI Fetcher
- 실행: `npm run activity:fetch`
- 최소 검증:
  - `npm run verify:activity`
  - `npm run verify:activity-config`
  - `npm run verify:activity-log`
  - `npm run verify:activity-log-rotation`
  - `npm run verify:activity-probe-summary`
- 운영 설정:
  - 엔드포인트 후보: `config/activity-endpoints.json`
  - Probe 로그(JSONL): `logs/activity-probe-log.jsonl` (기본값, 마스킹 저장)
- 리팩토링/에러 경로/검증 상세: [`docs/ACTIVITY_FETCHER.md`](./docs/ACTIVITY_FETCHER.md)

## 도메인 컨텍스트
- Buju 게임/운영 배경: [`docs/BUJU_GAME_CONTEXT.md`](./docs/BUJU_GAME_CONTEXT.md)
