// Cân bằng alert: chạy cùng một kịch bản có seed dưới từng mức alert và so sánh số page, báo động giả, MTTD.
// Chạy: node tools/alert-sim.js [seed]
import { Room } from '../shared/room.js';
import { DT, ALERT } from '../shared/data.js';

const seed = +process.argv[2] || 1234;

function build(level, users) {
  const room = new Room({ name: 'alert', seed });
  const w = room.world;
  const p = room.join({ send() {} }, { name: 'T', token: 't' });
  w.director.nextAt = 1e9; // chỉ có sự cố do kịch bản gây ra
  w.users = users;
  for (const s of w.structs) if (s.k === 'lantern') s.cfg.alert = level;
  const app = [...w.structs].find((s) => s.k === 'app');
  const run = (secs) => {
    for (let i = 0; i < secs / DT; i++) {
      w.step(DT);
      for (const g of w.structs) if (g.k === 'generator') g.fuel = 200;
      if (w.alerts.groups().some((x) => x.state === 'firing')) w.cmd(p.pid, { c: 'ack' }); // người trực ack ngay
      room.snapshot(false);
      if (rig.t0 !== undefined && rig.badAt === undefined && w.flow.g && !w.flow.g.slo) rig.badAt = w.time - rig.t0;
    }
  };
  const rig = { w, run, app, t0: undefined, badAt: undefined };
  return rig;
}

const SCENARIOS = {
  'quiet 24 người dùng, 600 s': { users: 24, secs: 600, go() {} },
  'quiet 40 người dùng, 600 s': { users: 40, secs: 600, go() {} },
  'spike x2.2 (24 người dùng)': { users: 24, secs: 160, go(r) { r.run(40); r.t0 = r.w.time; r.w.director.create('spike').mult = 2.2; } },
  'spike x3 (40 người dùng)': { users: 40, secs: 160, go(r) { r.run(40); r.t0 = r.w.time; r.w.director.create('spike').mult = 3; } },
  'app crash': { users: 40, secs: 160, go(r) { r.run(40); r.t0 = r.w.time; r.w.crash(r.app, 'zap'); } },
  'disk full (đĩa đã 45%, 40 người dùng)': { users: 40, secs: 200, go(r) { r.run(40); r.w.flow.st([...r.w.structs].find((s) => s.k === 'db')).disk = 0.45; r.t0 = r.w.time; r.w.director.create('diskfull'); } },
};

console.log(`seed ${seed}; mỗi ô: page / báo động giả / MTTD (s) / SLO vỡ sau (s) — "-" = không có`);
console.log(['kịch bản'.padEnd(42), ...Object.keys(ALERT).map((k) => k.padEnd(18))].join(''));
for (const [name, sc] of Object.entries(SCENARIOS)) {
  const cells = [];
  for (const level of Object.keys(ALERT)) {
    const rig = build(level, sc.users);
    rig.run(10);
    sc.go(rig);
    rig.run(sc.secs);
    const { w } = rig;
    const inc = w.log[w.log.length - 1];
    const live = w.director.active[0];
    const src = inc || live;
    const mttd = src && src.impact ? src.impact.mttd : null;
    const t0 = src && src.t0;
    const s = w.alerts.stats;
    const bad = rig.badAt === undefined ? '-' : rig.badAt.toFixed(0); // SLO vỡ sau khi sự cố bắt đầu
    cells.push(`${s.pages}/${s.falsePages}/${mttd ?? (live && live.detectedAt !== undefined ? (live.detectedAt - live.t0).toFixed(0) : '-')}/${bad}`.padEnd(18));
  }
  console.log(name.padEnd(42) + cells.join(''));
}
