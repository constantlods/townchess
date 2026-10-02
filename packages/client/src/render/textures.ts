import * as THREE from 'three';
import { Noise2D, mulberry32, clamp01, lerp, smoothstep } from './noise';
import { TexBuilder, hex, toPBR, type RawPBR } from './canvasTex';
import { collector, dummyTexture } from './registry';

export type PBRSet = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };

/**
 * Texture generator registry. Each generator is a pure function producing raw RGBA arrays, so it can
 * run on the main thread (sync fallback) or in a worker (preload). Results are memoised by key.
 */
type Gen = (...args: never[]) => RawPBR;
export const GEN: Record<string, Gen> = {};
const memo = new Map<string, PBRSet>();
/** Global resolution multiplier (quality setting); part of every cache key. */
let texScale = 1;
export const setTexScale = (s: number) => { texScale = s; };
export const getTexScale = () => texScale;
/** Texture builder at the current quality scale; generators work in design-resolution pixel units. */
export const TB = (w: number, h: number) => new TexBuilder(w, h, texScale);
export const texKey = (name: string, args: unknown[]) => `${name}@${texScale}:${JSON.stringify(args)}`;

export function def<A extends unknown[]>(name: string, gen: (...a: A) => RawPBR): (...a: A) => PBRSet {
  GEN[name] = gen as unknown as Gen;
  return (...a: A) => {
    const key = texKey(name, a);
    let v = memo.get(key);
    if (v) return v;
    if (collector.active) {
      collector.jobs.set('tex|' + key, { kind: 'tex', name, args: a, scale: texScale, key });
      const d = dummyTexture();
      return { map: d, normalMap: d, roughnessMap: d };
    }
    v = toPBR(gen(...a));
    memo.set(key, v);
    return v;
  };
}
export const hasTex = (key: string) => memo.has(key);
export const putTex = (key: string, raw: RawPBR) => { if (!memo.has(key)) memo.set(key, toPBR(raw)); };

const mix3 = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Wood grain value at (u along grain, v across grain) in roughly "plank space" units. */
function grain(n: Noise2D, u: number, v: number, ringFreq: number) {
  const warp = n.fbm(u * 0.35, v * 2.2, 4) * 1.6 + n.fbm(u * 2.5, v * 9, 2) * 0.15;
  const rings = v * ringFreq + warp * 3.0;
  const r = rings - Math.floor(rings);
  const late = smoothstep(0.55, 0.95, r) * (1 - smoothstep(0.95, 1.0, r));
  const fibre = n.fbm(u * 0.4, v * 60, 2) * 0.5 + 0.5;
  return { late, fibre, warp };
}

export interface TableOpts {
  seed: number;
  base: string; // mid wood
  dark: string;
  light: string;
  blood: number; // 0..1 amount of dark old stains
  planks: number;
}

/** Old, filthy plank table top. u along planks = texture x. */
export const tableTexture = def('tableTexture', (o: TableOpts, W: number = 2048, H: number = 1280): RawPBR => {
    const t = TB(W, H);
    const n = new Noise2D(o.seed), n2 = new Noise2D(o.seed + 7), n3 = new Noise2D(o.seed + 13);
    const rnd = mulberry32(o.seed);
    const base = hex(o.base), dark = hex(o.dark), light = hex(o.light);
    const plankH = H / o.planks;
    const plankShift = Array.from({ length: o.planks }, () => rnd() * 50);
    const plankTint = Array.from({ length: o.planks }, () => 0.8 + rnd() * 0.3);
    t.each((x, y, i) => {
      const p = Math.floor(y / plankH);
      const pv = (y % plankH) / plankH;
      // long directional streaks along the plank (the dominant look of old sawn wood)
      const u = x / 1100 + plankShift[p];
      const v = pv + p * 3.1;
      const warp = n.fbm(u * 1.2, v * 1.5, 3) * 0.35;
      const streak = n.fbm(u * 0.6, (v + warp) * 26, 3);
      const fine = n3.fbm(x / 300, (y + warp * 200) / 2.2, 2);
      const ring = Math.sin((v + warp) * 18 + n.fbm(u * 2, v * 4, 2) * 2) * 0.5 + 0.5;
      let c = mix3(base, dark, clamp01(streak * 0.9 + 0.35) * 0.55 + ring * 0.12);
      c = mix3(c, light, clamp01(fine * 0.8) * 0.25);
      // worn, faded patches (lighter, dusty)
      const blotch = n2.fbm(x / 480, y / 480, 4);
      c = mix3(c, [118, 98, 74], clamp01(blotch * 1.1 - 0.05) * 0.45);
      c = mix3(c, dark, clamp01(-blotch * 1.2) * 0.55);
      // ground-in grime
      const grime = clamp01(n2.fbm(x / 110 + 30, y / 110, 5) * 1.3 + 0.15);
      c = mix3(c, [16, 12, 9], grime * 0.55);
      const tint = plankTint[p];
      const edge = Math.min(pv, 1 - pv) * plankH;
      const gap = 1 - smoothstep(0, 3.0, edge);
      const bevel = 1 - smoothstep(0, 14, edge);
      c = mix3(c, [6, 5, 3], gap * 0.95);
      c = mix3(c, [20, 15, 10], bevel * 0.35);
      t.setRGB(i, c[0] * tint, c[1] * tint, c[2] * tint);
      t.height[i] = streak * 0.05 + fine * 0.03 - gap * 1.4 - bevel * 0.25 + n.fbm(x / 30, y / 30, 2) * 0.03;
      t.rough[i] = 0.68 + grime * 0.22 - clamp01(blotch) * 0.1;
    });
    // knife scratches, gouges
    for (let s = 0; s < 160; s++) {
      const x0 = rnd() * W, y0 = rnd() * H, a = (rnd() - 0.5) * 0.5;
      const len = 10 + rnd() * 60, wdt = 0.4 + rnd() * 0.6;
      const pts: [number, number][] = [[x0, y0], [x0 + Math.cos(a) * len * 0.5, y0 + Math.sin(a) * len * 0.5 + (rnd() - 0.5) * 6], [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len]];
      const bright = rnd() < 0.55;
      t.stroke(pts, wdt, (i, c) => {
        t.height[i] -= c * 0.25;
        if (bright) t.blend(i, light[0] * 1.1, light[1] * 1.05, light[2], c * 0.22);
        else t.blend(i, 14, 10, 7, c * 0.28);
        t.rough[i] = Math.min(1, t.rough[i] + c * 0.15);
      });
    }
    // water rings and dark old stains
    for (let s = 0; s < 14; s++) {
      const cx = rnd() * W, cy = rnd() * H, r = 30 + rnd() * 70;
      t.disc(cx, cy, r * 1.05, (i, c) => {
        const ring = Math.exp(-Math.pow((1 - c) * 18 - 1, 2));
        t.blend(i, 30, 22, 14, ring * 0.35);
      });
    }
    const stains = Math.round(18 * o.blood);
    for (let s = 0; s < stains; s++) {
      const cx = rnd() * W, cy = rnd() * H, r = 12 + rnd() * 70;
      const blobs = 4 + Math.floor(rnd() * 8);
      for (let b = 0; b < blobs; b++) {
        const bx = cx + (rnd() - 0.5) * r * 2, by = cy + (rnd() - 0.5) * r * 2, br = r * (0.15 + rnd() * 0.5);
        t.disc(bx, by, br, (i, c, dx, dy) => {
          const edge = n.fbm(bx + dx * 3, by + dy * 3, 3) * 0.3;
          const a = smoothstep(0.0, 0.35, c + edge) * 0.78;
          t.blend(i, 58, 14, 10, a);
          t.rough[i] = lerp(t.rough[i], 0.42, a * 0.6);
        });
      }
      // spatter
      for (let k = 0; k < 30; k++) {
        const a = rnd() * Math.PI * 2, d = r * (1 + rnd() * 2.5);
        t.disc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 4, (i, c) => t.blend(i, 50, 12, 9, smoothstep(0, 0.4, c) * 0.7));
      }
    }
    return t.buildRaw(2.5);
});

export interface BoardOpts { seed: number; highContrast: boolean; blood: number }

/**
 * Board top: 8x8 playing surface + border. Texture covers the full board (square).
 * `inner` is the fraction of the texture covered by the 8x8 grid.
 */
export const boardTexture = def('boardTexture', (o: BoardOpts, inner: number, S: number = 2048): RawPBR => {
    const t = TB(S, S);
    const n = new Noise2D(o.seed), n2 = new Noise2D(o.seed + 3);
    const rnd = mulberry32(o.seed + 11);
    const lightSq = o.highContrast ? hex('#c8b488') : hex('#b09a70');
    const darkSq = o.highContrast ? hex('#3e2818') : hex('#503622');
    const frame = hex('#3a271b'), frameDark = hex('#241812');
    const off = (1 - inner) / 2 * S, sq = (inner * S) / 8;
    const sqTint = Array.from({ length: 64 }, () => [0.9 + rnd() * 0.18, rnd() * 50, rnd() < 0.5 ? 0 : 1]);
    t.each((x, y, i) => {
      const gx = (x - off) / sq, gy = (y - off) / sq;
      const inside = gx >= 0 && gx < 8 && gy >= 0 && gy < 8;
      let c: number[];
      let hgt = 0, rough = 0.6;
      if (inside) {
        const fx = Math.floor(gx), fy = Math.floor(gy);
        const st = sqTint[fy * 8 + fx];
        const isLight = (fx + fy) % 2 === 1; // texture row 0 = near edge (rank 1): a1 (0,0) is dark, h1 light
        const along = st[2] ? (x / 140) : (y / 140);
        const across = st[2] ? (y / 9) : (x / 9);
        const g = grain(n, along + st[1], across * 0.12 + st[1], 5);
        const b = isLight ? lightSq : darkSq;
        c = mix3(b, isLight ? [120, 98, 66] : [36, 24, 15], g.late * (isLight ? 0.35 : 0.45));
        c = mix3(c, isLight ? [196, 178, 140] : [92, 66, 44], clamp01(g.fibre - 0.6) * 0.35);
        const f = st[0] as number;
        c = [c[0] * f, c[1] * f, c[2] * f];
        // wear: worn centres lighter on dark, darker grime toward square edges
        const lx = gx - fx, ly = gy - fy;
        const ed = Math.min(lx, 1 - lx, ly, 1 - ly);
        const seam = 1 - smoothstep(0, 0.018, ed);
        const edgeGrime = (1 - smoothstep(0, 0.12, ed)) * clamp01(n2.fbm(x / 30, y / 30, 3) + 0.5);
        c = mix3(c, [18, 13, 9], seam * 0.85 + edgeGrime * 0.22);
        const blotch = n2.fbm(x / 260 + 7, y / 260, 4);
        c = mix3(c, [40, 30, 20], clamp01(blotch + 0.15) * (isLight ? 0.45 : 0.15));
        const dirt = clamp01(n2.fbm(x / 90 + 3, y / 90, 4) * 1.4);
        c = mix3(c, [70, 54, 36], dirt * (isLight ? 0.35 : 0.1));
        hgt = -seam * 0.8 - g.late * 0.12;
        rough = 0.55 + edgeGrime * 0.2 + clamp01(blotch) * 0.1;
      } else {
        // frame: darker wood running around the edge, with a thin inlay line
        const dEdge = Math.min(x, y, S - 1 - x, S - 1 - y);
        const horizontal = Math.min(y, S - 1 - y) < Math.min(x, S - 1 - x);
        const g = grain(n, horizontal ? x / 160 : y / 160, (horizontal ? y : x) / 14 * 0.12, 5);
        c = mix3(frame, frameDark, g.late * 0.7 + 0.15);
        const inlayD = Math.abs(Math.min(Math.abs(gx < 0 ? gx : gx > 8 ? gx - 8 : 0), Math.abs(gy < 0 ? gy : gy > 8 ? gy - 8 : 0)));
        void inlayD;
        const distToInner = Math.max(off - x, x - (S - off), off - y, y - (S - off));
        const inlay = Math.exp(-Math.pow((distToInner - off * 0.2) / 3, 2));
        c = mix3(c, [150, 120, 70], inlay * 0.55);
        const chip = 1 - smoothstep(0, 10, dEdge);
        c = mix3(c, [90, 70, 48], chip * clamp01(n2.fbm(x / 6, y / 6, 2) + 0.2) * 0.8);
        const grime = clamp01(n2.fbm(x / 70, y / 70, 4) + 0.2);
        c = mix3(c, [14, 10, 7], grime * 0.45);
        hgt = -inlay * 0.2 - chip * 0.4;
        rough = 0.55 + grime * 0.25;
      }
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = hgt + n.fbm(x / 25, y / 25, 2) * 0.03;
      t.rough[i] = rough;
    });
    // scratches across the playing surface (subtle, readability first)
    for (let s = 0; s < 180; s++) {
      const x0 = rnd() * S, y0 = rnd() * S, a = rnd() * Math.PI * 2, len = 10 + rnd() * 90;
      t.stroke([[x0, y0], [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len]], 0.7 + rnd(), (i, c) => {
        t.height[i] -= c * 0.25;
        t.blend(i, 190, 170, 130, c * 0.12);
      });
    }
    // dents
    for (let s = 0; s < 70; s++) t.disc(rnd() * S, rnd() * S, 2 + rnd() * 6, (i, c) => { t.height[i] -= c * c * 0.6; t.blend(i, 20, 14, 10, c * 0.2); });
    // small dark old stains (kept faint for readability)
    const st = Math.round(7 * o.blood);
    for (let s = 0; s < st; s++) {
      const cx = rnd() * S, cy = rnd() * S;
      for (let k = 0; k < 12; k++) {
        const r = 2 + rnd() * 16;
        t.disc(cx + (rnd() - 0.5) * 60, cy + (rnd() - 0.5) * 60, r, (i, c) => {
          const a = smoothstep(0, 0.3, c) * 0.55;
          t.blend(i, 60, 15, 10, a);
          t.rough[i] = lerp(t.rough[i], 0.4, a);
        });
      }
    }
    return t.buildRaw(2.2, false);
});

/** Lathe-mapped piece wood texture: u = around, v = up. */
export const pieceTexture = def('pieceTexture', (light: boolean, seed: number, W: number = 512, H: number = 512): RawPBR => {
    const t = TB(W, H);
    const n = new Noise2D(seed), n2 = new Noise2D(seed + 5);
    const rnd = mulberry32(seed);
    const base = light ? hex('#b9a782') : hex('#1a130f');
    t.each((x, y, i) => {
      const g = grain(n, y / 90, Math.sin((x / W) * Math.PI * 2) * 0.6 + 4, light ? 9 : 7);
      let c = mix3(base, light ? [150, 128, 92] : [10, 7, 5], g.late * (light ? 0.35 : 0.5));
      c = mix3(c, light ? [204, 188, 152] : [40, 30, 22], clamp01(g.fibre - 0.6) * 0.3);
      const grime = clamp01(n2.fbm(x / 40, y / 40, 4) + 0.15);
      c = mix3(c, light ? [84, 66, 42] : [6, 4, 3], grime * (light ? 0.45 : 0.3));
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = -g.late * 0.08 + n2.fbm(x / 12, y / 12, 2) * 0.02;
      t.rough[i] = light ? 0.42 + grime * 0.3 : 0.28 + grime * 0.35;
    });
    for (let s = 0; s < 90; s++) {
      const x0 = rnd() * W, y0 = rnd() * H, a = rnd() * Math.PI * 2, len = 4 + rnd() * 30;
      t.stroke([[x0, y0], [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len]], 0.6 + rnd() * 0.8, (i, c) => {
        t.height[i] -= c * 0.3;
        if (light) t.blend(i, 80, 62, 40, c * 0.35); else t.blend(i, 110, 90, 70, c * 0.35);
        t.rough[i] = Math.min(1, t.rough[i] + 0.2 * c);
      });
    }
    // chips
    for (let s = 0; s < 14; s++) t.disc(rnd() * W, rnd() * H, 1.5 + rnd() * 4, (i, c) => {
      t.height[i] -= c * 0.6;
      if (light) t.blend(i, 110, 88, 58, c * 0.6); else t.blend(i, 92, 70, 50, c * 0.6);
      t.rough[i] = 0.8;
    });
    return t.buildRaw(2.5);
});

export interface TileOpts { seed: number; tile: string; grout: string; dirt: number; cols: number; rows: number; aspect?: number }

/** Grimy ceramic wall tiles. */
export const tileTexture = def('tileTexture', (o: TileOpts, W: number = 1024, H: number = 1024): RawPBR => {
    const t = TB(W, H);
    const n = new Noise2D(o.seed), rnd = mulberry32(o.seed);
    const tile = hex(o.tile), grout = hex(o.grout);
    const tw = W / o.cols, th = H / o.rows;
    const tints = Array.from({ length: o.cols * o.rows }, () => 0.85 + rnd() * 0.25);
    const cracked = Array.from({ length: o.cols * o.rows }, () => rnd() < 0.12);
    t.each((x, y, i) => {
      const cx = Math.floor(x / tw), cy = Math.floor(y / th);
      const lx = (x % tw) / tw, ly = (y % th) / th;
      const ed = Math.min(lx * tw, (1 - lx) * tw, ly * th, (1 - ly) * th);
      const g = smoothstep(1.2, 3.2, ed);
      const tint = tints[cy * o.cols + cx];
      let c = mix3(grout, [tile[0] * tint, tile[1] * tint, tile[2] * tint], g);
      // drips: vertical streaks of grime
      const drip = clamp01(n.fbm(x / 60, y / 700, 3) * 1.4 + n.fbm(x / 9, y / 200, 2) * 0.4) * o.dirt;
      const blot = clamp01(n.fbm(x / 180 + 9, y / 180, 4) + 0.1) * o.dirt;
      c = mix3(c, [40, 36, 24], drip * 0.7 + blot * 0.5);
      // glaze bevel highlight
      const bevel = smoothstep(2, 7, ed);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = bevel * 0.5 + g * 0.3;
      t.rough[i] = lerp(0.95, 0.25 + drip * 0.5 + blot * 0.3, g);
    });
    for (let k = 0; k < o.cols * o.rows; k++) {
      if (!cracked[k]) continue;
      const cx = (k % o.cols) * tw, cy = Math.floor(k / o.cols) * th;
      const pts: [number, number][] = [];
      let x = cx + rnd() * tw, y = cy + rnd() * th * 0.2;
      for (let s = 0; s < 6; s++) { pts.push([x, y]); x += (rnd() - 0.5) * tw * 0.4; y += th * 0.18; }
      t.stroke(pts, 1.1, (i, c) => { t.height[i] -= c * 0.8; t.blend(i, 20, 18, 12, c * 0.8); t.rough[i] = 0.9; });
    }
    // missing / chipped tile corners
    for (let s = 0; s < Math.round(o.cols * o.rows * 0.05); s++) {
      const cx = Math.floor(rnd() * o.cols) * tw + (rnd() < 0.5 ? 0 : tw), cy = Math.floor(rnd() * o.rows) * th + (rnd() < 0.5 ? 0 : th);
      t.disc(cx, cy, tw * (0.15 + rnd() * 0.3), (i, c) => {
        const a = smoothstep(0, 0.15, c + n.fbm(cx, cy, 1) * 0.1);
        t.blend(i, 70, 62, 50, a); t.height[i] = lerp(t.height[i], -0.6, a); t.rough[i] = lerp(t.rough[i], 1, a);
      });
    }
    return t.buildRaw(3);
});

export interface PlasterOpts { seed: number; color: string; stain: string; dirt: number }

export const plasterTexture = def('plasterTexture', (o: PlasterOpts, W: number = 1024, H: number = 1024): RawPBR => {
    const t = TB(W, H);
    const n = new Noise2D(o.seed), rnd = mulberry32(o.seed);
    const col = hex(o.color), stain = hex(o.stain);
    t.each((x, y, i) => {
      const b = n.fbm(x / 200, y / 200, 5);
      const drip = clamp01(n.fbm(x / 70, y / 600, 3) * 1.3) * o.dirt;
      const peel = smoothstep(0.42, 0.46, n.fbm(x / 140 + 40, y / 140, 5));
      let c = mix3(col, stain, clamp01(b * 0.8 + 0.3) * o.dirt * 0.8);
      c = mix3(c, [30, 28, 20], drip * 0.6);
      c = mix3(c, [70, 64, 52], peel * 0.8);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = n.fbm(x / 8, y / 8, 3) * 0.05 + b * 0.1 - peel * 0.5;
      t.rough[i] = 0.9;
    });
    for (let s = 0; s < 10; s++) {
      const pts: [number, number][] = [];
      let x = rnd() * W, y = rnd() * H;
      for (let k = 0; k < 12; k++) { pts.push([x, y]); x += (rnd() - 0.5) * 60; y += (rnd() - 0.3) * 50; }
      t.stroke(pts, 1.4, (i, c) => { t.height[i] -= c; t.blend(i, 18, 16, 12, c * 0.7); });
    }
    return t.buildRaw(3);
});

export const floorTexture = def('floorTexture', (seed: number, a: string, b: string, W: number = 1024): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed), rnd = mulberry32(seed);
    const ca = hex(a), cb = hex(b);
    const N = 8, tw = W / N;
    const tint = Array.from({ length: N * N }, () => 0.8 + rnd() * 0.3);
    t.each((x, y, i) => {
      const cx = Math.floor(x / tw), cy = Math.floor(y / tw);
      const lx = x % tw, ly = y % tw;
      const ed = Math.min(lx, tw - lx, ly, tw - ly);
      const g = smoothstep(0.8, 2.5, ed);
      const base = (cx + cy) % 2 ? ca : cb;
      const k = tint[cy * N + cx];
      let c = mix3([30, 28, 22], [base[0] * k, base[1] * k, base[2] * k], g);
      const d = clamp01(n.fbm(x / 150, y / 150, 5) + 0.25);
      c = mix3(c, [24, 22, 16], d * 0.6);
      const wet = smoothstep(0.35, 0.6, n.fbm(x / 300 + 4, y / 300, 3));
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = g * 0.3 + n.fbm(x / 10, y / 10, 2) * 0.04;
      t.rough[i] = lerp(0.85, 0.25, wet) + d * 0.1;
    });
    return t.buildRaw(2);
});

/** Generic grimy metal / rust. */
export const metalTexture = def('metalTexture', (seed: number, base: string, rust: number, W: number = 512): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed);
    const b = hex(base);
    t.each((x, y, i) => {
      const r = smoothstep(0.1, 0.6, n.fbm(x / 60, y / 60, 5) + 0.25) * rust;
      const pit = clamp01(n.fbm(x / 6, y / 6, 2));
      let c = mix3(b, [86, 46, 22], r);
      c = mix3(c, [40, 22, 12], pit * r * 0.6);
      const streak = n.fbm(x / 200, y / 4, 2) * 0.08;
      c = c.map((v) => v * (1 + streak));
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = -r * 0.2 - pit * r * 0.2 + n.fbm(x / 3, y / 3, 1) * 0.01;
      t.rough[i] = lerp(0.38, 0.95, r) + streak;
    });
    return t.buildRaw(2);
});

/** Woven cotton/canvas with stains. */
export const fabricTexture = def('fabricTexture', (seed: number, base: string, stain: number, W: number = 1024): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed), rnd = mulberry32(seed);
    const b = hex(base);
    t.each((x, y, i) => {
      const wx = Math.sin(x * 1.6) * 0.5 + 0.5, wy = Math.sin(y * 1.6) * 0.5 + 0.5;
      const weave = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? wx : wy;
      const fold = n.fbm(x / 260, y / 140, 3);
      const s = clamp01(n.fbm(x / 90 + 5, y / 90, 5) * 1.5 + 0.1) * stain;
      let c = b.map((v) => v * (0.85 + weave * 0.15 + fold * 0.25)) as number[];
      c = mix3(c, [46, 34, 20], s * 0.7);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = weave * 0.05 + fold * 0.35;
      t.rough[i] = 0.92;
    });
    // old dark spatter
    for (let k = 0; k < 40 * stain; k++) t.disc(rnd() * W, rnd() * W, 2 + rnd() * 12, (i, c) => t.blend(i, 55, 18, 12, smoothstep(0, 0.4, c) * 0.6));
    // tears / frayed holes
    for (let k = 0; k < 6 * stain; k++) t.disc(rnd() * W, rnd() * W, 5 + rnd() * 12, (i, c) => { const a = smoothstep(0.2, 0.5, c); t.blend(i, 12, 10, 8, a); t.height[i] -= a; });
    return t.buildRaw(2.5);
});

/** Brick (basement). */
export const brickTexture = def('brickTexture', (seed: number, W: number = 1024): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed), rnd = mulberry32(seed);
    const rows = 16, bh = W / rows, bw = bh * 2.1;
    const tint = Array.from({ length: 400 }, () => [0.75 + rnd() * 0.35, rnd()]);
    t.each((x, y, i) => {
      const r = Math.floor(y / bh);
      const xo = x + (r % 2) * bw * 0.5;
      const c0 = Math.floor(xo / bw);
      const lx = xo % bw, ly = y % bh;
      const ed = Math.min(lx, bw - lx, ly, bh - ly);
      const m = smoothstep(2, 5, ed + n.fbm(x / 5, y / 5, 2) * 2);
      const k = tint[(r * 20 + c0) % 400];
      let c = mix3([58, 54, 46], [96 * k[0], 52 * k[0], 36 * k[0]], m);
      const soot = clamp01(n.fbm(x / 160, y / 300, 4) + 0.2);
      c = mix3(c, [22, 20, 16], soot * 0.7);
      const eff = smoothstep(0.3, 0.7, n.fbm(x / 80 + 3, y / 80, 3)) * 0.5;
      c = mix3(c, [120, 116, 100], eff * 0.4);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = m * 0.6 + n.fbm(x / 7, y / 7, 3) * 0.1;
      t.rough[i] = 0.95;
    });
    return t.buildRaw(3);
});

/** Faded damask wallpaper (hotel). */
export const wallpaperTexture = def('wallpaperTexture', (seed: number, W: number = 1024): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed);
    t.each((x, y, i) => {
      const u = (x / W) * 6, v = (y / W) * 4;
      const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      const motif = Math.exp(-((fu * fu) * 30 + (fv * fv) * 12)) + 0.5 * Math.exp(-((Math.abs(fu) - 0.25) ** 2 * 80 + (fv + 0.2) ** 2 * 40));
      const stripe = Math.sin(x / W * Math.PI * 24) * 0.5 + 0.5;
      let c = mix3([74, 52, 40], [104, 78, 54], motif * 0.6 + stripe * 0.1);
      const water = clamp01(n.fbm(x / 200, y / 400, 5) * 1.6 + 0.2);
      c = mix3(c, [44, 34, 22], water * 0.7);
      const peel = smoothstep(0.45, 0.5, n.fbm(x / 150 + 2, y / 150, 4));
      c = mix3(c, [96, 88, 70], peel);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = motif * 0.05 - peel * 0.3;
      t.rough[i] = 0.85;
    });
    return t.buildRaw(2);
});

/** Wood wall panelling (office). */
export const panelTexture = def('panelTexture', (seed: number, W: number = 1024): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed);
    t.each((x, y, i) => {
      const pw = W / 4;
      const lx = x % pw;
      const g = grain(n, y / 200, x / 40 * 0.2, 5);
      const groove = 1 - smoothstep(0, 4, Math.min(lx, pw - lx));
      let c = mix3([70, 46, 28], [36, 22, 13], g.late * 0.7);
      c = mix3(c, [12, 8, 5], groove * 0.9);
      const d = clamp01(n.fbm(x / 160, y / 300, 4) + 0.1);
      c = mix3(c, [20, 14, 9], d * 0.5);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = -groove - g.late * 0.1;
      t.rough[i] = 0.5 + d * 0.3;
    });
    return t.buildRaw(2);
});

export const concreteTexture = def('concreteTexture', (seed: number, tint: string, W: number = 1024): RawPBR => {
    const t = TB(W, W);
    const n = new Noise2D(seed);
    const b = hex(tint);
    t.each((x, y, i) => {
      const v = n.fbm(x / 120, y / 120, 6);
      const pores = smoothstep(0.55, 0.7, n.fbm(x / 3, y / 3, 1) * 0.5 + 0.5);
      const streak = clamp01(n.fbm(x / 50, y / 500, 3) + 0.1);
      let c = b.map((q) => q * (0.85 + v * 0.3)) as number[];
      c = mix3(c, [20, 20, 16], streak * 0.55 + pores * 0.4);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = v * 0.2 - pores * 0.2;
      t.rough[i] = 0.92;
    });
    return t.buildRaw(2.5);
});

export const leatherTexture = def('leatherTexture', (seed: number, base: string, wear: number, W: number = 1024, H: number = 512): RawPBR => {
    const t = TB(W, H);
    const n = new Noise2D(seed);
    const b = hex(base);
    t.each((x, y, i) => {
      const cell = n.ridged(x / 6, y / 6, 3);
      const wr = smoothstep(0.2, 0.8, n.fbm(x / 70, y / 70, 4) + 0.2) * wear;
      let c = b.map((v) => v * (0.8 + cell * 0.3)) as number[];
      c = mix3(c, [118, 96, 72], wr * 0.6);
      t.setRGB(i, c[0], c[1], c[2]);
      t.height[i] = cell * 0.25 - wr * 0.1;
      t.rough[i] = 0.35 + wr * 0.45 + cell * 0.05;
    });
    return t.buildRaw(2);
});

/** Stencilled wall sign "WARD B" + arrow, as a transparent decal texture. */
export function signTexture(text: string, sub: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(28,26,20,0.9)';
  g.font = 'bold 190px "Courier Prime", "Courier New", monospace';
  g.textAlign = 'center';
  g.fillText(text, 512, 200);
  g.font = 'bold 150px "Courier Prime", "Courier New", monospace';
  g.fillText(sub, 512, 360);
  // arrow
  g.fillRect(400, 420, 220, 22);
  g.beginPath(); g.moveTo(640, 431); g.lineTo(590, 395); g.lineTo(590, 467); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(380, 431); g.lineTo(430, 395); g.lineTo(430, 467); g.closePath(); g.fill();
  // weathering: punch holes into the paint
  const img = g.getImageData(0, 0, 1024, 512);
  const n = new Noise2D(77);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    const v = n.fbm(x / 30, y / 30, 4) + n.simplex(x / 3, y / 3) * 0.15;
    img.data[i + 3] *= clamp01(0.75 + v * 1.4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
