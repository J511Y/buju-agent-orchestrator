# Experiments Log

Track A/B and policy experiments.

## Template
- Date:
- Hypothesis:
- Change:
- Metric(s):
- Result:
- Decision:

## Entries
- Date: 2026-03-04 22:09 KST
- Hypothesis: Missing/undocumented recent-activity API is causing blind spots; adding a local-log fallback KPI extractor will improve hourly feedback quality and actionability.
- Change: Build `fetch-activity` probe (API-first, JSONL fallback) and compute 1h metrics (ticks, action success/fail/skipped, inferred battle outcomes).
- Metric(s): % of hourly cycles with non-empty last-hour gameplay summary; number of unresolved "unknown win/defeat" reports.
- Result: Pending.
- Decision: Pending next cycle validation.

- Date: 2026-03-04 23:09 KST
- Hypothesis: Activity endpoint uncertainty is the primary cause of low-fidelity hourly feedback.
- Change: Re-ran multi-endpoint probe (`/api/logs/recent`, `/api/activity/recent`, `/api/battle/logs/recent`) alongside `/api/status`.
- Metric(s): Endpoint availability rate; ability to report win/defeat in hourly summary.
- Result: Availability remains 0/3 for recent-activity endpoints (all 404); win/defeat remains unknown from API-only path.
- Decision: Keep experiment open; prioritize local JSONL fallback implementation next cycle.
