// Incident Director: lên lịch sự cố, áp hiệu ứng lên mô phỏng, đo tác động và sinh post-mortem
// dựa trên kiến trúc THẬT của người chơi tại thời điểm sự cố.
import { COMP, STRUCTS, SLO, TILE, MAP_W, MAP_H, KP_PERFECT_BONUS, BACKUP } from './data.js';
import { clamp, dist, weightedPick, round1 } from './util.js';
import { spawnMob } from './mobs.js';
import { BASE_TX, BASE_TY } from './worldgen.js';

const pct = (v) => Math.round(v * 100) + '%';

// ----------------------------------------------------------------------------
// Trích xuất "sự thật kiến trúc" từ thế giới
export function archFacts(w) {
  const comps = [...w.structs].filter((s) => COMP[s.k]);
  const of = (k) => comps.filter((s) => s.k === k);
  const apps = of('app'), lbs = of('lb'), caches = of('cache'), dbs = of('db'), reps = of('replica');
  const gens = [...w.structs].filter((s) => s.k === 'generator');
  const mon = comps.filter((s) => w.isMonitored(s.x, s.y));
  return {
    apps: apps.length, appsUp: apps.filter((a) => a.on && !a.crashed).length, lbs: lbs.length, caches: caches.length,
    queues: of('queue').length, cdns: of('cdn').length, dbs: dbs.length, replicas: reps.length, gens: gens.length,
    turrets: [...w.structs].filter((s) => s.k === 'turret').length,
    waf: of('gateway').some((g) => g.waf), rl: Math.max(0, ...of('gateway').map((g) => g.cfg.rl)),
    breaker: apps.some((a) => a.cfg.breaker), breakerAll: apps.length > 0 && apps.every((a) => a.cfg.breaker),
    backoff: apps.some((a) => a.cfg.backoff), retries: Math.max(0, ...apps.map((a) => a.cfg.retries)),
    asg: lbs.some((l) => l.asg), lbAlgo: lbs[0] ? lbs[0].cfg.algo : null,
    jitter: caches.length > 0 && caches.every((c) => c.cfg.jitter), coalesce: caches.some((c) => c.cfg.coalesce),
    shards: Math.max(1, ...dbs.map((d) => d.shards)), salt: dbs.some((d) => d.cfg.salt), retention: dbs.some((d) => d.cfg.retention),
    failover: dbs[0] ? dbs[0].cfg.failover : 'off', repl: dbs[0] ? dbs[0].cfg.repl : 'async',
    backup: dbs.some((d) => d.cfg.backup !== 'off' || (d._st && d._st.backupOn)), backupMode: dbs[0] ? dbs[0].cfg.backup : 'off',
    monitored: comps.length ? mon.length / comps.length : 1, comps: comps.length,
    maxTier: Math.max(1, ...comps.map((c) => c.tier)),
    s3: of('s3').length, k8s: of('k8s').length, balancers: lbs.length + of('k8s').length,
    containers: apps.filter((a) => a.cont).length, k8sManaged: apps.filter((a) => w.orchestrator(a)).length,
    s3Backup: dbs.some((d) => d._st && d._st.backupOn),
  };
}

const newMods = () => ({ demand: 1, cut: new Set(), stampedeUntil: 0, skewLb: 0, skewDb: 0, analytics: null, diskRate: 1, botScale: 1, drill: false });

// ----------------------------------------------------------------------------
// Định nghĩa sự cố
// can(w, f): có thể xảy ra không. start(w, inc, f) -> false nếu huỷ. tick(w, inc, dt). done(w, inc) -> bool. end(w, inc).
// diag(w, inc, f, A) -> mảng check {ok, t, d}; A = thống kê sau sự cố
export const INCIDENTS = {
  spike: {
    name: 'Traffic spike (thundering herd)', minDay: 2,
    weight: (s) => ({ spring: 2.5, summer: 2, autumn: 1, winter: 0.7 })[s],
    can: () => true,
    start(w, inc) {
      inc.mult = Math.min(3.5, 1.8 + w.clock.day * 0.1 + w.rng() * 0.6);
      inc.dur = 44 + w.rng() * 12;
      w.say('Một bài viết của bạn lên trang nhất Hacker News — đám đông đang kéo tới!', 'warn');
      return true;
    },
    tick(w, inc) {
      const t = w.time - inc.t0;
      const ramp = Math.min(1, t / 8), fall = Math.min(1, (inc.dur - t) / 8);
      w.director.mods.demand = 1 + (inc.mult - 1) * Math.max(0, Math.min(ramp, fall));
    },
    done: (w, inc) => w.time - inc.t0 >= inc.dur,
    end: (w) => { w.director.mods.demand = 1; },
    visible: () => true,
    diag: (w, inc, f, A) => [
      { ok: f.appsUp >= 2 && f.balancers > 0, t: 'Scale-out có Load Balancer', d: f.appsUp >= 2 && f.balancers > 0 ? `${f.appsUp} App sau LB/Kubernetes chia tải.` : 'Một App đơn lẻ không thể gánh x' + inc.mult.toFixed(1) + ' tải. Thêm App + Load Balancer (horizontal scaling).' },
      { ok: f.asg || f.k8sManaged > 0, t: 'Autoscaler', d: f.k8sManaged > 0 ? 'Kubernetes HPA thêm pod khi tải > 70% (khởi động ~8s vì image đã sẵn sàng).' : f.asg ? 'Instance tự thêm khi tải > 70%, nhưng cần ~15s khởi động.' : 'Không có Autoscaler: capacity cố định lúc tải cao nhất. Đánh đổi: autoscale tốn điện/tiền khi chạy.' },
      { ok: f.rl > 0, t: 'Rate limit / load shedding', d: f.rl > 0 ? `Rate limit ${f.rl} req/s bảo vệ backend, đổi lại một phần người dùng bị từ chối sớm.` : 'Không rate limit: quá tải làm MỌI người cùng chậm/lỗi thay vì từ chối có chọn lọc một phần.' },
      { ok: f.cdns > 0 || f.s3 > 0, t: 'CDN / Object Storage hấp thụ traffic tĩnh', d: f.cdns > 0 ? 'CDN giảm ~30% request lên origin.' : f.s3 > 0 ? 'Object Storage phục vụ lớp tĩnh rẻ hơn App nhiều, nhưng chậm hơn CDN edge.' : '30% traffic là file tĩnh — CDN và Object Storage sẽ gánh gần hết.' },
      { ok: f.queues > 0, t: 'Queue đệm ghi', d: f.queues > 0 ? 'Queue hấp thụ đỉnh ghi, DB xả dần.' : 'Ghi đi thẳng vào DB: đỉnh ghi đè DB ngay.' },
      { ok: A.peakAmp < 1.25, t: 'Retry amplification', d: A.peakAmp < 1.25 ? 'Retry không khuếch đại tải đáng kể.' : `Người dùng thử lại làm tải thực tế cao gấp ${A.peakAmp.toFixed(2)} lần nhu cầu.` },
    ],
    concepts: ['concept-load-shedding', 'concept-autoscaling', 'concept-scaling'],
    lesson: 'Đỉnh tải là chuyện "khi nào", không phải "có không". Thiết kế headroom, scale-out và shedding trước khi đỉnh đến.',
  },

  stampede: {
    name: 'Cache stampede', minDay: 3,
    weight: () => 2,
    can: (w, f) => f.caches > 0,
    start(w, inc) {
      inc.dur = 14;
      w.director.mods.stampedeUntil = w.time + 12;
      for (const c of w.structs) if (c.k === 'cache' && c._st) { c._st.sync = 1; c._st.warm = Math.min(c._st.warm, 0.5); }
      return true;
    },
    done: (w, inc) => w.time - inc.t0 >= inc.dur,
    end: (w) => { w.director.mods.stampedeUntil = 0; },
    visible: (w, inc) => [...w.structs].some((s) => s.k === 'cache' && w.isMonitored(s.x, s.y)),
    diag: (w, inc, f, A) => [
      { ok: f.jitter, t: 'TTL jitter', d: f.jitter ? 'Key hết hạn rải rác, không dồn một lúc.' : 'Key nạp cùng lúc hết hạn cùng lúc. Bật Jitter ở Cache.' },
      { ok: f.coalesce, t: 'Request coalescing', d: f.coalesce ? 'Chỉ 1 request tái tạo mỗi key, phần còn lại chờ.' : 'Mỗi request miss đều chạy xuống DB. Bật Request coalescing.' },
      { ok: A.peakDbUtil < 0.9, t: 'DB có headroom', d: A.peakDbUtil < 0.9 ? `DB đỉnh ${pct(A.peakDbUtil)} — chịu được.` : `DB vọt tới ${pct(A.peakDbUtil)} khi cache miss hàng loạt.` },
      { ok: f.replicas > 0, t: 'Replica chia đọc', d: f.replicas > 0 ? 'Replica nhận một phần đọc khi cache lạnh.' : 'Không có replica: toàn bộ đọc dồn vào primary khi cache lạnh.' },
    ],
    concepts: ['concept-cache-ttl', 'concept-cold-start'],
    lesson: 'Cache không chỉ tăng tốc — nó che chắn DB. Khi cache sụp, DB gánh tải mà nó chưa từng được thiết kế để gánh.',
  },

  crash: {
    name: 'Node crash', minDay: 2,
    weight: () => 3,
    can: () => true,
    start(w, inc) {
      if (inc.target) return true; // sinh từ onCrash
      const cands = [...w.structs].filter((s) => COMP[s.k] && s.on && !s.crashed);
      const wt = { app: 3, db: 2, cache: 2, lb: 1.5, queue: 1, gateway: 0.7, cdn: 1, replica: 1, s3: 0.6, k8s: 0.8 };
      const t = weightedPick(w.rng, cands, (s) => wt[s.k] || 1);
      if (!t) return false;
      inc.target = t.id;
      inc.kind = t.k;
      inc.cause = 'zap';
      if (t.k === 'db' && w.rng() < 0.3) { t._st = t._st || {}; t._st.diskLoss = true; }
      w.crash(t, 'zap');
      return true;
    },
    done(w, inc) {
      const t = w.ents.get(inc.target);
      if (!t) return true;
      if (t.crashed || t.rb) return false;
      return true;
    },
    end(w, inc) { inc.fixedAt = w.time; },
    visible: (w, inc) => { const t = w.ents.get(inc.target); return t && w.isMonitored(t.x, t.y); },
    diag(w, inc, f, A) {
      const k = inc.kind;
      const redund = k === 'app' ? (f.appsUp >= 2 && f.balancers > 0) || f.k8sManaged > 0 : k === 'db' ? f.replicas > 0 && f.failover !== 'off' : k === 'lb' ? f.lbs >= 2 : k === 'k8s' ? f.k8s >= 2 : k === 'cache' ? true : k === 'queue' ? false : false;
      const mttr = (inc.fixedAt ?? w.time) - inc.t0;
      const arr = [
        { ok: redund, t: `Dự phòng cho ${STRUCTS[k] ? STRUCTS[k].name : k} (N+1)`, d: redund ? 'Có node thay thế nên hệ thống vẫn phục vụ.' : `${STRUCTS[k] ? STRUCTS[k].name : k} là SPOF: chết là người dùng thấy lỗi ngay. Thêm bản dự phòng.` },
        { ok: inc.wasMonitored, t: 'Giám sát phát hiện', d: inc.wasMonitored ? 'Đèn giám sát thấy node chết ngay.' : 'Node chết trong vùng không được giám sát — bạn chỉ biết khi khách phàn nàn.' },
        { ok: mttr < 25, t: `MTTR ${Math.round(mttr)}s`, d: mttr < 25 ? 'Khôi phục nhanh.' : 'Khôi phục chậm. Runbook & tự động hoá (auto-heal) rút ngắn MTTR.' },
      ];
      if (k === 'db') {
        arr.push({ ok: f.failover !== 'off', t: 'Failover DB', d: f.failover !== 'off' ? `Failover chế độ ${f.failover}.` : 'Failover đang tắt: DB chết là ghi chết cho tới khi reboot.' });
        arr.push({ ok: inc.lost === 0 || inc.lost === undefined, t: 'Mất dữ liệu (RPO)', d: inc.lost ? `Mất ~${inc.lost} bản ghi vì replication bất đồng bộ. Dùng sync replication nếu RPO=0.` : 'Không mất bản ghi nào.' });
        arr.push({ ok: f.backup, t: 'Backup ngoài node', d: f.backup ? 'DB có backup định kỳ (Backup hoặc Object Storage): dữ liệu mất tối đa bằng khoảng giữa hai snapshot.' : 'Không có backup ngoài node: replica sao chép cả lỗi lẫn thao tác xoá nhầm, nó không thay được backup. Bật Backup ở DB hoặc nối DB tới Object Storage.' });
      }
      if (k === 'app' && f.containers > 0) {
        arr.push({ ok: f.k8sManaged > 0, t: 'Tự chữa (Kubernetes)', d: f.k8sManaged > 0 ? 'Kubernetes dựng lại pod chết sau ~6s mà không cần kỹ sư.' : 'Container khởi động nhanh nhưng không ai tự khởi động lại nó. Orchestrator (Kubernetes) tự chữa theo trạng thái mong muốn.' });
      }
      if (inc.cause === 'gremlin') arr.push({ ok: false, t: 'Gremlin gặm công trình', d: 'Bug chỉ tấn công những gì nằm ngoài vùng sáng giám sát. Mở rộng vùng phủ Đèn giám sát.' });
      return arr;
    },
    concepts: ['concept-spof', 'concept-health-checks', 'concept-observability'],
    lesson: 'Mọi thứ rồi sẽ chết. Câu hỏi là: hệ thống có sống tiếp và bạn có biết nó chết không?',
  },

  leak: {
    name: 'Rò rỉ bộ nhớ', minDay: 3,
    weight: (s) => (s === 'summer' ? 3 : 2),
    can: (w, f) => f.appsUp >= 1,
    start(w, inc) {
      const apps = [...w.structs].filter((s) => s.k === 'app' && s.on && !s.crashed);
      const t = apps[Math.floor(w.rng() * apps.length)];
      if (!t) return false;
      inc.target = t.id;
      t._st = t._st || {};
      t._st.leak = true;
      return true;
    },
    done(w, inc) {
      const t = w.ents.get(inc.target);
      if (!t) return true;
      if (t.crashed) { inc.oom = true; return false; }
      return !(t._st && t._st.leak) && !(t._st && t._st.mem > 70);
    },
    end(w, inc) { inc.fixedAt = w.time; },
    visible: (w, inc) => { const t = w.ents.get(inc.target); return t && w.isMonitored(t.x, t.y); },
    diag(w, inc, f, A) {
      const dur = (inc.fixedAt ?? w.time) - inc.t0;
      return [
        { ok: inc.wasMonitored, t: 'Giám sát bộ nhớ', d: inc.wasMonitored ? 'Bạn thấy mem tăng đều trên dashboard.' : 'Mem tăng trong im lặng cho tới khi OOM. Chỉ metric mới lộ ra xu hướng này.' },
        { ok: !inc.oom, t: 'Xử lý trước khi OOM', d: inc.oom ? 'App bị OOM-kill giữa lúc đang phục vụ.' : `Restart sớm sau ${Math.round(dur)}s, trước khi sập.` },
        { ok: f.appsUp >= 2 && f.balancers > 0, t: 'Rolling restart không downtime', d: f.appsUp >= 2 && f.balancers > 0 ? 'Có nhiều App sau LB/Kubernetes: restart từng node không gây downtime.' : 'Chỉ một App: restart = downtime. Cần ≥2 App sau LB.' },
        { ok: f.k8sManaged > 0, t: 'Tự chữa OOM (Kubernetes)', d: f.k8sManaged > 0 ? 'Pod bị OOM-kill được Kubernetes dựng lại tự động sau ~6s.' : 'Không có orchestrator: OOM-kill = node chết tới khi có người reboot.' },
      ];
    },
    concepts: ['concept-observability', 'concept-scaling'],
    lesson: 'Lỗi "chậm mà chắc" chỉ lộ ra qua xu hướng. Restart là băng cứng; sửa gốc mới xong việc (deploy bản vá).',
  },

  ddos: {
    name: 'DDoS / botnet', minDay: 3,
    weight: (s) => (s === 'winter' ? 8 : 0.4),
    can: (w, f) => w.structs.size > 0 && [...w.structs].some((s) => s.k === 'gateway'),
    start(w, inc) {
      inc.n = Math.min(16, 3 + Math.floor(w.clock.day * 0.5));
      inc.spawned = 0;
      inc.kills = { player: 0, turret: 0 };
      inc.dur = 90;
      w.say('Botnet đang tràn tới Gateway! Hạ chúng bằng giáo hoặc dựng tường lửa.', 'bad');
      return true;
    },
    tick(w, inc, dt) {
      if (inc.spawned < inc.n) {
        const batch = Math.min(inc.n - inc.spawned, 2);
        for (let i = 0; i < batch; i++) {
          const a = w.rng() * Math.PI * 2, d = 20 + w.rng() * 4;
          spawnMob(w, 'bot', (BASE_TX + Math.cos(a) * d) * TILE, (BASE_TY + Math.sin(a) * d) * TILE);
          inc.spawned++;
        }
      }
    },
    done(w, inc) {
      if (inc.spawned < inc.n) return false;
      let alive = 0;
      for (const m of w.mobs) if (m.k === 'bot') alive++;
      if (alive === 0) return true;
      return w.time - inc.t0 > inc.dur + 60;
    },
    end(w) { for (const m of [...w.mobs]) if (m.k === 'bot') w.removeEnt(m); },
    visible: () => true,
    diag: (w, inc, f, A) => [
      { ok: f.turrets > 0, t: 'Tháp tường lửa', d: f.turrets > 0 ? `${inc.kills.turret} bot bị tháp hạ.` : 'Không có tường lửa: bot phải bị hạ bằng tay.' },
      { ok: f.waf, t: 'WAF', d: f.waf ? 'WAF chặn ~95% request độc hại ở cổng.' : 'Không WAF: request độc hại đi sâu vào app và DB (tốn tài nguyên như request thật).' },
      { ok: f.rl > 0, t: 'Rate limiting', d: f.rl > 0 ? 'Có rate limit — nhưng nhớ nó cắt cả người dùng thật.' : 'Không rate limit ở Gateway.' },
      { ok: A.peakAmp < 1.4, t: 'Tải khuếch đại', d: `Đỉnh tải gấp ${A.peakAmp.toFixed(2)} lần nhu cầu hợp lệ.` },
    ],
    concepts: ['concept-load-shedding', 'comp-turret'],
    lesson: 'Phòng thủ nhiều tầng: chặn ở rìa (WAF/CDN), giới hạn ở cổng (rate limit), co cụm bên trong (breaker).',
  },

  partition: {
    name: 'Network partition', minDay: 4,
    weight: () => 1.6,
    can: (w) => [...w.structs].some((s) => s.links && s.links.length),
    start(w, inc) {
      const edges = [];
      for (const s of w.structs) if (s.links) for (const id of s.links) { const t = w.ents.get(id); if (t) edges.push([s, t]); }
      if (!edges.length) return false;
      const rep = edges.filter(([a, b]) => a.k === 'db' && b.k === 'replica');
      const pool = rep.length ? rep : edges.filter(([a, b]) => b.k === 'db' || a.k === 'lb');
      const [a, b] = (pool.length ? pool : edges)[Math.floor(w.rng() * (pool.length ? pool : edges).length)];
      inc.a = a.id; inc.b = b.id; inc.key = a.id + '>' + b.id; inc.ak = a.k; inc.bk = b.k;
      inc.dur = 25 + w.rng() * 8;
      inc.lost = 0;
      w.director.mods.cut.add(inc.key);
      w.say('Một cáp mạng bị đứt (network partition)!', 'bad');
      return true;
    },
    done: (w, inc) => w.time - inc.t0 >= inc.dur,
    end(w, inc) { w.director.mods.cut.delete(inc.key); },
    visible: (w, inc) => { const t = w.ents.get(inc.a); return t && w.isMonitored(t.x, t.y); },
    diag(w, inc, f, A) {
      const dbLink = inc.ak === 'db' && inc.bk === 'replica';
      const arr = [
        { ok: A.peakErr < 0.15, t: 'Đường dự phòng', d: A.peakErr < 0.15 ? 'Traffic đi đường khác nên ít lỗi.' : `Đường nối đơn lẻ: lỗi đỉnh ${pct(A.peakErr)}. Cần đường dự phòng/nhiều node.` },
      ];
      if (dbLink) {
        arr.push({ ok: !inc.split, t: 'Tránh split-brain', d: inc.split ? 'Hai leader cùng nhận ghi. Dùng failover "quorum" (cần ≥3 node) hoặc tắt auto-failover.' : 'Không xảy ra hai leader.' });
        arr.push({ ok: f.repl === 'sync' || f.failover === 'quorum', t: 'Lựa chọn CAP', d: f.repl === 'sync' ? 'Sync replication: chọn nhất quán (CP), đổi lại ghi bị từ chối khi replica mất liên lạc.' : f.failover === 'quorum' ? 'Quorum: chọn nhất quán, thiểu số bị từ chối.' : 'Async + auto-failover: chọn sẵn sàng (AP) nhưng chấp nhận xung đột dữ liệu.' });
        arr.push({ ok: !inc.lostConflict, t: 'Dữ liệu xung đột', d: inc.lostConflict ? `Mất ~${inc.lostConflict} bản ghi khi gộp lại.` : 'Không có xung đột sau khi nối lại.' });
      }
      return arr;
    },
    concepts: ['concept-split-brain', 'concept-cap'],
    lesson: 'Partition là bất khả kháng. CAP không hỏi "chọn gì" mà hỏi "khi mạng đứt, bạn từ chối hay chấp nhận sai?".',
  },

  hotkey: {
    name: 'Hot key / hot shard', minDay: 3,
    weight: () => 2,
    can: (w, f) => f.lbAlgo === 'hash' || f.shards > 1,
    start(w, inc) {
      inc.dur = 35;
      const m = w.director.mods;
      m.skewDb = 0.7; m.skewLb = 0.55;
      w.say('Một nội dung bất ngờ nổi tiếng — tải dồn vào một key.', 'warn');
      return true;
    },
    done: (w, inc) => w.time - inc.t0 >= inc.dur,
    end(w) { const m = w.director.mods; m.skewDb = 0; m.skewLb = 0; },
    visible: () => true,
    diag: (w, inc, f, A) => [
      { ok: f.lbAlgo !== 'hash', t: 'Thuật toán cân bằng tải', d: f.lbAlgo === 'hash' ? 'Hash/sticky gửi cùng key tới cùng node: key nóng = node nóng. Dùng Least-connections.' : 'Round-robin/least-connections không bị ảnh hưởng bởi key nóng.' },
      { ok: f.shards === 1 || f.salt, t: 'Key salting (shard)', d: f.shards > 1 ? (f.salt ? 'Bật key salting: key nóng rải ra nhiều shard.' : `Có ${f.shards} shard nhưng key nóng vẫn nằm trên một shard. Bật Key salting.`) : 'Chưa shard nên không có hot shard.' },
      { ok: f.caches > 0, t: 'Cache hấp thụ đọc nóng', d: f.caches > 0 ? 'Cache giữ key nóng trong RAM.' : 'Cache là lớp tốt nhất cho đọc nóng.' },
    ],
    concepts: ['concept-sharding', 'concept-lb-algos'],
    lesson: 'Tải không bao giờ đều. Sharding hay hash cân bằng theo SỐ LƯỢNG key, không theo ĐỘ NÓNG của key.',
  },

  diskfull: {
    name: 'Log nổ đĩa (disk full)', minDay: 4,
    weight: () => 1.5,
    can: (w, f) => f.dbs > 0,
    start(w, inc) {
      const db = [...w.structs].find((s) => s.k === 'db');
      if (!db) return false;
      inc.target = db.id;
      inc.dur = 40;
      const st = w.flow.st(db);
      st.disk = Math.min(0.97, st.disk + 0.4);
      w.director.mods.diskRate = 8;
      return true;
    },
    tick(w, inc) { if (w.time - inc.t0 > inc.dur) w.director.mods.diskRate = 1; },
    done(w, inc) {
      const db = w.ents.get(inc.target);
      if (!db) return true;
      const st = w.flow.st(db);
      if (w.time - inc.t0 > inc.dur) { if (st.disk < 0.85) return true; if (!inc.warned) { inc.warned = true; w.say('Đĩa DB còn đầy. Bật retention hoặc Archive dữ liệu cũ!', 'warn'); } }
      return false;
    },
    end(w) { w.director.mods.diskRate = 1; },
    visible: (w, inc) => { const t = w.ents.get(inc.target); return t && w.isMonitored(t.x, t.y); },
    diag: (w, inc, f, A) => [
      { ok: f.retention, t: 'Retention policy', d: f.retention ? 'Retention giảm tốc độ đầy đĩa.' : 'Không có retention: log/dữ liệu cũ nằm mãi. Bật Retention ở DB.' },
      { ok: inc.wasMonitored, t: 'Cảnh báo dung lượng', d: inc.wasMonitored ? 'Đĩa lên tới ' + pct(A.peakDisk) + ' và bạn thấy nó.' : 'Đĩa đầy là sự cố "dễ dự đoán nhất" — chỉ cần giám sát.' },
      { ok: !A.diskFull, t: 'Không chạm 100%', d: A.diskFull ? 'Đĩa chạm 100%: mọi ghi thất bại.' : 'Xử lý trước khi chạm 100%.' },
      { ok: f.queues > 0, t: 'Queue đệm ghi khi DB tạm lỗi', d: f.queues > 0 ? 'Queue giữ ghi trong khi bạn dọn đĩa.' : 'Không queue: ghi thất bại là mất ngay.' },
      { ok: f.s3Backup, t: 'Offload dữ liệu lạnh sang Object Storage', d: f.s3Backup ? 'DB nối S3: dữ liệu lạnh/backup đẩy ra ngoài, đĩa đầy chậm hơn ~25%.' : 'Mọi dữ liệu nằm trên đĩa DB. Đẩy dữ liệu lạnh/backup sang Object Storage (rẻ hơn nhiều).' },
    ],
    concepts: ['concept-capacity-cost', 'concept-observability'],
    lesson: 'Tài nguyên hữu hạn nào rồi cũng đầy. Giám sát dung lượng + vòng đời dữ liệu (retention/archive) là việc của thiết kế, không phải của chữa cháy.',
  },

  baddeploy: {
    name: 'Deploy lỗi', minDay: 99,
    weight: () => 0,
    can: () => false,
    start(w, inc) { return !!inc.target; },
    done(w, inc) { const t = w.ents.get(inc.target); return !t || !t.bad; },
    end(w, inc) { inc.fixedAt = w.time; },
    visible: () => false,
    diag(w, inc, f, A) {
      const t = (inc.fixedAt ?? w.time) - inc.t0;
      return [
        { ok: f.appsUp >= 2 && f.balancers > 0, t: 'Canary / rolling', d: f.appsUp >= 2 && f.balancers > 0 ? 'Bạn deploy từng node nên chỉ một phần traffic dính lỗi (blast radius nhỏ).' : 'Chỉ có một App: deploy lỗi = 100% traffic dính lỗi. Có ≥2 App sau LB cho phép canary.' },
        { ok: f.containers > 0, t: 'Image bất biến (container)', d: f.containers > 0 ? 'Container đóng gói cả môi trường chạy, giảm hẳn lỗi "chạy được trên máy tôi" (rủi ro deploy lỗi 30% → 12%).' : 'App chạy trực tiếp trên host: môi trường lệch giữa các lần deploy. Đóng gói bằng Module Docker.' },
        { ok: f.k8sManaged > 0, t: 'Readiness probe + rollback tự động', d: f.k8sManaged > 0 ? 'Kubernetes thấy readiness thất bại và tự rollback sau ~10s; deploy là rolling update.' : 'Không có orchestrator: phải có người thấy lỗi và bấm Rollback.' },
        { ok: inc.wasMonitored, t: 'Giám sát sau deploy', d: inc.wasMonitored ? 'Bạn thấy error rate của node tăng.' : 'Không giám sát node này: lỗi chỉ lộ qua khiếu nại khách hàng.' },
        { ok: t < 30, t: `Thời gian rollback ${Math.round(t)}s`, d: t < 30 ? 'Rollback nhanh.' : 'Rollback chậm — nút Rollback luôn nên là thao tác một chạm.' },
      ];
    },
    concepts: ['concept-blast-radius', 'concept-postmortem'],
    lesson: 'Phần lớn sự cố bắt nguồn từ thay đổi. Cách giảm rủi ro: thay đổi nhỏ, từng bước, quan sát, rollback nhanh.',
  },

  outage: {
    name: 'Mất điện lưới', minDay: 4,
    weight: () => 1.5,
    can: (w, f) => f.gens >= 1,
    start(w, inc) {
      const gens = [...w.structs].filter((s) => s.k === 'generator' && s.on);
      const g = gens[Math.floor(w.rng() * gens.length)];
      if (!g) return false;
      inc.target = g.id;
      inc.dur = 30;
      g._outUntil = w.time + inc.dur;
      // component nào chỉ dựa vào máy phát này?
      inc.sole = 0; inc.total = 0;
      for (const s of w.structs) {
        if (!(COMP[s.k] || STRUCTS[s.k].watts)) continue;
        if (dist(s.x, s.y, g.x, g.y) > 460) continue;
        inc.total++;
        const other = gens.some((o) => o !== g && dist(o.x, o.y, s.x, s.y) <= 460);
        if (!other) inc.sole++;
      }
      w.say('Máy phát điện bị sập 30 giây (sự cố nguồn)!', 'bad');
      return true;
    },
    done: (w, inc) => w.time - inc.t0 >= inc.dur,
    end(w, inc) { const g = w.ents.get(inc.target); if (g) g._outUntil = 0; },
    visible: () => true,
    diag: (w, inc, f) => [
      { ok: inc.sole === 0, t: 'Nguồn điện dự phòng chồng lấn', d: inc.sole === 0 ? 'Mọi component được máy phát khác phủ.' : `${inc.sole}/${inc.total} component chỉ có một nguồn điện — chúng tắt hẳn. Đặt máy phát thứ hai phủ chồng.` },
      { ok: f.gens >= 2, t: 'Số máy phát', d: `${f.gens} máy phát. Mỗi miền lỗi (failure domain) nên có ≥2.` },
      { ok: f.monitored > 0.9, t: 'Vùng giám sát', d: 'Mất điện làm đèn giám sát tắt: bạn "mù" đúng lúc cần nhìn nhất.' },
    ],
    concepts: ['concept-spof', 'concept-blast-radius'],
    lesson: 'Failure domain: đừng để tất cả trứng trong một giỏ điện/AZ/region.',
  },

  analytics: {
    name: 'Truy vấn báo cáo nặng', minDay: 3,
    weight: () => 2,
    can: (w, f) => f.dbs > 0,
    start(w, inc) {
      const f = archFacts(w);
      inc.dur = 40;
      inc.load = 160 + w.clock.day * 8;
      inc.isolated = f.replicas > 0;
      w.director.mods.analytics = { load: inc.load, until: w.time + inc.dur };
      return true;
    },
    done: (w, inc) => w.time - inc.t0 >= inc.dur,
    end(w) { w.director.mods.analytics = null; },
    visible: () => false,
    diag: (w, inc, f, A) => [
      { ok: inc.isolated, t: 'Cô lập workload (replica)', d: inc.isolated ? 'Truy vấn báo cáo chạy trên replica, không tranh chấp với giao dịch.' : 'Truy vấn báo cáo chạy trên primary, tranh chấp với request người dùng (noisy neighbor).' },
      { ok: A.peakDbUtil < 0.9, t: 'DB headroom', d: `DB đỉnh ${pct(A.peakDbUtil)}.` },
    ],
    concepts: ['comp-replica', 'concept-capacity-cost'],
    lesson: 'OLTP và OLAP không nên chung một chỗ. Cô lập workload nặng để bảo vệ đường dẫn của người dùng.',
  },

  dataloss: {
    name: 'Xóa nhầm dữ liệu (DROP TABLE)', minDay: 6,
    weight: () => 1.2,
    can: (w, f) => f.dbs > 0,
    start(w, inc) {
      const dbs = [...w.structs].filter((s) => s.k === 'db' && s.on && !s.crashed);
      const db = dbs[Math.floor(w.rng() * dbs.length)];
      if (!db) return false;
      const st = w.flow.st(db);
      st.corrupt = { at: w.time };
      st.snapUntil = 0; // snapshot đang chạy sẽ chép luôn dữ liệu hỏng nên bị huỷ
      inc.target = db.id;
      inc.kind = 'db';
      inc.backup = db.cfg.backup;
      inc.s3 = !!st.backupOn;
      inc.snapAge = w.flow.hasSnapshot(db) ? Math.round(w.time - w.flow.snapshotAt(db)) : null;
      if (w.isMonitored(db.x, db.y)) w.say('Ai đó vừa chạy DROP TABLE nhầm trên production! Dữ liệu hỏng đã được sao chép sang cả replica.', 'bad');
      return true;
    },
    done(w, inc) { const db = w.ents.get(inc.target); return !db || !w.flow.st(db).corrupt; },
    end(w, inc) { inc.fixedAt = w.time; },
    visible: (w, inc) => { const t = w.ents.get(inc.target); return t && w.isMonitored(t.x, t.y); },
    diag(w, inc, f, A) {
      const b = BACKUP[inc.backup];
      const on = inc.backup !== 'off' || inc.s3;
      const fresh = inc.snapAge !== null && inc.snapAge <= BACKUP.hourly.every;
      const rto = Math.round((inc.restoredAt ?? inc.fixedAt ?? w.time) - inc.t0);
      const restored = inc.restoredAt !== undefined && !inc.rebuilt;
      const arr = [
        { ok: on, t: 'Backup bật trước sự cố', d: inc.backup !== 'off' ? `Backup ${b.name.toLowerCase()} (snapshot mỗi ${b.every}s).` : inc.s3 ? 'DB nối Object Storage: snapshot sang S3 mỗi 30s.' : 'Backup đang tắt: không có điểm nào để quay về. Phải bật Backup ở DB TRƯỚC khi sự cố xảy ra.' },
        { ok: fresh, t: 'Snapshot đủ mới (RPO)', d: inc.snapAge === null ? 'Lúc sự cố chưa có snapshot nào: mọi ghi từ trước tới giờ đều không được bảo vệ.' : fresh ? `Snapshot cuối cách sự cố ${inc.snapAge}s: chỉ mất các ghi rất gần đây.` : `Snapshot cuối đã cũ ${inc.snapAge}s: mọi ghi từ đó tới lúc khôi phục đều mất. Rút ngắn chu kỳ backup (đổi lại tốn đĩa và IO).` },
        { ok: restored && rto <= 45, t: `Khôi phục (RTO ${rto}s)`, d: restored ? (rto <= 45 ? `Khôi phục từ snapshot sau ${rto}s, mất ~${inc.lost} bản ghi.` : `Khôi phục sau ${rto}s là chậm: lỗi người dùng kéo dài và mất thêm bản ghi trong lúc chờ.`) : inc.rebuilt ? `Không có snapshot để khôi phục: sau ${rto}s cả đội phải dựng lại dữ liệu từ đầu, mất ~${inc.lost} bản ghi.` : 'DB không còn nữa nên không khôi phục được.' },
      ];
      if (f.replicas > 0) arr.push({ ok: on, t: 'Replica không phải backup', d: on ? 'Có replica nhưng bạn không dựa vào nó: lỗi xoá nhầm đã được sao chép sang mọi replica ngay, chính snapshot mới cứu được dữ liệu.' : `Có ${f.replicas} replica nhưng không có backup: lỗi xoá nhầm bị sao chép sang mọi replica ngay lập tức, failover không giúp gì.` });
      arr.push({ ok: inc.wasMonitored, t: 'Giám sát phát hiện', d: inc.wasMonitored ? 'Bạn thấy DB báo dữ liệu hỏng và lỗi tăng ngay.' : 'DB nằm ngoài vùng giám sát: dữ liệu hỏng trong im lặng cho tới khi khách hàng phàn nàn.' });
      if (inc.backup !== 'off') arr.push({ ok: A.peakDisk < 0.85, t: 'Chi phí đĩa của backup', d: A.peakDisk < 0.85 ? `Mỗi snapshot chiếm ~${(b.disk * 100).toFixed(1)}% đĩa (DB tier 1), đĩa đỉnh ${pct(A.peakDisk)}: chi phí chấp nhận được.` : `Đĩa đỉnh ${pct(A.peakDisk)}: snapshot ăn dần dung lượng. Bật Retention hoặc giãn chu kỳ backup.` });
      return arr;
    },
    concepts: ['concept-backup', 'concept-durability'],
    lesson: 'Replica không phải backup: nó sao chép cả lỗi. RPO là tuổi của snapshot cuối, RTO là thời gian khôi phục; cả hai phải được thiết kế trước khi sự cố xảy ra.',
  },
};

const ORDER = Object.keys(INCIDENTS).filter((k) => INCIDENTS[k].weight() !== 0 || k === 'ddos');

export class Director {
  constructor(w) {
    this.w = w;
    this.mods = newMods();
    this.active = [];
    this.uid = 1;
    this.nextAt = 330;
    this.last = null;
    this.stress = 0;
    this.lostTotal = 0;
  }

  toSave() { return { nextAt: this.nextAt, uid: this.uid, lost: this.lostTotal }; }
  load(s) { if (s) { this.nextAt = s.nextAt; this.uid = s.uid; this.lostTotal = s.lost || 0; } }

  // --- tạo incident ---
  create(id, extra = {}, drill = false) {
    const w = this.w;
    const def = INCIDENTS[id];
    const f = archFacts(w);
    const inc = { uid: this.uid++, id, name: def.name, t0: w.time, day: w.clock.day, drill, facts: f, stats: { peakErr: 0, peakP99: 0, peakAmp: 1, peakDbUtil: 0, peakAppUtil: 0, peakDisk: 0, badSec: 0, minSat: 100, usersStart: w.users, diskFull: false, peakBacklog: 0 }, ...extra };
    this.active.push(inc);
    if (def.start(w, inc, f) === false) { this.active = this.active.filter((x) => x !== inc); return null; }
    const t = inc.target ? w.ents.get(inc.target) : null;
    inc.wasMonitored = t ? w.isMonitored(t.x, t.y) : f.monitored > 0.5;
    inc.alert = w.alerts.snapshot(t);
    if (drill) this.mods.drill = true;
    w.unlock('inc-' + id);
    const vis = def.visible ? def.visible(w, inc) : true;
    inc.announced = vis;
    if (vis) w.emit({ t: 'incident', phase: 'start', id, name: def.name, drill });
    w.dayStat.incidents.push(def.name + (drill ? ' (game day)' : ''));
    return inc;
  }

  step(dt) {
    const w = this.w;
    const f = archFacts(w);
    // chạy incident đang hoạt động
    for (const inc of [...this.active]) {
      const def = INCIDENTS[inc.id];
      if (def.tick) def.tick(w, inc, dt);
      if (def.done(w, inc)) this.finish(inc);
    }
    // lịch sự cố
    if (w.time >= this.nextAt && !w.over) {
      const day = w.clock.day;
      const maxActive = 2;
      if (this.active.filter((i) => !i.drill).length < maxActive) {
        const season = w.clock.season;
        const pool = ORDER.filter((id) => day >= INCIDENTS[id].minDay && INCIDENTS[id].can(w, f) && !this.active.some((a) => a.id === id));
        const id = weightedPick(w.rng, pool, (k) => INCIDENTS[k].weight(season) * (k === this.last ? 0.3 : 1));
        if (id) { this.last = id; this.create(id); }
      }
      const base = Math.max(90, 170 - day * 4);
      this.nextAt = w.time + base * (0.7 + w.rng() * 0.6);
    }
    // stress cho sanity: có sự cố đang ảnh hưởng người dùng
    const g = w.flow.g;
    this.stress = g && g.ok < 0.93 ? 1 : this.active.length ? 0.3 : 0;
  }

  // --- đo đạc ---
  observe(flow, success, p99, offered) {
    const w = this.w;
    const dbUtil = Math.max(0, ...[...flow.ctx.values()].filter((c) => c.n.k === 'db' || c.n.k === 'replica').map((c) => c.util));
    const appUtil = Math.max(0, ...[...flow.ctx.values()].filter((c) => c.n.k === 'app').map((c) => c.util));
    let disk = 0;
    for (const c of flow.ctx.values()) if (c.n.k === 'db') disk = Math.max(disk, c.n._st.disk);
    const amp = flow.g ? flow.g.amp : 1;
    for (const inc of this.active) {
      const s = inc.stats;
      s.peakErr = Math.max(s.peakErr, 1 - success);
      s.peakP99 = Math.max(s.peakP99, p99);
      s.peakAmp = Math.max(s.peakAmp, amp);
      s.peakDbUtil = Math.max(s.peakDbUtil, dbUtil);
      s.peakAppUtil = Math.max(s.peakAppUtil, appUtil);
      s.peakDisk = Math.max(s.peakDisk, disk);
      if (disk >= 1) s.diskFull = true;
      s.minSat = Math.min(s.minSat, w.sat);
      if (success < SLO.success || p99 > SLO.p99) { s.badSec += 0.5; s.badAt ??= w.time; }
      // sự cố âm thầm: thông báo khi khách hàng bắt đầu phàn nàn
      if (!inc.announced && w.sat < 85 && !inc.drill) {
        inc.announced = true;
        w.say('Khách hàng đang phàn nàn: "có gì đó không ổn". Hãy điều tra!', 'bad');
        w.emit({ t: 'incident', phase: 'start', id: inc.id, name: INCIDENTS[inc.id].name, drill: inc.drill, late: true });
      }
    }
    if (!this.active.some((i) => i.drill)) this.mods.drill = false;
  }

  finish(inc) {
    const w = this.w;
    const def = INCIDENTS[inc.id];
    this.active = this.active.filter((x) => x !== inc);
    if (def.end) def.end(w, inc);
    const f = inc.facts;
    const A = { ...inc.stats };
    const dur = w.time - inc.t0;
    const checks = def.diag(w, inc, inc.facts, A);
    checks.push(...w.alerts.postmortem(inc));
    // dùng facts hiện tại cho các cấu hình có thể thay đổi giữa sự cố (jitter,...)? Dùng facts lúc bắt đầu: đó là kiến trúc thật khi sự cố xảy ra.
    const pm = {
      uid: inc.uid, id: inc.id, name: inc.name, day: inc.day, drill: inc.drill, dur: Math.round(dur),
      impact: {
        peakErr: Math.round(A.peakErr * 100), peakP99: Math.round(A.peakP99), badSec: Math.round(A.badSec), minSat: Math.round(A.minSat), users: Math.round(w.users - A.usersStart), lost: inc.lost || 0,
        mttd: inc.detectedAt === undefined ? null : Math.round(inc.detectedAt - inc.t0),
        mtta: inc.ackedAt === undefined ? null : Math.round(inc.ackedAt - inc.detectedAt),
      },
      checks, lesson: def.lesson, concepts: def.concepts, codex: ['inc-' + inc.id, ...def.concepts, 'concept-alerting'],
    };
    const okN = checks.filter((c) => c.ok).length;
    let kp = okN + (okN === checks.length && checks.length ? KP_PERFECT_BONUS : 0);
    if (inc.drill) { kp = w.drillSeen.has(inc.id) ? 0 : Math.ceil(kp / 2); w.drillSeen.add(inc.id); } // game day chỉ thưởng lần đầu mỗi loại
    pm.kp = kp;
    for (const c of pm.codex) w.unlock(c);
    w.addKp(kp, 'pm');
    w.log.push(pm);
    if (w.log.length > 40) w.log.shift();
    w.emit({ t: 'postmortem', pm });
    if (inc.announced || true) w.emit({ t: 'incident', phase: 'end', id: inc.id, name: inc.name });
  }

  // --- API cho game day ---
  drill(id, p) {
    const w = this.w;
    const def = INCIDENTS[id];
    if (!def || !w.codex.has('inc-' + id)) return w.say('Chỉ có thể diễn tập sự cố bạn đã từng gặp.', 'warn', p.pid);
    if (this.active.length >= 2 || this.active.some((a) => a.id === id)) return w.say('Đang có quá nhiều sự cố.', 'warn', p.pid);
    const f = archFacts(w);
    if (id === 'baddeploy') {
      const app = [...w.structs].find((s) => s.k === 'app' && s.on);
      if (!app) return w.say('Cần một App đang chạy.', 'warn', p.pid);
      app.bad = true;
      return void this.create('baddeploy', { target: app.id, kind: 'app' }, true);
    }
    if (!def.can(w, f)) return w.say('Kiến trúc hiện tại chưa đủ điều kiện cho sự cố này (vd: cần Cache cho stampede).', 'warn', p.pid);
    const inc = this.create(id, {}, true);
    if (inc) w.say(`Game day: ${def.name}. Không tính vào SLO ngày.`, 'info');
  }

  // --- hooks từ thế giới ---
  onCrash(e, cause) {
    const w = this.w;
    const ex = this.active.find((i) => i.target === e.id && (i.id === 'crash' || i.id === 'leak'));
    if (ex) { if (cause === 'oom') ex.oom = true; return; }
    const kind = e.k;
    const vis = w.isMonitored(e.x, e.y);
    w.emit({ t: 'fx', kind: 'lightning', x: Math.round(e.x), y: Math.round(e.y) });
    this.create('crash', { target: e.id, kind, cause });
    if (vis) w.say(`${STRUCTS[kind].name} bị crash!`, 'bad');
  }
  onBadDeploy(e) {
    const w = this.w;
    this.create('baddeploy', { target: e.id, kind: 'app' });
    w.say(`Deploy v${e.ver} lên ${STRUCTS[e.k].name} hoàn tất.`, 'good');
  }
  onRollback(e) {
    // incident tự kết thúc ở step (done kiểm tra !bad)
  }
  onFailover(db, nl, lost) {
    const w = this.w;
    this.lostTotal += lost;
    for (const i of this.active) i.lost = (i.lost || 0) + lost;
    w.say(`Failover DB: ${STRUCTS[nl.k].name} được thăng cấp lên leader${lost ? `, mất ~${lost} bản ghi chưa sao chép` : ''}.`, lost ? 'bad' : 'good');
    w.unlock('concept-durability'); w.unlock('concept-replication');
    this.penalize(lost);
  }
  onSplit(db) {
    this.w.say('SPLIT-BRAIN: hai leader cùng nhận ghi!', 'bad');
    this.w.unlock('concept-split-brain');
    for (const i of this.active) if (i.id === 'partition') i.split = true;
  }
  onHeal(db, lost) {
    const w = this.w;
    w.say(`Nối lại mạng: gộp hai nhánh dữ liệu, mất ${lost} bản ghi xung đột.`, lost ? 'bad' : 'good');
    for (const i of this.active) if (i.id === 'partition') i.lostConflict = lost;
    this.lostTotal += lost;
    this.penalize(lost);
  }
  onRestore(db, lost, rebuilt = false) {
    const w = this.w;
    const inc = this.active.find((i) => i.id === 'dataloss' && i.target === db.id);
    if (inc) { inc.lost = lost; inc.rebuilt = rebuilt; inc.restoredAt = w.time; }
    this.lostTotal += lost;
    if (!rebuilt) w.say(`Khôi phục DB từ snapshot: mất ~${lost} bản ghi ghi sau snapshot cuối.`, lost ? 'bad' : 'good');
    else if (inc && inc.announced) w.say(`Không có snapshot để khôi phục: dữ liệu được dựng lại từ đầu, mất ~${lost} bản ghi.`, 'bad');
    w.unlock('concept-backup'); w.unlock('concept-durability');
    if (!(inc && inc.drill)) this.penalize(lost);
  }
  penalize(lost) {
    if (!lost) return;
    const w = this.w;
    const p = clamp(lost / (w.users * 20 + 50), 0, 0.2);
    w.users = Math.max(0, Math.round(w.users * (1 - p)));
  }
  onMobKilled(m, p) {
    const inc = this.active.find((i) => i.id === 'ddos');
    if (inc && m.k === 'bot') { if (p) inc.kills.player++; else inc.kills.turret++; }
  }
  onSeason(s) {
    const w = this.w;
    const msg = {
      winter: 'Mùa Đông: botnet hoạt động mạnh, tài nguyên mọc chậm. Dựng tường lửa!',
      spring: 'Mùa Xuân: sản phẩm ra mắt, người dùng tăng mạnh và dễ có viral spike.',
      summer: 'Mùa Hè: Black Friday — tải cao điểm kéo dài, dễ rò rỉ bộ nhớ.',
      autumn: 'Mùa Thu: tải ổn định. Thời điểm tốt để củng cố kiến trúc.',
    }[s];
    w.say(msg, 'info');
  }
}
