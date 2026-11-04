// Sinh bản đồ: bioms (deterministic theo seed) + tài nguyên.
import { MAP_W, MAP_H } from './data.js';
import { mulberry32, valueNoise, hash2 } from './util.js';

export const B = { VOID: 0, MEADOW: 1, FOREST: 2, QUARRY: 3, SWAMP: 4 };
export const BASE_TX = 40;
export const BASE_TY = 40;

export function genTiles(seed) {
  const tiles = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const dx = x - MAP_W / 2 + 0.5, dy = y - MAP_H / 2 + 0.5;
      const edge = Math.hypot(dx, dy) - (36 + valueNoise(x / 6, y / 6, seed + 9) * 5);
      let b;
      if (edge > 0 || x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) b = B.VOID;
      else {
        const n1 = valueNoise(x / 11, y / 11, seed + 1);
        const n2 = valueNoise(x / 13 + 40, y / 13 + 40, seed + 2);
        const cd = Math.hypot(x - BASE_TX, y - BASE_TY);
        if (cd < 8) b = B.MEADOW;
        else if (n1 > 0.62) b = B.QUARRY;
        else if (n2 > 0.63) b = B.SWAMP;
        else if (n1 < 0.4) b = B.FOREST;
        else b = B.MEADOW;
      }
      tiles[y * MAP_W + x] = b;
    }
  }
  return tiles;
}

const DENSITY = {
  [B.MEADOW]: { tuft: 0.06, sapling: 0.03, bush: 0.025, tree: 0.02, shard: 0.007 },
  [B.FOREST]: { tree: 0.22, tuft: 0.02, sapling: 0.03, mush: 0.015, bush: 0.01 },
  [B.QUARRY]: { rock: 0.09, shard: 0.02, vein: 0.014, coalseam: 0.008, sapling: 0.01, tuft: 0.01 },
  [B.SWAMP]: { mush: 0.05, coalseam: 0.03, tuft: 0.03, tree: 0.04, vein: 0.006 },
};

// Trả về danh sách {k,tx,ty,big?} tài nguyên ban đầu.
export function genResources(seed, tiles) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const out = [];
  const taken = new Set();
  const put = (k, tx, ty) => {
    const key = ty * MAP_W + tx;
    if (taken.has(key)) return false;
    taken.add(key);
    const r = { k, tx, ty };
    if (k === 'tree') r.big = hash2(tx, ty, seed) < 0.3 ? 2 : hash2(tx, ty, seed + 1) < 0.5 ? 1 : 0;
    out.push(r);
    return true;
  };
  for (let ty = 1; ty < MAP_H - 1; ty++) {
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      const b = tiles[ty * MAP_W + tx];
      if (b === B.VOID) continue;
      const cd = Math.hypot(tx - BASE_TX, ty - BASE_TY);
      if (cd < 7) continue; // khu căn cứ để trống
      const dens = DENSITY[b];
      let r = rng();
      for (const k in dens) {
        if (r < dens[k]) {
          put(k, tx, ty);
          break;
        }
        r -= dens[k];
      }
    }
  }
  // Khu vực khởi đầu: đảm bảo có tài nguyên cơ bản gần căn cứ
  const ring = (k, n, r0, r1) => {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < 500) {
      const a = rng() * Math.PI * 2, d = r0 + rng() * (r1 - r0);
      const tx = Math.round(BASE_TX + Math.cos(a) * d), ty = Math.round(BASE_TY + Math.sin(a) * d);
      if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue;
      if (tiles[ty * MAP_W + tx] === B.VOID) continue;
      if (put(k, tx, ty)) placed++;
    }
  };
  ring('tree', 9, 8, 13);
  ring('rock', 5, 9, 14);
  ring('tuft', 10, 7, 12);
  ring('sapling', 6, 7, 12);
  ring('bush', 4, 8, 12);
  ring('shard', 4, 8, 13);
  ring('mush', 3, 9, 14);
  ring('coalseam', 2, 11, 16);
  ring('vein', 2, 13, 19);
  return out;
}
