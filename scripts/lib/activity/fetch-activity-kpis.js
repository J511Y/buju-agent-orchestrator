import path from 'node:path';

import {
  DEFAULT_ACTION_STATUS_COUNTS,
  DEFAULT_BASE_URL,
  DEFAULT_HOURS,
  DEFAULT_KNOWN_OUTCOMES,
  DEFAULT_LOG_FILE,
  DEFAULT_PROGRESS_DELTA,
  DEFAULT_TIMEOUT_MS
} from './constants.js';
import { sanitizeOutput, toFiniteNumber, toPositiveInteger } from './common.js';
import { probeActivityApi } from './api-client.js';
import { summarizeFromLocalReplay } from './replay-fallback.js';

/**
 * Main service entry for activity KPI retrieval.
 * Strategy: API-first probe -> deterministic local replay fallback.
 */
export async function fetchActivityKpis(options = {}) {
  const nowMs = toFiniteNumber(options.nowMs) ?? Date.now();
  const hours = toPositiveInteger(options.hours, DEFAULT_HOURS);
  const windowMs = hours * 60 * 60 * 1_000;
  const sinceMs = nowMs - windowMs;
  const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const baseUrl = String(options.baseUrl ?? process.env.BUJU_BASE_URL ?? DEFAULT_BASE_URL);
  const apiKey = String(options.apiKey ?? process.env.BUJU_API_KEY ?? '');
  const skipApi = Boolean(options.skipApi);
  const logFilePath = path.resolve(options.logFilePath ?? DEFAULT_LOG_FILE);

  const apiProbe = await probeActivityApi({
    baseUrl,
    hours,
    nowMs,
    sinceMs,
    timeoutMs,
    apiKey,
    skipApi
  });

  if (apiProbe.summary) {
    return sanitizeOutput(
      {
        progress_delta: apiProbe.summary.progress_delta,
        action_status_counts: apiProbe.summary.action_status_counts,
        known_outcomes: apiProbe.summary.known_outcomes,
        source: apiProbe.source,
        endpoint_statuses: apiProbe.endpoint_statuses
      },
      apiKey
    );
  }

  const fallbackSummary = await summarizeFromLocalReplay(logFilePath, sinceMs, nowMs);
  return sanitizeOutput(
    {
      progress_delta: fallbackSummary.progress_delta,
      action_status_counts: fallbackSummary.action_status_counts,
      known_outcomes: fallbackSummary.known_outcomes,
      source: 'fallback:local_replay',
      endpoint_statuses: apiProbe.endpoint_statuses
    },
    apiKey
  );
}

/**
 * Stable fallback payload for CLI error path.
 */
export function makeErrorFallbackPayload() {
  return {
    progress_delta: { ...DEFAULT_PROGRESS_DELTA },
    action_status_counts: { ...DEFAULT_ACTION_STATUS_COUNTS },
    known_outcomes: { ...DEFAULT_KNOWN_OUTCOMES },
    source: 'error',
    endpoint_statuses: []
  };
}
