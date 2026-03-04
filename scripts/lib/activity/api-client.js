import fs from 'node:fs/promises';
import path from 'node:path';

import { CANDIDATE_ENDPOINTS, DEFAULT_ACTIVITY_ENDPOINTS_CONFIG_PATH } from './constants.js';
import { materializeEndpoint } from './common.js';
import { ActivityNetworkError } from './errors.js';
import { hasUsefulSignal, summarizeApiPayload } from './summarizer.js';

/**
 * Reads activity endpoint templates from JSON config.
 * Fallback is deterministic: always use built-in candidates when config is unavailable/invalid.
 *
 * @param {string | undefined} configPath
 * @returns {Promise<string[]>}
 */
async function loadEndpointTemplates(configPath) {
  const resolvedPath = path.resolve(configPath ?? DEFAULT_ACTIVITY_ENDPOINTS_CONFIG_PATH);

  let content;
  try {
    content = await fs.readFile(resolvedPath, 'utf8');
  } catch {
    return CANDIDATE_ENDPOINTS;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return CANDIDATE_ENDPOINTS;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return CANDIDATE_ENDPOINTS;
  }

  const normalized = [];
  for (const item of parsed) {
    if (typeof item !== 'string') {
      return CANDIDATE_ENDPOINTS;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      return CANDIDATE_ENDPOINTS;
    }
    normalized.push(trimmed);
  }

  return normalized;
}

/**
 * Fetches a single candidate endpoint and decodes JSON response when possible.
 */
async function fetchEndpointJson({ baseUrl, endpoint, apiKey, timeoutMs }) {
  const url = new URL(endpoint, baseUrl).toString();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-GQ-API-Key': apiKey
      },
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return {
      endpoint,
      ok: response.ok,
      http_status: response.status,
      json
    };
  } catch (error) {
    throw new ActivityNetworkError(error.message, {
      endpoint,
      cause: error
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * API-first probing strategy: first endpoint with useful signal wins.
 *
 * @returns {{
 *  summary: { progress_delta: object, action_status_counts: object, known_outcomes: object } | null,
 *  source: string | null,
 *  endpoint_statuses: Array<object>
 * }}
 */
export async function probeActivityApi({
  baseUrl,
  hours,
  nowMs,
  sinceMs,
  timeoutMs,
  apiKey,
  skipApi,
  activityEndpointsConfigPath
}) {
  const endpointTemplates = await loadEndpointTemplates(activityEndpointsConfigPath);
  const endpointStatuses = [];

  if (skipApi) {
    for (const endpoint of endpointTemplates) {
      endpointStatuses.push({
        endpoint,
        ok: false,
        status: 'skipped'
      });
    }
    return {
      summary: null,
      source: null,
      endpoint_statuses: endpointStatuses
    };
  }

  if (!apiKey) {
    for (const endpoint of endpointTemplates) {
      endpointStatuses.push({
        endpoint,
        ok: false,
        status: 'missing_api_key'
      });
    }
    return {
      summary: null,
      source: null,
      endpoint_statuses: endpointStatuses
    };
  }

  for (const endpointTemplate of endpointTemplates) {
    const endpoint = materializeEndpoint(endpointTemplate, hours);
    try {
      const response = await fetchEndpointJson({
        baseUrl,
        endpoint,
        apiKey,
        timeoutMs
      });
      endpointStatuses.push({
        endpoint: response.endpoint,
        ok: response.ok,
        http_status: response.http_status
      });

      if (!response.ok) {
        continue;
      }

      const apiSummary = summarizeApiPayload(response.json, sinceMs, nowMs);
      if (apiSummary && hasUsefulSignal(apiSummary)) {
        return {
          summary: apiSummary,
          source: `api:${response.endpoint}`,
          endpoint_statuses: endpointStatuses
        };
      }
    } catch (error) {
      endpointStatuses.push({
        endpoint,
        ok: false,
        status: error instanceof ActivityNetworkError ? error.message : String(error)
      });
    }
  }

  return {
    summary: null,
    source: null,
    endpoint_statuses: endpointStatuses
  };
}
