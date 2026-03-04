import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeReplayFile, analyzeReplayRecords } from '../src/ops/replay-analyzer.js';

function makeRecord(eventType, payload, offsetSeconds) {
  return {
    schema: 'buju.worker.event.v1',
    ts: new Date(Date.UTC(2026, 2, 4, 0, 0, offsetSeconds)).toISOString(),
    eventType,
    payload
  };
}

const validRecords = [
  makeRecord('tick_started', { tickId: 'tick-1', tickNumber: 1 }, 0),
  makeRecord('safety_evaluated', { tickId: 'tick-1', safety: { allowed: true, reasons: [] } }, 1),
  makeRecord('decision_made', { tickId: 'tick-1', decision: { fsmState: 'ATTACK' } }, 2),
  makeRecord('action_executed', { tickId: 'tick-1', execution: { status: 'success' } }, 3),
  makeRecord('tick_finished', { tickId: 'tick-1', executionStatus: 'success' }, 4),
  makeRecord('tick_started', { tickId: 'tick-2', tickNumber: 2 }, 5),
  makeRecord('safety_evaluated', { tickId: 'tick-2', safety: { allowed: false, reasons: ['low_health'] } }, 6),
  makeRecord('tick_blocked', { tickId: 'tick-2', blocked: true, reasons: ['low_health'] }, 7),
  makeRecord('tick_started', { tickId: 'tick-3', tickNumber: 3 }, 8),
  makeRecord('safety_evaluated', { tickId: 'tick-3', safety: { allowed: true, reasons: [] } }, 9),
  makeRecord('decision_made', { tickId: 'tick-3', decision: { fsmState: 'ATTACK' } }, 10),
  makeRecord('action_executed', { tickId: 'tick-3', execution: { status: 'failed' } }, 11),
  makeRecord('tick_finished', { tickId: 'tick-3', executionStatus: 'failed' }, 12),
  makeRecord('tick_started', { tickId: 'tick-4', tickNumber: 4 }, 13),
  makeRecord('safety_evaluated', { tickId: 'tick-4', safety: { allowed: true, reasons: [] } }, 14),
  makeRecord('decision_made', { tickId: 'tick-4', decision: { fsmState: 'HOLD' } }, 15),
  makeRecord('action_executed', { tickId: 'tick-4', execution: { status: 'skipped' } }, 16),
  makeRecord('tick_finished', { tickId: 'tick-4', executionStatus: 'skipped' }, 17)
];

const validFilePath = path.join(os.tmpdir(), `buju-replay-valid-${Date.now()}.jsonl`);
await fs.writeFile(validFilePath, validRecords.map((record) => JSON.stringify(record)).join('\n'), 'utf8');

const summary = await analyzeReplayFile(validFilePath);
assert.equal(summary.ticks, 4);
assert.equal(summary.blockedTicks, 1);
assert.equal(summary.actionStatusCounts.success, 1);
assert.equal(summary.actionStatusCounts.failed, 1);
assert.equal(summary.actionStatusCounts.skipped, 1);
assert.equal(summary.validationErrors.length, 0);
assert.equal(summary.topSafetyReasons[0]?.reason, 'low_health');
assert.equal(summary.topSafetyReasons[0]?.count, 1);

const invalidSummary = analyzeReplayRecords([
  {
    lineNumber: 1,
    data: makeRecord('safety_evaluated', { tickId: 'broken-tick', safety: { allowed: true, reasons: [] } }, 20)
  }
]);
assert.ok(invalidSummary.validationErrors.length > 0);

console.log(`verify:replay passed (${validFilePath})`);

