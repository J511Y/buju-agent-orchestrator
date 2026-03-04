import path from 'node:path';

import { createActionExecutor } from '../client/action-executor.js';
import { decideAction } from '../engine/fsm-rules.js';
import { evaluateSafetyGates } from '../engine/safety-gates.js';
import { JsonlLogger } from '../ops/jsonl-logger.js';

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
    tickId = `tick-${String(tickNumber).padStart(6, '0')}`,
    nowMs = Date.now(),
    stateProvider = defaultStateProvider,
    logger = new JsonlLogger(path.resolve('logs/worker-events.jsonl')),
    executeAction = createActionExecutor({ transport: defaultTransport })
  } = options;

  const stateSnapshot = stateProvider(tickNumber, nowMs);
  const safety = evaluateSafetyGates(stateSnapshot, nowMs);

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
    const blockedResult = {
      tickId,
      blocked: true,
      reasons: safety.reasons
    };
    await logger.append('tick_blocked', blockedResult);
    return blockedResult;
  }

  const decision = decideAction(stateSnapshot);
  await logger.append('decision_made', {
    tickId,
    decision
  });

  const execution = await executeAction({
    tickId,
    stateSnapshot,
    action: decision.action
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
    maxTicks = Number(process.env.WORKER_MAX_TICKS ?? Number.POSITIVE_INFINITY),
    logger = new JsonlLogger(path.resolve('logs/worker-events.jsonl')),
    stateProvider = defaultStateProvider,
    executeAction = createActionExecutor({ transport: defaultTransport })
  } = options;

  let tickNumber = 1;
  while (tickNumber <= maxTicks) {
    const tickStart = Date.now();
    try {
      await runDeterministicCycleOnce({
        tickNumber,
        nowMs: tickStart,
        stateProvider,
        logger,
        executeAction
      });
    } catch (error) {
      await logger.append('tick_error', {
        tickId: `tick-${String(tickNumber).padStart(6, '0')}`,
        message: error.message
      });
    }

    tickNumber += 1;
    if (tickNumber > maxTicks) {
      break;
    }

    const elapsedMs = Date.now() - tickStart;
    const waitMs = Math.max(0, intervalMs - elapsedMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
