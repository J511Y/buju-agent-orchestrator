const DEFAULT_FAILED_TICK_STREAK_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;
const CIRCUIT_OPEN_REASON = 'execution_failure_circuit_open';

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toNowMs(nowMs) {
  const parsed = Number(nowMs);
  if (!Number.isFinite(parsed)) {
    return Date.now();
  }
  return Math.floor(parsed);
}

export function createInProcessExecutionFailureCircuitBreaker(options = {}) {
  const failedTickStreakThreshold = toPositiveInteger(
    options.failedTickStreakThreshold,
    DEFAULT_FAILED_TICK_STREAK_THRESHOLD
  );
  const cooldownMs = toNonNegativeInteger(options.cooldownMs, DEFAULT_COOLDOWN_MS);

  let consecutiveFailedExecutions = 0;
  let openUntilMs = null;

  function clearOpenState() {
    openUntilMs = null;
    consecutiveFailedExecutions = 0;
  }

  function evaluate({ nowMs = Date.now() } = {}) {
    const normalizedNowMs = toNowMs(nowMs);
    if (Number.isFinite(openUntilMs)) {
      if (normalizedNowMs >= openUntilMs) {
        clearOpenState();
      } else {
        return {
          allowed: false,
          reason: CIRCUIT_OPEN_REASON,
          cooldownMs,
          failedTickStreakThreshold,
          consecutiveFailedExecutions,
          openUntilMs,
          remainingMs: openUntilMs - normalizedNowMs
        };
      }
    }

    return {
      allowed: true,
      reason: CIRCUIT_OPEN_REASON,
      cooldownMs,
      failedTickStreakThreshold,
      consecutiveFailedExecutions,
      openUntilMs: null,
      remainingMs: 0
    };
  }

  function recordExecutionStatus({ executionStatus, nowMs = Date.now() } = {}) {
    const normalizedNowMs = toNowMs(nowMs);
    const check = evaluate({ nowMs: normalizedNowMs });
    if (!check.allowed) {
      return check;
    }

    if (executionStatus === 'failed') {
      consecutiveFailedExecutions += 1;
      if (consecutiveFailedExecutions >= failedTickStreakThreshold && cooldownMs > 0) {
        openUntilMs = normalizedNowMs + cooldownMs;
      }
    } else {
      consecutiveFailedExecutions = 0;
    }

    return evaluate({ nowMs: normalizedNowMs });
  }

  return {
    reason: CIRCUIT_OPEN_REASON,
    evaluate,
    recordExecutionStatus
  };
}
