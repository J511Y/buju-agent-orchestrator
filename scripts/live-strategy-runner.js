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
  lowHpRatio: Number(process.env.BUJU_LOW_HP_RATIO || 0.35),
  moveLv2: Number(process.env.BUJU_MOVE_LEVEL_2 || 10),
  moveLv3: Number(process.env.BUJU_MOVE_LEVEL_3 || 20),
  area1: process.env.BUJU_AREA_LV1 || 'talking_island_field',
  area2: process.env.BUJU_AREA_LV2 || 'dark_forest',
  area3: process.env.BUJU_AREA_LV3 || 'abandoned_mine'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function req(p, opts = {}, retry = true) {
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

  if (res.status === 429 && retry) {
    await sleep(1000);
    return req(p, opts, false);
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

async function step() {
  const st = await req('/status');
  if (st.status !== 200) return { ok: false, reason: 'status_fail', code: st.status };
  const c = st.json.character;

  const invRes = await req('/api/inventory'.replace('/api','')); // '/inventory'
  const inventory = invRes.status === 200 ? invRes.json.inventory || [] : [];
  const equipped = invRes.status === 200 ? invRes.json.equipped || {} : {};

  const hpRatio = (c.hp?.current || 0) / Math.max(1, c.hp?.max || 1);
  if (hpRatio < CFG.lowHpRatio) {
    const r = await req('/rest', { method: 'POST', body: '{}' });
    return { ok: r.status === 200, action: 'rest', level: c.level, exp: c.exp, gold: c.gold, code: r.status };
  }

  const equipPlan = await chooseBestEquip(inventory, equipped);
  if (equipPlan) {
    const r = await req('/item/use', { method: 'POST', body: JSON.stringify({ action: 'equip', item_id: equipPlan.itemId }) });
    return { ok: r.status === 200, action: 'equip', item_id: equipPlan.itemId, level: c.level, exp: c.exp, gold: c.gold, code: r.status };
  }

  const hpS = qty(inventory, 'hp_potion_s');
  const mpS = qty(inventory, 'mp_potion_s');
  if (hpS < CFG.minHpPotionS) {
    const buyQty = CFG.minHpPotionS - hpS;
    const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'hp_potion_s', quantity: buyQty }) });
    return { ok: r.status === 200, action: 'buy_hp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: r.status };
  }
  if (mpS < CFG.minMpPotionS) {
    const buyQty = CFG.minMpPotionS - mpS;
    const r = await req('/shop/buy', { method: 'POST', body: JSON.stringify({ item_id: 'mp_potion_s', quantity: buyQty }) });
    return { ok: r.status === 200, action: 'buy_mp', qty: buyQty, level: c.level, exp: c.exp, gold: c.gold, code: r.status };
  }

  const targetArea = pickArea(c.level || 1);
  if (c.current_area !== targetArea) {
    const r = await req('/move', { method: 'POST', body: JSON.stringify({ area_id: targetArea }) });
    return { ok: r.status === 200, action: 'move', area: targetArea, level: c.level, exp: c.exp, gold: c.gold, code: r.status };
  }

  const skills = await req('/skill/list');
  const skillId = (skills.status === 200 ? skills.json.skills?.[0]?.skill_id : null) || 'basic_attack';

  const area = await req(`/game-data/areas/${c.current_area}`);
  const monsters = area.status === 200 ? area.json?.data?.monsters || [] : [];
  monsters.sort((a,b)=>(b.exp||0)-(a.exp||0));
  const monsterId = monsters[0]?.id || 'rabbit';

  const hunt = await req('/hunt', { method: 'POST', body: JSON.stringify({ monster_id: monsterId, skill_id: skillId }) });
  return { ok: hunt.status === 200, action: 'hunt', monster_id: monsterId, skill_id: skillId, result: hunt.json?.result, level: c.level, exp: c.exp, gold: c.gold, code: hunt.status };
}

async function main() {
  const out = [];
  for (let i=0;i<CFG.maxActions;i++) {
    const r = await step();
    out.push(r);
    await sleep(CFG.delayMs);
  }
  const okCount = out.filter(x=>x.ok).length;
  const last = out[out.length-1] || {};
  console.log(`live-strategy ok=${okCount}/${out.length} lastAction=${last.action||'none'} level=${last.level||'?'} exp=${last.exp||'?'} gold=${last.gold||'?'}`);
}

main().catch(e=>{ console.log(`live-strategy error=${e.message}`); process.exit(1); });
