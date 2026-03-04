import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildActivityProbeSummary } from './lib/activity/probe-summary.js';

function makeRecord(tsMs, endpointStatuses) {
  return {
    ts: new Date(tsMs).toISOString(),
    source: 'fallback:local_replay',
    endpoint_statuses: {
      total: endpointStatuses.length,
      ok: 0,
      http_fail: 0,
      network_fail: 0,
      skipped: 0,
      missing_api_key: 0,
      endpoints: endpointStatuses
    }
  };
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buju-activity-probe-summary-'));
const probeLogPath = path.join(tempDir, 'activity-probe.synthetic.jsonl');
const endpointsConfigPath = path.join(tempDir, 'activity-endpoints.synthetic.json');
const nowMs = Date.UTC(2026, 2, 5, 6, 0, 0);

await fs.writeFile(
  endpointsConfigPath,
  `${JSON.stringify(['/api/a', '/api/b', '/api/c'], null, 2)}\n`,
  'utf8'
);

const lines = [
  JSON.stringify(
    makeRecord(nowMs - 7 * 60 * 60 * 1_000, [
      { endpoint: '/api/b', status: 'http_fail', http_status: 500 }
    ])
  ),
  JSON.stringify(
    makeRecord(nowMs - 5.5 * 60 * 60 * 1_000, [
      { endpoint: '/api/a', status: 'ok', http_status: 200 },
      { endpoint: '/api/b', status: 'http_fail', http_status: 404 }
    ])
  ),
  '{ this is malformed jsonl }',
  JSON.stringify(
    makeRecord(nowMs - 4 * 60 * 60 * 1_000, [
      { endpoint: '/api/a', status: 'network_fail' },
      { endpoint: '/api/b', status: 'http_fail', http_status: 503 }
    ])
  ),
  JSON.stringify({ ts: 'invalid-ts', endpoint_statuses: { endpoints: [] } }),
  JSON.stringify(
    makeRecord(nowMs - 2 * 60 * 60 * 1_000, [
      { endpoint: '/api/a', ok: true, http_status: 200 },
      { endpoint: '/api/b', ok: true, http_status: 200 },
      { endpoint: '/api/c', status: 'missing_api_key' }
    ])
  ),
  JSON.stringify(
    makeRecord(nowMs - 1 * 60 * 60 * 1_000, [
      { endpoint: '/api/b', status: 'network_fail' },
      { endpoint: '/api/c', status: 'missing_api_key' },
      { endpoint: 'data:application/json,[]', status: 'http_fail', http_status: 500 }
    ])
  ),
  JSON.stringify(
    makeRecord(nowMs - 30 * 60 * 1_000, [
      { endpoint: '/api/b', status: 'http_fail', http_status: 500 },
      { endpoint: '/api/c', status: 'ok', http_status: 200 }
    ])
  )
];

await fs.writeFile(probeLogPath, `${lines.join('\n')}\n`, 'utf8');

try {
  const summary = await buildActivityProbeSummary({
    activityProbeLogPath: probeLogPath,
    activityEndpointsConfigPath: endpointsConfigPath,
    lookbackHours: 6,
    nowMs
  });

  assert.deepEqual(summary, {
    lookback_hours: 6,
    generated_at: new Date(nowMs).toISOString(),
    endpoints: [
      { endpoint: '/api/a', failure_streak: 0, last_status: 'ok' },
      { endpoint: '/api/b', failure_streak: 2, last_status: 'http_fail' },
      { endpoint: '/api/c', failure_streak: 0, last_status: 'ok' }
    ]
  });

  console.log(`verify:activity-probe-summary passed (${probeLogPath})`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
