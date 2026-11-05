// Hồi quy: lệnh/token độc hại không được làm sập mô phỏng; save/load giữ bản đồ. Chạy: node tools/regression-test.js
import assert from 'node:assert/strict';
import { Room } from '../shared/room.js';
import { World } from '../shared/world.js';
import { DT, COMP, canLink } from '../shared/data.js';

const run = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } };
const stepFor = (room, secs) => { for (let i = 0; i < secs / DT; i++) { room.world.step(DT); room.snapshot(false); } };

for (const key of ['__proto__', 'constructor', 'toString']) {
  run(`join token "${key}" does not crash the tick`, () => {
    const room = new Room({ seed: 1 });
    const p = room.join({ send() {} }, { name: 'a', token: key, role: key });
    assert.ok(p.inv && p.eq, 'player has inventory and equipment');
    stepFor(room, 1);
  });
  run(`unequip slot "${key}" does not crash the tick`, () => {
    const room = new Room({ seed: 1 });
    const c = { send() {} };
    room.join(c, { name: 'a', token: 't' });
    room.msg(c, { t: 'cmd', c: 'unequip', slot: key });
    stepFor(room, 1);
  });
}

run('save/load keeps the saved seed and terrain', () => {
  const a = new World(111);
  const b = new World(222, a.toSave());
  assert.equal(b.seed, 111);
  assert.deepEqual([...b.tiles], [...a.tiles]);
});

run('a ghost that rejoins from the stash respawns', () => {
  const room = new Room({ seed: 1 });
  const c = { send() {} };
  const p = room.join(c, { name: 'a', token: 'tok' });
  room.world.killPlayer(p);
  room.leave(c);
  const c2 = { send() {} };
  const p2 = room.join(c2, { name: 'a', token: 'tok' });
  assert.equal(p2.ghost, true);
  stepFor(room, 20);
  assert.equal(p2.ghost, false, 'revived after the respawn delay');
});

run('a save without dayStat loads and runs a day boundary', () => {
  const save = JSON.parse(new World(5).toSave());
  delete save.dayStat;
  const w = new World(9, save);
  for (let i = 0; i < 60 / DT; i++) w.step(DT);
});

run('DB regains leadership when the replica leader dies after the primary reboots', () => {
  const room = new Room({ seed: 77 });
  const w = room.world;
  room.join({ send() {} }, { name: 'T', token: 'a' });
  const db = [...w.structs].find((s) => s.k === 'db');
  const rep = w.addStruct('replica', 47, 42);
  w.addStruct('generator', 47, 45);
  db.links = [rep.id];
  db.cfg.failover = 'auto';
  w.users = 40;
  const run = (s) => { for (let i = 0; i < s / DT; i++) { w.step(DT); for (const g of w.structs) if (g.k === 'generator') g.fuel = 200; room.snapshot(false); } };
  const writable = () => w.flow.view.n[db.id].writable;
  run(20);
  w.crash(db, 'zap'); run(10);
  assert.equal(writable(), 1, 'replica promoted');
  db.crashed = false; db.on = true; db.hp = db.mhp; run(10);
  w.crash(rep, 'zap'); run(15);
  assert.equal(writable(), 1, 'primary promoted back');
});

run('every system component declares its outgoing links so the inspector and canLink can read them', () => {
  for (const [k, c] of Object.entries(COMP)) assert.ok(Array.isArray(c.out), `${k}.out is an array`);
  assert.equal(canLink('replica', 'db'), false);
});
