// Web Worker: chạy cùng một lõi mô phỏng (shared/room.js) cho chế độ solo.
// Main thread <-> worker dùng cùng giao thức tin nhắn như WebSocket.
import { Room } from '/shared/room.js';

let room = null;
const client = { send: (s) => postMessage(s) };

self.onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'init') {
    room = new Room({ name: 'solo', save: d.save || null, onSave: (r, json) => postMessage({ type: 'save', data: json }) });
    room.start();
    room.join(client, { name: d.name, token: d.token, role: d.role });
  } else if (d.type === 'msg') {
    if (room) room.msg(client, d.m);
  } else if (d.type === 'pause') {
    if (room) { room.paused = d.v; room.last = Date.now(); }
  } else if (d.type === 'save') {
    if (room) room.save();
  } else if (d.type === 'stop') {
    if (room) { room.save(); room.leave(client); room.stop(); room = null; }
  }
};
