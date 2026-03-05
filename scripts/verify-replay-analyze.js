import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeReplayFile, analyzeReplayRecords, formatReplaySummary } from '../src/ops/replay-analyzer.js';

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
  makeRecord(
    'decision_made',
    { tickId: 'tick-1', decision: { fsmState: 'ATTACK', ruleId: 'attack-energy-window' } },
    2
  ),
  makeRecord('action_executed', { tickId: 'tick-1', execution: { status: 'success', attempts: 2 } }, 3),
  makeRecord('tick_finished', { tickId: 'tick-1', executionStatus: 'success' }, 4),
  makeRecord('tick_started', { tickId: 'tick-2', tickNumber: 2 }, 5),
  makeRecord('safety_evaluated', { tickId: 'tick-2', safety: { allowed: false, reasons: ['low_health'] } }, 6),
  makeRecord('tick_blocked', { tickId: 'tick-2', blocked: true, reasons: ['low_health'] }, 7),
  makeRecord('tick_finished', { tickId: 'tick-2', executionStatus: 'skipped', reason: 'low_health' }, 8),
  makeRecord('tick_started', { tickId: 'tick-3', tickNumber: 3 }, 8),
  makeRecord('safety_evaluated', { tickId: 'tick-3', safety: { allowed: true, reasons: [] } }, 9),
  makeRecord(
    'decision_made',
    { tickId: 'tick-3', decision: { fsmState: 'ATTACK', ruleId: 'attack-energy-window' } },
    10
  ),
  makeRecord('action_executed', { tickId: 'tick-3', execution: { status: 'failed' } }, 11),
  makeRecord('tick_finished', { tickId: 'tick-3', executionStatus: 'failed' }, 12),
  makeRecord('tick_started', { tickId: 'tick-4', tickNumber: 4 }, 13),
  makeRecord('safety_evaluated', { tickId: 'tick-4', safety: { allowed: true, reasons: [] } }, 14),
  makeRecord(
    'decision_made',
    { tickId: 'tick-4', decision: { fsmState: 'HOLD', ruleId: 'hold-default' } },
    15
  ),
  makeRecord('action_executed', { tickId: 'tick-4', execution: { status: 'skipped' } }, 16),
  makeRecord('tick_finished', { tickId: 'tick-4', executionStatus: 'skipped' }, 17),
  makeRecord('tick_started', { tickId: 'tick-5', tickNumber: 5 }, 18),
  makeRecord('safety_evaluated', { tickId: 'tick-5', safety: { allowed: true, reasons: [] } }, 19),
  makeRecord(
    'decision_made',
    { tickId: 'tick-5', decision: { fsmState: 'ATTACK', ruleId: 'attack-low-threat-efficient-window' } },
    20
  ),
  makeRecord(
    'action_executed',
    { tickId: 'tick-5', execution: { status: 'skipped', reason: 'action_cooldown_active' } },
    21
  ),
  makeRecord('tick_finished', { tickId: 'tick-5', executionStatus: 'skipped' }, 22),
  makeRecord('tick_started', { tickId: 'tick-6', tickNumber: 6 }, 23),
  makeRecord('safety_evaluated', { tickId: 'tick-6', safety: { allowed: true, reasons: [] } }, 24),
  makeRecord(
    'decision_made',
    { tickId: 'tick-6', decision: { fsmState: 'ATTACK', ruleId: 'attack-energy-window' } },
    25
  ),
  makeRecord('tick_error', { tickId: 'tick-6', message: 'tick timeout after 10000ms', code: 'ETICK_TIMEOUT' }, 26),
  makeRecord('tick_started', { tickId: 'tick-7', tickNumber: 7 }, 27),
  makeRecord('safety_evaluated', { tickId: 'tick-7', safety: { allowed: true, reasons: [] } }, 28),
  makeRecord(
    'decision_made',
    { tickId: 'tick-7', decision: { fsmState: 'ATTACK', ruleId: 'attack-energy-window' } },
    29
  ),
  makeRecord('tick_error', { tickId: 'tick-7', message: 'lock heartbeat failed: EACCES', code: 'EACCES' }, 30),
  makeRecord('tick_started', { tickId: 'tick-8', tickNumber: 8 }, 31),
  makeRecord(
    'safety_evaluated',
    { tickId: 'tick-8', safety: { allowed: false, reasons: ['execution_failure_circuit_open'] } },
    32
  ),
  makeRecord(
    'tick_blocked',
    { tickId: 'tick-8', blocked: true, reasons: ['execution_failure_circuit_open'] },
    33
  ),
  makeRecord(
    'tick_finished',
    {
      tickId: 'tick-8',
      executionStatus: 'skipped',
      reason: 'execution_failure_circuit_open',
      blockedBy: 'execution_failure_circuit_breaker'
    },
    34
  ),
  makeRecord('tick_started', { tickId: 'tick-9', tickNumber: 9 }, 35),
  makeRecord('safety_evaluated', { tickId: 'tick-9', safety: { allowed: true, reasons: [] } }, 36),
  makeRecord(
    'decision_made',
    { tickId: 'tick-9', decision: { fsmState: 'ATTACK', ruleId: 'attack-energy-window' } },
    37
  ),
  makeRecord(
    'action_executed',
    { tickId: 'tick-9', execution: { status: 'skipped', reason: 'invalid_action_target' } },
    38
  ),
  makeRecord('tick_finished', { tickId: 'tick-9', executionStatus: 'skipped', reason: 'invalid_action_target' }, 39)
];

const validFilePath = path.join(os.tmpdir(), `buju-replay-valid-${Date.now()}.jsonl`);
await fs.writeFile(validFilePath, validRecords.map((record) => JSON.stringify(record)).join('\n'), 'utf8');

const summary = await analyzeReplayFile(validFilePath);
assert.equal(summary.ticks, 9);
assert.equal(summary.blockedTicks, 2);
assert.equal(summary.actionStatusCounts.success, 1);
assert.equal(summary.actionStatusCounts.failed, 1);
assert.equal(summary.actionStatusCounts.skipped, 3);
assert.equal(summary.operationalBlockCounts.actionCooldownActive, 1);
assert.equal(summary.operationalBlockCounts.invalidActionTarget, 1);
assert.equal(summary.operationalBlockCounts.retriedSuccess, 1);
assert.equal(summary.operationalBlockCounts.tickTimeout, 1);
assert.equal(summary.operationalBlockCounts.lockHeartbeatFailed, 1);
assert.equal(summary.operationalBlockCounts.executionFailureCircuitOpen, 1);
assert.equal(summary.validationErrors.length, 0);
const safetyReasonCounts = Object.fromEntries(summary.topSafetyReasons.map((item) => [item.reason, item.count]));
assert.equal(safetyReasonCounts.low_health, 1);
assert.equal(safetyReasonCounts.execution_failure_circuit_open, 1);
const decisionRuleCounts = Object.fromEntries(
  summary.topDecisionRules.map((item) => [item.ruleId, item.count])
);
assert.equal(decisionRuleCounts['attack-energy-window'], 5);
assert.equal(decisionRuleCounts['hold-default'], 1);
assert.equal(decisionRuleCounts['attack-low-threat-efficient-window'], 1);
assert.ok(
  formatReplaySummary(validFilePath, summary).includes(
    'operational cooldown_blocks=1 invalid_target_blocks=1 retried_success=1 tick_timeouts=1 lock_heartbeat_failures=1 execution_failure_circuit_blocks=1'
  )
);
assert.ok(
  formatReplaySummary(validFilePath, summary).includes(
    'top_decision_rules attack-energy-window=5, attack-low-threat-efficient-window=1, hold-default=1'
  )
);

const invalidSummary = analyzeReplayRecords([
  {
    lineNumber: 1,
    data: makeRecord('safety_evaluated', { tickId: 'broken-tick', safety: { allowed: true, reasons: [] } }, 20)
  }
]);
assert.ok(invalidSummary.validationErrors.length > 0);

console.log(`verify:replay passed (${validFilePath})`);
