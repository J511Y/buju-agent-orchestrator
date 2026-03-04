import { startDeterministicWorkerLoop } from './loop.js';

const maxTicks = Number(process.env.WORKER_MAX_TICKS ?? Number.POSITIVE_INFINITY);
const tickMs = Number(process.env.WORKER_TICK_MS ?? 10_000);

console.log(`[worker] start deterministic loop (tick=${tickMs}ms, maxTicks=${maxTicks})`);
const result = await startDeterministicWorkerLoop({
  intervalMs: tickMs,
  maxTicks
});

if (result?.started === false && result.reason === 'lock_held') {
  console.log(`[worker] skipped: loop lock held (${result.lockFilePath})`);
}
