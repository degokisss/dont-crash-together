// Chạy mô phỏng headless để kiểm tra lõi game: node tools/sim-test.js [giây] [kịch bản]
import { Room } from '../shared/room.js';
import { DT } from '../shared/data.js';

const secs = +process.argv[2] || 600;
const scenario = process.argv[3] || 'idle';
const room = new Room({ name: 'test', seed: 1234 });
const msgs = [];
const client = { send: (s) => msgs.push(s) };
const p = room.join(client, { name: 'Tester', token: 't1' });
const w = room.world;
let errs = 0;
const origErr = console.error;
console.error = (...a) => { errs++; origErr(...a); };

function give(item, n) { w.give(p, item, n); }
function find(k) { return [...w.structs].filter((s) => s.k === k); }

if (scenario === 'build') {
  for (const [i, n] of [['wood', 40], ['silicon', 40], ['copper', 40], ['scrap', 30], ['cable', 60], ['fiber', 10], ['coal', 10]]) give(i, n);
  p.x = 40 * 48; p.y = 43 * 48;
}

let nextLog = 0;
const steps = Math.round(secs / DT);
for (let i = 0; i < steps; i++) {
  w.step(DT);
  room.snapshot(false);
  room.stats.ticks++;
  if (scenario !== 'idle' && i === 20) scenarioInit();
  if (w.time >= nextLog) {
    nextLog += 30;
    const v = w.flow.view;
    const g = v && v.g;
    console.log(`t=${w.time.toFixed(0)} d${w.clock.day} ${w.clock.season} ${w.clock.phase} users=${w.users} sat=${w.sat.toFixed(0)} ` +
      (g && g.detail ? `dem=${g.demand} ok=${(g.ok * 100).toFixed(1)}% p99=${g.p99.toFixed(0)} amp=${g.amp.toFixed(2)}` : 'nodetail') +
      ` fuel=${w.totalFuel()} cx=${w.complexity} inc=${w.director.active.map((a) => a.id).join(',')} hp=${p.hp.toFixed(0)} hun=${p.hunger.toFixed(0)} san=${p.sanity.toFixed(0)}`);
  }
  if (w.over) { console.log('GAME OVER at', w.time); break; }
}
console.log('errors:', errs, 'ents:', w.ents.size, 'bytes/tick avg:', (room.stats.bytes / Math.max(1, room.stats.ticks)).toFixed(0));
console.log('log:', w.log.map((l) => `${l.id}@d${l.day} err=${l.impact.peakErr}% p99=${l.impact.peakP99}`).join(' | '));

function scenarioInit() {
  if (scenario === 'build') {
    // Mở rộng: LB + 2 app + cache + replica, tất cả trong tầm điện
    const gw = find('gateway')[0], app1 = find('app')[0], db = find('db')[0];
    const place = (kind, tx, ty) => { w.c_place(p, { id: kind, tx, ty }); return find(kind).pop(); };
    const lb = place('lb', 43, 40);
    // chuyển whiteboard: cho phép đặt mà không cần station? đứng gần bảng trắng
    p.x = 36 * 48; p.y = 41 * 48;
    console.log('placed lb?', !!lb);
  }
}
