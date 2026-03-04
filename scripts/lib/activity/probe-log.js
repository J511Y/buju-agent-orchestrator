import fs from 'node:fs/promises';
import path from 'node:path';

import { sanitizeOutput } from './common.js';
import { DEFAULT_ACTIVITY_PROBE_LOG_FILE } from './constants.js';

/**
 * Converts raw endpoint probe item into deterministic compact status.
 * @param {Record<string, unknown>} endpointStatus
 * @returns {{ endpoint: string, status: 'ok' | 'http_fail' | 'network_fail' | 'skipped' | 'missing_api_key', http_status?: number }}
 */
function toCompactEndpointStatus(endpointStatus) {
  const endpoint = String(endpointStatus?.endpoint ?? '');
  const status = String(endpointStatus?.status ?? '');
  const httpStatus = Number(endpointStatus?.http_status);

  if (status === 'skipped') {
    return { endpoint, status: 'skipped' };
  }
  if (status === 'missing_api_key') {
    return { endpoint, status: 'missing_api_key' };
  }
  if (endpointStatus?.ok === true) {
    if (Number.isFinite(httpStatus)) {
      return { endpoint, status: 'ok', http_status: httpStatus };
    }
    return { endpoint, status: 'ok' };
  }
  if (Number.isFinite(httpStatus)) {
    return { endpoint, status: 'http_fail', http_status: httpStatus };
  }
  return { endpoint, status: 'network_fail' };
}

/**
 * Summarizes compact endpoint statuses into deterministic operational counters.
 * @param {Array<Record<string, unknown>>} endpointStatuses
 */
function summarizeEndpointStatuses(endpointStatuses) {
  const summary = {
    total: endpointStatuses.length,
    ok: 0,
    http_fail: 0,
    network_fail: 0,
    skipped: 0,
    missing_api_key: 0
  };
  const endpoints = [];

  for (const item of endpointStatuses) {
    const compact = toCompactEndpointStatus(item);
    endpoints.push(compact);
    summary[compact.status] += 1;
  }

  return {
    ...summary,
    endpoints
  };
}

/**
 * Appends one activity probe outcome JSONL record.
 */
export async function appendActivityProbeLog({
  tsMs,
  source,
  endpointStatuses,
  apiKey,
  activityProbeLogPath
}) {
  const logPath = path.resolve(activityProbeLogPath ?? DEFAULT_ACTIVITY_PROBE_LOG_FILE);
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const record = sanitizeOutput(
    {
      ts: new Date(tsMs).toISOString(),
      source: String(source),
      endpoint_statuses: summarizeEndpointStatuses(endpointStatuses)
    },
    apiKey
  );

  await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}
