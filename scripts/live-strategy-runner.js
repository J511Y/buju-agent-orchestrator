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
  backoffBaseMs: Number(process.env.BUJU_BACKOFF_BASE_MS || 1200),
  backoffMaxMs: Number(process.env.BUJU_BACKOFF_MAX_MS || 5000),
  invSellTriggerSlots: Number(process.env.BUJU_INV_SELL_TRIGGER_SLOTS || 27),
  invSellTargetSlots: Number(process.env.BUJU_INV_SELL_TARGET_SLOTS || 24),
  invSellMaxIterationsPerTick: Number(process.env.BUJU_INV_SELL_MAX_ITERATIONS_PER_TICK || 3),
  invMaxSlots: Number(process.env.BUJU_INV_MAX_SLOTS || 30),
  invSurrenderSlots: Number(process.env.BUJU_INV_SURRENDER_SLOTS || 28),
  potionUseMaxQuantity: Number(process.env.BUJU_POTION_USE_MAX_QUANTITY || 3),
  stall400Threshold: Number(process.env.BUJU_STALL_400_THRESHOLD || 2),
  stallCooldownTicks: Number(process.env.BUJU_STALL_COOLDOWN_TICKS || 8),
  retryMaxAttempts: Number(process.env.BUJU_RETRY_MAX_ATTEMPTS || 4)
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

function getEquippedItemIds(equipped) {
  return new Set(
    Object.values(equipped || {})
      .map(v => (v && typeof v === 'object' ? v.item_id : null))
      .filter(Boolean)
  );
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
  const equippedIds = getEquippedItemIds(equipped);
  const candidates = (inventory || []).filter(i =>
    i.type === 'equipment' &&
    !equippedIds.has(i.item_id)
  );

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

async function liquidateInventoryRisk(inventory, equipped, initialSlots, character) {
  if (initialSlots < CFG.invSellTriggerSlots) return null;
  if (shouldSkipAction('inventory_sell')) return null;

  let currentSlots = initialSlots;
  let soldCount = 0;
  const soldItems = [];

  for (let i = 0; i < CFG.invSellMaxIterationsPerTick; i++) {
    if (currentSlots <= CFG.invSellTargetSlots) break;
    const target = chooseSellCandidate(inventory, equipped);
    if (!target) break;

    const sellQty = Math.max(1, Number(target.quantity || 1)); // batch-first when stack exists
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
      action: 'sell_low_tier_batch',
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
  for (const item of eqItems) {
    const d = await req(`/game-data/items/${item.item_id}`);
    if (d.status !== 200 || !d.json?.data?.equipSlot) continue;
    const data = d.json.data;
    const slot = data.equipSlot;
    const score = (data.maxDamage || 0) + (data.defBonus || 0);
    const cur = bySlot.get(slot);
    if (!cur || score > cur.score) bySlot.set(slot, { itemId: item.item_id, score });
  }

  for (const [slot, best] of bySlot.entries()) {
    const curEquippedId = equipped?.[slot]?.item_id || null;
    if (curEquippedId !== best.itemId) {
      return { action: 'equip', itemId: best.itemId };
    }
  }
  return null;
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

function chooseMonster(monsters, level) {
  if (!monsters.length) return 'rabbit';
  const filtered = monsters.filter(m => (m.level || level) <= level + CFG.maxSafeMonsterLevelGap);
  const pool = filtered.length ? filtered : monsters;
  pool.sort((a, b) => {
    const aExp = a.exp_reward ?? a.exp ?? 0;
    const bExp = b.exp_reward ?? b.exp ?? 0;
    const aRisk = (a.level || level) - level;
    const bRisk = (b.level || level) - level;
    return (bExp - aExp) || (aRisk - bRisk);
  });
  return pool[0]?.id || 'rabbit';
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
    if ((c.gold || 0) - estimatedCost < CFG.minGoldReserve) return null;
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

  // Priority 1: inventory full-risk guard (batch-first sell where possible).
  // 전투 중이면 sell 불가이므로 슬롯 압박 시 먼저 항복 후 정리한다.
  const hasSellCandidateNow = !!chooseSellCandidate(inventory, equipped);
  if (slotUsed >= CFG.invSurrenderSlots && hasSellCandidateNow && inCombat && hasRateBudget(rateLimits, 'surrender') && !shouldSkipAction('surrender_inventory')) {
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

  const hpRatio = (c.hp?.current || 0) / Math.max(1, c.hp?.max || 1);

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

  if (hpRatio < CFG.lowHpRatio && hasRateBudget(rateLimits, 'rest')) {
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
      return { ok: true, action: 'equip', item_id: equipPlan.itemId, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // 400 soft-fail => continue
  }

  const hpS = qty(inventory, 'hp_potion_s');
  const mpS = qty(inventory, 'mp_potion_s');
  if (!inCombat && hpS < CFG.minHpPotionS && !shouldSkipAction('buy_hp') && hasRateBudget(rateLimits, 'buy')) {
    const deficit = CFG.minHpPotionS - hpS;
    const buyQty = Math.max(1, Math.max(CFG.minBuyQty, deficit));
    const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'hp_potion_s', quantity: buyQty }) });
    recordActionResult('buy_hp', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'buy_hp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
  }
  if (!inCombat && mpS < CFG.minMpPotionS && !shouldSkipAction('buy_mp') && hasRateBudget(rateLimits, 'buy')) {
    const deficit = CFG.minMpPotionS - mpS;
    const buyQty = Math.max(1, Math.max(CFG.minBuyQty, deficit));
    const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'mp_potion_s', quantity: buyQty }) });
    recordActionResult('buy_mp', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'buy_mp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
  }

  const targetArea = pickArea(c.level || 1);
  if (!inCombat && c.current_area !== targetArea && !shouldSkipAction('move') && hasRateBudget(rateLimits, 'move')) {
    const r = await req('/move', { method: 'POST', body: JSON.stringify({ area_id: targetArea }) });
    recordActionResult('move', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'move', area: targetArea, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // 400 soft-fail => continue hunting in current area.
  }

  if (!hasRateBudget(rateLimits, 'hunt')) {
    return { ok: true, action: 'wait_hunt_rate_limit', level: c.level, exp: c.exp, gold: c.gold, code: 200 };
  }

  const skills = await req('/skill/list');
  const skillId = chooseBestSkill(skills.status === 200 ? skills.json.skills : [], c.mp?.current || 0);

  const areaMon = await req(`/areas/${c.current_area}/monsters`);
  const monsters = areaMon.status === 200 ? areaMon.json?.monsters || [] : [];
  const monsterId = chooseMonster(monsters, c.level || 1);

  const hunt = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
  recordActionResult('hunt', hunt.status);
  return { ok: hunt.status === 200, action: 'hunt', monster_id: monsterId, skill_id: skillId, result: hunt.json?.result, level: c.level, exp: c.exp, gold: c.gold, code: hunt.status };
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
  console.log(`live-strategy ok=${okCount}/${out.length} lastAction=${last.action || 'none'} level=${last.level || '?'} exp=${last.exp || '?'} gold=${last.gold || '?'} code=${last.code || '?'}`);
}

main().catch(e => { console.log(`live-strategy error=${e.message}`); process.exit(1); });
