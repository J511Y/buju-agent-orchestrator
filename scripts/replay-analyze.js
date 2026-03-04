import path from 'node:path';

import { analyzeReplayFile, formatReplaySummary } from '../src/ops/replay-analyzer.js';

const targetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('logs/worker-events.jsonl');

try {
  const summary = await analyzeReplayFile(targetPath);
  console.log(formatReplaySummary(targetPath, summary));
  if (summary.validationErrors.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`replay:analyze failed (${targetPath}): ${error.message}`);
  process.exitCode = 1;
}

