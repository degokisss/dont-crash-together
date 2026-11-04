// Renderer canvas: địa hình, thực thể, cáp mạng + gói tin, ánh sáng ban đêm, thời tiết, hiệu ứng.
import { TILE, MAP_W, MAP_H, COMP, STRUCTS, RESOURCES, PWR_R, clockAt } from '/shared/data.js';
import { B } from '/shared/worldgen.js';
import { hash2 } from '/shared/util.js';
import { drawEntity, zOf, drawUser, drawGhost, drawFxSpark } from './art.js';

const BIOME = {
  autumn: { [B.MEADOW]: '#5b6a34', [B.FOREST]: '#3d5a2c', [B.QUARRY]: '#6a645c', [B.SWAMP]: '#394a3c' },
  winter: { [B.MEADOW]: '#b4c3cc', [B.FOREST]: '#8da2a8', [B.QUARRY]: '#9ba2a8', [B.SWAMP]: '#76878a' },
  spring: { [B.MEADOW]: '#5e9042', [B.FOREST]: '#33683a', [B.QUARRY]: '#6c6a62', [B.SWAMP]: '#3c5a42' },
  summer: { [B.MEADOW]: '#7f8a3a', [B.FOREST]: '#4c6a2a', [B.QUARRY]: '#716a5a', [B.SWAMP]: '#3e4e34' },
};
const DECO = {
  autumn: ['#7d6a2c', '#8a5a26', '#46592a'],
  winter: ['#e6eef2', '#9fb4bf', '#c8d6dd'],
  spring: ['#8bc060', '#d9a6c8', '#4f8a40'],
  summer: ['#a9a444', '#c9b25a', '#5e7a30'],
};
const MOVERS = new Set(['player', 'gremlin', 'bot', 'phantom']);
const FX_LIFE = { hit: 0.35, poof: 0.6, boom: 0.7, heal: 0.7, lightning: 0.9 };

export class Renderer {
  constructor(canvas, G) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.G = G;
    this.dark = document.createElement('canvas');
    this.dctx = this.dark.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1.25 };
    this.parts = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.dark.width = this.cv.width;
    this.dark.height = this.cv.height;
    this.W = w;
    this.H = h;
  }

  toWorld(sx, sy) {
    const z = this.cam.zoom;
    return { x: (sx - this.W / 2) / z + this.cam.x, y: (sy - this.H / 2) / z + this.cam.y };
  }

  frame(dt, now) {
    const G = this.G, ctx = this.ctx, dpr = this.dpr;
    const t = now / 1000;
    const clock = clockAt(G.time);
    const me = G.me();
    // --- camera ---
    if (me) {
      const k = 1 - Math.exp(-dt * 8);
      if (!this.cam.init) { this.cam.x = me.rx; this.cam.y = me.ry; this.cam.init = true; }
      this.cam.x += (me.rx - this.cam.x) * k;
      this.cam.y += (me.ry - this.cam.y) * k;
    }
    const z = this.cam.zoom;
    // --- smoothing vị trí ---
    const sm = 1 - Math.exp(-dt * 16);
    for (const e of G.ents.values()) {
      if (MOVERS.has(e.k)) {
        e.rx += (e.x - e.rx) * sm;
        e.ry += (e.y - e.ry) * sm;
        if (Math.abs(e.x - e.rx) > 300) { e.rx = e.x; e.ry = e.y; }
      } else { e.rx = e.x; e.ry = e.y; }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a10';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);
    const vx0 = this.cam.x - this.W / 2 / z - 60, vx1 = this.cam.x + this.W / 2 / z + 60;
    const vy0 = this.cam.y - this.H / 2 / z - 100, vy1 = this.cam.y + this.H / 2 / z + 60;
    this.terrain(ctx, clock.season, t, vx0, vx1, vy0, vy1);
    this.coverage(ctx, t);
    this.cables(ctx, t);
    // --- entities ---
    const list = [];
    for (const e of G.ents.values()) {
      if (e.rx < vx0 || e.rx > vx1 || e.ry < vy0 || e.ry > vy1) continue;
      if (e.k === 'phantom' && e.for !== G.pid) continue;
      list.push(e);
    }
    list.sort((a, b) => zOf(a) - zOf(b));
    const sys = G.sys;
    const monitored = sys ? sys.n : {};
    for (const e of list) {
      const info = COMP[e.k] ? monitored[e.id] || null : null;
      drawEntity(ctx, e, { t, info, selected: G.selected === e.id || G.hover === e.id, me: e.id === (me && me.id), dark: clock.dark });
      if (COMP[e.k] && !info && e.on !== undefined) this.unknownMark(ctx, e, t);
      if (e.k === 'player') this.nameTag(ctx, e, e.id === (me && me.id));
    }
    this.crowd(ctx, t);
    this.placement(ctx, t);
    this.fxLayer(ctx, t);
    ctx.restore();
    this.lighting(ctx, clock, t, dt);
    this.weather(ctx, clock.season, t, dt);
    if (me) this.mood(me);
  }

  // ---------------------------------------------------------------- địa hình
  terrain(ctx, season, t, x0, x1, y0, y1) {
    const G = this.G;
    const cols = BIOME[season], deco = DECO[season];
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), tx1 = Math.min(MAP_W - 1, Math.floor(x1 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const b = G.tiles[ty * MAP_W + tx];
        const x = tx * TILE, y = ty * TILE;
        const h = hash2(tx, ty, 7);
        if (b === B.VOID) {
          ctx.fillStyle = h < 0.5 ? '#0f0d17' : '#12101b';
          ctx.fillRect(x, y, TILE + 1, TILE + 1);
          if (h > 0.9) { ctx.fillStyle = 'rgba(120,90,200,0.18)'; ctx.fillRect(x + 4, y + ((t * 20 + h * 40) % 44), 36, 2); }
          continue;
        }
        ctx.fillStyle = cols[b];
        ctx.fillRect(x, y, TILE + 1, TILE + 1);
        // biến thiên sắc độ
        ctx.fillStyle = h < 0.3 ? 'rgba(0,0,0,0.035)' : h > 0.75 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0)';
        ctx.fillRect(x, y, TILE + 1, TILE + 1);
        // họa tiết cỏ / nhiễu
        const n = Math.floor(hash2(tx, ty, 3) * 5);
        for (let i = 0; i < n; i++) {
          const hx = hash2(tx, ty, 10 + i), hy = hash2(tx, ty, 20 + i);
          ctx.strokeStyle = deco[(i + tx + ty) % 3];
          ctx.lineWidth = 1.4;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          const px = x + 4 + hx * 40, py = y + 8 + hy * 34;
          if (b === B.QUARRY) { ctx.moveTo(px, py); ctx.lineTo(px + 5, py - 1); }
          else if (b === B.SWAMP) { ctx.moveTo(px - 3, py); ctx.quadraticCurveTo(px, py - 3, px + 3, py); }
          else { ctx.moveTo(px, py); ctx.lineTo(px - 1.5, py - 5); ctx.moveTo(px, py); ctx.lineTo(px + 1.5, py - 6); }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- vùng phủ điện / giám sát
  coverage(ctx, t) {
    const G = this.G;
    const sel = G.selected ? G.ents.get(G.selected) : null;
    const showAll = G.mode === 'build' && G.build && (G.build.id === 'generator' || G.build.id === 'lantern');
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -t * 10;
    ctx.lineWidth = 2;
    for (const e of G.ents.values()) {
      if (e.k !== 'generator' && e.k !== 'lantern') continue;
      if (!showAll && sel !== e) continue;
      const r = e.k === 'generator' ? PWR_R : STRUCTS.lantern.monitor;
      ctx.strokeStyle = e.k === 'generator' ? 'rgba(255,190,70,0.7)' : 'rgba(90,220,255,0.7)';
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, 7); ctx.stroke();
    }
    if (G.mode === 'build' && G.build && G.buildPos && (G.build.id === 'generator' || G.build.id === 'lantern')) {
      const r = G.build.id === 'generator' ? PWR_R : STRUCTS.lantern.monitor;
      ctx.strokeStyle = G.build.id === 'generator' ? 'rgba(255,190,70,0.9)' : 'rgba(90,220,255,0.9)';
      ctx.beginPath(); ctx.arc(G.buildPos.x, G.buildPos.y, r, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- cáp mạng
  cables(ctx, t) {
    const G = this.G;
    const sys = G.sys;
    const cut = new Set(sys ? sys.cut : []);
    const linking = G.mode === 'link' && G.linkFrom ? G.ents.get(G.linkFrom) : null;
    for (const a of G.ents.values()) {
      if (!a.links || !a.links.length) continue;
      for (let i = 0; i < a.links.length; i++) {
        const b = G.ents.get(a.links[i]);
        if (!b) continue;
        const key = a.id + '>' + b.id;
        const rate = sys && sys.e[key] !== undefined ? sys.e[key] : null;
        const isCut = cut.has(key);
        const ax = a.rx, ay = a.ry + 4, bx = b.rx, by = b.ry + 4;
        const mx = (ax + bx) / 2, my = (ay + by) / 2 + Math.min(40, Math.hypot(ax - bx, ay - by) * 0.18);
        const w = rate === null ? 3 : Math.min(8, 3 + Math.log2(1 + rate) * 0.5);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#120f0b';
        ctx.lineWidth = w + 3;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
        ctx.strokeStyle = isCut ? '#7a2a22' : a.on && b.on ? '#3f8fa8' : '#4a4540';
        ctx.lineWidth = w;
        if (isCut) ctx.setLineDash([6, 14]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
        ctx.setLineDash([]);
        if (isCut) {
          // dấu hiệu đứt cáp: tia sét + mây
          const px = (ax + 2 * mx + bx) / 4, py = (ay + 2 * my + by) / 4;
          ctx.fillStyle = 'rgba(60,60,80,0.9)';
          ctx.beginPath(); ctx.arc(px - 8, py - 22, 12, 0, 7); ctx.arc(px + 6, py - 26, 14, 0, 7); ctx.arc(px + 18, py - 20, 10, 0, 7); ctx.fill();
          ctx.strokeStyle = '#ffe36b'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(px, py - 16); ctx.lineTo(px - 5, py - 6); ctx.lineTo(px + 3, py - 6); ctx.lineTo(px - 3, py + 6); ctx.stroke();
        }
        // gói tin chạy trên cáp
        if (rate !== null && rate > 0 && !isCut && a.on) {
          const n = Math.min(6, 1 + Math.floor(Math.log2(1 + rate)));
          ctx.fillStyle = '#bff7ff';
          for (let k = 0; k < n; k++) {
            const u = ((t * 0.5 * (0.6 + Math.min(1, rate / 200)) + k / n) % 1);
            const qx = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx;
            const qy = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
            ctx.beginPath(); ctx.arc(qx, qy, 2.6, 0, 7); ctx.fill();
          }
        }
      }
    }
    // dây đang kéo
    if (linking && G.mouseWorld) {
      ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(linking.rx, linking.ry); ctx.lineTo(G.mouseWorld.x, G.mouseWorld.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  unknownMark(ctx, e, t) {
    ctx.save();
    ctx.font = 'bold 18px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,190,230,0.85)';
    ctx.strokeStyle = '#120f0b';
    ctx.lineWidth = 3;
    const y = e.ry - (e.h || 1) * TILE / 2 - 16 + Math.sin(t * 2 + e.id) * 2;
    ctx.strokeText('?', e.rx, y);
    ctx.fillText('?', e.rx, y);
    ctx.restore();
  }

  nameTag(ctx, e, mine) {
    ctx.save();
    ctx.font = '11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = mine ? '#ffe9a8' : '#e8e2f2';
    ctx.strokeStyle = '#120f0b';
    ctx.lineWidth = 3;
    const y = e.ry - 34;
    ctx.strokeText(e.name, e.rx, y);
    ctx.fillText(e.name, e.rx, y);
    ctx.restore();
  }

  // ---------------------------------------------------------------- đám đông người dùng
  crowd(ctx, t) {
    const G = this.G;
    const sys = G.sys;
    if (!sys || !sys.g) return;
    const gw = [...G.ents.values()].find((e) => e.k === 'gateway');
    if (!gw) return;
    const demand = sys.g.demand ?? G.users * 1.2;
    const n = Math.min(46, Math.round(demand / 2.2));
    const mood = Math.max(0, Math.min(1, (sys.g.sat ?? 100) / 100));
    for (let i = 0; i < n; i++) {
      const seed = i * 7919;
      const row = Math.floor(i / 12), col = i % 12;
      const x = gw.rx - 130 + col * 24 + Math.sin(t * 0.8 + i) * 4;
      const y = gw.ry + 150 + row * 22 + Math.cos(t * 0.7 + i * 2) * 3;
      drawUser(ctx, x, y, t, seed, mood);
    }
  }

  // ---------------------------------------------------------------- đặt công trình
  placement(ctx, t) {
    const G = this.G;
    if (G.mode !== 'build' || !G.build || !G.buildPos) return;
    const S = STRUCTS[G.build.place];
    drawGhost(ctx, G.build.place, G.buildPos.x, G.buildPos.y, G.buildValid, S.w, S.h);
  }

  fxLayer(ctx, t) {
    const G = this.G;
    const now = performance.now() / 1000;
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const f = G.fx[i];
      const p = (now - f.t0) / (FX_LIFE[f.kind] || 0.6);
      if (p >= 1) { G.fx.splice(i, 1); continue; }
      drawFxSpark(ctx, f.x, f.y, p, f.kind);
    }
  }

  // ---------------------------------------------------------------- ánh sáng ban đêm
  lighting(ctx, clock, t, dt) {
    const G = this.G;
    const dark = clock.dark;
    if (dark < 0.02) return;
    const dc = this.dctx, z = this.cam.zoom, dpr = this.dpr;
    dc.setTransform(1, 0, 0, 1, 0, 0);
    dc.globalCompositeOperation = 'source-over';
    dc.clearRect(0, 0, this.dark.width, this.dark.height);
    const a = Math.min(0.9, dark * 0.95);
    dc.fillStyle = `rgba(8,9,32,${a})`;
    dc.fillRect(0, 0, this.dark.width, this.dark.height);
    dc.globalCompositeOperation = 'destination-out';
    const me = G.me();
    const light = (x, y, r, str = 1) => {
      const sx = ((x - this.cam.x) * z + this.W / 2) * dpr, sy = ((y - this.cam.y) * z + this.H / 2) * dpr, sr = r * z * dpr;
      if (sx < -sr || sy < -sr || sx > this.dark.width + sr || sy > this.dark.height + sr) return;
      const g = dc.createRadialGradient(sx, sy, sr * 0.1, sx, sy, sr);
      g.addColorStop(0, `rgba(0,0,0,${str})`);
      g.addColorStop(0.6, `rgba(0,0,0,${str * 0.65})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = g;
      dc.beginPath(); dc.arc(sx, sy, sr, 0, 7); dc.fill();
    };
    const warm = [];
    for (const e of G.ents.values()) {
      const S = STRUCTS[e.k];
      if (e.k === 'player') {
        if (e.lit && !e.ghost) { light(e.rx, e.ry, 200); warm.push([e.rx, e.ry, 200]); }
        else if (e.id === (me && me.id)) light(e.rx, e.ry, 64, 0.8);
        continue;
      }
      if (!S || !S.light) continue;
      const active = e.k === 'generator' ? e.fuel > 0 && e.on : e.k === 'stove' ? !!e.cooking : e.on;
      if (!active) continue;
      const flick = 1 + Math.sin(t * 7 + e.id) * 0.02;
      light(e.rx, e.ry, S.light * flick);
      if (S.light > 100) warm.push([e.rx, e.ry, S.light * flick]);
    }
    dc.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.dark, 0, 0);
    // quầng sáng ấm
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r] of warm) {
      const sx = ((x - this.cam.x) * z + this.W / 2) * dpr, sy = ((y - this.cam.y) * z + this.H / 2) * dpr, sr = r * z * dpr * 0.8;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(255,170,70,${0.16 * dark})`);
      g.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------------------------------------------------------------- thời tiết (chỉ trang trí)
  weather(ctx, season, t, dt) {
    const W = this.W, H = this.H;
    const want = season === 'spring' ? 90 : season === 'winter' ? 70 : season === 'autumn' ? 14 : 10;
    while (this.parts.length < want) this.parts.push({ x: Math.random() * W, y: Math.random() * H, s: 0.6 + Math.random(), r: Math.random() });
    if (this.parts.length > want) this.parts.length = want;
    ctx.save();
    for (const p of this.parts) {
      if (season === 'spring') {
        p.y += 520 * p.s * dt; p.x -= 60 * dt;
        ctx.strokeStyle = 'rgba(170,200,230,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 4, p.y + 12); ctx.stroke();
      } else if (season === 'winter') {
        p.y += 50 * p.s * dt; p.x += Math.sin(t + p.r * 6) * 18 * dt;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 + p.r * 1.4, 0, 7); ctx.fill();
      } else if (season === 'autumn') {
        p.y += 40 * p.s * dt; p.x += Math.sin(t * 1.3 + p.r * 9) * 40 * dt;
        ctx.fillStyle = p.r > 0.5 ? 'rgba(200,110,40,0.8)' : 'rgba(170,140,50,0.8)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2, t + p.r * 5, 0, 7); ctx.fill();
      } else {
        p.y -= 8 * p.s * dt; p.x += Math.sin(t + p.r * 8) * 10 * dt;
        ctx.fillStyle = 'rgba(255,240,150,0.35)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, 7); ctx.fill();
      }
      if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
      if (p.y < -30) { p.y = H + 10; }
      if (p.x < -20) p.x = W + 10;
      if (p.x > W + 20) p.x = -10;
    }
    ctx.restore();
  }

  mood(me) {
    const el = this.cv.parentElement;
    const s = me.sanity;
    el.classList.toggle('insane1', s < 30 && s >= 15);
    el.classList.toggle('insane2', s < 15);
    el.classList.toggle('hurt', performance.now() - (this.G.hurtAt || 0) < 250);
  }
}
