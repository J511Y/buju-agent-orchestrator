import path from 'node:path';

/**
 * Activity KPI fetcher default configuration values.
 */
export const DEFAULT_BASE_URL = 'https://bujuagent.com';
export const DEFAULT_LOG_FILE = path.resolve('logs/worker-events.jsonl');
export const DEFAULT_ACTIVITY_PROBE_LOG_FILE = path.resolve('logs/activity-probe.jsonl');
export const DEFAULT_ACTIVITY_PROBE_LOG_MAX_BYTES = 256 * 1024;
export const DEFAULT_ACTIVITY_PROBE_SUMMARY_LOOKBACK_HOURS = 6;
export const DEFAULT_ACTIVITY_ENDPOINTS_CONFIG_PATH = path.resolve('config/activity-endpoints.json');
export const DEFAULT_HOURS = 1;
export const DEFAULT_TIMEOUT_MS = 3_500;

export const DEFAULT_PROGRESS_DELTA = Object.freeze({
  level: 0,
  exp: 0,
  gold: 0
});

export const DEFAULT_ACTION_STATUS_COUNTS = Object.freeze({
  success: 0,
  failed: 0,
  skipped: 0
});

export const DEFAULT_KNOWN_OUTCOMES = Object.freeze({
  win: 0,
  defeat: 0,
  unknown: 0
});

/**
 * Built-in fallback endpoints probed in order for recent-activity KPIs.
 * Used when configured endpoint file is missing or invalid.
 */
export const CANDIDATE_ENDPOINTS = Object.freeze([
  '/api/activity/recent?hours=1',
  '/api/activity/recent?window=1h',
  '/api/logs/recent?hours=1',
  '/api/logs/recent?window=1h',
  '/api/battle/logs/recent?hours=1',
  '/api/battle/logs/recent?window=1h',
  '/api/status'
]);
