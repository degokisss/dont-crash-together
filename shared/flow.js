// Mô phỏng luồng request qua đồ thị component (chạy mỗi 0.5 giây).
// Mô hình: lưu lượng fluid + hàng đợi M/M/1 đơn giản + retry + circuit breaker + replication + quorum.
import { COMP, COST, CLS, TRAFFIC_MIX, RPS_PER_USER, SLO, STRUCTS, BACKUP, DATALOSS } from './data.js';
import { clamp, dist } from './util.js';

const CLIENT_TIMEOUT_MS = 3000;
const USER_RETRY = 0.25;
const HC_DELAY = { gateway: 3, cdn: 3, lb: 4, app: 2, k8s: 1 };
const K8S_HEAL_DELAY = 6; // giây từ lúc pod chết tới khi k8s dựng lại
const K8S_ROLLBACK_DELAY = 10; // readiness probe thất bại liên tục bao lâu thì tự rollback
const BACKUP_EVERY = 30;
const FAILOVER_DELAY = 6;
const SEASON_DEMAND = { autumn: 1.0, winter: 0.9, spring: 1.15, summer: 1.35 };
const BOT_RPS = 20;

const z4 = () => [0, 0, 0, 0];
// Trạng thái backup của một DB (nằm trong _st nên được lưu cùng entity):
//   lastBackupAt: thời điểm snapshot cuối hoàn tất (null = chưa có), snapUntil: snapshot đang chạy tới lúc này (0 = rảnh),
//   corrupt: null | { at } — dữ liệu đang hỏng từ lúc `at` (sự cố dataloss). sinceBackup (số ghi kể từ snapshot cuối) là phơi nhiễm RPO.
const backupState = () => ({ lastBackupAt: null, snapUntil: 0, corrupt: null });

export class Flow {
  constructor(w) {
    this.w = w;
    this.carry = [0, 0, 0];
    this.view = null;
    this.fb = {}; // fallback downstream (cache/queue -> db của app đang gọi)
    this.ctx = new Map();
    this.pfail = 0;
    this.demandNow = 0;
    this.dirty = true;
  }

  toSave() { return { carry: this.carry }; }
  load(s) {
    if (s) this.carry = s.carry || [0, 0, 0];
    for (const n of this.w.structs) if (n.k === 'db' && n._st) n._st = { ...backupState(), ...n._st }; // bản lưu cũ chưa có trạng thái backup
  }

  get mods() { return this.w.director.mods; }

  // ---------- trạng thái nội bộ ----------
  st(n) {
    if (!n._st) {
      n._st = { backlog: 0, warm: 1, mem: 0, seen: {}, util: 0 };
      if (n.k === 'db') Object.assign(n._st, { disk: 0.12, leader: n.id, lag: 0.2, unrep: 0, since: 0, sinceBackup: 0, conflicts: 0, split: false });
      if (n.k === 'db') Object.assign(n._st, backupState());
      if (n.k === 'queue') Object.assign(n._st, { q: 0, lag: 0 });
      if (n.k === 'cache') Object.assign(n._st, { warm: 0, sync: 1, ttlT: 0, crush: 0 });
      if (n.k === 'cdn') n._st.warm = 0;
      if (n.k === 'app') Object.assign(n._st, { pf: 0, br: { state: 'closed', until: 0, strikes: 0 } });
      if (n.k === 'replica') n._st.lag = 0.2;
      if (n.k === 'k8s') Object.assign(n._st, { heal: {}, badAt: {}, heals: 0, rollbacks: 0 });
      if (n.k === 'db') n._st.lastBackup = -1;
    }
    return n._st;
  }

  up(n) { return !!n && n.on && !n.crashed && !n.rb; }
  // DB là endpoint của cả cluster: còn phục vụ được (ít nhất đọc) nếu bất kỳ thành viên nào còn sống
  reachable(n) {
    if (this.up(n)) return true;
    if (n.k !== 'db') return false;
    for (const id of n.links) { const r = this.w.ents.get(id); if (r && this.up(r) && !this.cut(n, r)) return true; }
    return false;
  }
  cut(a, b) { return this.mods.cut.has(a.id + '>' + b.id) || this.mods.cut.has(b.id + '>' + a.id); }

  // Node `src` tin `dst` còn sống không? (health check có độ trễ phát hiện)
  believed(src, dst, hc) {
    const actual = this.reachable(dst) && !this.cut(src, dst);
    const seen = this.st(src).seen;
    if (actual) { delete seen[dst.id]; return true; }
    if (seen[dst.id] === undefined) seen[dst.id] = this.w.time;
    return this.w.time - seen[dst.id] < hc;
  }

  linked(n, kinds) {
    const out = [];
    for (const id of n.links || []) {
      const t = this.w.ents.get(id);
      if (t && kinds.includes(t.k)) out.push(t);
    }
    return out;
  }

  firstBelieved(n, kinds, hc) {
    for (const t of this.linked(n, kinds)) if (this.believed(n, t, hc)) return t;
    return null;
  }

  skewDb(db) { return clamp((db.cfg.salt ? 0.06 : 0.12) + this.mods.skewDb, 0, 0.95); }

  capOf(n) {
    const C = COMP[n.k];
    const t = Math.min(n.tier, C.cap.length) - 1;
    let cap = C.cap[t];
    const st = this.st(n);
    if (n.k === 'app') {
      cap *= 1 + (n.virt || 0);
      if (n.cont) cap *= 0.96; // overhead của container runtime
      if (st.mem > 85) cap *= 0.8;
    }
    if (n.k === 'db' || n.k === 'replica') {
      const db = n.k === 'db' ? n : this.clusterOf(n);
      const sh = db ? db.shards : 1;
      const skew = db ? this.skewDb(db) : 0.1;
      cap = (cap * sh) / (1 + skew * (sh - 1));
      const dst = db ? this.st(db) : st;
      if (dst.rebalUntil > this.w.time) cap *= 0.6;
      if (dst.archUntil > this.w.time) cap *= 0.75;
    }
    return cap;
  }

  clusterOf(rep) {
    for (const s of this.w.structs) if (s.k === 'db' && s.links.includes(rep.id)) return s;
    return null;
  }

  // ---------- nhu cầu ----------
  dayFactor() {
    const c = this.w.clock;
    const d = c.dark;
    let f = d < 0.5 ? 1 + d * 0.5 : 1.25 - (d - 0.5) * 1.7;
    f = clamp(f, 0.45, 1.25);
    return f * (1 + 0.05 * Math.sin(this.w.time / 7) + 0.03 * Math.sin(this.w.time / 3.1));
  }

  // ---------- bước chính ----------
  step(dt) {
    const w = this.w;
    const mods = this.mods;
    const nodes = [...w.structs].filter((s) => COMP[s.k]).sort((a, b) => COMP[a.k].layer - COMP[b.k].layer || a.id - b.id);
    this.ctx = new Map();
    this.fb = {};
    for (const n of nodes) {
      const st = this.st(n);
      this.ctx.set(n.id, { n, in: z4(), pass: [1, 1, 1, 1], okSelf: 1, lat: 0, util: 0, load: 0, routes: [], term: z4(), up: this.up(n) });
      if (!this.up(n)) st.backlog = 0;
      if (n.k === 'cdn' || n.k === 'cache') {
        if (this.up(n)) st.warm = Math.min(1, st.warm + dt / 20); else st.warm = 0;
      }
    }
    // ---- nhu cầu từ người dùng ----
    const season = SEASON_DEMAND[w.clock.season];
    const D = w.users * RPS_PER_USER * this.dayFactor() * season * mods.demand;
    const legit = TRAFFIC_MIX.map((m) => D * m);
    let bots = 0;
    for (const m of w.mobs) if (m.k === 'bot') bots++;
    const offered = [legit[0] + this.carry[0], legit[1] + this.carry[1], legit[2] + this.carry[2], bots * BOT_RPS * mods.botScale];
    this.demandNow = D;
    const gws = nodes.filter((n) => n.k === 'gateway');
    const upGw = gws.filter((g) => this.up(g));
    const share = upGw.length ? 1 / upGw.length : 0;
    // ---- top-down ----
    for (const n of nodes) {
      const c = this.ctx.get(n.id);
      switch (n.k) {
        case 'gateway': if (c.up) this.gateway(n, c, offered, share, dt); else this.process(n, c, dt); break;
        case 'cdn': this.cdn(n, c, dt); break;
        case 'lb': this.lb(n, c, dt); break;
        case 'app': this.app(n, c, dt); break;
        case 'cache': this.cache(n, c, dt); break;
        case 'queue': this.queue(n, c, dt); break;
        case 'db': this.db(n, c, dt); break;
        case 'replica': this.replica(n, c, dt); break;
        case 'k8s': this.k8s(n, c, dt); break;
        case 's3': this.s3(n, c, dt); break;
      }
      this.push(n, c);
    }
    // ---- bottom-up: kết quả end-to-end ----
    const e2e = new Map();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i], c = this.ctx.get(n.id);
      const ok = z4(), lat = z4();
      for (let k = 0; k < 4; k++) {
        let succ = 0, lsum = 0;
        const okS = c.okSelf;
        // phần xử lý tại chỗ
        if (c.term[k] > 0) { const s = c.term[k] * okS; succ += s; lsum += s * c.lat; }
        for (const r of c.routes) {
          const f = r.frac[k];
          if (f <= 0) continue;
          const ch = e2e.get(r.id);
          if (!ch) continue;
          let cok = ch.ok[k];
          if (r.retry) cok = 1 - Math.pow(1 - cok, 1 + r.retry);
          const s = f * cok * (r.pre ? 1 : okS);
          succ += s;
          lsum += s * ((r.pre ? 0 : c.lat) + ch.lat[k]);
        }
        ok[k] = clamp(succ, 0, 1) * (c.pass[k] ?? 1);
        lat[k] = succ > 1e-9 ? lsum / succ : 0;
      }
      e2e.set(n.id, { ok, lat });
      c.e2e = { ok, lat };
    }
    this.finish(nodes, upGw, gws, offered, e2e, dt);
  }

  push(n, c) {
    for (const r of c.routes) {
      const ch = this.ctx.get(r.id);
      if (!ch) continue;
      const base = r.pre && c.orig ? c.orig : c.in;
      let rate = 0;
      for (let k = 0; k < 4; k++) {
        const v = base[k] * r.frac[k] * (r.send ? r.send[k] ?? 1 : 1) * (r.pre ? 1 : c.okSelf);
        ch.in[k] += v;
        rate += v;
      }
      if (r.extra) { for (let k = 0; k < 4; k++) ch.in[k] += r.extra[k]; rate += r.extra.reduce((a, b) => a + b, 0); }
      r.rate = rate;
    }
  }

  // Xử lý chung: tính tải, backlog, độ trễ, tỉ lệ drop
  process(n, c, dt) {
    const st = this.st(n);
    const cost = COST[n.k];
    let load = st.extraLoad || 0;
    for (let k = 0; k < 4; k++) load += c.in[k] * cost[k];
    c.load = load;
    if (!c.up) { c.okSelf = 0; c.lat = 0; c.util = 0; st.util = 0; return; }
    const C = COMP[n.k];
    const cap = this.capOf(n);
    const rho = load / cap;
    const A = load * dt, S = cap * dt;
    const total = (st.backlog || 0) + A;
    const served = Math.min(total, S);
    const rest = total - served;
    const bmax = cap * 1.0;
    const dropped = Math.max(0, rest - bmax);
    st.backlog = rest - dropped;
    const dropFrac = A > 1e-9 ? Math.min(1, dropped / A) : 0;
    let ok = 1 - dropFrac;
    const base = C.base[Math.min(n.tier, C.base.length) - 1];
    let lat = base / (1 - Math.min(rho, 0.95)) + (st.backlog / cap) * 1000;
    if (n.k === 'app') {
      if (n.bad) ok *= 0.6;
      if (st.mem > 85) lat *= 1.5;
    }
    if (n.k === 'db' && st.rebalUntil > this.w.time) lat *= 1.3;
    c.okSelf = ok;
    c.lat = lat;
    c.util = rho;
    st.util = rho;
    st.lastLat = lat;
    st.lastIn = c.in[0] + c.in[1] + c.in[2] + c.in[3];
  }

  // ---------- gateway ----------
  gateway(n, c, offered, share, dt) {
    const st = this.st(n);
    let inn = offered.map((v) => v * share);
    st.blocked = 0;
    if (n.waf) { st.blocked = inn[3] * 0.95; inn[3] *= 0.05; }
    const rl = n.cfg.rl;
    st.limited = 0;
    if (rl > 0) {
      const tot = inn[0] + inn[1] + inn[2] + inn[3];
      if (tot > rl) {
        const a = rl / tot;
        st.limited = tot - rl;
        inn = inn.map((v) => v * a);
        c.pass = [a, a, a, a];
      }
    }
    c.in = inn;
    this.process(n, c, dt);
    const def = this.firstBelieved(n, ['k8s', 'lb', 'app'], HC_DELAY.gateway);
    const stat = this.firstBelieved(n, ['cdn'], HC_DELAY.gateway) || this.firstBelieved(n, ['s3'], HC_DELAY.gateway);
    if (stat) c.routes.push({ id: stat.id, frac: [1, 0, 0, 0] });
    if (def) c.routes.push({ id: def.id, frac: [stat ? 0 : 1, 1, 1, 1] });
  }

  // ---------- CDN ----------
  cdn(n, c, dt) {
    const st = this.st(n);
    this.process(n, c, dt);
    const hit = 0.92 * st.warm;
    st.hit = hit;
    c.term = [hit, 0, 0, 0];
    const origin = this.firstBelieved(n, ['s3', 'k8s', 'lb', 'app'], HC_DELAY.gateway);
    if (origin) c.routes.push({ id: origin.id, frac: [1 - hit, 0, 0, 0] });
  }

  // ---------- Load balancer ----------
  lb(n, c, dt) {
    const st = this.st(n);
    this.process(n, c, dt);
    const targets = this.linked(n, ['app']).filter((t) => this.believed(n, t, HC_DELAY.lb));
    if (n.asg && c.up && targets.length) this.autoscale(st, targets, 15);
    if (!targets.length) { n._ws = {}; return; }
    const algo = n.cfg.algo;
    const nT = targets.length;
    let ws;
    if (algo === 'lc') ws = targets.map((t) => this.capOf(t) * Math.max(0.05, 1 - Math.min(1, this.st(t).util || 0)));
    else if (algo === 'hash') {
      const skew = clamp(0.2 + this.mods.skewLb, 0, 0.95);
      const hot = 1 / nT + skew * (1 - 1 / nT);
      ws = targets.map((t, i) => (nT === 1 ? 1 : i === 0 ? hot : (1 - hot) / (nT - 1)));
    } else ws = targets.map((t, i) => 1 + (i === 0 ? targets[0].virt || 0 : 0));
    const sum = ws.reduce((a, b) => a + b, 0);
    targets.forEach((t, i) => c.routes.push({ id: t.id, frac: [ws[i] / sum, ws[i] / sum, ws[i] / sum, ws[i] / sum] }));
    st.shares = Object.fromEntries(targets.map((t, i) => [t.id, ws[i] / sum]));
  }

  // Autoscale nhóm App `targets` (thêm/bớt instance ảo trên App đầu nhóm). `delay` = thời gian khởi động instance mới.
  autoscale(st, targets, delay) {
    const tmpl = targets[0];
    let l = 0, cp = 0;
    for (const t of targets) { const x = this.ctx.get(t.id); if (x) { l += x.load; cp += this.capOf(t); } }
    const u = cp ? l / cp : 0;
    const now = this.w.time;
    if (st.pendingUp && now >= st.pendingUp) { tmpl.virt = Math.min(6, (tmpl.virt || 0) + 1); st.pendingUp = 0; st.nextScale = now + 20; }
    if (u > 0.7 && !st.pendingUp && (tmpl.virt || 0) < 6 && now >= (st.nextScale || 0)) st.pendingUp = now + delay;
    if (u < 0.3) { st.lowSince = st.lowSince ?? now; if (now - st.lowSince > 30 && tmpl.virt > 0 && now >= (st.nextScale || 0)) { tmpl.virt--; st.nextScale = now + 20; st.lowSince = now; } } else st.lowSince = null;
    st.asgU = u;
  }

  // ---------- Kubernetes ----------
  // Ingress + scheduler: chia theo công suất còn trống, readiness probe phát hiện pod chết sau ~1 s.
  // Với App đã đóng container: tự chữa (restart pod chết), HPA, rollback khi readiness thất bại sau deploy.
  k8s(n, c, dt) {
    const w = this.w;
    const st = this.st(n);
    this.process(n, c, dt);
    const pods = this.linked(n, ['app']);
    const managed = pods.filter((a) => a.cont);
    st.pods = managed.length;
    st.heals = st.heals || 0;
    const now = w.time;
    if (c.up) {
      for (const a of managed) {
        const vis = w.isMonitored(a.x, a.y);
        if (a.crashed) {
          if (st.heal[a.id] === undefined) st.heal[a.id] = now + K8S_HEAL_DELAY;
          if (now >= st.heal[a.id]) {
            delete st.heal[a.id];
            a.crashed = false;
            a.hp = Math.max(a.hp, a.mhp * 0.5);
            w.startReboot(a, 4);
            st.heals++;
            if (vis) { w.say('Kubernetes tự khởi động lại pod App đã chết (self-healing).', 'good'); w.unlock('concept-orchestration'); }
          }
        } else delete st.heal[a.id];
        if (a.bad && !a.crashed) {
          if (st.badAt[a.id] === undefined) st.badAt[a.id] = now;
          if (now - st.badAt[a.id] >= K8S_ROLLBACK_DELAY) {
            delete st.badAt[a.id];
            a.bad = false;
            a.ver = Math.max(1, a.ver - 1);
            w.startReboot(a, 1);
            st.rollbacks = (st.rollbacks || 0) + 1;
            if (vis) { w.say(`Readiness probe thất bại: Kubernetes tự rollback App về v${a.ver}.`, 'good'); w.unlock('concept-orchestration'); }
            w.director.onRollback(a);
          }
        } else delete st.badAt[a.id];
      }
    }
    const targets = pods.filter((t) => this.believed(n, t, HC_DELAY.k8s));
    const live = targets.filter((t) => t.cont);
    if (c.up && live.length) this.autoscale(st, live, 8);
    if (!targets.length) return;
    const ws = targets.map((t) => this.capOf(t) * Math.max(0.05, 1 - Math.min(1, this.st(t).util || 0)));
    const sum = ws.reduce((a, b) => a + b, 0);
    targets.forEach((t, i) => c.routes.push({ id: t.id, frac: [ws[i] / sum, ws[i] / sum, ws[i] / sum, ws[i] / sum] }));
    st.shares = Object.fromEntries(targets.map((t, i) => [t.id, ws[i] / sum]));
  }

  // ---------- Object storage ----------
  // Phục vụ lớp tĩnh tại chỗ: rất rẻ cho compute, nhưng chậm hơn CDN/cache.
  s3(n, c, dt) {
    this.process(n, c, dt);
    c.term = [1, 0, 0, 0];
  }

  // ---------- App ----------
  app(n, c, dt) {
    const st = this.st(n);
    this.process(n, c, dt);
    // rò bộ nhớ
    if (st.leak && c.up) {
      st.mem = Math.min(100, st.mem + 0.9 * dt);
      if (st.mem >= 100) { st.leak = false; st.mem = 0; this.w.crash(n, 'oom'); }
    } else if (c.up && st.mem > 0 && !st.leak) st.mem = Math.max(0, st.mem - 0.2 * dt);
    c.term = [1, 0, 0, 0];
    const cache = this.firstBelieved(n, ['cache'], HC_DELAY.app);
    const db = this.firstBelieved(n, ['db'], HC_DELAY.app);
    const queue = this.firstBelieved(n, ['queue'], HC_DELAY.app);
    const readT = cache || db;
    const writeT = queue || db;
    if (cache && db) this.fb[cache.id] = db;
    if (queue && db) this.fb[queue.id] = db;
    // circuit breaker
    const br = st.br;
    const now = this.w.time;
    let open = 0;
    if (n.cfg.breaker) {
      if (br.state === 'open' && now >= br.until) br.state = 'half';
      if (br.state === 'closed' && st.pf > 0.5) { if (++br.strikes >= 2) { br.state = 'open'; br.until = now + 5; br.strikes = 0; } } else if (br.state === 'closed') br.strikes = 0;
      if (br.state === 'half') { if (st.pf < 0.3) br.state = 'closed'; else { br.state = 'open'; br.until = now + 5; } }
      open = br.state === 'open' ? 0.95 : br.state === 'half' ? 0.8 : 0;
    } else br.state = 'closed';
    const retries = n.cfg.retries;
    const amp = 1 + retries * st.pf * (n.cfg.backoff ? 0.35 : 1);
    const retry = retries * 0.6;
    const f = 1 - open;
    const send = [1, amp, amp, amp];
    const mk = (t, frac) => ({ id: t.id, frac, send, retry, app: true });
    const rr = readT ? mk(readT, [0, f, 0, f]) : null;
    const ww = writeT ? mk(writeT, [0, 0, f, 0]) : null;
    if (rr) c.routes.push(rr);
    if (ww) c.routes.push(ww);
    st.brState = br.state;
    st.amp = amp;
  }

  // ---------- Cache ----------
  cache(n, c, dt) {
    const st = this.st(n);
    const C = COMP.cache;
    const t = Math.min(n.tier, 3) - 1;
    // đồng bộ hoá hết hạn: key nạp cùng lúc hết hạn cùng lúc
    if (c.up) {
      st.ttlT += dt;
      if (st.ttlT >= n.cfg.ttl) {
        st.ttlT = 0;
        st.crush = st.sync * (n.cfg.coalesce ? 1.6 : 2.0);
        st.sync = n.cfg.jitter ? 0 : st.sync * 0.75;
        if (st.sync < 0.08) st.sync = 0;
      }
    } else { st.sync = 1; st.ttlT = 0; }
    if (this.mods.stampedeUntil > this.w.time) { st.sync = 1; if (st.crush <= 0) st.crush = 2; }
    this.process(n, c, dt);
    const ttlF = { 10: 0.8, 30: 1, 60: 1.08 }[n.cfg.ttl] || 1;
    let h = Math.min(0.97, C.hit[t] * ttlF) * st.warm;
    let crushed = false;
    if (st.crush > 0) {
      crushed = true;
      h *= n.cfg.coalesce ? 0.55 : 0.2;
      st.crush -= dt;
    }
    st.hit = h;
    st.crushed = crushed;
    const hb = 0.05 * st.warm;
    c.term = [0, h, 0, hb];
    const db = this.firstBelieved(n, ['db'], HC_DELAY.app) || this.fb[n.id] || null;
    if (db) c.routes.push({ id: db.id, frac: [0, 1 - h, 0, 1 - hb] });
  }

  // ---------- Queue ----------
  queue(n, c, dt) {
    const st = this.st(n);
    const C = COMP.queue;
    const t = Math.min(n.tier, 2) - 1;
    const buffer = C.buffer[t];
    // nhận ghi
    const inW = c.in[2];
    this.process(n, c, dt);
    const room = Math.max(0, buffer - st.q);
    const accept = Math.min(inW * dt * c.okSelf, room);
    const acceptFrac = inW * dt * c.okSelf > 1e-9 ? accept / (inW * dt * c.okSelf) : 1;
    c.okSelf *= acceptFrac;
    c.term = [0, 0, 1, 0];
    st.q += accept;
    // xả vào DB (backpressure theo tải DB lượt trước)
    const db = this.firstBelieved(n, ['db'], HC_DELAY.app) || this.fb[n.id] || null;
    const dbCtxUtil = db ? this.st(db).util || 0 : 0;
    const bp = clamp(1.25 - dbCtxUtil, 0.05, 1);
    const drainCap = Math.min(C.cap[t] * 0.3, 600) * bp;
    const attempt = db && c.up ? Math.min(drainCap, st.q / dt) : 0;
    st.lastAttempt = attempt;
    if (attempt > 0) c.routes.push({ id: db.id, frac: [0, 0, 0, 0], extra: [0, 0, attempt, 0], drain: true });
    st.fullness = st.q / buffer;
  }

  // ---------- Database ----------
  db(n, c, dt) {
    const w = this.w;
    const st = this.st(n);
    const cfg = n.cfg;
    const reps = this.linked(n, ['replica']);
    const now = w.time;
    const dbUp = c.up;
    const reach = (r) => this.up(r) && !this.cut(n, r);
    const members = [n, ...reps];
    // --- leader ---
    let leaderEnt = w.ents.get(st.leader) || n;
    const isDb = leaderEnt === n;
    const leaderUp = isDb ? dbUp : reach(leaderEnt);
    const wsum = c.in[2];
    // Từ góc nhìn replica: leader "có vẻ chết" nếu chết thật HOẶC bị cắt khỏi replica (partition).
    const isolated = isDb && dbUp ? reps.filter((r) => this.up(r) && this.cut(n, r)) : [];
    const seemsDown = !st.split && (!leaderUp || isolated.length > 0);
    if (seemsDown) {
      st.since = st.since || now;
      if (now - st.since >= FAILOVER_DELAY && cfg.failover !== 'off') {
        const cands = !leaderUp ? members.filter((m) => m !== leaderEnt && (m === n ? dbUp : reach(m))) : isolated;
        // phía của ứng viên có đa số không? (quorum cần > một nửa tổng số node)
        const side = !leaderUp ? members.filter((m) => m !== leaderEnt && (m === n ? dbUp : reach(m))).length : cands.length;
        const ok = cfg.failover === 'auto' || side > members.length / 2;
        if (cands.length && ok) {
          const nl = cands[0];
          const lag = cfg.repl === 'sync' ? 0 : st.lag;
          const lost = Math.round(wsum * lag + (st.diskLoss ? st.sinceBackup * DATALOSS.loss : 0));
          st.diskLoss = false;
          st.leader = nl.id;
          st.since = 0;
          leaderEnt = nl;
          w.director.onFailover(n, nl, lost);
        }
      }
    } else st.since = 0;
    // phần còn lại tính lại sau failover
    const realLeader = w.ents.get(st.leader) || n;
    // split brain: node cũ vẫn sống và leader mới bị cắt
    const splitNow = realLeader !== n && dbUp && this.cut(n, realLeader) && this.up(realLeader);
    if (splitNow && !st.split) { st.split = true; w.director.onSplit(n); }
    if (st.split && !splitNow) { st.split = false; const lost = Math.round(st.conflicts); st.conflicts = 0; w.director.onHeal(n, lost); }
    if (st.split) st.conflicts += wsum * 0.5 * dt;
    // khi split, client vẫn ghi vào primary cũ (cả hai phía cùng nhận ghi)
    const leaderNow = st.split ? n : realLeader;
    const leaderIsDb = leaderNow === n;
    const leaderOk = leaderIsDb ? dbUp : reach(leaderNow);
    n.leader = leaderIsDb;
    for (const r of reps) r.leader = r === realLeader;
    // --- khả năng ghi ---
    let why = '';
    let writable = leaderOk;
    if (!leaderOk) why = 'leader down';
    const diskFull = st.disk >= 1;
    if (writable && diskFull) { writable = false; why = 'disk full'; }
    const upReps = reps.filter(reach);
    if (writable && cfg.repl === 'sync' && reps.length > 0) {
      const followers = members.filter((m) => m !== leaderNow && (m === n ? dbUp : reach(m)));
      if (!followers.length) { writable = false; why = 'sync: no replica'; }
    }
    if (writable && cfg.failover === 'quorum' && reps.length > 0) {
      const count = members.filter((m) => {
        if (m === leaderNow) return true;
        if (m === n) return dbUp && (leaderNow === n || !this.cut(n, leaderNow));
        return reach(m);
      }).length;
      if (count <= members.length / 2) { writable = false; why = 'no quorum'; }
    }
    st.why = why;
    st.writable = writable;
    // --- chia đọc ---
    const memCaps = [];
    let tot = 0;
    const selfUp = dbUp;
    if (selfUp) { const x = this.capOf(n); memCaps.push([n, x]); tot += x; }
    for (const r of upReps) { const x = this.capOf(r); memCaps.push([r, x]); tot += x; }
    const frac = (m) => { const e = memCaps.find((a) => a[0] === m); return e && tot ? e[1] / tot : 0; };
    const selfFrac = frac(n);
    const orig = c.in.slice();
    // ghi chỉ đi tới leader
    const wSelf = leaderIsDb && writable ? 1 : 0;
    const selfIn = [0, orig[1] * selfFrac, orig[2] * wSelf, orig[3] * selfFrac];
    c.in = selfIn;
    c.orig = orig;
    c.term = [0, selfFrac, wSelf, selfFrac];
    // phân tích: nếu node chưa có tải thì giữ thuật ngữ đơn giản
    const analytics = this.mods.analytics;
    st.extraLoad = 0;
    if (analytics && analytics.until > now) {
      const target = upReps[0] || (dbUp ? n : null);
      if (target === n) st.extraLoad += analytics.load;
    }
    const archived = st.archUntil > now ? 80 : 0;
    st.extraLoad += archived;
    this.backup(n, st, dbUp, now);
    if (st.snapUntil) st.extraLoad += BACKUP[cfg.backup].io;
    this.process(n, c, dt);
    if (st.corrupt) c.okSelf *= 1 - DATALOSS.fail; // lỗi dữ liệu đã được replicate: replica cũng hỏng như vậy (xem replica())
    // đĩa
    if (dbUp) {
      const GB = COMP.db.disk[Math.min(n.tier, 3) - 1];
      // Backup/archival sang Object Storage: snapshot định kỳ + dữ liệu lạnh được đẩy ra khỏi đĩa DB
      const bk = this.linked(n, ['s3']).find((t) => this.up(t) && !this.cut(n, t));
      st.backupOn = !!bk;
      if (bk && !st.corrupt) {
        st.bkAge = (st.bkAge || 0) + dt;
        if (st.bkAge >= BACKUP_EVERY) { st.bkAge = 0; st.sinceBackup = 0; st.lastBackup = now; }
      }
      const writesAcc = (leaderIsDb && writable ? orig[2] * c.okSelf : 0) + (!leaderIsDb && writable ? orig[2] : 0);
      st.disk = clamp(st.disk + writesAcc * dt * 0.00003 * (60 / GB) * (cfg.retention ? 0.4 : 1) * (bk ? 0.75 : 1) * this.mods.diskRate, 0, 1);
      st.sinceBackup += writesAcc * dt;
      st.disk = Math.round(st.disk * 10000) / 10000;
    }
    // lag sao chép
    const leaderUtil = leaderIsDb ? c.util : this.st(leaderNow).util || 0;
    const cutReps = reps.filter((r) => this.cut(n, r)).length;
    const tgt = cfg.repl === 'sync' ? 0.05 : leaderUtil > 0.85 ? 0.3 + (leaderUtil - 0.85) * 40 : 0.3;
    st.lag += (tgt - st.lag) * 0.3;
    if (cutReps && cfg.repl !== 'sync') st.lag += dt;
    st.lag = clamp(st.lag, 0, 60);
    // read routes (pre-split) tới replicas
    for (const r of upReps) {
      const fr = frac(r);
      const isL = r === leaderNow && writable;
      c.routes.push({ id: r.id, pre: true, frac: [0, fr, isL ? 1 : 0, fr] });
    }
    st.members = memCaps.length;
    // replicas nhận tải replay (ghi) để mô phỏng chi phí sao chép
    const accepted = writable ? orig[2] * (leaderIsDb ? c.okSelf : 1) : 0; // chỉ replay các ghi đã được chấp nhận
    for (const r of reps) { const rs = this.st(r); rs.extraLoad = r === realLeader ? 0 : accepted * (cfg.repl === 'sync' ? 1.2 : 0.8); rs.lag = st.lag; }
    if (analytics && analytics.until > now && upReps[0]) this.st(upReps[0]).extraLoad += analytics.load;
  }

  // Snapshot định kỳ: chạy `run` giây (tốn IO), xong thì chiếm đĩa và đặt lại sinceBackup. Tắt backup = xoá mọi snapshot.
  // Dữ liệu đang hỏng thì không snapshot, để không ghi đè điểm khôi phục sạch bằng dữ liệu hỏng.
  backup(n, st, dbUp, now) {
    const b = BACKUP[n.cfg.backup];
    if (!b.every) { st.lastBackupAt = null; st.snapUntil = 0; }
    else if (!dbUp || st.corrupt) st.snapUntil = 0;
    else if (st.snapUntil) {
      if (now >= st.snapUntil) {
        st.disk = clamp(st.disk + b.disk * (60 / COMP.db.disk[Math.min(n.tier, 3) - 1]) * (n.cfg.retention ? 0.4 : 1), 0, 1);
        st.lastBackupAt = now;
        st.sinceBackup = 0;
        st.snapUntil = 0;
      }
    } else if (st.lastBackupAt === null || now - st.lastBackupAt >= b.every - b.run) st.snapUntil = now + b.run;
    // Không có snapshot để khôi phục: sau DATALOSS.rebuild giây cả đội tự dựng lại dữ liệu từ đầu và mất mọi ghi chưa được bảo vệ.
    if (st.corrupt && !this.hasSnapshot(n) && now - st.corrupt.at >= DATALOSS.rebuild) {
      const lost = this.atRisk(n);
      st.corrupt = null;
      st.sinceBackup = 0;
      this.w.director.onRestore(n, lost, true);
    }
  }

  // Thời điểm của điểm khôi phục mới nhất (null = chưa có). Hai nguồn độc lập: snapshot theo cfg.backup (lastBackupAt, bị xoá khi tắt Backup)
  // và snapshot sang Object Storage (lastBackup, nằm ở S3 nên tắt Backup không xoá được). Khôi phục chỉ cần biết điểm nào mới nhất.
  snapshotAt(db) {
    const st = this.st(db);
    const local = db.cfg.backup !== 'off' ? st.lastBackupAt : null;
    const s3 = (st.lastBackup ?? -1) >= 0 ? st.lastBackup : null;
    return local === null ? s3 : s3 === null ? local : Math.max(local, s3);
  }
  hasSnapshot(db) { return this.snapshotAt(db) !== null; }
  // Số bản ghi sẽ mất nếu phải quay về snapshot cuối (RPO thực tế)
  atRisk(db) { return Math.round(this.st(db).sinceBackup * DATALOSS.loss); }

  replica(n, c, dt) {
    this.process(n, c, dt);
    const db = this.clusterOf(n);
    if (db && this.st(db).corrupt) c.okSelf *= 1 - DATALOSS.fail; // replica sao chép cả dữ liệu hỏng: không "chữa" được
    c.term = [0, 1, 1, 1];
  }

  // ---------- kết quả cuối ----------
  finish(nodes, upGw, gws, offered, e2e, dt) {
    const w = this.w;
    const mods = this.mods;
    // cập nhật backlog hàng đợi (sau khi biết DB xử lý được bao nhiêu)
    for (const n of nodes) {
      if (n.k === 'queue') {
        const st = this.st(n), c = this.ctx.get(n.id);
        const r = c.routes.find((x) => x.drain);
        if (r && st.lastAttempt) {
          const dbc = this.ctx.get(r.id);
          const eff = e2e.get(r.id) ? e2e.get(r.id).ok[2] : 0;
          st.q = Math.max(0, st.q - st.lastAttempt * eff * dt);
        }
        st.lag = st.lastAttempt ? st.q / Math.max(1, st.lastAttempt) : st.q > 0 ? 99 : 0;
      }
      if (n.k === 'app') {
        const st = this.st(n), c = this.ctx.get(n.id);
        let fail = 0, wt = 0;
        for (const r of c.routes) {
          const ch = e2e.get(r.id);
          if (!ch) continue;
          for (let k = 1; k < 4; k++) { const f = c.in[k] * r.frac[k]; if (f > 0) { fail += f * (1 - ch.ok[k]); wt += f; } }
        }
        if (!c.routes.length) {
          const miss = c.in[1] + c.in[2] + c.in[3];
          if (miss > 0) { fail += miss; wt += miss; }
        }
        const inst = wt > 1e-6 ? fail / wt : 0;
        st.pf = st.pf * 0.5 + inst * 0.5;
      }
    }
    // ---- số liệu phía người dùng ----
    let okTot = 0, offTot = 0, latW = 0;
    const okUser = [0, 0, 0];
    const lat = [0, 0, 0];
    const gwList = upGw.length ? upGw : [];
    for (let k = 0; k < 3; k++) {
      let okv = 0, l = 0;
      for (const g of gwList) {
        const e = e2e.get(g.id);
        if (!e) continue;
        okv += e.ok[k] / gwList.length;
        l += e.lat[k] / gwList.length;
      }
      const mean = Math.max(1, l);
      const meet = okv * (1 - Math.exp(-CLIENT_TIMEOUT_MS / mean));
      okUser[k] = clamp(meet, 0, 1);
      lat[k] = l;
      okTot += offered[k] * okUser[k];
      offTot += offered[k];
      latW += offered[k] * okUser[k] * l;
    }
    const success = offTot > 1e-6 ? okTot / offTot : 1;
    const meanLat = okTot > 1e-6 ? latW / okTot : 0;
    const p50 = meanLat * 0.7, p99 = meanLat * 4.6;
    // retry của người dùng
    const demandRaw = this.demandNow * 1;
    for (let k = 0; k < 3; k++) {
      const failed = offered[k] * (1 - okUser[k]);
      this.carry[k] = clamp(failed * USER_RETRY, 0, this.demandNow * TRAFFIC_MIX[k] * 1.0);
    }
    const legitOffered = offTot;
    const amp = this.demandNow > 1e-6 ? legitOffered / this.demandNow : 1;
    // bad traffic phía gateway (số liệu)
    const sloGood = success >= SLO.success && p99 <= SLO.p99;
    if (!mods.drill) {
      w.dayStat.ticks++;
      if (sloGood) w.dayStat.okTicks++;
    }
    const target = 100 * success * clamp(SLO.p99 / Math.max(SLO.p99, p99), 0.3, 1);
    w.sat += (target - w.sat) * 0.25;
    if (w.sat < 30 && !mods.drill && w.users > 0) w.users = Math.max(0, Math.round(w.users * (1 - 0.0007) * 100) / 100);
    this.g = { users: Math.round(w.users), demand: Math.round(legitOffered), served: Math.round(okTot), ok: success, p50, p99, sat: w.sat, slo: sloGood, amp, bad: Math.round(offered[3]) };
    this.pfail = 1 - success;
    // ---- view (che theo vùng giám sát) ----
    const gw = gws[0];
    const detail = !!gw && w.isMonitored(gw.x, gw.y) && this.up(gw) ? true : false;
    const nview = {};
    const eview = {};
    for (const n of nodes) {
      const c = this.ctx.get(n.id), st = this.st(n);
      const vis = w.isMonitored(n.x, n.y);
      if (!vis) continue;
      const m = { u: round(c.util, 2), rps: Math.round(c.in[0] + c.in[1] + c.in[2] + c.in[3]), lat: Math.round(c.lat), err: round(1 - (c.up ? c.okSelf : 0), 3), up: c.up ? 1 : 0 };
      switch (n.k) {
        case 'app': m.mem = Math.round(st.mem); m.pf = round(st.pf, 2); m.br = st.brState; m.amp = round(st.amp || 1, 2); break;
        case 'cache': m.hit = round(st.hit || 0, 2); m.warm = round(st.warm, 2); if (st.crushed) m.crush = 1; break;
        case 'cdn': m.hit = round(st.hit || 0, 2); break;
        case 'queue': m.q = Math.round(st.q); m.lag = round(st.lag, 1); m.full = round(st.fullness || 0, 2); break;
        case 'db': {
          const at = this.snapshotAt(n);
          m.disk = round(st.disk, 3); m.lag = round(st.lag, 1); m.why = st.why || ''; m.split = st.split ? 1 : 0; m.writable = st.writable ? 1 : 0;
          m.snapAge = at === null ? null : Math.round(w.time - at); m.rpo = this.atRisk(n); m.snap = st.snapUntil ? 1 : 0; m.corrupt = st.corrupt ? 1 : 0;
          m.bkOn = st.backupOn ? 1 : 0; m.bk = (st.lastBackup ?? -1) >= 0 ? Math.round(w.time - st.lastBackup) : -1;
          break;
        }
        case 'replica': m.lag = round(st.lag || 0, 1); break;
        case 'k8s': m.pods = st.pods || 0; m.heals = st.heals || 0; m.rollbacks = st.rollbacks || 0; m.asg = st.asgU !== undefined ? round(st.asgU, 2) : undefined; m.shares = st.shares; break;
        case 'lb': m.asg = st.asgU !== undefined ? round(st.asgU, 2) : undefined; m.shares = st.shares; break;
        case 'gateway': m.limited = Math.round(st.limited || 0); m.blocked = Math.round(st.blocked || 0); break;
      }
      nview[n.id] = m;
      for (const r of c.routes) if (r.rate !== undefined) eview[n.id + '>' + r.id] = Math.round(r.rate);
    }
    const g = detail ? this.g : { users: this.g.users, sat: this.g.sat, detail: false };
    const entry = detail
      ? { t: Math.round(w.time), users: g.users, demand: g.demand, ok: round(success, 4), p99: Math.round(p99), sat: Math.round(w.sat) }
      : { t: Math.round(w.time), users: g.users, sat: Math.round(w.sat) };
    w.history.push(entry);
    if (w.history.length > 240) w.history.shift();
    this.view = { tk: w.tick, t: round(w.time, 1), g: { ...g, detail }, n: nview, e: eview, cx: w.complexity, cut: [...mods.cut], entry };
    w.director.observe(this, success, p99, offered);
  }

  // ---------- theo dõi MỘT request ----------
  // Lấy mẫu một request đi theo đúng phân phối của mô phỏng hiện tại (chia tải, cache hit, drop, retry, cáp đứt...).
  // Node ngoài vùng giám sát chỉ hiện "???" (không có số liệu).
  traceRequest(k, rng) {
    const w = this.w;
    const steps = [];
    let ms = 0, why = null, whyNode = null;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const push = (c, st, note, extra = {}) => {
      const vis = w.isMonitored(c.n.x, c.n.y);
      steps.push({ id: c.n.id, k: c.n.k, st, t: vis ? Math.round(ms) : null, u: vis ? Math.round(c.util * 100) : null, note: vis ? note : null, ...extra });
    };
    const fail = (c, code, st, note) => { push(c, st, note); if (!why) { why = code; whyNode = c.n.k; } return false; };

    const walk = (c, depth) => {
      const n = c.n;
      if (depth > 12) return fail(c, 'noroute', 'drop', 'vòng lặp cáp');
      if (!c.up) return fail(c, 'dead', 'dead', n.rb ? 'đang khởi động lại' : n.crashed ? 'đã crash' : 'mất điện');
      if (rng() > (c.pass[k] ?? 1)) return fail(c, 'rl', 'drop', 'bị rate limit — từ chối sớm (429)');
      // chọn nhánh theo xác suất của mô phỏng
      const routes = c.routes.filter((r) => r.frac[k] > 0 && this.ctx.has(r.id));
      const term = c.term[k] || 0;
      let roll = rng(), choice = null, kind = 'none';
      if (roll < term) kind = 'term';
      else {
        roll -= term;
        for (const r of routes) { if (roll < r.frac[k]) { choice = r; kind = 'route'; break; } roll -= r.frac[k]; }
      }
      const own = kind === 'term' || (choice && !choice.pre);
      if (own) {
        ms += c.lat * (0.6 + 0.8 * rng());
        if (rng() > c.okSelf) {
          if (n.k === 'app' && n.bad && c.util <= 1) return fail(c, 'bad', 'drop', 'bản deploy lỗi trả 500');
          return fail(c, 'overload', 'drop', c.util > 1 ? `quá tải (${Math.round(c.util * 100)}%) — hàng đợi đầy, trả 503` : 'lỗi/timeout cục bộ');
        }
      }
      if (kind === 'term') {
        const note = { cdn: 'HIT ở edge — không cần về origin', cache: 'HIT — trả ngay từ RAM', app: 'xử lý logic', db: k === 2 ? 'ghi vào primary' : 'đọc từ primary', replica: 'đọc từ replica', s3: 'đọc object từ Object Storage (bền, nhưng chậm hơn CDN/cache)', queue: `nhận ghi vào hàng đợi (ack sớm), backlog ${Math.round((this.st(n).q) || 0)}`, gateway: 'xử lý' }[n.k] || 'xử lý';
        push(c, n.k === 'cache' || n.k === 'cdn' ? 'hit' : 'ok', note);
        return true;
      }
      if (kind === 'none') {
        // phần xác suất còn lại: không có đường đi
        if (n.k === 'app' && n.cfg.breaker && n._st && n._st.brState !== 'closed') return fail(c, 'breaker', 'drop', 'circuit breaker MỞ — fail fast, không gọi downstream');
        if (n.k === 'db') { const why2 = this.st(n).why; return fail(c, why2 === 'disk full' ? 'disk' : why2 === 'leader down' ? 'dead' : why2 ? 'cap' : 'noroute', 'drop', why2 ? `ghi bị chặn: ${why2}` : 'không có đường đi'); }
        const linked = (n.links || []).map((id) => this.ctx.get(id)).filter(Boolean);
        if (linked.length && linked.every((l) => !l.up)) return fail(c, 'dead', 'drop', 'mọi đích phía sau đều đã chết');
        return fail(c, 'noroute', 'drop', routes.length || c.term.some((x) => x > 0) ? 'không có đích còn sống' : 'chưa nối cáp tới đích');
      }
      const child = this.ctx.get(choice.id);
      const note = { cdn: 'MISS — về origin', cache: 'MISS — xuống DB', lb: `chia tải → ${child.n.k} #${child.n.id}`, k8s: `scheduler → pod ${child.n.k} #${child.n.id}`, gateway: child.n.k === 'cdn' ? 'tĩnh → CDN' : child.n.k === 's3' ? 'tĩnh → Object Storage' : `chuyển tiếp → ${child.n.k} #${child.n.id}`, app: choice.frac[2] > 0 ? 'gọi nơi lưu dữ liệu để ghi' : 'gọi nơi lưu dữ liệu để đọc', queue: 'xả vào DB', db: 'đọc từ replica' }[n.k] || 'chuyển tiếp';
      push(c, 'ok', note);
      if (this.cut(n, child.n)) return fail(child, 'cut', 'cut', 'cáp bị đứt (network partition)');
      const attempts = 1 + Math.min(3, Math.floor((choice.retry || 0) + rng()));
      for (let a = 0; a < attempts; a++) {
        if (a > 0) {
          if (n.cfg && n.cfg.backoff) ms += 100 * 2 ** a * (0.5 + rng());
          push(c, 'retry', `thử lại lần ${a}${n.cfg && n.cfg.backoff ? ' (backoff+jitter)' : ' (ngay lập tức)'}`);
          why = null;
        }
        if (walk(child, depth + 1)) return true;
      }
      return false;
    };

    const gws = [...this.ctx.values()].filter((c) => c.n.k === 'gateway' && c.up);
    let ok = false;
    if (!gws.length) {
      const g = [...this.ctx.values()].find((c) => c.n.k === 'gateway');
      if (g) fail(g, 'dead', 'dead', 'Gateway không chạy'); 
    } else ok = walk(gws[Math.floor(rng() * gws.length)], 0);
    let outcome = ok ? 'ok' : 'fail';
    if (ok && ms > 3000) { outcome = 'timeout'; why = 'timeout'; }
    const HINTS = {
      dead: ['Node chết giữa đường: không có dự phòng thì request mất. Thêm bản dự phòng (N+1) và health check.', 'concept-spof'],
      overload: ['Node quá tải: hàng đợi đầy nên trả 503. Scale-out, cache hoặc rate limit.', 'concept-utilization'],
      bad: ['Bản deploy lỗi: canary + giám sát + rollback nhanh giới hạn blast radius.', 'concept-blast-radius'],
      cut: ['Cáp đứt: cần đường dự phòng; với DB, chọn sync/quorum theo CAP.', 'concept-cap'],
      rl: ['Rate limit từ chối sớm để bảo vệ backend (load shedding).', 'concept-load-shedding'],
      breaker: ['Circuit breaker mở: fail fast để downstream kịp hồi phục.', 'concept-circuit-breaker'],
      timeout: ['Request chậm quá 3 s nên client bỏ cuộc: hãy theo dõi p99, không chỉ trung bình.', 'concept-tail-latency'],
      disk: ['Đĩa DB đầy nên ghi thất bại: retention/archive và cảnh báo dung lượng.', 'comp-db'],
      cap: ['DB từ chối ghi để giữ nhất quán (sync/quorum): đó là lựa chọn CP của CAP.', 'concept-cap'],
      noroute: ['Request không có đường đi: kiểm tra cáp của component này.', 'comp-lb'],
    };
    const h = why && HINTS[why];
    return { cls: CLS[k], outcome, ms: Math.round(ms), steps, why, whyNode, hint: h ? { text: h[0], codex: h[1] } : null };
  }

  // Lấy mẫu nhiều request để thấy phân phối (p50/p99, lý do lỗi hay gặp nhất)
  traceStats(k, rng, n) {
    const times = [], reasons = {};
    let okN = 0;
    for (let i = 0; i < n; i++) {
      const r = this.traceRequest(k, rng);
      times.push(r.ms);
      if (r.outcome === 'ok') okN++;
      else { const key = `${r.whyNode || '?'}:${r.why || '?'}`; reasons[key] = (reasons[key] || 0) + 1; }
    }
    times.sort((a, b) => a - b);
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
    return { n, ok: okN, p50: times[Math.floor(n * 0.5)], p99: times[Math.min(n - 1, Math.floor(n * 0.99))], top: top ? { node: top[0].split(':')[0], why: top[0].split(':')[1], n: top[1] } : null };
  }

  // Dữ liệu post-mortem: lấy chỉ số node thật
  nodeStats() {
    const out = {};
    for (const [id, c] of this.ctx) out[id] = { util: c.util, okSelf: c.okSelf, lat: c.lat, k: c.n.k };
    return out;
  }
}

function round(v, d) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
