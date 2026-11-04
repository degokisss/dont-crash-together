// Kiểm thử headless cho Điểm kiến thức (KP) và theo dõi request.
import { Room } from '../shared/room.js';
import { DT } from '../shared/data.js';
const out = [];
const room = new Room({ name: 't', seed: 77 });
const p = room.join({ send: () => {} }, { name: 'T', token: 'a' });
const w = room.world;
const ev = () => { const e = w.events; w.events = []; return e; };
const S = (k) => [...w.structs].filter((s) => s.k === k);
const run = (s) => { for (let i = 0; i < s / DT; i++) { w.step(DT); for (const g of S('generator')) g.fuel = 200; room.snapshot(true); } };

// --- KP ---
w.addStruct('archlab', 34, 41); p.x = 34 * 48; p.y = 42 * 48;
for (const k of ['silicon', 'copper', 'scrap']) w.give(p, k, 20);
w.events = []; w.c_craft(p, { id: 'waf_module' }); // chưa học
console.log('craft before learn blocked:', w.invCount(p.inv, 'waf_module') === 0, '| kp', w.kp);
w.c_learn(p, { id: 'cache' }); console.log('learn cache (2 KP): learned', w.learned.has('cache'), 'kp', w.kp);
w.c_learn(p, { id: 'chaoslab' }); console.log('learn chaoslab (4 KP) with kp', w.kp, '-> learned', w.learned.has('chaoslab'));
w.addKp(5, 'x'); w.c_learn(p, { id: 'chaoslab' }); console.log('after +5: learned', w.learned.has('chaoslab'), 'kp', w.kp);
const before = w.kp; w.unlock('inc-spike'); w.unlock('comp-whiteboard'); console.log('codex unlock KP +1 for real entry only:', w.kp - before);
const sv = JSON.parse(w.toSave()); console.log('saved kp/learned', sv.kp, sv.learned);
delete sv.kp; delete sv.learned; const legacy = new Room({ save: JSON.stringify(sv) }).world; console.log('legacy save keeps recipes:', legacy.learned.size, 'kp', legacy.kp);

// --- Trace ---
const gw = S('gateway')[0], app1 = S('app')[0], db = S('db')[0];
const lb = w.addStruct('lb', 42, 41), app2 = w.addStruct('app', 45, 41), cache = w.addStruct('cache', 45, 43), q = w.addStruct('queue', 43, 44), rep = w.addStruct('replica', 47, 42);
w.addStruct('generator', 47, 46); w.addStruct('lantern', 45, 38); w.addStruct('lantern', 40, 38);
gw.links = [lb.id]; lb.links = [app1.id, app2.id]; for (const a of [app1, app2]) a.links = [cache.id, db.id, q.id]; cache.links = [db.id]; q.links = [db.id]; db.links = [rep.id];
w.users = 60; run(25);
const trace = (cls) => { w.events = []; w.c_trace(p, { cls }); p._trAt = -9; return ev().find((e) => e.t === 'trace'); };
for (const cls of ['s', 'r', 'w']) { const t = trace(cls); console.log(cls, t.outcome, t.ms + 'ms', t.steps.map((s) => `${s.k}${s.st === 'ok' ? '' : ':' + s.st}`).join(' > '), '| agg', t.agg && `${t.agg.ok}/${t.agg.n} p99=${t.agg.p99}`); }
// kịch bản hỏng
app1.crashed = true; app2.crashed = true; run(8); let t = trace('r'); console.log('apps dead ->', t.outcome, t.why, t.hint && t.hint.codex);
app1.crashed = false; app2.crashed = false; run(15);
w.director.mods.cut.add(db.id + '>' + rep.id); for (let i = 0; i < 60; i++) { run(0.5); }
w.director.mods.cut.clear();
cache.crashed = true; run(8); t = trace('r'); const hasCacheDead = t.steps.some((s) => s.k === 'cache' && s.st === 'dead'); console.log('cache dead trace path ok (falls to db via app routes):', t.outcome, 'cacheDeadStep', hasCacheDead); cache.crashed = false;
w.users = 400; run(20); t = trace('r'); console.log('overload ->', t.outcome, t.why, '| agg ok', t.agg && `${t.agg.ok}/${t.agg.n}`, t.agg && t.agg.top);
// mù: không có đèn giám sát
for (const l of S('lantern')) { l.on = false; l.hp = 0; } w.structs.forEach((s) => { if (s.k === 'lantern') w.removeEnt(s); }); run(2);
t = trace('r'); console.log('blind: steps have no numbers:', t.steps.every((s) => s.t === null && s.note === null), 'agg', t.agg);
