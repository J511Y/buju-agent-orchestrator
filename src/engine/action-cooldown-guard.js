const DEFAULT_ACTION_COOLDOWN_MS = 3_000;
const COOLDOWN_REASON = 'action_cooldown_active';

function toActionFingerprint(action) {
  const type = action?.type ?? 'UNKNOWN_ACTION';
  const targetId = action?.targetId ?? 'none';
  return `${type}:${targetId}`;
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function createInProcessActionCooldownGuard(options = {}) {
  const cooldownMs = toNonNegativeInteger(options.cooldownMs, DEFAULT_ACTION_COOLDOWN_MS);
  const lastActionAtByFingerprint = new Map();

  function prune(nowMs) {
    if (cooldownMs <= 0) {
      lastActionAtByFingerprint.clear();
      return;
    }
    const thresholdMs = nowMs - cooldownMs;
    for (const [fingerprint, lastActionAtMs] of lastActionAtByFingerprint.entries()) {
      if (lastActionAtMs <= thresholdMs) {
        lastActionAtByFingerprint.delete(fingerprint);
      }
    }
  }

  function checkAndMark({ action, nowMs = Date.now() }) {
    const actionFingerprint = toActionFingerprint(action);
    const rawNowMs = Number(nowMs);
    const normalizedNowMs = Number.isFinite(rawNowMs) ? Math.floor(rawNowMs) : Date.now();
    prune(normalizedNowMs);

    const lastActionAtMs = lastActionAtByFingerprint.get(actionFingerprint);
    if (Number.isFinite(lastActionAtMs) && cooldownMs > 0) {
      const elapsedMs = Math.max(0, normalizedNowMs - lastActionAtMs);
      if (elapsedMs < cooldownMs) {
        return {
          allowed: false,
          reason: COOLDOWN_REASON,
          actionFingerprint,
          cooldownMs,
          remainingMs: cooldownMs - elapsedMs,
          lastActionAtMs
        };
      }
    }

    lastActionAtByFingerprint.set(actionFingerprint, normalizedNowMs);
    return {
      allowed: true,
      actionFingerprint,
      cooldownMs,
      remainingMs: 0,
      lastActionAtMs: null
    };
  }

  return {
    cooldownMs,
    checkAndMark
  };
}
