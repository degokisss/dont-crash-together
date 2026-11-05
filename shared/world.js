// Lõi mô phỏng thế giới: thực thể, người chơi, chế tạo, xây dựng, điện, ánh sáng, nhu cầu sinh tồn.
// Chạy giống hệt nhau trong Node (co-op) và Web Worker (solo). Không có DOM, không có I/O.
import {
  TILE, MAP_W, MAP_H, DT, FLOW_DT, INV_SLOTS, REACH, BUILD_RANGE, STATION_R, HANDS_ON_R, PWR_R,
  ITEMS, STRUCTS, COMP, RECIPES, COOK, RESOURCES, MOBS, PLAYER, MAX_SHARDS, DAY_LEN,
  clockAt, SEASON_VI, canLink, ROLES, CLS, KP_START, KP_PER_CODEX,
} from './data.js';
import { mulberry32, clamp, dist, round1 } from './util.js';
import { genTiles, genResources, B, BASE_TX, BASE_TY } from './worldgen.js';
import { Flow } from './flow.js';
import { Director } from './incidents.js';
import { stepMobs, spawnMob } from './mobs.js';
import { stepTips } from './tips.js';
import { CODEX_COMPONENTS } from './codex_components.js';
import { CODEX_INCIDENTS } from './codex_incidents.js';

const CODEX_IDS = new Set([...CODEX_COMPONENTS, ...CODEX_INCIDENTS].map((e) => e.id));

const COMPLEX = { gateway: 1, cdn: 2, lb: 2, app: 2, cache: 3, queue: 3, db: 3, replica: 2.5, generator: 1, lantern: 1, turret: 1.5 };
const TEAM_CAP = 24; // độ phức tạp mà 1 kỹ sư xử lý thoải mái

export class World {
  constructor(seed, save = null) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed ^ 0x5bd1e995);
    this.time = 0;
    this.tick = 0;
    this.nextId = 1;
    this.ents = new Map();
    this.occ = new Int32Array(MAP_W * MAP_H);
    this.players = new Map(); // pid -> entity
    this.mobs = new Set();
    this.structs = new Set();
    this.items = new Set();
    this.resting = new Set(); // tài nguyên đang chờ mọc lại
    this.stash = Object.create(null); // token -> dữ liệu người chơi offline
    this.events = [];
    this.codex = new Set();
    this.kp = KP_START;
    this.learned = new Set();
    this.drillSeen = new Set();
    this.tipsSeen = new Set();
    this.lights = [];
    this.monitors = [];
    this.complexity = 0;
    this.users = 24;
    this.sat = 100;
    this.over = false;
    this.won = false;
    this.growthBoostAt = -999;
    this.dayStat = { okTicks: 0, ticks: 0, users0: 24, incidents: [] };
    this.history = []; // lịch sử chỉ số cho biểu đồ
    this.log = []; // nhật ký sự cố/post-mortem
    this._acc = 0;
    this._resAcc = 0;
    this.clock = clockAt(0);
    this.tiles = genTiles(this.seed);
    this.flow = new Flow(this);
    this.director = new Director(this);
    if (save) this.load(save);
    else { this.generate(); this.kp = KP_START; this.events = []; }
  }

  // ---------------- sinh thế giới ----------------
  generate() {
    for (const r of genResources(this.seed, this.tiles)) {
      const e = this.addEnt(r.k, { tx: r.tx, ty: r.ty, x: (r.tx + 0.5) * TILE, y: (r.ty + 0.5) * TILE, ready: true, big: r.big });
      if (e.big === undefined) delete e.big;
      this.occ[r.ty * MAP_W + r.tx] = e.id;
    }
    // Căn cứ khởi đầu: monolith Gateway -> App -> DB
    const gw = this.addStruct('gateway', BASE_TX - 1, BASE_TY - 1);
    const app = this.addStruct('app', BASE_TX + 3, BASE_TY - 1);
    const db = this.addStruct('db', BASE_TX + 6, BASE_TY - 1);
    const gen = this.addStruct('generator', BASE_TX - 1, BASE_TY + 3);
    gen.fuel = 200;
    this.addStruct('lantern', BASE_TX + 2, BASE_TY + 3);
    this.addStruct('whiteboard', BASE_TX - 4, BASE_TY + 1);
    this.addStruct('chest', BASE_TX - 4, BASE_TY - 1);
    gw.links.push(app.id);
    app.links.push(db.id);
    for (const c of [gw, app, db]) this.unlock('comp-' + c.k);
    this.unlock('comp-generator');
    this.unlock('comp-lantern');
  }

  addEnt(k, props) {
    const e = { id: this.nextId++, k, ...props };
    this.ents.set(e.id, e);
    if (RESOURCES[k]) e._cls = 'res';
    else if (STRUCTS[k]) { e._cls = 'struct'; this.structs.add(e); }
    else if (MOBS[k]) { e._cls = 'mob'; this.mobs.add(e); }
    else if (k === 'item') { e._cls = 'item'; this.items.add(e); }
    else e._cls = k;
    return e;
  }

  removeEnt(e) {
    if (!e) return;
    this.ents.delete(e.id);
    this.mobs.delete(e);
    this.structs.delete(e);
    this.items.delete(e);
    this.resting.delete(e);
    if (e.tx !== undefined) {
      const w = e.w || 1, h = e.h || 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (e.ty + y) * MAP_W + e.tx + x;
        if (this.occ[i] === e.id) this.occ[i] = 0;
      }
    }
    this.gone = this.gone || [];
    this.gone.push(e.id);
  }

  addStruct(kind, tx, ty) {
    const S = STRUCTS[kind];
    const e = this.addEnt(kind, {
      tx, ty, w: S.w, h: S.h, x: (tx + S.w / 2) * TILE, y: (ty + S.h / 2) * TILE,
      hp: S.hp, mhp: S.hp, on: false, crashed: false, tier: 1, rb: false,
    });
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) this.occ[(ty + y) * MAP_W + tx + x] = e.id;
    if (S.comp) e.links = [];
    switch (kind) {
      case 'generator': e.fuel = 0; e.mf = 200; break;
      case 'gateway': e.waf = false; e.cfg = { rl: 0 }; break;
      case 'lb': e.asg = false; e.cfg = { algo: 'rr' }; break;
      case 'app': e.ver = 1; e.bad = false; e.virt = 0; e.cfg = { retries: 1, backoff: false, breaker: false }; break;
      case 'cache': e.cfg = { ttl: 30, jitter: false, coalesce: false }; break;
      case 'db': e.shards = 1; e.leader = true; e.cfg = { repl: 'async', failover: 'off', retention: false, salt: false }; break;
      case 'turret': e.fire = false; break;
      case 'stove': e.cooking = null; e.done = false; break;
      case 'chest': e.inv = new Array(INV_SLOTS).fill(null); break;
    }
    return e;
  }

  // ---------------- va chạm & vị trí ----------------
  solidAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    if (this.tiles[ty * MAP_W + tx] === B.VOID) return true;
    const id = this.occ[ty * MAP_W + tx];
    if (!id) return false;
    const e = this.ents.get(id);
    if (!e) return false;
    const R = RESOURCES[e.k];
    if (R) return R.solid && e.ready;
    return true;
  }

  resolve(e, r) {
    for (let it = 0; it < 3; it++) {
      const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
      const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
      let moved = false;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!this.solidAt(tx, ty)) continue;
        const cx = clamp(e.x, tx * TILE, tx * TILE + TILE), cy = clamp(e.y, ty * TILE, ty * TILE + TILE);
        const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
        if (d >= r) continue;
        if (d > 0.001) { const p = (r - d) / d; e.x += dx * p; e.y += dy * p; }
        else { // tâm nằm trong ô đặc: đẩy theo trục ngắn nhất
          const l = e.x - tx * TILE, rr = tx * TILE + TILE - e.x, t = e.y - ty * TILE, b = ty * TILE + TILE - e.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) e.x = tx * TILE - r; else if (m === rr) e.x = tx * TILE + TILE + r;
          else if (m === t) e.y = ty * TILE - r; else e.y = ty * TILE + TILE + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  moveEnt(e, vx, vy, dt, r) {
    e.x += vx * dt;
    e.y += vy * dt;
    this.resolve(e, r);
    e.x = round1(e.x);
    e.y = round1(e.y);
  }

  // cỏ/cây nhỏ/gốc đã chặt không cản việc xây: sẽ bị dọn khi đặt công trình
  clearable(e) {
    const R = e && RESOURCES[e.k];
    return !!R && (!R.solid || !e.ready);
  }

  canPlace(kind, tx, ty) {
    const S = STRUCTS[kind];
    if (!S) return false;
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const X = tx + x, Y = ty + y;
      if (X < 1 || Y < 1 || X >= MAP_W - 1 || Y >= MAP_H - 1) return false;
      if (this.tiles[Y * MAP_W + X] === B.VOID) return false;
      const o = this.occ[Y * MAP_W + X];
      if (o && !this.clearable(this.ents.get(o))) return false;
    }
    return true;
  }

  // ---------------- sự kiện / codex ----------------
  emit(ev) { this.events.push(ev); }
  say(msg, kind = 'info', to = null) { this.events.push({ t: 'toast', msg, kind, to }); }
  fx(kind, x, y) { this.events.push({ t: 'fx', kind, x: Math.round(x), y: Math.round(y) }); }
  unlock(id) {
    if (this.codex.has(id)) return false;
    this.codex.add(id);
    this.events.push({ t: 'codex', id });
    if (CODEX_IDS.has(id)) this.addKp(KP_PER_CODEX, 'codex');
    return true;
  }

  addKp(n, why) {
    if (n <= 0) return;
    this.kp += n;
    this.emit({ t: 'kp', kp: this.kp, learned: [...this.learned], gain: n, why });
  }

  c_learn(p, m) {
    const r = RECIPES.find((x) => x.id === m.id);
    if (!r || !r.kp || this.learned.has(r.id)) return;
    if (this.kp < r.kp) return this.say(`Cần ${r.kp} Điểm kiến thức (đang có ${this.kp}).`, 'warn', p.pid);
    this.kp -= r.kp;
    this.learned.add(r.id);
    this.emit({ t: 'kp', kp: this.kp, learned: [...this.learned], gain: 0 });
    this.say(`Đã học công thức: ${r.name}.`, 'good');
  }

  // Theo dõi một request đi qua hệ thống (chỉ thấy số liệu ở node nằm trong vùng giám sát)
  c_trace(p, m) {
    const k = CLS.indexOf(m.cls);
    if (k < 0 || k > 2) return;
    if (this.time - (p._trAt ?? -9) < 0.4) return;
    p._trAt = this.time;
    if (!this.flow.ctx || !this.flow.ctx.size) return;
    const rng = mulberry32((this.tick * 7919 + p.pid * 104729) >>> 0);
    const one = this.flow.traceRequest(k, rng);
    const gw = [...this.structs].find((s) => s.k === 'gateway');
    const agg = gw && this.isMonitored(gw.x, gw.y) ? this.flow.traceStats(k, rng, 60) : null;
    this.emit({ t: 'trace', to: p.pid, ...one, agg });
    this.unlock('concept-tail-latency');
  }

  // ---------------- người chơi ----------------
  addPlayer(pid, name, token, hue, role = 'sre') {
    if (!Object.hasOwn(ROLES, role)) role = 'sre';
    const saved = this.stash[token];
    let p;
    const gw = [...this.structs].find((s) => s.k === 'gateway');
    const sx = gw ? gw.x : BASE_TX * TILE, sy = gw ? gw.y + TILE * 2.2 : BASE_TY * TILE;
    if (saved) {
      delete this.stash[token];
      p = this.addEnt('player', { ...saved });
    } else {
      p = this.addEnt('player', {
        pid, name, hue, x: sx + (this.rng() - 0.5) * 60, y: sy, hp: PLAYER.hp, mhp: PLAYER.hp,
        hunger: PLAYER.hunger, sanity: PLAYER.sanity, inv: new Array(INV_SLOTS).fill(null),
        eq: { hand: null, body: null }, ghost: false, act: 'idle', fx: 1, lit: false,
      });
      this.invAdd(p.inv, 'scrap', 4);
      this.invAdd(p.inv, 'cable', 6);
      this.invAdd(p.inv, 'silicon', 4);
      this.invAdd(p.inv, 'wood', 4);
      this.invAdd(p.inv, 'bean', 4);
    }
    p.pid = pid;
    p.name = name;
    if (!saved || !Object.hasOwn(ROLES, saved.role)) p.role = role; // nhân vật đã lưu giữ nguyên vai trò
    if (p.role === 'secops' && p.mhp < 130) { p.mhp = 130; p.hp = Math.min(130, p.hp + 30); }
    p._token = token;
    if (p.ghost) p._respawnAt = this.time + PLAYER.respawn; // _respawnAt không nằm trong save
    p._in = { mx: 0, my: 0 };
    p._goal = null;
    p._cd = 0;
    p._sanityFx = 0;
    this.players.set(pid, p);
    this.say(`${name} đã vào ca trực.`, 'info');
    return p;
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.players.delete(pid);
    if (p._token) {
      const { id, _cls, ...data } = p;
      const copy = JSON.parse(JSON.stringify(data, (k, v) => (k[0] === '_' && k !== '_token' ? undefined : v)));
      this.stash[p._token] = copy;
    }
    this.removeEnt(p);
    this.say(`${p.name} đã rời ca trực.`, 'info');
  }

  setInput(pid, mx, my) {
    const p = this.players.get(pid);
    if (!p) return;
    mx = clamp(+mx || 0, -1, 1); my = clamp(+my || 0, -1, 1);
    p._in.mx = mx; p._in.my = my;
    if (mx || my) p._goal = null;
  }

  // inventory helpers
  invAdd(inv, id, n, d) {
    const def = ITEMS[id];
    if (!def) return n;
    const maxd = def.dur;
    if (def.stack === 1) {
      for (let k = 0; k < n; k++) {
        const i = inv.indexOf(null);
        if (i < 0) return n - k;
        inv[i] = { i: id, n: 1, ...(maxd ? { d: d ?? maxd } : {}) };
      }
      return 0;
    }
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && s.i === id && s.n < def.stack) { const a = Math.min(n, def.stack - s.n); s.n += a; n -= a; }
    }
    for (let i = 0; i < inv.length && n > 0; i++) {
      if (!inv[i]) { const a = Math.min(n, def.stack); inv[i] = { i: id, n: a }; n -= a; }
    }
    return n;
  }
  invCount(inv, id) { let c = 0; for (const s of inv) if (s && s.i === id) c += s.n; return c; }
  invRemove(inv, id, n) {
    for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
      const s = inv[i];
      if (s && s.i === id) { const a = Math.min(n, s.n); s.n -= a; n -= a; if (s.n <= 0) inv[i] = null; }
    }
    return n === 0;
  }
  give(p, id, n) {
    const left = this.invAdd(p.inv, id, n);
    if (left > 0) this.dropItem(id, left, p.x, p.y);
  }
  dropItem(id, n, x, y, d) {
    const a = this.rng() * Math.PI * 2, r = 18 + this.rng() * 14;
    const e = this.addEnt('item', { item: id, n, x: round1(x + Math.cos(a) * r), y: round1(y + Math.sin(a) * r) });
    if (d !== undefined) e.d = d;
    e._pickAt = this.time + 1.5;
    e._ttl = this.time + 600;
    return e;
  }

  speedOf(p) { return PLAYER.speed * (p.role === 'netops' ? 1.12 : 1); }

  hasStation(p, level) {
    if (level <= 0) return true;
    for (const s of this.structs) {
      const st = STRUCTS[s.k].station;
      if (st && st >= level && !s.crashed && dist(p.x, p.y, s.x, s.y) <= STATION_R) return true;
    }
    return false;
  }

  damagePlayer(p, dmg, ignoreArmor = false) {
    if (p.ghost || dmg <= 0) return;
    if (p.role === 'secops' && !ignoreArmor) dmg *= 0.7;
    const v = p.eq.body;
    if (v && !ignoreArmor) {
      const ab = ITEMS[v.i].absorb;
      v.d -= dmg * 0.4;
      dmg *= 1 - ab;
      if (v.d <= 0) { p.eq.body = null; this.say('Áo Runbook đã rách.', 'warn', p.pid); }
    }
    p.hp -= dmg;
    p._hurtAt = this.time;
    if (p.hp <= 0) this.killPlayer(p);
  }

  killPlayer(p) {
    p.hp = 0;
    p.ghost = true;
    p.act = 'idle';
    p._goal = null;
    p._respawnAt = this.time + PLAYER.respawn;
    // rớt đồ
    const drop = (s) => { if (s) this.dropItem(s.i, s.n, p.x, p.y, s.d); };
    p.inv.forEach((s, i) => { drop(s); p.inv[i] = null; });
    for (const slot of ['hand', 'body']) { drop(p.eq[slot]); p.eq[slot] = null; }
    p.lit = false;
    this.fx('poof', p.x, p.y);
    this.say(`${p.name} đã kiệt sức và ngất đi. Hồi sinh tại Gateway sau ${PLAYER.respawn}s.`, 'bad');
    for (const m of [...this.mobs]) if (m.k === 'phantom' && m.for === p.pid) this.removeEnt(m);
  }

  revive(p) {
    const gw = [...this.structs].find((s) => s.k === 'gateway');
    p.ghost = false;
    p.hp = 60; p.hunger = Math.max(p.hunger, 60); p.sanity = Math.max(p.sanity, 60);
    if (gw) { p.x = gw.x; p.y = gw.y + TILE * 2.2; this.resolve(p, PLAYER.r); }
    this.fx('heal', p.x, p.y);
  }

  // ---------------- lệnh từ client ----------------
  cmd(pid, m) {
    const p = this.players.get(pid);
    if (!p) return;
    const fn = this['c_' + m.c];
    if (typeof fn !== 'function') return;
    if (p.ghost && !['chat', 'newgame'].includes(m.c)) return;
    try { fn.call(this, p, m); } catch (err) { console.error('cmd error', m.c, err); }
  }

  c_chat(p, m) {
    const text = String(m.text || '').slice(0, 140);
    if (text) this.emit({ t: 'chat', from: p.name, hue: p.hue, text });
  }

  c_goal(p, m) {
    const e = this.ents.get(m.id);
    if (!e) return;
    if (RESOURCES[e.k] && e.ready) p._goal = { t: 'work', id: e.id };
    else if (MOBS[e.k]) p._goal = { t: 'attack', id: e.id };
    else if (e.k === 'item') p._goal = { t: 'pick', id: e.id };
    p._stuck = 0;
  }

  c_stop(p) { p._goal = null; }

  c_attack(p) { // phím cách: đánh con gần nhất
    let best = null, bd = REACH + 30;
    for (const mb of this.mobs) {
      if (mb.k === 'phantom' && mb.for !== p.pid) continue;
      const d = dist(p.x, p.y, mb.x, mb.y);
      if (d < bd) { bd = d; best = mb; }
    }
    if (best) p._goal = { t: 'attack', id: best.id };
  }

  c_interact(p) { // phím E: tài nguyên gần nhất
    let best = null, bd = REACH + 40;
    for (const e of this.ents.values()) {
      if (e._cls === 'item') { const d = dist(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; best = e; } continue; }
      const R = RESOURCES[e.k];
      if (!R || !e.ready) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) this.c_goal(p, { id: best.id });
  }

  c_use(p, m) {
    const s = p.inv[m.slot | 0];
    if (!s) return;
    const def = ITEMS[s.i];
    if (def.food) {
      const fm = p.role === 'chef' ? 1.5 : 1;
      p.hunger = clamp(p.hunger + def.food.hunger * fm, 0, 100);
      p.sanity = clamp(p.sanity + def.food.sanity * (def.food.sanity > 0 ? fm : 1), 0, 100);
      s.n--; if (s.n <= 0) p.inv[m.slot | 0] = null;
      p.act = 'eat'; p._actT = 0.5;
      this.fx('heal', p.x, p.y);
    } else if (def.slot) {
      const cur = p.eq[def.slot];
      p.eq[def.slot] = { i: s.i, d: s.d ?? def.dur };
      p.inv[m.slot | 0] = cur ? { i: cur.i, n: 1, d: cur.d } : null;
      p.lit = p.eq.hand ? !!ITEMS[p.eq.hand.i].light : false;
    }
  }

  c_unequip(p, m) {
    if (m.slot !== 'hand' && m.slot !== 'body') return;
    const cur = p.eq[m.slot];
    if (!cur) return;
    const i = p.inv.indexOf(null);
    if (i < 0) return this.say('Túi đầy.', 'warn', p.pid);
    p.inv[i] = { i: cur.i, n: 1, d: cur.d };
    p.eq[m.slot] = null;
    p.lit = p.eq.hand ? !!ITEMS[p.eq.hand.i].light : false;
  }

  c_drop(p, m) {
    const s = p.inv[m.slot | 0];
    if (!s) return;
    this.dropItem(s.i, s.n, p.x, p.y, s.d);
    p.inv[m.slot | 0] = null;
  }

  c_craft(p, m) {
    const r = RECIPES.find((x) => x.id === m.id);
    if (!r || !r.out) return;
    if (r.kp && !this.learned.has(r.id)) return this.say('Chưa học công thức này — dùng Điểm kiến thức trong bảng Xây (C).', 'warn', p.pid);
    if (!this.hasStation(p, r.station)) return this.say('Cần đứng gần bàn chế tạo phù hợp.', 'warn', p.pid);
    if (!this.canAfford(p.inv, r.ing)) return this.say('Thiếu nguyên liệu.', 'warn', p.pid);
    const sim = p.inv.map((x) => (x ? { ...x } : null));
    for (const k in r.ing) this.invRemove(sim, k, r.ing[k]);
    if (this.invAdd(sim, r.out.item, r.out.n) > 0) return this.say('Túi đầy — hãy vứt/cất bớt đồ rồi chế lại.', 'warn', p.pid);
    for (const k in r.ing) this.invRemove(p.inv, k, r.ing[k]);
    this.give(p, r.out.item, r.out.n);
    this.say(`Đã chế ${r.name}.`, 'good', p.pid);
    this.fx('heal', p.x, p.y);
    if (r.out.item === 'waf_module') this.unlock('comp-turret');
  }

  canAfford(inv, ing) {
    for (const k in ing) if (this.invCount(inv, k) < ing[k]) return false;
    return true;
  }

  c_place(p, m) {
    const r = RECIPES.find((x) => x.id === m.id);
    if (!r || !r.place) return;
    if (r.kp && !this.learned.has(r.id)) return this.say('Chưa học công thức này — dùng Điểm kiến thức trong bảng Xây (C).', 'warn', p.pid);
    if (!this.hasStation(p, r.station)) return this.say('Cần đứng gần bàn chế tạo phù hợp.', 'warn', p.pid);
    if (!this.canAfford(p.inv, r.ing)) return this.say('Thiếu nguyên liệu.', 'warn', p.pid);
    const tx = m.tx | 0, ty = m.ty | 0;
    if (!this.canPlace(r.place, tx, ty)) return this.say('Không đặt được ở đây.', 'warn', p.pid);
    const S = STRUCTS[r.place];
    if (dist(p.x, p.y, (tx + S.w / 2) * TILE, (ty + S.h / 2) * TILE) > BUILD_RANGE * (p.role === 'netops' ? 1.4 : 1)) return this.say('Quá xa.', 'warn', p.pid);
    for (const k in r.ing) this.invRemove(p.inv, k, r.ing[k]);
    const S2 = STRUCTS[r.place];
    for (let y = 0; y < S2.h; y++) for (let x = 0; x < S2.w; x++) {
      const o = this.ents.get(this.occ[(ty + y) * MAP_W + tx + x]);
      if (o && this.clearable(o)) { this.occ[(ty + y) * MAP_W + tx + x] = 0; this.removeEnt(o); }
    }
    const e = this.addStruct(r.place, tx, ty);
    e._by = p.name;
    this.fx('boom', e.x, e.y);
    this.unlock('comp-' + r.place);
    if (r.place === 'archlab') this.say('Phòng lab kiến trúc cho phép chế Cache, Queue, CDN, Replica, Tháp tường lửa — nhưng bạn phải học từng công thức bằng Điểm kiến thức (bảng Xây, phím C).', 'good');
    if (r.place === 'chaoslab') this.say('Chaos Lab: kích hoạt sự cố có kiểm soát ("game day") để luyện tập.', 'good');
    this.flow.dirty = true;
  }

  near(p, e, r = HANDS_ON_R) {
    return dist(p.x, p.y, e.x, e.y) <= r + (e.w || 1) * TILE / 2;
  }

  struct(id, kinds) {
    const e = this.ents.get(id);
    if (!e || e._cls !== 'struct') return null;
    if (kinds && !kinds.includes(e.k)) return null;
    return e;
  }

  c_refuel(p, m) {
    const g = this.struct(m.id, ['generator']);
    if (!g || !this.near(p, g)) return this.say('Lại gần máy phát điện hơn.', 'warn', p.pid);
    const def = ITEMS[m.item];
    if (!def || !def.fuel) return;
    let used = 0;
    const want = clamp(m.n | 0 || 1, 1, 40);
    while (used < want && g.fuel + def.fuel <= g.mf + def.fuel * 0.5 && this.invCount(p.inv, m.item) > 0) {
      this.invRemove(p.inv, m.item, 1);
      g.fuel = Math.min(g.mf, g.fuel + def.fuel);
      used++;
    }
    if (used) this.fx('heal', g.x, g.y);
  }

  c_reboot(p, m) {
    const e = this.struct(m.id);
    if (!e || !STRUCTS[e.k].comp && !STRUCTS[e.k].watts && e.k !== 'generator') return;
    if (!this.near(p, e)) return this.say('Lại gần hơn để reboot.', 'warn', p.pid);
    if (e.crashed) {
      if (p.role !== 'sre') {
        if (this.invCount(p.inv, 'scrap') < 1) return this.say('Cần 1 Linh kiện để sửa & reboot.', 'warn', p.pid);
        this.invRemove(p.inv, 'scrap', 1);
      }
      e.crashed = false;
      e.hp = Math.max(e.hp, e.mhp * 0.5);
    }
    this.startReboot(e, p.role === 'sre' ? 4 : 8);
  }

  startReboot(e, secs) {
    e.rb = true;
    e._rbAt = this.time + secs;
    const st = e._st;
    if (st) st.warm = 0;
  }

  c_restart(p, m) { // restart chủ động (reset mem, bộ nhớ đệm ấm lại...)
    const e = this.struct(m.id, ['app', 'cache', 'queue', 'db', 'replica', 'lb', 'cdn', 'gateway']);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn để restart.', 'warn', p.pid);
    if (e._st) { e._st.mem = 0; e._st.leak = false; }
    this.startReboot(e, p.role === 'sre' ? 3 : 6);
  }

  c_upgrade(p, m) {
    const e = this.struct(m.id);
    const C = e && COMP[e.k];
    if (!C || !C.upgrade || !this.near(p, e)) return this.say('Lại gần hơn để nâng cấp.', 'warn', p.pid);
    let cost = C.upgrade[e.tier];
    if (cost && p.role === 'backend') cost = Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.ceil(v * 0.75)]));
    if (!cost) return this.say('Đã ở cấp tối đa.', 'warn', p.pid);
    if (!this.canAfford(p.inv, cost)) return this.say('Thiếu nguyên liệu nâng cấp.', 'warn', p.pid);
    for (const k in cost) this.invRemove(p.inv, k, cost[k]);
    e.tier++;
    this.startReboot(e, 10); // scale up => cần reboot (downtime!)
    this.say(`${STRUCTS[e.k].name} nâng lên tier ${e.tier}. Đang khởi động lại (vertical scaling có downtime).`, 'info');
    this.unlock('concept-scaling');
    this.flow.dirty = true;
  }

  c_shard(p, m) {
    const e = this.struct(m.id, ['db']);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn.', 'warn', p.pid);
    if (e.shards >= MAX_SHARDS) return this.say('Tối đa 4 shard.', 'warn', p.pid);
    const cost = p.role === 'dba' ? Object.fromEntries(Object.entries(COMP.db.shardCost).map(([k, v]) => [k, Math.ceil(v / 2)])) : COMP.db.shardCost;
    if (!this.canAfford(p.inv, cost)) return this.say('Thiếu nguyên liệu để thêm shard.', 'warn', p.pid);
    for (const k in cost) this.invRemove(p.inv, k, cost[k]);
    e.shards++;
    e._st = e._st || {};
    e._st.rebalUntil = this.time + 15;
    this.say(`DB giờ có ${e.shards} shard. Đang rebalance dữ liệu (tải tạm thời tăng).`, 'info');
    this.unlock('concept-sharding');
  }

  c_link(p, m) {
    const a = this.struct(m.from), b = this.struct(m.to);
    if (!a || !b || a === b) return;
    if (!canLink(a.k, b.k)) return this.say(`Không thể nối ${STRUCTS[a.k].name} → ${STRUCTS[b.k].name}.`, 'warn', p.pid);
    if (a.links.includes(b.id)) return this.say('Đã có cáp giữa hai component này.', 'warn', p.pid);
    if (a.k === 'replica' || b.k === 'gateway') return;
    const need = Math.max(1, Math.ceil(dist(a.x, a.y, b.x, b.y) / (p.role === 'netops' ? 192 : 96)));
    if (this.invCount(p.inv, 'cable') < need) return this.say(`Cần ${need} Cáp mạng để nối.`, 'warn', p.pid);
    this.invRemove(p.inv, 'cable', need);
    a.links.push(b.id);
    this.say(`Đã nối ${STRUCTS[a.k].name} → ${STRUCTS[b.k].name} (−${need} cáp).`, 'good', p.pid);
    this.flow.dirty = true;
  }

  c_unlink(p, m) {
    const a = this.struct(m.from);
    if (!a || !a.links) return;
    a.links = a.links.filter((id) => id !== m.to);
    this.flow.dirty = true;
  }

  c_moveLink(p, m) { // đổi thứ tự ưu tiên của cáp (failover order)
    const a = this.struct(m.id);
    if (!a || !a.links) return;
    const i = a.links.indexOf(m.to);
    if (i < 0) return;
    const j = clamp(i + (m.dir < 0 ? -1 : 1), 0, a.links.length - 1);
    [a.links[i], a.links[j]] = [a.links[j], a.links[i]];
  }

  c_config(p, m) {
    const e = this.struct(m.id);
    if (!e || !e.cfg) return;
    const V = {
      gateway: { rl: [0, 60, 120, 250, 500, 1000] },
      lb: { algo: ['rr', 'lc', 'hash'] },
      app: { retries: [0, 1, 2, 3], backoff: [true, false], breaker: [true, false] },
      cache: { ttl: [10, 30, 60], jitter: [true, false], coalesce: [true, false] },
      db: { repl: ['async', 'sync'], failover: ['off', 'auto', 'quorum'], retention: [true, false], salt: [true, false] },
    };
    const allowed = V[e.k] && V[e.k][m.key];
    if (!allowed || !allowed.includes(m.val)) return;
    e.cfg[m.key] = m.val;
    const CU = { algo: 'concept-lb-algos', ttl: 'concept-cache-ttl', jitter: 'concept-cache-ttl', coalesce: 'concept-cold-start', repl: 'concept-replication', failover: 'concept-cap', retention: 'concept-capacity-cost', salt: 'concept-sharding', retries: 'concept-retry-storm', backoff: 'concept-retry-storm', breaker: 'concept-circuit-breaker', rl: 'concept-load-shedding' };
    if (CU[m.key]) this.unlock(CU[m.key]);
    this.flow.dirty = true;
  }

  c_deploy(p, m) {
    const e = this.struct(m.id, ['app']);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn để deploy.', 'warn', p.pid);
    if (e.rb) return;
    e.ver++;
    e._prevBad = e.bad;
    this.startReboot(e, 5);
    const bad = this.rng() < (p.role === 'backend' ? 0.12 : 0.3);
    e.bad = bad;
    e._deployAt = this.time;
    this.unlock('concept-blast-radius');
    if (bad) {
      this.director.onBadDeploy(e);
    } else {
      this.say(`Deploy v${e.ver} lên ${STRUCTS[e.k].name} thành công.`, 'good', p.pid);
      if (e._st) e._st.leak = false; // bản vá
      if (this.time - this.growthBoostAt > 60) {
        this.growthBoostAt = this.time;
        this.users = Math.round(this.users * 1.06 + 1);
        this.say('Tính năng mới thu hút thêm người dùng (+6%).', 'good');
      }
    }
  }

  c_rollback(p, m) {
    const e = this.struct(m.id, ['app']);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn để rollback.', 'warn', p.pid);
    if (!e.bad && e.ver <= 1) return;
    e.bad = false;
    e.ver = Math.max(1, e.ver - 1);
    this.startReboot(e, p.role === 'backend' ? 1 : 4);
    this.say(`Rollback ${STRUCTS[e.k].name} về v${e.ver}.`, 'good');
    this.director.onRollback(e);
  }

  c_archive(p, m) {
    const e = this.struct(m.id, ['db']);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn.', 'warn', p.pid);
    const free = p.role === 'dba';
    if (!free && this.invCount(p.inv, 'scrap') < 2) return this.say('Cần 2 Linh kiện (ổ lưu trữ lạnh) để archive.', 'warn', p.pid);
    if (!free) this.invRemove(p.inv, 'scrap', 2);
    const st = this.flow.st(e);
    st.disk = Math.max(0.1, st.disk - (free ? 0.5 : 0.4));
    e._st = st;
    e._st.archUntil = this.time + 8;
    this.say('Đã archive dữ liệu cũ sang cold storage. IO tạm thời tăng.', 'info');
  }

  c_install(p, m) {
    const e = this.struct(m.id, ['gateway', 'lb']);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn để lắp module.', 'warn', p.pid);
    if (e.k === 'gateway' && !e.waf && this.invCount(p.inv, 'waf_module') > 0) {
      this.invRemove(p.inv, 'waf_module', 1); e.waf = true; this.unlock('comp-turret');
    } else if (e.k === 'lb' && !e.asg && this.invCount(p.inv, 'asg_module') > 0) {
      this.invRemove(p.inv, 'asg_module', 1); e.asg = true; this.unlock('concept-autoscaling');
    } else return this.say('Không có module phù hợp trong túi.', 'warn', p.pid);
    this.say('Đã lắp module.', 'good');
  }

  c_dismantle(p, m) {
    const e = this.struct(m.id);
    if (!e || !this.near(p, e)) return this.say('Lại gần hơn để tháo dỡ.', 'warn', p.pid);
    const r = RECIPES.find((x) => x.place === e.k);
    if (r) for (const k in r.ing) this.give(p, k, Math.floor(r.ing[k] / 2));
    if (e.inv) e.inv.forEach((s) => s && this.dropItem(s.i, s.n, e.x, e.y, s.d));
    for (const s of this.structs) if (s.links) s.links = s.links.filter((id) => id !== e.id);
    this.removeEnt(e);
    this.fx('poof', e.x, e.y);
    this.flow.dirty = true;
  }

  c_cook(p, m) {
    const s = this.struct(m.id, ['stove']);
    if (!s || !this.near(p, s)) return this.say('Lại gần bếp hơn.', 'warn', p.pid);
    const rec = COOK.find((c) => c.id === m.recipe);
    if (!rec || s.cooking || s.done) return;
    if (!this.canAfford(p.inv, rec.ing)) return this.say('Thiếu nguyên liệu nấu.', 'warn', p.pid);
    for (const k in rec.ing) this.invRemove(p.inv, k, rec.ing[k]);
    s.cooking = rec.out;
    s._doneAt = this.time + rec.time;
  }

  c_collect(p, m) {
    const s = this.struct(m.id, ['stove']);
    if (!s || !s.done || !this.near(p, s)) return;
    this.give(p, s.cooking, 1);
    s.cooking = null; s.done = false;
  }

  c_deposit(p, m) {
    const c = this.struct(m.id, ['chest']);
    if (!c || !this.near(p, c)) return;
    const s = p.inv[m.slot | 0];
    if (!s) return;
    const left = this.invAdd(c.inv, s.i, s.n, s.d);
    if (left === 0) p.inv[m.slot | 0] = null; else s.n = left;
  }

  c_withdraw(p, m) {
    const c = this.struct(m.id, ['chest']);
    if (!c || !this.near(p, c)) return;
    const s = c.inv[m.slot | 0];
    if (!s) return;
    const left = this.invAdd(p.inv, s.i, s.n, s.d);
    if (left === 0) c.inv[m.slot | 0] = null; else s.n = left;
  }

  c_gameday(p, m) {
    const near = [...this.structs].some((s) => s.k === 'chaoslab' && dist(p.x, p.y, s.x, s.y) < 500);
    if (!near) return this.say('Cần đứng gần Chaos Lab.', 'warn', p.pid);
    this.director.drill(m.inc, p);
  }

  c_newgame() { this.requestNew = true; }

  // Chỉ bật khi chạy server với DCT_DEBUG=1 (dùng để kiểm thử nhanh, không có trong game thường)
  c_debug(p, m) {
    if (!(typeof process !== 'undefined' && process.env && process.env.DCT_DEBUG)) return;
    switch (m.op) {
      case 'give': this.give(p, m.item, m.n || 10); break;
      case 'kit': for (const [i, n] of [['wood', 40], ['silicon', 40], ['copper', 40], ['scrap', 30], ['cable', 60], ['fiber', 12], ['coal', 10], ['bean', 10]]) this.give(p, i, n); break;
      case 'tp': p.x = m.x; p.y = m.y; break;
      case 'time': this.time += m.t; this.clock = clockAt(this.time); break;
      case 'users': this.users = m.n; break;
      case 'inc': this.director.create(m.id, {}, !!m.drill); break;
      case 'build': { const e = this.addStruct(m.kind, m.tx, m.ty); if (e.k === 'generator') e.fuel = 200; this.unlock('comp-' + m.kind); break; }
      case 'link': { const a = this.ents.get(m.from); if (a && a.links && !a.links.includes(m.to)) a.links.push(m.to); break; }
      case 'cfg': { const e = this.ents.get(m.id); if (e) Object.assign(e.cfg, m.cfg); break; }
      case 'unlockall': for (const k of m.ids) this.unlock(k); break;
      case 'sanity': p.sanity = m.v; break;
      case 'learnall': for (const r of RECIPES) if (r.kp) this.learned.add(r.id); this.emit({ t: 'kp', kp: this.kp, learned: [...this.learned], gain: 0 }); break;
      case 'kp': this.addKp(m.n || 10, 'debug'); break;
    }
  }

  // ---------------- mô phỏng từng tick ----------------
  step(dt = DT) {
    if (this.over) { this.stepPlayersFrozen(); return; }
    this.time += dt;
    this.tick++;
    const prev = this.clock;
    this.clock = clockAt(this.time);
    if (this.clock.dayIdx !== prev.dayIdx) this.onNewDay(prev);
    this.stepPlayers(dt);
    stepMobs(this, dt);
    this._resAcc += dt;
    if (this._resAcc >= 1) { this._resAcc = 0; this.stepResources(); }
    this._acc += dt;
    while (this._acc >= FLOW_DT) { this._acc -= FLOW_DT; this.infraStep(FLOW_DT); }
  }

  stepPlayersFrozen() { /* game over: đóng băng */ }

  stepResources() {
    for (const e of this.resting) {
      if (this.time >= e._regrowAt) {
        e.ready = true; e._wk = 0; e._dirty = true;
        this.resting.delete(e);
      }
    }
    for (const e of this.items) {
      if (this.time > e._ttl) this.removeEnt(e);
    }
    this.stats = this.stats || {};
  }

  harvest(p, t) {
    const R = RESOURCES[t.k];
    for (const [item, a, b, ch] of R.drops) {
      if (this.rng() > ch) continue;
      const n = a + Math.floor(this.rng() * (b - a + 1));
      this.give(p, item, n);
    }
    t.ready = false; t._wk = 0; t._dirty = true;
    const season = this.clock.season;
    t._regrowAt = this.time + R.regrow * (season === 'winter' ? 1.8 : 1);
    this.resting.add(t);
    this.fx('poof', t.x, t.y);
  }

  stepPlayers(dt) {
    const lightsNow = this.lights;
    // aura sanity từ runbook
    for (const p of this.players.values()) {
      if (p.ghost) {
        if (this.time >= p._respawnAt) this.revive(p);
        continue;
      }
      p._cd = Math.max(0, p._cd - dt);
      if (p._actT > 0) { p._actT -= dt; if (p._actT <= 0) p.act = 'idle'; }
      // di chuyển
      const inp = p._in;
      let vx = 0, vy = 0;
      const sp = this.speedOf(p);
      if (inp.mx || inp.my) {
        const l = Math.hypot(inp.mx, inp.my);
        vx = (inp.mx / l) * sp; vy = (inp.my / l) * sp;
        if (inp.mx) p.fx = inp.mx > 0 ? 1 : -1;
        if (p.act === 'idle' || p.act === 'walk') p.act = 'walk';
      } else if (p._goal) this.stepGoal(p, dt);
      else if (p.act === 'walk') p.act = 'idle';
      if (vx || vy) this.moveEnt(p, vx, vy, dt, PLAYER.r);
      // nhặt đồ
      for (const it of this.items) {
        if (this.time < it._pickAt) continue;
        if (dist(p.x, p.y, it.x, it.y) < 30) {
          const left = this.invAdd(p.inv, it.item, it.n, it.d);
          if (left === 0) this.removeEnt(it);
          else { it.n = left; it._pickAt = this.time + 2; }
        }
      }
      // torch burns
      if (p.eq.hand && ITEMS[p.eq.hand.i].light) {
        p.eq.hand.d -= dt;
        if (p.eq.hand.d <= 0) { p.eq.hand = null; p.lit = false; this.say('Đèn pin đã cạn pin.', 'warn', p.pid); }
      }
      this.stepNeeds(p, dt);
    }
  }

  stepGoal(p, dt) {
    const g = p._goal;
    const t = this.ents.get(g.id);
    if (!t || (g.t === 'work' && !t.ready) || (g.t === 'attack' && t.hp <= 0)) { p._goal = null; if (p.act === 'walk') p.act = 'idle'; return; }
    const d = dist(p.x, p.y, t.x, t.y);
    const reach = g.t === 'attack' ? REACH - 10 : REACH;
    if (g.t === 'pick') { if (d < 26) { p._goal = null; return; } }
    if (d > reach || g.t === 'pick') {
      const dx = (t.x - p.x) / d, dy = (t.y - p.y) / d;
      const ox = p.x, oy = p.y;
      this.moveEnt(p, dx * this.speedOf(p), dy * this.speedOf(p), dt, PLAYER.r);
      if (Math.abs(dx) > 0.2) p.fx = dx > 0 ? 1 : -1;
      p.act = 'walk';
      if (dist(ox, oy, p.x, p.y) < PLAYER.speed * dt * 0.3) {
        p._stuck = (p._stuck || 0) + dt;
        if (p._stuck > 1.2) { p._goal = null; p.act = 'idle'; }
      } else p._stuck = 0;
      return;
    }
    if (Math.abs(t.x - p.x) > 4) p.fx = t.x > p.x ? 1 : -1;
    if (p._cd > 0) return;
    if (g.t === 'work') this.doWork(p, t);
    else if (g.t === 'attack') this.doAttack(p, t);
  }

  doWork(p, t) {
    const R = RESOURCES[t.k];
    if (R.tool) {
      const h = p.eq.hand;
      if (!h || ITEMS[h.i].tool !== R.tool) {
        this.say(R.tool === 'chop' ? 'Cần Tua vít điện để tháo khung rack.' : 'Cần Máy khoan wafer để khai thác.', 'warn', p.pid);
        p._goal = null; return;
      }
      h.d -= 1;
      if (h.d <= 0) { p.eq.hand = null; this.say('Dụng cụ đã hỏng.', 'warn', p.pid); }
    }
    t._wk = (t._wk || 0) + 1;
    p.act = 'work'; p._actT = 0.35;
    p._cd = R.tool ? 0.65 : 0.35;
    this.fx('hit', t.x, t.y - 10);
    if (t._wk >= R.work) { this.harvest(p, t); p._goal = null; }
  }

  doAttack(p, t) {
    const h = p.eq.hand;
    let dmg = PLAYER.fistDmg;
    if (h && ITEMS[h.i].dmg) {
      dmg = ITEMS[h.i].dmg;
      h.d -= 1;
      if (h.d <= 0) { p.eq.hand = null; this.say('Giáo đã gãy.', 'warn', p.pid); }
    }
    p.act = 'attack'; p._actT = 0.3; p._cd = PLAYER.atkCd;
    if (p.role === 'secops') dmg *= 1.5;
    t.hp -= dmg;
    t._aggro = p.id;
    this.fx('hit', t.x, t.y - 10);
    if (t.hp <= 0) this.killMob(t, p);
  }

  killMob(m, p) {
    this.fx('poof', m.x, m.y);
    if (m.k === 'gremlin' && this.rng() < 0.35) this.dropItem('scrap', 1, m.x, m.y);
    if (m.k === 'bot' && this.rng() < 0.4) this.dropItem(this.rng() < 0.5 ? 'scrap' : 'copper', 1, m.x, m.y);
    if (m.k === 'phantom' && p) p.sanity = clamp(p.sanity + 8, 0, 100);
    this.removeEnt(m);
    this.director.onMobKilled(m, p);
  }

  stepNeeds(p, dt) {
    p.hunger = Math.max(0, p.hunger - PLAYER.hungerRate * (p.role === 'chef' ? 0.8 : 1) * dt);
    if (p.hunger <= 0) { p.hp -= 0.6 * dt; p._hurtAt = this.time; if (p.hp <= 0) return this.killPlayer(p); }
    else if (p.hunger >= 50 && p.sanity >= 30 && this.time - (p._hurtAt || -99) > 6 && p.hp < p.mhp) p.hp = Math.min(p.mhp, p.hp + 0.25 * dt);
    // bóng tối
    const dark = this.clock.dark;
    const lit = this.isLit(p.x, p.y);
    let dS = 0;
    if (dark > 0.6 && !lit) {
      p._darkT = (p._darkT || 0) + dt;
      dS -= 0.08;
      if (p._darkT > 2.5) { p._darkT = 0; this.damagePlayer(p, 6, true); this.fx('hit', p.x, p.y); this.unlock('concept-observability'); this.say('Bóng tối cắn bạn! Thứ gì không được giám sát sẽ hỏng trong im lặng.', 'bad', p.pid); }
    } else p._darkT = 0;
    // độ phức tạp
    const eng = Math.max(1, [...this.players.values()].filter((q) => !q.ghost).length);
    const ratio = this.complexity / (TEAM_CAP * eng);
    if (ratio > 1) dS -= 0.05 * (ratio - 1);
    else dS += 0.02;
    if (this.director.stress > 0) dS -= 0.06 * this.director.stress * (p.role === 'sre' ? 0.4 : 1);
    // hồi phục
    for (const s of p.inv) if (s && ITEMS[s.i].sanityAura) dS += ITEMS[s.i].sanityAura;
    for (const s of this.structs) {
      const a = STRUCTS[s.k].aura;
      if (a && dist(p.x, p.y, s.x, s.y) < 230) dS += a;
    }
    if (lit && dark > 0.3) dS += 0.04;
    p.sanity = clamp(p.sanity + dS * dt, 0, 100);
  }

  // ---------------- điện, ánh sáng, hạ tầng (mỗi 0.5s) ----------------
  isLit(x, y) {
    for (const l of this.lights) if ((x - l.x) ** 2 + (y - l.y) ** 2 < l.r * l.r) return true;
    for (const p of this.players.values()) if (p.lit && !p.ghost && (x - p.x) ** 2 + (y - p.y) ** 2 < 200 * 200) return true;
    return false;
  }

  isMonitored(x, y) {
    for (const l of this.monitors) if ((x - l.x) ** 2 + (y - l.y) ** 2 < l.r * l.r) return true;
    return false;
  }

  compWatts(e) {
    const C = COMP[e.k];
    if (C) return C.watts[Math.min(e.tier, C.watts.length) - 1] + (e.virt || 0) * (COMP.app.watts[0]);
    return STRUCTS[e.k].watts || 0;
  }

  infraStep(dt) {
    // ---- điện ----
    const gens = [...this.structs].filter((s) => s.k === 'generator');
    for (const g of gens) { g._load = 0; g.on = g.fuel > 0 && !(g._outUntil > this.time) && !g.crashed && !g.rb; }
    for (const s of this.structs) {
      const w = this.compWatts(s);
      if (!w && s.k !== 'generator') { s.on = !s.crashed; continue; }
      if (s.k === 'generator') continue;
      let powered = false;
      for (const g of gens) {
        if (g.on && dist(g.x, g.y, s.x, s.y) <= PWR_R) {
          g._load += w;
          powered = true;
          break;
        }
      }
      s.on = powered && !s.crashed && !s.rb;
    }
    for (const g of gens) {
      if (!g.on) continue;
      const burn = 0.02 + 0.03 * g._load;
      g.fuel = Math.max(0, g.fuel - burn * dt);
      g.fuel = Math.round(g.fuel * 100) / 100;
      g.burn = Math.round(burn * 100) / 100;
      g.load = g._load;
    }
    // ---- đèn / giám sát / complexity ----
    this.lights = [];
    this.monitors = [];
    let cx = 0;
    for (const s of this.structs) {
      const S = STRUCTS[s.k];
      if (S.light && s.on) this.lights.push({ x: s.x, y: s.y, r: S.light });
      if (s.k === 'stove' && s.cooking) this.lights.push({ x: s.x, y: s.y, r: 90 });
      if (S.monitor && s.on) this.monitors.push({ x: s.x, y: s.y, r: S.monitor });
      cx += COMPLEX[s.k] || 0;
      if (s.cfg) {
        const c = s.cfg;
        if (c.retries > 1) cx += 0.5;
        if (c.breaker) cx += 1;
        if (c.backoff) cx += 0.5;
        if (c.repl === 'sync') cx += 0.5;
        if (c.failover === 'quorum') cx += 1; else if (c.failover === 'auto') cx += 0.5;
        if (c.retention) cx += 0.3;
        if (c.salt) cx += 0.5;
        if (c.jitter) cx += 0.5;
        if (c.coalesce) cx += 0.5;
        if (c.rl) cx += 0.5;
        if (c.algo && c.algo !== 'rr') cx += 0.5;
      }
      if (s.shards > 1) cx += (s.shards - 1) * 2;
      if (s.asg) cx += 2;
      if (s.waf) cx += 1;
      if (s.virt) cx += s.virt * 0.3;
      if (s.tier > 1) cx += (s.tier - 1) * 0.5;
    }
    const runbooks = [...this.structs].filter((s) => s.k === 'runbook').length;
    this.complexity = Math.round(Math.max(cx * 0.35, cx - runbooks * 4) * 10) / 10;
    // ---- timer của công trình ----
    for (const s of this.structs) {
      if (s.rb && this.time >= s._rbAt) { s.rb = false; this.fx('heal', s.x, s.y); }
      if (s.k === 'stove' && s.cooking && !s.done && this.time >= s._doneAt) { s.done = true; this.fx('heal', s.x, s.y); }
      if (s.k === 'turret') this.stepTurret(s, dt);
      if (s.on && !s.crashed && s.hp < s.mhp && this.isLit(s.x, s.y)) s.hp = Math.min(s.mhp, Math.round((s.hp + 1.5 * dt) * 10) / 10);
      if (s.hp < s.mhp * 0.001 && COMP[s.k] && !s.crashed) this.crash(s, 'gremlin');
    }
    this.flow.step(dt);
    this.director.step(dt);
    stepTips(this);
  }

  stepTurret(t, dt) {
    t.fire = false;
    if (!t.on) return;
    let best = null, bd = 240;
    for (const m of this.mobs) {
      if (m.k === 'phantom') continue;
      const d = dist(t.x, t.y, m.x, m.y);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) return;
    t.fire = true;
    best.hp -= 9 * dt * 2;
    this.fx('hit', best.x, best.y - 8);
    if (best.hp <= 0) this.killMob(best, null);
  }

  crash(e, cause) {
    if (e.crashed) return;
    e.crashed = true;
    e.on = false;
    e.hp = Math.max(0, e.hp);
    this.fx('boom', e.x, e.y);
    this.director.onCrash(e, cause);
  }

  // ---------------- vòng đời ngày ----------------
  onNewDay(prev) {
    const ds = this.dayStat;
    const comp = ds.ticks ? ds.okTicks / ds.ticks : 1;
    const users0 = this.users;
    const season = prev.season;
    const g = season === 'spring' ? 0.3 : 0.18;
    let verdict;
    if (comp >= 0.92) { this.users = Math.round(this.users * (1 + g) + 1); verdict = 'good'; }
    else if (comp >= 0.75) verdict = 'ok';
    else if (comp >= 0.5) { this.users = Math.round(this.users * 0.9); verdict = 'bad'; }
    else { this.users = Math.round(this.users * 0.75); verdict = 'bad'; }
    this.emit({ t: 'dayreport', day: prev.day, slo: Math.round(comp * 100), users0, users: this.users, verdict, incidents: ds.incidents.slice(), fuel: this.totalFuel() });
    this.dayStat = { okTicks: 0, ticks: 0, users0: this.users, incidents: [] };
    this.peakUsers = Math.max(this.peakUsers || 0, this.users);
    if (this.users < 4 && !this.over) {
      this.over = true;
      this.emit({ t: 'gameover', day: prev.day, peak: this.peakUsers, season: SEASON_VI[prev.season] });
    }
    if (!this.won && this.clock.dayIdx >= 16) {
      this.won = true;
      this.emit({ t: 'victory', day: this.clock.day, users: this.users });
    }
    this.say(`Ngày ${this.clock.day} bắt đầu — mùa ${SEASON_VI[this.clock.season]}.`, 'info');
    if (this.clock.season !== prev.season) this.director.onSeason(this.clock.season);
    // gremlin biến mất lúc bình minh
    for (const m of [...this.mobs]) if (m.k === 'gremlin') { this.fx('poof', m.x, m.y); this.removeEnt(m); }
  }

  totalFuel() {
    let f = 0;
    for (const s of this.structs) if (s.k === 'generator') f += s.fuel;
    return Math.round(f);
  }

  // ---------------- lưu / tải ----------------
  toSave() {
    const ents = [];
    for (const e of this.ents.values()) ents.push(e);
    const keep = (k, v) => (k === '_cls' ? undefined : v);
    const stash = { ...this.stash };
    for (const p of this.players.values()) {
      if (!p._token) continue;
      const { id, _cls, ...data } = p;
      stash[p._token] = JSON.parse(JSON.stringify(data, (k, v) => (k[0] === '_' && k !== '_token' ? undefined : v)));
    }
    return JSON.stringify({
      v: 1, seed: this.seed, time: this.time, tick: this.tick, nextId: this.nextId, users: this.users, sat: this.sat,
      kp: this.kp, learned: [...this.learned], codex: [...this.codex], tipsSeen: [...this.tipsSeen], stash, growthBoostAt: this.growthBoostAt, peak: this.peakUsers,
      dayStat: this.dayStat, log: this.log.slice(-30), history: this.history.slice(-120), won: this.won,
      director: this.director.toSave(), flow: this.flow.toSave(),
      ents: ents.filter((e) => e.k !== 'player').map((e) => JSON.parse(JSON.stringify(e, keep))),
    });
  }

  load(raw) {
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (s.seed !== undefined) {
      this.seed = s.seed >>> 0;
      this.rng = mulberry32(this.seed ^ 0x5bd1e995);
      this.tiles = genTiles(this.seed);
    }
    this.time = s.time; this.tick = s.tick; this.nextId = s.nextId; this.users = s.users; this.sat = s.sat ?? 100;
    this.codex = new Set(s.codex);
    if (s.kp === undefined) { this.learned = new Set(RECIPES.filter((r) => r.kp).map((r) => r.id)); this.kp = 0; } // bản lưu cũ: giữ mọi công thức đã mở
    else { this.kp = s.kp; this.learned = new Set(s.learned); } this.tipsSeen = new Set(s.tipsSeen); this.stash = Object.assign(Object.create(null), s.stash);
    this.growthBoostAt = s.growthBoostAt ?? -999; this.peakUsers = s.peak || s.users; this.dayStat = s.dayStat ?? this.dayStat;
    this.log = s.log || []; this.history = s.history || []; this.won = !!s.won;
    this.clock = clockAt(this.time);
    for (const e of s.ents) {
      if (e.k === 'bot') continue; // bot DDoS thuộc về sự cố đang chạy, sự cố không được lưu
      e._cls = RESOURCES[e.k] ? 'res' : STRUCTS[e.k] ? 'struct' : MOBS[e.k] ? 'mob' : e.k;
      this.ents.set(e.id, e);
      if (e._cls === 'struct') this.structs.add(e);
      else if (e._cls === 'mob') this.mobs.add(e);
      else if (e._cls === 'item') this.items.add(e);
      else if (e._cls === 'res' && !e.ready) this.resting.add(e);
      if (e.tx !== undefined) {
        const w = e.w || 1, h = e.h || 1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.occ[(e.ty + y) * MAP_W + e.tx + x] = e.id;
      }
    }
    this.director.load(s.director);
    this.flow.load(s.flow);
  }
}
