import fs from 'node:fs/promises';

import { analyzeReplayRecords } from '../../../src/ops/replay-analyzer.js';
import {
  DEFAULT_ACTION_STATUS_COUNTS,
  DEFAULT_KNOWN_OUTCOMES,
  DEFAULT_PROGRESS_DELTA
} from './constants.js';
import { detectOutcome, extractProgressSnapshot } from './common.js';
import { ActivityFileError } from './errors.js';

function parseReplayJsonlContent(content, sinceMs, nowMs) {
  const filteredRecords = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const tsMs = Date.parse(data?.ts);
    if (Number.isNaN(tsMs)) {
      continue;
    }
    if (tsMs < sinceMs || tsMs > nowMs) {
      continue;
    }
    filteredRecords.push({
      lineNumber: index + 1,
      data
    });
  }
  return filteredRecords;
}

function deriveKnownOutcomesFromReplay(records, actionStatusCounts) {
  let win = 0;
  let defeat = 0;
  for (const entry of records) {
    if (entry.data?.eventType !== 'action_executed') {
      continue;
    }
    const outcome =
      detectOutcome(
        String(entry.data?.payload?.execution?.response?.outcome ?? entry.data?.payload?.outcome ?? '')
      ) ??
      detectOutcome(
        String(entry.data?.payload?.execution?.response?.result ?? entry.data?.payload?.result ?? '')
      );

    if (outcome === 'win') {
      win += 1;
    } else if (outcome === 'defeat') {
      defeat += 1;
    }
  }

  const totalActions = actionStatusCounts.success + actionStatusCounts.failed + actionStatusCounts.skipped;
  return {
    win,
    defeat,
    unknown: Math.max(0, totalActions - win - defeat)
  };
}

function deriveProgressDeltaFromReplay(records) {
  const snapshots = [];
  for (const entry of records) {
    if (entry.data?.eventType !== 'tick_started') {
      continue;
    }
    const tsMs = Date.parse(entry.data?.ts);
    if (Number.isNaN(tsMs)) {
      continue;
    }
    const progress = extractProgressSnapshot(entry.data?.payload ?? {});
    if (!progress) {
      continue;
    }
    snapshots.push({
      tsMs,
      level: progress.level,
      exp: progress.exp,
      gold: progress.gold
    });
  }
  if (snapshots.length < 2) {
    return { ...DEFAULT_PROGRESS_DELTA };
  }

  snapshots.sort((a, b) => a.tsMs - b.tsMs);
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  return {
    level:
      first.level !== null && last.level !== null
        ? last.level - first.level
        : DEFAULT_PROGRESS_DELTA.level,
    exp: first.exp !== null && last.exp !== null ? last.exp - first.exp : DEFAULT_PROGRESS_DELTA.exp,
    gold:
      first.gold !== null && last.gold !== null
        ? last.gold - first.gold
        : DEFAULT_PROGRESS_DELTA.gold
  };
}

/**
 * Reads replay JSONL and derives the same KPI schema used by API summaries.
 * File I/O failures are wrapped by ActivityFileError for clear fallback diagnostics.
 */
export async function summarizeFromLocalReplay(logFilePath, sinceMs, nowMs) {
  let content;
  try {
    content = await fs.readFile(logFilePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        progress_delta: { ...DEFAULT_PROGRESS_DELTA },
        action_status_counts: { ...DEFAULT_ACTION_STATUS_COUNTS },
        known_outcomes: { ...DEFAULT_KNOWN_OUTCOMES }
      };
    }
    throw new ActivityFileError(`failed to read replay log (${logFilePath})`, {
      filePath: logFilePath,
      code: error.code,
      cause: error
    });
  }

  const records = parseReplayJsonlContent(content, sinceMs, nowMs);
  const replaySummary = analyzeReplayRecords(records);
  const actionStatusCounts = replaySummary.actionStatusCounts ?? { ...DEFAULT_ACTION_STATUS_COUNTS };

  return {
    progress_delta: deriveProgressDeltaFromReplay(records),
    action_status_counts: {
      success: actionStatusCounts.success ?? 0,
      failed: actionStatusCounts.failed ?? 0,
      skipped: actionStatusCounts.skipped ?? 0
    },
    known_outcomes: deriveKnownOutcomesFromReplay(records, actionStatusCounts)
  };
}
