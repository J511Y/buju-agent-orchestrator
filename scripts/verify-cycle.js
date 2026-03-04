import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createActionExecutor } from '../src/client/action-executor.js';
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
  logger,
  executeAction: executor,
  stateProvider: () => stateSnapshot
});

assert.equal(result.execution.status, 'success');
assert.equal(result.execution.attempts, 3);

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
assert.ok(!jsonl.includes('VERIFY_SUPER_SECRET'));
assert.ok(!jsonl.includes('should-never-leak'));
assert.ok(jsonl.includes('[MASKED]'));

console.log(`verify:cycle passed (${tempLogPath})`);
