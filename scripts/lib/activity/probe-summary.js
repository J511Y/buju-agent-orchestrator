import fs from 'node:fs/promises';
import path from 'node:path';

import { toFiniteNumber, toPositiveInteger } from './common.js';
import {
  DEFAULT_ACTIVITY_PROBE_LOG_FILE,
  DEFAULT_ACTIVITY_PROBE_SUMMARY_LOOKBACK_HOURS
} from './constants.js';

const OK_ENDPOINT_STATUSES = new Set(['ok', 'success', 'succeeded']);
const KNOWN_ENDPOINT_STATUSES = new Set(['http_fail', 'network_fail', 'skipped', 'missing_api_key']);

/**
 * Converts heterogeneous endpoint probe entries into compact deterministic status.
 * Unknown statuses collapse into network_fail to avoid leaking arbitrary strings.
 */
function toCompactEndpointStatus(rawEndpointStatus) {
  const status =
    typeof rawEndpointStatus?.status === 'string'
      ? rawEndpointStatus.status.trim().toLowerCase()
      : '';

  if (OK_ENDPOINT_STATUSES.has(status) || rawEndpointStatus?.ok === true) {
    return 'ok';
  }
  if (KNOWN_ENDPOINT_STATUSES.has(status)) {
    return status;
  }
  if (toFiniteNumber(rawEndpointStatus?.http_status) !== null) {
    return 'http_fail';
  }
  return 'network_fail';
}

function toEmptySummary(lookbackHours, generatedAtIso) {
  return {
    lookback_hours: lookbackHours,
    generated_at: generatedAtIso,
    endpoints: []
  };
}

function extractEndpointEvents(content, sinceMs, nowMs) {
  const events = [];
  const lines = content.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const tsMs = Date.parse(record?.ts);
    if (Number.isNaN(tsMs) || tsMs < sinceMs || tsMs > nowMs) {
      continue;
    }

    const endpointItems = record?.endpoint_statuses?.endpoints;
    if (!Array.isArray(endpointItems)) {
      continue;
    }

    for (let endpointIndex = 0; endpointIndex < endpointItems.length; endpointIndex += 1) {
      const endpointItem = endpointItems[endpointIndex];
      const endpoint =
        typeof endpointItem?.endpoint === 'string' ? endpointItem.endpoint.trim() : '';
      if (!endpoint) {
        continue;
      }
      events.push({
        tsMs,
        lineIndex,
        endpointIndex,
        endpoint,
        status: toCompactEndpointStatus(endpointItem)
      });
    }
  }

  events.sort(
    (a, b) =>
      a.tsMs - b.tsMs ||
      a.lineIndex - b.lineIndex ||
      a.endpointIndex - b.endpointIndex ||
      a.endpoint.localeCompare(b.endpoint)
  );
  return events;
}

function summarizeEndpointFailureStreaks(events) {
  const statusByEndpoint = new Map();

  for (const event of events) {
    if (!statusByEndpoint.has(event.endpoint)) {
      statusByEndpoint.set(event.endpoint, []);
    }
    statusByEndpoint.get(event.endpoint).push(event.status);
  }

  const endpoints = [];
  for (const [endpoint, statuses] of statusByEndpoint.entries()) {
    if (statuses.length === 0) {
      continue;
    }
    const lastStatus = statuses[statuses.length - 1];
    let failureStreak = 0;
    for (let index = statuses.length - 1; index >= 0; index -= 1) {
      if (statuses[index] === 'ok') {
        break;
      }
      failureStreak += 1;
    }
    endpoints.push({
      endpoint,
      failure_streak: failureStreak,
      last_status: lastStatus
    });
  }

  endpoints.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  return endpoints;
}

/**
 * Builds deterministic rolling endpoint failure streak summary from probe JSONL.
 */
export async function buildActivityProbeSummary({
  activityProbeLogPath,
  lookbackHours,
  nowMs
} = {}) {
  const resolvedLookbackHours = toPositiveInteger(
    lookbackHours ?? process.env.ACTIVITY_PROBE_SUMMARY_LOOKBACK_HOURS,
    DEFAULT_ACTIVITY_PROBE_SUMMARY_LOOKBACK_HOURS
  );
  const resolvedNowMs = toFiniteNumber(nowMs) ?? Date.now();
  const generatedAtIso = new Date(resolvedNowMs).toISOString();
  const sinceMs = resolvedNowMs - resolvedLookbackHours * 60 * 60 * 1_000;
  const logPath = path.resolve(activityProbeLogPath ?? DEFAULT_ACTIVITY_PROBE_LOG_FILE);

  let content;
  try {
    content = await fs.readFile(logPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return toEmptySummary(resolvedLookbackHours, generatedAtIso);
    }
    return toEmptySummary(resolvedLookbackHours, generatedAtIso);
  }

  const events = extractEndpointEvents(content, sinceMs, resolvedNowMs);
  return {
    lookback_hours: resolvedLookbackHours,
    generated_at: generatedAtIso,
    endpoints: summarizeEndpointFailureStreaks(events)
  };
}
