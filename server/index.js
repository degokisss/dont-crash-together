// Server co-op: phục vụ file tĩnh + WebSocket. Mỗi "phòng" là một thế giới authoritative riêng.
// Chạy: node server/index.js [port]   (mặc định 3000)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from '../shared/room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.argv[2] || +process.env.PORT || 3000;
const SAVES = path.join(ROOT, 'saves');
fs.mkdirSync(SAVES, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([...rooms.values()].map((r) => ({ name: r.name, players: r.clients.size, day: r.world.clock.day, users: Math.round(r.world.users) }))));
    return;
  }
  if (p.startsWith('/shared/')) return serveFile(res, path.join(ROOT, 'shared'), p.slice(8));
  if (p === '/') p = '/index.html';
  serveFile(res, path.join(ROOT, 'public'), p.slice(1));
});

// ---- phòng ----
const rooms = new Map();
const safeName = (n) => String(n || 'main').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'main';

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;
  const file = path.join(SAVES, name + '.json');
  let save = null;
  if (fs.existsSync(file)) {
    try { save = fs.readFileSync(file, 'utf8'); } catch { save = null; }
  }
  const onSave = (r, json) => {
    // ghi nguyên tử: ghi file tạm rồi đổi tên (tránh file hỏng nếu crash giữa chừng)
    const tmp = file + '.tmp';
    fs.writeFile(tmp, json, (e) => { if (!e) fs.rename(tmp, file, () => {}); });
  };
  try { room = new Room({ name, save, onSave }); } catch (e) { console.error('save hỏng, tạo thế giới mới', e.message); room = new Room({ name, onSave }); }
  room.start();
  rooms.set(name, room);
  console.log(`[room ${name}] ${save ? 'đã tải từ ổ đĩa' : 'thế giới mới'}`);
  return room;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = getRoom(safeName(url.searchParams.get('room')));
  const client = { send: (s) => { if (ws.readyState === 1) ws.send(s); } };
  let joined = false;
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!joined) {
      if (m.t !== 'join') return;
      joined = !!room.join(client, { name: m.name, token: m.token, role: m.role });
      return;
    }
    room.msg(client, m);
  });
  ws.on('close', () => { if (joined) room.leave(client); });
  ws.on('error', () => {});
});

function shutdown() {
  for (const r of rooms.values()) { try { fs.writeFileSync(path.join(SAVES, r.name + '.json'), r.world.toSave()); } catch (e) { console.error(e); } }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Don't Crash Together chạy tại http://localhost:${PORT}`));
