import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Color, PieceType } from '@hc/shared';
import { SDFModel, meshSDF, type Prim } from '../render/sdf';
import { pieceTexture } from '../render/textures';
import { defGeo } from '../render/geometry';
import { Noise3D, mulberry32 } from '../render/noise';

/** Board square size in metres. All piece dimensions are relative to this real-world scale. */
export const SQUARE = 0.05;

type P2 = [number, number]; // (radius, height)

/** Catmull-Rom resample of a profile so lathes are smooth. */
function smoothProfile(pts: P2[], perSeg = 6): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([Math.max(0, f(p0[0], p1[0], p2[0], p3[0])), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const arc = (cy: number, r: number, a0: number, a1: number, n = 10, cx = 0): P2[] => {
  const o: P2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return o;
};

/** Standard turned base shared by all pieces (felt pad, plinth, beads). Scale by base radius. */
function base(R: number): P2[] {
  return [
    [0, 0], [R * 0.97, 0], [R, R * 0.06], [R, R * 0.16], [R * 0.96, R * 0.22],
    [R * 0.9, R * 0.25], [R * 0.92, R * 0.31], [R * 0.86, R * 0.37], [R * 0.74, R * 0.4],
    [R * 0.7, R * 0.46], [R * 0.74, R * 0.52], [R * 0.66, R * 0.58],
  ];
}

const PROFILES: Record<PieceType, () => P2[]> = {
  p: () => {
    const R = 0.0142;
    return [...base(R), [0.0074, 0.0115], [0.0058, 0.017], [0.0050, 0.0225],
      [0.0082, 0.0245], [0.0086, 0.0262], [0.0074, 0.0278], [0.0050, 0.0288],
      ...arc(0.0352, 0.0078, -1.25, Math.PI / 2, 12)];
  },
  r: () => {
    const R = 0.0165;
    return [...base(R), [0.0108, 0.0125], [0.0100, 0.02], [0.0096, 0.032], [0.0098, 0.0375],
      [0.0118, 0.040], [0.0126, 0.0425], [0.0122, 0.0445], [0.0128, 0.046]];
  },
  n: () => {
    const R = 0.0162;
    return [...base(R), [0.0104, 0.0118], [0.0098, 0.0135]];
  },
  b: () => {
    const R = 0.0152;
    return [...base(R), [0.0086, 0.0125], [0.0066, 0.022], [0.0056, 0.034], [0.0054, 0.039],
      [0.0090, 0.0405], [0.0094, 0.0420], [0.0072, 0.0436], [0.0050, 0.0445]];
  },
  q: () => {
    const R = 0.0172;
    return [...base(R), [0.0098, 0.013], [0.0074, 0.025], [0.0062, 0.040], [0.0060, 0.046],
      [0.0104, 0.0478], [0.0108, 0.0496], [0.0084, 0.0512], [0.0068, 0.0525],
      [0.0074, 0.056], [0.0098, 0.0625], [0.0108, 0.0655], [0.0098, 0.0668]];
  },
  k: () => {
    const R = 0.0178;
    return [...base(R), [0.0102, 0.0135], [0.0078, 0.026], [0.0066, 0.044], [0.0064, 0.050],
      [0.0108, 0.0518], [0.0112, 0.0538], [0.0088, 0.0555], [0.0070, 0.0568],
      [0.0078, 0.060], [0.0100, 0.0665], [0.0106, 0.0690], [0.0086, 0.0705],
      ...arc(0.0705, 0.0086, 0, Math.PI / 2, 8).slice(1)];
  },
};

/** Lathe with UV (u around, v up), normals and cavity vertex colours from profile curvature. */
function lathe(profile: P2[], segs = 48, jitter = 0.00012, seed = 1): THREE.BufferGeometry {
  const pts = smoothProfile(profile, 5);
  const n3 = new Noise3D(seed);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  // cavity: concave points where the profile turns inward between two outward bulges
  const cav = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const mid = (a[0] + b[0]) / 2;
    return Math.max(0, Math.min(1, (mid - p[0]) / 0.0008));
  });
  const H = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length; i++) {
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const [r0, y] = pts[i];
      const r = r0 > 0 ? r0 + n3.noise(Math.cos(a) * 3, y * 200, Math.sin(a) * 3) * jitter : 0;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push(s / segs, y / Math.max(H, 0.001));
      const c = 1 - cav[i] * 0.55;
      col.push(c, c, c);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < segs; s++) {
    const a = i * (segs + 1) + s, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Weld seam normals
  return g;
}

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

/** Sculpted SDF heads (knight, bishop mitre, rook crown, queen coronet, king cross). */
function heads(type: PieceType): Prim[] | null {
  switch (type) {
    case 'n': {
      const s: Prim[] = [
        // chest & neck, leaning back slightly
        { kind: 'ell', c: [0.002, 0.020, 0], r: [0.0108, 0.0095, 0.0082], bone: 0, k: 0.004 },
        { kind: 'ell', c: [-0.0015, 0.0305, 0], r: [0.0092, 0.0135, 0.0074], q: q(0, 0, 0.32), bone: 0, k: 0.005 },
        // skull & cheek
        { kind: 'ell', c: [0.0030, 0.0435, 0], r: [0.0088, 0.0074, 0.0068], q: q(0, 0, -0.25), bone: 0, k: 0.004 },
        { kind: 'ell', c: [0.0040, 0.0385, 0], r: [0.0078, 0.0058, 0.0071], bone: 0, k: 0.004 },
        // muzzle, pointing forward/down
        { kind: 'cone', a: [0.008, 0.0425, 0], b: [0.0195, 0.0352, 0], ra: 0.0060, rb: 0.0047, bone: 0, k: 0.004 },
        // brow ridge
        { kind: 'ell', c: [0.0072, 0.0472, 0], r: [0.0045, 0.0022, 0.0062], bone: 0, k: 0.003 },
        // ears
        { kind: 'cone', a: [-0.0005, 0.0495, 0.0034], b: [-0.0022, 0.0585, 0.0028], ra: 0.0024, rb: 0.0006, bone: 0, k: 0.0018 },
        { kind: 'cone', a: [-0.0005, 0.0495, -0.0034], b: [-0.0022, 0.0585, -0.0028], ra: 0.0024, rb: 0.0006, bone: 0, k: 0.0018 },
        // eye sockets, nostrils, mouth (subtractive)
        { kind: 'ell', c: [0.0072, 0.0455, 0.0063], r: [0.0018, 0.0013, 0.0012], bone: 0, sub: true, k: 0.001 },
        { kind: 'ell', c: [0.0072, 0.0455, -0.0063], r: [0.0018, 0.0013, 0.0012], bone: 0, sub: true, k: 0.001 },
        { kind: 'ell', c: [0.0212, 0.0362, 0.0026], r: [0.0012, 0.0012, 0.0010], bone: 0, sub: true, k: 0.0008 },
        { kind: 'ell', c: [0.0212, 0.0362, -0.0026], r: [0.0012, 0.0012, 0.0010], bone: 0, sub: true, k: 0.0008 },
        { kind: 'box', c: [0.0185, 0.0322, 0], h: [0.0045, 0.0003, 0.008], round: 0.0002, q: q(0, 0, -0.5), bone: 0, sub: true, k: 0.0008 },
        // carved notch between jaw and neck
        { kind: 'ell', c: [0.0105, 0.0310, 0], r: [0.0032, 0.0028, 0.012], bone: 0, sub: true, k: 0.003 },
      ];
      // mane: a ridge of small lobes down the back of the neck
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        s.push({ kind: 'ell', c: [-0.0098 + t * 0.0062, 0.021 + t * 0.028, 0], r: [0.0034, 0.0030, 0.0042 - t * 0.001], bone: 0, k: 0.002 });
      }
      return s;
    }
    case 'b':
      return [
        { kind: 'ell', c: [0, 0.0532, 0], r: [0.0074, 0.0108, 0.0074], bone: 0, k: 0.002 },
        { kind: 'cone', a: [0, 0.0440, 0], b: [0, 0.0480, 0], ra: 0.0050, rb: 0.0062, bone: 0, k: 0.003 },
        // finial
        { kind: 'cone', a: [0, 0.0630, 0], b: [0, 0.0650, 0], ra: 0.0018, rb: 0.0015, bone: 0, k: 0.0015 },
        { kind: 'ell', c: [0, 0.0672, 0], r: [0.0030, 0.0030, 0.0030], bone: 0, k: 0.0015 },
        // mitre slit
        { kind: 'box', c: [0.0045, 0.0565, 0], h: [0.006, 0.0006, 0.009], round: 0.0002, q: q(0, 0, 0.75), bone: 0, sub: true, k: 0.0006 },
      ];
    case 'r': {
      const s: Prim[] = [
        { kind: 'cone', a: [0, 0.0455, 0], b: [0, 0.0540, 0], ra: 0.0128, rb: 0.0127, bone: 0, k: 0.0008 },
        { kind: 'cone', a: [0, 0.0490, 0], b: [0, 0.0600, 0], ra: 0.0086, rb: 0.0086, bone: 0, sub: true, k: 0.0008 },
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        s.push({ kind: 'box', c: [Math.cos(a) * 0.0115, 0.0545, Math.sin(a) * 0.0115], h: [0.0025, 0.0032, 0.0018], round: 0.0003, q: q(0, -a, 0), bone: 0, sub: true, k: 0.0006 });
      }
      return s;
    }
    case 'q': {
      const s: Prim[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        s.push({ kind: 'ell', c: [Math.cos(a) * 0.0096, 0.0688, Math.sin(a) * 0.0096], r: [0.0019, 0.0024, 0.0019], bone: 0, k: 0.0015 });
      }
      s.push({ kind: 'ell', c: [0, 0.0680, 0], r: [0.0076, 0.0040, 0.0076], bone: 0, k: 0.002 });
      s.push({ kind: 'ell', c: [0, 0.0750, 0], r: [0.0036, 0.0036, 0.0036], bone: 0, k: 0.002 });
      return s;
    }
    case 'k':
      return [
        { kind: 'cone', a: [0, 0.0780, 0], b: [0, 0.0805, 0], ra: 0.0030, rb: 0.0026, bone: 0, k: 0.0015 },
        { kind: 'box', c: [0, 0.0870, 0], h: [0.0019, 0.0068, 0.0019], round: 0.0006, bone: 0, k: 0.0012 },
        { kind: 'box', c: [0, 0.0885, 0], h: [0.0056, 0.0018, 0.0019], round: 0.0006, bone: 0, k: 0.0012 },
      ];
    default:
      return null;
  }
}

export const pieceGeometry = defGeo('piece', (type: PieceType): THREE.BufferGeometry => {
  const parts: THREE.BufferGeometry[] = [lathe(PROFILES[type](), 56, 0.0001, type.charCodeAt(0))];
  const h = heads(type);
  if (h) parts.push(meshSDF(new SDFModel(h), { cell: 0.00045, uv: 'cylY', cavity: 0.0012 }));
  for (const p of parts) { p.deleteAttribute('skinIndex'); p.deleteAttribute('skinWeight'); }
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingBox();
  return g;
});

export interface PieceMaterials { w: THREE.MeshPhysicalMaterial[]; b: THREE.MeshPhysicalMaterial[] }

export function makePieceMaterials(highContrast: boolean): PieceMaterials {
  const rnd = mulberry32(42);
  const mk = (c: Color, i: number) => {
    const tex = pieceTexture(c === 'w', 100 + (i % 3) * 17);
    const tint = c === 'w'
      ? new THREE.Color(highContrast ? '#efe3c2' : '#ffffff').multiplyScalar(0.93 + rnd() * 0.1)
      : new THREE.Color(highContrast ? '#3a2e26' : '#ffffff').multiplyScalar(0.9 + rnd() * 0.2);
    return new THREE.MeshPhysicalMaterial({
      color: tint,
      map: tex.map,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: tex.roughnessMap,
      roughness: 1,
      vertexColors: true,
      clearcoat: c === 'w' ? 0.12 : 0.45,
      clearcoatRoughness: c === 'w' ? 0.5 : 0.32,
      sheen: c === 'w' ? 0.15 : 0.0,
      sheenColor: new THREE.Color('#e8d7b0'),
      sheenRoughness: 0.6,
      envMapIntensity: 0.7,
    });
  };
  return { w: [0, 1, 2].map((i) => mk('w', i)), b: [0, 1, 2].map((i) => mk('b', i)) };
}

export class PieceMesh extends THREE.Mesh {
  constructor(public type: PieceType, public color: Color, mats: PieceMaterials, idx: number) {
    super(pieceGeometry(type), mats[color][idx % 3]);
    this.castShadow = true;
    this.receiveShadow = true;
    // imperfect hand-made placement: tiny random yaw + offset
    const r = mulberry32(idx * 31 + (color === 'w' ? 7 : 13));
    this.userData.jitter = { yaw: (r() - 0.5) * 0.5, dx: (r() - 0.5) * 0.002, dz: (r() - 0.5) * 0.002 };
    if (type === 'n') this.userData.jitter.yaw = (color === 'w' ? Math.PI / 2 + 0.35 : -Math.PI / 2 - 0.35) + (r() - 0.5) * 0.15;
    this.rotation.y = this.userData.jitter.yaw;
  }
  get height(): number {
    return this.geometry.boundingBox!.max.y;
  }
}
