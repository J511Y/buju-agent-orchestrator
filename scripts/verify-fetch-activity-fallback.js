import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function makeRecord(eventType, payload, tsMs) {
  return {
    schema: 'buju.worker.event.v1',
    ts: new Date(tsMs).toISOString(),
    eventType,
    payload
  };
}

function makeTickRecords({ tickId, tickNumber, baseTsMs, status, outcome, level, exp, gold }) {
  const records = [
    makeRecord('tick_started', { tickId, tickNumber, stateSnapshot: { level, exp, gold } }, baseTsMs),
    makeRecord(
      'safety_evaluated',
      { tickId, safety: { allowed: true, reasons: [] } },
      baseTsMs + 1_000
    ),
    makeRecord('decision_made', { tickId, decision: { fsmState: 'ATTACK' } }, baseTsMs + 2_000),
    makeRecord(
      'action_executed',
      {
        tickId,
        action: { type: 'attack', targetId: 'mob-1' },
        execution: {
          status,
          response: outcome ? { outcome } : {}
        }
      },
      baseTsMs + 3_000
    ),
    makeRecord('tick_finished', { tickId, executionStatus: status }, baseTsMs + 4_000)
  ];
  return records;
}

const nowMs = Date.UTC(2026, 2, 4, 12, 0, 0);
const tempLogPath = path.join(os.tmpdir(), `buju-activity-fallback-${Date.now()}.jsonl`);

const records = [
  ...makeTickRecords({
    tickId: 'tick-old',
    tickNumber: 1,
    baseTsMs: nowMs - 90 * 60 * 1_000,
    status: 'success',
    outcome: 'victory',
    level: 2,
    exp: 90,
    gold: 180
  }),
  ...makeTickRecords({
    tickId: 'tick-1',
    tickNumber: 2,
    baseTsMs: nowMs - 55 * 60 * 1_000,
    status: 'success',
    outcome: 'victory',
    level: 3,
    exp: 100,
    gold: 200
  }),
  ...makeTickRecords({
    tickId: 'tick-2',
    tickNumber: 3,
    baseTsMs: nowMs - 35 * 60 * 1_000,
    status: 'failed',
    outcome: 'defeat',
    level: 3,
    exp: 105,
    gold: 220
  }),
  ...makeTickRecords({
    tickId: 'tick-3',
    tickNumber: 4,
    baseTsMs: nowMs - 10 * 60 * 1_000,
    status: 'skipped',
    outcome: null,
    level: 3,
    exp: 110,
    gold: 230
  })
];

await fs.writeFile(tempLogPath, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');

const { stdout } = await execFileAsync(
  process.execPath,
  [
    path.resolve('scripts/fetch-activity.js'),
    '--skip-api',
    '--hours',
    '1',
    '--now-ms',
    String(nowMs),
    '--log-file',
    tempLogPath
  ],
  {
    cwd: path.resolve('.')
  }
);

const parsed = JSON.parse(stdout.trim());
assert.equal(parsed.source, 'fallback:local_replay');
assert.deepEqual(parsed.action_status_counts, { success: 1, failed: 1, skipped: 1 });
assert.deepEqual(parsed.known_outcomes, { win: 1, defeat: 1, unknown: 1 });
assert.deepEqual(parsed.progress_delta, { level: 0, exp: 10, gold: 30 });
assert.ok(Array.isArray(parsed.endpoint_statuses));
assert.ok(parsed.endpoint_statuses.length > 0);
assert.ok(parsed.endpoint_statuses.every((item) => item.status === 'skipped'));

console.log(`verify:activity:fallback passed (${tempLogPath})`);
