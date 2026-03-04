import path from 'node:path';

import { createActionExecutor } from '../client/action-executor.js';
import { createInProcessActionCooldownGuard } from '../engine/action-cooldown-guard.js';
import { createInProcessExecutionFailureCircuitBreaker } from '../engine/execution-failure-circuit-breaker.js';
import { decideAction } from '../engine/fsm-rules.js';
import { evaluateSafetyGates } from '../engine/safety-gates.js';
import { JsonlLogger } from '../ops/jsonl-logger.js';
import { acquireWorkerLoopLock } from './fs-lock.js';

function formatTickId(tickNumber) {
  return `tick-${String(tickNumber).padStart(6, '0')}`;
}

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

function createTickTimeoutError(tickId, tickTimeoutMs) {
  const error = new Error(`tick timeout after ${tickTimeoutMs}ms`);
  error.code = 'ETICK_TIMEOUT';
  error.tickId = tickId;
  return error;
}

async function sleep(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function touchLockWithRetry({
  lock,
  retries,
  retryDelayMs
}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await lock.touch();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

async function runTickWithTimeout({ tickPromise, tickId, tickTimeoutMs }) {
  if (!Number.isFinite(tickTimeoutMs) || tickTimeoutMs <= 0) {
    return tickPromise;
  }

  let timeoutHandle = null;
  const outcome = await Promise.race([
    tickPromise.then(
      (value) => ({ status: 'success', value }),
      (error) => ({ status: 'error', error })
    ),
    new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ status: 'timeout' }), tickTimeoutMs);
    })
  ]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (outcome.status === 'timeout') {
    // Ignore eventual completion/rejection; the loop must move to the next tick.
    tickPromise.catch(() => {});
    throw createTickTimeoutError(tickId, tickTimeoutMs);
  }

  if (outcome.status === 'error') {
    throw outcome.error;
  }

  return outcome.value;
}

function shouldRequireActionTarget(action) {
  if (!action || typeof action !== 'object') {
    return false;
  }
  return !new Set(['WAIT', 'REST']).has(action.type);
}

function defaultStateProvider(tickNumber) {
  return {
    battleId: 'default-battle',
    selfId: 'hero-1',
    enemyId: 'enemy-1',
    enemyVisible: true,
    healthPct: 65,
    energy: 50,
    enemyThreat: tickNumber % 2 === 0 ? 85 : 45,
    pendingActionCount: 0,
    maintenanceMode: false,
    minHealthPct: 30,
    credentials: {
      apiKey: process.env.BUJU_API_KEY ?? 'dev-local-key'
    }
  };
}

async function defaultTransport(action, context) {
  return {
    ok: true,
    remoteActionId: `${context.actionKey}:${action.type}`
  };
}

export async function runDeterministicCycleOnce(options = {}) {
  const {
    tickNumber = 1,
    tickId = formatTickId(tickNumber),
    nowMs = Date.now(),
    actionCooldownMs = Number(process.env.ACTION_COOLDOWN_MS ?? 3_000),
    actionCooldownGuard = createInProcessActionCooldownGuard({ cooldownMs: actionCooldownMs }),
    failureCircuitStreak = Number(process.env.WORKER_FAILURE_CIRCUIT_STREAK ?? 3),
    failureCircuitCooldownMs = Number(process.env.WORKER_FAILURE_CIRCUIT_COOLDOWN_MS ?? 30_000),
    executionFailureCircuitBreaker = createInProcessExecutionFailureCircuitBreaker({
      failedTickStreakThreshold: failureCircuitStreak,
      cooldownMs: failureCircuitCooldownMs
    }),
    stateProvider = defaultStateProvider,
    logger = new JsonlLogger(path.resolve('logs/worker-events.jsonl')),
    executeAction = createActionExecutor({ transport: defaultTransport })
  } = options;

  const stateSnapshot = stateProvider(tickNumber, nowMs);
  const baseSafety = evaluateSafetyGates(stateSnapshot, nowMs);
  const circuitCheck = executionFailureCircuitBreaker.evaluate({ nowMs });
  const safety = {
    ...baseSafety,
    allowed: baseSafety.allowed && circuitCheck.allowed,
    reasons: circuitCheck.allowed ? baseSafety.reasons : [...baseSafety.reasons, circuitCheck.reason],
    circuitBreaker: {
      allowed: circuitCheck.allowed,
      reason: circuitCheck.reason,
      remainingMs: circuitCheck.remainingMs,
      openUntilMs: circuitCheck.openUntilMs,
      failedTickStreakThreshold: circuitCheck.failedTickStreakThreshold,
      consecutiveFailedExecutions: circuitCheck.consecutiveFailedExecutions,
      cooldownMs: circuitCheck.cooldownMs
    }
  };

  await logger.append('tick_started', {
    tickId,
    tickNumber,
    stateSnapshot
  });
  await logger.append('safety_evaluated', {
    tickId,
    safety
  });

  if (!safety.allowed) {
    const blockReason = circuitCheck.allowed ? safety.reasons[0] ?? 'safety_gate_blocked' : circuitCheck.reason;
    const execution = {
      status: 'skipped',
      reason: blockReason,
      blockedBy: circuitCheck.allowed ? 'safety_gate' : 'execution_failure_circuit_breaker',
      attempts: 0
    };
    executionFailureCircuitBreaker.recordExecutionStatus({
      executionStatus: execution.status,
      nowMs
    });
    const blockedResult = {
      tickId,
      blocked: true,
      reasons: safety.reasons,
      safety,
      execution
    };
    await logger.append('tick_blocked', blockedResult);
    await logger.append('tick_finished', {
      tickId,
      executionStatus: execution.status,
      reason: execution.reason,
      blockedBy: execution.blockedBy
    });
    return blockedResult;
  }

  const decision = decideAction(stateSnapshot);
  await logger.append('decision_made', {
    tickId,
    decision
  });

  if (shouldRequireActionTarget(decision.action) && !decision.action?.targetId) {
    const execution = {
      status: 'skipped',
      reason: 'invalid_action_target',
      blockedBy: 'action_target_validation',
      attempts: 0
    };
    executionFailureCircuitBreaker.recordExecutionStatus({
      executionStatus: execution.status,
      nowMs
    });
    await logger.append('action_executed', {
      tickId,
      action: decision.action,
      execution
    });
    await logger.append('tick_finished', {
      tickId,
      fsmState: decision.fsmState,
      executionStatus: execution.status,
      reason: execution.reason
    });

    return {
      tickId,
      blocked: true,
      blockReason: execution.reason,
      safety,
      decision,
      execution
    };
  }

  const cooldownCheck = actionCooldownGuard.checkAndMark({
    action: decision.action,
    nowMs
  });
  if (!cooldownCheck.allowed) {
    const execution = {
      status: 'skipped',
      reason: cooldownCheck.reason,
      blockedBy: 'in_process_action_cooldown_guard',
      actionFingerprint: cooldownCheck.actionFingerprint,
      cooldownMs: cooldownCheck.cooldownMs,
      remainingMs: cooldownCheck.remainingMs,
      lastActionAtMs: cooldownCheck.lastActionAtMs,
      attempts: 0
    };
    executionFailureCircuitBreaker.recordExecutionStatus({
      executionStatus: execution.status,
      nowMs
    });
    await logger.append('action_executed', {
      tickId,
      action: decision.action,
      execution
    });
    await logger.append('tick_finished', {
      tickId,
      fsmState: decision.fsmState,
      executionStatus: execution.status,
      reason: execution.reason
    });

    return {
      tickId,
      blocked: true,
      blockReason: execution.reason,
      safety,
      decision,
      execution
    };
  }

  const execution = await executeAction({
    tickId,
    stateSnapshot,
    action: decision.action
  });
  executionFailureCircuitBreaker.recordExecutionStatus({
    executionStatus: execution.status,
    nowMs
  });
  await logger.append('action_executed', {
    tickId,
    action: decision.action,
    execution
  });
  await logger.append('tick_finished', {
    tickId,
    fsmState: decision.fsmState,
    executionStatus: execution.status
  });

  return {
    tickId,
    blocked: false,
    safety,
    decision,
    execution
  };
}

export async function startDeterministicWorkerLoop(options = {}) {
  const {
    intervalMs = Number(process.env.WORKER_TICK_MS ?? 10_000),
    tickTimeoutMs = Number(process.env.WORKER_TICK_TIMEOUT_MS ?? intervalMs),
    actionCooldownMs = Number(process.env.ACTION_COOLDOWN_MS ?? 3_000),
    failureCircuitStreak = Number(process.env.WORKER_FAILURE_CIRCUIT_STREAK ?? 3),
    failureCircuitCooldownMs = Number(process.env.WORKER_FAILURE_CIRCUIT_COOLDOWN_MS ?? 30_000),
    maxTicks = Number(process.env.WORKER_MAX_TICKS ?? Number.POSITIVE_INFINITY),
    lockFilePath = path.resolve(process.env.WORKER_LOCK_FILE ?? 'logs/worker-loop.lock'),
    lockStaleTtlMs = Number(process.env.WORKER_LOCK_STALE_TTL_MS ?? Math.max(intervalMs * 3, 30_000)),
    lockHeartbeatRetries = Number(process.env.WORKER_LOCK_HEARTBEAT_RETRIES ?? 1),
    lockHeartbeatRetryDelayMs = Number(process.env.WORKER_LOCK_HEARTBEAT_RETRY_DELAY_MS ?? 25),
    logger = new JsonlLogger(path.resolve('logs/worker-events.jsonl')),
    stateProvider = defaultStateProvider,
    executeAction = createActionExecutor({ transport: defaultTransport }),
    actionCooldownGuard = null,
    executionFailureCircuitBreaker = null,
    acquireLock = acquireWorkerLoopLock
  } = options;

  const normalizedIntervalMs = toPositiveInteger(intervalMs, 10_000);
  const normalizedTickTimeoutMs = toPositiveInteger(tickTimeoutMs, normalizedIntervalMs);
  const normalizedActionCooldownMs = toNonNegativeInteger(actionCooldownMs, 3_000);
  const normalizedFailureCircuitStreak = toPositiveInteger(failureCircuitStreak, 3);
  const normalizedFailureCircuitCooldownMs = toNonNegativeInteger(failureCircuitCooldownMs, 30_000);
  const normalizedLockStaleTtlMs = toPositiveInteger(
    lockStaleTtlMs,
    Math.max(normalizedIntervalMs * 3, 30_000)
  );
  const normalizedLockHeartbeatRetries = toNonNegativeInteger(lockHeartbeatRetries, 1);
  const normalizedLockHeartbeatRetryDelayMs = toNonNegativeInteger(lockHeartbeatRetryDelayMs, 25);
  const resolvedActionCooldownGuard =
    actionCooldownGuard ??
    createInProcessActionCooldownGuard({
      cooldownMs: normalizedActionCooldownMs
    });
  const resolvedExecutionFailureCircuitBreaker =
    executionFailureCircuitBreaker ??
    createInProcessExecutionFailureCircuitBreaker({
      failedTickStreakThreshold: normalizedFailureCircuitStreak,
      cooldownMs: normalizedFailureCircuitCooldownMs
    });

  let lock;
  try {
    lock = await acquireLock({
      lockFilePath,
      staleTtlMs: normalizedLockStaleTtlMs
    });
  } catch (error) {
    if (error.code === 'ELOCKED') {
      return {
        started: false,
        reason: 'lock_held',
        lockFilePath
      };
    }
    throw error;
  }

  let tickNumber = 1;
  try {
    while (tickNumber <= maxTicks) {
      const tickStart = Date.now();
      const tickId = formatTickId(tickNumber);
      try {
        await runTickWithTimeout({
          tickId,
          tickTimeoutMs: normalizedTickTimeoutMs,
          tickPromise: runDeterministicCycleOnce({
            tickNumber,
            tickId,
            nowMs: tickStart,
            actionCooldownMs: normalizedActionCooldownMs,
            actionCooldownGuard: resolvedActionCooldownGuard,
            failureCircuitStreak: normalizedFailureCircuitStreak,
            failureCircuitCooldownMs: normalizedFailureCircuitCooldownMs,
            executionFailureCircuitBreaker: resolvedExecutionFailureCircuitBreaker,
            stateProvider,
            logger,
            executeAction
          })
        });
      } catch (error) {
        await logger.append('tick_error', {
          tickId,
          message: error.message,
          code: error.code ?? null
        });
        if (error?.code === 'ETICK_TIMEOUT') {
          resolvedExecutionFailureCircuitBreaker.recordExecutionStatus({
            executionStatus: 'failed',
            nowMs: Date.now()
          });
        }
      }

      try {
        await touchLockWithRetry({
          lock,
          retries: normalizedLockHeartbeatRetries,
          retryDelayMs: normalizedLockHeartbeatRetryDelayMs
        });
      } catch (error) {
        await logger.append('tick_error', {
          tickId,
          message: `lock heartbeat failed: ${error.message}`,
          code: error.code ?? null
        });
        throw error;
      }

      tickNumber += 1;
      if (tickNumber > maxTicks) {
        break;
      }

      const elapsedMs = Date.now() - tickStart;
      const waitMs = Math.max(0, normalizedIntervalMs - elapsedMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } finally {
    await lock.release();
  }
}
