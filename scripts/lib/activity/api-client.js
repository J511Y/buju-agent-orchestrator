import { CANDIDATE_ENDPOINTS } from './constants.js';
import { materializeEndpoint } from './common.js';
import { ActivityNetworkError } from './errors.js';
import { hasUsefulSignal, summarizeApiPayload } from './summarizer.js';

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
  skipApi
}) {
  const endpointStatuses = [];

  if (skipApi) {
    for (const endpoint of CANDIDATE_ENDPOINTS) {
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
    for (const endpoint of CANDIDATE_ENDPOINTS) {
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

  for (const endpointTemplate of CANDIDATE_ENDPOINTS) {
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
