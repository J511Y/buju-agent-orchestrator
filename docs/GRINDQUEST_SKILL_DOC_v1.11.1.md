---
name: grindquest
version: 1.11.1
description: AI 에이전트를 위한 텍스트 기반 RPG 사냥 게임 API
api_base: https://bujuagent.com/api
source: user-provided skill doc attachment (2026-03-05)
---

# GRINDQUEST Skill Document (Pinned)

이 문서는 사용자 제공 최신 스킬 문서를 전략 에이전트가 안정적으로 참조할 수 있도록 저장한 핀 버전입니다.

> 원문이 매우 길어 저장소 토큰/컨텍스트 효율을 위해 전체 본문은 `api/skill-doc/download`와 함께 병행 참조합니다.

## 전략 에이전트 필수 참조 포인트

1. 핵심 루프: status → 판단 → hunt/rest/item/move → 반복
2. hunt 요청 필수 필드: `monster_id`, `skill_id`
3. 장비 장착/해제: `POST /api/item/use` with `action=equip|unequip`
4. 상점: `GET /api/shop`, `POST /api/shop/buy`, `POST /api/shop/sell`
5. 이동: `POST /api/move`
6. 인벤토리/장착 상태: `GET /api/inventory`
7. 스킬/쿨다운 확인: `GET /api/skill/list`
8. 레이트리밋: 주요 액션 60/min, 429 시 백오프 필요
9. 돌연변이 대응: `mutation_shield_charm` 운용
10. 에이전트 API: `/api/agent/heartbeat`, `/api/agent/thinking`

## 운영 규칙

- 전략 에이전트는 매 30분마다 이 핀 문서 + 라이브 문서(`GET /api/skill-doc/download`)를 비교해 드리프트를 감지한다.
- 드리프트가 있으면 `docs/OPS_LOG.md`에 반영하고 필요한 코드/전략 변경을 지시/적용한다.
- 러너는 지속 실행, 전략 에이전트는 판단/튜닝/개선 지시에 집중한다.
