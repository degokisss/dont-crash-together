// Trạng thái client dùng chung giữa các module UI / renderer.
export const G = {
  net: null, mode: 'none', // none | build | link
  pid: 0, token: '', seed: 0, room: '', tiles: null,
  ents: new Map(), meId: 0,
  tmBase: 0, tmAt: 0, time: 0, users: 0,
  sys: null, history: [], codex: new Set(), newCodex: new Set(), log: [],
  selected: null, hover: null, build: null, buildPos: null, buildValid: false, linkFrom: null,
  mouseWorld: null, fx: [], hurtAt: 0, over: false,
  ping: 0, solo: false, incidents: new Map(),
  kp: 0, learned: new Set(), trace: null, traceShown: 0, traceAt: 0,
  me() { return this.ents.get(this.meId) || null; },
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function send(obj) { if (G.net) G.net.send(obj); }
export function cmd(c, args = {}) { send({ t: 'cmd', c, ...args }); }

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Chế độ con trỏ: đặt công trình / nối cáp. `hooks` do HUD/main gán để tránh import vòng.
export const hooks = { modeChanged() {}, quit() {} };
export function cancelMode() {
  G.mode = 'none'; G.build = null; G.linkFrom = null; G.buildPos = null;
  hooks.modeChanged();
}
export function enterBuild(recipe) { G.mode = 'build'; G.build = recipe; G.linkFrom = null; hooks.modeChanged(); }
export function enterLink(fromId) { G.mode = 'link'; G.linkFrom = fromId; G.build = null; hooks.modeChanged(); }
