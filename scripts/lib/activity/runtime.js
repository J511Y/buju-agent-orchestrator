import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Best-effort `.env` loader for BUJU_API_KEY (without overriding existing env).
 */
export async function loadDotEnvIfPresent() {
  if (process.env.BUJU_API_KEY) {
    return;
  }
  const envPath = path.resolve('.env');
  let content;
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalIndex).trim();
    if (key !== 'BUJU_API_KEY') {
      continue;
    }
    if (process.env.BUJU_API_KEY) {
      continue;
    }
    const rawValue = line.slice(equalIndex + 1).trim();
    process.env.BUJU_API_KEY = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

/**
 * Parses script CLI options.
 */
export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split('=');

    const readValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        index += 1;
        return next;
      }
      return undefined;
    };

    if (flag === '--skip-api') {
      options.skipApi = true;
      continue;
    }
    if (flag === '--hours') {
      options.hours = readValue();
      continue;
    }
    if (flag === '--base-url') {
      options.baseUrl = readValue();
      continue;
    }
    if (flag === '--log-file') {
      options.logFilePath = readValue();
      continue;
    }
    if (flag === '--activity-endpoints-config') {
      options.activityEndpointsConfigPath = readValue();
      continue;
    }
    if (flag === '--timeout-ms') {
      options.timeoutMs = readValue();
      continue;
    }
    if (flag === '--now-ms') {
      options.nowMs = readValue();
      continue;
    }
  }
  return options;
}
