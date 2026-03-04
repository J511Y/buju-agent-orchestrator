export function decideAction(stateSnapshot) {
  if ((stateSnapshot.healthPct ?? 100) < 35) {
    return {
      fsmState: 'RECOVER',
      ruleId: 'recover-low-health',
      action: { type: 'USE_POTION', targetId: stateSnapshot.selfId }
    };
  }

  if ((stateSnapshot.enemyThreat ?? 0) >= 80) {
    return {
      fsmState: 'DEFEND',
      ruleId: 'defend-high-threat',
      action: { type: 'RAISE_SHIELD', targetId: stateSnapshot.selfId }
    };
  }

  if (
    (stateSnapshot.energy ?? 0) < 30 &&
    stateSnapshot.enemyVisible &&
    (stateSnapshot.enemyThreat ?? 0) >= 50
  ) {
    return {
      fsmState: 'DEFEND_LOW_ENERGY',
      ruleId: 'defend-low-energy-pressure',
      action: { type: 'RAISE_SHIELD', targetId: stateSnapshot.selfId }
    };
  }

  if ((stateSnapshot.energy ?? 0) < 30 && (stateSnapshot.healthPct ?? 0) >= 60) {
    return {
      fsmState: 'RECOVER_ENERGY',
      ruleId: 'recover-energy-safe-window',
      action: { type: 'REST', targetId: null }
    };
  }

  if ((stateSnapshot.energy ?? 0) >= 40 && stateSnapshot.enemyVisible) {
    return {
      fsmState: 'ATTACK',
      ruleId: 'attack-energy-window',
      action: { type: 'BASIC_ATTACK', targetId: stateSnapshot.enemyId }
    };
  }

  return {
    fsmState: 'HOLD',
    ruleId: 'hold-default',
    action: { type: 'WAIT', targetId: null }
  };
}
