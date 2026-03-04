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
