import * as THREE from 'three';
import { SDFModel, meshSDF, type Prim, type V3 } from '../render/sdf';
import { hex, type RawPBR } from '../render/canvasTex';
import { Noise2D, mulberry32, clamp01, smoothstep, lerp } from '../render/noise';
import { def, TB } from '../render/textures';
import { defGeo } from '../render/geometry';

/**
 * Procedural, anatomically proportioned human forearm + hand.
 * Arm space: origin at the wrist joint, +X toward the fingertips, +Y dorsal (back of hand), +Z right.
 * The forearm bone is the root (at the elbow).
 */

export type Side = 'left' | 'right';

export const BONE = { forearm: 0, hand: 1, thumbMeta: 14, thumbProx: 15, thumbDist: 16 } as const;
export const fingerBone = (f: number, j: number) => 2 + f * 3 + j;
export const BONE_COUNT = 17;
export const FOREARM_LEN = 0.27;

export interface FingerDef { x: number; y: number; z: number; len: [number, number, number]; r: [number, number, number, number]; spread: number }

export function fingerDefs(side: Side): FingerDef[] {
  const t = side === 'right' ? -1 : 1; // thumb side z sign
  return [
    { x: 0.087, y: 0.003, z: t * 0.024, len: [0.044, 0.026, 0.021], r: [0.0094, 0.0084, 0.0077, 0.0066], spread: -t * 0.09 },
    { x: 0.091, y: 0.004, z: t * 0.006, len: [0.048, 0.030, 0.023], r: [0.0097, 0.0087, 0.0079, 0.0068], spread: -t * 0.015 },
    { x: 0.087, y: 0.003, z: -t * 0.0125, len: [0.045, 0.028, 0.022], r: [0.0091, 0.0082, 0.0075, 0.0064], spread: t * 0.05 },
    { x: 0.077, y: 0.0, z: -t * 0.029, len: [0.035, 0.021, 0.019], r: [0.0080, 0.0072, 0.0066, 0.0057], spread: t * 0.14 },
  ];
}

/** Bind-pose curl (radians) for [mcp, pip, dip]: relaxed, slightly flexed. */
const BIND_CURL: [number, number, number] = [-0.12, -0.2, -0.12];

export interface RigBuild {
  bones: THREE.Bone[];
  prims: Prim[];
  bindWorld: THREE.Matrix4[];
  nailSlots: { bone: number; len: number; r: number }[];
}

export function buildRig(side: Side): RigBuild {
  const t = side === 'right' ? -1 : 1;
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONE_COUNT; i++) { const b = new THREE.Bone(); b.name = `b${i}`; bones.push(b); }
  // forearm root at elbow
  bones[0].position.set(-FOREARM_LEN, 0, 0);
  bones[1].position.set(FOREARM_LEN, 0, 0);
  bones[0].add(bones[1]);
  const fds = fingerDefs(side);
  fds.forEach((f, fi) => {
    const p = bones[fingerBone(fi, 0)], m = bones[fingerBone(fi, 1)], d = bones[fingerBone(fi, 2)];
    p.position.set(f.x, f.y, f.z);
    p.quaternion.setFromEuler(new THREE.Euler(0, f.spread, BIND_CURL[0], 'YZX'));
    m.position.set(f.len[0], 0, 0);
    m.quaternion.setFromEuler(new THREE.Euler(0, 0, BIND_CURL[1]));
    d.position.set(f.len[1], 0, 0);
    d.quaternion.setFromEuler(new THREE.Euler(0, 0, BIND_CURL[2]));
    bones[1].add(p); p.add(m); m.add(d);
  });
  // thumb
  const tm = bones[14], tp = bones[15], td = bones[16];
  tm.position.set(0.018, -0.009, t * 0.020);
  // direction forward-outward-down
  const dir = new THREE.Vector3(0.66, -0.3, t * 0.69).normalize();
  tm.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  tm.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(t * 0.9, 0, 0))); // roll so thumbnail faces outward/up
  tp.position.set(0.044, 0, 0);
  tp.quaternion.setFromEuler(new THREE.Euler(0, -t * 0.45, -0.15));
  td.position.set(0.032, 0, 0);
  td.quaternion.setFromEuler(new THREE.Euler(0, 0, -0.2));
  bones[1].add(tm); tm.add(tp); tp.add(td);

  bones[0].updateMatrixWorld(true);
  // bindWorld relative to forearm root's parent (arm space with origin at wrist => offset root)
  const bindWorld = bones.map((b) => b.matrixWorld.clone());
  const P = (bi: number, x: number, y = 0, z = 0): V3 => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(bindWorld[bi]);
    return [v.x, v.y, v.z];
  };

  const prims: Prim[] = [];
  // ── forearm: two parallel tapered cones give an elliptical cross-section ──
  for (const s of [-1, 1]) {
    prims.push({ kind: 'cone', a: [-FOREARM_LEN - 0.03, 0.002, s * 0.0135], b: [-0.03, 0.0, s * 0.0105], ra: 0.03, rb: 0.0158, bone: 0, k: 0.02 });
  }
  prims.push({ kind: 'ell', c: [-0.2, 0.006, t * 0.006], r: [0.085, 0.034, 0.036], bone: 0, k: 0.03 });
  prims.push({ kind: 'ell', c: [-0.012, -0.001, 0], r: [0.022, 0.0142, 0.0285], bone: 1, k: 0.012 });
  // ulna head bump (little-finger side of wrist)
  prims.push({ kind: 'ell', c: [-0.012, 0.009, -t * 0.022], r: [0.007, 0.005, 0.006], bone: 0, k: 0.006 });
  // ── palm ──
  prims.push({ kind: 'box', c: [0.047, -0.0015, -t * 0.002], h: [0.034, 0.0045, 0.029], round: 0.0095, bone: 1, k: 0.01 });
  // thenar / hypothenar eminences on the palm side
  prims.push({ kind: 'ell', c: [0.026, -0.0105, t * 0.019], r: [0.027, 0.011, 0.016], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t * 0.5, 0)), bone: 14, k: 0.01 });
  prims.push({ kind: 'ell', c: [0.042, -0.0085, -t * 0.026], r: [0.034, 0.0095, 0.0105], bone: 1, k: 0.01 });
  fds.forEach((f, fi) => {
    // metacarpal ridges + knuckle heads
    prims.push({ kind: 'cone', a: [0.012, 0.004, f.z * 0.45], b: [f.x - 0.006, f.y + 0.001, f.z], ra: 0.0062, rb: f.r[0] * 0.92, bone: 1, k: 0.008 });
    prims.push({ kind: 'ell', c: [f.x - 0.002, f.y + 0.0035, f.z], r: [0.0075, 0.0058, f.r[0] * 0.9], bone: 1, k: 0.005 });
    // finger segments
    for (let j = 0; j < 3; j++) {
      const bi = fingerBone(fi, j);
      const len = f.len[j];
      prims.push({ kind: 'cone', a: P(bi, 0), b: P(bi, len - (j === 2 ? f.r[3] * 0.9 : 0)), ra: f.r[j], rb: f.r[j + 1], bone: bi, k: j === 0 ? 0.006 : 0.0035 });
      // dorsal joint bumps
      if (j > 0) prims.push({ kind: 'ell', c: P(bi, 0.0005, f.r[j] * 0.35), r: [0.0052, 0.0045, f.r[j] * 0.85], bone: bi, k: 0.003 });
      // palmar pads
      prims.push({ kind: 'ell', c: P(bi, len * 0.5, -f.r[j] * 0.28), r: [len * 0.42, f.r[j] * 0.8, f.r[j] * 0.92], bone: bi, k: 0.003 });
    }
    // web between fingers (on proximal segment base)
    prims.push({ kind: 'ell', c: P(fingerBone(fi, 0), 0.008, -0.002), r: [0.012, 0.006, f.r[0] * 1.15], bone: fingerBone(fi, 0), k: 0.006 });
  });
  // thumb segments
  const tr = [0.0122, 0.0108, 0.0096, 0.0080];
  const tl = [0.044, 0.032, 0.027];
  for (let j = 0; j < 3; j++) {
    const bi = 14 + j;
    prims.push({ kind: 'cone', a: P(bi, 0), b: P(bi, tl[j] - (j === 2 ? 0.007 : 0)), ra: tr[j], rb: tr[j + 1], bone: bi, k: j === 0 ? 0.012 : 0.004 });
    if (j > 0) prims.push({ kind: 'ell', c: P(bi, tl[j] * 0.5, 0, -t * 0.003), r: [tl[j] * 0.45, tr[j] * 0.8, tr[j] * 0.95], bone: bi, k: 0.003 });
  }
  const nailSlots = [
    ...fds.map((f, fi) => ({ bone: fingerBone(fi, 2), len: f.len[2], r: f.r[2] })),
    { bone: 16, len: tl[2], r: tr[2] },
  ];
  return { bones, prims, bindWorld, nailSlots };
}

/** Region per bone: 0 forearm, 1 hand (palm + proximal/middle phalanges), 2 fingertips. */
export const BONE_REGION = Array.from({ length: BONE_COUNT }, (_, i) => {
  if (i === 0) return 0;
  if (i === 1 || i === 14 || i === 15) return 1;
  if (i === 16) return 2;
  return (i - 2) % 3 === 2 ? 2 : 1;
});

/** Texture-space mapping for the planar (top-down) UV projection used by the skin. */
export const UVB = { minX: -0.33, maxX: 0.22, minZ: -0.075, maxZ: 0.075 };

/** Skinned forearm+hand mesh (memoised / worker-generated). Pair with `buildRig(side)` for the skeleton. */
export const handGeometry = defGeo('hand', (side: Side) => buildHandGeometry(side).geo);

export function buildHandGeometry(side: Side, cell = 0.0019): { geo: THREE.BufferGeometry; rig: RigBuild } {
  const rig = buildRig(side);
  const model = new SDFModel(rig.prims);
  const geo = meshSDF(model, {
    cell, skin: true, falloff: 0.0045, boneRegion: BONE_REGION, cavity: 0.0035,
    bounds: { min: [UVB.minX + 0.02, -0.055, UVB.minZ], max: [UVB.maxX, 0.045, UVB.maxZ] },
  });
  // Planar top-down UVs in fixed arm-space bounds (so textures line up with anatomy).
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - UVB.minX) / (UVB.maxX - UVB.minX), (pos.getZ(i) - UVB.minZ) / (UVB.maxZ - UVB.minZ));
  }
  uv.needsUpdate = true;
  return { geo, rig };
}

export type SkinVariant = 'bare' | 'dirty' | 'scarred' | 'tattooed';

/** Anatomically placed skin texture: veins, tendons, knuckle creases, pores, grime, scars, ink. */
export const handSkinTexture = def('handSkinTexture', (variant: SkinVariant, side: Side, tone: string = '#b88a6e', W: number = 2048, H: number = 560): RawPBR => {
  const tb = TB(W, H);
  const n = new Noise2D(7), n2 = new Noise2D(19), rnd = mulberry32(side === 'left' ? 3 : 5);
  const base = hex(tone);
  const px = (x: number) => ((x - UVB.minX) / (UVB.maxX - UVB.minX)) * W;
  const pz = (z: number) => ((z - UVB.minZ) / (UVB.maxZ - UVB.minZ)) * H;
  const dirt = variant === 'bare' ? 0.3 : variant === 'dirty' ? 1 : 0.6;
  tb.each((x, y, i) => {
    const mott = n.fbm(x / 70, y / 70, 4);
    const red = clamp01(n.fbm(x / 160 + 5, y / 160, 3) + 0.25);
    let c = base.map((v) => v * (0.9 + mott * 0.12)) as number[];
    c = [lerp(c[0], 168, red * 0.16), lerp(c[1], 80, red * 0.16), lerp(c[2], 66, red * 0.16)];
    // slightly darker, hairier forearm; redder knuckles
    const ax = UVB.minX + (x / W) * (UVB.maxX - UVB.minX);
    if (ax < -0.02) c = c.map((v) => v * 0.95);
    if (ax > 0.07 && ax < 0.1) c = [c[0] * 1.03, c[1] * 0.97, c[2] * 0.96];
    const pore = smoothstep(0.55, 0.95, n2.simplex(x / 1.6, y / 1.6));
    const grime = clamp01(n.fbm(x / 50 + 11, y / 50, 5) * 1.5 + 0.05) * dirt;
    // grime collects in creases near fingertips and nails
    const tipDirt = smoothstep(0.16, 0.2, ax) * dirt * 0.6;
    c = [lerp(c[0], 58, grime * 0.42 + tipDirt * 0.4), lerp(c[1], 42, grime * 0.42 + tipDirt * 0.4), lerp(c[2], 28, grime * 0.42 + tipDirt * 0.4)];
    tb.setRGB(i, c[0], c[1], c[2]);
    tb.height[i] = -pore * 0.1 + mott * 0.04 + n2.simplex(x / 5, y / 14) * 0.03;
    tb.rough[i] = 0.52 + grime * 0.22 + pore * 0.08;
  });
  // fine hairs on forearm
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * px(-0.03), y = rnd() * H, a = 0.25 + (rnd() - 0.5) * 0.5, l = 5 + rnd() * 9;
    tb.stroke([[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l]], 0.6, (i, c) => tb.mul(i, 1 - c * 0.25));
  }
  // veins: wandering paths from forearm across the back of the hand toward the gaps between knuckles
  const fds = fingerDefs(side);
  const gaps = [0, 1, 2].map((g) => (fds[g].z + fds[g + 1].z) / 2);
  const vein = (pts: [number, number][], w: number) => tb.stroke(pts, w, (i, c) => {
    const a = smoothstep(0, 1, c);
    tb.height[i] += a * 0.55;
    tb.blend(i, 92, 88, 104, a * 0.22);
  });
  for (let v = 0; v < 3; v++) {
    const pts: [number, number][] = [];
    let z = (rnd() - 0.5) * 0.02;
    for (let s = 0; s <= 30; s++) {
      const x = -0.25 + (s / 30) * (0.07 + 0.25);
      const target = x > 0.0 ? gaps[v] : z;
      z = lerp(z, target, x > 0 ? 0.12 : 0.02) + (n.simplex(s * 0.3, v * 7) * 0.0012);
      pts.push([px(x), pz(z)]);
    }
    vein(pts, 7 - v);
    // a branch
    const b0 = 10 + Math.floor(rnd() * 10);
    const br: [number, number][] = pts.slice(b0, b0 + 1).map((p) => [p[0], p[1]] as [number, number]);
    let bx = br[0][0], bz = br[0][1];
    for (let s = 0; s < 8; s++) { bx += 22; bz += (rnd() - 0.4) * 30; br.push([bx, bz]); }
    vein(br, 4);
  }
  // knuckle creases: across each finger at MCP, PIP and DIP
  fds.forEach((f) => {
    const cosS = Math.cos(f.spread), sinS = Math.sin(f.spread);
    let along = 0;
    for (let j = 0; j < 3; j++) {
      const jx = f.x + cosS * along, jz = f.z - sinS * along;
      const lines = j === 0 ? 6 : 9;
      for (let l = 0; l < lines; l++) {
        const off = (l - lines / 2) * 0.0009 + (rnd() - 0.5) * 0.0005;
        const cx = px(jx + off), cz = pz(jz);
        const half = (H / (UVB.maxZ - UVB.minZ)) * f.r[j] * (0.5 + rnd() * 0.4);
        const bend = (rnd() - 0.5) * 6;
        tb.stroke([[cx - 2, cz - half], [cx + bend, cz], [cx - 2, cz + half]], 1.3, (i, c) => { tb.height[i] -= c * 0.4; tb.mul(i, 1 - c * 0.22); });
      }
      along += f.len[j];
    }
  });
  // wrist creases
  for (let l = 0; l < 3; l++) {
    const x = px(-0.004 - l * 0.004);
    tb.stroke([[x, pz(-0.03)], [x + 4, pz(0)], [x, pz(0.03)]], 1.4, (i, c) => { tb.height[i] -= c * 0.3; tb.mul(i, 1 - c * 0.15); });
  }
  // dirt / dried stains
  if (variant !== 'bare') {
    const count = variant === 'dirty' ? 22 : 8;
    for (let s = 0; s < count; s++) {
      const cx = px(-0.1 + rnd() * 0.3), cy = rnd() * H, r = 12 + rnd() * 40;
      tb.disc(cx, cy, r, (i, c) => {
        const a = smoothstep(0, 0.7, c + n.fbm((i % W) / 25, i / W / 25, 2) * 0.5) * (variant === 'dirty' ? 0.55 : 0.3);
        tb.blend(i, 66, 30, 20, a);
      });
    }
  }
  if (variant === 'scarred') {
    for (let s = 0; s < 6; s++) {
      const x0 = px(-0.2 + rnd() * 0.28), y0 = rnd() * H, a = rnd() * Math.PI, len = 60 + rnd() * 200;
      const pts: [number, number][] = [];
      for (let k = 0; k <= 6; k++) pts.push([x0 + Math.cos(a) * len * k / 6 + (rnd() - 0.5) * 6, y0 + Math.sin(a) * len * k / 6 + (rnd() - 0.5) * 6]);
      tb.stroke(pts, 5 + rnd() * 4, (i, c) => { tb.height[i] += c * 0.6; tb.blend(i, 184, 120, 110, c * 0.6); tb.rough[i] = 0.35; });
      for (let k = 1; k < 8; k++) {
        const qx = x0 + Math.cos(a) * len * k / 8, qy = y0 + Math.sin(a) * len * k / 8;
        tb.stroke([[qx - Math.sin(a) * 10, qy + Math.cos(a) * 10], [qx + Math.sin(a) * 10, qy - Math.cos(a) * 10]], 1.6, (i, c) => { tb.height[i] -= c * 0.3; tb.blend(i, 96, 44, 40, c * 0.75); });
      }
    }
  }
  if (variant === 'tattooed') {
    const ink = (i: number, c: number) => tb.blend(i, 34, 42, 46, smoothstep(0, 0.5, c) * 0.75);
    // banded thorn pattern around forearm
    for (const bx of [-0.2, -0.13]) {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 50; k++) pts.push([px(bx) + Math.sin(k * 0.8) * 10, (k / 50) * H]);
      tb.stroke(pts, 4, ink);
      for (let k = 0; k < 16; k++) { const y = (k / 16) * H; tb.stroke([[px(bx), y], [px(bx) + 24, y + 10]], 2.2, ink); tb.stroke([[px(bx), y], [px(bx) - 24, y + 10]], 2.2, ink); }
    }
    // concentric wheel glyph on the back of the hand
    const gx = px(0.045), gy = pz(0);
    for (const r of [44, 64]) {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 48; k++) pts.push([gx + Math.cos((k / 48) * Math.PI * 2) * r, gy + Math.sin((k / 48) * Math.PI * 2) * r * 1.0]);
      tb.stroke(pts, 3.2, ink);
    }
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; tb.stroke([[gx + Math.cos(a) * 64, gy + Math.sin(a) * 64], [gx + Math.cos(a) * 98, gy + Math.sin(a) * 98]], 2.8, ink); }
    tb.disc(gx, gy, 18, (i, c) => ink(i, c * 2));
    // finger glyph dots
    fds.forEach((f) => tb.disc(px(f.x + 0.032), pz(f.z), 9, (i, c) => ink(i, c * 2)));
  }
  return tb.buildRaw(1.8, false);
});
