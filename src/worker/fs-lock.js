import fs from 'node:fs/promises';
import path from 'node:path';

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

async function readLockInfo(lockFilePath) {
  try {
    const raw = await fs.readFile(lockFilePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function isLockStale(lockFilePath, staleTtlMs, nowMs) {
  try {
    const stat = await fs.stat(lockFilePath);
    return nowMs - stat.mtimeMs > staleTtlMs;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

export async function acquireWorkerLoopLock(options = {}) {
  const {
    lockFilePath = path.resolve('logs/worker-loop.lock'),
    staleTtlMs = 30_000,
    now = () => Date.now(),
    owner = `pid-${process.pid}`
  } = options;

  const normalizedStaleTtlMs = toPositiveInteger(staleTtlMs, 30_000);
  await fs.mkdir(path.dirname(lockFilePath), { recursive: true });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const acquiredAtMs = now();
    const lockRecord = {
      owner,
      acquiredAt: new Date(acquiredAtMs).toISOString(),
      acquiredAtMs
    };

    try {
      const handle = await fs.open(lockFilePath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify(lockRecord)}\n`, 'utf8');
      } finally {
        await handle.close();
      }

      let released = false;
      return {
        lockFilePath,
        owner,
        async touch() {
          const touchMs = now();
          const touchDate = new Date(touchMs);
          await fs.utimes(lockFilePath, touchDate, touchDate);
        },
        async release() {
          if (released) {
            return;
          }
          released = true;
          try {
            await fs.unlink(lockFilePath);
          } catch (error) {
            if (error.code !== 'ENOENT') {
              throw error;
            }
          }
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      const nowMs = now();
      const stale = await isLockStale(lockFilePath, normalizedStaleTtlMs, nowMs);
      if (!stale) {
        const lockError = new Error(`worker loop lock already held (${lockFilePath})`);
        lockError.code = 'ELOCKED';
        lockError.lockInfo = await readLockInfo(lockFilePath);
        throw lockError;
      }

      try {
        await fs.unlink(lockFilePath);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') {
          throw unlinkError;
        }
      }
    }
  }

  const acquireError = new Error(`failed to acquire worker loop lock (${lockFilePath})`);
  acquireError.code = 'ELOCK_ACQUIRE_FAILED';
  throw acquireError;
}
