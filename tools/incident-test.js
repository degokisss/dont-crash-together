// Kiểm thử headless: dựng kiến trúc đầy đủ, kích hoạt từng sự cố, in kết quả.
import { Room } from '../shared/room.js';
import { DT } from '../shared/data.js';
const room = new Room({ name: 't', seed: 77 });
const w = room.world;
room.join({ send() {} }, { name: 'T', token: 'a' });
const p = [...w.players.values()][0];
const S = (k) => [...w.structs].filter((s) => s.k === k);
const add = (k, tx, ty) => { const e = w.addStruct(k, tx, ty); return e; };
const gw = S('gateway')[0], app1 = S('app')[0], db = S('db')[0];
const lb = add('lb', 42, 41), app2 = add('app', 45, 41), cache = add('cache', 45, 43), rep = add('replica', 47, 42), q = add('queue', 43, 44);
const gen2 = add('generator', 47, 45); gen2.fuel = 200; S('generator')[0].fuel = 200;
add('lantern', 45, 38); add('lantern', 49, 41);
gw.links = [lb.id]; lb.links = [app1.id, app2.id]; app1.links = [cache.id, db.id, q.id]; app2.links = [cache.id, db.id, q.id]; cache.links = [db.id]; db.links = [rep.id]; q.links = [db.id];
w.users = +process.argv[3] || 80;
const which = process.argv[2] ? process.argv[2].split(',') : ['spike', 'stampede', 'crash', 'leak', 'ddos', 'partition', 'hotkey', 'diskfull', 'baddeploy', 'outage', 'analytics'];
function run(secs) { for (let i = 0; i < secs / DT; i++) { w.step(DT); for (const g of S('generator')) g.fuel = 200; room.snapshot(false); } }
run(20);
let errs = 0; console.error = (...a) => { errs++; console.log('ERR', ...a); };
for (const id of which) {
  w.users = +process.argv[3] || 80;
  if (id === 'baddeploy') { const a = S('app')[0]; a.bad = true; w.director.create('baddeploy', { target: a.id, kind: 'app' }); run(15); a.bad = false; }
  else w.director.create(id, {});
  run(10);
  const v = w.flow.view.g;
  const mid = `ok=${(v.ok * 100).toFixed(1)}% p99=${Math.round(v.p99)} amp=${v.amp.toFixed(2)}`;
  for (let i = 0; i < 400 && w.director.active.length; i++) {
    run(1);
    // auto reboot crashed
    for (const s of S('app').concat(S('db'), S('cache'), S('lb'))) if (s.crashed && w.time % 7 < 1) { s.crashed = false; s.hp = s.mhp; w.startReboot(s, 8); }
    for (const a of S('app')) if (a._st && a._st.leak && w.time % 50 < 1) { a._st.leak = false; }
  }
  const pm = w.log[w.log.length - 1];
  console.log(`${id.padEnd(10)} mid[${mid}] -> pm: ${pm ? `${pm.dur}s err=${pm.impact.peakErr}% p99=${pm.impact.peakP99} checks ${pm.checks.filter((c) => c.ok).length}/${pm.checks.length}` : 'NONE'} users=${Math.round(w.users)}`);
  run(30);
}
console.log('errors', errs);
