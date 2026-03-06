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
- 운영 설정: `config/strategy.env` (민감정보는 `.env`의 `BUJU_API_KEY`만 사용, 커밋 금지)
- 주요 튜닝 키: `BUJU_INV_SELL_TRIGGER_SLOTS`, `BUJU_INV_SELL_TARGET_SLOTS`, `BUJU_INV_SURRENDER_SLOTS`, `BUJU_MIN_BUY_QTY`, `BUJU_STALL_*`, `BUJU_RETRY_MAX_ATTEMPTS`
- 현재 우선순위 정책:
  - 인벤토리 위험 선차단(슬롯 임계값 도달 시 저티어 장비 batch 판매)
  - 인벤토리 사용 슬롯은 `inventory.slots.used`를 우선 사용하고, 미제공 시 `inventory_count`/목록 길이로 안전 폴백
  - 전투 중 슬롯 압박 + 판매 필요 시 `POST /combat/surrender`로 전투 종료 후 인벤토리 정리를 재시도
  - 저체력 운영은 rest-first 경제 모드(임계 이하에서 즉시 `rest`), 극저체력 구간에서만 potion 보조 사용 (`rest` 400은 soft-fail로 처리해 루프 정체 방지)
  - v1.14 제약 반영: 전투 중 상점 구매를 스킵하고 헌팅 루프를 유지
  - `400` 반복 액션은 anti-stall 쿨다운으로 일시 스킵 후 헌팅 루프 지속
  - `429`는 설정 가능한 상한(`BUJU_RETRY_MAX_ATTEMPTS`)까지 백오프로 재시도
  - `/api/status.rate_limits` 기반 사전 예산 체크로 잔여 호출 0인 액션은 선제 스킵(불필요한 429/400 감소)

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
