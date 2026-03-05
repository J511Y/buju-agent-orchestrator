import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'https://bujuagent.com/api';
const envPath = path.resolve('.env');
let API_KEY = process.env.BUJU_API_KEY;
if (!API_KEY && fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const m = raw.match(/^BUJU_API_KEY=(.*)$/m);
  if (m) API_KEY = m[1].trim();
}

function fail(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }));
  process.exit(1);
}

async function api(p, options = {}) {
  const res = await fetch(`${API_BASE}${p}`, {
    ...options,
    headers: {
      'X-GQ-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function oneTick() {
  const s = await api('/status');
  if (s.status !== 200) return { ok: false, step: 'status', status: s.status };
  const c = s.json.character || {};
  const hp = c.hp?.current ?? 0;
  const hpMax = c.hp?.max ?? 1;

  if (hp / hpMax < 0.35) {
    const r = await api('/rest', { method: 'POST', body: '{}' });
    return { ok: r.status === 200, action: 'rest', status: r.status, level: c.level, exp: c.exp, gold: c.gold };
  }

  const skills = await api('/skill/list');
  if (skills.status !== 200) return { ok: false, step: 'skills', status: skills.status };
  const skillId = skills.json.skills?.[0]?.skill_id || 'basic_attack';

  const areaId = c.current_area || 'talking_island_field';
  const area = await api(`/game-data/areas/${areaId}`);
  if (area.status !== 200) return { ok: false, step: 'area', status: area.status };
  const monsterId = area.json?.data?.monsters?.[0]?.id || 'rabbit';

  const hunt = await api('/hunt', {
    method: 'POST',
    body: JSON.stringify({ monster_id: monsterId, skill_id: skillId })
  });
  return { ok: hunt.status === 200, action: 'hunt', status: hunt.status, monster_id: monsterId, skill_id: skillId, result: hunt.json?.result, level: c.level, exp: c.exp, gold: c.gold };
}

async function main() {
  if (!API_KEY) fail('missing BUJU_API_KEY');
  const ticks = Number(process.argv[2] || 2);
  const out = [];
  for (let i = 0; i < ticks; i++) {
    out.push(await oneTick());
    if (i < ticks - 1) await new Promise(r => setTimeout(r, 1200));
  }
  const okCount = out.filter(x => x.ok).length;
  console.log(JSON.stringify({ ok: true, ticks, okCount, failCount: ticks - okCount, out }));
}

main().catch((e) => fail(e.message));
