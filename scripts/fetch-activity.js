import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeReplayRecords } from '../src/ops/replay-analyzer.js';

const DEFAULT_BASE_URL = 'https://bujuagent.com';
const DEFAULT_LOG_FILE = path.resolve('logs/worker-events.jsonl');
const DEFAULT_HOURS = 1;
const DEFAULT_TIMEOUT_MS = 3_500;
const DEFAULT_PROGRESS_DELTA = Object.freeze({
  level: 0,
  exp: 0,
  gold: 0
});
const DEFAULT_ACTION_STATUS_COUNTS = Object.freeze({
  success: 0,
  failed: 0,
  skipped: 0
});
const DEFAULT_KNOWN_OUTCOMES = Object.freeze({
  win: 0,
  defeat: 0,
  unknown: 0
});
const CANDIDATE_ENDPOINTS = Object.freeze([
  '/api/activity/recent?hours=1',
  '/api/activity/recent?window=1h',
  '/api/logs/recent?hours=1',
  '/api/logs/recent?window=1h',
  '/api/battle/logs/recent?hours=1',
  '/api/battle/logs/recent?window=1h',
  '/api/status'
]);

function materializeEndpoint(endpointTemplate, hours) {
  if (endpointTemplate.includes('window=1h')) {
    return endpointTemplate.replace('window=1h', `window=${hours}h`);
  }
  if (endpointTemplate.includes('hours=1')) {
    return endpointTemplate.replace('hours=1', `hours=${hours}`);
  }
  return endpointTemplate;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function toPositiveInteger(value, fallback) {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeProgressDelta(raw = {}) {
  const level = toFiniteNumber(raw.level ?? raw.lv ?? raw.levelDelta ?? raw.level_delta);
  const exp = toFiniteNumber(raw.exp ?? raw.experience ?? raw.expDelta ?? raw.exp_delta);
  const gold = toFiniteNumber(raw.gold ?? raw.coins ?? raw.goldDelta ?? raw.gold_delta);
  return {
    level: level ?? 0,
    exp: exp ?? 0,
    gold: gold ?? 0
  };
}

function normalizeActionStatusCounts(raw = {}) {
  const success =
    toFiniteNumber(raw.success ?? raw.succeeded ?? raw.ok ?? raw.passed ?? raw.done) ?? 0;
  const failed =
    toFiniteNumber(raw.failed ?? raw.failure ?? raw.error ?? raw.errors ?? raw.fail) ?? 0;
  const skipped = toFiniteNumber(raw.skipped ?? raw.skip ?? raw.ignored) ?? 0;
  return {
    success,
    failed,
    skipped
  };
}

function detectOutcome(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes('win') || normalized.includes('victory') || normalized.includes('won')) {
    return 'win';
  }
  if (
    normalized.includes('defeat') ||
    normalized.includes('loss') ||
    normalized.includes('lose') ||
    normalized.includes('lost') ||
    normalized.includes('dead')
  ) {
    return 'defeat';
  }
  return null;
}

function normalizeKnownOutcomes(raw = {}, totalActions = 0) {
  const win = toFiniteNumber(raw.win ?? raw.victory ?? raw.wins) ?? 0;
  const defeat = toFiniteNumber(raw.defeat ?? raw.loss ?? raw.losses ?? raw.defeated) ?? 0;
  const unknownRaw = toFiniteNumber(raw.unknown);
  const unknown = unknownRaw ?? Math.max(0, totalActions - win - defeat);
  return {
    win,
    defeat,
    unknown
  };
}

function extractTimestampMs(record) {
  const candidate =
    record?.ts ??
    record?.timestamp ??
    record?.time ??
    record?.createdAt ??
    record?.created_at ??
    record?.at;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function extractProgressSnapshot(record) {
  const candidates = [
    record?.progress,
    record?.status,
    record?.snapshot,
    record?.stateSnapshot,
    record?.state_snapshot,
    record?.player,
    record?.character,
    record?.payload?.stateSnapshot,
    record?.payload?.state_snapshot
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const level = toFiniteNumber(candidate.level ?? candidate.lv);
    const exp = toFiniteNumber(candidate.exp ?? candidate.experience);
    const gold = toFiniteNumber(candidate.gold ?? candidate.coins);
    if (level !== null || exp !== null || gold !== null) {
      return { level, exp, gold };
    }
  }
  return null;
}

function deriveProgressDeltaFromRecords(records) {
  const points = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const tsMs = extractTimestampMs(record);
    if (tsMs === null) {
      continue;
    }
    const progress = extractProgressSnapshot(record);
    if (!progress) {
      continue;
    }
    points.push({ tsMs, index, progress });
  }

  if (points.length < 2) {
    return { ...DEFAULT_PROGRESS_DELTA };
  }

  points.sort((a, b) => a.tsMs - b.tsMs || a.index - b.index);
  const first = points[0].progress;
  const last = points[points.length - 1].progress;

  return {
    level:
      first.level !== null && last.level !== null
        ? last.level - first.level
        : DEFAULT_PROGRESS_DELTA.level,
    exp: first.exp !== null && last.exp !== null ? last.exp - first.exp : DEFAULT_PROGRESS_DELTA.exp,
    gold:
      first.gold !== null && last.gold !== null
        ? last.gold - first.gold
        : DEFAULT_PROGRESS_DELTA.gold
  };
}

function detectActionStatus(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'success' || normalized === 'ok' || normalized === 'succeeded') {
    return 'success';
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'failure') {
    return 'failed';
  }
  if (normalized === 'skipped' || normalized === 'skip' || normalized === 'ignored') {
    return 'skipped';
  }
  return null;
}

function deriveActionAndOutcomeMetrics(records) {
  const actionStatusCounts = { ...DEFAULT_ACTION_STATUS_COUNTS };
  const knownOutcomes = {
    win: 0,
    defeat: 0,
    unknown: 0
  };
  let totalActionSignals = 0;

  for (const record of records) {
    const status = detectActionStatus(
      record?.action_status ??
        record?.actionStatus ??
        record?.status ??
        record?.execution?.status ??
        record?.result?.status ??
        record?.payload?.execution?.status
    );

    if (status) {
      actionStatusCounts[status] += 1;
      totalActionSignals += 1;
    }

    const outcome =
      detectOutcome(
        String(
          record?.outcome ??
            record?.battleOutcome ??
            record?.execution?.outcome ??
            record?.result?.outcome ??
            record?.payload?.execution?.response?.outcome ??
            record?.payload?.outcome ??
            ''
        )
      ) ??
      detectOutcome(
        String(
          record?.result ??
            record?.payload?.execution?.response?.result ??
            record?.payload?.result ??
            ''
        )
      );
    if (outcome === 'win') {
      knownOutcomes.win += 1;
    } else if (outcome === 'defeat') {
      knownOutcomes.defeat += 1;
    }
  }

  knownOutcomes.unknown = Math.max(0, totalActionSignals - knownOutcomes.win - knownOutcomes.defeat);

  return {
    action_status_counts: actionStatusCounts,
    known_outcomes: knownOutcomes
  };
}

function resolveActivityRecords(payload) {
  if (!payload) {
    return null;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (typeof payload !== 'object') {
    return null;
  }

  const directCandidates = [
    payload.activities,
    payload.activity,
    payload.logs,
    payload.events,
    payload.results,
    payload.items,
    payload.data
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const nestedCandidates = [
      payload.data.activities,
      payload.data.activity,
      payload.data.logs,
      payload.data.events,
      payload.data.results,
      payload.data.items
    ];
    for (const candidate of nestedCandidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function hasUsefulSignal(result) {
  if (!result) {
    return false;
  }
  const actionSum =
    result.action_status_counts.success +
    result.action_status_counts.failed +
    result.action_status_counts.skipped;
  const hasOutcomes = result.known_outcomes.win > 0 || result.known_outcomes.defeat > 0;
  const hasProgress =
    result.progress_delta.level !== 0 ||
    result.progress_delta.exp !== 0 ||
    result.progress_delta.gold !== 0;
  return actionSum > 0 || hasOutcomes || hasProgress;
}

function summarizeApiPayload(payload, sinceMs, nowMs) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const directProgressRaw =
    payload.progress_delta ??
    payload.progressDelta ??
    payload.delta ??
    payload.data?.progress_delta ??
    payload.data?.progressDelta ??
    null;
  const directActionRaw =
    payload.action_status_counts ??
    payload.actionStatusCounts ??
    payload.metrics?.action_status_counts ??
    payload.metrics?.actionStatusCounts ??
    payload.data?.action_status_counts ??
    payload.data?.actionStatusCounts ??
    null;
  const directKnownRaw =
    payload.known_outcomes ??
    payload.knownOutcomes ??
    payload.metrics?.known_outcomes ??
    payload.metrics?.knownOutcomes ??
    payload.data?.known_outcomes ??
    payload.data?.knownOutcomes ??
    null;

  if (directProgressRaw || directActionRaw || directKnownRaw) {
    const normalizedAction = normalizeActionStatusCounts(directActionRaw ?? {});
    const actionTotal = normalizedAction.success + normalizedAction.failed + normalizedAction.skipped;
    return {
      progress_delta: normalizeProgressDelta(directProgressRaw ?? {}),
      action_status_counts: normalizedAction,
      known_outcomes: normalizeKnownOutcomes(directKnownRaw ?? {}, actionTotal)
    };
  }

  const activityRecords = resolveActivityRecords(payload);
  if (!activityRecords) {
    return null;
  }

  const filtered = activityRecords.filter((record) => {
    const tsMs = extractTimestampMs(record);
    if (tsMs === null) {
      return true;
    }
    return tsMs >= sinceMs && tsMs <= nowMs;
  });

  const progress_delta = deriveProgressDeltaFromRecords(filtered);
  const metrics = deriveActionAndOutcomeMetrics(filtered);
  return {
    progress_delta,
    action_status_counts: metrics.action_status_counts,
    known_outcomes: metrics.known_outcomes
  };
}

function sanitizeString(value, apiKey) {
  if (typeof value !== 'string') {
    return value;
  }
  if (!apiKey) {
    return value;
  }
  return value.split(apiKey).join('[MASKED]');
}

function sanitizeOutput(value, apiKey) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeString(value, apiKey);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOutput(item, apiKey));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, sanitizeOutput(nestedValue, apiKey)])
  );
}

async function loadDotEnvIfPresent() {
  if (process.env.BUJU_API_KEY) {
    return;
  }
  const envPath = path.resolve('.env');
  let content;
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalIndex).trim();
    if (key !== 'BUJU_API_KEY') {
      continue;
    }
    if (process.env.BUJU_API_KEY) {
      continue;
    }
    const rawValue = line.slice(equalIndex + 1).trim();
    process.env.BUJU_API_KEY = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split('=');

    const readValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        index += 1;
        return next;
      }
      return undefined;
    };

    if (flag === '--skip-api') {
      options.skipApi = true;
      continue;
    }
    if (flag === '--hours') {
      options.hours = readValue();
      continue;
    }
    if (flag === '--base-url') {
      options.baseUrl = readValue();
      continue;
    }
    if (flag === '--log-file') {
      options.logFilePath = readValue();
      continue;
    }
    if (flag === '--timeout-ms') {
      options.timeoutMs = readValue();
      continue;
    }
    if (flag === '--now-ms') {
      options.nowMs = readValue();
      continue;
    }
  }
  return options;
}

function parseReplayJsonlContent(content, sinceMs, nowMs) {
  const filteredRecords = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const tsMs = Date.parse(data?.ts);
    if (Number.isNaN(tsMs)) {
      continue;
    }
    if (tsMs < sinceMs || tsMs > nowMs) {
      continue;
    }
    filteredRecords.push({
      lineNumber: index + 1,
      data
    });
  }
  return filteredRecords;
}

function deriveKnownOutcomesFromReplay(records, actionStatusCounts) {
  let win = 0;
  let defeat = 0;
  for (const entry of records) {
    if (entry.data?.eventType !== 'action_executed') {
      continue;
    }
    const outcome =
      detectOutcome(
        String(entry.data?.payload?.execution?.response?.outcome ?? entry.data?.payload?.outcome ?? '')
      ) ??
      detectOutcome(
        String(entry.data?.payload?.execution?.response?.result ?? entry.data?.payload?.result ?? '')
      );

    if (outcome === 'win') {
      win += 1;
    } else if (outcome === 'defeat') {
      defeat += 1;
    }
  }

  const totalActions = actionStatusCounts.success + actionStatusCounts.failed + actionStatusCounts.skipped;
  return {
    win,
    defeat,
    unknown: Math.max(0, totalActions - win - defeat)
  };
}

function deriveProgressDeltaFromReplay(records) {
  const snapshots = [];
  for (const entry of records) {
    if (entry.data?.eventType !== 'tick_started') {
      continue;
    }
    const tsMs = Date.parse(entry.data?.ts);
    if (Number.isNaN(tsMs)) {
      continue;
    }
    const progress = extractProgressSnapshot(entry.data?.payload ?? {});
    if (!progress) {
      continue;
    }
    snapshots.push({
      tsMs,
      level: progress.level,
      exp: progress.exp,
      gold: progress.gold
    });
  }
  if (snapshots.length < 2) {
    return { ...DEFAULT_PROGRESS_DELTA };
  }

  snapshots.sort((a, b) => a.tsMs - b.tsMs);
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  return {
    level:
      first.level !== null && last.level !== null
        ? last.level - first.level
        : DEFAULT_PROGRESS_DELTA.level,
    exp: first.exp !== null && last.exp !== null ? last.exp - first.exp : DEFAULT_PROGRESS_DELTA.exp,
    gold:
      first.gold !== null && last.gold !== null
        ? last.gold - first.gold
        : DEFAULT_PROGRESS_DELTA.gold
  };
}

async function summarizeFromLocalReplay(logFilePath, sinceMs, nowMs) {
  let content;
  try {
    content = await fs.readFile(logFilePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        progress_delta: { ...DEFAULT_PROGRESS_DELTA },
        action_status_counts: { ...DEFAULT_ACTION_STATUS_COUNTS },
        known_outcomes: { ...DEFAULT_KNOWN_OUTCOMES }
      };
    }
    throw error;
  }

  const records = parseReplayJsonlContent(content, sinceMs, nowMs);
  const replaySummary = analyzeReplayRecords(records);
  const actionStatusCounts = replaySummary.actionStatusCounts ?? { ...DEFAULT_ACTION_STATUS_COUNTS };

  return {
    progress_delta: deriveProgressDeltaFromReplay(records),
    action_status_counts: {
      success: actionStatusCounts.success ?? 0,
      failed: actionStatusCounts.failed ?? 0,
      skipped: actionStatusCounts.skipped ?? 0
    },
    known_outcomes: deriveKnownOutcomesFromReplay(records, actionStatusCounts)
  };
}

async function fetchEndpointJson({ baseUrl, endpoint, apiKey, timeoutMs }) {
  const url = new URL(endpoint, baseUrl).toString();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-GQ-API-Key': apiKey
      },
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return {
      endpoint,
      ok: response.ok,
      http_status: response.status,
      json
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function fetchActivityKpis(options = {}) {
  const nowMs =
    toFiniteNumber(options.nowMs) ??
    Date.now();
  const hours = toPositiveInteger(options.hours, DEFAULT_HOURS);
  const windowMs = hours * 60 * 60 * 1_000;
  const sinceMs = nowMs - windowMs;
  const timeoutMs = toPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const baseUrl = String(options.baseUrl ?? process.env.BUJU_BASE_URL ?? DEFAULT_BASE_URL);
  const apiKey = String(options.apiKey ?? process.env.BUJU_API_KEY ?? '');
  const skipApi = Boolean(options.skipApi);
  const logFilePath = path.resolve(options.logFilePath ?? DEFAULT_LOG_FILE);
  const endpointStatuses = [];

  if (skipApi) {
    for (const endpoint of CANDIDATE_ENDPOINTS) {
      endpointStatuses.push({
        endpoint,
        ok: false,
        status: 'skipped'
      });
    }
  } else if (!apiKey) {
    for (const endpoint of CANDIDATE_ENDPOINTS) {
      endpointStatuses.push({
        endpoint,
        ok: false,
        status: 'missing_api_key'
      });
    }
  } else {
    for (const endpointTemplate of CANDIDATE_ENDPOINTS) {
      const endpoint = materializeEndpoint(endpointTemplate, hours);
      try {
        const response = await fetchEndpointJson({
          baseUrl,
          endpoint,
          apiKey,
          timeoutMs
        });
        endpointStatuses.push({
          endpoint: response.endpoint,
          ok: response.ok,
          http_status: response.http_status
        });

        if (!response.ok) {
          continue;
        }

        const apiSummary = summarizeApiPayload(response.json, sinceMs, nowMs);
        if (apiSummary && hasUsefulSignal(apiSummary)) {
          return sanitizeOutput(
            {
              progress_delta: apiSummary.progress_delta,
              action_status_counts: apiSummary.action_status_counts,
              known_outcomes: apiSummary.known_outcomes,
              source: `api:${response.endpoint}`,
              endpoint_statuses: endpointStatuses
            },
            apiKey
          );
        }
      } catch (error) {
        endpointStatuses.push({
          endpoint,
          ok: false,
          status: sanitizeString(error.message, apiKey)
        });
      }
    }
  }

  const fallbackSummary = await summarizeFromLocalReplay(logFilePath, sinceMs, nowMs);
  return sanitizeOutput(
    {
      progress_delta: fallbackSummary.progress_delta,
      action_status_counts: fallbackSummary.action_status_counts,
      known_outcomes: fallbackSummary.known_outcomes,
      source: 'fallback:local_replay',
      endpoint_statuses: endpointStatuses
    },
    apiKey
  );
}

async function main() {
  await loadDotEnvIfPresent();
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchActivityKpis(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    await main();
  } catch (error) {
    const apiKey = String(process.env.BUJU_API_KEY ?? '');
    const fallback = {
      progress_delta: { ...DEFAULT_PROGRESS_DELTA },
      action_status_counts: { ...DEFAULT_ACTION_STATUS_COUNTS },
      known_outcomes: { ...DEFAULT_KNOWN_OUTCOMES },
      source: 'error',
      endpoint_statuses: []
    };
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
    process.stderr.write(`activity:fetch failed (${sanitizeString(error.message, apiKey)})\n`);
    process.exitCode = 1;
  }
}
