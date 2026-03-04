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

