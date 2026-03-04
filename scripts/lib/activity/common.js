/**
 * Materializes endpoint templates with requested hour window.
 * @param {string} endpointTemplate
 * @param {number} hours
 * @returns {string}
 */
export function materializeEndpoint(endpointTemplate, hours) {
  if (endpointTemplate.includes('window=1h')) {
    return endpointTemplate.replace('window=1h', `window=${hours}h`);
  }
  if (endpointTemplate.includes('hours=1')) {
    return endpointTemplate.replace('hours=1', `hours=${hours}`);
  }
  return endpointTemplate;
}

/** @param {unknown} value */
export function toFiniteNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function toPositiveInteger(value, fallback) {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * @param {unknown} value
 * @returns {'win' | 'defeat' | null}
 */
export function detectOutcome(value) {
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

/**
 * Extracts a timestamp in epoch milliseconds from heterogeneous record shapes.
 * @param {Record<string, unknown>} record
 * @returns {number | null}
 */
export function extractTimestampMs(record) {
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

/**
 * Normalizes progress snapshot candidates from activity/replay payloads.
 * @param {Record<string, unknown> | null | undefined} record
 */
export function extractProgressSnapshot(record) {
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

/**
 * @param {unknown} value
 * @param {string} apiKey
 */
export function sanitizeString(value, apiKey) {
  if (typeof value !== 'string') {
    return value;
  }
  if (!apiKey) {
    return value;
  }
  return value.split(apiKey).join('[MASKED]');
}

/**
 * Deep-sanitizes strings so API key is never surfaced.
 * @param {unknown} value
 * @param {string} apiKey
 */
export function sanitizeOutput(value, apiKey) {
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
