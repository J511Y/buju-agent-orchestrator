import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchActivityKpis as fetchActivityKpisService,
  makeErrorFallbackPayload
} from './lib/activity/fetch-activity-kpis.js';
import { sanitizeString } from './lib/activity/common.js';
import { loadDotEnvIfPresent, parseArgs } from './lib/activity/runtime.js';

/**
 * Backward-compatible export used by verification scripts.
 */
export async function fetchActivityKpis(options = {}) {
  return fetchActivityKpisService(options);
}

async function main() {
  await loadDotEnvIfPresent();
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchActivityKpis(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    await main();
  } catch (error) {
    const apiKey = String(process.env.BUJU_API_KEY ?? '');
    process.stdout.write(`${JSON.stringify(makeErrorFallbackPayload())}\n`);
    process.stderr.write(`activity:fetch failed (${sanitizeString(error.message, apiKey)})\n`);
    process.exitCode = 1;
  }
}
