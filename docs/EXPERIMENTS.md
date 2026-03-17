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

- Date: 2026-03-18 04:29 KST
- Hypothesis: A tiny transport preflight gate (`status+logs` with staged retry metadata) will reduce zero-evidence hourly summaries during fetch-failure windows.
- Change: Before hourly synthesis, probe `GET /api/status` + `GET /api/logs?page=1&limit=100`; emit `{transport_state,retry_after_ms,inference_allowed}` and block gameplay-policy output when either probe transport-fails.
- Metric(s): `% blocked cycles with explicit transport_state`, `false gameplay-policy outputs during transport failures`, `time-to-first-successful-canonical-read`.
- Result: Current cycle transport-failed both canonical probes (`fetch failed`) with no last-hour evidence (`tmp/hourly-feedback-2026-03-17-19-30.json`).
- Decision: Execute in next 30-min dev cycle; keep if 3 consecutive failure cycles are explicitly classified with zero gameplay-policy output.

- Date: 2026-03-18 02:30 KST
- Hypothesis: A pressure-classifier KPI (`buy_hunt_ratio`, `surrender_hunt_ratio`) with a hard `high` threshold will reduce economy churn while preserving no-defeat safety by steering the next 30-minute tuning cycle.
- Change: Add `hourly-pressure-kpi-v1` that reads paged `/api/logs` last-60m window and emits `{buy_hunt_ratio,surrender_hunt_ratio,wins,defeats,events,pressure_state}` with `pressure_state=high` when `buy_hunt_ratio>=0.50 || surrender_hunt_ratio>=0.15`.
- Metric(s): `buy_hunt_ratio`, `surrender_hunt_ratio`, `gold_delta/hour`, `defeats/hour`.
- Result: Current cycle baseline is high-pressure despite stable safety (`events=684`, `wins=369`, `defeats=0`, `buy=197`, `surrender=64`, `buy:hunt=0.53`, `surrender:hunt=0.17`, gold `439`).
- Decision: Execute in next 30-min dev cycle; keep only if pressure ratios drop below threshold for 3 consecutive hourly windows without introducing defeats.

- Date: 2026-03-17 21:31 KST
- Hypothesis: Promoting hourly feedback to canonical paged `/api/logs` aggregation (instead of `*/recent` probes) will stabilize gameplay signals and reduce false zero-activity windows while `recent` endpoints stay `404`.
- Change: Add `hourly-paged-logs-kpi-v1` to fetch `/api/logs?page=n&limit=100` until 60m cutoff, then emit `{wins,defeats,hunt,buy,surrender,rest,sell,events,confidence}` and treat this as primary hourly source.
- Metric(s): `zero_signal_cycles/day`, `collector_vs_canonical divergence rate`, `buy:hunt ratio`, `surrender/hour`.
- Result: Current cycle shows canonical data is healthy (`/api/status=200`, `/api/logs=200`) with strong evidence (`events=684`, `wins=368`, `defeats=0`, `buy=200`, `surrender=65`) while collector `activity:fetch` still fallbacked with `recent` endpoints `404` and zero KPIs.
- Decision: Execute in next 30-min dev cycle; keep if 3 consecutive hourly cycles avoid fallback-zero and keep divergence rate near 0.

- Date: 2026-03-17 20:28 KST
- Hypothesis: Bumping auth-parity preflight to v7 with explicit tri-probe output (`status`,`logs`,`collector-status`) will eliminate false hourly gameplay synthesis during persistent `401 vs 200` split-signal windows.
- Change: Add `hourly-auth-parity-preflight-v7` artifact `tmp/hourly-auth-parity-preflight-v7.json` with `{status_code_status,status_code_logs,probe_status_code,auth_state,inference_allowed,retry_after_ms}` and block summary unless `inference_allowed=true`.
- Metric(s): `split_signal_cycles/day`, `% blocked cycles with deterministic auth_state`, `false gameplay-policy outputs during auth mismatch windows`.
- Result: Current cycle reproduced mismatch (`tmp/hourly-live-signal-20260317-2027.json`: canonical status/logs `401`; `tmp/hourly-activity-20260317-2027.json`: collector `/api/status=200` + recent endpoints `404`), leaving last-hour progression/outcomes/resources unresolved.
- Decision: Execute in next 30-min dev cycle; keep if 3 consecutive mismatch cycles are blocked with zero gameplay-policy output.

- Date: 2026-03-17 19:28 KST
- Hypothesis: A strict auth-parity preflight that compares canonical reads (`/api/status`,`/api/logs`) against collector probe status in the same run will eliminate split-signal hourly summaries (`canonical=401` while probe status appears `200`).
- Change: Add `hourly-auth-parity-preflight-v6` artifact `tmp/hourly-auth-parity-preflight-v6.json` with `{status_code_status,status_code_logs,probe_status_code,auth_state,inference_allowed,retry_after_ms}` and block gameplay KPI synthesis unless `inference_allowed=true`.
- Metric(s): `split_signal_cycles/day`, `% blocked cycles with explicit auth_state`, `false gameplay-policy outputs during auth mismatch windows`.
- Result: Current cycle reproduced mismatch (`tmp/hourly-live-snapshot.json`: status/logs `401`; `activity:fetch`: `/api/status=200` + `recent=404`), leaving last-hour progression/outcomes/resources unresolved.
- Decision: Execute in next 30-min dev cycle; keep if 3 consecutive mismatch cycles are deterministically blocked with zero gameplay-policy output.

- Date: 2026-03-17 17:27 KST
- Hypothesis: A hard auth-preflight gate (`/api/status` + `/api/logs?page=1&limit=100`) with credential-source parity metadata will eliminate zero-evidence hourly gameplay summaries during `401` windows.
- Change: Add `hourly-auth-preflight-v2` artifact `tmp/hourly-auth-preflight.json` with `{status_code_status,status_code_logs,auth_state,inference_allowed,retry_after_ms}` and block KPI synthesis unless `inference_allowed=true`.
- Metric(s): `% blocked cycles with explicit auth_state`, `false gameplay-policy outputs during auth failures`, `time-to-first dual-200 after key/source fix`.
- Result: Current cycle returned `401` on `/api/status` and auth-failed `/api/logs` with `events_in_window=0`; last-hour gameplay outcomes/resources were unresolved.
- Decision: Run in next 30-min dev cycle; keep if 3 consecutive auth-failure cycles are fully classified with zero gameplay-policy output.

- Date: 2026-03-17 10:26 KST
- Hypothesis: Forcing both collector and canonical probes through a single shared DNS-resolved client (`/api/status` + `/api/logs?limit=1`) will eliminate split-signal cycles where probe path shows `status=200` but canonical reads fail transport (`ENOTFOUND`).
- Change: Add `shared-client-preflight-v4` to emit `tmp/hourly-preflight.json` `{dns_state, readpath_state, status_code_status, status_code_logs, inference_allowed, retry_after_ms}` and block gameplay synthesis unless `dns_state=ok && readpath_state=ok`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with deterministic DNS/readpath class`, false gameplay-summary count during DNS failures.
- Result: Current cycle reproduced mismatch (`activity:fetch` reported `/api/status=200` + `recent=404`, while direct canonical status/log probes failed with `ENOTFOUND www.buju.quest`), leaving last-hour outcomes/resources unresolved.
- Decision: Run in next 30-min dev cycle; keep if 4 consecutive mismatch cycles are deterministically blocked with zero gameplay-policy output.

- Date: 2026-03-17 09:27 KST
- Hypothesis: A single-runtime shared-client preflight (collector + direct probes through the same fetch stack) will eliminate transport split-signals and prevent zero-evidence gameplay summaries.
- Change: Add `hourly-shared-client-preflight-v3` that checks `/api/status` + `/api/logs?page=1&limit=100`, emits `{dns_state, transport_state, status_http, logs_http, inference_allowed, retry_after_ms}`, and blocks synthesis unless `inference_allowed=true`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with deterministic failure class`, false gameplay-summary count during transport failures.
- Result: Current cycle reproduced divergence (`activity:fetch` saw `/api/status=200` with recent endpoints `404`, while direct status/log probes both failed `fetch failed`), leaving last-hour outcomes/resources unresolved.
- Decision: Run in next 30-min dev cycle; keep if 4 consecutive transport-divergence cycles are blocked with zero gameplay-policy output.

- Date: 2026-03-17 07:26 KST
- Hypothesis: A same-runtime shared-client preflight with bounded retry metadata will reduce split-signal hourly cycles where collector `/api/status` is reachable but direct canonical reads fail at transport (`fetch failed`).
- Change: Add `hourly-preflight-shared-client-v2` before synthesis (`/api/status` + `/api/logs?page=1&limit=100`), emit `{dns_state, readpath_state, inference_allowed, retry_after_ms}`, and block gameplay inference unless `inference_allowed=true`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with explicit failure class`, false gameplay-inference count during transport failures.
- Result: This cycle showed collector `/api/status=200` with recent endpoints `404`, while direct canonical status/log probes both failed transport (`fetch failed`), leaving last-hour gameplay evidence unavailable (`events=0`).
- Decision: Run in next 30-min dev cycle; keep if 4 consecutive split cycles are deterministically blocked with zero gameplay-policy output.

- Date: 2026-03-16 20:26 KST
- Hypothesis: Enforcing an hourly auth-parity gate that compares collector and direct probes in one run will eliminate split-signal summaries (`collector /api/status=200` while direct status/log are `401`) and reduce false gameplay inference.
- Change: Before synthesis, emit `tmp/hourly-auth-parity.json` from same-process checks (`collector activity:fetch status`, direct `GET /api/status`, direct `GET /api/logs?limit=1`) and require all to be `200` for `inference_allowed=true`.
- Metric(s): `split_signal_rate`, `% blocked cycles with deterministic auth_state`, `false gameplay-summary count during auth drift`.
- Result: Current cycle reproduced divergence (`activity:fetch` reported `/api/status=200` + recent endpoints `404`, while direct `/api/status` and `/api/logs` were both `401`), so last-hour gameplay outcomes were unresolved.
- Decision: Run in next 30-min dev cycle; keep if 3 consecutive split-signal cycles are deterministically blocked with zero gameplay-policy recommendations.

- Date: 2026-03-16 13:26 KST
- Hypothesis: A shared-client telemetry preflight with explicit DNS classification (`dns_unreachable`) will reduce zero-evidence hourly feedback and speed outage triage during resolver incidents.
- Change: Run `telemetry-preflight-shared-client` before hourly synthesis (`/api/status` + `/api/logs?limit=1`), emit `{dns_state, readpath_state, inference_allowed, retry_after_ms}`, and block gameplay inference unless `inference_allowed=true`.
- Metric(s): `% blocked cycles with explicit root-cause`, `false gameplay inference count during transport failures`, `time-to-retry recommendation generation`.
- Result: Current cycle failed pre-data collection with `ENOTFOUND webgame-api.berrysoft.kr` while loading key from `.env` successfully, leaving `events=0` and no trustworthy last-hour gameplay evidence.
- Decision: Run in next 30-min dev cycle; keep if 4 consecutive transport-failure cycles are classified deterministically with zero gameplay inference.

- Date: 2026-03-16 09:26 KST
- Hypothesis: Hard-gating hourly feedback on an auth preflight artifact (`status + logs`) will prevent invalid gameplay summaries during key failures and shorten root-cause time.
- Change: Add required preflight step that emits `tmp/hourly-auth-preflight.json` (`ok|unauthorized|source_mismatch`) and skips gameplay synthesis unless `ok`.
- Metric(s): `% auth-failed cycles with deterministic state`, `false gameplay-summary count during 401 windows`, `mean time-to-recover after key update`.
- Result: Current live probe returned `401` for both `GET /api/status` and `GET /api/logs?page=1&limit=5`; no trustworthy last-hour gameplay data was available.
- Decision: Run in next 30-min dev cycle; keep if two consecutive auth-failure cycles produce deterministic classification with zero inferred gameplay output.

- Date: 2026-03-16 08:28 KST
- Hypothesis: A `buy-sell balance guard v1` (`buy>=110/h && sell<=3/h`) that inserts buy cooldown + forced pre-buy inventory sell-check will cut economy churn while preserving hunt throughput.
- Change: Add guard path in live loop before buy burst execution; require one sell-check pass and short cooldown when trigger condition is met.
- Metric(s): `buy_per_hour`, `sell_per_hour`, `buy:sell ratio`, `hunt_per_hour`, `gold_delta/hour`, `death_per_hour`.
- Result: Current live window (`07:28~08:28 KST`) shows persistent churn despite stable safety (`events=379`, `hunt=205`, `buy=118`, `sell=2`, `surrender=7`, `death=0`, status `exp=2525`, `gold=389`).
- Decision: Execute in next 30-min dev cycle; keep only if `buy<=100/h` and `buy:sell` improves to `<=40:1` without `hunt` drop >10% and deaths stay `0`.

- Date: 2026-03-16 07:26 KST
- Hypothesis: A buy-pressure guard that prioritizes `rest/use_item` before shop calls when `buy` and `surrender` surge will reduce gold churn without reducing hunt throughput.
- Change: In hourly/live feedback loop, trigger guard when `buy>=100/h` or `surrender>=10/h`: cap burst buys, require `rest/use_item` precheck, and add 1-tick re-engage delay after surrender.
- Metric(s): `buy_per_hour`, `surrender_per_hour`, `gold_delta/hour`, `hunt_per_hour`, `death_per_hour`.
- Result: Baseline this cycle (`06:28~07:28 KST`) from live logs: `events=429`, `hunt=225`, `buy=132`, `surrender=10`, `death=0`, `sell=3`, status `gold=389`.
- Decision: Execute in next 30-min dev cycle; promote only if buy and surrender both drop >=20% while hunt throughput drops <10% and deaths stay at 0.

- Date: 2026-03-15 20:27 KST
- Hypothesis: A stricter auth gate with explicit `expired_key` vs `source_mismatch` classification and bounded retry will reduce repeated zero-evidence hourly cycles during 401 incidents.
- Change: Add `auth-preflight-gate-v3` (`/api/status` + `/api/logs?limit=1`, 2 attempts, jittered backoff) and block hourly synthesis unless `auth_state=ok`.
- Metric(s): `% hourly cycles with deterministic auth_state`, `% low-confidence summaries during auth incidents`, `mean cycles-to-root-cause for 401 streaks`.
- Result: Live probe returned `401` on both `status` and `logs` at `20:27 KST`; last-hour gameplay evidence remained unavailable (`events=0`).
- Decision: Execute in next 30-min dev cycle; promote after 3 consecutive auth-failure cycles are classified without gameplay inference.

- Date: 2026-03-15 19:26 KST
- Hypothesis: Adding a versioned auth preflight (`status + logs`, same env source, short retry) with explicit `expired_key` classification will reduce repeated low-confidence hourly feedback during 401 streaks.
- Change: Implement `auth-preflight-gate-v2` that emits `ok|unauthorized|source_mismatch|expired_key` and blocks hourly gameplay synthesis unless `ok`.
- Metric(s): `% hourly cycles blocked with deterministic auth_state`, `repeat 401 cycles before root-cause classification`, `% low-confidence summaries during auth incidents`.
- Result: Current cycle returned `401` on both `/api/status` and `/api/logs?page=1&limit=100`; last-hour evidence set remained empty (`events=0`).
- Decision: Run in next 30-min dev cycle; promote if 3 consecutive auth-failure cycles are classified without fallback gameplay inference.

- Date: 2026-03-15 16:28 KST
- Hypothesis: A strict connectivity-first gate (`status + logs` with short jittered retry) will reduce false gameplay feedback during transport outages by deterministically classifying outage cause before synthesis.
- Change: Add `connectivity-preflight-v2` before hourly aggregation to emit `ok|dns_unreachable|network_unreachable|timeout` and block progression/win-defeat/resource inference unless state is `ok`.
- Metric(s): `% outage cycles with explicit root-cause tag`, `false gameplay inference count during transport failures`, `time-to-retry guidance generation`.
- Result: Current cycle failed both live reads (`/api/status`, `/api/logs?page=1&limit=100`) with transport-level `fetch failed`, leaving last-hour events unavailable (`0` sampled).
- Decision: Run in next 30-min dev cycle; promote if 4 consecutive outage cycles are classified deterministically with zero gameplay inference.

- Date: 2026-03-15 14:27 KST
- Hypothesis: Enforcing a hard `auth_preflight` gate before hourly KPI synthesis will eliminate zero-evidence gameplay summaries during credential failures.
- Change: Add `scripts/auth-preflight-gate.js` to probe `/api/status` and `/api/logs?limit=1` using the same `.env` loader and emit `auth_state` (`ok|unauthorized|source_mismatch`).
- Metric(s): `% hourly cycles blocked with explicit auth reason`, `% low-confidence gameplay summaries`, `time-to-recover after key rotation`.
- Result: Current live probe failed both reads with `401` (`status` + `logs page=1`) and produced `0` in-window events, confirming need to block inference when auth is broken.
- Decision: Run in next 30-min dev cycle; promote to default after 3 consecutive cycles with deterministic auth-state classification.

- Date: 2026-03-15 13:28 KST
- Hypothesis: A lightweight `hourly-sustainability-guard` triggered by surrender/buy spikes (`surrender>=6/h` or `buy>=35/h`) will reduce resource churn without sacrificing kill throughput.
- Change: Add guard in the strategy loop to increase temporary HP re-engage floor, cap burst buys per short window, and force one-cycle cooldown after surrender clusters.
- Metric(s): `buy_per_hour`, `surrender_per_hour`, net `gold` delta/hour, `wins/hour` change vs prior hour baseline (`wins=200`).
- Result: Baseline captured from live window (`279` events): `wins=200`, `defeats=0`, `surrender=8`, `buy=40`, `rest=19`, status gold `349` (below prior `359` checkpoint).
- Decision: Run in next 30-min dev cycle; keep only if surrender and buy both drop >=20% with no >10% win-rate regression.

- Date: 2026-03-15 09:27 KST
- Hypothesis: A hard auth preflight gate (`/api/status` + `/api/logs?limit=1`) using the identical credential-loading path as hourly fetch will eliminate recurring split-signal cycles (`activity:fetch ok` vs direct `401`).
- Change: Implement `scripts/auth-preflight-gate.js` and make hourly feedback exit with `auth_blocked` when probe state is not `ok`.
- Metric(s): Split-signal incidence per day; % hourly cycles producing low-confidence summaries; mean time to diagnose `401` events.
- Result: Current run reproduced split signal (`activity:fetch` reported `/api/status=200` while direct status/log probes in same shell were all `401`).
- Decision: Proceed next 30-min dev cycle; promote to required precondition if two consecutive runs classify state deterministically.

- Date: 2026-03-15 08:26 KST
- Hypothesis: A unified `auth-preflight-gate` executed in the same runtime context as hourly fetch will eliminate status/log auth ambiguity and reduce low-confidence cycles caused by credential-source drift.
- Change: Add `scripts/auth-preflight-gate.js` to probe `/api/status` and `/api/logs?limit=1` with masked env key, then emit deterministic `auth_state` (`ok|unauthorized|source_mismatch`) consumed by hourly feedback flow.
- Metric(s): % hourly cycles blocked with explicit auth reason; time-to-diagnose `401` incidents; false gameplay summaries during auth failures.
- Result: Current cycle reproduced split signal (`activity:fetch` status `200` while direct authenticated status/log probes returned `401`), preventing evidence-safe gameplay inference.
- Decision: Run in next 30-min dev cycle; promote if ambiguity is resolved within 2 consecutive hourly runs.

- Date: 2026-03-15 00:28 KST
- Hypothesis: An explicit `auth_source_diff_gate` (same-hour comparison of credential source used by `activity:fetch` vs direct bearer probes) will quickly isolate source mismatch vs true key invalidation and reduce low-confidence hourly cycles.
- Change: Add a tiny checker that runs `/api/status` + `/api/logs?limit=1` with both credential paths and emits `auth_state` (`ok|unauthorized|source_mismatch`) before hourly synthesis.
- Metric(s): Time-to-diagnose `401` incidents; % cycles marked low-confidence due to unresolved auth ambiguity; false gameplay-policy recommendations during auth faults.
- Result: Current cycle reproduced ambiguity (`activity:fetch` reported `/api/status=200` while direct authenticated `/api/status` and `/api/logs` both returned `401`), blocking reliable last-hour gameplay inference.
- Decision: Run in next 30-min dev cycle; promote if it resolves auth-failure root cause classification within 2 consecutive hourly runs.

- Date: 2026-03-14 21:29 KST
- Hypothesis: Replacing fallback-zero hourly summaries with a dedicated paged-log KPI extractor (`/api/logs?page=n&limit=100` until 60m cutoff) will produce consistently high-confidence gameplay signals despite persistent `*/recent` 404 outages.
- Change: Add `hourly-log-kpis` helper that outputs `hunt/win/defeat/surrender/rest/buy/sell/drop` plus `buy_spent/sell_gain/net_trade` in one structured payload for OPS ingestion.
- Metric(s): % hourly cycles with non-empty high-confidence outcomes; mismatch rate vs manual probe counts; time-to-write OPS summary.
- Result: This cycle recovered complete 60-minute evidence from paged logs (`325` events, `wins=246`, `defeats=0`) while `activity:fetch` remained fallback due to `*/recent` 404.
- Decision: Implement in next 30-min dev cycle; promote if high-confidence coverage stays >=95% for 6 consecutive hourly cycles.

- Date: 2026-03-14 19:28 KST
- Hypothesis: A strict read-auth preflight gate (`/api/status` + `/api/logs?limit=1`) before hourly aggregation will cut false gameplay interpretations during token drift by failing fast with explicit `auth_blocked` state.
- Change: Add preflight step that loads masked key from `.env`, runs both probes, and blocks outcome/resource inference whenever either probe returns `401/403`.
- Metric(s): Mean time to diagnose auth failures; % hourly cycles with invalid gameplay inference while auth is broken; preflight false-block rate once auth is restored.
- Result: Current cycle showed simultaneous `401` on both `/api/status` and `/api/logs`, leaving last-hour gameplay signals unavailable and confirming need for a hard auth gate.
- Decision: Implement in next 30-min cycle; promote to default if it prevents any non-evidence gameplay summary during next 3 auth-failure incidents.

- Date: 2026-03-14 17:28 KST
- Hypothesis: Replacing `recent` endpoint dependence with deterministic `/api/logs` auto-paging (stop at 60-minute boundary) will keep hourly outcome confidence high even while `recent` routes remain `404`.
- Change: In hourly cycle, page `GET /api/logs?page=n&limit=100` until oldest event is older than 1h, then compute `wins/defeats/surrenders/potion_spend/rest_count` from that bounded window.
- Metric(s): % hourly runs with high-confidence win/defeat summary; API error-rate reduction from invalid probes (`400`/`404`); median runtime per cycle.
- Result: Current live cycle produced complete one-hour evidence from 4 pages (`329` events, `wins=246`, `defeats=0`) while `recent` endpoints stayed `404`.
- Decision: Run next 2 hourly cycles; promote if confidence remains high and probe-error count drops by >=80% versus current mixed-probe pattern.

- Date: 2026-03-13 23:28 KST
- Hypothesis: During history endpoint outages (`404`), querying `/api/logs` with allowed action enums (`death`, `level_up`) will provide partial outcome evidence and improve hourly win/defeat confidence over the current `action=combat` (`400`) probe.
- Change: Extend hourly fetcher fallback to test `GET /api/logs?action=death&limit=50` and `GET /api/logs?action=level_up&limit=50`, then map to `outcome_confidence` (`low|medium|high`).
- Metric(s): % hourly cycles with non-empty outcome evidence while history endpoints are degraded; false-positive outcome inferences vs later recovered history streams.
- Result: Current cycle had `/api/status` `200` with useful deltas, history endpoints all `404`, and `GET /api/logs?action=combat&limit=50` returned `400 INVALID_INPUT`.
- Decision: Run in next 30-min dev cycle; promote if confidence improves (low->medium+) for 4 consecutive degraded-history cycles.

- Date: 2026-03-13 22:27 KST
- Hypothesis: Adding a secondary combat-log query variant when `GET /api/logs?action=combat&limit=50` returns `400` will recover partial win/defeat evidence and reduce low-confidence hourly summaries during history endpoint outages.
- Change: Extend hourly collector to try one fallback combat-log query contract after `400` and emit `win_defeat_confidence` (`low|medium|high`) based on source availability.
- Metric(s): % hourly cycles with non-empty combat outcome evidence while history endpoints are degraded; false-positive win/defeat classifications vs recovered history API data.
- Result: This cycle had `/api/status` `200` with useful deltas, but history endpoints were all `404` and direct combat-log probe returned `400`, leaving outcomes unresolved.
- Decision: Run in next 30-min dev cycle; promote if confidence improves (low->medium+) for 4 consecutive degraded-history cycles.

- Date: 2026-03-13 21:29 KST
- Hypothesis: Persisting an hourly status snapshot cache (with explicit previous-pointer metadata) will make fallback gameplay deltas deterministic and reduce manual OPS cross-referencing when history APIs remain `404`.
- Change: Add a tiny cache artifact (`logs/status-hourly-cache.json`) written by hourly cycle and consumed by summary generator for `Δexp/Δgold/Δhp`.
- Metric(s): % fallback cycles with non-empty deterministic deltas; mismatch rate vs manual OPS comparisons; time-to-write hourly feedback.
- Result: Current cycle still had history endpoints `404` while `/api/status` remained `200` and usable; live deltas required manual comparison against earlier OPS snapshot.
- Decision: Run in next 30-min dev cycle; promote if deterministic deltas are emitted for 6 consecutive degraded-history cycles.

- Date: 2026-03-13 18:28 KST
- Hypothesis: Normalizing `/api/status.character.hp/mp` object fields into scalar telemetry in the hourly fallback summary will improve actionability when history APIs are degraded.
- Change: Add parser/mapper in activity summarizer for nested `hp.current/max` and `mp.current/max` (with legacy scalar fallback) and include normalized status fields in output.
- Metric(s): Cycles with non-empty status resource telemetry while history endpoints are `404`; operator follow-up ambiguity rate.
- Result: Current cycle confirmed history endpoints `404` with `/api/status` healthy (`level=18`, `exp=397`, `gold=304`, nested HP/MP objects present).
- Decision: Proceed next 30-min cycle; promote if normalized fields appear consistently for 6 consecutive degraded-history cycles.

- Date: 2026-03-09 14:09 KST
- Hypothesis: Emitting `streak_count + severity + reset_reason` as a single structured block will reduce operator ambiguity versus free-text idle alerts.
- Change: Extend hourly feedback formatter to output a deterministic idle-streak metadata block derived from persisted streak state.
- Metric(s): Alert interpretation errors; mismatch between computed streak and reported severity; time-to-action after alert.
- Result: Eleventh consecutive ineffective cycle observed (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) while history endpoints remained `404`.
- Decision: Continue experiment for next 8 cycles and promote if structured metadata improves action consistency.

- Date: 2026-03-09 13:09 KST
- Hypothesis: Adding transition tests for idle-streak escalation/reset logic will prevent alert-state regressions and improve confidence in automated severity routing.
- Change: Add deterministic test cases for `idle->idle->idle(critical)` and `critical->progress(reset)` transitions in hourly feedback logic.
- Metric(s): Regression incidents in streak severity; test pass rate; mismatch between expected and emitted severity.
- Result: Tenth consecutive ineffective cycle observed (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) with history endpoints still `404`.
- Decision: Proceed with test-coverage experiment and evaluate over next 8 cycles.

- Date: 2026-03-09 12:08 KST
- Hypothesis: Explicit streak-reset criteria (`Δexp>0 || Δgold>0`) will reduce false persistent-critical alerts once recovery begins.
- Change: Extend idle-burn streak helper with deterministic reset conditions and log reset reason in hourly feedback metadata.
- Metric(s): False critical persistence rate; time-to-deescalation after first recovery signal; alert precision.
- Result: Ninth consecutive ineffective hour observed (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) while history endpoints remained `404`.
- Decision: Continue experiment and validate reset behavior over next 8 cycles.

- Date: 2026-03-09 11:09 KST
- Hypothesis: A tiny reusable `idle_streak` state helper (read/update/write) will improve maintainability and lower bugs versus ad-hoc inline streak persistence.
- Change: Prototype a dedicated helper for hourly feedback to persist and increment/reset `idle_with_consumable_burn` streak deterministically.
- Metric(s): Streak state correctness in sequential runs; implementation complexity (LOC/touch points); false escalation/reset rate.
- Result: Eighth consecutive ineffective hour observed (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) with history endpoints still `404`.
- Decision: Proceed with helper-based implementation and evaluate over next 8 cycles.

- Date: 2026-03-09 10:09 KST
- Hypothesis: Persisting idle-burn streak in a dedicated JSON state file will improve reproducibility and prevent alert-severity drift across hourly runs.
- Change: Add file-backed streak state (`hourly_idle_streak.json`) used by feedback renderer before severity selection.
- Metric(s): Streak continuity correctness; severity consistency across restarts; recovery latency after streak escalation.
- Result: Seventh consecutive no-progression + consumable-drain signal observed while history endpoints remained `404` and `/api/status` stayed healthy.
- Decision: Proceed with implementation experiment and measure for next 8 cycles.

- Date: 2026-03-09 09:08 KST
- Hypothesis: File-backed hourly streak persistence for `idle_with_consumable_burn` will reduce false resets and improve escalation timing compared with in-memory-only counting.
- Change: Persist streak state in a small JSON artifact and read/update it each hourly feedback run before composing severity.
- Metric(s): Streak continuity accuracy across runs; time-to-escalation after true consecutive ineffective hours; false reset rate.
- Result: Sixth consecutive ineffective hour observed (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) while history endpoints remained `404`.
- Decision: Proceed with persistence experiment for next 8 cycles and compare escalation precision against current behavior.

- Date: 2026-03-09 08:08 KST
- Hypothesis: Adding both `streak_count` and `escalation_level` fields to idle-burn feedback will improve downstream automation consistency over streak count alone.
- Change: Extend `idle_with_consumable_burn` output to include numeric streak and deterministic severity tier mapping (e.g., 1-2=warn, >=3=critical).
- Metric(s): Recovery latency after critical tier; action consistency across repeated cycles; false-critical rate.
- Result: Fifth consecutive no-progression + consumable-drain cycle observed with history endpoints still `404` and status stable.
- Decision: Continue experiment for 8 cycles; adopt if critical-tier output reduces ineffective streak duration.

- Date: 2026-03-09 07:09 KST
- Hypothesis: Emitting explicit `idle_with_consumable_burn_streak_count` in hourly feedback will improve automation response quality versus severity text alone.
- Change: Add numeric streak counter output for repeated condition (`Δexp=0 && Δgold=0 && Δuse_item_remaining<0`) and keep threshold-based escalation.
- Metric(s): Recovery latency after streak>=3; downstream action consistency; false escalation interventions.
- Result: Fourth consecutive hour confirmed same ineffective pattern with no progression and repeated consumable drain while history endpoints remained `404`.
- Decision: Continue experiment for next 8 cycles; promote if streak-counted alerts shorten time-to-first progression.

- Date: 2026-03-09 06:08 KST
- Hypothesis: Adding a severity bump after 3 consecutive `idle_with_consumable_burn` hits will shorten time-to-recovery versus repeated same-priority warnings.
- Change: Keep current detector (`Δexp=0 && Δgold=0 && Δuse_item_remaining<0`) and add streak-threshold escalation rule in hourly feedback output.
- Metric(s): Time-to-first progression after 3-hit threshold; ineffective-cycle streak length distribution; escalation false-positive rate.
- Result: Third consecutive evidence hour observed with identical no-progress + consumable-drain pattern while history endpoints remained `404`.
- Decision: Continue experiment and compare recovery latency pre/post threshold hit over next 8 hourly cycles.

- Date: 2026-03-09 05:09 KST
- Hypothesis: Repeated `idle_with_consumable_burn` detections across consecutive hours indicate automation inefficiency and should trigger immediate recovery-mode guidance.
- Change: Keep detector criteria (`Δexp=0 && Δgold=0 && Δuse_item_remaining<0`) and add consecutive-hit escalation threshold in feedback output.
- Metric(s): Consecutive ineffective-cycle streak length; time-to-first non-zero progression after escalation; false escalation rate.
- Result: Second consecutive evidence hour captured with same pattern (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) while history endpoints stayed `404`.
- Decision: Continue experiment for 8 hourly cycles, then promote to default severity if streak-trigger improves recovery latency.

- Date: 2026-03-09 04:09 KST
- Hypothesis: A deterministic `idle_with_consumable_burn` detector (`Δexp=0 && Δgold=0 && Δuse_item_remaining<0`) will identify ineffective post-reset cycles earlier than progression-only checks.
- Change: Add detector and recommendation line to hourly feedback output using cached status delta.
- Metric(s): Consecutive ineffective-cycle duration; time-to-first-nonzero progression after detector trigger; false-positive detector rate.
- Result: Baseline captured this cycle (`Δexp=0`, `Δgold=0`, `Δuse_item_remaining=-4`) with history endpoints still `404`.
- Decision: Run for next 8 hourly cycles before promoting to default severity escalation.

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
- Date: 2026-03-05 00:08 KST
- Hypothesis: Endpoint configurability (instead of hardcoded paths) will reduce maintenance churn and improve hourly activity coverage.
- Change: Repeated hourly probe confirms current hardcoded candidate endpoints remain invalid (3x 404).
- Metric(s): Valid activity endpoint hit rate per cycle.
- Result: 0% this cycle (0/3 valid).
- Decision: Keep open; implement configurable endpoint list in next dev cycle.
- Date: 2026-03-05 01:08 KST
- Hypothesis: Persisting endpoint health telemetry each cycle will make API drift detectable faster than manual log review.
- Change: Repeated probe run confirms unchanged 404 pattern across 3 activity endpoints.
- Metric(s): Time-to-detect endpoint drift; activity endpoint success ratio over 24h.
- Result: Baseline remains 0/3 success this cycle.
- Decision: Pending telemetry implementation in next cycle.
- Date: 2026-03-05 02:08 KST
- Hypothesis: Capturing probe telemetry as JSONL each hour will surface stable endpoint failure patterns quickly enough to automate fallback decisions.
- Change: Repeated endpoint probe this hour (status + 3 activity candidates).
- Metric(s): 24h endpoint success ratio; consecutive-failure streak length per endpoint.
- Result: Activity endpoint success ratio still 0/3 for this cycle.
- Decision: Continue experiment; add telemetry persistence next cycle.
- Date: 2026-03-05 03:08 KST
- Hypothesis: A rolling endpoint-failure streak metric will provide a reliable trigger for switching from API-history mode to local-log mode.
- Change: Hourly probe repeated across same 3 activity endpoints.
- Metric(s): Consecutive failure streak per endpoint.
- Result: Failure streak continues (all three endpoints failed again this cycle).
- Decision: Pending implementation of streak tracker + fallback threshold.
- Date: 2026-03-05 04:08 KST
- Hypothesis: Restricting `activity_probe_summary` to configured production endpoint allowlist will reduce false anomaly noise from test artifacts and improve hourly feedback precision.
- Change: This cycle observed valid live probe results but summary still contained a historical `data:` endpoint artifact from prior verification runs.
- Metric(s): Non-production endpoint incidence in hourly summaries; operator false-positive anomaly notes per day.
- Result: Baseline issue observed (non-production endpoint present in summary despite current probe targeting production endpoints).
- Decision: Run allowlist-filter implementation/verification in next 30-minute cycle.
- Date: 2026-03-05 05:12 KST
- Hypothesis: Applying a fixed failure-streak threshold for history endpoints will reduce repeated manual anomaly triage and stabilize hourly feedback source selection.
- Change: Observed rolling probe summary with consecutive history-endpoint failures at streak `2` while `/api/status` remains healthy.
- Metric(s): Manual anomaly notes per 24h; percentage of cycles auto-classified as `history_api_degraded` with deterministic fallback.
- Result: Baseline captured (history endpoints degraded, status endpoint healthy).
- Decision: Implement threshold-based degraded tagging in next cycle and evaluate for 24h.
- Date: 2026-03-05 06:08 KST
- Hypothesis: Explicitly emitting `history_api_degraded` at failure streak >=3 will reduce operator ambiguity and improve consistency of fallback-driven feedback.
- Change: Current cycle confirms streak threshold condition (all history endpoints at consecutive failure streak `3`, while `/api/status` remains healthy).
- Metric(s): Cycles with ambiguous anomaly wording; cycles auto-labeled degraded vs manual judgment.
- Result: Trigger condition observed and documented.
- Decision: Proceed with degraded-flag implementation + verifier in next cycle.
- Date: 2026-03-05 07:08 KST
- Hypothesis: Persisting endpoint health state transitions (`healthy -> degraded -> disabled`) from failure streaks will improve operational clarity and reduce repetitive fallback diagnostics.
- Change: Current cycle extends consecutive history-endpoint failure streak to `4` while `/api/status` remains consistently healthy.
- Metric(s): Number of manual degraded-status notes/day; percentage of cycles with deterministic source-routing decision emitted.
- Result: Baseline indicates stable degraded pattern suitable for state-machine routing.
- Decision: Implement health-state persistence and evaluate over next 24h.
- Date: 2026-03-05 08:08 KST
- Hypothesis: A recovery gate (require >=1 consecutive `ok` before clearing degraded state) will prevent flapping between degraded/healthy routing when history endpoints are unstable.
- Change: Current cycle observed continued history-endpoint failure streak `5` with `/api/status` still healthy.
- Metric(s): Degraded-state flaps/day; mismatch rate between routing state and actual endpoint reliability.
- Result: Baseline indicates prolonged degraded period suitable for gated recovery logic.
- Decision: Implement recovery gate and track for next 24h.
- Date: 2026-03-05 09:08 KST
- Hypothesis: Requiring two consecutive successful history probes before clearing degraded state will reduce premature recovery and routing flaps.
- Change: Current cycle confirms ongoing degraded pattern with history-endpoint failure streak `6` and stable `/api/status` health.
- Metric(s): Degraded/healthy state transitions per day; false recovery transitions followed by immediate failure.
- Result: Baseline supports stricter recovery gating.
- Decision: Implement recovery streak threshold in next cycle and observe for 24h.
- Date: 2026-03-05 10:08 KST
- Hypothesis: Synthetic transition tests for degraded/recovery streak logic will prevent regression and reduce ambiguous routing during prolonged API-history outages.
- Change: Current cycle shows continued failure streak `7` on all history endpoints with `/api/status` stable.
- Metric(s): Regression incidents in degraded/recovery routing; % of cycles with deterministic routing state.
- Result: Baseline outage pattern persists and is suitable for transition-test validation.
- Decision: Implement synthetic transition verifier in next cycle.
- Date: 2026-03-05 11:09 KST
- Hypothesis: A dedicated incident runbook for history-endpoint degradation/recovery will reduce operator response time and inconsistency during prolonged API-history outages.
- Change: Current cycle confirms persistent degraded state (history endpoints 404; rolling failure streak remains `7`) with `/api/status` stable.
- Metric(s): Time-to-triage for history endpoint incidents; variance in fallback/recovery handling across cycles.
- Result: Baseline outage pattern remains stable enough to codify runbook-driven handling.
- Decision: Draft and link incident runbook in next cycle.
- Date: 2026-03-05 12:12 KST
- Hypothesis: A dedicated routing-transition verifier for history endpoint degradation/recovery will reduce regressions during prolonged 404 conditions.
- Change: Current cycle still shows history endpoints failing (rolling streak `6`) while `/api/status` remains healthy.
- Metric(s): Routing-state regression count in CI; number of ambiguous fallback decisions per day.
- Result: Baseline outage pattern remains stable for synthetic-transition test coverage.
- Decision: Implement routing-transition verifier in next cycle.
- Date: 2026-03-05 13:08 KST
- Hypothesis: Verifying degraded-state persistence under continuous history-endpoint `http_fail` streaks will prevent accidental recovery regressions.
- Change: This cycle again observed stable outage pattern (history endpoints 404 with rolling failure streak `6`) while `/api/status` remained healthy.
- Metric(s): False degraded->healthy transitions in test runs; CI catches for routing-state regressions.
- Result: Baseline supports adding persistence-focused routing verification.
- Decision: Implement `verify:history-routing` coverage in next cycle.
- Date: 2026-03-05 14:08 KST
- Hypothesis: A lightweight probe dashboard generated from `activity_probe_summary` will shorten incident triage time and reduce repetitive manual log scanning.
- Change: This cycle again showed stable degraded history-endpoint pattern (all history endpoints `404`, streak `6`) with `/api/status` healthy.
- Metric(s): Time-to-identify failing endpoint set; manual log-read steps per cycle.
- Result: Baseline supports adding a compact generated dashboard for triage.
- Decision: Implement dashboard generator in next cycle and evaluate usability over several hourly runs.
- Date: 2026-03-05 15:09 KST
- Hypothesis: Auto-appending hourly probe summaries to a single dashboard file will improve outage visibility without increasing operator cognitive load.
- Change: This cycle still shows persistent history-endpoint failure (all `404`, rolling streak `6`) while `/api/status` remains healthy.
- Metric(s): Time-to-locate latest endpoint health state; number of files read per triage.
- Result: Baseline suggests a single rolling dashboard would reduce navigation overhead.
- Decision: Implement dashboard snapshot append flow in next cycle.
- Date: 2026-03-05 16:09 KST
- Hypothesis: Bootstrapping a dedicated probe dashboard file and append script will improve continuity of endpoint health tracking across hourly runs.
- Change: Current cycle maintains stable degraded history-endpoint pattern (all `404`, rolling streak `6`) with `/api/status` healthy.
- Metric(s): Continuity of endpoint-health timeline; operator time spent correlating streaks across cycles.
- Result: Baseline remains suitable for dashboard timeline experiment.
- Decision: Implement dashboard bootstrap + append flow in next cycle.
- Date: 2026-03-05 17:09 KST
- Hypothesis: Automating hourly dashboard snapshot appends from `activity_probe_summary` will improve trend visibility for endpoint-health incidents.
- Change: Current cycle shows sustained history-endpoint outage (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Time to identify failure-streak changes; operator effort to reconstruct outage timeline.
- Result: Baseline indicates dashboard automation is still justified.
- Decision: Implement snapshot-append script in next cycle.
- Date: 2026-03-05 18:09 KST
- Hypothesis: A dedicated `ops:history-probe-dashboard` command will improve repeatability of endpoint-health reporting and reduce manual formatting drift.
- Change: Current cycle still indicates persistent history-endpoint outage (all `404`, rolling streak `7`) with `/api/status` healthy.
- Metric(s): Manual edits required per hourly report; consistency of endpoint-health presentation across cycles.
- Result: Baseline continues to justify command-driven dashboard generation.
- Decision: Implement `ops:history-probe-dashboard` in next cycle.
- Date: 2026-03-05 19:14 KST
- Hypothesis: Shipping a script-backed `ops:history-probe-dashboard` command will improve endpoint-health reporting consistency across hourly cycles.
- Change: This cycle again shows persistent history-endpoint outage (all `404`, rolling streak `6`) with `/api/status` healthy.
- Metric(s): Formatting variance across hourly reports; time to parse current endpoint-health status.
- Result: Baseline remains favorable for command-driven dashboard generation.
- Decision: Implement script + npm alias in next cycle.
- Date: 2026-03-05 20:09 KST
- Hypothesis: A timestamped dashboard writer for `activity_probe_summary` will improve cross-cycle continuity and reduce manual triage steps.
- Change: This cycle again shows persistent history-endpoint outage (all `404`, rolling streak `6`) while `/api/status` remains healthy.
- Metric(s): Time to reconstruct endpoint-health timeline; number of manual edits per cycle.
- Result: Baseline continues to support scripted dashboard output.
- Decision: Implement dashboard writer in next cycle.
- Date: 2026-03-05 21:08 KST
- Hypothesis: Automating endpoint-health row appends via `ops:history-probe-dashboard` will reduce manual drift and improve incident timeline quality.
- Change: This cycle again shows persistent history-endpoint outage (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Manual edit count per cycle; completeness of endpoint-health timeline over 24h.
- Result: Baseline continues to justify scripted dashboard row generation.
- Decision: Implement dashboard append command in next cycle.
- Date: 2026-03-05 22:08 KST
- Hypothesis: A scripted `ops:history-probe-dashboard` row append will improve endpoint-health timeline quality and lower manual reporting effort.
- Change: This cycle again shows persistent history-endpoint outage (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Manual report-edit steps per cycle; completeness of endpoint-health timeline across hourly runs.
- Result: Baseline continues to support dashboard row automation.
- Decision: Implement dashboard append script + npm alias in next cycle.
- Date: 2026-03-05 23:08 KST
- Hypothesis: A script-based `ops:history-probe-dashboard` append flow will reduce manual reporting drift and preserve consistent endpoint-health timelines.
- Change: This cycle again shows persistent history-endpoint outage (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Manual edit count per cycle; consistency of endpoint-health timeline entries across hourly runs.
- Result: Baseline continues to support scripted dashboard appends.
- Decision: Implement dashboard append script + npm alias in next cycle.
- Date: 2026-03-06 00:08 KST
- Hypothesis: A scripted `ops:history-probe-dashboard` append workflow will keep endpoint-health timelines consistent across day boundaries.
- Change: This cycle continues the same degraded history-endpoint pattern (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Cross-day continuity of endpoint-health records; manual edits required per cycle.
- Result: Baseline supports automated dashboard append approach.
- Decision: Implement script + npm alias in next cycle.
- Date: 2026-03-06 01:08 KST
- Hypothesis: Persisting hourly probe snapshots into a dedicated dashboard file will improve long-run visibility of endpoint-health degradation trends.
- Change: This cycle continues the same degraded history-endpoint pattern (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Time to inspect endpoint-health history; number of files needed for outage trend analysis.
- Result: Baseline continues to support dashboard snapshot persistence.
- Decision: Implement dashboard file + append script in next cycle.
- Date: 2026-03-06 02:08 KST
- Hypothesis: Persisting hourly `activity_probe_summary` rows into a single dashboard will improve long-window visibility of endpoint degradation and recovery patterns.
- Change: This cycle maintains the same degraded history-endpoint pattern (all `404`, rolling streak `7`) while `/api/status` remains healthy.
- Metric(s): Time to review endpoint-health trend over 24h; number of files scanned during outage triage.
- Result: Baseline continues to support dashboard persistence automation.
- Decision: Implement dashboard-row append script + npm alias in next cycle.
- Date: 2026-03-06 03:08 KST
- Hypothesis: Appending hourly `activity_probe_summary` snapshots into one dashboard doc will improve outage trend readability and reduce per-cycle triage time.
- Change: This cycle still shows degraded history endpoints (all `404`, rolling streak `6`) while `/api/status` remains healthy.
- Metric(s): Time to identify current and prior-hour endpoint streaks; number of files opened during endpoint triage.
- Result: Baseline continues to support dashboard snapshot automation.
- Decision: Implement dashboard append script + npm alias in next cycle.

- Date: 2026-03-06 04:10 KST
- Hypothesis: Combining live `/api/status` snapshot deltas with fallback replay output will recover actionable progression/resource signals even while history endpoints return 404.
- Change: Add a lightweight status-snapshot cache (hourly before/after) and compute delta fields (level/exp/gold/hp/mp/hunt remaining) for feedback generation.
- Metric(s): Non-zero hourly signal rate in feedback logs; number of cycles classified as 'no signal'; mismatch rate between replay and status-derived deltas.
- Result: Baseline cycle showed replay zero-signal with healthy status endpoint and meaningful state values, supporting mixed-signal approach test.
- Decision: Run 24h trial with mixed-signal feedback path before promoting to default behavior.

- Date: 2026-03-06 05:09 KST
- Hypothesis: Hourly status-snapshot deltas can provide reliable progression/resource trend signals when replay + history endpoints provide zero/404 signal.
- Change: Introduce compact status snapshot persistence and delta computation in feedback pipeline.
- Metric(s): Share of cycles with non-zero trend signal; false-positive delta rate caused by snapshot timing jitter.
- Result: Current cycle had replay zero-signal with valid live status progression state (Lv21/exp/gold/hp/mp), supporting snapshot-delta path.
- Decision: Implement snapshot capture in next dev slot and evaluate for 24 hourly cycles.

- Date: 2026-03-06 06:09 KST
- Hypothesis: A persisted hourly status snapshot (before/after) will reveal actionable progression/resource trends even when replay/history reports all-zero KPIs.
- Change: Add snapshot persistence + delta calculation for level/exp/gold/hp/mp/hunt remaining in hourly report path.
- Metric(s): % cycles with non-zero trend signal; consistency of derived deltas across consecutive hours.
- Result: This cycle again had replay all-zero with meaningful live status movement and resource pressure, supporting snapshot-delta implementation.
- Decision: Build snapshot helper in next 30-min cycle and observe for 24 hourly runs.

- Date: 2026-03-06 07:09 KST
- Hypothesis: Auto-generated status deltas (vs prior-hour snapshot) will improve hourly feedback usefulness despite repeated history-endpoint 404s.
- Change: Prototype `hourly-feedback-from-status-delta` script that reads last snapshot and emits level/exp/gold/hp/mp/hunt deltas.
- Metric(s): % cycles with actionable trend lines; operator-rated usefulness (binary) in OPS entries.
- Result: Current cycle had replay zero-signal but live status showed clear progression state (Lv22, exp/gold moved), supporting delta automation.
- Decision: Implement prototype and evaluate over next 12 hourly cycles.

- Date: 2026-03-06 08:09 KST
- Hypothesis: Automating status-delta extraction into OPS entries will reduce zero-signal cycles and improve operator actionability during persistent history-endpoint outages.
- Change: Add npm alias for delta feedback generator and test one-shot append behavior against current cycle snapshot.
- Metric(s): Ratio of cycles with non-zero trend line; time-to-triage from latest OPS entry.
- Result: Replay/history remained zero/404 while live status reflected continued progression/resource movement, supporting delta automation.
- Decision: Implement alias + one-cycle dry run in next 30-min slot, then monitor for 12 cycles.

- Date: 2026-03-06 09:09 KST
- Hypothesis: Persisted status snapshots with auto-delta computation will convert repeated zero-signal fallback hours into actionable progression/resource trend summaries.
- Change: Implement `status-snapshot-delta` helper that stores latest status and compares against previous snapshot in hourly cycle.
- Metric(s): % hourly runs with non-zero trend fields; triage time from latest OPS entry.
- Result: Replay/history remained zero/404 while live status indicated progression state and resource pressure, supporting snapshot-delta automation.
- Decision: Implement helper + dry-run append in next 30-min dev cycle.

- Date: 2026-03-06 10:09 KST
- Hypothesis: Enforcing stricter low-gold buy suppression when gold is near reserve floor will reduce economic stalls without lowering hunt throughput.
- Change: Add explicit optional-buy suppression branch on `gold <= minGoldReserve` and log branch-hit count per cycle.
- Metric(s): Gold reserve violation count; cycles with forced rest due to low resources; hunt success continuity.
- Result: Current cycle shows low gold (`68`) under active combat with history KPIs unavailable, making economic guardrail evidence-worthy.
- Decision: Implement and run one-cycle smoke check in next 30-min block.

- Date: 2026-03-06 11:09 KST
- Hypothesis: Logging `minGoldReserve` guardrail hit counts per cycle will expose economic pressure patterns and reduce regressions where optional buys starve combat recovery.
- Change: Emit structured counters for buy suppression/skip reasons when gold is at or below reserve threshold.
- Metric(s): buy-suppression hit count; low-gold streak length; hunt success continuity under low-gold windows.
- Result: Current cycle shows persistent low-gold state (`68`) with replay/history zero-signal and supports guardrail telemetry experiment.
- Decision: Implement telemetry and capture one-cycle evidence in next 30-min dev slot.

- Date: 2026-03-06 12:09 KST
- Hypothesis: Tracking skip-buy telemetry under `minGoldReserve` will reduce unnoticed economy regressions after level-up transitions.
- Change: Add structured counter fields for `buy_suppressed_low_gold` and `buy_suppressed_optional` in runner cycle logs.
- Metric(s): low-gold suppression count per hour; gold floor breach duration; hunt continuity.
- Result: Current cycle shows level-up state with tight gold reserve and continued history endpoint outage, supporting guardrail telemetry experiment.
- Decision: Implement telemetry and verify one-cycle log output in next 30-min block.

- Date: 2026-03-06 13:09 KST
- Hypothesis: Auto-computed status deltas from previous snapshot will make hourly feedback actionable despite persistent history-endpoint 404s.
- Change: Implement minimal previous-status cache + delta line emission in hourly feedback routine.
- Metric(s): Non-zero hourly delta coverage; cycles labeled no-signal; time to identify trend direction.
- Result: Current cycle still shows replay/history zero-signal with meaningful live status values, supporting snapshot-delta rollout.
- Decision: Implement delta cache helper and validate over next 6 hourly cycles.

- Date: 2026-03-06 14:09 KST
- Hypothesis: Explicit low-HP emergency-branch telemetry will improve detection of survival-risk cycles and prevent hidden stalls under depleted hunt quota.
- Change: Emit `emergency_low_hp_hits` and `recovery_action_selected` fields when HP ratio drops below 0.30.
- Metric(s): emergency-hit count/hour; recovery success on next cycle; stall incidence after emergency hits.
- Result: Current cycle shows HP at 98/445 with hunt quota 0 and replay/history zero-signal, supporting emergency telemetry experiment.
- Decision: Implement telemetry and capture one-cycle evidence in next 30-min run.

- Date: 2026-03-06 15:13 KST
- Hypothesis: Previous-snapshot delta emission in OPS feedback will reduce repeated no-signal reports and improve trend readability during history-endpoint outages.
- Change: Add lightweight previous-status cache and derive `Δlevel/Δexp/Δgold` each hourly cycle.
- Metric(s): % cycles with non-zero trend fields; time-to-understand trend from latest OPS entry.
- Result: Replay/history remains zero/404 while live status shows meaningful progression state, supporting status-delta experiment.
- Decision: Implement cache + one-cycle validation in next 30-min block.

- Date: 2026-03-06 16:14 KST
- Hypothesis: A deterministic OPS alert condition (`hp_ratio < 0.45 && hunt_remaining == 0`) will reduce missed recovery-risk cycles and improve operator response consistency.
- Change: Add alert-condition evaluation and explicit recommendation text emission in hourly feedback generator.
- Metric(s): Count of risk cycles with alert line present; time-to-recovery after risk detection; false-positive alert rate.
- Result: Current cycle satisfies high-risk pattern (low HP + exhausted hunt quota + history 404), supporting alert-rule experiment.
- Decision: Implement rule and observe for next 8 hourly cycles.

- Date: 2026-03-06 17:09 KST
- Hypothesis: Emitting `exp_to_next` hourly deltas will improve progression visibility during history-endpoint outages and make leveling pace actionable.
- Change: Extend status-delta output to include `Δexp_to_next` and `level_up_detected` boolean in OPS feedback.
- Metric(s): % cycles with interpretable progression trend; level-up detection precision vs raw status snapshot.
- Result: Current cycle shows near-level-up state with fallback zero-signal from history sources, supporting exp-to-next delta instrumentation.
- Decision: Implement delta field extension in next 30-min dev cycle.

- Date: 2026-03-06 18:11 KST
- Hypothesis: Explicit `Δgold` + `Δlevel` status-delta logging will make major progression spikes visible even when replay/history sources return no recent activity details.
- Change: Extend hourly feedback generator to compare against cached previous status and output delta fields in OPS entries.
- Metric(s): % cycles with non-zero delta fields; number of major progression events missed in fallback-only mode.
- Result: Current cycle shows a strong gold increase and level advance while history endpoints remain 404, supporting delta instrumentation.
- Decision: Implement delta extension in next 30-min cycle and validate over 6 hourly runs.

- Date: 2026-03-06 19:14 KST
- Hypothesis: Adding cached status deltas (`Δgold`, `Δexp`, `Δexp_to_next`, level-up flag) will make hourly progression/economy trends actionable despite persistent history endpoint failures.
- Change: Extend hourly feedback pipeline with previous-status cache compare and deterministic delta-line emission.
- Metric(s): Non-zero delta coverage rate; trend interpretation time from latest OPS entry; missed level-up events.
- Result: Current cycle shows large gold accumulation and near-level-up state while replay/history remains zero/404, supporting delta instrumentation.
- Decision: Implement delta instrumentation in next 30-min cycle and monitor for 8 hourly runs.

- Date: 2026-03-06 20:09 KST
- Hypothesis: Deterministic cached status-delta output (`Δlevel/Δexp/Δgold/Δexp_to_next`) will materially improve hourly feedback actionability during persistent history API outages.
- Change: Add previous-status cache compare step and delta-line render in OPS feedback path.
- Metric(s): Non-zero delta coverage; trend-readability score (binary actionable/not-actionable); missed level-up detection count.
- Result: Current cycle shows level-up and large gold reserve while history endpoints remain 404 and replay KPIs remain zero, supporting delta instrumentation.
- Decision: Implement delta step next cycle and evaluate over 8 hourly runs.

- Date: 2026-03-06 21:09 KST
- Hypothesis: Explicit cached status-delta output in OPS entries will increase trend clarity and reduce repeated no-signal ambiguity under persistent history endpoint 404s.
- Change: Implement previous-status cache compare and delta-line renderer for `Δlevel/Δexp/Δgold/Δexp_to_next`.
- Metric(s): Non-zero delta coverage rate; operator trend-clarity (binary); missed progression-event count.
- Result: Current cycle again shows meaningful live progression/economy state while replay/history remain zero/404, supporting delta implementation.
- Decision: Build and smoke-test delta renderer in next 30-min cycle.

- Date: 2026-03-06 22:09 KST
- Hypothesis: Automatic status-cache delta output in OPS logs will materially improve trend readability while history endpoints continue returning 404.
- Change: Add previous-status cache read/write and deterministic delta line (`Δlevel/Δexp/Δgold/Δexp_to_next`) in hourly feedback path.
- Metric(s): Non-zero delta-line coverage; trend interpretation time; missed progression jump count.
- Result: Current cycle shows high gold + near-level-up state while replay/history remains zero/404, supporting delta-cache instrumentation.
- Decision: Implement delta-cache path in next 30-min cycle and monitor over next 8 runs.

- Date: 2026-03-06 23:14 KST
- Hypothesis: Built-in status-cache delta emission will make progression/economy trend direction explicit and reduce ambiguity from fallback-only zero KPI summaries.
- Change: Add previous-status cache compare step to hourly feedback path and append deterministic delta line.
- Metric(s): Delta-line coverage rate; trend interpretation speed; missed progression jumps under history 404 conditions.
- Result: Current cycle shows level-up and strong economy growth while replay/history remain zero/404, reinforcing need for delta instrumentation.
- Decision: Implement in next 30-min slot and observe for next 8 hourly cycles.

- Date: 2026-03-07 00:09 KST
- Hypothesis: Cached status-delta rendering in OPS entries will improve trend clarity and decision speed when activity-history endpoints are unavailable.
- Change: Add previous `/api/status` snapshot cache and deterministic delta line in hourly feedback routine.
- Metric(s): Delta-line presence rate; operator trend-readability; missed progression-event count under history 404 mode.
- Result: This cycle again shows strong live progression/economy while replay/history remains zero/404, supporting delta-cache implementation.
- Decision: Implement next cycle and monitor for 8 hourly runs.

- Date: 2026-03-07 01:09 KST
- Hypothesis: Including status deltas plus mutation-shield remaining-turn trend in OPS feedback will improve tactical timing decisions during history API outages.
- Change: Extend cached status compare output with `mutation_shield_remaining_turns` delta and standard progression/economy deltas.
- Metric(s): Delta-line coverage; shield-window utilization quality; missed near-level-up opportunity count.
- Result: Current cycle shows near-level-up progression with active mutation shield while history endpoints remain unavailable (404), supporting richer delta instrumentation.
- Decision: Implement and validate in next 30-min cycle.

- Date: 2026-03-07 02:09 KST
- Hypothesis: Adding a mutation-shield expiry alert (`remaining_turns <= 2`) to hourly feedback will reduce missed protection windows and smooth combat risk during endpoint outages.
- Change: Extend status-derived feedback with shield-expiry condition + recommendation text, alongside cached progression/economy deltas.
- Metric(s): Shield-expiry alerts captured; delayed-refresh incidents; post-expiry HP volatility.
- Result: Current cycle shows shield at 1 turn remaining with history endpoints still 404, providing direct evidence for alert instrumentation.
- Decision: Implement alert rule in next 30-min dev cycle and validate over 6 hourly runs.

- Date: 2026-03-07 03:09 KST
- Hypothesis: A deterministic low-HP alert line in hourly feedback (`hp_ratio < 0.30`) will reduce missed recovery windows and improve survivability decisions during history-endpoint outages.
- Change: Add low-HP condition evaluation and explicit recovery-first recommendation text in OPS generator.
- Metric(s): low-HP alert hit count; next-cycle HP recovery rate; combat-failure incidents after alerts.
- Result: Current cycle shows HP at 139/520 with history endpoints still unavailable, supporting low-HP alert instrumentation.
- Decision: Implement alert rule in next 30-min cycle and observe for 6 hourly runs.

- Date: 2026-03-07 04:09 KST
- Hypothesis: A deterministic `gold_drawdown_alert` (trigger: hourly `Δgold < -3000` while `Δexp > 0`) will improve interpretation of whether spend is productive progression investment or a destabilizing economy leak during history-endpoint outages.
- Change: Add status-cache delta rule to hourly feedback with contextual fields (`Δexp`, HP delta, mutation-shield delta, potion/rest quota deltas).
- Metric(s): Alert precision vs manual review, false-positive rate during level-up windows, time-to-action after large negative gold swings.
- Result: Current cycle shows `Δexp=+2800` with `Δgold=-5000` and shield-turn burn (`47→20`) while history endpoints remain 404, supporting the need for contextual drawdown alerting.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 05:09 KST
- Hypothesis: Adding `level_transition_normalized_delta` (only when `level_up_detected=true`) will reduce false negative progression interpretation caused by EXP rollover after level-up.
- Change: Extend hourly status-delta renderer to compute normalized EXP gain across level boundaries and show both raw and normalized values.
- Metric(s): Misclassification rate of post-level-up cycles (regression vs progression), operator interpretation latency, alert correction edits per day.
- Result: Current cycle shows `Lv29→Lv30` with raw EXP drop (`8083→2457`) and continued combat state, demonstrating rollover ambiguity in existing logs.
- Decision: Implement in next 30-min cycle and validate over next 6 hourly runs.

- Date: 2026-03-07 06:09 KST
- Hypothesis: A `gold_spend_classification` rule that labels large negative `Δgold` as `productive_spend` when accompanied by positive `Δexp` and stable/recovering HP will reduce false risk alerts during normal progression loops.
- Change: Add classification step to hourly feedback with evidence fields (`Δgold`, `Δexp`, HP delta, use-item/rest quota deltas, shield-turn delta).
- Metric(s): False-positive risk alert rate, agreement with manual review labels, follow-up intervention count per 24h.
- Result: Second consecutive cycle shows strong EXP gain (`+2928`) with large gold drawdown (`-4460`) and HP recovery, supporting contextual classification over threshold-only alerting.
- Decision: Implement in next 30-min cycle and evaluate for 8 hourly runs.

- Date: 2026-03-07 07:09 KST
- Hypothesis: A composite `risk_state_tag` (using `Δgold`, `Δexp`, HP delta, shield-turn delta, hunt quota remaining) will reduce ambiguous operator interpretation versus single-threshold alerts.
- Change: Add deterministic triage labels in hourly feedback: `productive` (high exp gain with stable risk), `watch` (mixed signal), `degrading` (high spend + declining survivability/throughput).
- Metric(s): Alert precision/recall for manually judged risk windows, intervention timing improvement, repeated-alert noise rate.
- Result: Current cycle shows strong EXP gain (`+2880`) with large gold drawdown (`-4550`), HP decline, shield burn, and hunt quota exhaustion, supporting composite state tagging.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 08:09 KST
- Hypothesis: A dedicated `low_gold_reserve_alert` (trigger: `current_gold < BUJU_MIN_GOLD_RESERVE`) will catch economy-collapse risk earlier than delta-only alerts during rapid level-up spend windows.
- Change: Add reserve-aware economy rule with escalation when consecutive `Δgold < 0` cycles occur.
- Metric(s): Early-detection rate for low-gold stalls, false-positive alerts during healthy reinvestment, recovery time back above reserve.
- Result: Current cycle reached Lv31 with strong progression but dropped to `gold=458` after another large negative gold delta, supporting reserve-threshold alerting.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 09:09 KST
- Hypothesis: Emitting a deterministic `low_reserve_behavior_hint` (defer optional spend actions when `gold < BUJU_MIN_GOLD_RESERVE`) will shorten low-gold recovery periods without materially reducing EXP momentum.
- Change: Extend hourly feedback to include spend-throttling guidance when reserve floor is breached.
- Metric(s): Time spent below reserve threshold, EXP gain while under reserve policy, frequency of repeated low-gold alerts.
- Result: Current cycle stayed below reserve (`gold=388`) despite continued EXP growth, indicating warning-only feedback is insufficient.
- Decision: Implement hint rule in next 30-min cycle and evaluate over 8 hourly runs.

- Date: 2026-03-07 10:09 KST
- Hypothesis: Triggering `economy_priority_mode` after >=3 consecutive low-reserve hourly snapshots will improve gold recovery speed without materially reducing EXP gains.
- Change: Add persistence-aware reserve policy in hourly feedback that recommends suppressing optional spend actions until reserve recovery.
- Metric(s): Consecutive low-reserve duration, time-to-recover above reserve, EXP gain retained during economy-priority mode.
- Result: Third consecutive cycle remains below reserve (`gold=358`) with continued EXP gains, supporting a persistence-based economy mode instead of one-shot warnings.
- Decision: Implement in next 30-min cycle and evaluate over 8 hourly runs.

- Date: 2026-03-07 11:09 KST
- Hypothesis: A combined `shield_economy_caution` flag (mutation shield absent + `gold < BUJU_MIN_GOLD_RESERVE`) will better predict fragile windows than either condition alone.
- Change: Extend hourly feedback classifier with combined-condition caution state and targeted safe-hunt recommendations.
- Metric(s): Incidents during no-shield low-reserve windows, false-positive caution rate, recovery speed back to shielded or reserve-safe state.
- Result: Current cycle shows mutation shield expiry with continued low-gold regime despite level-up progression, supporting combined-condition cautioning.
- Decision: Implement in next 30-min cycle and validate across next 8 hourly runs.

- Date: 2026-03-07 12:09 KST
- Hypothesis: Adding `reserve_recovery_progress` (consecutive hours below reserve + rolling net `Δgold`) will improve operator ability to distinguish improving vs stagnant low-gold states.
- Change: Extend hourly feedback output with reserve-duration and short rolling economy trend indicators.
- Metric(s): Time-to-detect stalled low-reserve regimes, intervention timing quality, reduction in ambiguous low-gold interpretations.
- Result: Current cycle remains below reserve with only marginal gold change (`-50`) despite steady EXP gain, supporting explicit reserve-recovery progress tracking.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 13:09 KST
- Hypothesis: Tracking `exp_per_use_item_quota` during low-reserve periods will identify whether consumable-heavy loops are efficient enough to justify delayed gold recovery.
- Change: Add consumable-efficiency indicator to hourly feedback alongside reserve and delta metrics.
- Metric(s): EXP gain per use-item quota point, reserve recovery speed, low-reserve duration under high consumable usage.
- Result: Current cycle shows strong EXP gain (`+2880`) with use-item quota drop (`30→22`) while gold remains below reserve, supporting efficiency instrumentation.
- Decision: Implement in next 30-min cycle and evaluate over 8 hourly runs.

- Date: 2026-03-07 14:09 KST
- Hypothesis: A composite `transition_risk_alert` (`shield_turns <= 10` + `hunt_remaining = 0` + `gold < reserve`) will better predict short-term instability than independent alerts.
- Change: Add deterministic transition-risk classifier to hourly feedback with conservative action recommendation.
- Metric(s): Preemptive mitigation rate before unstable cycles, false-positive transition alerts, post-alert stability in HP/gold trends.
- Result: Current cycle shows near-level-up progression with low reserve, hunt quota exhaustion, and shield near expiry (`8` turns), supporting transition-risk instrumentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 15:09 KST
- Hypothesis: A `post_levelup_reserve_check` alert (`level_up_detected` + `gold < BUJU_MIN_GOLD_RESERVE`) will surface hidden economy weakness that is currently masked by positive progression events.
- Change: Extend hourly feedback with post-level-up reserve health classification and stabilization recommendation.
- Metric(s): Count of low-reserve level-up cycles detected, recovery time after flagged cycles, false-positive rate where reserve naturally recovers next cycle.
- Result: Current cycle leveled to Lv33 but remained low reserve (`gold=458`), supporting post-level-up reserve checks.
- Decision: Implement in next 30-min cycle and evaluate over 8 hourly runs.

- Date: 2026-03-07 16:09 KST
- Hypothesis: A `survivability_reserve_pressure` condition (`hp_ratio < 0.45` + `gold < BUJU_MIN_GOLD_RESERVE`) will identify fragile states earlier than economy-only alerts.
- Change: Extend hourly classifier with combined HP/economy pressure rule and explicit recovery-first guidance.
- Metric(s): Early detection rate of fragile cycles, false-positive pressure alerts, next-cycle HP recovery after alert.
- Result: Current cycle shows HP drop to `235/580` with continued low reserve (`gold=388`) despite positive EXP gain, supporting combined pressure detection.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 17:09 KST
- Hypothesis: A `reserve_rebound_but_fragile` classifier (`Δgold > 0` AND `gold < BUJU_MIN_GOLD_RESERVE` AND (`shield_absent` OR `hunt_remaining=0`)) will reduce premature “stabilized” interpretation during fragile recovery windows.
- Change: Add conditional rebound tag and targeted caution text in hourly feedback output.
- Metric(s): False-stability interpretations, subsequent-cycle regressions after rebound signals, intervention timing quality.
- Result: Current cycle shows positive `Δgold` and strong EXP gain but still low reserve with shield absent and hunt quota exhausted, supporting rebound-fragility tagging.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 18:09 KST
- Hypothesis: A `quota_locked_progression` flag (progression gain while `hunt_remaining=0`) will improve visibility into constrained-growth states that can mask recovery debt.
- Change: Add hourly classifier for progression-under-quota-lock and attach conservative recovery recommendation.
- Metric(s): Detection rate of quota-locked growth cycles, next-cycle reserve recovery, false-positive rate when quota resets naturally resolve risk.
- Result: Current cycle leveled up (`33→34`) while hunt quota stayed exhausted and reserve remained below threshold, supporting quota-locked progression tagging.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 19:09 KST
- Hypothesis: A `critical_shield_window_alert` (`shield_turns <= 5` + `hunt_remaining=0` + `gold < BUJU_MIN_GOLD_RESERVE`) will better predict imminent instability than generic transition-risk tagging.
- Change: Add strict low-turn shield condition to hourly feedback classifier with defense-first recommendation.
- Metric(s): Preemptive mitigation before shield expiry, next-cycle HP volatility after alert, false-positive alert rate.
- Result: Current cycle shows shield down to `4` turns with quota lock and low reserve while progression continues, supporting critical-window alert instrumentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 20:09 KST
- Hypothesis: A composite `sustainability_score` (gold reserve status + hunt quota lock + consumable burn rate) will better rank intervention urgency than independent alerts.
- Change: Add deterministic weighted scoring in hourly feedback and map to guidance bands (`stable`, `watch`, `fragile`).
- Metric(s): Alert prioritization accuracy, intervention-to-recovery time, false-urgent alerts.
- Result: Current cycle shows strong EXP gain with shield refresh but persistent low reserve, quota lock, and increased consumable usage, supporting composite scoring.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 21:09 KST
- Hypothesis: A `partial_recovery_gate` classifier (positive short-term deltas but unmet hard safety constraints) will reduce false “stabilized” judgments during fragile rebounds.
- Change: Add gating logic in hourly feedback that distinguishes rebound-from-baseline vs fully recovered state.
- Metric(s): False-stability rate after rebound cycles, time-to-true-stability, operator intervention quality.
- Result: Current cycle shows positive gold/HP rebound with continued low reserve and no shield, supporting partial-recovery gating.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 22:09 KST
- Hypothesis: Splitting readiness into `throughput_ready` (action quota availability) and `stability_ready` (reserve/HP/shield health) will reduce aggressive-policy misfires after quota resets.
- Change: Add dual-readiness classification in hourly feedback and gate recommendations on both states instead of quota alone.
- Metric(s): Post-reset over-aggression incidents, HP drawdown after high-quota cycles, recovery speed to reserve-safe state.
- Result: Current cycle shows hunt quota recovery (`1→14`) with continued low reserve and HP decline, supporting dual-readiness instrumentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-07 23:09 KST
- Hypothesis: A `readiness_mismatch_alert` (`throughput_ready=true` while `stability_ready=false`) will reduce risky over-aggression after quota recoveries and level-up events.
- Change: Add mismatch classifier to hourly feedback and gate aggressive recommendations until stability constraints are satisfied.
- Metric(s): Over-aggressive action incidents after mismatch cycles, HP/gold drawdown in next cycle, time-to-full-readiness.
- Result: Current cycle shows high hunt quota and positive progression/gold trend but remains stability-incomplete due to shield absence, supporting mismatch alerting.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 00:09 KST
- Hypothesis: A `short_horizon_readiness` classifier (high throughput/HP readiness with `shield_turns <= 2`) will prevent overcommitment during imminent protection expiry windows.
- Change: Add horizon-aware readiness rule in hourly feedback to prioritize immediate shield-safe stabilization before aggressive action plans.
- Metric(s): Incidents immediately after low-turn shield windows, delayed-refresh rate, next-cycle HP volatility after flagged cycles.
- Result: Current cycle shows improved HP and hunt headroom with mutation shield at only `2` turns and reserve still below threshold, supporting short-horizon readiness tagging.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 01:09 KST
- Hypothesis: Emitting explicit `stability_readiness_reason_codes` will reduce ambiguity in operator actions versus binary readiness flags.
- Change: Extend hourly feedback with deterministic reason codes (`low_reserve`, `low_hp_ratio`, `shield_missing_or_low`) attached to stability readiness state.
- Metric(s): Time-to-intervention, incorrect intervention rate, consistency of operator response to similar cycles.
- Result: Current cycle shows high throughput readiness but stability gaps (notably HP drop and low reserve), supporting reason-code instrumentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 02:09 KST
- Hypothesis: A 3-cycle `recovery_velocity` metric (rolling `Δgold` + `Δhp`) will distinguish genuine stabilization from noisy one-cycle rebounds in low-reserve states.
- Change: Extend hourly feedback with short rolling recovery velocity and direction labels (`accelerating`, `flat`, `reversing`).
- Metric(s): Accuracy of next-cycle recovery direction prediction, false optimism rate after single positive cycles, time-to-reserve-recovery.
- Result: Current cycle shows continued positive `Δgold`/`Δhp` but persistent reserve breach and shield absence, supporting trend-velocity instrumentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 03:09 KST
- Hypothesis: Tracking `constraint_persistence_counter` per readiness blocker will improve prioritization by focusing on chronic constraints instead of most recent deltas.
- Change: Extend hourly feedback with per-constraint consecutive-cycle counters (`low_reserve`, `shield_absent`, `low_hp_ratio`).
- Metric(s): Time-to-clear persistent constraints, prioritization accuracy, reduction in repeated non-actionable alerts.
- Result: Current cycle shows continued reserve/shield constraints despite improving HP and quota, supporting persistence-aware prioritization.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 04:11 KST
- Hypothesis: Emitting a `status_only_winloss_confidence` field will reduce false certainty in hourly feedback when progression comes from `/api/status` but battle-history endpoints remain unavailable.
- Change: Extend hourly feedback output with confidence labels (`high` when history endpoints healthy, `low` when history endpoints fail) and attach to wins/defeats/progression interpretation.
- Metric(s): Misclassification rate of win/defeat trend under history outages, operator correction frequency, time-to-safe intervention decisions.
- Result: Current cycle again had status healthy with meaningful `Δexp/Δhp` but history endpoints all `404` (failure streak `9`), supporting confidence-aware reporting.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 05:09 KST
- Hypothesis: A `hp_drawdown_with_shield_loss_alert` (`Δhp <= -150` and mutation shield transition `present→none`) will catch imminent survivability risk earlier than reserve-only readiness checks.
- Change: Extend hourly feedback classifier with combined HP-drawdown + shield-transition rule and attach defensive-action recommendation.
- Metric(s): Next-cycle HP recovery rate after alert, avoidable defeat/retreat incidents, false-positive alert ratio during normal cycles.
- Result: Current cycle showed `Δexp=+848`, `Δgold=+40`, but large HP drop (`383→181`) with shield expiration (`13→none`) while history endpoints remained unavailable (`404` streak `9`), supporting composite survivability alerting.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 06:09 KST
- Hypothesis: A `shieldless_recovery_guard` label (HP recovery with shield absent) will reduce false "stabilized" interpretation and lower next-cycle survivability regressions.
- Change: Extend hourly classifier to tag `fragile_recovery` when `Δhp > 0` and `mutation_shield` remains absent, with recommendation to prioritize defensive/shield-refresh actions.
- Metric(s): Next-cycle HP drawdown rate after tagged cycles, incorrect stable-state interpretations, time-to-shield-restoration.
- Result: Current cycle showed HP rebound (`181→327`) with continued progression (`Δexp=+832`) but shield remained absent and reserve stayed below floor; history endpoints still `404` (streak `9`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 07:09 KST
- Hypothesis: A `shield_restored_but_drawdown_alert` (shield refresh with concurrent HP/gold decline) will reduce false stabilization calls after defensive buff recovery.
- Change: Add classifier rule that requires non-negative `Δhp` and `Δgold` before upgrading state to stabilized, even when mutation shield is restored.
- Metric(s): False-stabilization rate after shield refresh cycles, next-cycle HP/gold regression rate, intervention timing quality.
- Result: Current cycle restored shield (`none→26`) but still showed `Δhp=-94` and `Δgold=-110` with history endpoints unavailable (`404` streak `9`), supporting drawdown-aware shield interpretation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 08:09 KST
- Hypothesis: A `gold_up_but_fragile_guard` classifier (`Δgold > 0` with shield absence or non-positive HP delta) will reduce false stability labeling during partial recoveries.
- Change: Add economy-vs-survivability cross-check rule and require both economy and survivability improvement before emitting stabilized state.
- Metric(s): False-stability rate on positive-gold cycles, next-cycle HP regression frequency, shieldless-risk incident count.
- Result: Current cycle showed `Δgold=+150` and `Δexp=+720` but HP was flat/down (`233→227`) and shield expired (`26→none`) while history endpoints remained `404` (streak `9`), supporting guard-rule instrumentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 09:09 KST
- Hypothesis: A `recovery_imbalance_alert` (survivability recovery with concurrent large gold drawdown) will reduce hidden economy regressions during defensive rebound cycles.
- Change: Add classifier condition (`Δhp > 0`, shield transition `none→present`, and `Δgold <= -150`) and emit economy-preserving recommendation in hourly feedback.
- Metric(s): Gold floor breach duration, next-cycle economy regression after rebound cycles, false-negative detection of unstable recoveries.
- Result: Current cycle showed HP/shield recovery (`227→327`, `none→38`) with steady progression (`Δexp=+704`) but sharp economy decline (`Δgold=-180`) under ongoing history `404` streak `9`.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 10:09 KST
- Hypothesis: A `stalled_reserve_with_progress_alert` (`Δexp>0`, `Δgold=0`, and below reserve floor) will surface hidden economy stagnation during otherwise healthy progression cycles.
- Change: Add rule to tag progression-without-reserve-recovery and recommend gold-positive, low-risk action mix before sustained hunt loops.
- Metric(s): Time-to-reserve-recovery, frequency of prolonged sub-reserve plateaus, next-cycle gold delta after alert.
- Result: Current cycle showed steady progression (`Δexp=+640`) and survivability recovery (`Δhp=+22`, shield `38→40`) but no gold recovery (`Δgold=0`) with reserve still breached; history endpoints remained unavailable (`404` streak `10`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 11:09 KST
- Hypothesis: A `post_levelup_shieldless_guard` (level-up with shield absence and sub-reserve gold) will reduce over-aggressive behavior immediately after progression milestones.
- Change: Add post-level-up classifier that checks (`level_up_detected=true`, `shield_absent`, `gold<reserve`) and emits stabilization-first recommendation.
- Metric(s): HP/gold drawdown in the cycle after level-up, frequency of unstable post-level-up runs, time-to-restored full-readiness.
- Result: Current cycle reached Lv36 with stat growth and `Δgold=+100`, but mutation shield expired (`40→none`) and reserve remained below floor while history endpoints stayed unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 12:09 KST
- Hypothesis: A `positive_delta_shield_absent_gate` will reduce false "stabilized" labels when short-term progression/economy/HP improve but mutation shield is still absent.
- Change: Add rule to keep state at `partial_recovery` if (`Δexp>0`, `Δgold>0`, `Δhp>0`) AND `shield_absent=true`, with shield-refresh-first recommendation.
- Metric(s): False stabilization rate under shieldless cycles, next-cycle HP regression frequency, time-to-full-readiness.
- Result: Current cycle showed positive deltas (`Δexp=+544`, `Δgold=+120`, `Δhp=+24`) but mutation shield stayed absent while history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 13:09 KST
- Hypothesis: A `shieldless_hp_drawdown_alert` (`shield_absent` with `Δhp <= -100`) will reduce survivability regressions that are currently masked by small positive gold/exp deltas.
- Change: Extend hourly classifier with shieldless-drawdown rule and force defensive action recommendations before further hunt pressure.
- Metric(s): Next-cycle HP recovery after alert, severe HP-drop recurrence rate, false-negative survivability incidents.
- Result: Current cycle showed `Δexp=+496` and `Δgold=+30`, but HP dropped sharply (`356→240`) while shield stayed absent and history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 14:09 KST
- Hypothesis: A `hp_rebound_with_gold_drain_guard` will better detect fragile rebounds where HP improves but economy degrades under shield absence.
- Change: Add classifier for (`Δhp>0` AND `Δgold<=-100` AND `shield_absent`) and emit economy-safe defensive recommendation.
- Metric(s): Duration of sub-reserve periods, next-cycle HP/gold stability after guarded cycles, false-stable classification rate.
- Result: Current cycle showed HP rebound (`240→286`) with continued progression (`Δexp=+432`) but notable gold decline (`Δgold=-140`) and persistent shield absence; history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 15:09 KST
- Hypothesis: A `shield_restore_drawdown_gate` will reduce false stability upgrades when mutation shield returns but HP/gold continue declining.
- Change: Extend classifier to require (`shield_restored=true` AND `Δhp>=0` AND `Δgold>=0`) before marking `stabilized`; otherwise keep `partial_recovery`.
- Metric(s): False-stable labels after shield restoration, next-cycle HP/gold regression rate, time-to-true-stable classification.
- Result: Current cycle restored shield (`none→24`) while `Δexp=+432` but still had `Δhp=-6` and `Δgold=-90`; history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 16:09 KST
- Hypothesis: A `shield_expiry_after_positive_deltas_guard` will reduce false stabilization labeling when all short-term deltas are positive but protection just expired.
- Change: Add classifier rule to keep `partial_recovery` if (`Δexp>0`, `Δgold>0`, `Δhp>0`) and shield transition is `present→none`.
- Metric(s): False-stable classification rate after shield expiry, next-cycle HP/gold regression, time-to-shield-restoration.
- Result: Current cycle showed positive deltas (`Δexp=+400`, `Δgold=+150`, `Δhp=+48`) but shield expired (`24→none`) under ongoing history endpoint outages (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 17:09 KST
- Hypothesis: A `shield_restored_hp_negative_guard` will reduce premature readiness upgrades when mutation shield returns but HP trend is still negative.
- Change: Add classifier condition to keep `partial_recovery` if shield transitions `none→present` and `Δhp<0`, even when `Δgold` and `Δexp` are positive.
- Metric(s): False-stable classifications after shield restoration, next-cycle HP regression frequency, time-to-true stabilization.
- Result: Current cycle restored shield (`none→33`) with `Δexp=+384` and `Δgold=+70`, but HP still declined (`328→306`) while history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 18:09 KST
- Hypothesis: A `gold_crash_under_shield_decay_alert` will catch high-risk degradation windows where economy collapses while shield and HP trends are non-improving.
- Change: Add classifier condition (`Δgold<=-200`, `Δhp<=0`, `Δshield<0`) and emit economy-preserving defensive recommendation with reduced hunt pressure.
- Metric(s): Time-to-stop gold freefall, next-cycle HP/gold stabilization rate, false-negative high-risk cycle count.
- Result: Current cycle showed `Δexp=+368` but severe `Δgold=-210` with HP non-recovery (`306→303`) and shield decay (`33→32`) while history endpoints remained unavailable (`404`, streak `7`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 19:09 KST
- Hypothesis: A `fast_shield_decay_horizon_alert` (`Δshield <= -10` while shield is still active) will improve pre-expiry stabilization and reduce post-expiry regressions.
- Change: Add shield-horizon classifier and emit proactive shield-refresh-safe recommendation before full expiration.
- Metric(s): Post-expiry HP drawdown rate, time-to-shield-restoration after alert, false-positive horizon alerts.
- Result: Current cycle showed positive `Δexp=+336`, `Δgold=+30`, `Δhp=+34` but rapid shield decay (`32→17`) with history endpoints still unavailable (`404`, streak `7`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 20:09 KST
- Hypothesis: A `consumable_burn_with_shield_decay_alert` will identify short-horizon instability earlier than HP-only or shield-only rules.
- Change: Add classifier condition (`Δuse_item <= -3`, `Δshield <= -8`, `Δhp < 0`) and emit immediate stabilization recommendation.
- Metric(s): Next-cycle HP stabilization after alert, repeated consumable-burn episodes, false-negative fragile-cycle rate.
- Result: Current cycle showed `Δexp=+336` with HP drop (`337→265`), shield decay (`17→8`), and use-item burn (`30→26`) while history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 21:09 KST
- Hypothesis: A `reserve_stall_after_recovery_alert` will catch hidden economy stagnation during survivability rebounds and shorten sub-reserve duration.
- Change: Add classifier for (`Δhp>0`, `Δshield>0`, `Δgold=0`, `gold<reserve`) and emit gold-positive stabilization recommendation.
- Metric(s): Time spent below reserve after survivability rebound, next-cycle gold improvement rate, false-stable classification count.
- Result: Current cycle showed HP/shield recovery (`265→336`, `8→21`) with ongoing progression (`Δexp=+320`) but no gold recovery (`Δgold=0`) while history endpoints remained unavailable (`404`, streak `7`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 22:09 KST
- Hypothesis: A `survivability_up_economy_down_alert` will prevent false stabilization in cycles where defense recovers but reserve worsens.
- Change: Add classifier for (`Δhp>0`, `Δshield>0`, `Δgold<0`) and trigger gold-preserving recommendation despite positive survivability trend.
- Metric(s): Reserve recovery time after alert, next-cycle gold regression rate, false-stable labels in mixed-trend cycles.
- Result: Current cycle showed HP/shield rebound (`336→391`, `21→40`) with continued progression (`Δexp=+272`) but economy decline (`Δgold=-90`) under ongoing history endpoint outages (`404`, streak `7`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-08 23:09 KST
- Hypothesis: A `status_reset_detector` (large discontinuity across level/max-stats/area) will prevent misleading trend analysis immediately after character/season resets.
- Change: Add reset-segmentation rule that starts a fresh baseline when abrupt state jumps are detected and suppresses pre/post-reset delta comparisons.
- Metric(s): False anomaly rate after resets, correctness of first-3-cycle post-reset recommendations, time-to-stable baseline re-establishment.
- Result: Current cycle showed abrupt cold-start profile (Lv36→Lv1, max HP/MP reset, area shift) while history endpoints remained unavailable (`404`, streak `6`), supporting reset-aware segmentation.
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-09 00:09 KST
- Hypothesis: A `post_reset_idle_detector` (consecutive zero-delta cycles after reset) will improve detection of stalled automation vs expected baseline idling.
- Change: Add detector that tracks consecutive cycles with (`Δlevel=0`, `Δexp=0`, `Δgold=0`) in reset segment and emits bootstrap/liveness-check recommendation.
- Metric(s): Time-to-detect stalled loop after reset, false idle alerts during normal bootstrap, first non-zero progression latency.
- Result: Current cycle remained fully flat at reset baseline (Lv1/exp0/gold100/HP100) with only use-item quota movement while history endpoints stayed unavailable (`404`, streak `7`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-09 01:09 KST
- Hypothesis: A post-reset `idle_streak_counter` with liveness probe escalation will reduce time-to-detect stalled automation when status remains flat across consecutive cycles.
- Change: Track consecutive zero-progress cycles (`Δlevel=0`, `Δexp=0`, `Δgold=0`) in reset segment and trigger a minimal action/liveness probe after threshold breach.
- Metric(s): Time-to-stall-detection post-reset, false idle escalations, first non-zero progression latency after intervention.
- Result: Current cycle remained fully flat at reset baseline with recurring use-item quota consumption but no progression signal while history endpoints stayed unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-09 02:09 KST
- Hypothesis: Escalating `idle_streak_counter` at 3 consecutive zero-progression post-reset cycles will shorten detection-to-recovery time for stalled loops.
- Change: Upgrade idle detector to trigger an automatic single low-risk liveness probe when streak reaches `3`.
- Metric(s): Time-to-first-nonzero progression after escalation, false escalation rate, probe success ratio.
- Result: Current cycle remained flat at reset baseline for a third consecutive hour (`Δlevel/Δexp/Δgold=0`) with continued use-item quota drain and history endpoints unavailable (`404`, streak `7`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-09 03:09 KST
- Hypothesis: An `ineffective_activity_guard` (`Δexp=0`, `Δgold=0`, and significant consumable burn) will reduce wasted cycles during post-reset stalls.
- Change: Add guard rule to detect no-progress + resource burn pattern and trigger throttled mode with mandatory liveness probe.
- Metric(s): Consumable burn per zero-progress hour, time-to-first-nonzero progression after guard activation, false-positive guard rate.
- Result: Current cycle remained flat at reset baseline for a fourth consecutive hour while use-item quota dropped further (`18→14`) and history endpoints remained unavailable (`404`, streak `6`).
- Decision: Implement in next 30-min cycle and validate over 8 hourly runs.

- Date: 2026-03-13 16:28 KST
- Hypothesis: Supporting `/api/status.character` parsing in the hourly fetcher will restore actionable progression/resource signals even when history endpoints are `404`.
- Change: Extend status summarizer fallback path to accept both legacy `status.*` and current `character.*` schemas.
- Metric(s): % hourly cycles with non-empty level/exp/gold/hp/mp snapshot; number of "status endpoint healthy but empty fields" incidents.
- Result: This cycle had `/api/status` `200` but `activity:fetch` emitted zeroed progression due to schema mismatch (`character.*` only).
- Decision: Implement parser compatibility patch next cycle and evaluate over 6 hourly runs.

- Date: 2026-03-13 17:28 KST
- Hypothesis: When activity endpoints are `404`, deriving provisional combat outcomes/anomalies from `GET /api/agent/thinking/{character}` improves hourly feedback usefulness without overstating certainty.
- Change: Add a fallback summarizer that parses last-hour thinking logs for signals (`429`, surrender churn, defeat mentions, KPI movement) and emits confidence labels (`high|medium|low`) alongside current status snapshot.
- Metric(s): % hourly cycles with non-empty outcome/anomaly section; false-positive anomaly rate vs later recovered activity API data; time-to-detect recurring 429 churn.
- Result: Current hour had activity endpoints `404` + status `200`; thinking logs provided actionable last-hour evidence (fresh 16:50/17:22 entries with 429/surrender-churn mitigation) that replay fallback alone did not expose.
- Decision: Implement in next 30-min cycle and validate across 6 hourly runs.

- Date: 2026-03-13 19:27 KST
- Hypothesis: Using direct `/api/status.character` deltas against prior OPS snapshot can recover actionable progression/economy feedback during persistent history-endpoint `404` outages.
- Change: Validate fallback with live status probe + prior-cycle snapshot comparison (`18:28 -> 19:27`) and include confidence-labeled outcome limits.
- Metric(s): Cycles with non-zero progression/economy signals while history endpoints fail; mismatch rate once history APIs recover.
- Result: Current cycle produced clear status-derived movement (`Δexp=+598`, `Δgold=+35`, `Δhp=-6`) while all history endpoints remained `404`.
- Decision: Continue for next 6 hourly cycles; promote to default fallback if non-zero status-derived signals remain stable and no major mismatches appear.


## [2026-03-13 20:28 KST] Dynamic combat-start cooldown from throttle-wait share
- Hypothesis: Adapting `combat_start` cooldown to recent `wait_combat_start_rate_limit` share will retain progression while reducing HP bleed and wasted cycles under persistent throttle conditions.
- Change: Add a controller that raises cooldown when wait-share >50% and lowers it when <25%; emit telemetry (`cooldown_ms`, wait-share, `Δexp`, `Δhp`) in hourly feedback.
- Metric(s): Wait-share %, `Δexp/hour`, `Δhp/hour`, 429 incidence per 30-min window.
- Result: Baseline this cycle shows meaningful progression (`Δexp=+1606`, `Δgold=+15`) with notable survivability cost (`Δhp=-47`) and ongoing throttle-wait dominance in thinking logs.
- Decision: Run for next 4 cycles; promote if wait-share drops without reducing `Δexp/hour`.

- Date: 2026-03-14 00:26 KST
- Hypothesis: Adding a deterministic `hp_drawdown_guard` (`Δhp <= -40` with `Δexp > 0`) to hourly feedback will reduce survivability regressions without materially reducing progression pace during history-endpoint outages.
- Change: Extend status-delta feedback classifier to emit guard state and recovery-first recommendation when threshold is hit.
- Metric(s): Guard-hit frequency per 24h, next-cycle HP recovery rate, and `Δexp/hour` retention after guard-triggered recommendations.
- Result: Current cycle showed positive progression/economy (`Δexp=+338`, `Δgold=+25`) with meaningful HP decline (`Δhp=-53`) while all history endpoints remained `404`.
- Decision: Implement in next 30-min dev cycle and validate over 8 hourly runs.

- Date: 2026-03-14 01:26 KST
- Hypothesis: An explicit `auth_preflight_check` (key validity + base-url alignment) before hourly probes will reduce false gameplay interpretations during auth drift (`401`) and improve operator response speed.
- Change: Add preflight step that probes `/api/status` and one `/api/logs` endpoint using loaded env key, emits `auth_state`, and forces outcome confidence to `low` when preflight fails.
- Metric(s): Number of hourly cycles with unresolved outcome cause (`404` vs `401`) ambiguity; time-to-diagnose credential failures; false-positive gameplay anomaly notes.
- Result: Current cycle observed history endpoints `404` from fetcher plus direct authenticated probes returning `401 Missing or invalid API key`, leaving win/defeat unresolved.
- Decision: Run in next 30-min dev cycle; promote if ambiguity drops for 4 consecutive hourly cycles.

- Date: 2026-03-14 02:28 KST
- Hypothesis: A lightweight daemon-log signal extractor can recover high-utility last-hour outcome proxies (progression cadence + danger churn) when Buju recent-history APIs return persistent `404`.
- Change: Add hourly parser over `logs/live-runner-daemon.log` (lookback 60m) to compute `exp_delta`, `combat_start_success_count`, `rest_count`, and `surrender_danger_count`, then attach confidence=`medium` when API history is unavailable.
- Metric(s): % hourly cycles with non-empty gameplay signal section during API outages; mismatch rate vs canonical API outcome counts after recovery; false anomaly rate.
- Result: Current cycle had API history blind spot (`6x 404`) while daemon evidence still showed actionable progression/churn (`exp +114`, repeated combat-start success, periodic rest, danger surrender events).
- Decision: Implement in next 30-min cycle; evaluate over 6 hourly runs before promoting to default fallback.

- Date: 2026-03-14 03:28 KST
- Hypothesis: Using `/api/logs?action=death|level_up` as a structured fallback when `/api/*/recent` endpoints return `404` will restore actionable hourly outcome visibility without overstating certainty.
- Change: Add `outcome_fallback_adapter` that computes `defeat_count(last 60m)`, `last_death_at`, `last_levelup_at`, and marks confidence=`medium` with explicit `source=logs_action_fallback`.
- Metric(s): % hourly cycles with non-empty outcome section during `404` outages; mismatch rate vs canonical recent endpoints once recovered; false anomaly notes per 24h.
- Result: This cycle had persistent `404` on all 6 recent endpoints, while direct logs endpoints were healthy (`200`) and provided defeat recency evidence.
- Decision: Implement in next 30-min cycle and validate over 6 hourly runs.

- Date: 2026-03-14 04:32 KST
- Hypothesis: When `/api/*/recent` endpoints are `404`, a paginated `/api/logs` 60-minute aggregator (`limit=100`, `page++ until timestamp cutoff`) will recover high-confidence hourly gameplay outcomes and reduce fallback no-signal cycles.
- Change: Add `logs_paged_hourly_fallback` path to hourly collector; compute `wins/defeats/rest/surrender/action_mix` and resource-pressure proxies (`damage_taken_sum`, recovery-action density), with confidence=`medium` and explicit source tag.
- Metric(s): % hourly cycles with non-empty outcome section during recent-endpoint outages; mismatch rate vs canonical recent endpoints after recovery; false anomaly notes/day.
- Result: Current cycle had `/api/status` and `/api/logs` healthy (`200`) with 359 last-hour events and clear outcomes (251 wins, 0 defeats), while recent endpoints remained `404`.
- Decision: Run in next 30-min dev cycle; promote if actionable signal coverage stays >95% for 6 consecutive outage cycles.

- Date: 2026-03-14 05:27 KST
- Hypothesis: Adding a mandatory hourly `outcome_confidence` stamp (`high|medium|low`) to gameplay summaries will reduce false-positive policy changes during partial telemetry outages.
- Change: Emit confidence based on source health (`high`=recent endpoints `200`, `medium`=action-log fallback, `low`=status-only), and require `high` before any aggression-increase recommendation.
- Metric(s): Number of policy-change suggestions made under non-`high` confidence; mismatch rate between provisional and canonical outcomes after endpoint recovery.
- Result: This cycle had strong progression (`Δexp=+850`) and no last-hour defeat signal, but canonical recent endpoints remained `404`, making this an ideal medium-confidence case.
- Decision: Run in next 30-min dev cycle and evaluate over 6 hourly runs.

- Date: 2026-03-14 06:28 KST
- Hypothesis: A `surrender_pressure_guard` using last-hour `surrender_rate = surrender/hunt` will reduce avoidable churn and improve net economy when wins are high but surrender noise remains non-zero.
- Change: In hourly analyzer, compute `surrender_rate`; when `>2.5%`, emit conservative recommendation set (`rest threshold +1` or temporary monster-tier down) and block aggression-increase suggestions until rate normalizes.
- Metric(s): surrender_rate/hour, `Δgold/hour`, and `defeat_count/hour` before vs after guard enablement.
- Result: Current hour shows `248` wins, `7` surrenders (`2.82%`), `0` defeats, `ΔEXP +500`, and mild gold drift (`-20`) under high incoming-damage pressure (`피격 2265`).
- Decision: Run in next 30-min dev cycle and evaluate over 6 hourly windows.

- Date: 2026-03-14 07:26 KST
- Hypothesis: A strict hourly `auth_preflight_gate` (`/api/status` + `/api/logs` with loaded key) will reduce false gameplay interpretations under credential drift by forcing confidence=`low` and blocking downstream policy suggestions when auth fails.
- Change: Add preflight stage before hourly synthesis; require authenticated `200` on at least one status/log endpoint to allow progression/outcome reporting.
- Metric(s): Number of hourly summaries produced with unresolved auth cause; false-positive gameplay anomaly/policy notes during `401` windows; time-to-diagnose key failures.
- Result: Current cycle observed `.env` key present but direct authenticated probes returned `401` across status/log endpoints, while fallback probe still showed `*/recent` `404` + replay no-signal.
- Decision: Execute in next 30-min dev cycle; promote if auth-cause ambiguity drops for 4 consecutive hourly cycles.

- Date: 2026-03-14 08:28 KST
- Hypothesis: A hard `death_loop_breaker` (triggered by last-hour defeat concentration) will reduce repeated `death/surrender/rest` churn and restore positive progression within 1-2 cycles.
- Change: Add guard condition `death_count_last_60m >= 5 OR death_share >= 10%`; when hit, force conservative combat profile (lower monster tier, strict pre-combat HP floor, cooldown backoff) and suppress aggression recommendations.
- Metric(s): `death_count/hour`, `hunt_count/hour`, `exp_delta/hour`, and guard-hit frequency over next 6 hourly cycles.
- Result: Current hour showed severe loop signature from live logs (`death=136`, `surrender=136`, `rest=136`, `hunt=0`) with status at `Lv20, EXP=1`, confirming recovery churn without net progression.
- Decision: Execute in next 30-min dev cycle; promote to default safeguard if defeats drop by >=80% and hunts recover (>30/hour) for 3 consecutive cycles.

- Date: 2026-03-14 09:28 KST
- Hypothesis: A hard temporary non-combat circuit breaker (`hunt_count_last_60m==0 && death_count_last_60m>=20`) will collapse repeated death-loop churn faster than parameter-only combat tuning.
- Change: Add `death_loop_breaker_v2` to force 15-minute recovery-only mode (`rest/buy`, block `combat_start`), then resume with conservative hunt caps and explicit guard-hit telemetry.
- Metric(s): `death_count/hour`, `hunt_count/hour`, and time-to-first-successful-hunt after breaker trigger; restart-loop frequency per 6 hourly cycles.
- Result: Current hour repeated critical loop signature (`death=136`, `surrender=136`, `rest=137`, `hunt=0`, `ΔEXP=0`, `ΔGold=0`) with healthy API read-path (`/api/status` + `/api/logs` `200`), confirming issue is policy behavior rather than telemetry outage.
- Decision: Execute in next 30-min cycle; promote to default safety mechanism if deaths drop by >=80% and hunts recover to >20/hour for 3 consecutive hourly windows.

- Date: 2026-03-14 10:26 KST
- Hypothesis: An `idle_observability_guard` that adds a secondary probe when hourly recent/log streams are empty will reduce false "no-activity" interpretations caused by telemetry ingestion lag.
- Change: When `activity:fetch` yields zero signals with `status=200`, run one backup endpoint (`/api/agent/thinking/{username}?limit=20`) and stamp summary confidence as `low-idle` vs `low-unknown`.
- Metric(s): false idle classifications/day, cycles with unresolved signal source, and time-to-detect telemetry lag.
- Result: Current cycle had `/api/status=200`, recent endpoints `404`, and `/api/logs` empty at `200`, leaving activity state ambiguous.
- Decision: Run in next 30-min dev cycle; promote if ambiguity drops for 4 consecutive hourly runs.

- Date: 2026-03-14 11:28 KST
- Hypothesis: Adding a strict `recovery_resume_gate` (`hp_ratio>=0.75` AND rolling 15m `death_count<=2`) after death-loop breaker will reduce repeated death/surrender churn versus time-only breaker expiry.
- Change: Extend runner safety policy to keep non-combat mode active until both survivability and short-horizon death-rate criteria pass; emit `guard_block_reason` and `resume_gate_state` in hourly feedback.
- Metric(s): `death_count/hour`, `hunt_count/hour`, and `death_per_hunt` before vs after gate; time-to-stable positive EXP trend.
- Result: Current hour still shows severe imbalance despite partial progression (`hunt=41`, `death=113`, `surrender=113`, `ΔEXP=+82`).
- Decision: Run in next 30-min dev cycle; promote if `death_per_hunt < 0.5` for 3 consecutive hourly windows.

- Date: 2026-03-14 12:27 KST
- Hypothesis: A strict auth preflight (`/api/status` + `/api/logs`) using the exact runtime credential source will reduce false gameplay summaries during credential drift and cut mean time to diagnose `401` outages.
- Change: Add preflight stage that validates key format/source and records `auth_state` (`ok|unauthorized|missing_key|header_mismatch`); when non-`ok`, force `outcome_confidence=low` and skip gameplay inference.
- Metric(s): Hourly cycles with unresolved auth cause; false gameplay-anomaly notes during auth failures; time-to-recovery after key rotation.
- Result: This cycle reproduced `401 Missing or invalid API key` on direct authenticated probes for status/log endpoints, while historical recent-endpoint path remained non-actionable (`404`/fallback).
- Decision: Run in next 30-min dev cycle; promote if auth-cause ambiguity is eliminated for 4 consecutive hourly cycles.

- Date: 2026-03-14 13:28 KST
- Hypothesis: Keeping strict recovery gates active while shifting optimization target from survivability to non-combat churn will preserve zero-defeat stability and improve net resource velocity.
- Change: Introduce `efficiency_guard_v1` metrics (`hunt_share`, `buy+drop_share`, `surrender_share`) and apply only soft non-combat adjustments when churn exceeds threshold (`buy+drop_share > 15%` for 2 windows), without raising combat aggressiveness.
- Metric(s): `death_count/hour`, `hunt_count/hour`, `gold_delta/hour`, `buy+drop_share`, `surrender_share`.
- Result: Current live window shows stable recovery (`hunt=249`, `death=0`, `surrender=2`, 339 events total) with healthy throughput but non-trivial non-combat overhead (`buy+drop=60`, ~17.7%).
- Decision: Run in next 30-min cycle; promote if zero-defeat stability holds and `buy+drop_share` drops below 12% for 3 consecutive hourly windows.

- Date: 2026-03-14 14:29 KST
- Hypothesis: Converting `efficiency_guard_v1` from telemetry-only to a light action gate (`buy+drop_share` threshold) will reduce non-combat churn without regressing the current zero-defeat stability.
- Change: Keep existing survivability gates unchanged; when `buy+drop_share > 15%` for 2 consecutive hourly windows, apply temporary non-combat throttles (buy cooldown bump + low-value pickup defer).
- Metric(s): `buy+drop_share`, `death_count/hour`, `hunt_count/hour`, `gold_delta/hour`, `exp_delta/hour`.
- Result: Current live window remained stable (`hunt=245`, `death=0`, `surrender=2`, `ΔEXP=+498`) but churn stayed elevated (`buy+drop=52/328`, ~15.9%).
- Decision: Implement in next 30-min cycle; promote if `buy+drop_share < 12%` for 3 consecutive windows while keeping `death=0`.

- Date: 2026-03-14 15:26 KST
- Hypothesis: A `low_signal_guard_v2` (status/live probe + backup thinking probe) will reduce false gameplay-feedback recommendations during no-event windows caused by recent-endpoint degradation.
- Change: In hourly feedback, if `/api/status=200` and both `activity:fetch` + `/api/logs` are empty, mark `confidence=low_idle`, run one backup probe (`/api/agent/thinking/{username}?limit=20`), and block policy/aggression suggestions.
- Metric(s): false-positive recommendation count per day in empty-log windows; cycles with unresolved signal cause; time-to-recovery detection when events resume.
- Result: Current cycle produced no actionable event stream (`status=200`, logs empty, recent probes degraded), so confidence gating is needed before making strategy calls.
- Decision: Implement in next 30-min dev cycle; promote if false-positive recommendation count drops to zero for 6 consecutive hourly cycles.

- Date: 2026-03-14 16:28 KST
- Hypothesis: A `signal_reconciliation_guard_v1` that detects `status-delta present + logs empty` conflicts will reduce false idle classifications and prevent premature strategy changes during telemetry lag.
- Change: If `ΔEXP>0 || ΔGold!=0` while last-hour logs are empty, auto-label cycle `confidence=low_conflict`, run one backup thinking probe, and suppress policy/aggression recommendations until at least one event stream is non-empty.
- Metric(s): false-idle classification count/day; cycles with unresolved status-vs-log conflict; median time to identify telemetry-lag cause.
- Result: Current cycle showed clear status movement (`ΔEXP=+496`, `ΔGold=+20`, `ΔHP=+25`) with zero last-hour logs and persistent `*/recent` 404s.
- Decision: Implement in next 30-min dev cycle; promote if conflict-tagged cycles drop by >=50% and no aggressive recommendation is emitted during unresolved conflicts for 6 consecutive hourly runs.

- Date: 2026-03-14 18:28 KST
- Hypothesis: A temporary `hp_floor_efficiency_guard_v1` (raise pre-combat HP floor by +5% when `rest>=20/hour` and end-hour HP ratio `<0.60`) will reduce fragile low-HP endings without increasing defeats.
- Change: Add one-cycle adaptive guard trigger from hourly metrics and log before/after comparison (`rest_count`, `Δgold/hour`, `defeat_count/hour`).
- Metric(s): End-hour `hp_ratio`, `rest_count/hour`, `defeat_count/hour`, and net `Δgold/hour` across guarded vs unguarded windows.
- Result: Current hour was win-heavy (`245` wins, `0` defeats) but still ended at `HP 214/385` (`55.6%`) with `rest=25`, indicating survivability margin may be thinner than throughput suggests.
- Decision: Trial in next 30-min dev cycle; promote if end-hour HP rises above 60% for 3 consecutive windows without increasing defeat count.

- Date: 2026-03-14 20:28 KST
- Hypothesis: `empty_logs_escalation_guard_v1` (2-cycle empty-logs escalation + one backup liveness probe) will reduce false gameplay inferences during telemetry outages without delaying real incident detection.
- Change: In hourly feedback, when `/api/status=200` but `/api/logs` and `*/recent` are empty/degraded for 2 consecutive windows, set `confidence=low_idle`, run one backup liveness probe, and block policy/aggression recommendation output.
- Metric(s): false-positive strategy recommendations in no-signal windows, unresolved telemetry-conflict cycles/day, time-to-recover once non-empty events resume.
- Result: Current cycle showed live status (`Lv21`, `EXP 321`, `HP 247/400`) with empty logs and persistent `*/recent` `404`, confirming an observability-conflict pattern.
- Decision: Implement in next 30-min dev cycle; promote if false-positive recommendations remain zero for 6 consecutive hourly windows.

- Date: 2026-03-14 22:26 KST
- Hypothesis: A `status_delta_conflict_counter_v1` (status-move + empty-log conflict tracking) will reduce false idle interpretations during telemetry lag windows.
- Change: In hourly feedback, when `/api/status=200` and `ΔEXP>0 || ΔGold!=0` but paged `/api/logs` is empty, increment a conflict counter, fetch one backup liveness probe, and force `confidence=low_conflict` with policy/aggression recommendations blocked.
- Metric(s): conflict-window false-idle classification count/day; unresolved conflict duration (hours); false-positive strategy recommendations during conflict windows.
- Result: Current cycle showed `status` progression (`ΔEXP +978`, `ΔGold +15`) while `/api/logs` pages were all empty (`count=0`) and `*/recent` endpoints remained `404`.
- Decision: Run in next 30-min dev cycle; promote if false-idle classifications drop for 6 consecutive hourly windows.

- Date: 2026-03-14 23:28 KST
- Hypothesis: A strict credential-source validator (`.env` parse + masked fingerprint + dual-endpoint preflight) will reduce recurring `401` hourly blind spots and prevent false gameplay summaries.
- Change: Add `auth_preflight_gate_v2` that checks `/api/status` and `/api/logs?limit=1`; on any `401`, emit `auth_state=unauthorized`, block gameplay inference, and attach deterministic retry steps.
- Metric(s): Count of hourly cycles with unresolved auth cause; time-to-recover after key rotation; false gameplay summaries emitted during auth failures.
- Result: Current cycle produced `401` on both status and logs immediately after `.env` key load, leaving all last-hour gameplay KPIs unavailable.
- Decision: Implement in next 30-min cycle; promote if unresolved-auth cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-15 01:29 KST
- Hypothesis: `surrender_churn_guard_v1` (temporary +5% pre-combat HP floor when surrender share is high but deaths are zero) will reduce non-lethal surrender waste without reducing hunt throughput.
- Change: If hourly window satisfies `surrender_share >= 4%` and `death_count = 0`, apply one-cycle HP-floor bump and keep other safety/aggression settings unchanged.
- Metric(s): `surrender_count/hour`, `hunt_count/hour`, `gold_delta/hour`, and end-hour `hp_ratio` before/after guard.
- Result: Current window showed strong throughput (`hunt=249`) with no deaths, but surrender remained elevated (`16/352`, `4.5%`) alongside non-trivial rest/buy churn.
- Decision: Run in next 30-min dev cycle; promote if surrender drops below `2%` for 3 consecutive hourly windows without hunt-count regression.

- Date: 2026-03-15 02:27 KST
- Hypothesis: A lightweight `connectivity_preflight_v1` (DNS resolve + status endpoint reachability) before hourly synthesis will reduce false gameplay summaries and shorten outage triage when Buju API is unreachable.
- Change: Add preflight that emits `connectivity_state` (`ok|dns_unreachable|network_unreachable|timeout`) and blocks progression/outcome synthesis when non-`ok`.
- Metric(s): False gameplay inference count during transport outages; mean time to classify outage root cause; % cycles with explicit retry guidance.
- Result: Current cycle failed with transport `ENOTFOUND webgame-api.berrysoft.kr` before auth/data collection, leaving last-hour gameplay telemetry unavailable.
- Decision: Run in next 30-min dev cycle; promote if outage classification is explicit for 4 consecutive failure windows.

- Date: 2026-03-15 03:27 KST
- Hypothesis: A strict `connectivity_preflight_v1.1` (DNS resolve + short status probe classification) will reduce false gameplay summaries during transport outages and speed root-cause triage.
- Change: Add preflight stage that emits `connectivity_state` (`ok|dns_unreachable|network_unreachable|timeout`) before any status/log aggregation; block gameplay inference when state is non-`ok`.
- Metric(s): False gameplay-inference count during transport failures; mean time to classify outage cause; % failure cycles with explicit retry guidance.
- Result: Current cycle failed on authenticated status probe with `ENOTFOUND webgame-api.berrysoft.kr`, leaving last-hour gameplay signals unavailable.
- Decision: Run in next 30-min dev cycle; promote if outage classification is explicit for 4 consecutive failure windows.

- Date: 2026-03-15 04:26 KST
- Hypothesis: Enforcing `auth_path_parity_check_v1` (same credential source + same header contract across `activity:fetch` and direct probes) will eliminate contradictory auth states and reduce low-confidence hourly summaries.
- Change: In hourly feedback, execute paired preflight calls (`/api/status`, `/api/logs?limit=1`) through both fetch paths; emit `auth_parity=pass|fail` and block gameplay inference whenever results diverge.
- Metric(s): auth-parity failure count/day; low-auth-blocked cycles/day; mean time to recover from `401` episodes.
- Result: Current cycle reproduced divergence (`activity:fetch` saw `/api/status=200` while direct authenticated status/log probes both returned `401`).
- Decision: Implement in next 30-min dev cycle; promote if parity failures remain zero for 6 consecutive hourly windows.

- Date: 2026-03-15 05:28 KST
- Hypothesis: Hard-gating hourly synthesis behind `auth_preflight_gate_v2` (canonical header + paired `/api/status` and `/api/logs?limit=1`) will eliminate low-confidence cycles caused by contradictory auth outcomes.
- Change: Add one deterministic parity preflight stage and block gameplay inference when either endpoint is non-200.
- Metric(s): `auth_gate_failures/day`, `% hourly cycles with inferred gameplay while auth invalid`, time-to-diagnose auth incidents.
- Result: This cycle reproduced inconsistency (`direct /api/status=401` while `activity:fetch` observed `/api/status=200`; recent-history endpoints remained `404`).
- Decision: Implement in next 30-min dev cycle; promote if contradictory auth outcomes drop to zero for 6 consecutive hourly runs.

- Date: 2026-03-15 06:29 KST
- Hypothesis: Enforcing `dns_preflight_gate_v1` before hourly Buju synthesis will reduce false/low-confidence gameplay summaries during intermittent resolver outages.
- Change: Add mandatory DNS resolution check for `webgame-api.berrysoft.kr`; if fail, emit `connectivity_state=dns_unreachable`, skip gameplay KPI inference, and log retry guidance only.
- Metric(s): `% hourly cycles with unresolved gameplay KPIs`, `dns_unreachable incidence/day`, and `false inference count during DNS failures`.
- Result: This cycle produced mixed evidence (`activity:fetch` saw `/api/status=200` while direct probes failed with `Could not resolve host`), leaving last-hour gameplay signals unavailable.
- Decision: Implement in next 30-min cycle; promote if false inference remains zero across 6 consecutive DNS-failure windows.

- Date: 2026-03-15 07:28 KST
- Hypothesis: A `buy_efficiency_probe_v1` that records gold-linked buy/sell telemetry each cycle will reduce economy blind spots and prevent low-reserve drift without hurting win throughput.
- Change: In hourly feedback path, emit deterministic economy fields (`buy_count`, `buy_gold_spent`, `sell_gold_gain`, `net_trade`, `gold_after_cycle`) and raise a caution tag when `buy_share > 15%` for 3 consecutive cycles.
- Metric(s): consecutive high-buy cycles/day, gold-floor breach frequency (`gold < 300`), and hunt/win regression after caution-tag activation.
- Result: Current live window showed strong outcomes (`wins=247`, `defeats=0`) but elevated purchase churn (`buy=61/348`, `17.5%`) with low reserve (`gold=349`).
- Decision: Run in next 30-min dev cycle; promote if gold-floor breaches decrease over 6 hourly windows with no hunt-count regression.

- Date: 2026-03-15 10:26 KST
- Hypothesis: `connectivity_preflight_v1.2` (DNS resolve + short jittered retry) will reduce false/noisy hourly gameplay summaries during transient resolver failures.
- Change: Add preflight classification (`ok|dns_unreachable|network_unreachable|timeout`) and block KPI synthesis when non-`ok`; include retry guidance in OPS entry.
- Metric(s): % outage cycles with explicit root-cause classification; false gameplay inferences during transport failures; mean time-to-diagnose DNS incidents.
- Result: Current cycle failed before auth/data collection (`/api/status`, `/api/logs` both transport DNS errors), so gameplay signals were unavailable.
- Decision: Run in next 30-min dev cycle; promote if 4 consecutive outage cycles are classified deterministically with zero false gameplay inference.
- Date: 2026-03-15 11:28 KST
- Hypothesis: For hourly feedback, a hard `auth_state` gate using the collector's exact credential path will prevent false gameplay interpretation when `/api/status` and `/api/logs` drift to `401` but partial telemetry endpoints still return `200`.
- Change: Add `scripts/auth-preflight-gate.js` and require `auth_state=ok` before computing progression/win-defeat/resource summaries.
- Metric(s): low-confidence hourly cycles/day; split-signal incidence (`status/log 401` with parallel `200` endpoint); mean time-to-diagnose auth issues.
- Result: Current cycle reproduced split signal (`activity:fetch /api/status=200` with fallback payload, but direct `/api/status` and `/api/logs` were both `401`; thinking endpoint remained `200`).
- Decision: Proceed in next 30-min dev cycle; promote to mandatory gate if reproduced in the next consecutive hourly run.

- Date: 2026-03-15 12:27 KST
- Hypothesis: `hourly_readpath_preflight_v1` (single canonical credential/header path check for `/api/status` + `/api/logs?limit=1`) will reduce low-confidence hourly feedback caused by mixed `status=200` vs transport/auth failures.
- Change: Add deterministic preflight state output `readpath_state=ok|status_only|transport_fail|auth_fail`; block progression/win-defeat/resource inference unless state is `ok`.
- Metric(s): low-confidence hourly cycles/day; split-signal incidence/day; % failure cycles with explicit root-cause tag and retry guidance.
- Result: This cycle reproduced mixed reachability (`activity:fetch` fallback reported `/api/status=200` with `*/recent=404`, while direct status/log probes failed transport), leaving canonical hourly outcomes unresolved.
- Decision: Run in next 30-min dev cycle; promote if split-signal cycles drop to zero for 6 consecutive hourly runs.

- Date: 2026-03-15 15:28 KST
- Hypothesis: A single shared read-path checker (`status + logs`) used by both collector and direct probes will reduce mixed-signal hourly cycles (`status=200` vs transport-fail) and prevent low-confidence gameplay feedback.
- Change: Add `hourly-readpath-check` preflight with deterministic output (`readpath_state`, `transport_error_class`, `inference_allowed`) and gate gameplay synthesis when `inference_allowed=false`.
- Metric(s): `mixed_readpath_cycles/day`, `% hourly cycles with blocked inference due to transport/auth mismatch`, and time-to-diagnose root cause.
- Result: Current cycle produced fallback-only summary (`/api/status=200`, all recent endpoints `404`) while direct status/log reads failed transport (`fetch failed`), leaving gameplay signals unresolved.
- Decision: Run in next 30-min dev cycle; promote if mixed-readpath cycles drop to zero for 6 consecutive hourly runs.

- Date: 2026-03-15 17:28 KST
- Hypothesis: A unified hourly telemetry gate (`status + logs` on one shared client path) will reduce low-confidence feedback cycles caused by collector/direct transport mismatches.
- Change: Add `hourly-telemetry-gate` that classifies `readpath_state=ok|status_only|transport_fail|auth_fail` and blocks KPI inference unless `ok`.
- Metric(s): `mixed_readpath_cycles/day`, `% cycles with blocked inference`, and `time-to-root-cause` for transport/auth incidents.
- Result: This cycle again showed split behavior (`activity:fetch /api/status=200` while direct `/api/status` and `/api/logs` were transport-fail), leaving wins/defeats/resource trends unresolved.
- Decision: Implement in next 30-min dev cycle; promote if mixed-readpath cycles drop to zero for 6 consecutive hourly runs.

- Date: 2026-03-15 18:27 KST
- Hypothesis: `economy_guard_v2` (buy-share + net-trade gating) will reduce consumable overspend without harming hunt throughput when combat outcomes are already stable.
- Change: In hourly feedback path, emit deterministic economy KPIs (`buy_share`, `net_trade`, `potion_spend_per_hunt`) and apply a one-cycle buy cooldown when `buy_share > 18% && net_trade < -800`.
- Metric(s): `buy_share/hour`, `net_trade/hour`, `hunt_count/hour`, and `defeats/hour` before/after guard.
- Result: Current live hour was high-throughput (`hunt=242`, `wins=242`, `defeats=0`) but showed spend-heavy drift (`buy=74`, `sell=4`, `net_trade=-1200G`, `buy_share=19.7%`).
- Decision: Run in next 30-min dev cycle; promote if `buy_share` stays `<15%` for 4 consecutive hourly windows without hunt regression.

- Date: 2026-03-15 21:26 KST
- Hypothesis: A single-client `telemetry_preflight_v1` (`/api/status` + `/api/logs?limit=1`, shared transport stack) will reduce mixed-signal hourly cycles (`status=200` vs direct `fetch failed`) and prevent zero-evidence gameplay feedback.
- Change: Add preflight classifier (`readpath_state=ok|status_only|transport_fail|auth_fail`) and block gameplay synthesis unless `ok`; include bounded retry guidance in OPS output.
- Metric(s): `mixed_readpath_cycles/day`, `% hourly cycles blocked with explicit root-cause tag`, false gameplay-inference count during transport failures.
- Result: This cycle reproduced split read-path behavior (`activity:fetch` saw `/api/status=200` while direct `/api/status` and `/api/logs` failed with transport `fetch failed`; recent endpoints stayed `404`).
- Decision: Run in next 30-min dev cycle; promote if mixed-readpath cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-15 22:26 KST
- Hypothesis: A unified DNS+readpath preflight (`/api/status` + `/api/logs?limit=1` on the same client stack) will reduce mixed-signal hourly cycles and prevent zero-evidence gameplay feedback during resolver instability.
- Change: Add `telemetry-preflight-dns-v1` that emits `dns_state` (`ok|dns_unreachable`) and `readpath_state` (`ok|status_only|transport_fail|auth_fail`), and blocks hourly synthesis unless both indicate `ok`.
- Metric(s): `mixed_readpath_cycles/day`, `% cycles blocked with explicit DNS/readpath root-cause`, and false gameplay-inference count during DNS failures.
- Result: Current cycle reproduced split behavior (`activity:fetch /api/status=200` while direct authenticated status/log probes failed with DNS resolution error).
- Decision: Run in next 30-min dev cycle; promote if 4 consecutive outage cycles are classified deterministically with zero gameplay inference.

- Date: 2026-03-15 23:26 KST
- Hypothesis: A single-client DNS+readpath preflight with deterministic retry metadata (`retry_after_ms`) will cut repeated low-confidence hourly cycles by classifying transport failures before gameplay synthesis.
- Change: Add `telemetry-preflight-dns-v2` that probes `/api/status` + `/api/logs?limit=1` on the same loader/header path and emits `dns_state`, `readpath_state`, and `inference_allowed`.
- Metric(s): `% hourly cycles blocked with explicit root-cause`, `mixed-readpath cycles/day`, `false gameplay inference count during DNS failures`.
- Result: Current cycle reproduced mismatch (`activity:fetch /api/status=200`) while direct status/log probes failed with `ENOTFOUND webgame-api.berrysoft.kr`; gameplay evidence remained unavailable.
- Decision: Run in next 30-min dev cycle; promote if 4 consecutive outage cycles classify deterministically with zero gameplay inference.

- Date: 2026-03-16 00:28 KST
- Hypothesis: Tightening economy guard trigger to high-churn windows (`buy_share > 25% && net_trade < -1000`) will reduce gold drag without degrading hunt throughput in zero-defeat runs.
- Change: During hourly feedback, emit deterministic `mp_potion_spend_per_hunt` and apply one-cycle buy cooldown when high-churn threshold is hit.
- Metric(s): `buy_share/hour`, `net_trade/hour`, `mp_potion_spend_per_hunt`, `hunt_count/hour`, `defeats/hour`, and `% cycles with gold<340`.
- Result: Current live hour had strong outcomes (`wins=244`, `defeats=0`) with continuing economy drag (`buy=142`, `sell=3`, `buy_share=32.6%`, `net_trade=-1210G`, `Δexp=+74`, `Δgold=+5`).
- Decision: Run in next 30-min dev cycle; promote if `buy_share` falls below `20%` for 3 consecutive hourly windows without hunt-count regression.

- Date: 2026-03-16 01:28 KST
- Hypothesis: Enforcing `auth_preflight_gate_v4` (same-process `/api/status` + `/api/logs?limit=1` with deterministic retry metadata) will prevent zero-evidence hourly gameplay feedback during token drift.
- Change: Add preflight output contract `{auth_state, inference_allowed, retry_after_ms}` and block progression/winloss/resource inference unless `auth_state=ok`.
- Metric(s): `% hourly cycles blocked with explicit auth root-cause`, `false gameplay-inference count under 401`, `time-to-recover after key rotation`.
- Result: Current cycle returned `401` on both `/api/status` and `/api/logs?page=1&limit=200` in the same runtime with `events=0`, so gameplay evidence was unavailable.
- Decision: Run in next 30-min cycle; promote if blocked cycles are explicit and false gameplay inference stays zero for 6 consecutive auth-failure hours.

- Date: 2026-03-16 02:28 KST
- Hypothesis: Enforcing key-source parity checks before hourly probes will eliminate false mixed outcomes (`collector status=200` vs direct `401`) and reduce blocked-feedback cycles.
- Change: Add `auth-readpath-parity-check-v1` to compare same-process key load + shared header client across `/api/status` and `/api/logs?limit=1`; block synthesis unless both return `200`.
- Metric(s): `% hourly cycles blocked by auth/readpath mismatch`, `mixed-signal cycles/day`, `time-to-recover after key rotate/rebind`.
- Result: Current cycle reproduced mismatch (direct status/logs both `401`, collector fallback still indicated reachable status), leaving last-hour gameplay KPIs unresolved.
- Decision: Run in next 30-min cycle; promote if mixed-signal auth cycles drop to zero for 6 consecutive hourly runs.

- Date: 2026-03-16 03:27 KST
- Hypothesis: For hourly feedback, forcing a single shared transport client for both collector and direct probes (`/api/status` + `/api/logs?limit=1`) will eliminate split-signal cycles (`status=200` vs transport-fail) and reduce zero-evidence summaries.
- Change: Add `telemetry_preflight_v3` that emits deterministic `{dns_state, readpath_state, inference_allowed, retry_after_ms}` and blocks gameplay synthesis unless `inference_allowed=true`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with explicit root-cause tag`, and false gameplay-inference count during transport failures.
- Result: Current cycle reproduced divergence (`activity:fetch` reported `/api/status=200`, while direct status/log probes both failed with `fetch failed`; recent endpoints remained `404`).
- Decision: Execute in next 30-min dev cycle; promote if split-signal cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-16 04:28 KST
- Hypothesis: Enforcing `auth_readpath_preflight_v5` with a single shared HTTP client fingerprint for both direct probes and collector probes will eliminate contradictory hourly states (`direct 401` vs collector status `200`) and reduce blocked-feedback churn.
- Change: Before hourly synthesis, run same-process paired checks (`/api/status`, `/api/logs?limit=1`) on one canonical header/client path; emit `{auth_state, readpath_state, inference_allowed, client_fingerprint}` and block inference unless both checks are `200`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with explicit auth root-cause`, and `time-to-recover after key rotate/rebind`.
- Result: Current cycle again reproduced mismatch (direct `/api/status` and `/api/logs` both `401`, while `activity:fetch` still observed `/api/status=200` and all `*/recent` were `404`), leaving last-hour gameplay signals unavailable.
- Decision: Execute in next 30-min dev cycle; promote if split cycles drop to zero for 6 consecutive hourly runs.

- Date: 2026-03-16 05:28 KST
- Hypothesis: A single shared-client preflight (`/api/status` + `/api/logs?limit=1`) with deterministic `dns/readpath` states will reduce split-signal hourly cycles (`collector status=200` vs direct transport failure) and prevent zero-evidence gameplay inference.
- Change: Add `telemetry-preflight-shared-client-v1` and block hourly synthesis unless both probes return `200` on the same client/header path.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with explicit root-cause`, false gameplay-inference count during transport/auth failures.
- Result: Current cycle reproduced split signal (`activity:fetch /api/status=200`, direct status/log probes `fetch failed`, recent endpoints `404`) with no reliable last-hour events.
- Decision: Execute in next 30-min dev cycle; promote if split-signal cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-16 06:29 KST
- Hypothesis: Introducing `economy_churn_guard_v2` (`buy_share>30% && net_gold_flow<-1000` within 60m) will reduce gold drain while preserving hunt throughput.
- Change: In next dev cycle, apply one-cycle MP-potion buy cooldown + immediate unequipped-trash sell sweep when trigger fires; keep combat target/area unchanged.
- Metric(s): `net_gold_flow/hour`, `buy_share/hour`, `hunt_count/hour`, `defeat_rate/hour`, `surrender_count/hour`.
- Result: Current hour baseline shows strong throughput but economy drag (`wins=232`, `defeats=8`, `buy=138`, `sell=3`, `net_gold_flow=-1160G`, `events=435`).
- Decision: Run in next 30-min cycle; promote if `net_gold_flow` improves to `>-600G/hour` for 3 consecutive cycles with `hunt_count` not dropping >10%.
- Date: 2026-03-16 10:26 KST
- Hypothesis: A single shared-client telemetry preflight (`/api/status` + `/api/logs?limit=1`) with explicit DNS/readpath state will eliminate split-signal hourly cycles (`status=200` vs direct `ENOTFOUND`) and prevent zero-evidence gameplay summaries.
- Change: Add `telemetry_preflight_shared_client_v2` that outputs `{dns_state, readpath_state, inference_allowed}` and blocks hourly synthesis unless `inference_allowed=true`.
- Metric(s): `split_readpath_cycles/day`, `% cycles blocked with explicit root-cause`, `false gameplay-inference count during transport failures`.
- Result: Current cycle reproduced split behavior (`fetch-activity` path saw `/api/status=200` while direct authenticated probe failed with `ENOTFOUND`; `*/recent` endpoints stayed `404`).
- Decision: Run in next 30-min dev cycle; keep if split-signal cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-16 11:30 KST
- Hypothesis: Applying an explicit low-reserve buy gate (`gold<500`) with HP/MP emergency exceptions will reduce hourly net gold drain without materially hurting hunt throughput.
- Change: Add `economy_reserve_guard_v3` in hourly/live policy path: skip optional potion buys when reserve is low unless `hp_ratio<0.45` or `mp_ratio<0.25`.
- Metric(s): `net_trade/hour`, `buy_count/hour`, `hunt_count/hour`, `surrender/hour`, and `defeat_rate/hour`.
- Result: Current baseline hour (`events=496`) shows strong throughput (`hunt=266`, `wins=266`, `defeats=0`) but persistent economy drag (`buy=154`, `buy_spent=1540G`, `sell_gain=210G`, `net_trade=-1330G`, `gold=389`).
- Decision: Run in next 30-min dev cycle; promote if `net_trade` improves by >=30% for 3 consecutive hourly cycles while `hunt_count` drops <=10%.

- Date: 2026-03-16 12:26 KST
- Hypothesis: Enforcing a shared-client telemetry preflight (`/api/status` + `/api/logs?limit=1`) with deterministic block states will eliminate split-signal hourly cycles (`collector status=200` vs direct transport-fail) and prevent zero-evidence gameplay inference.
- Change: Add `telemetry-preflight-shared-client-v3` output contract `{dns_state, readpath_state, inference_allowed, retry_after_ms}` and hard-block gameplay synthesis unless `inference_allowed=true`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with explicit root-cause`, and `false gameplay-inference count during transport failures`.
- Result: Current cycle reproduced mismatch (direct status/log probes failed with `fetch failed`, while `activity:fetch` still observed `/api/status=200` and all `*/recent` endpoints `404`); trustworthy last-hour events were unavailable.
- Decision: Run in next 30-min dev cycle; keep only if split-signal cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-16 14:28 KST
- Hypothesis: A lightweight `buy_pacing_guard_v1` (1-cycle optional MP-buy skip when `buy/hunt>0.55` and `mp_ratio>=0.9`) will reduce hourly buy churn and protect gold without hurting hunt throughput.
- Change: Add guard in live policy path and record hourly comparison fields `{buy_count, hunt_count, buy_hunt_ratio, gold_snapshot}` before/after.
- Metric(s): `buy_count/hour`, `buy_hunt_ratio`, `hunt_count/hour`, `gold_snapshot_delta`, `defeat_count/hour`.
- Result: Baseline this cycle (`13:28~14:27 KST`) shows healthy outcomes (`hunt=264`, `wins≈264`, `defeats=0`) but elevated buy churn (`buy=160`, `buy/hunt≈0.61`, `sell=3`, status gold `409`).
- Decision: Run in next 30-min dev cycle; promote if `buy/hunt` drops below `0.45` for 3 consecutive cycles with `hunt_count` drop <=10% and no defeat increase.

- Date: 2026-03-16 15:27 KST
- Hypothesis: A shared fetch wrapper with explicit connect timeout and bounded retry (`10s/30s/60s`) will reduce opaque `fetch failed` hourly cycles and improve deterministic outage classification.
- Change: Add `shared-fetch-with-timeout` for `/api/status` + `/api/logs?limit=1`, emit `tmp/hourly-preflight.json` (`dns_state`, `readpath_state`, `retry_after_ms`, `inference_allowed`), and hard-block gameplay inference unless both probes return `200`.
- Metric(s): `% blocked cycles with explicit failure class`, `opaque transport-failure count`, `false gameplay-inference count during transport outages`.
- Result: Current cycle failed both live probes at transport (`TypeError: fetch failed`) with zero reliable last-hour evidence.
- Decision: Run in next 30-min dev cycle; keep if 4 consecutive transport-failure cycles are classified deterministically with zero gameplay inference.

- Date: 2026-03-16 16:26 KST
- Hypothesis: Enforcing credential-source parity (same env loader + same auth header path) for hourly probes will eliminate recurring split-auth cycles (`direct 401` vs collector `/api/status=200`) and reduce blocked feedback runs.
- Change: Add `auth-preflight-source-parity-v1` that probes `/api/status` + `/api/logs?limit=1`, records `{auth_state, header_path, inference_allowed, retry_after_ms}`, and blocks synthesis unless both probes succeed on identical auth path.
- Metric(s): `split_auth_cycles/day`, `% blocked cycles with explicit auth root-cause`, `false gameplay-inference count during 401 windows`.
- Result: Current cycle had direct `/api/status` and `/api/logs` both `401 UNAUTHORIZED` while collector path still reported `/api/status=200` and recent endpoints `404`, leaving last-hour gameplay evidence unavailable.
- Decision: Run in next 30-min dev cycle; keep if split-auth cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-16 17:28 KST
- Hypothesis: For hourly feedback, forcing both collector and direct probes through one shared HTTP client + DNS preflight will collapse split-signal cycles (`collector /api/status=200` vs direct DNS failure) and reduce zero-evidence summaries.
- Change: Add `telemetry-preflight-shared-client-v4` to probe `/api/status` and `/api/logs?limit=1` with deterministic output `{dns_state, readpath_state, inference_allowed, retry_after_ms}`; hard-block gameplay inference unless `inference_allowed=true`.
- Metric(s): `split_readpath_cycles/day`, `% blocked cycles with explicit root-cause`, false gameplay-inference count during DNS failures.
- Result: Current cycle had `activity:fetch` fallback with zero KPIs and direct authenticated probes failing DNS on both `/api/status` and `/api/logs`.
- Decision: Run in next 30-min dev cycle; keep only if split-signal cycles drop to zero for 4 consecutive hourly runs.


- Date: 2026-03-16 18:26 KST
- Hypothesis: `preflight-auth-parity-v2` (shared client + shared env loader + paired `/api/status`/`/api/logs?limit=1` gate) will eliminate split-signal hourly cycles and reduce blocked low-confidence summaries.
- Change: Add deterministic preflight artifact `tmp/hourly-preflight.json` with `{auth_state, endpoint_pair_ok, inference_allowed, retry_after_ms}` and block KPI synthesis when `endpoint_pair_ok=false`.
- Metric(s): `split_auth_cycles/day`, `% cycles blocked with explicit auth root-cause`, false gameplay-inference count during `401` windows.
- Result: Current cycle reproduced mismatch (`activity:fetch` observed `/api/status=200` with recent endpoints `404`; direct authenticated status/log probes both `401`).
- Decision: Run in next 30-min dev cycle; keep only if split-auth cycles are zero for 4 consecutive hourly runs.

- Date: 2026-03-16 19:30 KST
- Hypothesis: Canonical hourly pagination (`/api/logs?page=N&limit=100`) plus 60-minute cutoff aggregation will produce stable, non-fallback gameplay KPIs and reduce blocked/zero-signal hourly summaries.
- Change: Add `hourly-log-pagination-v1` collector path (max 20 pages, stop on cutoff breach), write `tmp/hourly-window-metrics.json`, and compute `{wins, defeats, buy_hunt_ratio, avg_turns, avg_dmg, avg_hit}` directly from logs.
- Metric(s): `% hourly cycles with live KPI synthesis`, `fallback:local_replay rate`, `schema/input failures per day`, and `buy_hunt_ratio` trend.
- Result: This cycle confirmed live-read viability (`/api/status=200`, paginated logs produced 462 entries in 60m) while showing schema mismatch on `limit=200` (`400 INVALID_INPUT`) and persistent high buy churn (`buy/hunt=0.55`) despite `defeats=0`.
- Decision: Run in next 30-min dev cycle; keep only if live KPI synthesis succeeds for 4 consecutive hourly runs and schema/input failures drop to zero.

- Date: 2026-03-16 21:28 KST
- Hypothesis: `optional_mp_buy_cooldown_v2` (1-cycle optional MP buy skip when `buy/hunt>0.50` and `mp_ratio>=0.95`) will reduce economy churn without lowering hunt throughput.
- Change: Add guard in live policy path and emit hourly comparison fields `{buy_count, hunt_count, buy_hunt_ratio, gold_snapshot, rest_count}`.
- Metric(s): `buy_count/hour`, `buy_hunt_ratio`, `hunt_count/hour`, `gold_snapshot_delta`, `defeat_count/hour`.
- Result: Baseline this cycle (`20:27:46~21:27:44 KST`, `events=453`) shows strong stability (`hunt=270`, `defeats=0`) but persistent buy-heavy loop (`buy=144`, `buy/hunt≈0.53`, `sell=2`, status gold `414`).
- Decision: Run in next 30-min dev cycle; promote if `buy_hunt_ratio<0.45` for 3 consecutive hourly cycles while `hunt_count` drop stays `<=10%` and `defeats=0`.

- Date: 2026-03-16 22:28 KST
- Hypothesis: Enforcing strict hourly auth-source parity (`/api/status` + `/api/logs?limit=1` on the identical client/header path) will eliminate split-signal cycles (`direct 401` vs collector `/api/status=200`) and reduce blocked low-confidence feedback.
- Change: Add `hourly-auth-parity-preflight-v3` contract `tmp/hourly-preflight.json` with `{auth_state, endpoint_pair_ok, inference_allowed, retry_after_ms}` and block KPI synthesis unless `endpoint_pair_ok=true`.
- Metric(s): `split_auth_cycles/day`, `% blocked cycles with explicit auth root-cause`, and false gameplay-inference count during `401` windows.
- Result: Current cycle reproduced mismatch: direct authenticated probes (`/api/status`, `/api/logs?page=1&limit=100`) both returned `401`, while `activity:fetch` still reported `/api/status=200` and `*/recent=404` with fallback zero KPIs.
- Decision: Run in next 30-min dev cycle; keep only if split-auth cycles drop to zero for 4 consecutive hourly cycles.


- Date: 2026-03-16 23:29 KST
- Hypothesis: Explicitly persisting paired auth probe results (`status` + `logs`) with bounded retry metadata will shorten recovery from recurring `401` cycles and reduce repeated low-confidence hourly summaries.
- Change: Add `auth_preflight_retry_v1` output contract (`tmp/hourly-auth-preflight.json`) with deterministic fields for retry gating.
- Metric(s): `time-to-first-200` after failure, `% hourly cycles blocked with explicit auth_state`, `% cycles with blocked inference but missing failure reason`.
- Result: Current cycle returned `401` on both direct probes (`/api/status`, `/api/logs?page=1&limit=100`) with zero in-window events.
- Decision: Implement in next 30-min dev cycle; promote if two consecutive cycles report deterministic auth classification.

- Date: 2026-03-17 00:26 KST
- Hypothesis: `buy-pressure-guard-v1` (skip optional buy for one cycle when `buy/hunt>0.50` and `mp_ratio>=0.95`) will reduce economy churn without reducing hunt throughput.
- Change: Add conditional optional-buy suppression and emit hourly metrics `{buy,hunt,buy_hunt_ratio,gold_snapshot,sell,drop,surrender}`.
- Metric(s): `buy_count/hour`, `buy_hunt_ratio`, `hunt_count/hour`, `gold_snapshot_delta`, `death_count/hour`.
- Result: Baseline this cycle (`23:26~00:26 KST`) is stable but buy-heavy: `hunt=332`, `death=0`, `buy=181`, `sell=3`, `drop=29`, `surrender=26`, `buy/hunt≈0.55`, status gold `434`.
- Decision: Run in next 30-min dev cycle; promote only if `buy_hunt_ratio<0.45` for 3 consecutive hourly cycles with `hunt_count` drop `<=10%` and `death=0`.


- Date: 2026-03-17 01:28 KST
- Hypothesis: A single shared auth adapter used by both collector probes and canonical hourly status/log fetches will eliminate split-signal cycles (`probe ok` + `canonical 401`) and reduce blocked feedback windows.
- Change: Add `auth-preflight-parity-v4` (same header/client for `/api/status` and `/api/logs?limit=1`) and gate KPI synthesis on `endpoint_pair_ok=true`.
- Metric(s): `split_auth_cycles/day`, `% hourly cycles blocked by auth`, and `% blocked cycles missing explicit failure classification`.
- Result: Baseline this cycle shows direct canonical probes both `401` while probe summary still marks `/api/status` path `ok`; no trustworthy last-hour gameplay KPIs.
- Decision: Run in next 30-min dev cycle; keep only if split-auth cycles drop to zero for 4 consecutive hourly runs.

- Date: 2026-03-17 02:28 KST
- Hypothesis: Persisting a bounded retry budget alongside paired canonical auth probes (`/api/status`, `/api/logs?limit=1`) will reduce repeated blocked hourly cycles and speed deterministic recovery from recurring `401` windows.
- Change: Add `hourly-auth-retry-budget-v1` output (`tmp/hourly-auth-preflight.json`) with `{status_code_status,status_code_logs,status_code_recent,auth_state,inference_allowed,next_retry_ms}` and enforce hard-block when `auth_state!=ok`.
- Metric(s): `blocked_hourly_cycles/day`, `mean_retries_to_first_200`, `% blocked cycles with complete failure classification`.
- Result: Current cycle returned `/api/status=401`, `/api/logs=401`, `/api/logs/recent=404`; no trustworthy last-hour gameplay KPIs were derivable.
- Decision: Run in next 30-min dev cycle; keep only if blocked cycles include complete classification for 3 consecutive hours and first-success retry count trends down.

- Date: 2026-03-17 03:27 KST
- Hypothesis: Enforcing a hard auth preflight gate (`/api/status` + `/api/logs?limit=1`) before hourly aggregation will reduce repeated low-confidence feedback cycles during recurring `401` windows.
- Change: Add `auth-preflight-gate-v1` artifact `tmp/hourly-auth-preflight.json` with `{status_code_status,status_code_logs,auth_state,inference_allowed,retry_after_ms}` and skip KPI synthesis unless both probes are `200`.
- Metric(s): `blocked_hourly_cycles/day`, `% blocked cycles with explicit failure classification`, `false KPI summaries during auth failure`.
- Result: Baseline this cycle shows paired canonical auth failure (`/api/status=401`, `/api/logs=401`) with no trustworthy last-hour gameplay evidence.
- Decision: Run in next 30-min dev cycle; keep only if blocked cycles remain fully classified for 3 consecutive hourly runs.

- Date: 2026-03-17 04:27 KST
- Hypothesis: Enforcing `hourly-auth-failfast-v1` (paired auth preflight + recent-endpoint status persisted per cycle) will reduce repeated low-confidence gameplay summaries during `401/404` windows.
- Change: Persist `tmp/hourly-auth-preflight.json` with `{status_code_status,status_code_logs,status_code_recent,auth_state,inference_allowed,retry_after_ms}` and skip KPI synthesis unless `status=200 && logs=200`.
- Metric(s): `blocked_hourly_cycles/day`, `% blocked cycles with explicit failure classification`, `false gameplay inferences during auth-blocked windows`.
- Result: Baseline this cycle remained blocked (`/api/status=401`, `/api/logs=401`, `/api/logs/recent=404`; `events_in_window=0`).
- Decision: Run in next 30-min dev cycle; keep only if failure classification remains complete for 3 consecutive hourly cycles and false inference count stays zero.

- Date: 2026-03-17 05:28 KST
- Hypothesis: Enforcing `hourly-preflight-parity-v5` (probe+direct status parity + direct logs auth check) will reduce false-confidence hourly feedback during mixed `200/401` endpoint windows.
- Change: Persist `tmp/hourly-auth-preflight.json` with `{status_probe_code,status_direct_code,logs_direct_code,auth_state,inference_allowed,retry_after_ms}` and block KPI synthesis unless direct canonical preflight is fully green.
- Metric(s): `parity_mismatch_cycles/day`, `% blocked cycles with explicit auth_state`, `false gameplay-inference count during auth anomalies`.
- Result: Baseline this cycle remained inconsistent (`fetch-activity /status=200` probe path, direct `/api/status=401`, direct `/api/logs=401`, no trustworthy in-window events).
- Decision: Execute in next 30-min dev cycle; keep only if parity mismatches drop for 3 consecutive hourly runs.

- Date: 2026-03-17 06:28 KST
- Hypothesis: Adding an explicit hourly liveness metric (`minutes_since_last_log`) and activity-gap flag will catch silent-runner stalls earlier than KPI-only summaries when status is healthy but gameplay logs stop.
- Change: Implement `hourly-liveness-check-v1` to persist `tmp/hourly-liveness.json` with `{last_log_ts,minutes_since_last_log,status_code_status,status_code_logs,status_code_recent,activity_gap_detected}` and to force fallback windowing via paginated `/api/logs` when `/api/logs/recent` is `404`.
- Metric(s): `activity_gap_cycles/day`, `mean_minutes_to_detect_stall`, `% hourly cycles with complete endpoint+liveness classification`.
- Result: Baseline this cycle had `/api/status=200`, `/api/logs=200`, `/api/logs/recent=404`, and `events_in_window=0` for 05:26~06:26 KST (no last-hour progression evidence).
- Decision: Run in next 30-min dev cycle; keep only if activity-gap cycles become explicitly classified for 3 consecutive hourly runs.

- Date: 2026-03-17 08:26 KST
- Hypothesis: A DNS-first fail-fast preflight with staged retry metadata will reduce repeated zero-evidence hourly cycles and speed outage triage when Buju host resolution fails.
- Change: Before hourly synthesis, run canonical probes (`/api/status`, `/api/logs?page=1&limit=100`) and persist `tmp/hourly-preflight.json` with `{dns_state,status_probe,logs_probe,inference_allowed,retry_after_ms}`; block gameplay inference unless `inference_allowed=true`.
- Metric(s): `% blocked cycles with explicit dns_state`, `time-to-first-successful-probe after outage`, `false gameplay inference count during DNS failures`.
- Result: Current cycle failed both probes with host-resolution error (`nodename nor servname provided, or not known`); last-hour events were unavailable (`window_events=0`).
- Decision: Run in next 30-min dev cycle; keep if 3 consecutive outage cycles are classified deterministically with zero gameplay-policy output.

- Date: 2026-03-17 11:26 KST
- Hypothesis: A dedicated DNS fail-fast preflight (`status+logs` on canonical host) with persisted retry budget will reduce false/empty hourly gameplay summaries during resolver outages.
- Change: Add `hourly-dns-preflight-v1` artifact `tmp/hourly-preflight.json` with `{dns_state,status_probe,logs_probe,inference_allowed,retry_after_ms}` and block gameplay synthesis unless `dns_state=ok && status_probe=200 && logs_probe=200`.
- Metric(s): `% blocked cycles with explicit dns_state`, `false gameplay-policy outputs during DNS failures`, `mean cycles-to-first-successful-probe`.
- Result: Current cycle failed both canonical probes with host-resolution error (`nodename nor servname provided, or not known`); last-hour gameplay evidence unavailable.
- Decision: Run in next 30-min dev cycle; keep if 3 consecutive outage cycles are classified deterministically with zero gameplay-policy output.

- Date: 2026-03-17 12:28 KST
- Hypothesis: Enforcing a canonical DNS/parity gate before hourly KPI synthesis will eliminate false-confidence summaries produced when probe path is healthy (`/api/status=200`) but canonical host reads fail (`ENOTFOUND`).
- Change: Add `canonical-dns-parity-gate-v1` that persists `tmp/hourly-preflight.json` with `{base_url,dns_state,status_code_status,status_code_logs,status_code_recent,probe_status_code,inference_allowed,retry_after_ms}`; block inference unless canonical `status=200 && logs=200` and parity check passes.
- Metric(s): `parity_mismatch_cycles/day`, `% blocked cycles with explicit dns_state`, `false gameplay-inference count during DNS failures`.
- Result: Baseline this cycle: canonical `status/logs/recent` all failed with `ENOTFOUND www.buju.quest`, while `activity:fetch` still reported probe `/api/status=200` and `*/recent=404`.
- Decision: Run in next 30-min dev cycle; keep only if false-confidence summaries drop to zero for 3 consecutive hourly cycles.


- Date: 2026-03-17 13:26 KST
- Hypothesis: A fail-fast shared-client preflight with explicit transport classification (`dns_unreachable|network_unreachable|timeout`) will reduce repeated zero-evidence hourly cycles during `fetch failed` windows.
- Change: Before hourly gameplay synthesis, probe `/api/status` and `/api/logs?limit=1` with 10s timeout and persist `tmp/hourly-preflight.json`; block inference unless both probes return `200`.
- Metric(s): `% blocked cycles with explicit failure class`, `false gameplay inference count during transport failures`, `time-to-retry-guidance generation`.
- Result: Current cycle failed transport before any HTTP response (`statusCode=null`, `logsCode=null`, `events=0`).
- Decision: Run in next 30-min dev cycle; keep if 3 consecutive failures are explicitly classified with zero gameplay-policy output.

- Date: 2026-03-17 14:27 KST
- Hypothesis: A strict optional-MP-buy gate (`buy/hunt > 0.55 && mp_ratio >= 0.95`) will reduce economy churn without harming hunt throughput in stable zero-death windows.
- Change: In the next 30-min cycle, emit hourly `buy_hunt_ratio` + `net_trade` KPIs and skip optional MP buys for one cycle when trigger is met.
- Metric(s): `buy_hunt_ratio/hour`, `net_trade/hour`, `hunt_count/hour`, `death_count/hour`.
- Result: Baseline this cycle (`13:27~14:27 KST`) from live logs: `hunt=57`, `buy=34`, `sell=1`, `death=0` (`buy/hunt=0.60`) with status `Lv26`, `EXP=5451`, `gold=439`.
- Decision: Run in next 30-min dev cycle; keep if `buy_hunt_ratio <= 0.45` for 3 consecutive windows with hunt drop <=10% and `death=0`.

- Date: 2026-03-17 15:27 KST
- Hypothesis: A resolver-aware canonical parity preflight (DNS classification + probe/canonical comparison) will reduce false-confidence hourly summaries during host-resolution outages.
- Change: Add `dns-parity-preflight-v2` before hourly synthesis; write `tmp/hourly-preflight.json` with `{dns_state,status_code_status,status_code_logs,probe_status_code,inference_allowed,retry_after_ms}` and block KPI inference unless canonical `status=200 && logs=200` in the same run.
- Metric(s): `parity_mismatch_cycles/day`, `% blocked cycles with explicit dns_state`, `false gameplay-inference outputs during DNS outage`.
- Result: Baseline this cycle: canonical `/api/status` + `/api/logs` both `http=000` (`Could not resolve host: www.buju.quest`) while `activity:fetch` still reported probe `/api/status=200` and `*/recent=404`.
- Decision: Run in next 30-min dev cycle; keep if false-confidence summaries remain zero for 3 consecutive outage windows.

- Date: 2026-03-17 16:28 KST
- Hypothesis: A single shared-client canonical preflight (`/api/status` + `/api/logs`) with explicit transport-state labeling will remove false-confidence fallback summaries when canonical reads fail but probe `/api/status` still reports `200`.
- Change: Add `hourly-canonical-preflight-v3` that persists `tmp/hourly-preflight.json` `{dns_state,transport_state,status_code_status,status_code_logs,probe_status_code,inference_allowed,retry_after_ms}` and blocks hourly gameplay inference unless canonical `status=200 && logs=200` in the same run.
- Metric(s): `parity_mismatch_cycles/day`, `% blocked cycles with explicit transport_state`, `false gameplay-inference outputs during canonical transport failure`.
- Result: Baseline this cycle (`16:28 KST`) canonical `status/logs` both failed at transport (`fetch failed`, no HTTP), while `activity:fetch` still reported probe `/api/status=200` and all `*/recent=404` with `source=fallback:local_replay`.
- Decision: Run in next 30-min dev cycle; keep if false-confidence summaries remain zero for 3 consecutive outage windows.

- Date: 2026-03-17 18:27 KST
- Hypothesis: A strict canonical auth fail-fast gate (`/api/status` + `/api/logs?page=1&limit=100`) will eliminate low-confidence hourly gameplay feedback during recurring `401` windows.
- Change: Emit `tmp/hourly-auth-preflight.json` with `{status_code_status,status_code_logs,status_code_recent,auth_state,inference_allowed,retry_after_ms}` and hard-block KPI synthesis unless `inference_allowed=true`.
- Metric(s): `% blocked cycles with explicit auth_state`, `false gameplay-policy outputs during auth failure`, `time-to-first dual-200 after key-path fix`.
- Result: Current live probes were auth-blocked (`status=401`, `logs=401`, `recent=404`, `events_in_last_hour=0`), so progression/outcome/resource signals were unresolved.
- Decision: Run in next 30-min dev cycle; keep if 3 consecutive auth-failure cycles are fully classified with zero gameplay-policy output.

- Date: 2026-03-17 22:29 KST
- Hypothesis: A canonical auth-parity preflight that validates the same key/header path used by hourly probes will reduce repeated `401` blocked cycles and prevent fallback-only gameplay summaries.
- Change: Add/verify `hourly-auth-parity-preflight-v2` to write `tmp/hourly-auth-preflight.json` with `{status_code_status,status_code_logs,auth_state,inference_allowed,retry_after_ms}` and block synthesis unless dual `200` is observed in the same run.
- Metric(s): `% hourly cycles classified as auth_blocked_401`, `false gameplay-inference outputs during 401 windows`, `time-to-first dual-200 after auth-path fix`.
- Result: Baseline this cycle: canonical `GET /api/status=401`, `GET /api/logs?page=1&limit=100=401`, `events_last_hour=0` from blocked canonical window (`tmp/hourly-live-signal-latest.json`).
- Decision: Run in next 30-min dev cycle; keep only if 3 consecutive blocked cycles are explicitly classified with zero gameplay-policy output.

- Date: 2026-03-17 23:31 KST
- Hypothesis: Reducing optional MP purchases during high-surrender windows will lower economy drag without increasing death risk.
- Change: For next 30-min cycle, block optional MP buy when `buy_hunt_ratio > 0.50` and `current_mp/max_mp >= 0.95`; keep mandatory HP recovery unchanged.
- Metric(s): `buy_hunt_ratio`, `surrender_rate`, `death_count`, `gold_delta_per_30m`.
- Result (baseline): last hour `hunt=323`, `buy=175` (`buy/hunt=0.54`), `surrender=52`, inferred `deaths=0`, close snapshot `gold=429`.
- Decision: Run immediately; keep only if `buy_hunt_ratio <= 0.45` and `death_count=0` for two consecutive 30-min windows.

- Date: 2026-03-18 00:29 KST
- Hypothesis: Adding a surrender-aware optional-MP-buy guard will reduce economy drag (`buy/hunt`) without increasing defeat risk during high-throughput skeleton farming.
- Change: In the next 30-min cycle, emit `surrender_rate` + `buy_hunt_ratio` per cycle and skip optional MP buys when `buy_hunt_ratio > 0.50 && mp_ratio >= 0.95`; keep HP recovery and surrender safety guards unchanged.
- Metric(s): `buy_hunt_ratio`, `surrender_rate`, `gold_delta_per_30m`, `defeat_count`.
- Result (baseline): last 60m had `hunt=365`, `buy=190` (`buy/hunt=0.52`), `surrender=66` (`9.5%`), inferred `defeats=0`, `Δgold=+10`, `Δexp=+716`.
- Decision: Run in next 30-min cycle; keep only if `buy_hunt_ratio <= 0.45` with `defeat_count=0` for two consecutive windows.

- Date: 2026-03-18 01:29 KST
- Hypothesis: Explicit confidence-gating from recent-endpoint health will prevent false "flat gameplay" interpretations during fallback-only windows.
- Change: Add `recent-endpoint-health-gate-v1` that records `{status_ok,recent_ok_count,recent_total,source,kpi_confidence}` and tags hourly summaries `kpi_confidence=low` when all recent endpoints are non-200.
- Metric(s): `low_confidence_cycles/day`, `false flat-activity summaries/day`, `time-to-recovery after first recent-endpoint 200`.
- Result: Current cycle had `/api/status=200` with all six recent endpoints `404`; payload returned `source=fallback:local_replay` and zero deltas/outcomes.
- Decision: Run in next 30-min cycle; keep only if low-confidence tagging captures 100% of fallback-only cycles for 3 consecutive hours.

- Date: 2026-03-18 03:30 KST
- Hypothesis: A single-source auth preflight artifact consumed by both hourly feedback and runner startup will reduce repeated `401` cycles caused by key/header path drift.
- Change: Implement `hourly-auth-check-v1` to persist `tmp/hourly-auth-check.json` `{status_code_status,status_code_logs,status_code_recent,auth_state,inference_allowed,retry_after_ms}` and require `inference_allowed=true` before KPI summary rendering.
- Metric(s): `% hourly cycles blocked with explicit auth_state`, `time-to-first dual-200 after key-path fix`, `false gameplay summaries during 401 windows`.
- Result: Current live probes were `status=401`, `logs=401`, `recent=404`; no evidence-grade last-hour gameplay payload available.
- Decision: Run in next 30-min dev cycle; keep if blocked cycles are fully classified for 3 consecutive runs and no fallback-only KPI text is emitted.
