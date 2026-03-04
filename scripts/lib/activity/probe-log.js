import fs from 'node:fs/promises';
import path from 'node:path';

import { sanitizeOutput, toPositiveInteger } from './common.js';
import { DEFAULT_ACTIVITY_PROBE_LOG_FILE, DEFAULT_ACTIVITY_PROBE_LOG_MAX_BYTES } from './constants.js';

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
 * Picks newest complete JSONL lines that fit within a byte budget.
 * Deterministic rule: scan from file tail, keep full lines only, preserve order.
 * @param {string} content
 * @param {number} maxBytes
 */
function takeNewestJsonlTail(content, maxBytes) {
  if (maxBytes <= 0 || !content) {
    return '';
  }

  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  const selected = [];
  let usedBytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lineWithNewline = `${lines[index]}\n`;
    const lineBytes = Buffer.byteLength(lineWithNewline, 'utf8');
    if (lineBytes > maxBytes) {
      continue;
    }
    if (usedBytes + lineBytes > maxBytes) {
      break;
    }
    selected.push(lineWithNewline);
    usedBytes += lineBytes;
  }

  selected.reverse();
  return selected.join('');
}

/**
 * Enforces deterministic size guard before append so resulting growth is bounded.
 */
async function truncateProbeLogTailForAppend(logPath, maxBytes, incomingLineBytes) {
  const keepBytes = Math.max(0, maxBytes - incomingLineBytes);
  if (keepBytes === 0) {
    await fs.writeFile(logPath, '', 'utf8');
    return;
  }

  const existing = await fs.readFile(logPath, 'utf8');
  const tail = takeNewestJsonlTail(existing, keepBytes);
  await fs.writeFile(logPath, tail, 'utf8');
}

/**
 * Appends one activity probe outcome JSONL record.
 */
export async function appendActivityProbeLog({
  tsMs,
  source,
  endpointStatuses,
  apiKey,
  activityProbeLogPath,
  activityProbeLogMaxBytes
}) {
  const logPath = path.resolve(activityProbeLogPath ?? DEFAULT_ACTIVITY_PROBE_LOG_FILE);
  const maxBytes = toPositiveInteger(
    activityProbeLogMaxBytes ?? process.env.ACTIVITY_PROBE_LOG_MAX_BYTES,
    DEFAULT_ACTIVITY_PROBE_LOG_MAX_BYTES
  );
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const record = sanitizeOutput(
    {
      ts: new Date(tsMs).toISOString(),
      source: String(source),
      endpoint_statuses: summarizeEndpointStatuses(endpointStatuses)
    },
    apiKey
  );
  const recordLine = `${JSON.stringify(record)}\n`;
  const recordLineBytes = Buffer.byteLength(recordLine, 'utf8');

  try {
    const stats = await fs.stat(logPath);
    const nextSizeBytes = stats.size + recordLineBytes;
    if (nextSizeBytes > maxBytes) {
      await truncateProbeLogTailForAppend(logPath, maxBytes, recordLineBytes);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.appendFile(logPath, recordLine, 'utf8');
}
