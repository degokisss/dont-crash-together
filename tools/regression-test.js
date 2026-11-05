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

// ---------- Alerting & on-call ----------
// Thế giới monolith mặc định (Gateway -> App -> DB, một Đèn giám sát phủ cả ba) với mức alert và số người dùng chọn trước.
function alertRig(level, users = 40) {
  const room = new Room({ seed: 77 });
  const w = room.world;
  const p = room.join({ send() {} }, { name: 'T', token: 'a' });
  const S = (k) => [...w.structs].filter((s) => s.k === k);
  w.addStruct('generator', 47, 45);
  const run = (s) => { for (let i = 0; i < s / DT; i++) { w.step(DT); for (const g of S('generator')) g.fuel = 200; room.snapshot(false); } };
  const t = { room, w, p, S, run };
  t.w.users = users;
  t.w.director.nextAt = 1e9; // chỉ có sự cố do test gây ra
  for (const l of t.S('lantern')) l.cfg.alert = level;
  t.p2 = null;
  t.join2 = () => (t.p2 = t.room.join({ send() {} }, { name: 'U', token: 'b' }));
  t.pages = () => t.w.alerts.stats.pages;
  t.firing = () => t.w.alerts.groups().filter((g) => g.state === 'firing');
  t.crashApp = () => { t.w.crash(t.S('app')[0], 'zap'); for (let i = 0; i < 40 / DT && !t.firing().length; i++) t.run(DT); }; // crash App và chờ tới khi alert kêu
  return t;
}
const toasts = (msgs, pid) => msgs.flatMap((s) => { const m = JSON.parse(s); return m.t === 'ev' ? m.ev : (m.ev || []); }).filter((e) => e.t === 'toast' && e.to === pid).map((e) => e.msg);

run('a seeded spike pages the on-call player when alerts are normal and nobody when they are off', () => {
  const on = alertRig('normal');
  const off = alertRig('off');
  for (const t of [on, off]) { t.run(10); t.w.director.create('spike').mult = 3; t.run(50); }
  assert.ok(on.pages() >= 1, 'normal alerting pages on the spike');
  assert.equal(on.w.alerts.oncall, on.p.pid, 'the only player is on-call');
  assert.ok(on.w.flow.view.al.list.length >= 1, 'the firing alert is replicated to clients in the system view');
  assert.equal(off.pages(), 0, 'alerts off: nobody is paged');
  assert.equal(off.w.flow.view.al.list.length, 0);
});

run('a page reaches the on-call player as a loud targeted toast and the others as a quiet notice', () => {
  const room = new Room({ seed: 77 });
  const w = room.world;
  const a = [], b = [];
  const p1 = room.join({ send: (s) => a.push(s) }, { name: 'A', token: 'a' });
  const p2 = room.join({ send: (s) => b.push(s) }, { name: 'B', token: 'b' });
  w.addStruct('generator', 47, 45); w.addStruct('lantern', 45, 38);
  w.users = 40; w.director.nextAt = 1e9;
  const app = [...w.structs].find((s) => s.k === 'app');
  for (let i = 0; i < 5 / DT; i++) { w.step(DT); room.snapshot(false); }
  w.crash(app, 'zap');
  for (let i = 0; i < 15 / DT; i++) { w.step(DT); for (const g of w.structs) if (g.k === 'generator') g.fuel = 200; room.snapshot(false); }
  assert.equal(w.alerts.oncall, p1.pid);
  assert.ok(toasts(a, p1.pid).some((m) => m.startsWith('PAGE')), 'on-call is paged');
  assert.ok(!toasts(b, p2.pid).some((m) => m.startsWith('PAGE')), 'the other player is not paged');
  assert.ok(toasts(b, p2.pid).some((m) => m.includes('đang bị page')), 'the other player sees who is being paged');
});

run('acking in time prevents escalation; ignoring the page escalates, costs sanity and lets anyone ack', () => {
  const t = alertRig('normal');
  const { w, p } = t;
  const p2 = t.join2();
  t.crashApp();
  assert.equal(t.firing().length, 1, 'the crash fires an alert');
  w.cmd(p2.pid, { c: 'ack' });
  assert.equal(t.firing().length, 1, 'only the on-call can ack before escalation');
  t.run(10);
  w.cmd(p.pid, { c: 'ack' });
  assert.equal(t.firing().length, 0, 'on-call ack in time');
  assert.equal(w.alerts.groups()[0].state, 'acked');
  t.run(30);
  assert.equal(w.alerts.stats.escalations, 0, 'an acked alert never escalates');
  assert.ok(w.alerts.stats.acked === 1 && w.alerts.stats.ackSecs <= 15, 'MTTA recorded');
  // không ack
  const u = alertRig('normal');
  const q = u.join2();
  u.crashApp();
  const before = u.p.sanity;
  u.run(18);
  assert.equal(u.w.alerts.stats.escalations, 0, 'inside the ack window nothing happens yet');
  u.run(6);
  assert.equal(u.w.alerts.stats.escalations, 1, 'escalated after the ack window');
  assert.ok(before - u.p.sanity >= 12, `on-call lost sanity (${before} -> ${u.p.sanity})`);
  u.w.cmd(q.pid, { c: 'ack' });
  assert.equal(u.firing().length, 0, 'once escalated anyone can ack');
});

run('the on-call rotates at each new day and c_oncall takes the shift', () => {
  const t = alertRig('normal', 24);
  const p2 = t.join2();
  t.run(1);
  assert.equal(t.w.alerts.oncall, t.p.pid);
  t.run(160); // qua ranh giới ngày
  assert.equal(t.w.alerts.oncall, p2.pid, 'next player takes the shift on the new day');
  t.w.cmd(t.p.pid, { c: 'oncall' });
  assert.equal(t.w.alerts.oncall, t.p.pid, 'a player can take the shift');
});

run('sensitive pages on a quiet run (false pages), strict stays silent, and strict detects a crash later than normal', () => {
  const quiet = {};
  for (const level of ['sensitive', 'normal', 'strict']) {
    const t = alertRig(level, 24);
    t.run(300);
    quiet[level] = { pages: t.pages(), fake: t.w.alerts.stats.falsePages };
  }
  assert.ok(quiet.sensitive.fake >= 1, `sensitive false pages: ${quiet.sensitive.fake}`);
  assert.equal(quiet.normal.pages, 0);
  assert.equal(quiet.strict.pages, 0);
  const detect = {};
  for (const level of ['normal', 'strict']) {
    const t = alertRig(level);
    t.run(10);
    t.w.crash(t.S('app')[0], 'zap');
    const inc = t.w.director.active.find((i) => i.id === 'crash');
    t.run(40);
    assert.ok(inc.detectedAt !== undefined, `${level} detects the crash`);
    detect[level] = inc.detectedAt - inc.t0;
  }
  assert.ok(detect.strict > detect.normal, `strict ${detect.strict}s vs normal ${detect.normal}s`);
});

run('components outside every lantern radius never page', () => {
  const t = alertRig('sensitive');
  const far = t.w.addStruct('app', 5, 5);
  far.crashed = true;
  t.run(20);
  assert.equal(t.w.flow.view.n[far.id], undefined, 'no metrics outside the monitored area');
  assert.ok(![...t.w.alerts.reg.values()].some((a) => a.node === far.id), 'no alert state for it either');
  t.w.crash(t.S('app')[0], 'zap');
  t.run(20);
  assert.ok(t.w.alerts.groups().some((g) => g.node === t.S('app')[0].id), 'the monitored app does page');
});

run('save/load does not page an already firing alert again and keeps its escalation clock', () => {
  const t = alertRig('normal');
  t.crashApp();
  t.run(5);
  const before = t.firing()[0];
  const escAt = before.lead.escAt;
  const save = t.w.toSave();
  const w2 = new World(9, save);
  w2.addPlayer(1, 'T', 'a', 0);
  w2.users = 40;
  const got = [];
  const say = w2.say.bind(w2);
  w2.say = (msg, kind, to) => { got.push(msg); say(msg, kind, to); };
  for (let i = 0; i < 8 / DT; i++) { w2.step(DT); for (const g of w2.structs) if (g.k === 'generator') g.fuel = 200; }
  assert.equal(got.filter((m) => m.startsWith('PAGE')).length, 0, 'no second page after reload');
  const g2 = w2.alerts.groups();
  assert.equal(g2.length, 1);
  assert.equal(g2[0].state, 'firing');
  assert.equal(g2[0].lead.escAt, escAt, 'same escalation deadline');
  assert.equal(w2.alerts.oncall, 1, 'the on-call shift survives the reload');
  assert.equal(w2.alerts.stats.pages, t.pages());
});

run('the post-mortem reports MTTD, MTTA and whether the alert beat the SLO breach', () => {
  const t = alertRig('normal');
  t.run(10);
  const app = t.S('app')[0];
  t.crashApp();
  t.run(4);
  t.w.cmd(t.p.pid, { c: 'ack' });
  t.p.x = app.x; t.p.y = app.y;
  t.w.c_reboot(t.p, { id: app.id });
  t.run(30);
  const pm = t.w.log.at(-1);
  assert.equal(pm.id, 'crash');
  assert.ok(pm.impact.mttd >= 3 && pm.impact.mttd <= 15, `mttd ${pm.impact.mttd}`);
  assert.ok(pm.impact.mtta >= 3 && pm.impact.mtta <= 12, `mtta ${pm.impact.mtta}`);
  const row = (re) => pm.checks.find((c) => re.test(c.t));
  assert.equal(row(/Alert phát hiện trước khi SLO vỡ/).ok, false, 'a single-app crash breaks the SLO before any alert can');
  assert.equal(row(/^MTTD/).ok, true);
  assert.equal(row(/^MTTA/).ok, true);
  assert.ok(row(/Báo động giả/), 'false-page row present');
});

run('an incident in an unmonitored or alert-off setup is reported as undetected in the post-mortem', () => {
  const t = alertRig('off');
  t.run(10);
  const app = t.S('app')[0];
  t.w.crash(app, 'zap');
  t.run(5);
  t.p.x = app.x; t.p.y = app.y;
  t.w.c_reboot(t.p, { id: app.id });
  t.run(30);
  const pm = t.w.log.at(-1);
  const c = pm.checks.find((x) => /Alert phát hiện/.test(x.t));
  assert.equal(c.ok, false);
  assert.match(c.d, /Tắt/);
  assert.equal(pm.impact.mttd, null);
});

run('only known alert levels are accepted for a lantern, and choosing one unlocks the Field Guide entry', () => {
  const t = alertRig('normal');
  const l = t.S('lantern')[0];
  t.w.c_config(t.p, { id: l.id, key: 'alert', val: 'paranoid' });
  assert.equal(l.cfg.alert, 'normal');
  t.w.c_config(t.p, { id: l.id, key: 'alert', val: 'strict' });
  assert.equal(l.cfg.alert, 'strict');
  assert.ok(t.w.codex.has('concept-alerting'));
});

run('a save from before alerting loads with the lantern on the default alert level', () => {
  const t = alertRig('normal');
  t.run(2);
  const save = JSON.parse(t.w.toSave());
  delete save.alerts;
  for (const e of save.ents) if (e.k === 'lantern') delete e.cfg;
  const w = new World(9, save);
  for (let i = 0; i < 2 / DT; i++) w.step(DT);
  assert.ok([...w.structs].filter((s) => s.k === 'lantern').every((l) => l.cfg.alert === 'normal'));
});
