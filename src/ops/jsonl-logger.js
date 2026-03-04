import fs from 'node:fs/promises';
import path from 'node:path';

const SECRET_KEY_PATTERN = /(token|secret|api[_-]?key|password|authorization|auth|cookie|session)/i;

function maskStringSecrets(value) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[MASKED]')
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, '[MASKED]');
}

export function maskSecrets(value, parentKey = '') {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(parentKey)) {
      return '[MASKED]';
    }
    return maskStringSecrets(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskSecrets(item, parentKey));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        return [key, '[MASKED]'];
      }
      return [key, maskSecrets(nestedValue, key)];
    })
  );
}

export class JsonlLogger {
  constructor(filePath) {
    this.filePath = filePath;
    this._initPromise = null;
    this._writeQueue = Promise.resolve();
  }

  async append(eventType, payload) {
    if (!this._initPromise) {
      this._initPromise = fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }

    const record = {
      schema: 'buju.worker.event.v1',
      ts: new Date().toISOString(),
      eventType,
      payload: maskSecrets(payload)
    };
    const line = `${JSON.stringify(record)}\n`;

    this._writeQueue = this._writeQueue.then(async () => {
      await this._initPromise;
      await fs.appendFile(this.filePath, line, 'utf8');
    });

    return this._writeQueue;
  }
}
