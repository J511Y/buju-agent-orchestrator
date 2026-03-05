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
  delayMs: Number(process.env.BUJU_BASE_DELAY_MS || 250),
  maxActions: Number(process.env.BUJU_MAX_ACTIONS_PER_CYCLE || 30),
  minHpPotionS: Number(process.env.BUJU_MIN_HP_POTION_S || 5),
  minMpPotionS: Number(process.env.BUJU_MIN_MP_POTION_S || 3),
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
  invMaxSlots: Number(process.env.BUJU_INV_MAX_SLOTS || 30),
  stall400Threshold: Number(process.env.BUJU_STALL_400_THRESHOLD || 2),
  stallCooldownTicks: Number(process.env.BUJU_STALL_COOLDOWN_TICKS || 8),
  buyCooldownTicks: Number(process.env.BUJU_BUY_COOLDOWN_TICKS || 6),
  minBuyQty: Number(process.env.BUJU_MIN_BUY_QTY || 5)
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

  if (res.status === 429 && retryCount < 2) {
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

function usedSlots(inventory, invResJson) {
  const count = Number(invResJson?.inventory_count);
  if (Number.isFinite(count) && count > 0) return count;
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

async function ensureMutationShield(c, inventory) {
  if ((c.level || 1) < CFG.mutationLevel) return null;
  if (shouldSkipAction('mutation_shield')) return null;

  const hasBuff = (c.active_buffs || []).some(b => (b.name || b.buff_id || '').includes('mutation_shield'));
  if (hasBuff) return null;

  const charmQty = qty(inventory, 'mutation_shield_charm');
  if (charmQty < CFG.mutationCharmStock) {
    const need = CFG.mutationCharmStock - charmQty;
    const estimatedCost = need * 300;
    if ((c.gold || 0) - estimatedCost < CFG.minGoldReserve) return null;
    const buy = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'mutation_shield_charm', quantity: need }) });
    recordActionResult('mutation_shield', buy.status);
    return { ok: buy.status === 200, action: 'buy_mutation_charm', qty: need, code: buy.status, softFail: buy.status === 400 };
  }

  const use = await req('/item/use', { method: 'POST', body: JSON.stringify({ item_id: 'mutation_shield_charm', action: 'use' }) });
  recordActionResult('mutation_shield', use.status);
  return { ok: use.status === 200, action: 'use_mutation_charm', code: use.status, softFail: use.status === 400 };
}

function chooseHpPotionId(inventory) {
  return ['hp_potion_l', 'hp_potion_m', 'hp_potion_s'].find(id => qty(inventory, id) > 0) || null;
}

let tickCounter = 0;
let lastBuyTick = -9999;

async function step() {
  tickCounter += 1;

  const st = await req('/status');
  if (st.status !== 200) return { ok: false, reason: 'status_fail', code: st.status };
  const c = st.json.character;

  const invRes = await req('/inventory');
  const inventory = invRes.status === 200 ? invRes.json.inventory || [] : [];
  const equipped = invRes.status === 200 ? invRes.json.equipped || {} : {};
  const slotUsed = usedSlots(inventory, invRes.json);

  // Priority 1: inventory full-risk guard.
  if (slotUsed >= CFG.invSellTriggerSlots && !shouldSkipAction('inventory_sell')) {
    const target = chooseSellCandidate(inventory, equipped);
    if (target) {
      const s = await req('/shop/sell', { method: 'POST', body: JSON.stringify({ item_id: target.item_id, quantity: 1 }) });
      recordActionResult('inventory_sell', s.status);
      if (s.status === 200) {
        return { ok: true, action: 'sell_low_tier', item_id: target.item_id, slots_used: slotUsed, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
      // Soft-fail on repeated 400; continue hunt path without stalling this tick.
    }
  }

  const hpRatio = (c.hp?.current || 0) / Math.max(1, c.hp?.max || 1);

  // Priority 2: potion-over-rest economics.
  if (hpRatio < CFG.lowHpPotionRatio) {
    const hpPotionId = chooseHpPotionId(inventory);
    if (hpPotionId && !shouldSkipAction('hp_potion_use')) {
      const usePotion = await req('/item/use', { method: 'POST', body: JSON.stringify({ item_id: hpPotionId, action: 'use' }) });
      recordActionResult('hp_potion_use', usePotion.status);
      if (usePotion.status === 200) {
        return { ok: true, action: 'use_hp_potion', item_id: hpPotionId, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
      }
      // 400 soft-fail => continue to rest/hunt path.
    }
  }

  if (hpRatio < CFG.lowHpRatio) {
    const r = await req('/rest', { method: 'POST', body: '{}' });
    recordActionResult('rest', r.status);
    return { ok: r.status === 200, action: 'rest', level: c.level, exp: c.exp, gold: c.gold, code: r.status };
  }

  const mutationPlan = await ensureMutationShield(c, inventory);
  if (mutationPlan && !mutationPlan.softFail) {
    return { ...mutationPlan, level: c.level, exp: c.exp, gold: c.gold };
  }

  const equipPlan = await chooseBestEquip(inventory, equipped);
  if (equipPlan && !shouldSkipAction('equip')) {
    const r = await req('/item/use', { method: 'POST', body: JSON.stringify({ action: 'equip', item_id: equipPlan.itemId }) });
    recordActionResult('equip', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'equip', item_id: equipPlan.itemId, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // 400 soft-fail => continue
  }

  const hpS = qty(inventory, 'hp_potion_s');
  const mpS = qty(inventory, 'mp_potion_s');
  const canBuyNow = (tickCounter - lastBuyTick) >= CFG.buyCooldownTicks;
  if (canBuyNow && hpS < CFG.minHpPotionS && !shouldSkipAction('buy_hp')) {
    const buyQty = Math.max(CFG.minHpPotionS - hpS, CFG.minBuyQty);
    const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'hp_potion_s', quantity: buyQty }) });
    recordActionResult('buy_hp', r.status);
    if (r.status === 200) {
      lastBuyTick = tickCounter;
      return { ok: true, action: 'buy_hp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
  }
  if (canBuyNow && mpS < CFG.minMpPotionS && !shouldSkipAction('buy_mp')) {
    const buyQty = Math.max(CFG.minMpPotionS - mpS, CFG.minBuyQty);
    const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'mp_potion_s', quantity: buyQty }) });
    recordActionResult('buy_mp', r.status);
    if (r.status === 200) {
      lastBuyTick = tickCounter;
      return { ok: true, action: 'buy_mp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
  }

  const targetArea = pickArea(c.level || 1);
  if (c.current_area !== targetArea && !shouldSkipAction('move')) {
    const r = await req('/move', { method: 'POST', body: JSON.stringify({ area_id: targetArea }) });
    recordActionResult('move', r.status);
    if (r.status === 200) {
      return { ok: true, action: 'move', area: targetArea, level: c.level, exp: c.exp, gold: c.gold, code: 200 };
    }
    // 400 soft-fail => continue hunting in current area.
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
