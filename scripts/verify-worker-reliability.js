import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonlLogger } from '../src/ops/jsonl-logger.js';
import { acquireWorkerLoopLock } from '../src/worker/fs-lock.js';
import { startDeterministicWorkerLoop } from '../src/worker/loop.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buju-worker-reliability-'));
const lockPath = path.join(tempDir, 'worker.lock');
const staleLockPath = path.join(tempDir, 'stale-worker.lock');
const loopLockPath = path.join(tempDir, 'loop.lock');
const logPath = path.join(tempDir, 'worker-events.jsonl');
const heartbeatRetryLogPath = path.join(tempDir, 'worker-heartbeat-retry-events.jsonl');

const firstLock = await acquireWorkerLoopLock({
  lockFilePath: lockPath,
  staleTtlMs: 1_000
});

let lockError = null;
try {
  await acquireWorkerLoopLock({
    lockFilePath: lockPath,
    staleTtlMs: 1_000
  });
} catch (error) {
  lockError = error;
}

assert.ok(lockError, 'second lock acquisition should fail while first lock is alive');
assert.equal(lockError.code, 'ELOCKED');
await firstLock.release();

const staleOwnerLock = await acquireWorkerLoopLock({
  lockFilePath: staleLockPath,
  staleTtlMs: 50
});
const staleDate = new Date(Date.now() - 5_000);
await fs.utimes(staleLockPath, staleDate, staleDate);

const staleRecoveredLock = await acquireWorkerLoopLock({
  lockFilePath: staleLockPath,
  staleTtlMs: 50
});
await staleRecoveredLock.release();
await staleOwnerLock.release();

const logger = new JsonlLogger(logPath);
const stateProvider = () => ({
  battleId: 'verify-battle',
  selfId: 'hero-1',
  enemyId: 'enemy-1',
  enemyVisible: true,
  healthPct: 90,
  energy: 70,
  enemyThreat: 10,
  pendingActionCount: 0,
  maintenanceMode: false
});

const executeAction = async ({ tickId }) => {
  if (tickId === 'tick-000001') {
    return new Promise(() => {});
  }

  return {
    status: 'success',
    actionKey: `${tickId}:success`,
    attempts: 1,
    response: { ok: true }
  };
};

await startDeterministicWorkerLoop({
  intervalMs: 5,
  tickTimeoutMs: 20,
  maxTicks: 2,
  logger,
  stateProvider,
  executeAction,
  lockFilePath: loopLockPath,
  lockStaleTtlMs: 100
});

let loopLockExists = true;
try {
  await fs.access(loopLockPath);
} catch (error) {
  if (error.code === 'ENOENT') {
    loopLockExists = false;
  } else {
    throw error;
  }
}
assert.equal(loopLockExists, false, 'loop lock file must be released on loop completion');

const logLines = (await fs.readFile(logPath, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const firstTickError = logLines.find(
  (entry) => entry.eventType === 'tick_error' && entry.payload.tickId === 'tick-000001'
);
assert.ok(firstTickError, 'first tick should emit timeout tick_error');
assert.equal(firstTickError.payload.code, 'ETICK_TIMEOUT');

const secondTickFinished = logLines.find(
  (entry) => entry.eventType === 'tick_finished' && entry.payload.tickId === 'tick-000002'
);
assert.ok(secondTickFinished, 'second tick should continue and finish after first tick timeout');

const heartbeatRetryLogger = new JsonlLogger(heartbeatRetryLogPath);
let transientTouchFailures = 0;
let releaseCalls = 0;

await startDeterministicWorkerLoop({
  intervalMs: 1,
  tickTimeoutMs: 50,
  maxTicks: 1,
  logger: heartbeatRetryLogger,
  stateProvider,
  executeAction: async ({ tickId }) => ({
    status: 'success',
    actionKey: `${tickId}:success`,
    attempts: 1,
    response: { ok: true }
  }),
  lockFilePath: path.join(tempDir, 'unused-injected.lock'),
  lockStaleTtlMs: 100,
  lockHeartbeatRetries: 1,
  lockHeartbeatRetryDelayMs: 0,
  acquireLock: async () => ({
    async touch() {
      if (transientTouchFailures === 0) {
        transientTouchFailures += 1;
        const error = new Error('transient heartbeat io error');
        error.code = 'EHEARTBEAT_TRANSIENT';
        throw error;
      }
    },
    async release() {
      releaseCalls += 1;
    }
  })
});

assert.equal(transientTouchFailures, 1, 'injected lock should fail exactly once before retry success');
assert.equal(releaseCalls, 1, 'injected lock must be released once');

const heartbeatRetryLines = (await fs.readFile(heartbeatRetryLogPath, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const heartbeatFailureError = heartbeatRetryLines.find(
  (entry) =>
    entry.eventType === 'tick_error' &&
    typeof entry.payload?.message === 'string' &&
    entry.payload.message.toLowerCase().includes('lock heartbeat failed')
);
assert.equal(
  heartbeatFailureError,
  undefined,
  'transient lock heartbeat failure should recover via retry without terminal tick_error'
);

console.log(`verify:worker passed (${tempDir})`);
