const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  '429',
  '503'
]);

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableError(error) {
  if (!error) {
    return false;
  }
  if (error.retryable === true) {
    return true;
  }
  const code = String(error.code ?? error.status ?? '');
  return RETRYABLE_CODES.has(code);
}

export function createActionExecutor(options = {}) {
  const {
    transport = async () => ({ ok: true }),
    maxAttempts = 3,
    baseDelayMs = 150,
    idempotencyWindowMs = 60_000,
    now = () => Date.now(),
    sleep = defaultSleep
  } = options;

  const executed = new Map();

  function makeActionKey(context) {
    const scope = context.stateSnapshot.battleId ?? 'global';
    const action = context.action;
    return [
      scope,
      context.tickId,
      action.type,
      action.targetId ?? 'none'
    ].join(':');
  }

  function pruneExecuted() {
    const threshold = now() - idempotencyWindowMs;
    for (const [key, ts] of executed.entries()) {
      if (ts < threshold) {
        executed.delete(key);
      }
    }
  }

  return async function executeAction(context) {
    const actionKey = makeActionKey(context);
    pruneExecuted();

    if (executed.has(actionKey)) {
      return {
        status: 'skipped',
        reason: 'idempotent_duplicate',
        actionKey,
        attempts: 0
      };
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await transport(context.action, {
          actionKey,
          tickId: context.tickId
        });
        if (response?.ok === false) {
          const error = new Error(response.errorMessage ?? 'action transport failed');
          error.retryable = Boolean(response.retryable);
          error.code = response.code;
          throw error;
        }

        executed.set(actionKey, now());
        return {
          status: 'success',
          actionKey,
          attempts: attempt,
          response: response ?? { ok: true }
        };
      } catch (error) {
        const retryable = isRetryableError(error);
        if (!retryable || attempt === maxAttempts) {
          return {
            status: 'failed',
            actionKey,
            attempts: attempt,
            retryable,
            error: {
              message: error.message,
              code: error.code ?? null
            }
          };
        }

        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        await sleep(delayMs);
      }
    }

    return {
      status: 'failed',
      actionKey,
      attempts: maxAttempts,
      retryable: false,
      error: { message: 'unknown executor state', code: null }
    };
  };
}
