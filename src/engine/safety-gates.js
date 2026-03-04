const DEFAULTS = {
  minHealthPct: 30,
  maxPendingActions: 2
};

export function evaluateSafetyGates(stateSnapshot, nowMs = Date.now()) {
  const minHealthPct = stateSnapshot.minHealthPct ?? DEFAULTS.minHealthPct;
  const maxPendingActions = stateSnapshot.maxPendingActions ?? DEFAULTS.maxPendingActions;
  const reasons = [];

  if (stateSnapshot.maintenanceMode) {
    reasons.push('maintenance_mode');
  }

  if ((stateSnapshot.healthPct ?? 100) < minHealthPct) {
    reasons.push('low_health');
  }

  if ((stateSnapshot.pendingActionCount ?? 0) > maxPendingActions) {
    reasons.push('action_queue_saturated');
  }

  if (stateSnapshot.cooldownUntilMs && stateSnapshot.cooldownUntilMs > nowMs) {
    reasons.push('cooldown_active');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    evaluatedAt: new Date(nowMs).toISOString()
  };
}
