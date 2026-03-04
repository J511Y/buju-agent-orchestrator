import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createActionExecutor } from '../src/client/action-executor.js';
import { createInProcessActionCooldownGuard } from '../src/engine/action-cooldown-guard.js';
import { JsonlLogger } from '../src/ops/jsonl-logger.js';
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
  tickId: 'tick-verify-000007',
  stateSnapshot,
  action: result.decision.action
});
assert.equal(duplicate.status, 'skipped');
assert.equal(duplicate.reason, 'idempotent_duplicate');

const jsonl = await fs.readFile(tempLogPath, 'utf8');
assert.ok(jsonl.includes('"eventType":"decision_made"'));
assert.ok(jsonl.includes('"eventType":"action_executed"'));
assert.ok(jsonl.includes('"reason":"action_cooldown_active"'));
assert.ok(!jsonl.includes('VERIFY_SUPER_SECRET'));
assert.ok(!jsonl.includes('should-never-leak'));
assert.ok(jsonl.includes('[MASKED]'));

console.log(`verify:cycle passed (${tempLogPath})`);
