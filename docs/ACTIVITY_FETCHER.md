# Activity Fetcher Refactor Notes

`scripts/fetch-activity.js`의 단일 파일 책임을 작은 모듈로 분리했습니다.

## 모듈 구성

- `scripts/fetch-activity.js`
  - CLI 진입점 (`--hours`, `--skip-api`, `--log-file` 등)
  - `.env` 로드 + 결과 JSON 출력 + 최상위 에러 핸들링
- `scripts/lib/activity/fetch-activity-kpis.js`
  - 오케스트레이션: API 우선 조회 → 실패/신호 부족 시 로컬 리플레이 fallback
  - 최종 출력 스키마 및 마스킹 처리
- `scripts/lib/activity/api-client.js`
  - 후보 엔드포인트 순차 조회, 타임아웃/네트워크 처리
  - 첫 유효 KPI 신호를 반환
- `scripts/lib/activity/summarizer.js`
  - API 응답 payload 정규화/요약 (`progress_delta`, `action_status_counts`, `known_outcomes`)
- `scripts/lib/activity/replay-fallback.js`
  - 로컬 JSONL 파일 파싱 및 리플레이 기반 KPI 계산
- `scripts/lib/activity/runtime.js`
  - `.env`/CLI 파서
- `scripts/lib/activity/common.js`, `scripts/lib/activity/constants.js`, `scripts/lib/activity/errors.js`
  - 공통 유틸, 상수, 에러 타입

## 동작 호환성

- 출력 계약(`progress_delta`, `action_status_counts`, `known_outcomes`, `source`, `endpoint_statuses`)은 유지됩니다.
- 따라서 기존 운영 루틴( Buju API 조회 → 운영 피드백 문서 업데이트 → 필요 시 git commit/push )에서 `activity:fetch` 연동 방식은 변경하지 않아도 됩니다.

## 에러 처리 경로 분리

- 네트워크/API 전송 에러: `ActivityNetworkError` (`api-client.js`)
- 파일 I/O 에러: `ActivityFileError` (`replay-fallback.js`)
- CLI 최상위 실패 처리: `scripts/fetch-activity.js`에서 안전한 기본 payload 출력 + 종료 코드 1

## 최소 검증 방법

### 1) Fallback 검증 (권장)

```bash
npm run verify:activity
```

기대 결과:
- `verify:activity:fallback passed (...)` 출력
- 1시간 윈도우 기준으로 synthetic JSONL의 성공/실패/스킵 및 승/패 지표가 기대값과 일치

### 2) 수동 실행 검증

```bash
npm run activity:fetch -- --skip-api --hours 1
```

기대 결과:
- JSON 출력
- `source`가 `fallback:local_replay`
- `endpoint_statuses` 항목들이 `status: "skipped"`

### 3) 라이브 API 경로 검증 (선택)

```bash
npm run activity:fetch -- --hours 1
```

기대 결과:
- 성공 시 `source`가 `api:/...` 또는 API 신호 부족 시 `fallback:local_replay`
- 어떤 경우에도 API 키 문자열은 출력에 노출되지 않음
