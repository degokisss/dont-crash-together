// Procedural art cho "Don't Crash Together" — hand-inked gothic cartoon, thuần canvas 2D.
// API: drawEntity, zOf, iconURL, drawUser, drawGhost, drawFxSpark.
// Quy ước: drawUser(ctx,x,y,...) coi (x,y) là TÂM sprite (cao ~20px, bóng ở y+10).
import { ITEMS, STRUCTS, RESOURCES, MOBS, TILE } from '/shared/data.js';

const INK = '#15110d';
const TAU = Math.PI * 2;
const DASH = [6, 5];
const NODASH = [];

// ---------------------------------------------------------------- state ----
let sd = 1; // seed của entity đang vẽ
let wi = 0; // bộ đếm wobble (reset mỗi entity => ổn định giữa các frame)
const S = { t: 0, on: true, crashed: false, rb: false, mode: 0, gk: 1, tier: 1, sel: false, w: 1, h: 1 };

function seedOf(id) {
  if (typeof id === 'number') return (Math.abs(id) * 7.31 + 1.7) % 997;
  let h = 7;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h * 0.37 + 1;
}
function J() { // wobble tất định -1..1
  wi++;
  const v = Math.sin(sd * 12.9898 + wi * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}
function hf(n) { // hash 0..1
  const v = Math.sin(n * 127.1 + sd * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- colour ---
const cmaps = [new Map(), new Map(), new Map(), new Map()];
function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mixHex(h, to, k, desat) {
  const a = hexToRgb(h), b = hexToRgb(to);
  const g = (a[0] + a[1] + a[2]) / 3;
  const o = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const v = desat ? a[i] + (g - a[i]) * desat : a[i];
    o[i] = Math.round(v + (b[i] - v) * k);
  }
  return 'rgb(' + o[0] + ',' + o[1] + ',' + o[2] + ')';
}
// C(): áp trạng thái (tắt điện / sập / bản deploy lỗi) lên màu gốc
function C(hex) {
  const m = S.mode;
  if (m === 0) return hex;
  const map = cmaps[m];
  let v = map.get(hex);
  if (!v) {
    v = m === 1 ? mixHex(hex, '#18171a', 0.42, 0.5) : m === 2 ? mixHex(hex, '#7ea53a', 0.42, 0) : mixHex(hex, '#1d1210', 0.45, 0.3);
    map.set(hex, v);
  }
  return v;
}

const glows = new Map();
function glowSprite(col) {
  let c = glows.get(col);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, col + 'dd');
    gr.addColorStop(0.35, col + '66');
    gr.addColorStop(1, col + '00');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glows.set(col, c);
  }
  return c;
}
function glow(ctx, x, y, r, col, a) {
  const pa = ctx.globalAlpha;
  ctx.globalAlpha = clamp(a * S.gk, 0, 1) * pa;
  ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = pa;
}

// ------------------------------------------------------------ primitives ---
function fs(ctx, fill, lw) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (lw !== 0) { ctx.lineWidth = lw === undefined ? 2.5 : lw; ctx.stroke(); }
}
function rect(ctx, x, y, w, h, fill, r, lw) {
  const a = J() * 0.8, b = J() * 0.8, c = J() * 0.8, d = J() * 0.8;
  ctx.beginPath();
  ctx.roundRect(x + a, y + b, Math.max(1, w + c - a), Math.max(1, h + d - b), r === undefined ? 3 : r);
  fs(ctx, fill, lw);
}
function ell(ctx, x, y, rx, ry, fill, lw) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx + J() * 0.5), Math.max(0.1, ry + J() * 0.5), 0, 0, TAU);
  fs(ctx, fill, lw);
}
function poly(ctx, a, fill, lw, jit) {
  const k = jit === undefined ? 0.7 : jit;
  ctx.beginPath();
  for (let i = 0; i < a.length; i += 2) {
    const x = a[i] + J() * k, y = a[i + 1] + J() * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  fs(ctx, fill, lw);
}
function line(ctx, x1, y1, x2, y2, col, lw) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = col || INK;
  ctx.lineWidth = lw || 2;
  ctx.stroke();
  ctx.strokeStyle = INK;
}
// đường mực + lõi màu (cáp, ống, ray)
function tube(ctx, x1, y1, cx, cy, x2, y2, col, w) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.strokeStyle = INK; ctx.lineWidth = w + 2.4; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  ctx.strokeStyle = INK;
}
function shadow(ctx, x, y, rx, ry, a) {
  ctx.fillStyle = 'rgba(0,0,0,' + (a || 0.3) + ')';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}
function flameShape(ctx, x, y, w, h, fill, lw) {
  const t = S.t;
  const tip = Math.sin(t * 9 + sd) * w * 0.45;
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w * 1.2, y - h * 0.5, x - w * 0.25, y - h * 0.55, x + tip, y - h);
  ctx.bezierCurveTo(x + w * 0.45, y - h * 0.5, x + w * 1.2, y - h * 0.4, x + w, y);
  ctx.quadraticCurveTo(x, y + w * 0.5, x - w, y);
  ctx.closePath();
  fs(ctx, fill, lw);
}
function flame(ctx, x, y, s, a, b) {
  const t = S.t;
  const fl = 1 + Math.sin(t * 11 + sd) * 0.12 + Math.sin(t * 17.3 + sd * 2) * 0.08;
  flameShape(ctx, x, y, 7 * s, 18 * s * fl, a || '#e0662a', 2.2);
  flameShape(ctx, x, y, 4 * s, 11 * s * fl, b || '#ffd25a', 0);
}
function smoke(ctx, x, y, n, rise, col, r0) {
  const t = S.t;
  for (let i = 0; i < n; i++) {
    const ph = (t * 0.45 + i / n + hf(i) * 0.2) % 1;
    const r = (r0 || 4) + ph * 6;
    ctx.globalAlpha = (1 - ph) * 0.65;
    ctx.fillStyle = col || '#8d8a86';
    ctx.beginPath();
    ctx.arc(x + Math.sin(ph * 5 + i * 2 + sd) * 4, y - ph * rise, r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function sparks(ctx, x, y, spread, n, col) {
  const q = Math.floor(S.t * 12);
  ctx.strokeStyle = col || '#ffe27a';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < n; i++) {
    const a = hf(q * 7 + i * 3) * TAU, d = 3 + hf(q * 5 + i) * spread;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * 4, py + Math.sin(a) * 4 - 1);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
}
// mắt/LED: on => tròng sáng, off => tối, crashed => X đỏ, rb => nháy
function eye(ctx, x, y, r, col) {
  col = col || '#58d6e0';
  if (S.crashed) {
    ell(ctx, x, y, r, r, '#3a1512', 1.6);
    const k = r * 0.6;
    line(ctx, x - k, y - k, x + k, y + k, '#ff3b2f', 1.8);
    line(ctx, x + k, y - k, x - k, y + k, '#ff3b2f', 1.8);
    return;
  }
  if (!S.on) {
    ell(ctx, x, y, r, r, '#3a3835', 1.6);
    ell(ctx, x, y + 0.5, r * 0.35, r * 0.35, '#161412', 0);
    return;
  }
  if (S.rb && ((S.t * 5) | 0) & 1) {
    ell(ctx, x, y, r, r, '#3a3835', 1.6);
    return;
  }
  glow(ctx, x, y, r * 3.2, col, 0.55);
  ell(ctx, x, y, r, r, '#eef5ee', 1.6);
  const gx = Math.sin(S.t * 0.7 + sd) * r * 0.3;
  ell(ctx, x + gx, y, r * 0.55, r * 0.55, col, 0);
  ell(ctx, x + gx, y, r * 0.22, r * 0.22, '#0b1a1c', 0);
}
// đèn LED nhỏ
function led(ctx, x, y, r, col, phase) {
  if (S.crashed) { ell(ctx, x, y, r, r, '#4a1511', 1); return; }
  let lit = S.on;
  if (lit && S.rb) lit = ((S.t * 5 + phase) | 0) & 1;
  if (lit) {
    const f = Math.sin(S.t * 6 + phase * 5 + sd) > -0.6;
    if (f) glow(ctx, x, y, r * 3, col, 0.5);
    ell(ctx, x, y, r, r, f ? col : '#25303a', 1);
  } else ell(ctx, x, y, r, r, '#2b2a2c', 1);
}

// ---------------------------------------------------------------- tools ----
// gốc = chỗ cầm, hướng lên (-y)
function drawTool(ctx, id) {
  if (id === 'axe') { // tua vít điện
    line(ctx, 0, 10, 0, -6, INK, 9); line(ctx, 0, 10, 0, -6, '#e0852a', 6);
    rect(ctx, -5, -12, 10, 7, '#4a4d55', 1.6, 1.8);
    line(ctx, 0, -12, 0, -28, INK, 5); line(ctx, 0, -12, 0, -28, '#c3ccd4', 2.6);
    poly(ctx, [-4, -28, 4, -28, 0, -34], '#c3ccd4', 1.8);
    ell(ctx, 0, 1, 2, 2, '#5fe0ff', 1);
  } else if (id === 'pickaxe') { // máy khoan wafer
    line(ctx, 0, 10, 0, -4, INK, 9); line(ctx, 0, 10, 0, -4, '#3f8fa8', 6);
    rect(ctx, -8, -16, 16, 12, '#4a4d55', 2, 2);
    ell(ctx, 0, -10, 2.2, 2.2, '#ffb43a', 1);
    poly(ctx, [-5, -16, 5, -16, 0, -34], '#aab4be', 2);
    line(ctx, -3, -20, 3, -23, INK, 1.4); line(ctx, -2, -26, 2, -28, INK, 1.4);
  } else if (id === 'spear') {
    line(ctx, 0, 14, 0, -26, INK, 6); line(ctx, 0, 14, 0, -26, '#8a6238', 3.4);
    poly(ctx, [-4.5, -25, 0, -40, 4.5, -25, 0, -22], '#c5d0d8', 2.2);
    ell(ctx, 0, -17, 3, 3, '#c9372c', 1.4);
  } else if (id === 'torch') {
    line(ctx, 0, 9, 0, -10, INK, 6); line(ctx, 0, 9, 0, -10, '#7d5a36', 3.4);
    rect(ctx, -3.5, -13, 7, 5, '#4a4d55', 1.5, 1.8);
    glow(ctx, 0, -20, 22, '#ffb43a', 0.7);
    flame(ctx, 0, -12, 0.7, '#e8782a', '#ffe27a');
  }
}
function drawWrench(ctx, col) {
  col = col || '#b0b6bd';
  poly(ctx, [-3, 22, -3.4, -2, -8, -5, -8.5, -13, -3.5, -17, -3.5, -9.5, 3.5, -9.5, 3.5, -17, 8.5, -13, 8, -5, 3.4, -2, 3, 22], col, 2.2, 0.4);
  ell(ctx, 0, 19, 1.5, 1.5, '#15110d', 0);
}

// ------------------------------------------------------------ icons (items) -
function drawItemGlyph(ctx, id) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK;
  switch (id) {
    case 'cable': {
      for (const r of [13, 8]) {
        ctx.beginPath(); ctx.arc(-2, 1, r, 0, TAU);
        ctx.strokeStyle = INK; ctx.lineWidth = 6.4; ctx.stroke();
        ctx.strokeStyle = r > 10 ? '#3aa6c9' : '#58d6e0'; ctx.lineWidth = 3.6; ctx.stroke();
      }
      ctx.strokeStyle = INK;
      rect(ctx, 6, 8, 11, 8, '#9a9ca2', 2, 2);
      line(ctx, 17, 10.5, 20, 10.5, '#d9b34a', 1.8); line(ctx, 17, 13.5, 20, 13.5, '#d9b34a', 1.8);
      break;
    }
    case 'scrap': {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, r = i & 1 ? 10 : 14; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r - 2, Math.sin(a) * r - 2); }
      ctx.closePath(); fs(ctx, '#a39f98', 2.2);
      ell(ctx, -2, -2, 4, 4, '#2e2b28', 1.6);
      rect(ctx, 3, 4, 14, 11, '#3f7a4a', 1.5, 2);
      for (let i = 0; i < 3; i++) line(ctx, 6 + i * 4, 15, 6 + i * 4, 18, '#d9b34a', 1.6);
      break;
    }
    case 'silicon': crystal(ctx, '#7c8fb0', '#a9bbd8', '#4b5a78'); break;
    case 'wood': {
      rect(ctx, -14, -15, 28, 30, '#4a4d55', 3, 2.2);
      for (let i = 0; i < 3; i++) {
        rect(ctx, -10, -11 + i * 9, 20, 6, '#8d95a0', 1.6, 1.6);
        ell(ctx, 6, -8 + i * 9, 1.3, 1.3, i === 1 ? '#ffb43a' : '#5fe0ff', 0);
        line(ctx, -7, -8 + i * 9, 1, -8 + i * 9, INK, 1);
      }
      break;
    }
    case 'copper': {
      poly(ctx, [-16, 14, -11, 2, 11, 2, 16, 14], '#c8773a', 2.4);
      poly(ctx, [-11, 0, -6, -12, 6, -12, 11, 0], '#dc8c4c', 2.4);
      line(ctx, -8, 6, 5, 6, '#f0b27a', 1.6);
      break;
    }
    case 'fiber': {
      glow(ctx, 0, 0, 24, '#58d6e0', 0.6);
      ell(ctx, -11, 0, 3.5, 12, '#6a6f78', 2); ell(ctx, 11, 0, 3.5, 12, '#6a6f78', 2);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(-11, -9 + i * 6); ctx.quadraticCurveTo(0, -9 + i * 6 + (i & 1 ? 5 : -5), 11, -9 + i * 6);
        ctx.strokeStyle = i & 1 ? '#bff6ff' : '#58d6e0'; ctx.lineWidth = 2.4; ctx.stroke();
      }
      ctx.strokeStyle = INK;
      break;
    }
    case 'coal': {
      poly(ctx, [-16, 14, -17, 2, -8, -4, 0, 2, 2, 14], '#2a272e', 2.4);
      poly(ctx, [-2, 14, 0, 0, 8, -10, 17, -2, 16, 14], '#34313a', 2.4);
      poly(ctx, [-9, 2, -4, -14, 4, -10, 2, 2], '#3d3a45', 2.4);
      line(ctx, 6, -4, 12, -4, '#7a7783', 1.5); line(ctx, -6, -9, -3, -5, '#7a7783', 1.5);
      ell(ctx, 8, 7, 1.8, 1.8, '#ff8a3a', 0);
      break;
    }
    case 'bean': {
      for (const p of [[-6, 2, -0.5], [7, -2, 0.6]]) {
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(p[2]);
        ell(ctx, 0, 0, 8, 11, '#b8402c', 2.2);
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.quadraticCurveTo(-4, 0, 0, 9);
        ctx.lineWidth = 1.8; ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'mushroom': mushIcon(ctx); break;
    case 'coffee': {
      ctx.save(); ctx.translate(0, 3);
      smokeIcon(ctx, 0, -10);
      poly(ctx, [-12, -8, 12, -8, 9, 12, -9, 12], '#e8dfcb', 2.4);
      ctx.beginPath(); ctx.arc(13, 0, 6, -1.4, 1.4); ctx.lineWidth = 3.6; ctx.stroke();
      ell(ctx, 0, -8, 12, 3.4, '#4a2c1a', 2);
      line(ctx, -8, -1, -6, 8, '#fff', 1.4);
      ctx.restore();
      break;
    }
    case 'stew': {
      ctx.save(); ctx.translate(0, 4);
      smokeIcon(ctx, 0, -8);
      line(ctx, 6, -12, 14, -2, INK, 3.6); line(ctx, 10, -13, 17, -4, INK, 3.6);
      line(ctx, 6, -12, 14, -2, '#c9a86a', 2); line(ctx, 10, -13, 17, -4, '#c9a86a', 2);
      ctx.beginPath(); ctx.moveTo(-16, -6); ctx.quadraticCurveTo(-14, 14, 0, 14); ctx.quadraticCurveTo(14, 14, 16, -6); ctx.closePath(); fs(ctx, '#7d6a8a', 2.4);
      ell(ctx, 0, -6, 16, 4.5, '#e2a84a', 2.2);
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.quadraticCurveTo(-5, -9, -1, -6); ctx.quadraticCurveTo(3, -3, 8, -6);
      ctx.strokeStyle = '#fff1b8'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.strokeStyle = INK;
      ell(ctx, -6, -4, 2.4, 1.6, '#8a5a3a', 0); ell(ctx, 4, -7, 2.4, 1.6, '#8a5a3a', 0);
      ctx.restore();
      break;
    }
    case 'axe': case 'pickaxe': case 'spear': case 'torch': {
      ctx.save(); ctx.rotate(0.7);
      ctx.translate(0, id === 'spear' ? 10 : id === 'torch' ? 4 : 4);
      if (id === 'spear') ctx.scale(0.8, 0.8);
      drawTool(ctx, id);
      ctx.restore();
      break;
    }
    case 'vest': {
      poly(ctx, [-8, -15, -3, -15, 0, -8, 3, -15, 8, -15, 16, -8, 13, 16, 3, 16, 3, -2, -3, -2, -3, 16, -13, 16, -16, -8], '#e08a2a', 2.4);
      line(ctx, -10, 6, -4, 6, '#f6e7a8', 3); line(ctx, 4, 6, 10, 6, '#f6e7a8', 3);
      rect(ctx, 5, -2, 6, 5, '#b86a1e', 1, 1.6);
      break;
    }
    case 'duck': {
      ell(ctx, -2, 7, 13, 9, '#f2cf3a', 2.4);
      ctx.beginPath(); ctx.moveTo(8, 6); ctx.quadraticCurveTo(15, 0, 13, 4); ctx.lineWidth = 0; 
      ell(ctx, 5, -6, 8, 8, '#f6d64a', 2.4);
      poly(ctx, [11, -6, 18, -4, 11, -1], '#e8762a', 1.8);
      ell(ctx, 6, -9, 1.6, 1.6, INK, 0);
      ctx.beginPath(); ctx.arc(-5, 7, 5, 3.4, 5.6); ctx.lineWidth = 1.6; ctx.stroke();
      break;
    }
    case 'waf_module': moduleCard(ctx, 'shield'); break;
    case 'docker_module': moduleCard(ctx, 'whale'); break;
    case 'asg_module': moduleCard(ctx, 'arrows'); break;
    default: {
      rect(ctx, -12, -12, 24, 24, '#6a6a70', 3, 2.4);
      line(ctx, -4, -4, -4, -4, INK, 1); ctx.beginPath(); ctx.arc(0, -3, 4, Math.PI, TAU + 0.6); ctx.lineWidth = 2.4; ctx.stroke();
      ell(ctx, 0, 7, 1.6, 1.6, INK, 0);
    }
  }
}
function crystal(ctx, a, b, c) {
  poly(ctx, [0, -17, 11, -7, 9, 12, 0, 17, -9, 12, -11, -7], a, 2.4);
  poly(ctx, [0, -17, 11, -7, 0, -2], b, 1.6);
  poly(ctx, [0, -2, 11, -7, 9, 12, 0, 17], c, 1.6);
  line(ctx, -5, -6, -4, 8, 'rgba(255,255,255,.6)', 1.6);
}
function mushIcon(ctx) {
  glow(ctx, 0, -4, 22, '#7ee8d0', 0.5);
  rect(ctx, -4, -2, 8, 16, '#d8d0bd', 3, 2.2);
  ctx.beginPath(); ctx.moveTo(-16, 0); ctx.quadraticCurveTo(-14, -18, 0, -18); ctx.quadraticCurveTo(14, -18, 16, 0); ctx.quadraticCurveTo(0, 4, -16, 0); fs(ctx, '#7a58b0', 2.4);
  ell(ctx, -6, -9, 2.6, 2.2, '#9af2dc', 0); ell(ctx, 4, -12, 2.2, 2, '#9af2dc', 0); ell(ctx, 8, -5, 1.8, 1.6, '#9af2dc', 0);
}
function smokeIcon(ctx, x, y) {
  ctx.strokeStyle = 'rgba(235,235,235,.85)'; ctx.lineWidth = 2.2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(x + i * 5, y); ctx.bezierCurveTo(x + i * 5 - 3, y - 4, x + i * 5 + 3, y - 6, x + i * 5, y - 10); ctx.stroke();
  }
  ctx.strokeStyle = INK;
}
function moduleCard(ctx, sym) {
  rect(ctx, -12, -16, 24, 28, '#2f6a52', 3, 2.4);
  for (let i = 0; i < 5; i++) line(ctx, -9 + i * 4.5, 12, -9 + i * 4.5, 17, '#d9b34a', 2);
  rect(ctx, -8, -12, 16, 4, '#1c3d30', 1, 1.2);
  if (sym === 'shield') {
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(7, -3); ctx.quadraticCurveTo(7, 6, 0, 10); ctx.quadraticCurveTo(-7, 6, -7, -3); ctx.closePath(); fs(ctx, '#58d6e0', 1.8);
    line(ctx, 0, -2, 0, 5, '#0c3a40', 1.6);
  } else if (sym === 'whale') {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3 - r; c++) rect(ctx, -7 + c * 5 + r * 2.5, -1 - r * 4.5, 4.4, 4, '#58b6d0', 1, 1.2);
    ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(8, 4); ctx.quadraticCurveTo(7, 10, -1, 10); ctx.quadraticCurveTo(-7, 9, -8, 4); ctx.closePath(); fs(ctx, '#2b8ad6', 1.6);
  } else {
    for (const y of [-4, 3]) { ctx.beginPath(); ctx.moveTo(-6, y + 4); ctx.lineTo(0, y - 2); ctx.lineTo(6, y + 4); ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#7ee8a0'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.strokeStyle = INK; }
  }
}

// ---------------------------------------------------------- HUD glyphs ------
function drawHud(ctx, key) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK;
  switch (key) {
    case 'heart':
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.bezierCurveTo(-24, -2, -14, -20, 0, -8); ctx.bezierCurveTo(14, -20, 24, -2, 0, 15); fs(ctx, '#d4453a', 2.6);
      line(ctx, -9, -8, -6, -5, 'rgba(255,255,255,.7)', 2); break;
    case 'cup': drawItemGlyph(ctx, 'coffee'); break;
    case 'brain':
      for (const p of [[-7, -3, 9, 9], [7, -3, 9, 9], [-6, 6, 8, 7], [6, 6, 8, 7]]) ell(ctx, p[0], p[1], p[2], p[3], '#e8a0b0', 2.2);
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.quadraticCurveTo(-3, 0, 1, 12); ctx.lineWidth = 1.8; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, -2); ctx.quadraticCurveTo(-8, 2, -4, -2); ctx.moveTo(12, 2); ctx.quadraticCurveTo(8, 6, 4, 2); ctx.lineWidth = 1.5; ctx.stroke(); break;
    case 'sun':
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; poly(ctx, [Math.cos(a - 0.14) * 11, Math.sin(a - 0.14) * 11, Math.cos(a) * 18, Math.sin(a) * 18, Math.cos(a + 0.14) * 11, Math.sin(a + 0.14) * 11], '#f2b630', 1.6, 0); }
      ell(ctx, 0, 0, 10, 10, '#f6c940', 2.4); break;
    case 'moon':
      ctx.beginPath(); ctx.arc(0, 0, 14, 0.9, TAU - 0.9); ctx.arc(7, -1, 11, TAU - 1.1, 1.1, true); ctx.closePath(); fs(ctx, '#d3dbf2', 2.4);
      ell(ctx, -6, -3, 2, 2, '#aab4d4', 0); break;
    case 'dusk':
      ctx.save(); ctx.beginPath(); ctx.rect(-20, -20, 40, 30); ctx.clip();
      for (let i = 0; i < 7; i++) { const a = -Math.PI + i / 6 * Math.PI; poly(ctx, [Math.cos(a - 0.16) * 10, 6 + Math.sin(a - 0.16) * 10, Math.cos(a) * 17, 6 + Math.sin(a) * 17, Math.cos(a + 0.16) * 10, 6 + Math.sin(a + 0.16) * 10], '#e0662a', 1.6, 0); }
      ell(ctx, 0, 6, 10, 10, '#e8863a', 2.4); ctx.restore();
      line(ctx, -17, 8, 17, 8, INK, 3); line(ctx, -11, 14, 11, 14, '#7a5a9a', 2.4); break;
    case 'users':
      ell(ctx, 7, -6, 6, 6, '#c9b08a', 2); ctx.beginPath(); ctx.moveTo(-1, 14); ctx.quadraticCurveTo(7, -2, 15, 14); ctx.closePath(); fs(ctx, '#6a7aa0', 2.2);
      ell(ctx, -6, -4, 7, 7, '#e6c8a0', 2.2); ctx.beginPath(); ctx.moveTo(-16, 16); ctx.quadraticCurveTo(-6, -2, 4, 16); ctx.closePath(); fs(ctx, '#b0623e', 2.2); break;
    case 'bolt':
      poly(ctx, [3, -17, -10, 2, -2, 2, -5, 17, 10, -4, 2, -4, 7, -17], '#ffd25a', 2.4, 0); break;
    case 'fire':
      flameShape(ctx, 0, 14, 12, 32, '#e0662a', 2.4); flameShape(ctx, 0, 14, 6.5, 19, '#ffd25a', 0); break;
    case 'hammer':
      ctx.save(); ctx.rotate(0.6); rect(ctx, -2.8, -8, 5.6, 26, '#9a6a3c', 2, 2.2); rect(ctx, -13, -16, 26, 10, '#8f98a2', 2, 2.4); ctx.restore(); break;
    case 'wrench': ctx.save(); ctx.rotate(0.6); drawWrench(ctx); ctx.restore(); break;
    case 'book':
      rect(ctx, -11, -15, 22, 30, '#3f6ea0', 3, 2.4); rect(ctx, -11, -15, 5, 30, '#2c5078', 2, 2);
      rect(ctx, -2, -9, 9, 3, '#e8dfcb', 1, 1.2); rect(ctx, -2, -3, 9, 3, '#e8dfcb', 1, 1.2);
      poly(ctx, [6, 15, 6, 22, 9, 19, 12, 22, 12, 15], '#c9372c', 1.5, 0); break;
    case 'chart':
      line(ctx, -14, -14, -14, 14, INK, 3); line(ctx, -14, 14, 15, 14, INK, 3);
      rect(ctx, -9, 3, 6, 10, '#5a8fb0', 1, 2); rect(ctx, -1, -3, 6, 16, '#7fae5a', 1, 2); rect(ctx, 7, -10, 6, 23, '#e8a23a', 1, 2);
      break;
    case 'cable': drawItemGlyph(ctx, 'cable'); break;
    default: return false;
  }
  return true;
}

// ------------------------------------------------------------- structures --
const UNPOWERED = new Set(['generator', 'whiteboard', 'archlab', 'chaoslab', 'stove', 'chest', 'runbook']);
const TOP = { gateway: -68, cdn: -44, lb: -30, app: -32, cache: -30, queue: -26, db: -34, replica: -34, s3: -30, k8s: -46, generator: -52, lantern: -52, turret: -36, whiteboard: -34, archlab: -46, chaoslab: -54, stove: -34, chest: -26, runbook: -32 };

function setStructState(e, k) {
  S.tier = e.tier || 1;
  S.crashed = !!e.crashed;
  S.rb = !!e.rb;
  let on = e.on !== false;
  if (UNPOWERED.has(k)) on = true;
  S.on = on;
  S.mode = S.crashed ? 3 : !on ? 1 : (k === 'app' && e.bad) ? 2 : 0;
}

function drawGateway(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  rect(ctx, -44, 16, 88, 28, C('#6b665d'), 3);
  for (const sx of [-1, 1]) {
    ctx.save(); ctx.scale(sx, 1);
    rect(ctx, 16, -34, 28, 64, C('#77726a'), 3);
    for (let i = 0; i < 3; i++) rect(ctx, 16 + i * 10, -43, 7, 9, C('#77726a'), 1.5);
    line(ctx, 20, -20, 40, -20, 'rgba(0,0,0,.25)', 1.4); line(ctx, 20, 2, 40, 2, 'rgba(0,0,0,.25)', 1.4); line(ctx, 28, -20, 28, 2, 'rgba(0,0,0,.25)', 1.4);
    ctx.restore();
  }
  rect(ctx, -18, -20, 36, 54, C('#5a564f'), 2);
  // arch
  ctx.beginPath(); ctx.moveTo(-14, 34); ctx.lineTo(-14, -2); ctx.arc(0, -2, 14, Math.PI, TAU); ctx.lineTo(14, 34); ctx.closePath(); fs(ctx, '#17130f', 2.4);
  // portcullis
  const drop = up ? 0.22 : 1;
  ctx.save(); ctx.beginPath(); ctx.moveTo(-14, 34); ctx.lineTo(-14, -2); ctx.arc(0, -2, 14, Math.PI, TAU); ctx.lineTo(14, 34); ctx.closePath(); ctx.clip();
  const y1 = -16 + 50 * drop;
  for (let i = -2; i <= 2; i++) line(ctx, i * 5.6, -16, i * 5.6, y1, C('#8a7a5a'), 2.2);
  line(ctx, -14, y1 - 6, 14, y1 - 6, C('#8a7a5a'), 2.2); line(ctx, -14, -8, 14, -8, C('#8a7a5a'), 2);
  for (let i = -2; i <= 2; i++) poly(ctx, [i * 5.6 - 1.6, y1, i * 5.6, y1 + 5, i * 5.6 + 1.6, y1], C('#8a7a5a'), 1, 0);
  ctx.restore();
  // windows / eyes
  eye(ctx, -30, -18, 5); eye(ctx, 30, -18, 5);
  led(ctx, -30, 8, 2.5, '#58d6e0', 0); led(ctx, 30, 8, 2.5, '#ffb43a', 1);
  // satellite dish
  line(ctx, 0, -20, 0, -34, INK, 5); line(ctx, 0, -20, 0, -34, C('#8d8a82'), 2.4);
  ctx.save(); ctx.translate(0, -36); ctx.rotate(-0.55 + (up ? Math.sin(t * 0.6 + sd) * 0.3 : 0));
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 8, 0, 0.0, Math.PI); ctx.closePath(); fs(ctx, C('#cfcabd'), 2.4);
  line(ctx, 0, 1, 0, -11, INK, 3); ell(ctx, 0, -12, 2.6, 2.6, up ? '#58d6e0' : '#444', 1.4);
  if (up) glow(ctx, 0, -12, 14, '#58d6e0', 0.6);
  ctx.restore();
  // WAF shield
  if (e.waf) {
    const pu = 0.5 + 0.2 * Math.sin(t * 2.5);
    ctx.save(); ctx.globalAlpha = up ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(18, -5); ctx.quadraticCurveTo(19, 18, 0, 30); ctx.quadraticCurveTo(-19, 18, -18, -5); ctx.closePath();
    ctx.fillStyle = 'rgba(88,214,224,' + pu * 0.55 + ')'; ctx.fill(); ctx.lineWidth = 2.6; ctx.stroke();
    ctx.strokeStyle = 'rgba(200,250,255,.8)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 24); ctx.moveTo(-11, 6); ctx.lineTo(11, 6); ctx.stroke(); ctx.strokeStyle = INK;
    ctx.restore();
  }
}

function drawCdn(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  rect(ctx, -16, 14, 32, 10, C('#5d5a55'), 2);
  poly(ctx, [-13, 16, 13, 16, 5, -22, -5, -22], C('#7d828a'), 2.4);
  line(ctx, -9, 6, 9, -2, INK, 2); line(ctx, 9, 6, -9, -2, INK, 2);
  line(ctx, -6, -4, 6, -12, INK, 2); line(ctx, 6, -4, -6, -12, INK, 2);
  line(ctx, 0, -22, 0, -34, INK, 4);
  ctx.save(); ctx.translate(0, -28); ctx.rotate(-0.7 + (up ? Math.sin(t * 0.8 + sd) * 0.35 : 0));
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI); ctx.closePath(); fs(ctx, C('#d0cbbd'), 2.2);
  line(ctx, 0, 1, 0, -8, INK, 2.4); ell(ctx, 0, -9, 2.2, 2.2, up ? '#ff6a4a' : '#444', 1.2);
  ctx.restore();
  led(ctx, 0, -35, 2.8, '#ff5a4a', 0);
  eye(ctx, 0, 18, 3.4);
  if (up) for (let i = 0; i < 3; i++) {
    const ph = (t * 0.7 + i / 3) % 1, r = 8 + ph * 18;
    ctx.globalAlpha = (1 - ph) * 0.8; ctx.strokeStyle = '#58d6e0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(8, -36, r, -1.2, -0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-8, -36, r, Math.PI + 0.2, Math.PI + 1.2); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = INK;
}

function drawLb(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  rect(ctx, -22, 8, 44, 14, C('#6a5d4d'), 3);
  for (let i = -3; i <= 3; i++) rect(ctx, i * 5.4 - 1.6, 12, 3.4, 9, C('#2c241d'), 1, 1.4);
  const rail = (x1, y1, x2, y2) => { line(ctx, x1, y1, x2, y2, INK, 6); line(ctx, x1, y1, x2, y2, C('#bdb8ac'), 2.8); };
  rail(-3, 22, -3, 4); rail(3, 22, 3, 4);
  rail(-3, 4, -17, -14); rail(3, 4, 17, -14);
  rail(-1, 4, -11, -14); rail(1, 4, 11, -14);
  rect(ctx, -6, -2, 12, 9, C('#3d3f46'), 2);
  const algo = e.algo || 'rr';
  const lv = algo === 'rr' ? (up ? Math.sin(t * 1.6 + sd) * 0.55 : 0) : algo === 'lc' ? -0.45 : 0.45;
  line(ctx, 0, 3, lv * 14, -12, INK, 4.4); line(ctx, 0, 3, lv * 14, -12, C('#d9b34a'), 2);
  ell(ctx, lv * 14, -12, 2.6, 2.6, C('#c9372c'), 1.6);
  line(ctx, 17, 14, 17, -10, INK, 5); line(ctx, 17, 14, 17, -10, C('#6b6b70'), 2.2);
  rect(ctx, 11, -24, 12, 15, C('#34353b'), 3);
  const col = algo === 'rr' ? '#58d6e0' : algo === 'lc' ? '#ffb347' : '#c07cff';
  led(ctx, 17, -19, 3.3, col, 0); led(ctx, 17, -13, 2, '#9a9ca2', 2);
  if (e.asg) {
    ell(ctx, -16, -20, 7, 7, C('#2f6f86'), 2);
    ctx.beginPath(); ctx.moveTo(-20, -18); ctx.lineTo(-16, -23); ctx.lineTo(-12, -18); ctx.lineWidth = 2.4; ctx.strokeStyle = up ? '#bff6ff' : '#666'; ctx.stroke(); ctx.strokeStyle = INK;
    line(ctx, -16, -23, -16, -16, up ? '#bff6ff' : '#666', 2);
  }
}

function appShell(ctx, e, eyes) {
  rect(ctx, -15, -24, 30, 46, C('#5a5e68'), 4);
  rect(ctx, -12, -21, 24, 13, C('#3c3f47'), 3);
  if (eyes) { eye(ctx, -6, -14.5, 4.2, e.bad ? '#9be24a' : '#58d6e0'); eye(ctx, 6, -14.5, 4.2, e.bad ? '#9be24a' : '#58d6e0'); }
  for (let i = 0; i < 3; i++) {
    const y = -4 + i * 9;
    rect(ctx, -12, y, 24, 6, C('#2b2d33'), 1.5, 1.6);
    if (eyes) {
      led(ctx, -8.5, y + 3, 1.7, i & 1 ? '#ffb43a' : '#58d6e0', i);
      led(ctx, -4, y + 3, 1.7, '#7ee8a0', i + 3);
    }
    for (let k = 0; k < 3; k++) line(ctx, 3 + k * 3, y + 1.2, 3 + k * 3, y + 4.8, '#14161a', 1.2);
  }
  rect(ctx, -14, 22, 9, 3, C('#2b2d33'), 1, 1.6); rect(ctx, 5, 22, 9, 3, C('#2b2d33'), 1, 1.6);
}
function drawApp(ctx, e) {
  const v = Math.min(3, e.virt | 0);
  for (let i = v; i >= 1; i--) {
    ctx.save(); ctx.globalAlpha = 0.28; ctx.translate(i * 5, -i * 4); ctx.scale(0.94, 0.94);
    appShell(ctx, e, false); ctx.restore();
  }
  appShell(ctx, e, true);
  if (e.cont) {
    rect(ctx, -22, 8, 14, 11, C('#2b8ad6'), 2, 2);
    for (const x of [-20, -16, -12]) line(ctx, x, 10, x, 17, 'rgba(255,255,255,.7)', 1);
    line(ctx, -22, 13, -8, 13, INK, 1);
  }
  if (e.bad && S.on) {
    ctx.fillStyle = '#8fc43a';
    for (const x of [-9, 4]) { ctx.beginPath(); ctx.ellipse(x, -7 + Math.sin(S.t * 2 + x) * 1.5, 2, 4, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
    smoke(ctx, 0, -26, 2, 12, '#8fc43a', 2.5);
  }
}

function drawCache(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  rect(ctx, -6, -24, 12, 8, C('#a0a0a8'), 2);
  rect(ctx, -15, -16, 30, 38, C('#4a4d58'), 6);
  rect(ctx, -12, -13, 24, 32, C('#2b2d36'), 4, 1.6);
  const lvl = 4;
  for (let i = 0; i < lvl; i++) if (up) { const f = Math.sin(t * 4 + i * 1.3 + sd) > -0.3; rect(ctx, 6, 14 - i * 6, 5, 4, f ? '#ffd25a' : '#4a3d1a', 1, 1); }
  if (up) glow(ctx, -1, 2, 26, '#ffc83a', 0.6);
  poly(ctx, [3, -11, -8, 4, -1, 4, -4, 17, 8, -2, 1, -2], up ? '#ffd25a' : '#44413a', 2, 0.3);
  if (up) { ctx.strokeStyle = '#bff6ff'; ctx.lineWidth = 1.6; const q = Math.floor(t * 10); ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(hf(q) * 6 - 6, -29); ctx.lineTo(hf(q + 1) * 6, -33); ctx.stroke(); ctx.strokeStyle = INK; }
}

function drawQueue(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  line(ctx, -24, 0, -18, 0, INK, 10); line(ctx, -24, 0, -18, 0, C('#8a8e96'), 6);
  line(ctx, 18, 0, 24, 0, INK, 10); line(ctx, 18, 0, 24, 0, C('#8a8e96'), 6);
  rect(ctx, -19, 2, 38, 14, C('#4c4f57'), 4);
  rect(ctx, -19, -2, 38, 7, C('#2e3036'), 3);
  for (let i = 0; i < 5; i++) ell(ctx, -15 + i * 7.5, 13, 3.4, 3.4, C('#9a9ca2'), 1.6);
  ctx.save(); ctx.beginPath(); ctx.rect(-20, -20, 40, 40); ctx.clip();
  const off = up ? (t * 14) % 14 : 0;
  for (let i = -1; i < 4; i++) {
    const x = -17 + i * 14 + off;
    const hue = ['#d9a23a', '#58b6d0', '#c0623a'][(i + 3) % 3];
    rect(ctx, x, -11, 10, 9, C(hue), 1.5, 2);
    line(ctx, x + 5, -11, x + 5, -2, 'rgba(0,0,0,.35)', 1.2);
  }
  ctx.restore();
  for (let i = 0; i < 6; i++) line(ctx, -18 + i * 7 + (up ? (t * 14) % 7 : 0), -1, -16 + i * 7 + (up ? (t * 14) % 7 : 0), 2, 'rgba(0,0,0,.4)', 1.2);
  eye(ctx, 0, -17, 3, '#ffb43a');
  rect(ctx, -22, -22, 4, 6, C('#7a7d86'), 1, 1.6); rect(ctx, 18, -22, 4, 6, C('#7a7d86'), 1, 1.6);
}

function cylinder(ctx, cx, yb, rx, h, base, top) {
  ctx.beginPath(); ctx.moveTo(cx - rx, yb - h); ctx.lineTo(cx - rx, yb); ctx.ellipse(cx, yb, rx, 5.4, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, yb - h); ctx.closePath(); fs(ctx, base, 2.4);
  ctx.beginPath(); ctx.ellipse(cx, yb - h, rx, 5.4, 0, 0, TAU); fs(ctx, top, 2.2);
}
function dbBody(ctx, e, repl) {
  const t = S.t, up = S.on && !S.crashed;
  const n = repl ? 2 : clamp(e.shards | 0 || 1, 1, 4);
  const dh = n === 1 ? 34 : (42 - 5) / n;
  const base = repl ? C('#6f7a96') : C('#6e6a78'), top = repl ? C('#98a3c2') : C('#8f8aa2');
  if (repl) ctx.setLineDash([4, 3]);
  for (let i = 0; i < n; i++) {
    const yb = 20 - i * dh;
    cylinder(ctx, -2, yb, 16, dh - 2, base, top);
    const mid = yb - (dh - 2) / 2 + 2;
    led(ctx, -11, mid, 1.8, '#58d6e0', i); led(ctx, -6.5, mid, 1.8, '#7ee8a0', i + 2);
    line(ctx, 1, mid - 1, 11, mid - 1, 'rgba(0,0,0,.4)', 1.4); line(ctx, 1, mid + 2, 8, mid + 2, 'rgba(0,0,0,.4)', 1.4);
  }
  const ty = 20 - (n - 1) * dh - (dh - 2);
  eye(ctx, -2, ty, 3.6, '#58d6e0');
  ctx.setLineDash(NODASH);
  if (e.leader) {
    poly(ctx, [-9, ty - 6, -10, ty - 15, -5, ty - 10, -2, ty - 17, 1, ty - 10, 6, ty - 15, 5, ty - 6], up ? '#e8b43a' : '#7a6a3a', 2.2, 0.3);
    if (up) glow(ctx, -2, ty - 12, 14, '#ffd25a', 0.4);
  }
  if (!repl) {
    const d = clamp(e.disk || 0, 0, 1);
    rect(ctx, 18, -22, 5, 40, '#1d1b1e', 1.5, 1.8);
    if (d > 0.01) rect(ctx, 18.6, 18 - 38 * d, 3.8, 38 * d, d > 0.85 ? '#d4453a' : d > 0.6 ? '#e8a23a' : '#6fb37a', 1, 0);
  } else {
    ctx.strokeStyle = '#bcd0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(19, -18, 5, t * 3, t * 3 + 4.4); ctx.stroke(); ctx.strokeStyle = INK;
  }
}
function drawDb(ctx, e) { dbBody(ctx, e, false); }
function drawReplica(ctx, e) { ctx.save(); ctx.globalAlpha *= 0.62; dbBody(ctx, e, true); ctx.restore(); }

function drawGenerator(ctx, e) {
  const t = S.t;
  const f = e.mf ? clamp((e.fuel || 0) / e.mf, 0, 1) : (e.fuel === undefined ? 1 : e.fuel > 0 ? 1 : 0);
  const lit = f > 0.005 && !e.crashed;
  rect(ctx, -21, 17, 42, 7, '#3b3834', 2);
  rect(ctx, 5, -34, 11, 30, '#58524b', 2); rect(ctx, 3, -39, 15, 6, '#6b655d', 2);
  rect(ctx, -19, -8, 38, 27, '#7a4a36', 7);
  line(ctx, -18, 1, 18, 1, 'rgba(0,0,0,.3)', 1.6); line(ctx, -18, 10, 18, 10, 'rgba(0,0,0,.3)', 1.6);
  for (const x of [-15, 15]) { ell(ctx, x, -3, 1.4, 1.4, '#c9a06a', 1); ell(ctx, x, 14, 1.4, 1.4, '#c9a06a', 1); }
  ctx.beginPath(); ctx.moveTo(-14, 19); ctx.lineTo(-14, 6); ctx.arc(-4, 6, 10, Math.PI, TAU); ctx.lineTo(6, 19); ctx.closePath(); fs(ctx, '#120d0b', 2.4);
  if (lit) {
    glow(ctx, -4, 8, 22 + 22 * f, '#ff9a3a', 0.35 + 0.5 * f);
    ctx.save(); ctx.beginPath(); ctx.moveTo(-13, 19); ctx.lineTo(-13, 6); ctx.arc(-4, 6, 9, Math.PI, TAU); ctx.lineTo(5, 19); ctx.closePath(); ctx.clip();
    flame(ctx, -4, 19, 0.5 + 1.0 * f); ctx.restore();
  } else { ell(ctx, -6, 16, 4, 2, '#3a2e28', 1.4); ell(ctx, 0, 17, 3, 1.5, '#4a3a30', 1.2); }
  ell(ctx, 12, 4, 5.4, 5.4, '#d8d2c2', 2);
  const na = -2.4 + f * 1.9;
  line(ctx, 12, 4, 12 + Math.cos(na) * 4.4, 4 + Math.sin(na) * 4.4, f < 0.2 ? '#d4453a' : INK, 1.8);
  if (lit) smoke(ctx, 10.5, -39, 4, 26, '#8d8a86', 3.4);
  if (e.crashed) smoke(ctx, -6, -8, 3, 20, '#4a4846', 4);
}

function drawLantern(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  if (up) for (let i = 0; i < 3; i++) {
    const ph = (t * 0.55 + i / 3) % 1, r = 12 + ph * 36;
    ctx.globalAlpha = (1 - ph) * 0.75; ctx.strokeStyle = '#58d6e0'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(0, 18, r, r * 0.4, 0, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = INK;
  rect(ctx, -9, 18, 18, 6, C('#3a3a3e'), 2);
  rect(ctx, -3, -14, 6, 34, C('#4c4f57'), 1.5);
  line(ctx, -9, 22, -3, 12, INK, 2.4); line(ctx, 9, 22, 3, 12, INK, 2.4);
  rect(ctx, -13, -42, 26, 28, C('#4b4d55'), 7);
  poly(ctx, [-16, -41, 0, -52, 16, -41], C('#3a3c44'), 2.4);
  if (up) glow(ctx, 0, -28, 42, '#ffb43a', 0.5);
  eye(ctx, 0, -28, 9, '#ffb43a');
  led(ctx, -9, -17, 1.8, '#58d6e0', 0); led(ctx, 9, -17, 1.8, '#58d6e0', 2);
}

function drawTurret(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  for (const x of [-12, 0, 12]) line(ctx, x * 0.7, 6, x * 1.3, 22, INK, 4.4);
  for (const x of [-12, 0, 12]) line(ctx, x * 0.7, 6, x * 1.3, 22, C('#4a4540'), 2);
  ctx.beginPath(); ctx.moveTo(-18, -4); ctx.quadraticCurveTo(-16, 16, 0, 16); ctx.quadraticCurveTo(16, 16, 18, -4); ctx.closePath(); fs(ctx, C('#4a4540'), 2.6);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const bx = -13 + c * 7 + (r & 1) * 3.5, by = -1 + r * 5.4;
    if (bx > 12) continue;
    rect(ctx, bx, by, 6.4, 4.4, C('#8a3a2a'), 1, 1.2);
  }
  ell(ctx, 0, -4, 18, 5, C('#2a2622'), 2.4);
  for (let i = -4; i <= 4; i++) { const x = i * 4.4, tip = Math.abs(i) * 0.9; poly(ctx, [x - 2.6, -5 + (Math.abs(i) > 3 ? 0 : 0), x, -17 - (4 - Math.abs(i)) * 1.6 - 4, x + 2.6, -5], C('#8d9098'), 1.8, 0.3); }
  if (up) {
    glow(ctx, 0, -10, e.fire ? 44 : 30, '#ff8a3a', e.fire ? 0.7 : 0.4);
    flame(ctx, 0, -4, e.fire ? 1.3 : 0.75);
  } else { ell(ctx, 0, -5, 8, 2.4, '#3a3532', 0); }
  if (up && e.fire) {
    const q = Math.floor(t * 20) % 2;
    ctx.fillStyle = '#fff3b0'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + q * 0.3, r = i & 1 ? 6 : 15; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, -26 + Math.sin(a) * r * 0.9); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    sparks(ctx, 0, -28, 22, 5, '#ffd25a');
  }
}

function drawWhiteboard(ctx, e) {
  line(ctx, -14, 2, -19, 23, INK, 5); line(ctx, -14, 2, -19, 23, '#7a5a3a', 2.4);
  line(ctx, 14, 2, 19, 23, INK, 5); line(ctx, 14, 2, 19, 23, '#7a5a3a', 2.4);
  rect(ctx, -22, -28, 44, 32, '#7a5a3a', 3, 2.6);
  rect(ctx, -19, -25, 38, 26, '#ece6d6', 2, 1.6);
  ctx.lineWidth = 1.7; ctx.lineCap = 'round';
  const box = (x, y, w, h, c) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x + J() * .6, y); ctx.lineTo(x + w, y + J() * .6); ctx.lineTo(x + w + J() * .6, y + h); ctx.lineTo(x, y + h + J() * .6); ctx.closePath(); ctx.stroke(); };
  box(-16, -22, 10, 7, '#3a6ea8'); box(5, -22, 10, 7, '#c9372c'); box(-5, -9, 11, 7, '#3f8a5a');
  ctx.strokeStyle = '#2a2a2a'; ctx.beginPath(); ctx.moveTo(-5, -18.5); ctx.lineTo(4, -18.5); ctx.moveTo(2, -20.5); ctx.lineTo(4.4, -18.5); ctx.lineTo(2, -16.5);
  ctx.moveTo(-10, -14.5); ctx.quadraticCurveTo(-10, -11, -6, -8); ctx.moveTo(10, -14.5); ctx.quadraticCurveTo(10, -11, 6, -8); ctx.stroke();
  ctx.strokeStyle = '#d9a23a'; ctx.beginPath(); ctx.moveTo(-17, -3); ctx.lineTo(-12, -4); ctx.lineTo(-9, -2); ctx.lineTo(-4, -4); ctx.stroke(); ctx.strokeStyle = INK;
  rect(ctx, -16, 4, 32, 3.4, '#6a4c32', 1, 1.8);
  rect(ctx, -10, 1, 6, 3, '#3a6ea8', 1, 1); rect(ctx, 1, 1, 6, 3, '#c9372c', 1, 1);
}

function drawArchlab(ctx, e) {
  const t = S.t;
  line(ctx, 0, -32, 0, -45, INK, 3);
  poly(ctx, [0, -45, 13, -41 + Math.sin(t * 3 + sd) * 1.6, 0, -37], '#e8a23a', 1.8, 0.2);
  poly(ctx, [-42, 22, 0, -33, 42, 22], '#8c7a58', 2.8);
  poly(ctx, [-21, 22, -4, -22, 0, -33], 'rgba(0,0,0,.14)', 0, 0);
  for (const a of [-26, -12, 12, 26]) line(ctx, a * 0.42, -14 + Math.abs(a) * 0.1, a, 22, 'rgba(0,0,0,.28)', 1.4);
  poly(ctx, [-9, 22, 0, -8, 9, 22], '#17130f', 2.2);
  poly(ctx, [-9, 22, 0, -8, -3, 22], '#b79d6a', 1.6, 0.3);
  poly(ctx, [9, 22, 0, -8, 3, 22], '#a58b5a', 1.6, 0.3);
  eye(ctx, 0, -17, 3.6, '#58d6e0');
  rect(ctx, -37, 5, 22, 15, '#2f5f93', 1.5, 2.2);
  ctx.strokeStyle = 'rgba(220,240,255,.85)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-34, 9); ctx.lineTo(-18, 9); ctx.moveTo(-34, 13); ctx.lineTo(-24, 13); ctx.rect(-30, 10, 5, 5); ctx.arc(-21, 15, 2.4, 0, TAU); ctx.stroke(); ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.moveTo(28, 6); ctx.lineTo(28, 12); ctx.lineTo(23, 21); ctx.lineTo(37, 21); ctx.lineTo(32, 12); ctx.lineTo(32, 6); ctx.closePath(); fs(ctx, '#7fd09a', 2.2);
  rect(ctx, 26, 3, 8, 3, '#d9d2c0', 1, 1.6);
  for (let i = 0; i < 3; i++) { const ph = (t * 0.7 + i / 3) % 1; ctx.globalAlpha = 1 - ph; ell(ctx, 30 + Math.sin(ph * 6 + i) * 2, 1 - ph * 14, 1.8, 1.8, '#bff0cc', 1); }
  ctx.globalAlpha = 1;
}

function drawChaoslab(ctx, e) {
  const t = S.t;
  rect(ctx, -44, 10, 88, 15, '#4a3d57', 3);
  ctx.save(); ctx.beginPath(); ctx.rect(-43, 11, 86, 13); ctx.clip();
  for (let i = -6; i < 8; i++) poly(ctx, [i * 12 - 4, 24, i * 12 + 2, 24, i * 12 + 8, 11, i * 12 + 2, 11], '#e8c23a', 0, 0);
  ctx.restore();
  rect(ctx, -44, 10, 88, 15, null, 3);
  rect(ctx, -36, -8, 22, 18, '#3a3347', 2); rect(ctx, -33, -5, 16, 7, '#17141f', 1, 1.6);
  led(ctx, -31, 6, 1.8, '#c07cff', 0); led(ctx, -26, 6, 1.8, '#58d6e0', 1); led(ctx, -21, 6, 1.8, '#ff5a4a', 2);
  rect(ctx, -5, -20, 10, 32, '#6a5b7a', 2);
  for (let i = 0; i < 4; i++) ell(ctx, 0, -14 + i * 7, 7, 2.4, '#c8773a', 1.8);
  ell(ctx, 0, -26, 14, 5, '#c8773a', 2.4); ell(ctx, 0, -30, 6.4, 6.4, '#d8d0e0', 2.4);
  glow(ctx, 0, -30, 36, '#9a7aff', 0.5);
  const q = Math.floor(t * 14);
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const dir = k === 0 ? -1 : k === 1 ? 1 : (hf(q) > 0.5 ? 1 : -1);
    const len = 22 + hf(q + k * 5) * 20, a0 = -0.6 + hf(q * 3 + k) * 1.1;
    for (const [col, lw] of [['rgba(120,90,255,.9)', 4], ['#e8f6ff', 1.6]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(0, -30);
      let px = 0, py = -30;
      for (let s = 1; s <= 5; s++) { px = dir * (s / 5) * len * Math.cos(a0) + (hf(q * 7 + k * 11 + s) - 0.5) * 7; py = -30 + (s / 5) * len * Math.sin(a0) * 1.2 + (hf(q * 5 + k * 3 + s) - 0.5) * 7 + s * 1.5; ctx.lineTo(px, py); }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = INK;
  ctx.save(); ctx.translate(30, 2); ctx.rotate(0.45); drawWrench(ctx, '#b0b6bd'); ctx.restore();
  poly(ctx, [24, -2, 32, -2, 28, -10], '#e8c23a', 1.8, 0.2); line(ctx, 28, -8, 28, -5, INK, 1.4);
}

function drawS3(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  ctx.beginPath(); ctx.moveTo(-17, -10); ctx.lineTo(-17, 18); ctx.ellipse(0, 18, 17, 6, 0, Math.PI, 0, true); ctx.lineTo(17, -10); ctx.closePath(); fs(ctx, C('#c9532e'), 2.6);
  ctx.beginPath(); ctx.moveTo(-17, 4); ctx.ellipse(0, 4, 17, 6, 0, Math.PI, 0, true); ctx.lineWidth = 1.6; ctx.stroke();
  ell(ctx, 0, -10, 17, 6, C('#7a3320'), 2.6);
  const bob = up ? Math.sin(t * 2 + sd) * 0.8 : 0;
  rect(ctx, -9, -17 + bob, 8, 7, C('#e8c23a'), 1.5, 1.8);
  rect(ctx, 1, -15 - bob, 8, 7, C('#58b6d0'), 1.5, 1.8);
  rect(ctx, -4, -23 + bob * 0.5, 8, 7, C('#7ee8a0'), 1.5, 1.8);
  line(ctx, -2, -20 + bob * 0.5, 2, -20 + bob * 0.5, INK, 1.2);
  line(ctx, -7, -14 + bob, -3, -14 + bob, INK, 1.2);
  rect(ctx, -9, 8, 18, 6, C('#2e3036'), 1.5, 1.6);
  led(ctx, -5, 11, 1.7, '#7ee8a0', 0); led(ctx, 0, 11, 1.7, '#ffb43a', 1);
  if (up) { const ph = (t * 0.6) % 1; ctx.globalAlpha = 1 - ph; rect(ctx, 5 + ph * 8, -24 - ph * 8, 5, 5, '#e8c23a', 1, 1.4); ctx.globalAlpha = 1; }
}

function drawK8s(ctx, e) {
  const t = S.t, up = S.on && !S.crashed;
  const w = e.w || 2, hw = w * 24;
  rect(ctx, -hw + 6, 0, hw * 2 - 12, 24, C('#3a4a6a'), 4);
  rect(ctx, -hw + 10, 4, hw * 2 - 20, 7, C('#1f2a40'), 2, 1.6);
  led(ctx, -hw + 15, 7.5, 1.7, '#7ee8a0', 0); led(ctx, -hw + 21, 7.5, 1.7, '#58d6e0', 1);
  for (let i = 0; i < 4; i++) {
    const x = -hw + 12 + i * ((hw * 2 - 24) / 4);
    rect(ctx, x, 14, 11, 7, C(['#326ce5', '#5b8def', '#326ce5', '#5b8def'][i]), 1.5, 1.6);
  }
  ell(ctx, 0, -17, 20, 20, C('#326ce5'), 2.6);
  ctx.save(); ctx.translate(0, -17); ctx.rotate(up ? t * 0.35 + sd : 0);
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; line(ctx, 0, 0, Math.cos(a) * 17, Math.sin(a) * 17, '#ffffff', 2.2); ell(ctx, Math.cos(a) * 17, Math.sin(a) * 17, 2.6, 2.6, C('#ffffff'), 1.4); }
  ctx.restore();
  ell(ctx, 0, -17, 5, 5, C('#ffffff'), 2);
  if (up) glow(ctx, 0, -17, 30, '#5b8def', 0.35);
}

function drawStove(ctx, e) {
  const t = S.t, cooking = !!e.cooking && !e.done;
  for (const x of [-12, 0, 12]) line(ctx, x * 0.8, 8, x * 1.1, 22, INK, 4.4);
  for (const x of [-12, 0, 12]) line(ctx, x * 0.8, 8, x * 1.1, 22, '#3b3a40', 2);
  glow(ctx, 0, 14, 28, '#ff9a3a', cooking ? 0.55 : 0.3);
  flame(ctx, 0, 21, cooking ? 0.7 : 0.45);
  ell(ctx, -17, -6, 3, 4, '#2a2a30', 2); ell(ctx, 17, -6, 3, 4, '#2a2a30', 2);
  ell(ctx, 0, 2, 17, 14, '#3b3a40', 2.6);
  line(ctx, -9, 6, -5, 12, 'rgba(255,255,255,.25)', 1.6);
  ell(ctx, 0, -9, 17, 5.4, '#2a2a30', 2.6);
  ell(ctx, 0, -9, 14, 3.8, '#d98a3a', 1.6);
  ctx.strokeStyle = '#f6d86a'; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(-9, -9); ctx.quadraticCurveTo(-5, -12, -1, -9); ctx.quadraticCurveTo(3, -6, 8, -9); ctx.stroke(); ctx.strokeStyle = INK;
  line(ctx, 5, -12, 11, -26, INK, 3.6); line(ctx, 5, -12, 11, -26, '#c9a86a', 1.8);
  if (cooking) {
    for (let i = 0; i < 3; i++) { const ph = (t * 1.1 + i / 3) % 1; ctx.globalAlpha = (1 - ph) * 0.85; ell(ctx, -6 + Math.sin(t + i * 2) * 4 + i * 6, -14 - ph * 20, 3 + ph * 4, 3 + ph * 4, '#eeeeee', 1); }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) { const ph = (t * 3 + i * 0.7) % 1; ctx.globalAlpha = 1 - ph; ell(ctx, -6 + i * 6, -9 - ph * 3, 1.6, 1.6, '#ffe9a8', 0); }
    ctx.globalAlpha = 1;
  } else if (!e.done) smoke(ctx, 0, -14, 2, 14, '#d8d8d8', 2);
  if (e.done) {
    const bob = Math.sin(t * 3 + sd) * 2;
    ctx.save(); ctx.translate(0, -26 + bob);
    ctx.beginPath(); ctx.moveTo(-10, -3); ctx.quadraticCurveTo(-9, 8, 0, 8); ctx.quadraticCurveTo(9, 8, 10, -3); ctx.closePath(); fs(ctx, '#7d6a8a', 2.2);
    ell(ctx, 0, -3, 10, 3, '#e2a84a', 1.8);
    glow(ctx, 0, -2, 20, '#ffe27a', 0.6); ctx.restore();
    const ph = (t * 1.5) % 1;
    ctx.fillStyle = '#fff6c0'; ctx.beginPath(); ctx.arc(12, -34 - ph * 4, 1.4 + (1 - ph) * 1.6, 0, TAU); ctx.fill();
  }
}

function drawChest(ctx, e) {
  rect(ctx, -17, -3, 34, 24, '#7b5b3b', 3);
  line(ctx, -17, 7, 17, 7, 'rgba(0,0,0,.25)', 1.4);
  rect(ctx, -11, -3, 5, 24, '#4a4d55', 1, 2); rect(ctx, 6, -3, 5, 24, '#4a4d55', 1, 2);
  ctx.beginPath(); ctx.moveTo(-17, -3); ctx.quadraticCurveTo(0, -27, 17, -3); ctx.closePath(); fs(ctx, '#8a6743', 2.6);
  ctx.beginPath(); ctx.moveTo(-10, -4); ctx.quadraticCurveTo(-9, -15, -7, -17); ctx.moveTo(10, -4); ctx.quadraticCurveTo(9, -15, 7, -17); ctx.lineWidth = 2.4; ctx.strokeStyle = '#4a4d55'; ctx.stroke(); ctx.strokeStyle = INK;
  rect(ctx, -4, -6, 8, 10, '#d0b45a', 2, 2); ell(ctx, 0, -1.5, 1.4, 1.4, INK, 0);
  tube(ctx, 17, 14, 24, 14, 23, 21, '#3aa6c9', 2.4);
}

function drawRunbook(ctx, e) {
  rect(ctx, -19, -27, 38, 50, '#6a4c32', 2, 2.6);
  rect(ctx, -16, -24, 32, 44, '#3a2a1d', 1, 1.6);
  line(ctx, -16, -2, 16, -2, '#6a4c32', 3);
  const cols = ['#a8473a', '#3f6ea0', '#4f8a5a', '#c9a23a', '#7a4f8a', '#2f8aa0'];
  let x = -14;
  for (let i = 0; i < 7; i++) {
    const w = 2.6 + hf(i) * 1.6, h = 13 + hf(i + 9) * 5;
    if (i === 4) { ctx.save(); ctx.translate(x + 4, -4); ctx.rotate(0.28); rect(ctx, -w / 2, -h, w, h, cols[i % 6], 1, 1.6); ctx.restore(); x += 5; continue; }
    rect(ctx, x, -3 - h, w, h, cols[i % 6], 1, 1.6); x += w + 0.8;
  }
  x = -14;
  for (let i = 0; i < 6; i++) { const w = 3 + hf(i + 3) * 2, h = 12 + hf(i + 5) * 6; rect(ctx, x, 19 - h, w, h, cols[(i + 2) % 6], 1, 1.6); x += w + 0.8; }
  rect(ctx, 5, 13, 11, 6, '#e8dfcb', 1, 1.6);
  glow(ctx, 12, -16, 14, '#7ee8a0', 0.35);
  ctx.beginPath(); ctx.moveTo(9, -16); ctx.lineTo(12, -12); ctx.lineTo(17, -20); ctx.lineWidth = 2.6; ctx.strokeStyle = '#7ee8a0'; ctx.stroke(); ctx.strokeStyle = INK;
}

const STRUCT_DRAW = { gateway: drawGateway, cdn: drawCdn, lb: drawLb, app: drawApp, cache: drawCache, queue: drawQueue, db: drawDb, replica: drawReplica, s3: drawS3, k8s: drawK8s, generator: drawGenerator, lantern: drawLantern, turret: drawTurret, whiteboard: drawWhiteboard, archlab: drawArchlab, chaoslab: drawChaoslab, stove: drawStove, chest: drawChest, runbook: drawRunbook };

function structOverlays(ctx, e, k, info) {
  const t = S.t, w = e.w || STRUCTS[k].w, h = e.h || STRUCTS[k].h;
  const hw = w * 24, hh = h * 24, top = TOP[k];
  // tier
  if (S.tier >= 2) {
    const col = S.tier === 2 ? '#c98b4a' : '#e8c24a';
    for (const [x, y] of [[-hw + 3, hh - 3], [hw - 3, hh - 3]]) { ell(ctx, x, y, 2.2, 2.2, col, 1.4); }
    if (STRUCTS[k].comp) {
      rect(ctx, -hw + 7, hh - 5, w * 48 - 14, 3.6, col, 1, 1.6);
      if (S.tier === 3) rect(ctx, -hw + 7, hh - 9, w * 48 - 14, 2.2, S.on && !S.crashed ? '#58d6e0' : '#3a4a4c', 1, 1.2);
    }
    for (let i = 0; i < S.tier; i++) ell(ctx, hw - 4 - i * 6, top + 2, 2.4, 2.4, col, 1.4);
  }
  // damage
  const hp = e.mhp ? e.hp / e.mhp : 1;
  if (hp < 0.66) {
    const n = hp < 0.33 ? 3 : 2;
    ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
    for (let c = 0; c < n; c++) {
      let x = (hf(c + 3) - 0.5) * hw, y = top * 0.45 + hf(c + 8) * 22;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) { x += (hf(c * 9 + s) - 0.5) * 10; y += 4 + hf(c * 4 + s) * 4; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  // crashed
  if (S.crashed) {
    smoke(ctx, 0, top + 6, 4, 26, '#7a7572', 4.5);
    sparks(ctx, (hf(Math.floor(t * 6)) - 0.5) * hw, top * 0.4, 12, 4);
  }
  if (S.rb && !S.crashed) {
    ctx.beginPath(); ctx.arc(0, top - 8, 6, t * 6, t * 6 + 4.2); ctx.strokeStyle = INK; ctx.lineWidth = 5.4; ctx.stroke();
    ctx.strokeStyle = '#58d6e0'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = INK;
  }
  if (info) {
    if (info.util > 1) {
      const p = 0.5 + 0.5 * Math.sin(t * 9);
      glow(ctx, 0, 0, Math.max(hw, hh) * 1.6, '#ff3b2f', 0.25 + 0.4 * p);
    } else if (info.util > 0.85) {
      glow(ctx, 0, 0, Math.max(hw, hh) * 1.4, '#ff9a3a', 0.3 + 0.12 * Math.sin(t * 4));
      smoke(ctx, -hw * 0.3, top + 4, 3, 22, '#e6e6e6', 3);
    }
    if (info.err > 0.2) sparks(ctx, (hf(Math.floor(t * 8)) - 0.5) * hw * 1.2, top * 0.5, 10, 3);
  }
}

function selectRect(ctx, x, y, w, h) {
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2.4; ctx.setLineDash(DASH); ctx.lineDashOffset = -S.t * 12;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.stroke();
  ctx.setLineDash(NODASH); ctx.strokeStyle = INK;
}
function selectEll(ctx, x, y, rx, ry) {
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2.4; ctx.setLineDash(DASH); ctx.lineDashOffset = -S.t * 12;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash(NODASH); ctx.strokeStyle = INK;
}

function drawStruct(ctx, e, k, o) {
  setStructState(e, k);
  const w = e.w || STRUCTS[k].w, h = e.h || STRUCTS[k].h;
  shadow(ctx, 0, h * 24 - 3, w * 21, 8, 0.32);
  STRUCT_DRAW[k](ctx, e);
  structOverlays(ctx, e, k, o && o.info);
  if (o && o.selected) selectRect(ctx, -w * 24 - 3, -h * 24 - 3 + (TOP[k] < -h * 24 ? TOP[k] + h * 24 : 0), w * 48 + 6, h * 48 + 6 - (TOP[k] < -h * 24 ? TOP[k] + h * 24 : 0));
}

// -------------------------------------------------------------- resources --
function blobs(ctx, a, fill) { // gộp các vòng tròn thành 1 hình có viền chung
  ctx.beginPath();
  for (let i = 0; i < a.length; i += 3) { ctx.moveTo(a[i] + a[i + 2], a[i + 1]); ctx.arc(a[i], a[i + 1], a[i + 2], 0, TAU); }
  ctx.lineWidth = 5.4; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill();
}
const CABLE_COLS = ['#7fae5a', '#58d6e0', '#d9b34a', '#c0623a'];
function drawTree(ctx, e) {
  const t = S.t, big = clamp(e.big | 0, 0, 2);
  const sc = [0.72, 0.95, 1.22][big];
  ctx.save(); ctx.translate(0, 19); ctx.scale(sc, sc);
  const lw = 2.6 / sc;
  if (e.ready === false) {
    rect(ctx, -10, -11, 20, 12, '#4b4a50', 2, lw);
    rect(ctx, -10, -12, 20, 3, '#a8845a', 1, lw * 0.7);
    for (let i = 0; i < 2; i++) { line(ctx, -5 + i * 9, -7, -5 + i * 9, -3, '#14161a', 1.4); }
    tube(ctx, -6, -12, -12, -20, -15, -12, '#7fae5a', 2.2); tube(ctx, 5, -12, 10, -22, 14, -15, '#58d6e0', 2.2);
    ell(ctx, 0, -12, 8.4, 2.4, '#b89460', lw * 0.8);
    ctx.restore(); return;
  }
  const sw = Math.sin(t * 0.9 + sd) * 1.6;
  // trunk = rack
  poly(ctx, [-11, 0, 11, 0, 9, -44, -9, -44], '#4b4a50', lw, 0.6);
  for (let i = 0; i < 5; i++) {
    const y = -5 - i * 8;
    rect(ctx, -7.5, y - 5, 15, 5, '#2c2c33', 1, lw * 0.55);
    led(ctx, -4, y - 2.5, 1.4, i & 1 ? '#58d6e0' : '#ffb43a', i);
    led(ctx, 0, y - 2.5, 1.4, '#7ee8a0', i + 2);
  }
  // nhánh = ống cáp
  tube(ctx, -8, -30, -18, -34, -20 + sw, -42, '#4a4350', 3.4); tube(ctx, 8, -26, 18, -32, 20 + sw, -40, '#4a4350', 3.4);
  // tán lá = búi cáp
  ctx.save(); ctx.translate(sw, 0);
  ctx.lineWidth = 5.4;
  blobs(ctx, [0, -58, 17, -14, -49, 11, 14, -49, 12, -7, -70, 11, 8, -68, 10], '#3b5a3c');
  blobs(ctx, [-3, -62, 11, -12, -52, 6, 9, -57, 7], '#4d7347');
  ctx.lineWidth = 1.9;
  for (let i = 0; i < 7; i++) {
    const cx = (hf(i) - 0.5) * 26, cy = -46 - hf(i + 4) * 14;
    ctx.strokeStyle = CABLE_COLS[i & 3];
    ctx.beginPath(); ctx.ellipse(cx, cy, 5 + hf(i + 2) * 5, 3 + hf(i + 7) * 3, hf(i) * 3, 0, TAU * 0.8); ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.restore();
  // cáp thả xuống
  tube(ctx, -9, -44, -16, -36, -15 + sw * 0.5, -22, '#58d6e0', 2.2); ell(ctx, -15 + sw * 0.5, -20, 2.4, 2.4, '#b0b6bd', 1.4);
  tube(ctx, 9, -44, 14, -34, 14 + sw * 0.5, -26, '#d9b34a', 2.2);
  ctx.restore();
}

function polyRock(ctx, big) { // hình khối đá cơ sở
  poly(ctx, big, null, 2.6, 0.9);
}
function drawRock(ctx, e) {
  if (e.ready === false) {
    poly(ctx, [-14, 17, -13, 11, -6, 9, -2, 17], '#4b5461', 2.2); poly(ctx, [2, 17, 5, 10, 12, 10, 14, 17], '#4b5461', 2.2); poly(ctx, [-5, 17, -3, 13, 3, 13, 4, 17], '#5f6a78', 2);
    return;
  }
  poly(ctx, [-19, 18, -21, 0, -11, -15, 3, -20, 17, -11, 21, 6, 15, 18], '#5f6a78', 2.8, 0.9);
  poly(ctx, [-21, 0, -11, -15, 3, -20, -2, -4, -10, 4], '#7d8999', 1.8, 0.5);
  poly(ctx, [-2, -4, 3, -20, 17, -11, 21, 6, 8, 8], '#6b7787', 1.6, 0.5);
  poly(ctx, [-10, 4, -2, -4, 8, 8, 15, 18, -19, 18], '#4a525e', 1.6, 0.5);
  // chip
  rect(ctx, -7, -9, 14, 11, '#2c333c', 1.5, 1.8);
  for (let i = 0; i < 3; i++) { line(ctx, -5 + i * 5, -12, -5 + i * 5, -9, '#c9b25a', 1.6); line(ctx, -5 + i * 5, 2, -5 + i * 5, 5, '#c9b25a', 1.6); }
  ell(ctx, -3, -3.5, 1.5, 1.5, '#58d6e0', 0); line(ctx, 1, -6, 5, -6, '#58d6e0', 1.2);
  line(ctx, -15, 10, -9, 12, 'rgba(255,255,255,.2)', 1.4);
}
function drawVein(ctx, e) {
  const t = S.t, ready = e.ready !== false;
  poly(ctx, [-19, 18, -20, 2, -12, -12, 0, -15, 13, -10, 20, 4, 17, 18], '#3a3d46', 2.8, 0.9);
  poly(ctx, [-20, 2, -12, -12, 0, -15, -3, 0], '#4d515c', 1.6, 0.5);
  const n = ready ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const sx = -10 + i * 7 + (hf(i) - 0.5) * 3, ex = sx + (hf(i + 3) - 0.5) * 12, cx = sx + (i & 1 ? 9 : -9), top = ready ? -19 : -3;
    if (ready) glow(ctx, sx + 2, 0, 14, '#58d6e0', 0.28);
    ctx.beginPath(); ctx.moveTo(sx, 17); ctx.quadraticCurveTo(cx, -1, ex, top);
    ctx.strokeStyle = INK; ctx.lineWidth = 4.4; ctx.stroke();
    ctx.strokeStyle = ready ? (i & 1 ? '#bff6ff' : '#58d6e0') : '#555a62'; ctx.lineWidth = 2; ctx.stroke();
    if (ready) {
      const u = (t * 0.55 + i * 0.27) % 1, x = (1 - u) * (1 - u) * sx + 2 * u * (1 - u) * cx + u * u * ex, y = (1 - u) * (1 - u) * 17 + 2 * u * (1 - u) * -1 + u * u * top;
      ell(ctx, x, y, 1.8, 1.8, '#fff', 0);
    }
  }
  ctx.strokeStyle = INK;
}
function drawCoalseam(ctx, e) {
  const ready = e.ready !== false;
  if (!ready) { poly(ctx, [-18, 18, -16, 11, -4, 9, 8, 11, 18, 18], '#26232b', 2.4, 0.8); line(ctx, -8, 14, 4, 12, '#0b0a0c', 1.4); return; }
  poly(ctx, [-19, 18, -21, 0, -10, -15, 6, -19, 18, -9, 21, 6, 16, 18], '#1f1d22', 2.8, 0.9);
  poly(ctx, [-21, 0, -10, -15, 6, -19, 0, -4, -9, 4], '#38353e', 1.6, 0.5);
  poly(ctx, [6, -19, 18, -9, 21, 6, 10, 2], '#2c2a33', 1.6, 0.5);
  ctx.strokeStyle = '#08070a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-2, -4); ctx.lineTo(-7, 3); ctx.lineTo(-3, 12); ctx.moveTo(8, -8); ctx.lineTo(4, 0); ctx.lineTo(10, 8); ctx.stroke(); ctx.strokeStyle = INK;
  const f = 0.4 + 0.4 * Math.sin(S.t * 2 + sd);
  glow(ctx, -3, 3, 9, '#ff7a2a', 0.25 + f * 0.25);
  ell(ctx, -3, 2, 1.6, 1.6, '#ff8a3a', 0); ell(ctx, 7, 3, 1.3, 1.3, '#ff8a3a', 0);
  line(ctx, -14, -8, -9, -12, 'rgba(255,255,255,.3)', 1.6);
}
function drawBush(ctx, e) {
  const ready = e.ready !== false;
  ctx.lineWidth = 5.4;
  blobs(ctx, ready ? [-9, 8, 9, 8, 8, 9, 0, -2, 11, -2, 12, 7] : [-6, 11, 6, 6, 11, 5, 0, 5, 6], ready ? '#4d6b3a' : '#6e7c4a');
  ctx.lineWidth = 2.4;
  if (!ready) { line(ctx, -4, 8, -9, -2, INK, 2.2); line(ctx, 3, 9, 8, -1, INK, 2.2); return; }
  line(ctx, -8, 5, -3, 2, '#6a8a4a', 1.5); line(ctx, 4, -2, 9, 1, '#6a8a4a', 1.5);
  for (const p of [[-9, 6], [6, 6], [0, -3], [10, 10], [-3, 12], [-13, 11]]) {
    ell(ctx, p[0], p[1], 3.2, 2.6, '#c0392b', 1.6); ell(ctx, p[0] - 0.8, p[1] - 0.8, 0.9, 0.7, '#ff8a7a', 0);
  }
}
function drawTuft(ctx, e) {
  const ready = e.ready !== false, sw = Math.sin(S.t * 1.3 + sd) * 1.6;
  const n = ready ? 6 : 2;
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1 || 1) - 0.5) * 1.8, len = ready ? 14 + hf(i) * 8 : 6 + hf(i) * 2;
    const x = Math.sin(a) * len + sw * (len / 20), y = 17 - Math.cos(a) * len;
    tube(ctx, 0, 18, Math.sin(a) * len * 0.3, 14 - len * 0.5, x, y, CABLE_COLS[i & 3], 2.2);
    if (ready) ell(ctx, x, y, 2, 2, '#b0b6bd', 1.4);
  }
  ell(ctx, 0, 18, 5, 2, '#4d4a40', 1.6);
}
function drawSapling(ctx, e) {
  const ready = e.ready !== false;
  tube(ctx, 0, 19, -2, 6, 1, ready ? -14 : -7, '#6e5a3c', 2.6);
  tube(ctx, 0, 8, -6, 2, -10, -3, '#6e5a3c', 2); tube(ctx, 0.5, 0, 6, -4, 10, -8, '#6e5a3c', 2);
  if (ready) {
    rect(ctx, -14, -7, 7, 5, '#9a9ca2', 1, 1.6); rect(ctx, 8, -12, 7, 5, '#3f7a4a', 1, 1.6);
    rect(ctx, -3, -19, 6, 6, '#c8773a', 1, 1.6);
    line(ctx, 8, -12, 12, -12, '#d9b34a', 1.4);
  }
}
function drawMush(ctx, e) {
  const ready = e.ready !== false, t = S.t;
  if (!ready) { ell(ctx, -4, 17, 5, 3, '#4a4350', 2); ell(ctx, 6, 18, 4, 2.4, '#4a4350', 2); return; }
  glow(ctx, 0, 6, 30, '#7ee8d0', 0.35 + 0.15 * Math.sin(t * 2 + sd));
  for (const [x, y, s] of [[-6, 17, 1], [7, 18, 0.7]]) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    rect(ctx, -3.4, -12, 7, 12, '#d8d0bd', 3, 2.4 / s);
    ctx.beginPath(); ctx.moveTo(-13, -10); ctx.quadraticCurveTo(-12, -26, 0, -26); ctx.quadraticCurveTo(12, -26, 13, -10); ctx.quadraticCurveTo(0, -6, -13, -10); fs(ctx, '#7a58b0', 2.4 / s);
    ell(ctx, -5, -17, 2.4, 2, '#9af2dc', 0); ell(ctx, 4, -20, 2, 1.8, '#9af2dc', 0); ell(ctx, 7, -14, 1.6, 1.4, '#9af2dc', 0);
    ctx.restore();
  }
}
function drawShard(ctx, e) {
  if (e.ready === false) { poly(ctx, [-4, 18, -2, 14, 3, 14, 5, 18], '#4b5461', 2, 0.4); return; }
  glow(ctx, 0, 4, 22, '#7ec4d8', 0.35);
  ctx.save(); ctx.translate(0, 2); ctx.scale(0.62, 0.62);
  crystal(ctx, '#8fb4c8', '#c4e4f0', '#4f7488');
  ctx.save(); ctx.translate(-14, 10); ctx.scale(0.5, 0.5); crystal(ctx, '#8fb4c8', '#c4e4f0', '#4f7488'); ctx.restore();
  ctx.restore();
}
const RES_DRAW = { tree: drawTree, rock: drawRock, vein: drawVein, coalseam: drawCoalseam, bush: drawBush, tuft: drawTuft, sapling: drawSapling, mush: drawMush, shard: drawShard };
const RES_SEL = { tree: [-20, -58, 40, 80], rock: [-23, -22, 46, 42], vein: [-23, -18, 46, 38], coalseam: [-23, -22, 46, 42], bush: [-17, -6, 34, 28], tuft: [-14, -6, 28, 28], sapling: [-14, -22, 28, 44], mush: [-14, -10, 28, 30], shard: [-12, -4, 24, 24] };

function drawResource(ctx, e, k, o) {
  S.mode = 0; S.crashed = false; S.on = true;
  const solid = RESOURCES[k].solid;
  const big = k === 'tree' ? clamp(e.big | 0, 0, 2) : 1;
  shadow(ctx, 0, 19, k === 'tree' ? 14 + big * 4 : solid ? 21 : 14, solid ? 7 : 5, 0.3);
  RES_DRAW[k](ctx, e);
  if (o && o.selected) {
    if (k === 'tree') { const sc = [0.72, 0.95, 1.22][big]; selectRect(ctx, -24 * sc, 19 - 84 * sc, 48 * sc, 84 * sc + 8); }
    else { const r = RES_SEL[k]; selectRect(ctx, r[0], r[1], r[2], r[3]); }
  }
}

// ----------------------------------------------------------------- player ---
function drawPlayer(ctx, e, o) {
  const t = S.t, fx = e.fx < 0 ? -1 : 1;
  S.mode = 0; S.on = true; S.crashed = false;
  if (e.ghost) { drawGhostPlayer(ctx, e, o, fx); return; }
  const act = e.act, walk = act === 'walk', work = act === 'work' || act === 'attack';
  const ph = t * 12 + sd;
  const bob = walk ? -Math.abs(Math.sin(ph)) * 2.4 : Math.sin(t * 2 + sd) * -0.7;
  const hue = (e.hue | 0) % 360;
  const hood = 'hsl(' + hue + ',38%,46%)', hoodD = 'hsl(' + hue + ',38%,34%)';
  shadow(ctx, 0, 17, 12, 4.4, 0.32);
  if (o && o.me) { ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.ellipse(0, 17, 17, 6.4, 0, 0, TAU); ctx.stroke(); ctx.strokeStyle = INK; }
  if (o && o.selected) selectEll(ctx, 0, 17, 19, 7);
  ctx.save(); ctx.scale(fx, 1);
  // chân
  const lg = walk ? Math.sin(ph) * 4 : 0;
  rect(ctx, -6 + lg, 9, 5.4, 8, '#3a3548', 2, 2.2);
  rect(ctx, 1 - lg, 9, 5.4, 8, '#3a3548', 2, 2.2);
  rect(ctx, -7 + lg, 15, 8, 3.4, '#2a2420', 1.6, 2); rect(ctx, 0 - lg, 15, 8, 3.4, '#2a2420', 1.6, 2);
  ctx.save(); ctx.translate(0, bob);
  // mũ hoodie (sau đầu) + thân
  ell(ctx, -1, -10, 10.5, 10, hoodD, 2.4);
  rect(ctx, -9, -3, 18, 15, hood, 6, 2.6);
  line(ctx, -2, -2, -2, 4, 'rgba(240,240,240,.8)', 1.2); line(ctx, 2, -2, 2, 4, 'rgba(240,240,240,.8)', 1.2);
  if (!(e.eq && e.eq.body)) rect(ctx, -5, 6, 10, 5, hoodD, 2, 1.6);
  if (e.eq && e.eq.body) {
    poly(ctx, [-8, -3, -3, -3, -1, 2, 1, -3, 6, -3, 9, 12, -9, 12], '#e08a2a', 2.2, 0.4);
    line(ctx, -8, 7, 9, 7, '#f6e7a8', 2.4); rect(ctx, 2, 0, 5, 4, '#b86a1e', 1, 1.4);
  }
  // đầu
  ell(ctx, 1, -11, 8.4, 8.2, '#e6c8a0', 2.4);
  ctx.beginPath(); ctx.arc(1, -13, 8.6, Math.PI * 1.05, Math.PI * 1.95); ctx.lineWidth = 3.4; ctx.strokeStyle = hoodD; ctx.stroke(); ctx.strokeStyle = INK;
  const blink = (t * 0.7 + sd) % 3 < 0.12;
  if (!blink) { ell(ctx, 3.6, -11, 1.5, 1.8, INK, 0); ell(ctx, 8, -11, 1.5, 1.8, INK, 0); } else { line(ctx, 2.4, -11, 5, -11, INK, 1.4); line(ctx, 6.8, -11, 9.4, -11, INK, 1.4); }
  ctx.beginPath(); ctx.arc(5.8, -11, 3.2, 0, TAU); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.arc(5.8, -7, 2, 0.2, Math.PI - 0.2); ctx.lineWidth = 1.3; ctx.stroke();
  ctx.restore();
  // tay + công cụ
  const tool = e.eq && e.eq.hand && e.eq.hand.i;
  let ang = 0.45, hx = 9, hy = 3 + bob;
  if (work) { const s = Math.sin(t * 13 + sd); ang = 0.15 + s * 1.05; hx = 9 + Math.max(0, s) * 4; hy = 1 + bob + s * 1.5; }
  else if (walk) hy += Math.sin(ph + Math.PI) * 1.6;
  if (act === 'eat') { hx = 8; hy = -6 + bob + Math.sin(t * 10) * 1.4; ang = 0.2; }
  line(ctx, 4, 0 + bob, hx, hy, INK, 6.4); line(ctx, 4, 0 + bob, hx, hy, hood, 3.4);
  if (tool && ITEMS[tool] && act !== 'eat') {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang); drawTool(ctx, tool); ctx.restore();
  }
  ell(ctx, hx, hy, 2.8, 2.8, '#e6c8a0', 1.8);
  if (e.lit && !(tool === 'torch')) glow(ctx, 0, 0, 40, '#ffb43a', 0.3);
  if (tool === 'torch' || e.lit) glow(ctx, 0, 0, 46, '#ffb43a', 0.22);
  ctx.restore();
}
function drawGhostPlayer(ctx, e, o, fx) {
  const t = S.t, hue = (e.hue | 0) % 360;
  const fy = Math.sin(t * 2.2 + sd) * 3 - 6;
  shadow(ctx, 0, 18, 9, 3, 0.12);
  if (o && o.me) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, 18, 14, 5, 0, 0, TAU); ctx.stroke(); ctx.strokeStyle = INK; }
  if (o && o.selected) selectEll(ctx, 0, 18, 18, 6);
  ctx.save(); ctx.translate(0, fy); ctx.scale(fx, 1);
  ctx.globalAlpha = 0.5;
  glow(ctx, 0, 0, 34, '#bfe8ff', 0.5);
  ctx.beginPath(); ctx.moveTo(-10, 14);
  for (let i = 0; i <= 5; i++) ctx.lineTo(-10 + i * 4, 14 + (i & 1 ? 5 : -1) + Math.sin(t * 5 + i) * 1.6);
  ctx.lineTo(10, -6); ctx.bezierCurveTo(10, -22, -10, -22, -10, -6); ctx.closePath();
  ctx.fillStyle = 'hsl(' + hue + ',40%,82%)'; ctx.fill(); ctx.strokeStyle = 'rgba(21,17,13,.7)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#15110d';
  ctx.beginPath(); ctx.ellipse(-2, -9, 2.2, 3.2, 0, 0, TAU); ctx.ellipse(5, -9, 2.2, 3.2, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(1.5, -2, 2, 2.6, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ mobs ----
function mobBar(ctx, e, y) {
  if (!(e.mhp && e.hp < e.mhp)) return;
  const f = clamp(e.hp / e.mhp, 0, 1);
  ctx.fillStyle = '#15110d'; ctx.fillRect(-13, y, 26, 5);
  ctx.fillStyle = '#d4453a'; ctx.fillRect(-12, y + 1, 24 * f, 3);
}
function drawGremlin(ctx, e) {
  const t = S.t, fx = e.fx < 0 ? -1 : 1, ph = t * 14 + sd;
  shadow(ctx, 0, 14, 13, 4.4, 0.3);
  ctx.save(); ctx.scale(fx, 1); ctx.translate(0, Math.abs(Math.sin(ph)) * -1.5);
  for (let i = 0; i < 3; i++) {
    const lx = -8 + i * 8, sw = Math.sin(ph + i * 2) * 2.5;
    line(ctx, lx, 8, lx + sw - 3, 14, INK, 4.4); line(ctx, lx, 8, lx + sw - 3, 14, '#3a3340', 2);
  }
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + i / 8 * Math.PI, bx = Math.cos(a) * 11, by = Math.sin(a) * 9 + 2, tl = 17 + (i & 1 ? 0 : 3);
    poly(ctx, [Math.cos(a - 0.2) * 10, Math.sin(a - 0.2) * 8 + 2, Math.cos(a) * tl, Math.sin(a) * tl * 0.85 + 2, Math.cos(a + 0.2) * 10, Math.sin(a + 0.2) * 8 + 2], '#2a2530', 2, 0.3);
  }
  ell(ctx, 0, 2, 12, 10, '#2e2835', 2.6);
  ell(ctx, 0, 6, 8, 4, '#3a3342', 0);
  for (const x of [-4.5, 4.5]) { glow(ctx, x, -2, 10, '#ff3a2a', 0.7); ell(ctx, x, -2, 3.2, 3.2, '#e8372a', 1.6); line(ctx, x, -4, x, 0.4, INK, 1.4); }
  line(ctx, -8, -6, -2, -4, INK, 2); line(ctx, 8, -6, 2, -4, INK, 2);
  poly(ctx, [-5, 5, -3, 8, -1, 5, 1, 8, 3, 5, 5, 8, 5, 5], '#e8e2d0', 1.2, 0.2);
  ctx.restore();
  mobBar(ctx, e, -30);
}
function drawBot(ctx, e) {
  const t = S.t, fx = e.fx < 0 ? -1 : 1, ph = t * 10 + sd;
  shadow(ctx, 0, 15, 12, 4, 0.3);
  ctx.save(); ctx.scale(fx, 1); ctx.rotate(Math.sin(ph) * 0.05); ctx.translate(0, Math.abs(Math.sin(ph)) * -1.2);
  ell(ctx, -6, 13, 3.6, 3.6, '#2a2a30', 2); ell(ctx, 6, 13, 3.6, 3.6, '#2a2a30', 2);
  rect(ctx, -10, -4, 20, 16, '#6b7380', 3);
  line(ctx, -6, 4, 6, 4, 'rgba(0,0,0,.35)', 1.4); line(ctx, -6, 8, 6, 8, 'rgba(0,0,0,.35)', 1.4);
  rect(ctx, -16, -2, 6, 10, '#4a4f5a', 2, 2); rect(ctx, 10, -2, 6, 10, '#4a4f5a', 2, 2);
  poly(ctx, [-17, 8, -14, 12, -12, 8], '#8d9098', 1.4, 0); poly(ctx, [17, 8, 14, 12, 12, 8], '#8d9098', 1.4, 0);
  rect(ctx, -9, -17, 18, 13, '#8a919c', 3);
  rect(ctx, -7, -14, 14, 7, '#1a1c22', 2, 1.6);
  glow(ctx, 0, -10.5, 12, '#ff2a1a', 0.7);
  ell(ctx, 0, -10.5, 3.2, 3.2, '#ff3a2a', 1.2);
  poly(ctx, [-8, -16, 8, -11.6, 8, -14.6, -8, -19], '#8a919c', 1.8, 0);
  line(ctx, 0, -17, 0, -25, INK, 2.4);
  const bl = Math.sin(t * 8 + sd) > 0;
  ell(ctx, 0, -26, 2.6, 2.6, bl ? '#ff4a3a' : '#5a1a14', 1.6);
  if (bl) glow(ctx, 0, -26, 10, '#ff4a3a', 0.6);
  ctx.restore();
  mobBar(ctx, e, -38);
}
function drawPhantom(ctx, e) {
  const t = S.t, fx = e.fx < 0 ? -1 : 1;
  const fl = 0.62 + 0.14 * Math.sin(t * 5 + sd);
  shadow(ctx, 0, 17, 10, 3.4, 0.14);
  ctx.save(); ctx.scale(fx, 1); ctx.translate(0, Math.sin(t * 2.4 + sd) * 3 - 3);
  for (let k = 2; k >= 0; k--) {
    const ox = -k * 6, ys = 1 - k * 0.12;
    ctx.globalAlpha = fl * (k === 0 ? 1 : 0.35 / k);
    ctx.beginPath(); ctx.moveTo(-12 + ox, 14);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-12 + ox + i * 4, 14 + (i & 1 ? 6 : -1) + Math.sin(t * 6 + i + k) * 2);
    ctx.lineTo(12 + ox, -4); ctx.bezierCurveTo(14 + ox, -26 * ys, -14 + ox, -26 * ys, -12 + ox, -4); ctx.closePath();
    ctx.fillStyle = k === 0 ? '#2a1640' : '#4a2a6a'; ctx.fill();
    if (k === 0) { ctx.strokeStyle = 'rgba(10,4,20,.9)'; ctx.lineWidth = 2.4; ctx.stroke(); }
  }
  ctx.globalAlpha = 1; ctx.strokeStyle = INK;
  glow(ctx, 0, -6, 20, '#ffd23a', 0.35);
  poly(ctx, [0, -15, 9, 2, -9, 2], '#f2cf3a', 1.8, 0.2);
  line(ctx, 0, -9, 0, -3, INK, 2); ell(ctx, 0, 0, 1.1, 1.1, INK, 0);
  ctx.restore();
  mobBar(ctx, e, -34);
}

// ------------------------------------------------------------------ items ---
function drawItemEnt(ctx, e, o) {
  const t = S.t;
  const bob = Math.sin(t * 3 + sd) * 2.4;
  shadow(ctx, 0, 11, 9 - bob * 0.3, 3 - bob * 0.1, 0.32);
  const c = iconCanvas(e.item, 32);
  if (o && o.selected) selectEll(ctx, 0, 11, 14, 5);
  if ((e.n | 0) > 1) ctx.drawImage(c, -12, -17 + bob * 0.6, 24, 24);
  ctx.drawImage(c, -15, -19 + bob, 30, 30);
}

// ------------------------------------------------------------ public API ----
export function zOf(e) {
  const y = e.ry ?? e.y;
  const st = STRUCTS[e.k];
  if (st) return y + (e.h || st.h) * 24;
  if (RESOURCES[e.k]) return y + 19;
  if (e.k === 'item') return y + 8;
  return y + 17;
}

export function drawEntity(ctx, e, o) {
  o = o || {};
  const x = e.rx ?? e.x, y = e.ry ?? e.y, k = e.k;
  if (k === 'app' && e.bad && !o.info) e = { ...e, bad: false }; // bản lỗi (kể cả canary) chỉ lộ ra khi App nằm trong vùng giám sát
  S.t = o.t || 0;
  S.gk = 0.75 + 0.6 * (o.dark || 0);
  sd = seedOf(e.id === undefined ? 1 : e.id);
  wi = 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  if (STRUCT_DRAW[k]) drawStruct(ctx, e, k, o);
  else if (RES_DRAW[k]) drawResource(ctx, e, k, o);
  else if (k === 'player') drawPlayer(ctx, e, o);
  else if (k === 'gremlin') { S.mode = 0; drawGremlin(ctx, e); if (o.selected) selectEll(ctx, 0, 14, 17, 6); }
  else if (k === 'bot') { S.mode = 0; drawBot(ctx, e); if (o.selected) selectEll(ctx, 0, 15, 16, 6); }
  else if (k === 'phantom') { S.mode = 0; drawPhantom(ctx, e); if (o.selected) selectEll(ctx, 0, 17, 15, 6); }
  else if (k === 'item') { S.mode = 0; drawItemEnt(ctx, e, o); }
  else { rect(ctx, -10, -10, 20, 20, '#6a6a70', 3); line(ctx, -4, -4, 4, 4, '#d4453a', 2); line(ctx, 4, -4, -4, 4, '#d4453a', 2); }
  ctx.restore();
}

// ---- icons ----
const iconCache = new Map(), urlCache = new Map();
function iconBox(key) { // [x0,y0,x1,y1] vùng vẽ để fit vào icon
  const st = STRUCTS[key];
  if (st) { const hw = st.w * 24 + 3, hh = st.h * 24 + 3; return [-hw, TOP[key] - 3, hw, hh]; }
  if (RESOURCES[key]) return key === 'tree' ? [-26, -62, 26, 22] : [-23, -24, 23, 24];
  return [-20, -20, 20, 20];
}
export function iconCanvas(key, size) {
  size = size || 40;
  const ck = key + '|' + size;
  let c = iconCache.get(ck);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const savedT = S.t, savedG = S.gk, sSd = sd, sWi = wi;
  S.t = 1.3; S.gk = 1; sd = seedOf(key); wi = 0;
  g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = INK; g.lineWidth = 2.5;
  g.save();
  g.translate(size / 2, size / 2);
  S.mode = 0; S.on = true; S.crashed = false; S.rb = false;
  if (STRUCTS[key] || RESOURCES[key]) {
    const b = iconBox(key), w = b[2] - b[0], h = b[3] - b[1];
    const sc = Math.min((size - 2) / w, (size - 2) / h);
    g.scale(sc, sc);
    g.translate(-(b[0] + b[2]) / 2, -(b[1] + b[3]) / 2);
    const e = { id: key, k: key, w: STRUCTS[key] && STRUCTS[key].w, h: STRUCTS[key] && STRUCTS[key].h, on: true, hp: 1, mhp: 1, tier: 1, fuel: 80, mf: 100, shards: 2, leader: true, disk: 0.35, ready: true, big: 1, algo: 'rr', asg: true, waf: true, cooking: null, done: false };
    if (STRUCTS[key]) { setStructState(e, key); STRUCT_DRAW[key](g, e); } else RES_DRAW[key](g, e);
  } else {
    g.scale(size / 40, size / 40);
    if (!drawHud(g, key)) drawItemGlyph(g, key);
  }
  g.restore();
  S.t = savedT; S.gk = savedG; sd = sSd; wi = sWi;
  iconCache.set(ck, c);
  return c;
}
export function iconURL(key, size = 40) {
  const ck = key + '|' + size;
  let u = urlCache.get(ck);
  if (!u) { u = iconCanvas(key, size).toDataURL(); urlCache.set(ck, u); }
  return u;
}

// ---- user crowd ----
const SKIN = ['#e6c8a0', '#c99a6e', '#8a5a3a', '#f0d4b0'];
export function drawUser(ctx, x, y, t, seed, mood) {
  const s = seed || 0;
  const m = clamp(mood === undefined ? 1 : mood, 0, 1);
  const ph = t * 9 + s * 1.7, bob = -Math.abs(Math.sin(ph)) * 1.4, sw = Math.sin(ph) * 2.2;
  const hue = (s * 47) % 360, sat = 20 + m * 18;
  const angry = m < 0.35;
  ctx.save(); ctx.translate(x, y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 10, 5, 1.8, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-2 + sw * 0.6, 9); ctx.moveTo(2, 3); ctx.lineTo(2 - sw * 0.6, 9); ctx.stroke();
  ctx.lineWidth = 1.2; ctx.strokeStyle = '#3a3548'; ctx.stroke(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.fillStyle = angry ? '#c0463a' : 'hsl(' + hue + ',' + sat + '%,50%)';
  ctx.beginPath(); ctx.roundRect(-4, -4 + bob, 8, 9, 2.4); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-4, -2 + bob); ctx.lineTo(-6, 2 + bob + sw * 0.3); ctx.moveTo(4, -2 + bob); ctx.lineTo(6, 2 + bob - sw * 0.3); ctx.stroke();
  ctx.strokeStyle = angry ? '#c0463a' : 'hsl(' + hue + ',' + sat + '%,50%)'; ctx.lineWidth = 1.1; ctx.stroke(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.fillStyle = angry ? '#e8a08a' : SKIN[s & 3];
  ctx.beginPath(); ctx.arc(0, -8 + bob, 4.4, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; ctx.fillRect(-2.4, -9 + bob, 1.2, 1.4); ctx.fillRect(1.2, -9 + bob, 1.2, 1.4);
  ctx.lineWidth = 1; ctx.beginPath();
  if (m > 0.6) ctx.arc(0, -7 + bob, 1.8, 0.3, Math.PI - 0.3); else if (m < 0.4) ctx.arc(0, -4.6 + bob, 1.8, Math.PI + 0.4, TAU - 0.4); else { ctx.moveTo(-1.5, -5.6 + bob); ctx.lineTo(1.5, -5.6 + bob); }
  ctx.stroke();
  if (angry) {
    ctx.strokeStyle = '#d4301f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -20 + bob); ctx.lineTo(0, -15 + bob); ctx.stroke();
    ctx.fillStyle = '#d4301f'; ctx.beginPath(); ctx.arc(0, -12.2 + bob, 1.1, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3.4, -11 + bob); ctx.lineTo(-0.6, -9.8 + bob); ctx.moveTo(3.4, -11 + bob); ctx.lineTo(0.6, -9.8 + bob); ctx.stroke();
  }
  ctx.restore();
}

// ---- placement ghost ----
export function drawGhost(ctx, kind, x, y, valid, w = 1, h = 1) {
  const st = STRUCTS[kind];
  if (!st) return;
  const e = { id: kind, k: kind, w, h, on: true, hp: 1, mhp: 1, tier: 1, fuel: 60, mf: 100, shards: 2, leader: true, algo: 'rr' };
  const savedT = S.t, sSd = sd, sWi = wi;
  S.t = performance.now() / 1000; S.gk = 1; sd = seedOf(kind); wi = 0;
  setStructState(e, kind);
  ctx.save(); ctx.translate(x, y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  const col = valid ? '110,230,130' : '240,70,60';
  ctx.fillStyle = 'rgba(' + col + ',.22)'; ctx.beginPath(); ctx.roundRect(-w * 24, -h * 24, w * 48, h * 48, 8); ctx.fill();
  ctx.globalAlpha = 0.6;
  STRUCT_DRAW[kind](ctx, e);
  ctx.globalAlpha = 0.14; ctx.fillStyle = 'rgba(' + col + ',1)';
  ctx.beginPath(); ctx.roundRect(-w * 24, -h * 24, w * 48, h * 48, 8); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(' + col + ',.95)'; ctx.lineWidth = 2.4; ctx.setLineDash(DASH); ctx.lineDashOffset = -S.t * 14;
  ctx.beginPath(); ctx.roundRect(-w * 24, -h * 24, w * 48, h * 48, 8); ctx.stroke();
  ctx.setLineDash(NODASH);
  ctx.restore();
  S.t = savedT; sd = sSd; wi = sWi;
}

// ---- fx ----
export function drawFxSpark(ctx, x, y, p, kind) {
  p = clamp(p, 0, 1);
  ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const q = 1 - p;
  if (kind === 'hit') {
    ctx.globalAlpha = q;
    ctx.fillStyle = '#fff6c0'; ctx.beginPath(); ctx.arc(0, 0, 4 + p * 4, 0, TAU); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.2, r1 = 4 + p * 10, r2 = 9 + p * 16;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.strokeStyle = INK; ctx.lineWidth = 5 * q + 2; ctx.stroke(); ctx.strokeStyle = i & 1 ? '#ffd25a' : '#fff'; ctx.lineWidth = 3 * q + 0.8; ctx.stroke();
    }
  } else if (kind === 'poof') {
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.5, d = 4 + p * 14, r = 5 + p * 7 - (i & 1) * 2;
      ctx.globalAlpha = q * 0.9; ctx.fillStyle = '#cfc8b8'; ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(21,17,13,.6)';
      ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d * 0.8 - p * 6, r, 0, TAU); ctx.fill(); ctx.stroke();
    }
  } else if (kind === 'boom') {
    ctx.globalAlpha = q;
    ctx.fillStyle = p < 0.35 ? '#fff3b0' : '#e0662a'; ctx.beginPath(); ctx.arc(0, 0, 8 + p * 26, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#ffb43a'; ctx.beginPath(); ctx.arc(0, 0, (8 + p * 26) * 0.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,120,' + q + ')'; ctx.lineWidth = 3 * q + 1; ctx.beginPath(); ctx.arc(0, 0, 14 + p * 40, 0, TAU); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.3, d = 14 + p * 32; ctx.beginPath(); ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); ctx.lineTo(Math.cos(a) * (d + 6), Math.sin(a) * (d + 6)); ctx.stroke(); }
  } else if (kind === 'heal') {
    for (let i = 0; i < 4; i++) {
      const ph = clamp(p * 1.3 - i * 0.08, 0, 1), px = (i - 1.5) * 8, py = -ph * 26 + 6, s = 4 + (1 - ph) * 1.5;
      ctx.globalAlpha = Math.sin(ph * Math.PI);
      ctx.beginPath(); ctx.moveTo(px - s, py - 1.5); ctx.lineTo(px - 1.5, py - 1.5); ctx.lineTo(px - 1.5, py - s); ctx.lineTo(px + 1.5, py - s); ctx.lineTo(px + 1.5, py - 1.5); ctx.lineTo(px + s, py - 1.5); ctx.lineTo(px + s, py + 1.5); ctx.lineTo(px + 1.5, py + 1.5); ctx.lineTo(px + 1.5, py + s); ctx.lineTo(px - 1.5, py + s); ctx.lineTo(px - 1.5, py + 1.5); ctx.lineTo(px - s, py + 1.5); ctx.closePath();
      ctx.fillStyle = '#6fd08c'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke();
    }
  } else if (kind === 'lightning') {
    const fq = Math.floor(p * 9) + 3;
    ctx.globalAlpha = p < 0.8 ? 1 : (1 - p) * 5;
    for (const [col, lw] of [['rgba(120,90,255,.7)', 7], ['#c8f3ff', 3], ['#fff', 1.4]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(0, -64);
      let px = 0;
      for (let s = 1; s <= 7; s++) { px = Math.sin((fq * 13 + s * 7.3)) * 9 * (1 - s / 9); ctx.lineTo(px, -64 + s * 9); }
      ctx.lineTo(0, 0); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,240,255,.7)'; ctx.beginPath(); ctx.arc(0, 0, 8 + p * 10, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
