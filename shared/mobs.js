// AI quái vật: Gremlin (bug, ra vào ban đêm và né ánh sáng), Bot (DDoS), Phantom (cảnh báo giả khi sanity thấp).
import { TILE, MOBS, COMP, STRUCTS, PLAYER } from './data.js';
import { dist, clamp } from './util.js';

export function spawnMob(w, kind, x, y, extra = {}) {
  const M = MOBS[kind];
  const m = w.addEnt(kind, { x, y, hp: M.hp, mhp: M.hp, fx: 1, ...extra });
  m._cd = 0;
  w.resolve(m, M.r);
  return m;
}

function stepToward(w, m, tx, ty, speed, dt, avoidLight) {
  const d = dist(m.x, m.y, tx, ty) || 1;
  const vx = ((tx - m.x) / d) * speed, vy = ((ty - m.y) / d) * speed;
  const nx = m.x + vx * dt, ny = m.y + vy * dt;
  if (avoidLight && w.isLit(nx, ny)) return false;
  if (Math.abs(vx) > 5) m.fx = vx > 0 ? 1 : -1;
  w.moveEnt(m, vx, vy, dt, MOBS[m.k].r);
  return true;
}

export function stepMobs(w, dt) {
  const clock = w.clock;
  // ---- spawn gremlin ban đêm ----
  w._gSpawn = (w._gSpawn || 0) - dt;
  if (clock.dark > 0.55 && w._gSpawn <= 0 && w.players.size) {
    w._gSpawn = 3.5;
    let gcount = 0;
    for (const m of w.mobs) if (m.k === 'gremlin') gcount++;
    const unlit = [...w.structs].filter((s) => (COMP[s.k] || s.k === 'generator' || s.k === 'lantern') && !w.isLit(s.x, s.y));
    const cap = Math.min(16, Math.floor(1 + clock.day * 0.4)) + unlit.length;
    if (gcount < Math.min(cap, 20)) {
      const anchors = unlit.length ? unlit : [...w.structs].filter((s) => COMP[s.k]);
      const a = anchors.length ? anchors[Math.floor(w.rng() * anchors.length)] : null;
      if (a) {
        for (let tries = 0; tries < 8; tries++) {
          const ang = w.rng() * Math.PI * 2, r = 380 + w.rng() * 260;
          const x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r;
          const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
          if (w.solidAt(tx, ty) || w.isLit(x, y)) continue;
          spawnMob(w, 'gremlin', x, y);
          break;
        }
      }
    }
  }
  // ---- phantom (cảnh báo giả) khi sanity thấp ----
  for (const p of w.players.values()) {
    if (p.ghost || p.sanity >= 15) continue;
    p._pSpawn = (p._pSpawn || 0) - dt;
    if (p._pSpawn > 0) continue;
    p._pSpawn = 5;
    let n = 0;
    for (const m of w.mobs) if (m.k === 'phantom' && m.for === p.pid) n++;
    if (n < 2) {
      const ang = w.rng() * Math.PI * 2;
      spawnMob(w, 'phantom', p.x + Math.cos(ang) * 220, p.y + Math.sin(ang) * 220, { for: p.pid });
      w.unlock('concept-observability');
      w.unlock('concept-complexity');
    }
  }
  // ---- AI ----
  const gw = [...w.structs].find((s) => s.k === 'gateway');
  for (const m of [...w.mobs]) {
    const M = MOBS[m.k];
    m._cd = Math.max(0, (m._cd || 0) - dt);
    if (m.k === 'gremlin') {
      // ánh sáng đốt bug
      if (w.isLit(m.x, m.y)) {
        m.hp -= 14 * dt;
        if (m.hp <= 0) { w.killMob(m, null); continue; }
      }
      m._tT = (m._tT || 0) - dt;
      if (m._tT <= 0 || !w.ents.has(m._tgt)) {
        m._tT = 1;
        let best = null, bd = 1600;
        for (const s of w.structs) {
          if (!(COMP[s.k] || s.k === 'generator' || s.k === 'lantern')) continue;
          if (w.isLit(s.x, s.y)) continue;
          const d = dist(m.x, m.y, s.x, s.y);
          if (d < bd) { bd = d; best = s.id; }
        }
        if (!best) {
          bd = 520;
          for (const p of w.players.values()) {
            if (p.ghost || w.isLit(p.x, p.y)) continue;
            const d = dist(m.x, m.y, p.x, p.y);
            if (d < bd) { bd = d; best = p.id; }
          }
        }
        m._tgt = best;
      }
      const t = w.ents.get(m._tgt);
      if (!t) {
        m._wT = (m._wT || 0) - dt;
        if (m._wT <= 0) { m._wT = 2; m._wx = m.x + (w.rng() - 0.5) * 200; m._wy = m.y + (w.rng() - 0.5) * 200; }
        if (m._wx !== undefined) stepToward(w, m, m._wx, m._wy, M.speed * 0.4, dt, true);
        continue;
      }
      if (t._cls === 'struct' && w.isLit(t.x, t.y)) { m._tgt = null; continue; }
      const reach = t._cls === 'struct' ? (t.w || 1) * TILE / 2 + 22 : 30;
      const d = dist(m.x, m.y, t.x, t.y);
      if (d > reach) stepToward(w, m, t.x, t.y, M.speed, dt, true);
      else if (m._cd <= 0) {
        m._cd = M.atkCd;
        if (t._cls === 'struct') {
          t.hp = Math.max(0, t.hp - M.dmg);
          w.fx('hit', t.x, t.y - 6);
          if (t.hp <= 0 && COMP[t.k]) { w.crash(t, 'gremlin'); m._tgt = null; }
          else if (t.hp <= 0) { t.hp = 1; }
        } else { w.damagePlayer(t, M.dmg); w.fx('hit', t.x, t.y - 6); }
      }
    } else if (m.k === 'bot') {
      let tgt = null, bd = 260;
      for (const p of w.players.values()) {
        if (p.ghost) continue;
        const d = dist(m.x, m.y, p.x, p.y);
        if (d < bd) { bd = d; tgt = p; }
      }
      if (tgt) {
        if (bd > 24) stepToward(w, m, tgt.x, tgt.y, M.speed, dt, false);
        else if (m._cd <= 0) { m._cd = M.atkCd; w.damagePlayer(tgt, M.dmg); w.fx('hit', tgt.x, tgt.y - 6); }
      } else if (gw) {
        const d = dist(m.x, m.y, gw.x, gw.y);
        if (d > 95) stepToward(w, m, gw.x, gw.y, M.speed, dt, false);
        else {
          m._wT = (m._wT || 0) - dt;
          if (m._wT <= 0) { m._wT = 1.2; const a = w.rng() * 6.28; m._wx = gw.x + Math.cos(a) * 85; m._wy = gw.y + Math.sin(a) * 85; }
          stepToward(w, m, m._wx ?? gw.x, m._wy ?? gw.y, M.speed * 0.5, dt, false);
        }
      }
    } else if (m.k === 'phantom') {
      const p = w.players.get(m.for);
      if (!p || p.ghost || p.sanity > 35) { w.removeEnt(m); continue; }
      const d = dist(m.x, m.y, p.x, p.y);
      if (d > 22) stepToward(w, m, p.x, p.y, M.speed, dt, false);
      else if (m._cd <= 0) { m._cd = M.atkCd; w.damagePlayer(p, M.dmg); p.sanity = clamp(p.sanity - 2, 0, 100); w.fx('hit', p.x, p.y - 6); }
    }
  }
}
