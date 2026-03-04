import fs from 'node:fs/promises';

const WORKER_EVENT_SCHEMA = 'buju.worker.event.v1';
const EXECUTION_FAILURE_CIRCUIT_OPEN_REASON = 'execution_failure_circuit_open';
const KNOWN_EVENTS = new Set([
  'tick_started',
  'safety_evaluated',
  'tick_blocked',
  'decision_made',
  'action_executed',
  'tick_finished',
  'tick_error'
]);

function createTickState() {
  return {
    started: false,
    safety: false,
    blocked: false,
    decision: false,
    action: false,
    finished: false,
    error: false
  };
}

function parseJsonl(content) {
  const records = [];
  const parseErrors = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    try {
      records.push({
        lineNumber: index + 1,
        data: JSON.parse(line)
      });
    } catch (error) {
      parseErrors.push(`line ${index + 1}: invalid JSON (${error.message})`);
    }
  }

  return { records, parseErrors };
}

function recordError(errors, lineNumber, message) {
  errors.push(`line ${lineNumber}: ${message}`);
}

export function analyzeReplayRecords(records) {
  const validationErrors = [];
  const ticks = new Map();
  const actionStatusCounts = {
    success: 0,
    failed: 0,
    skipped: 0
  };
  const operationalBlockCounts = {
    actionCooldownActive: 0,
    tickTimeout: 0,
    lockHeartbeatFailed: 0,
    executionFailureCircuitOpen: 0
  };
  const executionFailureCircuitOpenTickIds = new Set();
  const safetyReasonCounts = new Map();

  function countExecutionFailureCircuitOpenSkip({ tickId, status, reason }) {
    if (status !== 'skipped' || reason !== EXECUTION_FAILURE_CIRCUIT_OPEN_REASON) {
      return;
    }
    if (executionFailureCircuitOpenTickIds.has(tickId)) {
      return;
    }
    executionFailureCircuitOpenTickIds.add(tickId);
    operationalBlockCounts.executionFailureCircuitOpen += 1;
  }

  for (const entry of records) {
    const { lineNumber, data } = entry;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      recordError(validationErrors, lineNumber, 'record must be an object');
      continue;
    }

    if (data.schema !== WORKER_EVENT_SCHEMA) {
      recordError(validationErrors, lineNumber, `schema must be ${WORKER_EVENT_SCHEMA}`);
    }

    if (Number.isNaN(Date.parse(data.ts))) {
      recordError(validationErrors, lineNumber, 'ts must be a valid ISO datetime');
    }

    if (!KNOWN_EVENTS.has(data.eventType)) {
      recordError(validationErrors, lineNumber, `unknown eventType: ${String(data.eventType)}`);
      continue;
    }

    if (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) {
      recordError(validationErrors, lineNumber, 'payload must be an object');
      continue;
    }

    const tickId = data.payload.tickId;
    if (typeof tickId !== 'string' || !tickId) {
      recordError(validationErrors, lineNumber, 'payload.tickId is required');
      continue;
    }

    let tickState = ticks.get(tickId);
    if (!tickState) {
      tickState = createTickState();
      ticks.set(tickId, tickState);
    }

    switch (data.eventType) {
      case 'tick_started': {
        if (tickState.started) {
          recordError(validationErrors, lineNumber, `duplicate tick_started for ${tickId}`);
          break;
        }
        if (tickState.safety || tickState.decision || tickState.action || tickState.blocked || tickState.finished) {
          recordError(validationErrors, lineNumber, `tick_started out of order for ${tickId}`);
        }
        tickState.started = true;
        break;
      }
      case 'safety_evaluated': {
        if (!tickState.started) {
          recordError(validationErrors, lineNumber, `safety_evaluated before tick_started for ${tickId}`);
        }
        if (tickState.safety || tickState.decision || tickState.action || tickState.blocked || tickState.finished) {
          recordError(validationErrors, lineNumber, `safety_evaluated out of order for ${tickId}`);
        }
        tickState.safety = true;
        break;
      }
      case 'tick_blocked': {
        if (!tickState.started || !tickState.safety) {
          recordError(validationErrors, lineNumber, `tick_blocked before safety_evaluated for ${tickId}`);
        }
        if (tickState.decision || tickState.action || tickState.finished) {
          recordError(validationErrors, lineNumber, `tick_blocked out of order for ${tickId}`);
        }
        const reasons = data.payload.reasons;
        if (!Array.isArray(reasons)) {
          recordError(validationErrors, lineNumber, 'tick_blocked payload.reasons must be an array');
        } else {
          for (const reason of reasons) {
            if (typeof reason !== 'string' || !reason) {
              recordError(validationErrors, lineNumber, 'tick_blocked reasons must be non-empty strings');
              continue;
            }
            safetyReasonCounts.set(reason, (safetyReasonCounts.get(reason) ?? 0) + 1);
          }
        }
        tickState.blocked = true;
        break;
      }
      case 'decision_made': {
        if (!tickState.started || !tickState.safety || tickState.blocked) {
          recordError(validationErrors, lineNumber, `decision_made out of order for ${tickId}`);
        }
        if (tickState.decision || tickState.action || tickState.finished) {
          recordError(validationErrors, lineNumber, `duplicate or late decision_made for ${tickId}`);
        }
        tickState.decision = true;
        break;
      }
      case 'action_executed': {
        if (!tickState.decision || tickState.blocked) {
          recordError(validationErrors, lineNumber, `action_executed before decision_made for ${tickId}`);
        }
        if (tickState.action || tickState.finished) {
          recordError(validationErrors, lineNumber, `duplicate or late action_executed for ${tickId}`);
        }

        const status = data.payload.execution?.status;
        if (status === 'success' || status === 'failed' || status === 'skipped') {
          actionStatusCounts[status] += 1;
        } else {
          recordError(validationErrors, lineNumber, `unknown execution.status: ${String(status)}`);
        }
        if (data.payload.execution?.reason === 'action_cooldown_active') {
          operationalBlockCounts.actionCooldownActive += 1;
        }
        countExecutionFailureCircuitOpenSkip({
          tickId,
          status,
          reason: data.payload.execution?.reason
        });

        tickState.action = true;
        break;
      }
      case 'tick_finished': {
        if (tickState.blocked) {
          if (data.payload.executionStatus !== 'skipped') {
            recordError(validationErrors, lineNumber, `blocked tick_finished must use skipped executionStatus for ${tickId}`);
          }
        } else if (!tickState.action) {
          recordError(validationErrors, lineNumber, `tick_finished before action_executed for ${tickId}`);
        }
        if (tickState.finished) {
          recordError(validationErrors, lineNumber, `duplicate tick_finished for ${tickId}`);
        }
        countExecutionFailureCircuitOpenSkip({
          tickId,
          status: data.payload.executionStatus,
          reason: data.payload.reason
        });
        tickState.finished = true;
        break;
      }
      case 'tick_error': {
        if (tickState.finished || tickState.blocked) {
          recordError(validationErrors, lineNumber, `tick_error after terminal state for ${tickId}`);
        }
        if (data.payload.code === 'ETICK_TIMEOUT') {
          operationalBlockCounts.tickTimeout += 1;
        }
        if (
          typeof data.payload.message === 'string' &&
          data.payload.message.toLowerCase().includes('lock heartbeat failed')
        ) {
          operationalBlockCounts.lockHeartbeatFailed += 1;
        }
        tickState.error = true;
        break;
      }
      default:
        break;
    }
  }

  let blockedTicks = 0;
  for (const [tickId, tickState] of ticks.entries()) {
    if (!tickState.started && !tickState.error) {
      validationErrors.push(`tick ${tickId}: missing tick_started`);
    }
    if (tickState.blocked) {
      blockedTicks += 1;
    } else if (tickState.started && !tickState.finished && !tickState.error) {
      validationErrors.push(`tick ${tickId}: started tick must end with tick_finished or tick_error`);
    }
  }

  const topSafetyReasons = [...safetyReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  const ticksCount = ticks.size;

  return {
    ticks: ticksCount,
    blockedTicks,
    blockedRate: ticksCount === 0 ? 0 : blockedTicks / ticksCount,
    actionStatusCounts,
    operationalBlockCounts,
    topSafetyReasons,
    validationErrors
  };
}

export async function analyzeReplayFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const { records, parseErrors } = parseJsonl(content);
  const summary = analyzeReplayRecords(records);
  return {
    ...summary,
    validationErrors: [...parseErrors, ...summary.validationErrors]
  };
}

export function formatReplaySummary(filePath, summary) {
  const blockedPercent = (summary.blockedRate * 100).toFixed(1);
  const reasons =
    summary.topSafetyReasons.length === 0
      ? 'none'
      : summary.topSafetyReasons.map((item) => `${item.reason}=${item.count}`).join(', ');

  const lines = [
    `Replay log: ${filePath}`,
    `ticks=${summary.ticks} blocked=${summary.blockedTicks} (${blockedPercent}%)`,
    `actions success=${summary.actionStatusCounts.success} fail=${summary.actionStatusCounts.failed} skipped=${summary.actionStatusCounts.skipped}`,
    `operational cooldown_blocks=${summary.operationalBlockCounts?.actionCooldownActive ?? 0} tick_timeouts=${summary.operationalBlockCounts?.tickTimeout ?? 0} lock_heartbeat_failures=${summary.operationalBlockCounts?.lockHeartbeatFailed ?? 0} execution_failure_circuit_blocks=${summary.operationalBlockCounts?.executionFailureCircuitOpen ?? 0}`,
    `top_safety_reasons ${reasons}`
  ];

  if (summary.validationErrors.length === 0) {
    lines.push('validation=ok');
  } else {
    lines.push(`validation=failed (${summary.validationErrors.length})`);
    for (const error of summary.validationErrors.slice(0, 5)) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join('\n');
}
