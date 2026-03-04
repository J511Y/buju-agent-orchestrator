import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buju-activity-probe-log-'));
const replayPath = path.join(tempDir, 'worker-events.jsonl');
const probeLogPath = path.join(tempDir, 'activity-probe.jsonl');
const endpointConfigPath = path.join(tempDir, 'activity-endpoints.json');

await fs.writeFile(replayPath, '', 'utf8');
await fs.writeFile(
  endpointConfigPath,
  `${JSON.stringify(['/api/activity/recent?hours=1', '/api/status'], null, 2)}\n`,
  'utf8'
);

try {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.resolve('scripts/fetch-activity.js'),
      '--skip-api',
      '--hours',
      '1',
      '--now-ms',
      String(Date.UTC(2026, 2, 4, 12, 0, 0)),
      '--log-file',
      replayPath,
      '--activity-endpoints-config',
      endpointConfigPath,
      '--activity-probe-log-file',
      probeLogPath
    ],
    {
      cwd: path.resolve('.')
    }
  );

  const response = JSON.parse(stdout.trim());
  assert.equal(response.source, 'fallback:local_replay');
  assert.deepEqual(response.activity_probe_summary, {
    lookback_hours: 6,
    generated_at: new Date(Date.UTC(2026, 2, 4, 12, 0, 0)).toISOString(),
    endpoints: [
      {
        endpoint: '/api/activity/recent?hours=1',
        failure_streak: 1,
        last_status: 'skipped'
      },
      {
        endpoint: '/api/status',
        failure_streak: 1,
        last_status: 'skipped'
      }
    ]
  });

  const written = await fs.readFile(probeLogPath, 'utf8');
  const lines = written
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);

  assert.equal(typeof record.ts, 'string');
  assert.equal(record.source, 'fallback:local_replay');
  assert.deepEqual(record.endpoint_statuses, {
    total: 2,
    ok: 0,
    http_fail: 0,
    network_fail: 0,
    skipped: 2,
    missing_api_key: 0,
    endpoints: [
      {
        endpoint: '/api/activity/recent?hours=1',
        status: 'skipped'
      },
      {
        endpoint: '/api/status',
        status: 'skipped'
      }
    ]
  });

  console.log(`verify:activity-log passed (${probeLogPath})`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
