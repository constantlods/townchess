import * as THREE from 'three';

/**
 * Signed-distance-field modelling + Naive Surface Nets meshing with automatic skin weights.
 * Used to build organic meshes (hands, arms, the opponent, the knight's head) procedurally,
 * so that joints blend smoothly instead of looking like separate primitives.
 */

export type V3 = [number, number, number];

export interface PrimBase {
  /** Bone index this primitive deforms with. */
  bone: number;
  /** Smooth-union radius used when merging this primitive (metres). */
  k?: number;
  /** Subtract instead of add. */
  sub?: boolean;
  /** Exclude from skin-weight computation (detail prims like veins). */
  noWeight?: boolean;
}
export interface ConePrim extends PrimBase { kind: 'cone'; a: V3; b: V3; ra: number; rb: number }
export interface EllPrim extends PrimBase { kind: 'ell'; c: V3; r: V3; q?: THREE.Quaternion }
export interface BoxPrim extends PrimBase { kind: 'box'; c: V3; h: V3; round: number; q?: THREE.Quaternion }
export type Prim = ConePrim | EllPrim | BoxPrim;

interface Compiled {
  kind: 0 | 1 | 2;
  bone: number; k: number; sub: boolean; noWeight: boolean;
  // cone
  ax: number; ay: number; az: number; bx: number; by: number; bz: number; ra: number; rb: number;
  // ell/box: center + inverse rotation matrix (3x3) + params
  cx: number; cy: number; cz: number;
  m: Float64Array; // world->local rotation
  hx: number; hy: number; hz: number; round: number;
  // bounds
  min: V3; max: V3;
}

function compile(p: Prim): Compiled {
  const c: Compiled = {
    kind: p.kind === 'cone' ? 0 : p.kind === 'ell' ? 1 : 2,
    bone: p.bone, k: p.k ?? 0.006, sub: !!p.sub, noWeight: !!p.noWeight,
    ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, ra: 0, rb: 0,
    cx: 0, cy: 0, cz: 0, m: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), hx: 0, hy: 0, hz: 0, round: 0,
    min: [0, 0, 0], max: [0, 0, 0],
  };
  if (p.kind === 'cone') {
    [c.ax, c.ay, c.az] = p.a; [c.bx, c.by, c.bz] = p.b; c.ra = p.ra; c.rb = p.rb;
    const r = Math.max(p.ra, p.rb);
    for (let i = 0; i < 3; i++) { c.min[i] = Math.min(p.a[i], p.b[i]) - r; c.max[i] = Math.max(p.a[i], p.b[i]) + r; }
  } else {
    [c.cx, c.cy, c.cz] = p.c;
    if (p.q) {
      const m4 = new THREE.Matrix4().makeRotationFromQuaternion(p.q.clone().invert());
      const e = m4.elements; // column-major
      c.m = new Float64Array([e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]);
    }
    const ext = p.kind === 'ell' ? Math.max(...p.r) : Math.max(...p.h) * 1.75 + p.round;
    if (p.kind === 'ell') { c.hx = p.r[0]; c.hy = p.r[1]; c.hz = p.r[2]; }
    else { c.hx = p.h[0]; c.hy = p.h[1]; c.hz = p.h[2]; c.round = p.round; }
    for (let i = 0; i < 3; i++) { c.min[i] = p.c[i] - ext; c.max[i] = p.c[i] + ext; }
  }
  return c;
}

function primDist(c: Compiled, x: number, y: number, z: number): number {
  if (c.kind === 0) {
    // iq's round cone between two points
    const bax = c.bx - c.ax, bay = c.by - c.ay, baz = c.bz - c.az;
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = c.ra - c.rb;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const pax = x - c.ax, pay = y - c.ay, paz = z - c.az;
    const yv = pax * bax + pay * bay + paz * baz;
    const zv = yv - l2;
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - c.rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - c.ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - c.ra;
  }
  const dx = x - c.cx, dy = y - c.cy, dz = z - c.cz;
  const m = c.m;
  const lx = m[0] * dx + m[1] * dy + m[2] * dz;
  const ly = m[3] * dx + m[4] * dy + m[5] * dz;
  const lz = m[6] * dx + m[7] * dy + m[8] * dz;
  if (c.kind === 1) {
    // ellipsoid (approximate, bound-correct)
    const k0 = Math.sqrt((lx / c.hx) ** 2 + (ly / c.hy) ** 2 + (lz / c.hz) ** 2);
    const k1 = Math.sqrt((lx / (c.hx * c.hx)) ** 2 + (ly / (c.hy * c.hy)) ** 2 + (lz / (c.hz * c.hz)) ** 2);
    return k1 < 1e-9 ? -Math.min(c.hx, c.hy, c.hz) : (k0 * (k0 - 1)) / k1;
  }
  const qx = Math.abs(lx) - c.hx, qy = Math.abs(ly) - c.hy, qz = Math.abs(lz) - c.hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - c.round;
}

const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export class SDFModel {
  readonly prims: Compiled[];
  displace?: (x: number, y: number, z: number) => number;
  constructor(prims: Prim[]) {
    this.prims = prims.map(compile);
  }
  dist(x: number, y: number, z: number): number {
    let d = 1e9;
    const ps = this.prims;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.sub) continue;
      // cheap bound reject
      const bx = Math.max(p.min[0] - x, 0, x - p.max[0]);
      const by = Math.max(p.min[1] - y, 0, y - p.max[1]);
      const bz = Math.max(p.min[2] - z, 0, z - p.max[2]);
      const bd = Math.sqrt(bx * bx + by * by + bz * bz);
      if (bd - p.k > d) continue;
      d = smin(d, primDist(p, x, y, z), p.k);
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.sub) continue;
      d = smax(d, -primDist(p, x, y, z), p.k);
    }
    if (this.displace) d += this.displace(x, y, z);
    return d;
  }
  bounds(margin: number): { min: V3; max: V3 } {
    const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
    for (const p of this.prims) {
      if (p.sub) continue;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p.min[i] - margin); max[i] = Math.max(max[i], p.max[i] + margin); }
    }
    return { min, max };
  }
}

export interface MeshOptions {
  cell: number;
  /** Skin-weight falloff (metres). Smaller = sharper joints. */
  falloff?: number;
  skin?: boolean;
  /** UV projection: planar on XZ (u from x, v from z), or 'cyl' around X axis. */
  uv?: 'xz' | 'xy' | 'cylY';
  /** Per-bone region id (for material groups). */
  boneRegion?: number[];
  /** Bake a cavity term into vertex colours. */
  cavity?: number;
  bounds?: { min: V3; max: V3 };
}

export function meshSDF(model: SDFModel, opt: MeshOptions): THREE.BufferGeometry {
  const h = opt.cell;
  const { min, max } = opt.bounds ?? model.bounds(h * 3);
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // Block-skipping evaluation: if the surface cannot cross a block's bounding sphere,
  // every sample in that block shares the centre's sign, so one evaluation suffices.
  const B = 4;
  const halfDiag = Math.sqrt(3) * (B - 1) * h * 0.5;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const ei = Math.min(nx, bi + B), ej = Math.min(ny, bj + B), ek = Math.min(nz, bk + B);
    const cx = min[0] + (bi + (ei - bi - 1) / 2) * h, cy = min[1] + (bj + (ej - bj - 1) / 2) * h, cz = min[2] + (bk + (ek - bk - 1) / 2) * h;
    const dc = model.dist(cx, cy, cz);
    if (Math.abs(dc) > halfDiag * 1.25 + h) {
      for (let k = bk; k < ek; k++) for (let j = bj; j < ej; j++) for (let i = bi; i < ei; i++) field[idx(i, j, k)] = dc;
      continue;
    }
    for (let k = bk; k < ek; k++) for (let j = bj; j < ej; j++) for (let i = bi; i < ei; i++) {
      field[idx(i, j, k)] = model.dist(min[0] + i * h, min[1] + j * h, min[2] + k * h);
    }
  }
  // vertices per cell
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const cc = corners[c];
      v[c] = field[idx(i + cc[0], j + cc[1], k + cc[2])];
      if (v[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      const ca = corners[a], cb = corners[b];
      sx += ca[0] + (cb[0] - ca[0]) * t; sy += ca[1] + (cb[1] - ca[1]) * t; sz += ca[2] + (cb[2] - ca[2]) * t;
      cnt++;
    }
    cellVert[cidx(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / cnt) * h, min[1] + (j + sy / cnt) * h, min[2] + (k + sz / cnt) * h);
  }
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c); else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    // x-edges
    const a = field[idx(i, j, k)] < 0, b = field[idx(i + 1, j, k)] < 0;
    if (a !== b) quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], b);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = field[idx(i, j, k)] < 0, b = field[idx(i, j + 1, k)] < 0;
    if (a !== b) quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], b);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = field[idx(i, j, k)] < 0, b = field[idx(i, j, k + 1)] < 0;
    if (a !== b) quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], b);
  }

  // project vertices onto the surface & compute gradient normals
  const n = pos.length / 3;
  const normals = new Float32Array(n * 3);
  const e = h * 0.25;
  for (let vI = 0; vI < n; vI++) {
    let x = pos[vI * 3], y = pos[vI * 3 + 1], z = pos[vI * 3 + 2];
    let gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 2; it++) {
      // tetrahedral gradient (4 taps); the average of the taps approximates d at the centre
      const a = model.dist(x + e, y - e, z - e), b = model.dist(x - e, y - e, z + e);
      const c = model.dist(x - e, y + e, z - e), dd = model.dist(x + e, y + e, z + e);
      gx = a - b - c + dd; gy = -a - b + c + dd; gz = -a + b - c + dd;
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      if (it === 0) {
        const d = (a + b + c + dd) * 0.25;
        const step = Math.max(-h, Math.min(h, d));
        x -= gx * step; y -= gy * step; z -= gz * step;
      }
    }
    pos[vI * 3] = x; pos[vI * 3 + 1] = y; pos[vI * 3 + 2] = z;
    normals[vI * 3] = gx; normals[vI * 3 + 1] = gy; normals[vI * 3 + 2] = gz;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  // UVs
  const uv = new Float32Array(n * 2);
  const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
  for (let vI = 0; vI < n; vI++) {
    const x = pos[vI * 3], y = pos[vI * 3 + 1], z = pos[vI * 3 + 2];
    if (opt.uv === 'xy') { uv[vI * 2] = (x - min[0]) / sx; uv[vI * 2 + 1] = (y - min[1]) / sy; }
    else if (opt.uv === 'cylY') { uv[vI * 2] = Math.atan2(z - (min[2] + sz / 2), x - (min[0] + sx / 2)) / (Math.PI * 2) + 0.5; uv[vI * 2 + 1] = (y - min[1]) / sy; }
    else { uv[vI * 2] = (x - min[0]) / sx; uv[vI * 2 + 1] = (z - min[2]) / sz; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  // cavity / ambient-occlusion approximation baked into vertex colours
  const cav = opt.cavity ?? 0;
  const col = new Float32Array(n * 3).fill(1);
  if (cav > 0) {
    for (let vI = 0; vI < n; vI++) {
      const x = pos[vI * 3], y = pos[vI * 3 + 1], z = pos[vI * 3 + 2];
      const nx_ = normals[vI * 3], ny_ = normals[vI * 3 + 1], nz_ = normals[vI * 3 + 2];
      let occ = 0;
      for (let s = 1; s <= 2; s++) {
        const dd = cav * s * 1.4;
        const d = model.dist(x + nx_ * dd, y + ny_ * dd, z + nz_ * dd);
        occ += Math.max(0, dd - d) / dd / s;
      }
      const a = Math.max(0.35, 1 - occ * 0.9);
      col[vI * 3] = col[vI * 3 + 1] = col[vI * 3 + 2] = a;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  // Skin weights
  let regionOfVert: Uint8Array | null = null;
  if (opt.skin) {
    const fall = opt.falloff ?? 0.006;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const nb = Math.max(...model.prims.map((p) => p.bone)) + 1;
    const acc = new Float64Array(nb);
    regionOfVert = new Uint8Array(n);
    for (let vI = 0; vI < n; vI++) {
      const x = pos[vI * 3], y = pos[vI * 3 + 1], z = pos[vI * 3 + 2];
      acc.fill(0);
      let dmin = 1e9;
      const ds: number[] = [];
      for (const p of model.prims) {
        if (p.sub || p.noWeight) { ds.push(1e9); continue; }
        const d = primDist(p, x, y, z);
        ds.push(d);
        if (d < dmin) dmin = d;
      }
      model.prims.forEach((p, pi) => {
        if (ds[pi] > 1e8) return;
        acc[p.bone] += Math.exp(-(ds[pi] - dmin) / fall);
      });
      const order = Array.from(acc.keys()).sort((a, b) => acc[b] - acc[a]).slice(0, 4);
      let tot = 0;
      for (const b of order) tot += acc[b];
      order.forEach((b, s) => { si[vI * 4 + s] = b; sw[vI * 4 + s] = acc[b] / tot; });
      if (opt.boneRegion) regionOfVert[vI] = opt.boneRegion[order[0]] ?? 0;
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }

  // Index + material groups by region
  if (regionOfVert && opt.boneRegion) {
    const groups = new Map<number, number[]>();
    for (let t = 0; t < index.length; t += 3) {
      const r = Math.max(regionOfVert[index[t]], regionOfVert[index[t + 1]], regionOfVert[index[t + 2]]);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(index[t], index[t + 1], index[t + 2]);
    }
    const all: number[] = [];
    const keys = [...groups.keys()].sort();
    for (const r of keys) {
      const g = groups.get(r)!;
      geo.addGroup(all.length, g.length, r);
      for (const q of g) all.push(q);
    }
    geo.setIndex(all);
  } else {
    geo.setIndex(index);
  }
  geo.computeBoundingSphere();
  return geo;
}

/** Find the top surface height of the model at (x,z) by scanning down from yTop. */
export function surfaceY(model: SDFModel, x: number, z: number, yTop: number, yBot: number): number | null {
  let y = yTop;
  for (let i = 0; i < 400 && y > yBot; i++) {
    const d = model.dist(x, y, z);
    if (d < 0.0002) return y;
    y -= Math.max(d, 0.0002);
  }
  return null;
}
