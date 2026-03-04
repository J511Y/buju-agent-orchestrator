import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buju-activity-config-'));
const configPath = path.join(tempDir, 'activity-endpoints.custom.json');
const replayPath = path.join(tempDir, 'events.jsonl');
const expectedSummary = {
  progress_delta: { level: 0, exp: 5, gold: 12 },
  action_status_counts: { success: 2, failed: 0, skipped: 1 },
  known_outcomes: { win: 2, defeat: 0, unknown: 1 }
};

const dataEndpoint = `data:application/json,${encodeURIComponent(JSON.stringify(expectedSummary))}`;

await fs.writeFile(configPath, `${JSON.stringify([dataEndpoint], null, 2)}\n`, 'utf8');
await fs.writeFile(replayPath, '', 'utf8');

try {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.resolve('scripts/fetch-activity.js'),
      '--hours',
      '2',
      '--base-url',
      'https://bujuagent.com',
      '--log-file',
      replayPath,
      '--activity-endpoints-config',
      configPath
    ],
    {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        BUJU_API_KEY: 'verify-config-key'
      }
    }
  );

  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.source, `api:${dataEndpoint}`);
  assert.deepEqual(parsed.progress_delta, expectedSummary.progress_delta);
  assert.deepEqual(parsed.action_status_counts, expectedSummary.action_status_counts);
  assert.deepEqual(parsed.known_outcomes, expectedSummary.known_outcomes);
  assert.ok(Array.isArray(parsed.endpoint_statuses));
  assert.equal(parsed.endpoint_statuses.length, 1);
  assert.equal(parsed.endpoint_statuses[0].endpoint, dataEndpoint);
  assert.equal(parsed.endpoint_statuses[0].ok, true);
  assert.equal(parsed.endpoint_statuses[0].http_status, 200);

  console.log(`verify:activity-config passed (${configPath})`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
