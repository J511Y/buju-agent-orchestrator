import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TMP_DIR = path.resolve(ROOT, 'tmp');
const RUNNER_ARTIFACT_PATH = path.join(TMP_DIR, 'live-strategy-runner-latest.json');
const DIRECTOR_ARTIFACT_PATH = path.join(TMP_DIR, 'strategy-director-latest.json');
const THINKING_ARTIFACT_PATH = path.join(TMP_DIR, 'thinking-post.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asTimestamp(value) {
  const n = asNumber(value);
  return n === null ? 0 : n;
}

function mentionCount(rows, pattern) {
  return rows.reduce((count, row) => {
    const text = `${row.reasoning || ''} ${row.action_detail || ''} ${row.result?.message || ''}`;
    return count + ((text.match(pattern) || []).length);
  }, 0);
}

function signalDelta(rows, pattern) {
  const splitIndex = Math.max(1, Math.ceil(rows.length / 2));
  const firstHalf = rows.slice(0, splitIndex);
  const secondHalf = rows.slice(splitIndex);
  const first = mentionCount(firstHalf, pattern);
  const second = mentionCount(secondHalf.length ? secondHalf : firstHalf, pattern);
  return { first, second, delta: second - first };
}

function loadThinkingRows() {
  const files = fs.existsSync(TMP_DIR)
    ? fs.readdirSync(TMP_DIR).filter(file => (
        file.startsWith('thinking-post-')
        && file.endsWith('.json')
        && file !== 'thinking-post.json'
        && !file.startsWith('thinking-post-response-')
      ))
    : [];

  const rows = files
    .map(file => {
      const json = readJson(path.join(TMP_DIR, file));
      return json ? { file, ...json } : null;
    })
    .filter(Boolean)
    .sort((a, b) => asTimestamp(a.tick_number) - asTimestamp(b.tick_number));

  return rows.slice(-20);
}

function computeDelta(first, last) {
  const firstExp = asNumber(first?.context?.exp);
  const lastExp = asNumber(last?.context?.exp);
  return {
    level: (asNumber(last?.context?.level) ?? 0) - (asNumber(first?.context?.level) ?? 0),
    exp: firstExp === null || lastExp === null ? null : (lastExp - firstExp),
    gold: (asNumber(last?.context?.gold) ?? 0) - (asNumber(first?.context?.gold) ?? 0),
    inventory: (asNumber(last?.context?.inventory_count) ?? 0) - (asNumber(first?.context?.inventory_count) ?? 0)
  };
}

function buildKeepEvidence(delta) {
  const evidence = [];
  if ((delta.level ?? 0) > 0) evidence.push(`level +${delta.level}`);
  if ((delta.exp ?? 0) > 0) evidence.push(`exp +${delta.exp}`);
  if ((delta.gold ?? 0) > 0) evidence.push(`gold +${delta.gold}`);
  if ((delta.inventory ?? 0) < 0) evidence.push(`inventory ${delta.inventory}`);
  return evidence;
}

function buildPressureEvidence(label, deltaValue) {
  if (deltaValue < 0) return `${label} ${deltaValue}`;
  return null;
}

function buildRegressionSignals(delta, deathSignals, rateLimitSignals) {
  const regressions = [];
  if ((delta.gold ?? 0) < 0) regressions.push(`gold ${delta.gold}`);
  if ((delta.inventory ?? 0) > 0) regressions.push(`inventory +${delta.inventory}`);
  if (deathSignals.delta > 0) regressions.push(`death/defeat pressure +${deathSignals.delta}`);
  if (rateLimitSignals.delta > 0) regressions.push(`rate-limit pressure +${rateLimitSignals.delta}`);
  return regressions;
}

function buildKpiTarget(currentExp, currentGold, adaptiveDecision) {
  const waitBudget = adaptiveDecision === 'CHANGE' ? '2/20' : '3/20';
  const expTarget = asNumber(currentExp);
  const goldTarget = asNumber(currentGold);
  if (expTarget !== null && goldTarget !== null) {
    return `deaths=0, inventory<=8, wait_combat_start_rate_limit+wait_combat_start_cooldown<=${waitBudget}, progression exp>=${expTarget + 120} or gold>=${goldTarget + 10}`;
  }
  if (goldTarget !== null) {
    return `deaths=0, inventory<=8, wait_combat_start_rate_limit+wait_combat_start_cooldown<=${waitBudget}, progression gold>=${goldTarget + 10}`;
  }
  return `deaths=0, inventory<=8, wait_combat_start_rate_limit+wait_combat_start_cooldown<=${waitBudget}`;
}

function clipActionDetail(text, max = 200) {
  const raw = String(text || '');
  return raw.length <= max ? raw : raw.slice(0, max - 1);
}

function main() {
  const rows = loadThinkingRows();
  if (!rows.length) {
    throw new Error('no thinking-post-*.json files found in tmp/');
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const delta = computeDelta(first, last);
  const deathSignals = signalDelta(rows, /death|defeat/gi);
  const rateLimitSignals = signalDelta(rows, /rate|429|cooldown/gi);
  const deathMentions = deathSignals.first + deathSignals.second;
  const rateLimitMentions = rateLimitSignals.first + rateLimitSignals.second;
  const keepEvidence = buildKeepEvidence(delta);
  const pressureEvidence = [
    buildPressureEvidence('death/defeat pressure', deathSignals.delta),
    buildPressureEvidence('rate-limit pressure', rateLimitSignals.delta)
  ].filter(Boolean);
  const improvementEvidence = [...keepEvidence, ...pressureEvidence];
  const regressionSignals = buildRegressionSignals(delta, deathSignals, rateLimitSignals);
  const adaptiveDecision = improvementEvidence.length > regressionSignals.length ? 'KEEP' : 'CHANGE';

  const runnerArtifact = readJson(RUNNER_ARTIFACT_PATH);
  const latestContext = {
    hp_pct: runnerArtifact?.last_result?.hp_pct ?? last.context?.hp_pct ?? null,
    mp_pct: runnerArtifact?.last_result?.mp_pct ?? last.context?.mp_pct ?? null,
    level: runnerArtifact?.last_result?.level ?? last.context?.level ?? null,
    exp: runnerArtifact?.last_result?.exp ?? last.context?.exp ?? null,
    area: last.context?.area ?? null,
    gold: runnerArtifact?.last_result?.gold ?? last.context?.gold ?? null,
    inventory_count: last.context?.inventory_count ?? null,
    inventory_max: last.context?.inventory_max ?? 30,
    available_actions: last.context?.available_actions ?? [],
    adaptive_delta_last20: {
      level: delta.level,
      exp: delta.exp,
      gold: delta.gold,
      inventory: delta.inventory,
      death_mentions_total: deathMentions,
      rate_limit_mentions_total: rateLimitMentions,
      death_mentions_first_half: deathSignals.first,
      death_mentions_second_half: deathSignals.second,
      death_signal_delta: deathSignals.delta,
      rate_limit_mentions_first_half: rateLimitSignals.first,
      rate_limit_mentions_second_half: rateLimitSignals.second,
      rate_limit_signal_delta: rateLimitSignals.delta
    },
    safest_efficiency_monster: runnerArtifact?.last_result?.monster_id || 'skeleton'
  };

  const targetMonster = latestContext.safest_efficiency_monster;
  const kpiTarget = buildKpiTarget(latestContext.exp, latestContext.gold, adaptiveDecision);
  const reasoning = adaptiveDecision === 'KEEP'
    ? `KEEP with evidence: last-20 thinking deltas improved (${improvementEvidence.join(', ')}), and regression count stayed below improvement count (${regressionSignals.length} regressions). Safety remains strict: safest high-efficiency target stays ${targetMonster}, movement remains gated by BUJU_MOVE_LEVEL_2=30, and pressure deltas stay explicit (death/defeat ${deathSignals.first}->${deathSignals.second}, rate/429/cooldown ${rateLimitSignals.first}->${rateLimitSignals.second}).`
    : `CHANGE required by evidence: last-20 thinking deltas were mixed and not KEEP-safe (level ${delta.level >= 0 ? '+' : ''}${delta.level}, exp ${delta.exp === null ? 'n/a' : `${delta.exp >= 0 ? '+' : ''}${delta.exp}`}, gold ${delta.gold >= 0 ? '+' : ''}${delta.gold}, death/defeat ${deathSignals.first}->${deathSignals.second}, rate/429/cooldown ${rateLimitSignals.first}->${rateLimitSignals.second}). Preserve hard safety constraints while changing one reversible logic path this cycle: surrender early for worse-than-equipped cleanup at slots>=10 and pick the safest monster inside the top efficiency band.`;

  const actionDetail = adaptiveDecision === 'KEEP'
    ? `keep:inv=10/8/10(worse-first>=10),safest=${targetMonster},moveGate=lv30,BiS(slot+maxDamage+defBonus),enhance=weapon-first-when-prereqs-and-safety-pass`
    : `change:cleanupSurrenderAt10ForWorseGear=1;safestHighEfficiencyBand=0.95(base)/0.98(pressure);inv=10/8/10(worse-first>=10);safest=${targetMonster};moveGate=lv30;BiS(slot+maxDamage+defBonus);enhance=weapon-first-when-prereqs-and-safety-pass`;

  const artifact = {
    generated_at: new Date().toISOString(),
    source: {
      thinking_files: rows.map(row => row.file),
      runner_artifact: fs.existsSync(RUNNER_ARTIFACT_PATH) ? path.relative(ROOT, RUNNER_ARTIFACT_PATH) : null
    },
    adaptive_decision: adaptiveDecision,
    keep_evidence: improvementEvidence,
    regressions: regressionSignals,
    delta: {
      ...delta,
      death_signal_delta: deathSignals.delta,
      rate_limit_signal_delta: rateLimitSignals.delta
    },
    signals: {
      death_mentions: deathMentions,
      rate_limit_mentions: rateLimitMentions,
      death_mentions_first_half: deathSignals.first,
      death_mentions_second_half: deathSignals.second,
      rate_limit_mentions_first_half: rateLimitSignals.first,
      rate_limit_mentions_second_half: rateLimitSignals.second
    },
    latest_context: latestContext,
    reasoning,
    next_kpi_target: kpiTarget
  };

  const thinkingPayload = {
    decision_type: 'status_check',
    context: latestContext,
    reasoning,
    action_detail: clipActionDetail(actionDetail),
    result: {
      success: adaptiveDecision === 'KEEP',
      message: `Next 30m KPI: ${kpiTarget}; daemon continuous.`
    },
    character_name: last.character_name || 'j211y',
    tick_number: Date.now()
  };

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(DIRECTOR_ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(THINKING_ARTIFACT_PATH, JSON.stringify(thinkingPayload, null, 2));

  console.log(JSON.stringify({
    adaptive_decision: adaptiveDecision,
    delta,
    death_mentions: deathMentions,
    rate_limit_mentions: rateLimitMentions,
    next_kpi_target: kpiTarget
  }, null, 2));
}

main();
