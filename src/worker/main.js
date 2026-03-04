import { startDeterministicWorkerLoop } from './loop.js';

const maxTicks = Number(process.env.WORKER_MAX_TICKS ?? Number.POSITIVE_INFINITY);
const tickMs = Number(process.env.WORKER_TICK_MS ?? 10_000);

console.log(`[worker] start deterministic loop (tick=${tickMs}ms, maxTicks=${maxTicks})`);
await startDeterministicWorkerLoop({
  intervalMs: tickMs,
  maxTicks
});
