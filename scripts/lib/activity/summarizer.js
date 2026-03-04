import {
  DEFAULT_ACTION_STATUS_COUNTS,
  DEFAULT_PROGRESS_DELTA
} from './constants.js';
import {
  detectOutcome,
  extractProgressSnapshot,
  extractTimestampMs,
  toFiniteNumber
} from './common.js';

/**
 * Normalize heterogeneous payload shapes into fixed KPI schema.
 */
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

/**
 * Avoids selecting empty/meaningless API payloads as final KPI source.
 */
export function hasUsefulSignal(result) {
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

/**
 * Summarizes API payload into stable KPI structure.
 * @param {unknown} payload
 * @param {number} sinceMs
 * @param {number} nowMs
 */
export function summarizeApiPayload(payload, sinceMs, nowMs) {
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
