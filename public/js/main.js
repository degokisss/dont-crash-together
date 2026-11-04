// Điểm vào client: menu, kết nối, vòng lặp render, input, xử lý tin nhắn từ server.
import { G, $, send, cmd, cancelMode, hooks } from './state.js';
import { LocalNet, WsNet } from './net.js';
import { Renderer } from './render.js';
import { HUD } from './hud.js';
import { Inspector } from './inspector.js';
import { Dashboard } from './dashboard.js';
import { CodexUI, entryTitle } from './codexui.js';
import { SFX } from './sfx.js';
import { genTiles } from '/shared/worldgen.js';
import { ROLES, STRUCTS, RESOURCES, MOBS, ITEMS, RECIPES, BUILD_RANGE, STATION_R, TILE, MAP_W, MAP_H } from '/shared/data.js';

let renderer = null;
let running = false;
const keys = new Set();
let lastIn = '0,0';
const SAVE_KEY = 'dct.save.v1';

// ------------------------------------------------------------------ menu
function initMenu() {
  const name = localStorage.getItem('dct.name') || '';
  $('#name').value = name;
  $('#room').value = new URLSearchParams(location.search).get('room') || localStorage.getItem('dct.room') || 'main';
  const saved = localStorage.getItem('dct.role');
  G.role = ROLES[saved] ? saved : 'sre';
  $('#roles').innerHTML = Object.entries(ROLES).map(([id, r]) => `<button class="role ${id === G.role ? 'on' : ''}" data-r="${id}" style="--h:${r.color}"><b>${r.name}</b><small>${r.tag}</small><ul>${r.perks.map((p) => `<li>${p}</li>`).join('')}</ul></button>`).join('');
  $('#roles').onclick = (ev) => { const b = ev.target.closest('.role'); if (!b) return; G.role = b.dataset.r; localStorage.setItem('dct.role', G.role); $('#roles').querySelectorAll('.role').forEach((x) => x.classList.toggle('on', x === b)); };
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  $('#btn-solo-continue').hidden = !hasSave;
  $('#btn-solo-new').textContent = hasSave ? 'Solo: thế giới mới' : 'Chơi một mình';
  $('#btn-solo-continue').onclick = () => start('solo', true);
  $('#btn-solo-new').onclick = () => start('solo', false);
  $('#btn-coop').onclick = () => start('coop');
  $('#btn-how').onclick = () => $('#howto').classList.toggle('open');
  fetch('/api/rooms').then((r) => r.json()).then((rs) => {
    $('#rooms').innerHTML = rs.length ? 'Phòng đang mở: ' + rs.map((r) => `<button class="chip" data-room="${r.name}">${r.name} · ${r.players} người · ngày ${r.day}</button>`).join(' ') : '';
    $('#rooms').querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => { $('#room').value = b.dataset.room; }));
  }).catch(() => {});
}

function start(mode, cont = false) {
  const name = ($('#name').value || 'Kỹ sư').trim().slice(0, 16);
  localStorage.setItem('dct.name', name);
  let token = localStorage.getItem('dct.token');
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('dct.token', token); }
  G.token = token;
  G.solo = mode === 'solo';
  $('#menu').hidden = true;
  $('#game').hidden = false;
  if (!renderer) renderer = new Renderer($('#canvas'), G);
  else renderer.resize();
  if (mode === 'solo') {
    const save = cont ? localStorage.getItem(SAVE_KEY) : null;
    if (!cont) localStorage.removeItem(SAVE_KEY);
    G.net = new LocalNet({ save, name, token, role: G.role }, onMsg, (data) => { try { localStorage.setItem(SAVE_KEY, data); } catch {} });
  } else {
    const room = ($('#room').value || 'main').trim();
    localStorage.setItem('dct.room', room);
    G.net = new WsNet(room, onMsg, () => { if (running) HUD.disconnected(); });
    G.net.send({ t: 'join', name, token, role: G.role });
  }
  if (!running) { running = true; requestAnimationFrame(loop); }
}

export function quitToMenu() {
  if (G.net) { if (G.solo) G.net.close(); else G.net.close(); }
  G.net = null;
  running = false;
  G.ents.clear();
  G.meId = 0;
  G.sys = null;
  G.over = false;
  $('#game').hidden = true;
  $('#menu').hidden = false;
  HUD.reset();
  initMenu();
}
hooks.quit = quitToMenu;

// ------------------------------------------------------------------ nhận tin
function onMsg(m) {
  const now = performance.now();
  switch (m.t) {
    case 'welcome': {
      G.pid = m.pid; G.token = m.token; G.seed = m.seed; G.room = m.room;
      G.tiles = genTiles(m.seed);
      G.ents.clear(); G.meId = 0;
      for (const e of m.ents) addEnt(e, true);
      G.tmBase = m.tm; G.tmAt = now;
      G.codex = new Set(m.codex); G.newCodex = new Set();
      G.log = m.log || []; G.history = m.history || [];
      G.users = m.users; G.over = m.over; G.sys = m.sys || null; G.selected = null; G.mode = 'none';
      G.cam = null;
      HUD.onWelcome();
      Inspector.close();
      break;
    }
    case 's': {
      G.tmBase = m.tm; G.tmAt = now;
      for (const e of m.ents) addEnt(e, false);
      if (m.gone) for (const id of m.gone) { G.ents.delete(id); if (G.selected === id) Inspector.close(); }
      if (m.sys) { G.sys = m.sys; if (m.sys.entry) { G.history.push(m.sys.entry); if (G.history.length > 240) G.history.shift(); } }
      if (m.users !== undefined) G.users = m.users;
      if (m.ev) for (const ev of m.ev) onEvent(ev);
      break;
    }
    case 'ev': for (const ev of m.ev) onEvent(ev); break;
    case 'full': alert('Phòng đã đầy (tối đa 8 người).'); quitToMenu(); break;
    case 'pong': G.ping = Math.round(now - m.c); break;
  }
}

function addEnt(e, init) {
  const old = G.ents.get(e.id);
  e.rx = old ? old.rx : e.x;
  e.ry = old ? old.ry : e.y;
  if (e.k === 'player' && e.pid === G.pid) {
    G.meId = e.id;
    if (old && e.hp < old.hp - 0.5) G.hurtAt = performance.now();
  }
  G.ents.set(e.id, e);
}

function onEvent(ev) {
  switch (ev.t) {
    case 'toast': HUD.toast(ev.msg, ev.kind); SFX.toast(ev.kind); break;
    case 'tip': HUD.tip(ev.msg, ev.codex, ev.kind); break;
    case 'fx': SFX.fx(ev.kind); G.fx.push({ kind: ev.kind, x: ev.x, y: ev.y, t0: performance.now() / 1000 }); break;
    case 'chat': HUD.chat(ev); break;
    case 'codex': if (!G.codex.has(ev.id)) { G.codex.add(ev.id); if (entryTitle(ev.id)) { G.newCodex.add(ev.id); HUD.codexNew(ev.id); SFX.toast('codex'); } } break;
    case 'dayreport': HUD.dayReport(ev); break;
    case 'incident': HUD.incident(ev); if (ev.phase === 'start') SFX.incident(); break;
    case 'postmortem': G.log.push(ev.pm); HUD.postmortem(ev.pm); break;
    case 'gameover': G.over = true; HUD.gameOver(ev); break;
    case 'victory': HUD.victory(ev); break;
  }
}

// ------------------------------------------------------------------ input
function sendMove() {
  let mx = 0, my = 0;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  const k = mx + ',' + my;
  if (k !== lastIn) { lastIn = k; send({ t: 'in', mx, my }); }
}

const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };

window.addEventListener('keydown', (ev) => {
  if (!running) return;
  if (typing()) { if (ev.key === 'Escape') document.activeElement.blur(); if (ev.key === 'Enter' && document.activeElement.id === 'chat-in') HUD.sendChat(); return; }
  const k = ev.key.toLowerCase();
  if (k === 'tab') { ev.preventDefault(); Dashboard.toggle(); return; }
  if (ev.repeat && !['w', 'a', 's', 'd'].includes(k)) return;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); sendMove(); ev.preventDefault(); return; }
  if (k === 'escape') { if (!HUD.closeTop()) { cancelMode(); HUD.toggleMenu(); } return; }
  if (k === 'm') Dashboard.toggle();
  else if (k === 'n') HUD.toast(SFX.toggle() ? 'Đã tắt âm thanh.' : 'Đã bật âm thanh.', 'info');
  else if (k === 'c') HUD.toggleCraft();
  else if (k === 'k' || k === 'b') CodexUI.toggle();
  else if (k === 'enter') { ev.preventDefault(); HUD.focusChat(); }
  else if (k === ' ') { ev.preventDefault(); cmd('attack'); }
  else if (k === 'e') cmd('interact');
  else if (k === 'x') { cancelMode(); cmd('stop'); }
  else if (/^[1-9]$/.test(k)) HUD.useSlot(+k - 1);
  else if (k === '0') HUD.useSlot(9);
  else if (k === '-') HUD.useSlot(10);
  else if (k === '=') HUD.useSlot(11);
});
window.addEventListener('keyup', (ev) => {
  const k = ev.key.toLowerCase();
  if (keys.delete(k)) sendMove();
});
window.addEventListener('blur', () => { keys.clear(); sendMove(); });

function pick(wx, wy) {
  let best = null, bs = -1;
  for (const e of G.ents.values()) {
    if (e.k === 'player') continue;
    if (e.k === 'phantom' && e.for !== G.pid) continue;
    let s = -1;
    const dx = wx - e.rx, dy = wy - e.ry;
    if (MOBS[e.k]) { if (Math.hypot(dx, dy + 6) < 26) s = 4; }
    else if (e.k === 'item') { if (Math.hypot(dx, dy) < 22) s = 3; }
    else if (STRUCTS[e.k]) { if (Math.abs(dx) < e.w * TILE / 2 && dy > -e.h * TILE / 2 - 14 && dy < e.h * TILE / 2) s = 3; }
    else if (RESOURCES[e.k]) { if (Math.abs(dx) < 24 && dy > -38 && dy < 20) s = e.ready ? 1 : 0.5; }
    if (s < 0) continue;
    const d = Math.hypot(dx, dy);
    const score = s * 1000 - d;
    if (score > bs) { bs = score; best = e; }
  }
  return best;
}

function hasStationNear(level) {
  if (level <= 0) return true;
  const me = G.me();
  if (!me) return false;
  for (const s of G.ents.values()) {
    const st = STRUCTS[s.k] && STRUCTS[s.k].station;
    if (st && st >= level && !s.crashed && Math.hypot(me.x - s.x, me.y - s.y) <= STATION_R) return true;
  }
  return false;
}
window.hasStationNear = hasStationNear;

function updateBuildPos() {
  if (G.mode !== 'build' || !G.build || !G.mouseWorld) return;
  const S = STRUCTS[G.build.place];
  const tx = Math.round(G.mouseWorld.x / TILE - S.w / 2), ty = Math.round(G.mouseWorld.y / TILE - S.h / 2);
  G.buildPos = { x: (tx + S.w / 2) * TILE, y: (ty + S.h / 2) * TILE, tx, ty };
  // hợp lệ?
  let ok = true;
  const occ = new Set();
  for (const e of G.ents.values()) {
    if (e.tx === undefined) continue;
    if (RESOURCES[e.k] && (!RESOURCES[e.k].solid || !e.ready)) continue;
    for (let y = 0; y < (e.h || 1); y++) for (let x = 0; x < (e.w || 1); x++) occ.add((e.ty + y) * MAP_W + e.tx + x);
  }
  for (let y = 0; y < S.h && ok; y++) for (let x = 0; x < S.w; x++) {
    const X = tx + x, Y = ty + y;
    if (X < 1 || Y < 1 || X >= MAP_W - 1 || Y >= MAP_H - 1 || G.tiles[Y * MAP_W + X] === 0 || occ.has(Y * MAP_W + X)) { ok = false; break; }
  }
  const me = G.me();
  if (ok && me && Math.hypot(me.x - G.buildPos.x, me.y - G.buildPos.y) > BUILD_RANGE * (me.role === 'netops' ? 1.4 : 1)) ok = false;
  if (ok && !hasStationNear(G.build.station)) ok = false;
  G.buildValid = ok;
}

function bindMouse() {
  const cv = $('#canvas');
  cv.addEventListener('mousemove', (ev) => {
    const r = cv.getBoundingClientRect();
    G.mouseX = ev.clientX; G.mouseY = ev.clientY;
    G.mouseWorld = renderer.toWorld(ev.clientX - r.left, ev.clientY - r.top);
    const h = pick(G.mouseWorld.x, G.mouseWorld.y);
    G.hover = h ? h.id : null;
    HUD.tooltip(h, ev.clientX, ev.clientY);
  });
  cv.addEventListener('mouseleave', () => { G.hover = null; HUD.tooltip(null); });
  cv.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (G.mode !== 'none') cancelMode(); else cmd('stop'); });
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); renderer.cam.zoom = Math.max(0.7, Math.min(2.2, renderer.cam.zoom * (ev.deltaY < 0 ? 1.08 : 0.926))); }, { passive: false });
  cv.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const r = cv.getBoundingClientRect();
    const w = renderer.toWorld(ev.clientX - r.left, ev.clientY - r.top);
    G.mouseWorld = w;
    if (G.mode === 'build' && G.build) {
      updateBuildPos();
      if (G.buildValid) { cmd('place', { id: G.build.id, tx: G.buildPos.tx, ty: G.buildPos.ty }); if (!ev.shiftKey) cancelMode(); }
      else HUD.toast(!hasStationNear(G.build.station) ? 'Cần đứng gần bàn chế tạo phù hợp.' : 'Không đặt được ở đây (vật cản / quá xa).', 'warn');
      return;
    }
    const e = pick(w.x, w.y);
    if (G.mode === 'link') {
      if (e && STRUCTS[e.k] && STRUCTS[e.k].comp) { cmd('link', { from: G.linkFrom, to: e.id }); }
      else cancelMode();
      return;
    }
    if (!e) { Inspector.close(); return; }
    if (STRUCTS[e.k]) { Inspector.open(e.id); return; }
    Inspector.close();
    cmd('goal', { id: e.id });
  });
}

// ------------------------------------------------------------------ vòng lặp
let last = performance.now(), pingT = 0;
let lastErr = '';
function reportError(e) { const m = String(e && e.stack || e); if (m !== lastErr) { lastErr = m; console.error(e); } }
function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop); // đặt lịch trước: một lỗi UI không được làm chết cả vòng lặp
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  G.time = G.tmBase + (now - G.tmAt) / 1000;
  const step = (fn) => { try { fn(); } catch (e) { reportError(e); } };
  step(updateBuildPos);
  if (G.tiles) step(() => renderer.frame(dt, now));
  step(() => HUD.frame(dt));
  step(() => Inspector.frame());
  step(() => Dashboard.frame());
  pingT += dt;
  if (pingT > 3 && !G.solo) { pingT = 0; send({ t: 'ping', c: performance.now() }); }
}

document.addEventListener('visibilitychange', () => { if (G.solo && G.net && G.net.pause) G.net.pause(document.hidden); });
window.addEventListener('beforeunload', () => { if (G.solo && G.net && G.net.save) G.net.save(); });

HUD.init();
Inspector.init();
Dashboard.init();
CodexUI.init();
bindMouse();
initMenu();
// tiện ích debug/test
window.__G = G;
window.__UI = { Inspector, Dashboard, CodexUI, HUD };
