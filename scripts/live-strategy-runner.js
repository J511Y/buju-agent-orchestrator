import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
function loadEnvFile(file) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile('.env');
loadEnvFile('config/strategy.env');

const API_BASE = 'https://bujuagent.com/api';
const API_KEY = process.env.BUJU_API_KEY;
if (!API_KEY) throw new Error('missing BUJU_API_KEY');
const RUNNER_ARTIFACT_PATH = path.resolve(ROOT, 'tmp/live-strategy-runner-latest.json');

const CFG = {
  delayMs: Number(process.env.BUJU_BASE_DELAY_MS || 1000),
  maxActions: Number(process.env.BUJU_MAX_ACTIONS_PER_CYCLE || 30),
  minHpPotionS: Number(process.env.BUJU_MIN_HP_POTION_S || 5),
  minMpPotionS: Number(process.env.BUJU_MIN_MP_POTION_S || 3),
  minBuyQty: Number(process.env.BUJU_MIN_BUY_QTY || 1),
  lowHpRatio: Number(process.env.BUJU_LOW_HP_RATIO || 0.35),
  lowHpPotionRatio: Number(process.env.BUJU_LOW_HP_POTION_RATIO || 0.55),
  moveLv2: Number(process.env.BUJU_MOVE_LEVEL_2 || 10),
  moveLv3: Number(process.env.BUJU_MOVE_LEVEL_3 || 20),
  area1: process.env.BUJU_AREA_LV1 || 'talking_island_field',
  area2: process.env.BUJU_AREA_LV2 || 'dark_forest',
  area3: process.env.BUJU_AREA_LV3 || 'abandoned_mine',
  maxSafeMonsterLevelGap: Number(process.env.BUJU_MAX_SAFE_MONSTER_LEVEL_GAP || 3),
  minGoldReserve: Number(process.env.BUJU_MIN_GOLD_RESERVE || 300),
  mutationLevel: Number(process.env.BUJU_MUTATION_PREP_LEVEL || 10),
  mutationCharmStock: Number(process.env.BUJU_MUTATION_CHARM_STOCK || 1),
  mutationMinGoldReserve: Number(process.env.BUJU_MUTATION_MIN_GOLD_RESERVE || 120),
  backoffBaseMs: Number(process.env.BUJU_BACKOFF_BASE_MS || 1200),
  backoffMaxMs: Number(process.env.BUJU_BACKOFF_MAX_MS || 5000),
  // Hard constraints (strategy director): keep invariant regardless of env drift.
  invSellTriggerSlots: 10,
  invSellTargetSlots: 8,
  invSellMaxIterationsPerTick: 10,
  invMaxSlots: Number(process.env.BUJU_INV_MAX_SLOTS || 30),
  invSurrenderSlots: Number(process.env.BUJU_INV_SURRENDER_SLOTS || 28),
  potionUseMaxQuantity: Number(process.env.BUJU_POTION_USE_MAX_QUANTITY || 3),
  stall400Threshold: Number(process.env.BUJU_STALL_400_THRESHOLD || 2),
  stallCooldownTicks: Number(process.env.BUJU_STALL_COOLDOWN_TICKS || 8),
  stall429CooldownTicks: Number(process.env.BUJU_STALL_429_COOLDOWN_TICKS || 4),
  retryMaxAttempts: Number(process.env.BUJU_RETRY_MAX_ATTEMPTS || 4),
  useCombatStart: String(process.env.BUJU_USE_COMBAT_START || '1') !== '0',
  enhanceMidLevel: Number(process.env.BUJU_ENHANCE_MID_LEVEL || 10),
  enhanceGoldReserve: Number(process.env.BUJU_ENHANCE_GOLD_RESERVE || 600),
  enhanceCooldownTicks: Number(process.env.BUJU_ENHANCE_COOLDOWN_TICKS || 12),
  combatStrategyRefreshTicks: Number(process.env.BUJU_COMBAT_STRATEGY_REFRESH_TICKS || 12),
  combatStart429FallbackThreshold: Number(process.env.BUJU_COMBAT_START_429_FALLBACK_THRESHOLD || 2),
  combatStart429FallbackTicks: Number(process.env.BUJU_COMBAT_START_429_FALLBACK_TICKS || 10)
};

const stallState = new Map();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeActionKey(actionKey) {
  return actionKey || 'unknown';
}

function shouldSkipAction(actionKey) {
  const key = normalizeActionKey(actionKey);
  const s = stallState.get(key);
  return !!(s && s.untilTick && tickCounter <= s.untilTick);
}

function recordActionResult(actionKey, status) {
  const key = normalizeActionKey(actionKey);
  const prev = stallState.get(key) || { fails400: 0, untilTick: 0 };

  if (status === 400) {
    const fails400 = (prev.fails400 || 0) + 1;
    if (fails400 >= CFG.stall400Threshold) {
      stallState.set(key, { fails400, untilTick: tickCounter + CFG.stallCooldownTicks });
    } else {
      stallState.set(key, { fails400, untilTick: prev.untilTick || 0 });
    }
    return;
  }

  if (status === 429) {
    stallState.set(key, { fails400: prev.fails400 || 0, untilTick: tickCounter + CFG.stall429CooldownTicks });
    return;
  }

  if (status >= 200 && status < 300) {
    stallState.set(key, { fails400: 0, untilTick: 0 });
    return;
  }

  stallState.set(key, prev);
}

async function req(p, opts = {}, retryCount = 0) {
  const res = await fetch(`${API_BASE}${p}`, {
    ...opts,
    headers: {
      'X-GQ-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (res.status === 429 && retryCount < CFG.retryMaxAttempts) {
    const retryAfterSec = Number(res.headers.get('retry-after') || 0);
    const backoff = retryAfterSec > 0
      ? retryAfterSec * 1000
      : Math.min(CFG.backoffMaxMs, CFG.backoffBaseMs * Math.pow(2, retryCount));
    await sleep(backoff);
    return req(p, opts, retryCount + 1);
  }
  return { status: res.status, json };
}

function pickArea(level) {
  if (level >= CFG.moveLv3) return CFG.area3;
  if (level >= CFG.moveLv2) return CFG.area2;
  return CFG.area1;
}

function qty(inv, itemId) {
  return inv.find(i => i.item_id === itemId)?.quantity || 0;
}

function getRateLimitRemaining(rateLimits, key) {
  const remaining = Number(rateLimits?.[key]?.remaining);
  return Number.isFinite(remaining) ? remaining : null;
}

function hasRateBudget(rateLimits, key) {
  const remaining = getRateLimitRemaining(rateLimits, key);
  return remaining === null || remaining > 0;
}

function usedSlots(inventory, invResJson) {
  const explicit = Number(invResJson?.slots?.used);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const count = Number(invResJson?.inventory_count);
  if (Number.isFinite(count) && count >= 0) return count;
  return inventory.length;
}

function equippedItemId(entry) {
  if (!entry) return null;
  return (typeof entry === 'object') ? (entry.item_id || null) : entry;
}

function getEquippedItemReserveMap(equipped) {
  const m = new Map();
  for (const v of Object.values(equipped || {})) {
    const id = equippedItemId(v);
    if (!id) continue;
    m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
}

function rarityRank(rarity) {
  const map = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  return map[String(rarity || '').toLowerCase()] ?? 0;
}

function lowTierHint(item) {
  const n = String(item?.item_id || '').toLowerCase();
  return n.includes('rusty') || n.includes('wooden') || n.includes('old') || n.includes('broken');
}

function chooseSellCandidate(inventory, equipped) {
  const reserveById = getEquippedItemReserveMap(equipped);
  const candidates = (inventory || []).filter(i => {
    if (i.type !== 'equipment') return false;
    const reserve = reserveById.get(i.item_id) || 0;
    return Number(i.quantity || 0) > reserve;
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aR = rarityRank(a.rarity);
    const bR = rarityRank(b.rarity);
    if (aR !== bR) return aR - bR;
    const aLow = lowTierHint(a) ? 0 : 1;
    const bLow = lowTierHint(b) ? 0 : 1;
    if (aLow !== bLow) return aLow - bLow;
    return String(a.item_id).localeCompare(String(b.item_id));
  });

  return candidates[0] || null;
}

function applyLocalSell(inventory, itemId, quantity) {
  const idx = inventory.findIndex(i => i.item_id === itemId && i.type === 'equipment');
  if (idx < 0) return;
  inventory[idx].quantity = Math.max(0, (inventory[idx].quantity || 0) - quantity);
  if (inventory[idx].quantity <= 0) inventory.splice(idx, 1);
}

const itemMetaCache = new Map();

async function getItemMeta(itemId) {
  if (itemMetaCache.has(itemId)) return itemMetaCache.get(itemId);
  const d = await req(`/game-data/items/${itemId}`);
  const data = d.status === 200 ? (d.json?.data || null) : null;
  itemMetaCache.set(itemId, data);
  return data;
}

function equipmentScore(meta) {
  if (!meta) return 0;
  return Number(meta.maxDamage || 0) + Number(meta.defBonus || 0);
}

async function chooseWorseThanEquippedCandidate(inventory, equipped) {
  const equippedBySlot = new Map();
  for (const v of Object.values(equipped || {})) {
    const itemId = equippedItemId(v);
    if (itemId) {
      const m = await getItemMeta(itemId);
      const slot = m?.equipSlot;
      if (!slot) continue;
      equippedBySlot.set(slot, { itemId, score: equipmentScore(m) });
    }
  }

  const candidates = [];
  for (const item of (inventory || [])) {
    if (item.type !== 'equipment') continue;
    const meta = await getItemMeta(item.item_id);
    const slot = meta?.equipSlot;
    if (!slot) continue;
    const eq = equippedBySlot.get(slot);
    if (!eq) continue;
    if (item.item_id === eq.itemId) continue;
    const score = equipmentScore(meta);
    if (score < eq.score) {
      candidates.push({ itemId: item.item_id, quantity: Number(item.quantity || 1), score, eqScore: eq.score });
    }
  }

  candidates.sort((a, b) => (a.score - b.score) || (a.eqScore - b.eqScore) || a.itemId.localeCompare(b.itemId));
  return candidates[0] || null;
}

async function getInventoryCleanupCandidates(inventory, equipped) {
  const worse = await chooseWorseThanEquippedCandidate(inventory, equipped);
  return {
    worse,
    generic: worse ? null : chooseSellCandidate(inventory, equipped)
  };
}

async function getEquippedScoreBySlot(equipped) {
  const bySlot = new Map();
  for (const [slotKey, entry] of Object.entries(equipped || {})) {
    const itemId = equippedItemId(entry);
    if (!itemId) continue;
    const meta = await getItemMeta(itemId);
    const slot = meta?.equipSlot || slotKey;
    bySlot.set(slot, { itemId, score: equipmentScore(meta) });
  }
  return bySlot;
}

async function liquidateInventoryRisk(inventory, equipped, initialSlots, character) {
  if (initialSlots < CFG.invSellTriggerSlots) return null;
  if (shouldSkipAction('inventory_sell')) return null;

  let currentSlots = initialSlots;
  let soldCount = 0;
  const soldItems = [];

  for (let i = 0; i < CFG.invSellMaxIterationsPerTick; i++) {
    // 하드 제약: slots >= trigger 이면 '장착 대비 열위 장비 전량 매각'을 최우선으로 소진한다.
    const worse = await chooseWorseThanEquippedCandidate(inventory, equipped);
    if (worse) {
      const target = { item_id: worse.itemId, quantity: worse.quantity };

      const reserveById = getEquippedItemReserveMap(equipped);
      const reserved = reserveById.get(target.item_id) || 0;
      const sellableQty = Math.max(0, Number(target.quantity || 1) - reserved);
      if (sellableQty <= 0) continue;
      const sellQty = Math.max(1, sellableQty);
      const s = await req('/shop/sell', { method: 'POST', body: JSON.stringify({ item_id: target.item_id, quantity: sellQty }) });
      recordActionResult('inventory_sell', s.status);

      if (s.status !== 200) {
        if (s.status === 400) continue;
        break;
      }

      soldCount += sellQty;
      soldItems.push(`${target.item_id}x${sellQty}`);
      applyLocalSell(inventory, target.item_id, sellQty);
      currentSlots = Math.max(0, currentSlots - 1);
      continue;
    }

    // 열위 장비 정리가 끝났다면 target 슬롯까지 일반 저티어 정리를 이어간다.
    if (currentSlots <= CFG.invSellTargetSlots) break;
    const target = chooseSellCandidate(inventory, equipped);
    if (!target) break;

    const reserveById = getEquippedItemReserveMap(equipped);
    const reserved = reserveById.get(target.item_id) || 0;
    const sellableQty = Math.max(0, Number(target.quantity || 1) - reserved);
    if (sellableQty <= 0) break;
    const sellQty = Math.max(1, sellableQty); // batch-first when stack exists
    const s = await req('/shop/sell', { method: 'POST', body: JSON.stringify({ item_id: target.item_id, quantity: sellQty }) });
    recordActionResult('inventory_sell', s.status);

    if (s.status !== 200) {
      if (s.status === 400) continue;
      break;
    }

    soldCount += sellQty;
    soldItems.push(`${target.item_id}x${sellQty}`);
    applyLocalSell(inventory, target.item_id, sellQty);
    currentSlots = Math.max(0, currentSlots - 1);
  }

  if (soldCount > 0) {
    return {
      ok: true,
      action: 'sell_inventory_cleanup_batch',
      sold_items: soldItems.join(','),
      sold_quantity_total: soldCount,
      slots_used_before: initialSlots,
      slots_used_after: currentSlots,
      level: character.level,
      exp: character.exp,
      gold: character.gold,
      code: 200
    };
  }

  return null;
}

async function chooseBestEquip(inventory, equipped) {
  const eqItems = inventory.filter(i => i.type === 'equipment');
  const bySlot = new Map();
  const equippedBySlot = await getEquippedScoreBySlot(equipped);
  for (const item of eqItems) {
    const data = await getItemMeta(item.item_id);
    if (!data?.equipSlot) continue;
    const slot = data.equipSlot;
    const score = equipmentScore(data);
    const cur = bySlot.get(slot);
    if (!cur || score > cur.score || (score === cur.score && String(item.item_id).localeCompare(String(cur.itemId)) < 0)) {
      bySlot.set(slot, { itemId: item.item_id, score, equipSlot: slot });
    }
  }

  const upgrades = [...bySlot.values()]
    .map(best => {
      const current = equippedBySlot.get(best.equipSlot) || null;
      return {
        ...best,
        currentItemId: current?.itemId || null,
        currentScore: current?.score ?? null,
        upgradeScore: best.score - (current?.score ?? -1)
      };
    })
    .filter(best => !best.currentItemId || best.score > (best.currentScore ?? -1))
    .sort((a, b) => (b.upgradeScore - a.upgradeScore) || String(a.equipSlot).localeCompare(String(b.equipSlot)) || String(a.itemId).localeCompare(String(b.itemId)));

  const bestUpgrade = upgrades[0] || null;
  return bestUpgrade
    ? { action: 'equip', itemId: bestUpgrade.itemId, equipSlot: bestUpgrade.equipSlot, score: bestUpgrade.score, currentItemId: bestUpgrade.currentItemId, currentScore: bestUpgrade.currentScore }
    : null;
}

function chooseBestSkill(skills, currentMp) {
  const available = (skills || []).filter(s => (s.cooldown_remaining || 0) === 0);
  if (!available.length) return 'basic_attack';
  const usable = available.filter(s => (s.mp_cost || 0) <= currentMp);
  const pool = usable.length ? usable : available;
  pool.sort((a, b) => {
    const ap = (a.damage_multiplier || 1) - (a.mp_cost || 0) * 0.01;
    const bp = (b.damage_multiplier || 1) - (b.mp_cost || 0) * 0.01;
    return bp - ap;
  });
  return pool[0]?.skill_id || 'basic_attack';
}

const recentCombatOutcomes = [];
const recentDangerSurrenders = [];
let lastCombatStrategySignature = '';
let lastCombatStrategyTick = 0;
let combatStart429Streak = 0;
let forceHuntUntilTick = 0;

function pushCombatOutcome(outcome) {
  if (!outcome) return;
  recentCombatOutcomes.push(outcome);
  if (recentCombatOutcomes.length > 12) recentCombatOutcomes.shift();
}

function pushDangerSurrender() {
  recentDangerSurrenders.push('danger_surrender');
  if (recentDangerSurrenders.length > 12) recentDangerSurrenders.shift();
}

function recentDefeatCount(windowSize = 8) {
  return recentCombatOutcomes.slice(-windowSize).filter(x => x === 'defeat').length;
}

function recentDangerSurrenderCount(windowSize = 8) {
  return recentDangerSurrenders.slice(-windowSize).length;
}

function chooseMonsterPlan(monsters, player, equipped = {}) {
  if (!monsters.length) {
    return {
      monsterId: 'rabbit',
      selected: { id: 'rabbit', score: 0, danger: 0, efficiency: 0 },
      candidates: [],
      safety: { fallbackMode: 'empty_monster_list', safetyFilteredCount: 0, dynamicGap: CFG.maxSafeMonsterLevelGap, efficiencyBandFloor: 0 }
    };
  }
  const level = Number(player?.level || 1);
  const pAtk = Number(player?.atk || 1);
  const pDef = Number(player?.def || 1);
  const defeatPressure = recentDefeatCount(8);
  const surrenderPressure = recentDangerSurrenderCount(8);
  const pressure = Math.max(defeatPressure, surrenderPressure);
  const sustainedDangerPressure = defeatPressure >= 1 || recentDangerSurrenderCount(4) >= 2;
  const hasArmor = !!(equipped?.armor && (equipped.armor.item_id || equipped.armor));
  const armorRiskPenalty = hasArmor ? 0 : 1;
  const dynamicGap = Math.max(0, CFG.maxSafeMonsterLevelGap - Math.min(2, pressure + armorRiskPenalty));

  const estimateDanger = (m) => {
    const ml = Number(m.level || level);
    const mAtk = Number(m.atk || 0);
    return (Math.max(0, mAtk - pDef) * 1.5) + (Math.max(0, ml - level) * 5);
  };

  const atkGuard = hasArmor ? (pDef * 1.35) : (pDef * 1.15);
  const hardDangerCap = Math.max(4, hasArmor ? 10 : 6) - Math.min(3, pressure);
  const safetyFiltered = monsters.filter(m => {
    const mLevel = Number(m.level || level);
    const mAtk = Number(m.atk || 0);
    const danger = estimateDanger(m);
    return mLevel <= level + dynamicGap && mAtk <= atkGuard && danger <= hardDangerCap;
  });

  const scoreMonster = (m) => {
    const mx = Number(m.exp_reward ?? m.exp ?? 0);
    const ml = Number(m.level || level);
    const mAtk = Number(m.atk || 0);
    const mDef = Number(m.def || 0);
    const kill = Math.max(1, pAtk - mDef);
    const danger = (Math.max(0, mAtk - pDef) * 1.4) + (Math.max(0, ml - level) * 5);
    const efficiency = mx / Math.max(1, 1 + danger);
    return (efficiency * 3) + kill - (danger * 2.5);
  };

  const describeMonster = (m) => {
    const mx = Number(m.exp_reward ?? m.exp ?? 0);
    const ml = Number(m.level || level);
    const mAtk = Number(m.atk || 0);
    const mDef = Number(m.def || 0);
    const kill = Math.max(1, pAtk - mDef);
    const danger = (Math.max(0, mAtk - pDef) * 1.4) + (Math.max(0, ml - level) * 5);
    const efficiency = mx / Math.max(1, 1 + danger);
    const score = (efficiency * 3) + kill - (danger * 2.5);
    return {
      id: m.id,
      level: ml,
      atk: mAtk,
      def: mDef,
      exp_reward: mx,
      danger: Number(danger.toFixed(2)),
      efficiency: Number(efficiency.toFixed(2)),
      score: Number(score.toFixed(2))
    };
  };

  // When dangerous combats cluster, temporarily collapse to the single least-danger target.
  // This prevents the efficiency score from repeatedly pulling the loop back into marginal fights.
  const basePool = safetyFiltered.length
    ? safetyFiltered
    : [...monsters].sort((a, b) => {
        const al = Number(a.level || level);
        const bl = Number(b.level || level);
        const aAtk = Number(a.atk || 0);
        const bAtk = Number(b.atk || 0);
        const aDanger = (Math.max(0, aAtk - pDef) * 1.6) + (Math.max(0, al - level) * 6);
        const bDanger = (Math.max(0, bAtk - pDef) * 1.6) + (Math.max(0, bl - level) * 6);
        if (aDanger !== bDanger) return aDanger - bDanger;
        return scoreMonster(b) - scoreMonster(a);
      }).slice(0, 1);
  const pool = sustainedDangerPressure
    ? [...basePool].sort((a, b) => {
        const aDanger = estimateDanger(a);
        const bDanger = estimateDanger(b);
        if (aDanger !== bDanger) return aDanger - bDanger;
        return scoreMonster(b) - scoreMonster(a);
      }).slice(0, 1)
    : basePool;

  pool.sort((a, b) => {
    const ax = Number(a.exp_reward ?? a.exp ?? 0);
    const bx = Number(b.exp_reward ?? b.exp ?? 0);
    const al = Number(a.level || level);
    const bl = Number(b.level || level);
    const aAtk = Number(a.atk || 0);
    const bAtk = Number(b.atk || 0);
    const aDef = Number(a.def || 0);
    const bDef = Number(b.def || 0);

    const aKill = Math.max(1, pAtk - aDef);
    const bKill = Math.max(1, pAtk - bDef);
    const aDanger = (Math.max(0, aAtk - pDef) * 1.4) + (Math.max(0, al - level) * 5);
    const bDanger = (Math.max(0, bAtk - pDef) * 1.4) + (Math.max(0, bl - level) * 5);
    const aEfficiency = ax / Math.max(1, 1 + aDanger);
    const bEfficiency = bx / Math.max(1, 1 + bDanger);

    const aScore = (aEfficiency * 3) + aKill - (aDanger * 2.5);
    const bScore = (bEfficiency * 3) + bKill - (bDanger * 2.5);
    return bScore - aScore;
  });

  const ranked = pool.map(describeMonster).sort((a, b) => (b.efficiency - a.efficiency) || (a.danger - b.danger) || (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
  const maxEfficiency = ranked[0]?.efficiency ?? 0;
  const efficiencyBandFloor = Number((maxEfficiency * 0.95).toFixed(2));
  const safestHighEfficiencyPool = ranked.filter(candidate => candidate.efficiency >= efficiencyBandFloor);
  const selected = (safestHighEfficiencyPool.length ? safestHighEfficiencyPool : ranked)
    .sort((a, b) => (a.danger - b.danger) || (b.efficiency - a.efficiency) || (b.score - a.score) || String(a.id).localeCompare(String(b.id)))[0]
    || describeMonster(monsters[0]);
  return {
    monsterId: selected.id || 'rabbit',
    selected,
    candidates: ranked,
    safety: {
      defeatPressure,
      surrenderPressure,
      dynamicGap,
      hardDangerCap,
      atkGuard: Number(atkGuard.toFixed(2)),
      safetyFilteredCount: safetyFiltered.length,
      efficiencyBandFloor,
      fallbackMode: sustainedDangerPressure
        ? 'pressure_clamp'
        : (safetyFiltered.length ? 'safety_filtered' : 'lowest_danger_fallback')
    }
  };
}

function chooseMonster(monsters, player, equipped = {}) {
  return chooseMonsterPlan(monsters, player, equipped).monsterId;
}

async function ensureSafeEnhancement(c, inventory, equipped, inCombat, rateLimits, slotUsed, hpRatio) {
  if (inCombat) return null;
  if ((c.level || 1) < CFG.enhanceMidLevel) return null;
  if (!hasRateBudget(rateLimits, 'enhance')) return null;
  if ((c.gold || 0) < CFG.enhanceGoldReserve) return null;
  if (slotUsed >= CFG.invSellTriggerSlots) return null;
  if (hpRatio < Math.max(0.7, CFG.lowHpRatio + 0.15)) return null;
  if (recentDefeatCount(8) > 0 || recentDangerSurrenderCount(8) > 0) return null;

  const npcs = await req('/npc/list');
  if (npcs.status !== 200) return null;
  const npcList = npcs.json?.npcs || [];
  const smith = npcList.find(n => {
    const t = String(n.type || '').toLowerCase();
    const nname = String(n.name || '').toLowerCase();
    return t.includes('blacksmith') || nname.includes('blacksmith') || nname.includes('대장장이');
  });
  if (!smith?.npc_id) return null;

  const isLateGame = (c.level || 1) >= 20 && (c.gold || 0) >= (CFG.enhanceGoldReserve + 400);

  const targets = [];
  const weaponId = (equipped?.weapon && (equipped.weapon.item_id || equipped.weapon)) || null;
  if (weaponId) {
    targets.push({ actionKey: 'enhance_weapon', itemId: weaponId, scrollIds: ['weapon_enchant_scroll', 'enhance_scroll', 'blessed_weapon_enchant_scroll'], actionName: 'enhance_weapon_safe' });
  }

  if (isLateGame) {
    const armorId = (equipped?.armor && (equipped.armor.item_id || equipped.armor)) || null;
    const accessoryId = (equipped?.accessory && (equipped.accessory.item_id || equipped.accessory)) || null;
    if (armorId) {
      targets.push({ actionKey: 'enhance_armor', itemId: armorId, scrollIds: ['armor_enchant_scroll', 'enhance_scroll', 'blessed_armor_enchant_scroll'], actionName: 'enhance_armor_safe' });
    }
    if (accessoryId) {
      targets.push({ actionKey: 'enhance_accessory', itemId: accessoryId, scrollIds: ['accessory_enchant_scroll', 'enhance_scroll', 'blessed_accessory_enchant_scroll'], actionName: 'enhance_accessory_safe' });
    }
  }

  for (const target of targets) {
    if (shouldSkipAction(target.actionKey)) continue;
    const scrollId = target.scrollIds.find(id => qty(inventory, id) > 0);
    if (!scrollId) continue;

    const payload = { item_id: target.itemId, scroll_item_id: scrollId };
    const e = await req(`/npc/${smith.npc_id}/enhance`, { method: 'POST', body: JSON.stringify(payload) });
    recordActionResult(target.actionKey, e.status);
    if (e.status !== 200) continue;

    stallState.set(target.actionKey, { fails400: 0, untilTick: tickCounter + CFG.enhanceCooldownTicks });
    const enhancementStage = target.actionKey === 'enhance_weapon' ? 'mid_weapon_first' : 'late_broadened_slots';
    return { ok: true, action: target.actionName, item_id: target.itemId, scroll_item_id: scrollId, npc_id: smith.npc_id, enhancement_stage: enhancementStage, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
  }

  return null;
}

async function ensureMutationShield(c, inventory, inCombat, rateLimits) {
  if ((c.level || 1) < CFG.mutationLevel) return null;
  if (shouldSkipAction('mutation_shield')) return null;

  const hasBuff = (c.active_buffs || []).some(b => (b.name || b.buff_id || '').includes('mutation_shield'));
  if (hasBuff) return null;

  const charmQty = qty(inventory, 'mutation_shield_charm');
  if (charmQty < CFG.mutationCharmStock) {
    if (inCombat) return null; // v1.14+: shop buy blocked during combat
    if (!hasRateBudget(rateLimits, 'buy')) return null;
    const need = CFG.mutationCharmStock - charmQty;
    const estimatedCost = need * 300;
    // Safety-critical exception: mutation-shield prep should not be blocked by a high generic reserve.
    // Use a dedicated lower floor to prevent repeated movement deaths when no charm is stocked.
    const mutationReserveFloor = Math.min(CFG.minGoldReserve, CFG.mutationMinGoldReserve);
    if ((c.gold || 0) - estimatedCost < mutationReserveFloor) return null;
    const buy = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'mutation_shield_charm', quantity: need }) });
    recordActionResult('mutation_shield', buy.status);
    return { ok: buy.status === 200, action: 'buy_mutation_charm', qty: need, code: buy.status, softFail: buy.status === 400 };
  }

  if (!hasRateBudget(rateLimits, 'use_item')) return null;
  const use = await req('/item/use', { method: 'POST', body: JSON.stringify({ item_id: 'mutation_shield_charm', action: 'use', quantity: 1 }) });
  recordActionResult('mutation_shield', use.status);
  return { ok: use.status === 200, action: 'use_mutation_charm', code: use.status, softFail: use.status === 400 };
}

function chooseHpPotionPlan(inventory, hpCurrent, hpMax) {
  const hpDeficit = Math.max(0, hpMax - hpCurrent);
  const options = [
    { id: 'hp_potion_l', restore: 400, have: qty(inventory, 'hp_potion_l') },
    { id: 'hp_potion_m', restore: 150, have: qty(inventory, 'hp_potion_m') },
    { id: 'hp_potion_s', restore: 50, have: qty(inventory, 'hp_potion_s') }
  ].filter(x => x.have > 0);
  if (!options.length) return null;

  options.sort((a, b) => b.restore - a.restore);
  for (const p of options) {
    const needed = Math.max(1, Math.ceil(hpDeficit / p.restore));
    const quantity = Math.max(1, Math.min(p.have, needed, CFG.potionUseMaxQuantity));
    if (quantity > 0) return { itemId: p.id, quantity };
  }
  return null;
}

let tickCounter = 0;

function writeRunnerArtifact(summary, lastResult) {
  const previous = fs.existsSync(RUNNER_ARTIFACT_PATH)
    ? JSON.parse(fs.readFileSync(RUNNER_ARTIFACT_PATH, 'utf8'))
    : null;
  const hasFreshResult = !!(lastResult && Object.keys(lastResult).length > 0);
  const payload = {
    generated_at: new Date().toISOString(),
    summary: hasFreshResult ? summary : (previous?.summary || summary),
    last_result: hasFreshResult ? lastResult : (previous?.last_result || null),
    hard_constraints: {
      inv_sell_trigger_slots: CFG.invSellTriggerSlots,
      inv_sell_target_slots: CFG.invSellTargetSlots,
      inv_sell_max_iterations_per_tick: CFG.invSellMaxIterationsPerTick
    },
    config_snapshot: {
      base_delay_ms: CFG.delayMs,
      max_actions_per_cycle: CFG.maxActions,
      move_level_2: CFG.moveLv2,
      move_level_3: CFG.moveLv3,
      area_lv1: CFG.area1,
      area_lv2: CFG.area2,
      area_lv3: CFG.area3,
      max_safe_monster_level_gap: CFG.maxSafeMonsterLevelGap,
      min_gold_reserve: CFG.minGoldReserve,
      enhance_mid_level: CFG.enhanceMidLevel,
      enhance_gold_reserve: CFG.enhanceGoldReserve,
      enhance_cooldown_ticks: CFG.enhanceCooldownTicks,
      use_combat_start: CFG.useCombatStart
    },
    stall_state: [...stallState.entries()].map(([actionKey, state]) => ({ actionKey, ...state })),
    last_dry_run_at: hasFreshResult ? (previous?.last_dry_run_at || null) : new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(RUNNER_ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(RUNNER_ARTIFACT_PATH, JSON.stringify(payload, null, 2));
}

async function step() {
  tickCounter += 1;

  const st = await req('/status');
  if (st.status !== 200) return { ok: false, reason: 'status_fail', code: st.status };
  const c = st.json.character;
  const rateLimits = st.json.rate_limits || {};

  const invRes = await req('/inventory');
  const inventory = invRes.status === 200 ? invRes.json.inventory || [] : [];
  const equipped = invRes.status === 200 ? invRes.json.equipped || {} : {};
  const slotUsed = usedSlots(inventory, invRes.json);
  const inCombat = !!(c.combat?.in_progress);
  const hpRatio = (c.hp?.current || 0) / Math.max(1, c.hp?.max || 1);

  const hasWeapon = !!(equipped?.weapon && (equipped.weapon.item_id || equipped.weapon));
  const hasArmor = !!(equipped?.armor && (equipped.armor.item_id || equipped.armor));
  const emergencyEquipPlan = (!hasWeapon || !hasArmor)
    ? await chooseBestEquip(inventory, equipped)
    : null;

  // Priority 1: inventory full-risk guard (batch-first sell where possible).
  // 전투 중이면 sell 불가이므로 슬롯 압박 시 먼저 항복 후 정리한다.
  const cleanupCandidates = await getInventoryCleanupCandidates(inventory, equipped);
  const hasCleanupCandidateNow = !!(cleanupCandidates.worse || cleanupCandidates.generic);
  const shouldForceWorseGearCleanup = slotUsed >= CFG.invSellTriggerSlots && !!cleanupCandidates.worse;
  const shouldForceOverflowCleanup = slotUsed >= CFG.invSurrenderSlots && hasCleanupCandidateNow;
  if ((shouldForceWorseGearCleanup || shouldForceOverflowCleanup) && inCombat && hasRateBudget(rateLimits, 'surrender') && !shouldSkipAction('surrender_inventory')) {
    const surrender = await req('/combat/surrender', { method: 'POST', body: '{}' });
    recordActionResult('surrender_inventory', surrender.status);
    if (surrender.status === 200) {
      const invAfter = await req('/inventory');
      const inventoryAfter = invAfter.status === 200 ? invAfter.json.inventory || [] : inventory;
      const equippedAfter = invAfter.status === 200 ? invAfter.json.equipped || {} : equipped;
      const slotsAfter = usedSlots(inventoryAfter, invAfter.json || {});
      const soldAfter = hasRateBudget(rateLimits, 'sell')
        ? await liquidateInventoryRisk(inventoryAfter, equippedAfter, slotsAfter, c)
        : null;
      if (soldAfter) return { ...soldAfter, action: `surrender_then_${soldAfter.action}` };
      // 매각 대상이 없으면 항복 반복하지 않고 전투/사냥 루프로 복귀
    }
  }

  const sellResult = (!inCombat && hasRateBudget(rateLimits, 'sell'))
    ? await liquidateInventoryRisk(inventory, equipped, slotUsed, c)
    : null;
  if (sellResult) return sellResult;

  // 시즌 초기화 직후 안전장치: 무기/방어구 미착용 상태면 전투보다 장착을 최우선
  if ((!hasWeapon || !hasArmor) && emergencyEquipPlan && inCombat && hasRateBudget(rateLimits, 'surrender') && !shouldSkipAction('surrender_for_equip')) {
    const sr = await req('/combat/surrender', { method: 'POST', body: '{}' });
    recordActionResult('surrender_for_equip', sr.status);
    if (sr.status === 200) {
      return { ok: true, action: 'surrender_for_equip', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
  }

  // 안전 우선: 현재 전투 몬스터가 과도하게 위험하면 즉시 항복 후 안전 지역 복귀를 유도
  if (inCombat && hasRateBudget(rateLimits, 'surrender') && !shouldSkipAction('danger_surrender')) {
    const curMonsterId = c.combat?.monster_id;
    if (curMonsterId) {
      const monRes = await req(`/areas/${c.current_area}/monsters`);
      const mons = monRes.status === 200 ? (monRes.json?.monsters || []) : [];
      const curMon = mons.find(m => m.id === curMonsterId);
      if (curMon) {
        const mLevel = Number(curMon.level || c.level || 1);
        const mAtk = Number(curMon.atk || 0);
        const defeatPressure = recentDefeatCount(8);
        const surrenderPressure = recentDangerSurrenderCount(8);
        const riskClampActive = surrenderPressure >= 2 || defeatPressure >= 1;
        const levelGapCap = riskClampActive ? 1 : 2;
        const damageFactorCap = riskClampActive ? 1.45 : 1.6;
        const tooHighLevel = mLevel > (Number(c.level || 1) + levelGapCap);
        const tooHighDamage = mAtk > Number(c.def || 1) * damageFactorCap;
        const combatSurrenderHpRatio = Math.max(0.4, CFG.lowHpRatio + 0.05);
        if (hpRatio < combatSurrenderHpRatio || tooHighLevel || tooHighDamage) {
          const sr = await req('/combat/surrender', { method: 'POST', body: '{}' });
          recordActionResult('danger_surrender', sr.status);
          if (sr.status === 200) {
            pushDangerSurrender();
            return { ok: true, action: 'surrender_dangerous_combat', monster_id: curMonsterId, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
          }
        }
      }
    }
  }

  // Priority 2: potion-over-rest economics (batch-first use where quantity is supported).
  if (hpRatio < CFG.lowHpPotionRatio) {
    const hpPlan = chooseHpPotionPlan(inventory, c.hp?.current || 0, c.hp?.max || 0);
    if (hpPlan && !shouldSkipAction('hp_potion_use') && hasRateBudget(rateLimits, 'use_item')) {
      const usePotion = await req('/item/use', { method: 'POST', body: JSON.stringify({ item_id: hpPlan.itemId, action: 'use', quantity: hpPlan.quantity }) });
      recordActionResult('hp_potion_use', usePotion.status);
      if (usePotion.status === 200) {
        return { ok: true, action: 'use_hp_potion_batch', item_id: hpPlan.itemId, quantity: hpPlan.quantity, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
      // 400 soft-fail => continue to rest/hunt path.
    }
  }

  if (!inCombat && (!hasWeapon || !hasArmor)) {
    const emergencyEquip = emergencyEquipPlan;
    if (emergencyEquip) {
      if (!hasRateBudget(rateLimits, 'use_item')) {
        return { ok: true, action: 'wait_use_item_rate_limit_for_equip', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
      const er = await req('/item/use', { method: 'POST', body: JSON.stringify({ action: 'equip', item_id: emergencyEquip.itemId }) });
      recordActionResult('equip', er.status);
      if (er.status === 200) {
        return { ok: true, action: 'equip_emergency', item_id: emergencyEquip.itemId, equip_slot: emergencyEquip.equipSlot, item_score: emergencyEquip.score, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
    }
  }

  if (hpRatio <= CFG.lowHpRatio && hasRateBudget(rateLimits, 'rest')) {
    const r = await req('/rest', { method: 'POST', body: '{}' });
    recordActionResult('rest', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'rest', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // soft-fail on 400 to avoid stall; continue to hunt path
  }

  const mutationPlan = await ensureMutationShield(c, inventory, inCombat, rateLimits);
  if (mutationPlan && !mutationPlan.softFail) {
    return { ...mutationPlan, level: c.level, exp: c.exp, gold: c.gold };
  }

  const equipPlan = await chooseBestEquip(inventory, equipped);
  if (!inCombat && equipPlan && !shouldSkipAction('equip') && hasRateBudget(rateLimits, 'use_item')) {
    const r = await req('/item/use', { method: 'POST', body: JSON.stringify({ action: 'equip', item_id: equipPlan.itemId }) });
    recordActionResult('equip', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'equip', item_id: equipPlan.itemId, equip_slot: equipPlan.equipSlot, item_score: equipPlan.score, previous_item_id: equipPlan.currentItemId, previous_item_score: equipPlan.currentScore, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // 400 soft-fail => continue
  }

  const enhancePlan = await ensureSafeEnhancement(c, inventory, equipped, inCombat, rateLimits, slotUsed, hpRatio);
  if (enhancePlan) return enhancePlan;

  const hpS = qty(inventory, 'hp_potion_s');
  const mpS = qty(inventory, 'mp_potion_s');
  if (!inCombat && hpS < CFG.minHpPotionS && !shouldSkipAction('buy_hp') && hasRateBudget(rateLimits, 'buy')) {
    const deficit = CFG.minHpPotionS - hpS;
    const buyQty = Math.max(1, Math.max(CFG.minBuyQty, deficit));
    const estimatedCost = buyQty * 10; // hp_potion_s unit price
    if ((c.gold || 0) - estimatedCost >= CFG.minGoldReserve) {
      const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'hp_potion_s', quantity: buyQty }) });
      recordActionResult('buy_hp', r.status);
      if (r.status === 200) {
        return { ok: true, action: 'buy_hp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
    }
  }
  if (!inCombat && mpS < CFG.minMpPotionS && !shouldSkipAction('buy_mp') && hasRateBudget(rateLimits, 'buy')) {
    const deficit = CFG.minMpPotionS - mpS;
    const buyQty = Math.max(1, Math.max(CFG.minBuyQty, deficit));
    const estimatedCost = buyQty * 10; // mp_potion_s unit price
    if ((c.gold || 0) - estimatedCost >= CFG.minGoldReserve) {
      const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'mp_potion_s', quantity: buyQty }) });
      recordActionResult('buy_mp', r.status);
      if (r.status === 200) {
        return { ok: true, action: 'buy_mp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
    }
  }

  const targetArea = pickArea(c.level || 1);
  const defeatPressure = recentDefeatCount(8);
  const surrenderPressure = recentDangerSurrenderCount(8);
  const safetyRetreatArea = (defeatPressure >= 3 || surrenderPressure >= 2) ? CFG.area1 : null;
  // No-armor safety gate: even if level threshold is met, keep/return to area1 until armor is secured.
  const noArmorAreaOverride = (!hasArmor && c.current_area !== CFG.area1) ? CFG.area1 : null;
  // Strict level-threshold movement gate: below moveLv2, stay/return to area1.
  const thresholdAreaOverride = ((c.level || 1) < CFG.moveLv2 && c.current_area !== CFG.area1) ? CFG.area1 : null;
  const desiredArea = safetyRetreatArea || noArmorAreaOverride || thresholdAreaOverride || targetArea;
  if (!inCombat && c.current_area !== desiredArea && !shouldSkipAction('move') && hasRateBudget(rateLimits, 'move')) {
    const r = await req('/move', { method: 'POST', body: JSON.stringify({ area_id: desiredArea }) });
    recordActionResult('move', r.status);
    if (r.status === 200) {
      const moveAction = safetyRetreatArea
        ? 'move_safety_retreat'
        : (thresholdAreaOverride ? 'move_threshold_fallback' : 'move');
      return { ok: true, action: moveAction, area: desiredArea, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // 400 soft-fail => continue hunting in current area.
  }

  if (!hasRateBudget(rateLimits, 'hunt')) {
    return { ok: true, action: 'wait_hunt_rate_limit', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
  }

  if (inCombat && !CFG.useCombatStart) {
    if (hasRateBudget(rateLimits, 'surrender') && !shouldSkipAction('surrender_stuck_hunt_mode')) {
      const sr = await req('/combat/surrender', { method: 'POST', body: '{}' });
      recordActionResult('surrender_stuck_hunt_mode', sr.status);
      if (sr.status === 200) {
        return { ok: true, action: 'surrender_stuck_hunt_mode', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
    }
    return { ok: true, action: 'wait_combat_resolution_hunt_mode', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
  }

  const skills = await req('/skill/list');
  const skillId = chooseBestSkill(skills.status === 200 ? skills.json.skills : [], c.mp?.current || 0);

  const areaMon = await req(`/areas/${c.current_area}/monsters`);
  const monsters = areaMon.status === 200 ? areaMon.json?.monsters || [] : [];
  const monsterPlan = chooseMonsterPlan(monsters, c, equipped);
  const monsterId = monsterPlan.monsterId;

  if (CFG.useCombatStart) {
    if (tickCounter <= forceHuntUntilTick) {
      const huntFallback = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
      recordActionResult('hunt', huntFallback.status);
      pushCombatOutcome(huntFallback.json?.result?.outcome || huntFallback.json?.result || null);
      return {
        ok: huntFallback.status === 200,
        action: huntFallback.status === 200 ? 'hunt_on_forced_429_fallback' : 'wait_forced_429_fallback',
        monster_id: monsterId,
        selected_monster_score: monsterPlan.selected?.score,
        selected_monster_danger: monsterPlan.selected?.danger,
        selected_monster_efficiency: monsterPlan.selected?.efficiency,
        selected_monster_mode: monsterPlan.safety?.fallbackMode,
        skill_id: skillId,
        result: huntFallback.json?.result,
        level: c.level,
        exp: c.exp,
        gold: c.gold,
        code: huntFallback.status
      };
    }

    if (shouldSkipAction('combat_start')) {
      // Adaptive fallback: if combat_start is cooling down (typically after repeated 429/400),
      // use direct hunt once to keep progression signal instead of pure waiting.
      const huntFallback = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
      recordActionResult('hunt', huntFallback.status);
      pushCombatOutcome(huntFallback.json?.result?.outcome || huntFallback.json?.result || null);
      return {
        ok: huntFallback.status === 200,
        action: huntFallback.status === 200 ? 'hunt_on_combat_cooldown' : 'wait_combat_start_cooldown',
        monster_id: monsterId,
        selected_monster_score: monsterPlan.selected?.score,
        selected_monster_danger: monsterPlan.selected?.danger,
        selected_monster_efficiency: monsterPlan.selected?.efficiency,
        selected_monster_mode: monsterPlan.safety?.fallbackMode,
        skill_id: skillId,
        result: huntFallback.json?.result,
        level: c.level,
        exp: c.exp,
        gold: c.gold,
        code: huntFallback.status
      };
    }

    // 시즌2 자동전투: hunt 액션 예산이 없으면 전략 갱신 호출까지 생략해 제어 호출 churn을 줄인다.
    if (!hasRateBudget(rateLimits, 'hunt')) {
      return { ok: true, action: 'wait_hunt_rate_limit', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }

    // 시즌2 자동전투: 전투 시작 전 전략을 조건부 갱신
    const strategyBody = {
      skill_priority: [skillId || 'basic_attack', 'basic_attack'],
      hp_potion_threshold: Math.round(CFG.lowHpPotionRatio * 100),
      hp_potion_type: 'hp_potion_s',
      mp_potion_threshold: 20,
      mp_potion_type: 'mp_potion_s',
      heal_skill: 'heal',
      pre_combat_buffs: [],
      auto_surrender_threshold: Math.round(CFG.lowHpRatio * 100)
    };
    const strategySignature = JSON.stringify(strategyBody);
    const strategyRefreshNeeded = (strategySignature !== lastCombatStrategySignature)
      || ((tickCounter - lastCombatStrategyTick) >= CFG.combatStrategyRefreshTicks);

    if (strategyRefreshNeeded) {
      const strategy = await req('/combat/strategy', { method: 'POST', body: JSON.stringify(strategyBody) });
      recordActionResult('combat_strategy', strategy.status);
      if (strategy.status === 200) {
        lastCombatStrategySignature = strategySignature;
        lastCombatStrategyTick = tickCounter;
      }
    }

    const combat = await req('/combat/start', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, area: c.current_area }) });
    recordActionResult('combat_start', combat.status);

    if (combat.status === 429) {
      combatStart429Streak = Math.min(6, combatStart429Streak + 1);
      const adaptiveCooldownTicks = CFG.stall429CooldownTicks + Math.min(6, combatStart429Streak);
      const prev = stallState.get('combat_start') || { fails400: 0, untilTick: 0 };
      stallState.set('combat_start', { fails400: prev.fails400 || 0, untilTick: Math.max(prev.untilTick || 0, tickCounter + adaptiveCooldownTicks) });

      if (combatStart429Streak >= CFG.combatStart429FallbackThreshold) {
        forceHuntUntilTick = Math.max(forceHuntUntilTick, tickCounter + CFG.combatStart429FallbackTicks);
      }

      // Adaptive throughput fallback: if combat_start is rate-limited, try one direct hunt to preserve progression signal.
      // Keep safety invariant by reusing the already selected safest monster + skill for this tick.
      const huntFallback = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
      recordActionResult('hunt', huntFallback.status);
      pushCombatOutcome(huntFallback.json?.result?.outcome || huntFallback.json?.result || null);
      if (huntFallback.status === 200) {
        return {
          ok: true,
          action: 'hunt_on_combat_start_rate_limit',
          monster_id: monsterId,
          selected_monster_score: monsterPlan.selected?.score,
          selected_monster_danger: monsterPlan.selected?.danger,
          selected_monster_efficiency: monsterPlan.selected?.efficiency,
          selected_monster_mode: monsterPlan.safety?.fallbackMode,
          skill_id: skillId,
          result: huntFallback.json?.result,
          level: c.level,
          exp: c.exp,
          gold: c.gold,
          code: 200
        };
      }
      return { ok: true, action: 'wait_combat_start_rate_limit', monster_id: monsterId, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }

    if (combat.status === 404 || (combat.status === 400 && String(combat.json?.code || '') === 'API_DEPRECATED')) {
      combatStart429Streak = 0;
      const huntFallback = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
      recordActionResult('hunt', huntFallback.status);
      pushCombatOutcome(huntFallback.json?.result?.outcome || huntFallback.json?.result || null);
      return { ok: huntFallback.status === 200, action: 'hunt_fallback', monster_id: monsterId, selected_monster_score: monsterPlan.selected?.score, selected_monster_danger: monsterPlan.selected?.danger, selected_monster_efficiency: monsterPlan.selected?.efficiency, selected_monster_mode: monsterPlan.safety?.fallbackMode, skill_id: skillId, result: huntFallback.json?.result, level: c.level, exp: c.exp, gold: c.gold, code: huntFallback.status };
    }

    if (combat.status !== 429) {
      combatStart429Streak = 0;
      if (combat.status === 200) forceHuntUntilTick = 0;
    }

    const rewards = combat.json?.rewards || {};
    pushCombatOutcome(combat.json?.result?.outcome || combat.json?.result || null);
    return {
      ok: combat.status === 200,
      action: 'combat_start',
      monster_id: monsterId,
      selected_monster_score: monsterPlan.selected?.score,
      selected_monster_danger: monsterPlan.selected?.danger,
      selected_monster_efficiency: monsterPlan.selected?.efficiency,
      selected_monster_mode: monsterPlan.safety?.fallbackMode,
      combat_result: combat.json?.result,
      reward_exp: rewards.exp,
      reward_gold: rewards.gold,
      level: combat.json?.character?.level ?? c.level,
      exp: combat.json?.character?.exp ?? c.exp,
      gold: combat.json?.character?.gold ?? c.gold,
      code: combat.status
    };
  }

  const hunt = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
  recordActionResult('hunt', hunt.status);
  pushCombatOutcome(hunt.json?.result?.outcome || hunt.json?.result || null);
  return { ok: hunt.status === 200, action: 'hunt', monster_id: monsterId, selected_monster_score: monsterPlan.selected?.score, selected_monster_danger: monsterPlan.selected?.danger, selected_monster_efficiency: monsterPlan.selected?.efficiency, selected_monster_mode: monsterPlan.safety?.fallbackMode, skill_id: skillId, result: hunt.json?.result, level: c.level, exp: c.exp, gold: c.gold, code: hunt.status };
}

async function main() {
  const out = [];
  for (let i = 0; i < CFG.maxActions; i++) {
    const r = await step();
    out.push(r);
    await sleep(CFG.delayMs);
  }
  const okCount = out.filter(x => x.ok).length;
  const last = out[out.length - 1] || {};
  const summary = `live-strategy ok=${okCount}/${out.length} lastAction=${last.action || 'none'} level=${last.level || '?'} exp=${last.exp || '?'} gold=${last.gold || '?'} code=${last.code || '?'}`;
  writeRunnerArtifact(summary, last);
  console.log(summary);
}

main().catch(e => { console.log(`live-strategy error=${e.message}`); process.exit(1); });
