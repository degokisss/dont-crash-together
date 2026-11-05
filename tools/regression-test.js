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

// ---------- Backup & khôi phục ----------
// Thế giới có một DB (tuỳ chọn thêm replica) và người chơi đứng cạnh DB; m() là số liệu DB trên dashboard.
function dbWorld({ backup = 'off', failover = 'off', replica = false, role } = {}) {
  const room = new Room({ seed: 77 });
  const w = room.world;
  const p = room.join({ send() {} }, { name: 'T', token: 'a', role });
  const db = [...w.structs].find((s) => s.k === 'db');
  const rep = replica ? w.addStruct('replica', 47, 42) : null;
  w.addStruct('generator', 47, 45);
  if (rep) db.links = [rep.id];
  Object.assign(db.cfg, { backup, failover });
  w.users = 40;
  p.x = db.x; p.y = db.y;
  const run = (s) => { for (let i = 0; i < s / DT; i++) { w.step(DT); for (const g of w.structs) if (g.k === 'generator') g.fuel = 200; room.snapshot(false); } };
  return { room, w, p, db, rep, run, m: () => w.flow.view.n[db.id], ok: () => w.flow.view.g.ok, active: () => w.director.active.map((i) => i.id) };
}
// Gây dataloss sau 40 s, chờ 8 s, rồi khôi phục (nếu được) hoặc chờ hết hạn; trả về post-mortem
function dataloss(backup) {
  const t = dbWorld({ backup });
  t.run(40);
  t.w.director.create('dataloss', {});
  t.run(8);
  if (backup !== 'off') t.w.c_restore(t.p, { id: t.db.id });
  t.run(70);
  assert.deepEqual(t.active(), []);
  return t.w.log.at(-1);
}

run('hourly backup: each completed snapshot resets the unprotected writes and costs disk', () => {
  const on = dbWorld({ backup: 'hourly' }), off = dbWorld();
  on.run(29); off.run(29);
  const before = on.m();
  assert.equal(typeof before.snapAge, 'number', 'a snapshot completed after enabling backup');
  assert.ok(before.rpo > 3, 'writes since that snapshot are at risk');
  on.run(7); off.run(7);
  const after = on.m();
  assert.ok(after.snapAge < before.snapAge, 'a newer snapshot completed');
  assert.ok(after.rpo < before.rpo, 'at-risk writes reset by the new snapshot');
  assert.ok(off.m().rpo > 3 * Math.max(1, after.rpo), 'without backup every write stays at risk');
  assert.equal(off.m().snapAge, null);
  assert.ok(after.disk > off.m().disk, 'snapshots take disk');
});

run('a running snapshot adds IO load to the DB', () => {
  const on = dbWorld({ backup: 'hourly' }), off = dbWorld();
  on.run(2); off.run(2);
  assert.equal(on.m().snap, 1);
  assert.ok(on.m().u > off.m().u + 0.1, `util ${on.m().u} vs ${off.m().u}`);
});

run('restore after dataloss ends the incident and loses only the writes since the last snapshot', () => {
  const t = dbWorld({ backup: 'hourly' });
  t.run(40);
  t.w.director.create('dataloss', {});
  t.run(8);
  assert.deepEqual(t.active(), ['dataloss']);
  assert.ok(t.ok() < 0.9, 'corrupt data makes requests fail');
  const atRisk = t.m().rpo, lostBefore = t.w.director.lostTotal;
  t.w.c_restore(t.p, { id: t.db.id });
  t.run(1);
  assert.deepEqual(t.active(), []);
  const pm = t.w.log.at(-1), lost = t.w.director.lostTotal - lostBefore;
  assert.equal(pm.id, 'dataloss');
  assert.equal(pm.impact.lost, lost);
  assert.ok(lost > 0 && Math.abs(lost - atRisk) <= 1, `lost ${lost}, at risk ${atRisk}`);
  t.run(30);
  assert.ok(t.ok() > 0.95, 'healthy again after the restore');
});

run('a snapshot bounds the loss; without backup the incident times out and loses everything written', () => {
  const withBackup = dataloss('hourly'), without = dataloss('off');
  assert.ok(withBackup.impact.lost > 0);
  assert.ok(without.impact.lost > 3 * withBackup.impact.lost, `${without.impact.lost} vs ${withBackup.impact.lost}`);
  const credited = (pm) => pm.checks.filter((c) => c.ok).length;
  assert.ok(credited(withBackup) > credited(without), 'post-mortem credits the backup and blames its absence');
});

run('restore is refused when backup is off, and when no snapshot exists yet', () => {
  for (const [name, t, warmup] of [['backup off', dbWorld(), 40], ['no snapshot yet', dbWorld({ backup: 'hourly' }), 2]]) {
    t.run(warmup);
    t.w.director.create('dataloss', {});
    t.run(1);
    t.w.c_restore(t.p, { id: t.db.id });
    const refusal = t.w.events.find((e) => e.t === 'toast' && e.to === t.p.pid);
    assert.ok(refusal && refusal.kind === 'warn', `${name}: player is told why`);
    t.run(5);
    assert.equal(t.db.rb, false, `${name}: no reboot`);
    assert.deepEqual(t.active(), ['dataloss'], `${name}: incident still running`);
    assert.ok(t.ok() < 0.9, `${name}: data still corrupt`);
  }
});

run('turning backup off discards the snapshots; an unknown mode is rejected', () => {
  const t = dbWorld({ backup: 'hourly' });
  t.run(10);
  assert.equal(typeof t.m().snapAge, 'number');
  t.w.c_config(t.p, { id: t.db.id, key: 'backup', val: 'weekly' });
  assert.equal(t.db.cfg.backup, 'hourly');
  t.w.c_config(t.p, { id: t.db.id, key: 'backup', val: 'off' });
  t.run(1);
  assert.equal(t.m().snapAge, null);
});

run('corrupt data is replicated: failing over to a replica does not heal it', () => {
  const sick = dbWorld({ backup: 'hourly', failover: 'auto', replica: true });
  const healthy = dbWorld({ backup: 'hourly', failover: 'auto', replica: true });
  for (const t of [sick, healthy]) t.run(30);
  sick.w.director.create('dataloss', {});
  for (const t of [sick, healthy]) { t.run(3); t.w.crash(t.db, 'zap'); t.run(14); }
  assert.equal(sick.rep.leader, true, 'replica was promoted');
  assert.equal(healthy.rep.leader, true);
  assert.ok(healthy.ok() > 0.95, 'failover alone recovers a healthy cluster');
  assert.ok(sick.ok() < 0.9, 'the promoted replica serves the same corrupt data');
  assert.ok(sick.active().includes('dataloss'));
});

run('a disk-loss crash loses far fewer records when a recent snapshot exists', () => {
  const lostWith = (backup) => {
    const t = dbWorld({ backup, failover: 'auto', replica: true });
    t.run(70);
    t.db._st.diskLoss = true;
    t.w.crash(t.db, 'zap');
    t.run(15);
    return t.w.director.lostTotal;
  };
  const hourly = lostWith('hourly'), off = lostWith('off');
  assert.ok(hourly > 0);
  assert.ok(off > 1.5 * hourly, `${off} vs ${hourly}`);
});

run('a DBA restores in half the time', () => {
  const downtime = (role) => {
    const t = dbWorld({ backup: 'hourly', role });
    t.run(40);
    t.w.director.create('dataloss', {});
    t.run(2);
    t.w.c_restore(t.p, { id: t.db.id });
    let secs = 0;
    while (t.db.rb && secs < 60) { t.run(0.5); secs += 0.5; }
    return secs;
  };
  const sre = downtime('sre'), dba = downtime('dba');
  assert.ok(sre > 0 && dba > 0 && dba <= sre / 2 + 0.5, `sre ${sre}s, dba ${dba}s`);
});

run('save/load keeps backup config, snapshot age and corruption', () => {
  const t = dbWorld({ backup: 'hourly' });
  t.run(40);
  const before = t.m();
  t.w.director.create('dataloss', {});
  t.run(2);
  const room = new Room({ seed: 1, save: t.w.toSave() });
  const p = room.join({ send() {} }, { name: 'T', token: 'b' });
  const w = room.world;
  const db = [...w.structs].find((s) => s.k === 'db');
  assert.equal(db.cfg.backup, 'hourly');
  for (let i = 0; i < 1 / DT; i++) w.step(DT);
  const m = w.flow.view.n[db.id];
  assert.equal(m.corrupt, 1, 'still corrupt after reload');
  assert.ok(m.snapAge >= before.snapAge && m.snapAge <= before.snapAge + 6, `snapshot age ${m.snapAge} vs ${before.snapAge}`);
  p.x = db.x; p.y = db.y;
  w.c_restore(p, { id: db.id });
  for (let i = 0; i < 1 / DT; i++) w.step(DT);
  assert.equal(w.flow.view.n[db.id].corrupt, 0, 'restorable after reload');
});

run('a save from before backups existed loads with backup off', () => {
  const t = dbWorld();
  t.run(5);
  const save = JSON.parse(t.w.toSave());
  for (const e of save.ents) if (e.k === 'db') { delete e.cfg.backup; delete e._st.lastBackupAt; delete e._st.snapUntil; delete e._st.corrupt; }
  const w = new World(9, save);
  for (let i = 0; i < 5 / DT; i++) w.step(DT);
  const db = [...w.structs].find((s) => s.k === 'db');
  assert.equal(db.cfg.backup, 'off');
  assert.equal(w.flow.view.n[db.id].snapAge, null);
});
