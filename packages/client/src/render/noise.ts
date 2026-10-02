/** Small, fast deterministic noise utilities used for all procedural textures and geometry. */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class Noise2D {
  private perm = new Uint8Array(512);
  private vals = new Float32Array(256);
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.vals[i] = rnd() * 2 - 1;
  }
  /** Fast value noise in [-1, 1] (used by fbm; ~4x cheaper than simplex). */
  value(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const perm = this.perm, vals = this.vals;
    const X = xi & 255, Y = yi & 255;
    const a = perm[X + perm[Y]], b = perm[X + 1 + perm[Y]];
    const c = perm[X + perm[Y + 1]], d = perm[X + 1 + perm[Y + 1]];
    const top = vals[a] + (vals[b] - vals[a]) * u;
    const bot = vals[c] + (vals[d] - vals[c]) * u;
    return top + (bot - top) * v;
  }
  /** Simplex noise in [-1, 1]. */
  simplex(xin: number, yin: number): number {
    const F2 = 0.3660254037844386, G2 = 0.21132486540518713;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const perm = this.perm;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  }
  fbm(x: number, y: number, oct = 4, lac = 2, gain = 0.5): number {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      // rotate each octave slightly to hide lattice alignment
      const rx = x * f + o * 17.31, ry = y * f - o * 9.73;
      s += a * this.value(rx * 0.8 + ry * 0.6, ry * 0.8 - rx * 0.6);
      norm += a; a *= gain; f *= lac;
    }
    return s / norm;
  }
  ridged(x: number, y: number, oct = 4): number {
    let a = 0.5, f = 1, s = 0;
    for (let o = 0; o < oct; o++) {
      s += a * (1 - Math.abs(this.value(x * f + o * 7.1, y * f - o * 3.3)));
      a *= 0.5; f *= 2;
    }
    return s;
  }
}

/** Cheap 3D value noise (for geometry displacement). */
export class Noise3D {
  private n2: Noise2D;
  constructor(seed = 1) { this.n2 = new Noise2D(seed); }
  noise(x: number, y: number, z: number): number {
    // Sum of two rotated 2D slices — adequate for subtle surface displacement.
    return 0.5 * (this.n2.simplex(x + z * 0.73, y - z * 0.41) + this.n2.simplex(y * 0.91 + z, x * 1.07 - z * 0.37));
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
