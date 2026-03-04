import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appendActivityProbeLog } from './lib/activity/probe-log.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buju-activity-probe-log-rotation-'));
const probeLogPath = path.join(tempDir, 'activity-probe.jsonl');
const maxBytes = 512;

const oldLine = `${JSON.stringify({
  ts: '2026-03-01T00:00:00.000Z',
  source: 'legacy',
  endpoint_statuses: {
    total: 1,
    ok: 0,
    http_fail: 0,
    network_fail: 1,
    skipped: 0,
    missing_api_key: 0,
    endpoints: [{ endpoint: '/api/old', status: 'network_fail' }]
  }
})}\n`;

let oversized = '';
while (Buffer.byteLength(oversized, 'utf8') <= maxBytes * 3) {
  oversized += oldLine;
}
await fs.writeFile(probeLogPath, oversized, 'utf8');

try {
  const latestTsMs = Date.UTC(2026, 2, 5, 3, 0, 0);
  await appendActivityProbeLog({
    tsMs: latestTsMs,
    source: 'fallback:local_replay',
    endpointStatuses: [{ endpoint: '/api/status', status: 'skipped' }],
    apiKey: 'mask-me',
    activityProbeLogPath: probeLogPath,
    activityProbeLogMaxBytes: maxBytes
  });

  const stats = await fs.stat(probeLogPath);
  assert.ok(
    stats.size <= maxBytes,
    `expected rotated probe log size <= ${maxBytes}, got ${stats.size}`
  );

  const lines = (await fs.readFile(probeLogPath, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(lines.length >= 1, 'expected at least one JSONL record after append');

  const latestRecord = JSON.parse(lines[lines.length - 1]);
  assert.equal(latestRecord.ts, new Date(latestTsMs).toISOString());
  assert.equal(latestRecord.source, 'fallback:local_replay');
  assert.deepEqual(latestRecord.endpoint_statuses.endpoints, [
    { endpoint: '/api/status', status: 'skipped' }
  ]);

  console.log(`verify:activity-log-rotation passed (${stats.size}/${maxBytes} bytes)`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
