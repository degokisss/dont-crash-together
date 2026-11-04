import { Room } from '../shared/room.js';
import { DT } from '../shared/data.js';
function mk(cfg) {
  const room = new Room({ name: 't', seed: 77 });
  const w = room.world;
  room.join({ send() {} }, { name: 'T', token: 'a' });
  const S = (k) => [...w.structs].filter((s) => s.k === k);
  const gw = S('gateway')[0], app = S('app')[0], db = S('db')[0];
  const rep = w.addStruct('replica', 47, 42), rep2 = cfg.rep2 ? w.addStruct('replica', 48, 44) : null;
  const gen2 = w.addStruct('generator', 47, 45);
  w.addStruct('lantern', 45, 38); w.addStruct('lantern', 49, 41);
  db.links = [rep.id, ...(rep2 ? [rep2.id] : [])];
  Object.assign(db.cfg, cfg.db);
  w.users = 40;
  const run = (s) => { for (let i = 0; i < s / DT; i++) { w.step(DT); for (const g of S('generator')) g.fuel = 200; room.snapshot(false); } };
  return { w, room, S, db, rep, rep2, app, run, gw };
}
const show = (t, w, db) => { const m = w.flow.view.n[db.id]; const g = w.flow.view.g; console.log(t.padEnd(26), `ok=${(g.ok * 100).toFixed(1)}% leader=${db.leader} writable=${m && m.writable} why=${m && m.why} lag=${m && m.lag} split=${m && m.split}`); };
const origSay = console.log;

for (const [name, cfg, fn] of [
  ['A auto async crash', { db: { failover: 'auto' } }, (c) => { c.db.hp = 0; c.w.crash(c.db, 'zap'); }],
  ['B partition auto async', { db: { failover: 'auto' } }, (c) => c.w.director.mods.cut.add(c.db.id + '>' + c.rep.id)],
  ['C partition quorum 2node', { db: { failover: 'quorum' } }, (c) => c.w.director.mods.cut.add(c.db.id + '>' + c.rep.id)],
  ['D partition sync', { db: { failover: 'off', repl: 'sync' } }, (c) => c.w.director.mods.cut.add(c.db.id + '>' + c.rep.id)],
  ['E partition quorum 3node', { db: { failover: 'quorum' }, rep2: true }, (c) => c.w.director.mods.cut.add(c.db.id + '>' + c.rep.id)],
  ['F crash quorum 3node', { db: { failover: 'quorum' }, rep2: true }, (c) => { c.w.crash(c.db, 'zap'); }],
  ['G crash quorum 2node', { db: { failover: 'quorum' } }, (c) => { c.w.crash(c.db, 'zap'); }],
]) {
  console.log('==', name);
  const c = mk(cfg);
  c.run(20);
  show('before', c.w, c.db);
  fn(c);
  c.run(4); show('+4s', c.w, c.db);
  c.run(5); show('+9s', c.w, c.db);
  c.run(10); show('+19s', c.w, c.db);
  c.w.director.mods.cut.clear();
  c.run(3); show('after heal', c.w, c.db);
  console.log('lostTotal', c.w.director.lostTotal);
}
