// Room = một thế giới + các client đang kết nối. Dùng chung cho Node server (WebSocket) và Web Worker (solo).
// Server authoritative: client chỉ gửi input/lệnh; Room mô phỏng 20 Hz và broadcast delta snapshot.
import { World } from './world.js';
import { TICK_RATE, DT, FLOW_DT } from './data.js';

const HUES = [28, 200, 120, 300, 55, 170, 350, 90];
const MAX_PLAYERS = 8;
const replacer = (k, v) => (k.charCodeAt(0) === 95 ? undefined : v); // bỏ thuộc tính riêng tư bắt đầu bằng "_"

export class Room {
  constructor({ name = 'main', seed = null, save = null, onSave = null } = {}) {
    this.name = name;
    this.onSave = onSave;
    this.clients = new Map(); // client -> {pid, name, token}
    this.nextPid = 1;
    this.sent = new Map(); // id -> chuỗi JSON cuối cùng đã gửi
    this.lastSysTick = -1;
    this.world = new World(seed ?? ((Math.random() * 0xffffff) | 0), save);
    this.acc = 0;
    this.last = 0;
    this.timer = null;
    this.saveAcc = 0;
    this.paused = false;
    this.stats = { ticks: 0, bytes: 0 };
  }

  // ---------- kết nối ----------
  join(client, { name, token, role }) {
    if (this.clients.size >= MAX_PLAYERS) { client.send(JSON.stringify({ t: 'full' })); return null; }
    const pid = this.nextPid++;
    name = String(name || 'Kỹ sư').slice(0, 16);
    token = String(token || Math.random().toString(36).slice(2));
    const used = new Set([...this.clients.values()].map((c) => c.hue));
    const hue = HUES.find((h) => !used.has(h)) ?? HUES[pid % HUES.length];
    const info = { pid, name, token, hue, role };
    const p = this.world.addPlayer(pid, name, token, hue, role);
    this.snapshot(false); // phát delta (gồm người mới) cho các client hiện có
    this.clients.set(client, info);
    this.sendWelcome(client, info);
    return p;
  }

  sendWelcome(client, info) {
    const w = this.world;
    const ents = [...this.sent.values()];
    client.send(`{"t":"welcome","pid":${info.pid},"token":${JSON.stringify(info.token)},"seed":${w.seed},"room":${JSON.stringify(this.name)},"tm":${w.time},` +
      `"kp":${w.kp},"learned":${JSON.stringify([...w.learned])},"codex":${JSON.stringify([...w.codex])},"log":${JSON.stringify(w.log)},"history":${JSON.stringify(w.history)},"users":${w.users},` +
      `"over":${w.over},"sys":${JSON.stringify(w.flow.view)},"ents":[${ents.join(',')}]}`);
  }

  leave(client) {
    const info = this.clients.get(client);
    if (!info) return;
    this.clients.delete(client);
    this.world.removePlayer(info.pid);
  }

  msg(client, m) {
    const info = this.clients.get(client);
    if (!info || !m) return;
    if (m.t === 'in') this.world.setInput(info.pid, m.mx, m.my);
    else if (m.t === 'cmd') {
      if (m.c === 'newgame') { this.reset(); return; }
      this.world.cmd(info.pid, m);
    } else if (m.t === 'ping') client.send(`{"t":"pong","c":${+m.c || 0}}`);
  }

  reset() {
    const old = [...this.clients.entries()];
    this.world = new World((Math.random() * 0xffffff) | 0);
    this.sent.clear();
    this.lastSysTick = -1;
    for (const [client, info] of old) {
      this.world.addPlayer(info.pid, info.name, info.token, info.hue, info.role);
    }
    this.snapshot(true);
    for (const [client, info] of old) this.sendWelcome(client, info);
  }

  // ---------- vòng lặp ----------
  start() {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      try { this.pump(); } catch (e) { console.error('[room ' + this.name + '] lỗi tick:', e); }
    }, 1000 / TICK_RATE / 2);
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  pump() {
    const now = Date.now();
    let el = (now - this.last) / 1000;
    this.last = now;
    if (this.paused) return;
    this.acc += Math.min(el, 0.5);
    let n = 0;
    while (this.acc >= DT && n < 6) {
      this.acc -= DT;
      n++;
      this.world.step(DT);
      this.stats.ticks++;
    }
    if (n) this.snapshot(false);
    this.saveAcc += el;
    if (this.saveAcc > 30) { this.saveAcc = 0; this.save(); }
  }

  save() {
    if (this.onSave) this.onSave(this, this.world.toSave());
  }

  // ---------- snapshot delta ----------
  snapshot(silent) {
    const w = this.world;
    const changed = [];
    for (const e of w.ents.values()) {
      const known = this.sent.has(e.id);
      if (e._cls === 'res' && known && !e._dirty) continue;
      const s = JSON.stringify(e, replacer);
      if (known && this.sent.get(e.id) === s) continue;
      this.sent.set(e.id, s);
      changed.push(s);
      e._dirty = false;
    }
    const gone = [];
    if (w.gone && w.gone.length) {
      for (const id of w.gone) if (this.sent.delete(id)) gone.push(id);
      w.gone = [];
    }
    if (silent) { w.events = []; return; } // dùng khi dựng lại thế giới: welcome mang toàn bộ trạng thái
    const events = w.events;
    w.events = [];
    const shared = [], targeted = new Map();
    for (const ev of events) {
      if (ev.to) { (targeted.get(ev.to) || targeted.set(ev.to, []).get(ev.to)).push(ev); }
      else shared.push(ev);
    }
    const sys = w.flow.view && w.flow.view.tk !== this.lastSysTick ? w.flow.view : null;
    if (sys) this.lastSysTick = sys.tk;
    if (!changed.length && !gone.length && !shared.length && !sys && !targeted.size && w.tick % 10 !== 0) return;
    let msg = `{"t":"s","k":${w.tick},"tm":${Math.round(w.time * 100) / 100},"ents":[${changed.join(',')}]`;
    if (gone.length) msg += `,"gone":${JSON.stringify(gone)}`;
    if (shared.length) msg += `,"ev":${JSON.stringify(shared)}`;
    if (sys) msg += `,"sys":${JSON.stringify(sys)}`;
    msg += `,"users":${Math.round(w.users)}}`;
    this.stats.bytes += msg.length * this.clients.size;
    for (const [client, info] of this.clients) {
      client.send(msg);
      const t = targeted.get(info.pid);
      if (t) client.send(JSON.stringify({ t: 'ev', ev: t }));
    }
    if (w.requestNew) { w.requestNew = false; this.reset(); }
  }
}
