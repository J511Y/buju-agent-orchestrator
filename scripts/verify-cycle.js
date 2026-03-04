import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createActionExecutor } from '../src/client/action-executor.js';
import { createInProcessActionCooldownGuard } from '../src/engine/action-cooldown-guard.js';
import { createInProcessExecutionFailureCircuitBreaker } from '../src/engine/execution-failure-circuit-breaker.js';
import { JsonlLogger } from '../src/ops/jsonl-logger.js';
import { analyzeReplayRecords } from '../src/ops/replay-analyzer.js';
import { runDeterministicCycleOnce } from '../src/worker/loop.js';

const tempLogPath = path.join(os.tmpdir(), `buju-worker-verify-${Date.now()}.jsonl`);
const logger = new JsonlLogger(tempLogPath);

let attemptCount = 0;
const flakyTransport = async () => {
  attemptCount += 1;
  if (attemptCount < 3) {
    const error = new Error('temporary network failure');
    error.code = 'ETIMEDOUT';
    error.retryable = true;
    throw error;
  }
  return { ok: true, upstream: 'mock-gateway', authToken: 'Bearer should-never-leak' };
};

const executor = createActionExecutor({
  transport: flakyTransport,
  maxAttempts: 4,
  baseDelayMs: 1
});
const cooldownGuard = createInProcessActionCooldownGuard({
  cooldownMs: 3_000
});

const stateSnapshot = {
  battleId: 'verify-battle',
  selfId: 'hero-1',
  enemyId: 'enemy-1',
  enemyVisible: true,
  healthPct: 80,
  energy: 60,
  enemyThreat: 20,
  pendingActionCount: 0,
  maintenanceMode: false,
  credentials: {
    apiKey: 'VERIFY_SUPER_SECRET'
  }
};

const result = await runDeterministicCycleOnce({
  tickNumber: 7,
  tickId: 'tick-verify-000007',
  nowMs: 1_000,
  logger,
  actionCooldownGuard: cooldownGuard,
  executeAction: executor,
  stateProvider: () => stateSnapshot
});

assert.equal(result.execution.status, 'success');
assert.equal(result.execution.attempts, 3);

const cooldownBlocked = await runDeterministicCycleOnce({
  tickNumber: 8,
  tickId: 'tick-verify-000008',
  nowMs: 2_500,
  logger,
  actionCooldownGuard: cooldownGuard,
  executeAction: executor,
  stateProvider: () => stateSnapshot
});
assert.equal(cooldownBlocked.execution.status, 'skipped');
assert.equal(cooldownBlocked.execution.reason, 'action_cooldown_active');
assert.equal(cooldownBlocked.execution.blockedBy, 'in_process_action_cooldown_guard');
assert.equal(cooldownBlocked.execution.attempts, 0);
assert.equal(attemptCount, 3);

const duplicate = await executor({
  tickId: 'tick-verify-000999',
  stateSnapshot,
  action: result.decision.action
});
assert.equal(duplicate.status, 'skipped');
assert.equal(duplicate.reason, 'idempotent_duplicate');
assert.equal(duplicate.actionKey, result.execution.actionKey);

const lowEnergySafeState = {
  ...stateSnapshot,
  enemyVisible: false,
  healthPct: 92,
  energy: 18,
  enemyThreat: 10
};
const lowEnergyEnemyPressureState = {
  ...stateSnapshot,
  enemyVisible: true,
  healthPct: 90,
  energy: 20,
  enemyThreat: 55
};
const lowEnergyDefense = await runDeterministicCycleOnce({
  tickNumber: 9,
  tickId: 'tick-verify-000009',
  nowMs: 5_500,
  logger,
  actionCooldownGuard: createInProcessActionCooldownGuard({ cooldownMs: 0 }),
  executeAction: executor,
  stateProvider: () => lowEnergyEnemyPressureState
});
assert.equal(lowEnergyDefense.decision.fsmState, 'DEFEND_LOW_ENERGY');
assert.equal(lowEnergyDefense.decision.ruleId, 'defend-low-energy-pressure');
assert.equal(lowEnergyDefense.decision.action.type, 'RAISE_SHIELD');
assert.equal(lowEnergyDefense.execution.status, 'success');

const energyRecovery = await runDeterministicCycleOnce({
  tickNumber: 10,
  tickId: 'tick-verify-000010',
  nowMs: 9_500,
  logger,
  actionCooldownGuard: cooldownGuard,
  executeAction: executor,
  stateProvider: () => lowEnergySafeState
});
assert.equal(energyRecovery.decision.fsmState, 'RECOVER_ENERGY');
assert.equal(energyRecovery.decision.ruleId, 'recover-energy-safe-window');
assert.equal(energyRecovery.decision.action.type, 'REST');
assert.equal(energyRecovery.execution.status, 'success');

const lowThreatEfficientAttackState = {
  ...stateSnapshot,
  battleId: 'verify-battle-efficient-attack',
  enemyId: 'enemy-2',
  enemyVisible: true,
  healthPct: 78,
  energy: 35,
  enemyThreat: 20
};
const efficientAttack = await runDeterministicCycleOnce({
  tickNumber: 11,
  tickId: 'tick-verify-000011',
  nowMs: 13_500,
  logger,
  actionCooldownGuard: createInProcessActionCooldownGuard({ cooldownMs: 0 }),
  executeAction: executor,
  stateProvider: () => lowThreatEfficientAttackState
});
assert.equal(efficientAttack.decision.fsmState, 'ATTACK_EFFICIENT');
assert.equal(efficientAttack.decision.ruleId, 'attack-low-threat-efficient-window');
assert.equal(efficientAttack.decision.action.type, 'BASIC_ATTACK');
assert.equal(efficientAttack.execution.status, 'success');

const alwaysFailExecutor = createActionExecutor({
  transport: async () => ({
    ok: false,
    retryable: false,
    code: '400',
    errorMessage: 'deterministic forced failure'
  }),
  maxAttempts: 1,
  baseDelayMs: 1
});
const noCooldownGuard = createInProcessActionCooldownGuard({ cooldownMs: 0 });
const failureCircuitBreaker = createInProcessExecutionFailureCircuitBreaker({
  failedTickStreakThreshold: 3,
  cooldownMs: 30_000
});

const skippedDoesNotResetBreaker = createInProcessExecutionFailureCircuitBreaker({
  failedTickStreakThreshold: 2,
  cooldownMs: 10_000
});
skippedDoesNotResetBreaker.recordExecutionStatus({ executionStatus: 'failed', nowMs: 1_000 });
skippedDoesNotResetBreaker.recordExecutionStatus({ executionStatus: 'skipped', nowMs: 1_100 });
const skippedPathCircuitState = skippedDoesNotResetBreaker.recordExecutionStatus({
  executionStatus: 'failed',
  nowMs: 1_200
});
assert.equal(skippedPathCircuitState.allowed, false);
assert.equal(skippedPathCircuitState.reason, 'execution_failure_circuit_open');

for (let index = 0; index < 3; index += 1) {
  const failedTick = await runDeterministicCycleOnce({
    tickNumber: 100 + index,
    tickId: `tick-verify-cb-00000${index + 1}`,
    nowMs: 10_000 + index * 1_000,
    logger,
    executeAction: alwaysFailExecutor,
    actionCooldownGuard: noCooldownGuard,
    executionFailureCircuitBreaker: failureCircuitBreaker,
    stateProvider: () => stateSnapshot
  });
  assert.equal(failedTick.blocked, false);
  assert.equal(failedTick.execution.status, 'failed');
}

const circuitBlocked = await runDeterministicCycleOnce({
  tickNumber: 104,
  tickId: 'tick-verify-cb-000004',
  nowMs: 13_500,
  logger,
  executeAction: alwaysFailExecutor,
  actionCooldownGuard: noCooldownGuard,
  executionFailureCircuitBreaker: failureCircuitBreaker,
  stateProvider: () => stateSnapshot
});
assert.equal(circuitBlocked.blocked, true);
assert.equal(circuitBlocked.execution.status, 'skipped');
assert.equal(circuitBlocked.execution.reason, 'execution_failure_circuit_open');
assert.equal(circuitBlocked.execution.blockedBy, 'execution_failure_circuit_breaker');
assert.equal(circuitBlocked.safety.allowed, false);
assert.ok(circuitBlocked.safety.reasons.includes('execution_failure_circuit_open'));

const postCooldown = await runDeterministicCycleOnce({
  tickNumber: 105,
  tickId: 'tick-verify-cb-000005',
  nowMs: 42_100,
  logger,
  executeAction: alwaysFailExecutor,
  actionCooldownGuard: noCooldownGuard,
  executionFailureCircuitBreaker: failureCircuitBreaker,
  stateProvider: () => stateSnapshot
});
assert.equal(postCooldown.blocked, false);
assert.equal(postCooldown.execution.status, 'failed');

const jsonl = await fs.readFile(tempLogPath, 'utf8');
const records = jsonl
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const circuitBlockedEvents = records
  .filter((entry) => entry.payload.tickId === 'tick-verify-cb-000004')
  .map((entry) => entry.eventType);
assert.deepEqual(circuitBlockedEvents, ['tick_started', 'safety_evaluated', 'tick_blocked', 'tick_finished']);

const replaySummary = analyzeReplayRecords(
  records.map((record, index) => ({
    lineNumber: index + 1,
    data: record
  }))
);
assert.equal(replaySummary.operationalBlockCounts.executionFailureCircuitOpen, 1);

assert.ok(jsonl.includes('"eventType":"decision_made"'));
assert.ok(jsonl.includes('"eventType":"action_executed"'));
assert.ok(jsonl.includes('"reason":"action_cooldown_active"'));
assert.ok(jsonl.includes('"reason":"execution_failure_circuit_open"'));
assert.ok(jsonl.includes('"ruleId":"recover-energy-safe-window"'));
assert.ok(!jsonl.includes('VERIFY_SUPER_SECRET'));
assert.ok(!jsonl.includes('should-never-leak'));
assert.ok(jsonl.includes('[MASKED]'));

console.log(`verify:cycle passed (${tempLogPath})`);
