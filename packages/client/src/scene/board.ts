import * as THREE from 'three';
import type { Square } from '@hc/shared';
import { FILES } from '@hc/shared';
import { boardTexture, metalTexture } from '../render/textures';
import { SQUARE } from './pieces';

export const BOARD_INNER = SQUARE * 8;
export const BOARD_BORDER = 0.034;
export const BOARD_SIZE = BOARD_INNER + BOARD_BORDER * 2;
export const BOARD_THICK = 0.022;

/** Soft radial/ring sprites drawn once into canvases, used as in-world chalk/tint marks. */
function markTexture(kind: 'dot' | 'ring' | 'glow' | 'square'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'dot') {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 22);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 22, 0, Math.PI * 2); g.fill();
  } else if (kind === 'ring') {
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 7;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  } else if (kind === 'glow') {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else {
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 90);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.fillStyle = gr; g.fillRect(2, 2, 124, 124);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type MarkKind = 'selected' | 'move' | 'capture' | 'last' | 'check' | 'hover';

export class Board extends THREE.Group {
  /** When true, the board is seen from black's side (a1 at the far right). */
  flipped = false;
  private marks: THREE.Mesh[] = [];
  private markPool = new Map<MarkKind, THREE.Mesh[]>();
  private texCache: Record<string, THREE.CanvasTexture> = {};
  private top!: THREE.Mesh;
  readonly pickPlane: THREE.Mesh;

  constructor(opts: { highContrast: boolean; blood: number }) {
    super();
    this.build(opts);
    this.pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_INNER, BOARD_INNER).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    this.pickPlane.position.y = BOARD_THICK;
    this.add(this.pickPlane);
  }

  private build(opts: { highContrast: boolean; blood: number }) {
    const inner = BOARD_INNER / BOARD_SIZE;
    const tex = boardTexture({ seed: 5, highContrast: opts.highContrast, blood: opts.blood }, inner);
    const topMat = new THREE.MeshPhysicalMaterial({
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, roughness: 1,
      normalScale: new THREE.Vector2(0.8, 0.8), clearcoat: 0.18, clearcoatRoughness: 0.55, envMapIntensity: 0.5,
    });
    // slight warp: subdivide and bow the top a fraction of a millimetre
    const topGeo = new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE, 24, 24);
    const p = topGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, -0.0006 * (x * x + y * y) / (BOARD_SIZE * BOARD_SIZE) * 4 + 0.0002 * Math.sin(x * 40) * Math.cos(y * 33));
    }
    topGeo.computeVertexNormals();
    topGeo.rotateX(-Math.PI / 2);
    this.top = new THREE.Mesh(topGeo, topMat);
    this.top.position.y = BOARD_THICK + 0.0002;
    this.top.receiveShadow = true;
    this.add(this.top);

    // body with bevelled edge (rounded box via extrude)
    const s = new THREE.Shape();
    const hs = BOARD_SIZE / 2, rr = 0.004;
    s.moveTo(-hs + rr, -hs); s.lineTo(hs - rr, -hs); s.quadraticCurveTo(hs, -hs, hs, -hs + rr);
    s.lineTo(hs, hs - rr); s.quadraticCurveTo(hs, hs, hs - rr, hs); s.lineTo(-hs + rr, hs);
    s.quadraticCurveTo(-hs, hs, -hs, hs - rr); s.lineTo(-hs, -hs + rr); s.quadraticCurveTo(-hs, -hs, -hs + rr, -hs);
    const body = new THREE.ExtrudeGeometry(s, { depth: BOARD_THICK - 0.009, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 3, curveSegments: 4 });
    body.rotateX(-Math.PI / 2);
    const sideTex = boardTexture({ seed: 9, highContrast: false, blood: 0.3 }, 0.0, 1024);
    const bodyMat = new THREE.MeshPhysicalMaterial({ map: sideTex.map, normalMap: sideTex.normalMap, roughness: 0.7, color: '#8a7a6a', clearcoat: 0.1 });
    const bm = new THREE.Mesh(body, bodyMat);
    bm.position.y = 0.0015;
    bm.castShadow = true; bm.receiveShadow = true;
    this.add(bm);

    // brass corner plates and rivets, as on old institutional sets
    const brass = metalTexture(3, '#7a6034', 0.55);
    const brassMat = new THREE.MeshStandardMaterial({ map: brass.map, normalMap: brass.normalMap, roughnessMap: brass.roughnessMap, metalness: 0.85, roughness: 1, color: '#c9a66b' });
    const plateShape = new THREE.Shape();
    const L = 0.03;
    plateShape.moveTo(0, 0); plateShape.lineTo(L, 0); plateShape.lineTo(L, 0.006); plateShape.lineTo(0.006, 0.006); plateShape.lineTo(0.006, L); plateShape.lineTo(0, L); plateShape.closePath();
    const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: 0.0008, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 1 });
    plateGeo.rotateX(-Math.PI / 2);
    const rivetGeo = new THREE.SphereGeometry(0.0014, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let c = 0; c < 4; c++) {
      const a = (c * Math.PI) / 2;
      const plate = new THREE.Mesh(plateGeo, brassMat);
      const g = new THREE.Group();
      g.add(plate);
      plate.position.set(-hs + 0.002, BOARD_THICK + 0.0003, hs - 0.002);
      for (const [rx, rz] of [[0.004, 0.004], [0.022, 0.003], [0.003, 0.022]]) {
        const r = new THREE.Mesh(rivetGeo, brassMat);
        r.position.set(-hs + 0.002 + rx, BOARD_THICK + 0.0012, hs - 0.002 - rz);
        g.add(r);
      }
      g.rotation.y = a;
      g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      this.add(g);
    }
    // rivet line along the frame (reference: studded border)
    for (let side = 0; side < 4; side++) {
      for (let i = 1; i < 12; i++) {
        const t = -hs + (i / 12) * BOARD_SIZE;
        const r = new THREE.Mesh(rivetGeo, brassMat);
        const off = hs - BOARD_BORDER * 0.25;
        const pos = [[t, off], [t, -off], [off, t], [-off, t]][side];
        r.position.set(pos[0], BOARD_THICK + 0.0001, pos[1]);
        r.scale.setScalar(0.65);
        this.add(r);
      }
    }
  }

  /** Local (board-space) centre of a square, at the playing surface. */
  squareLocal(sq: Square): THREE.Vector3 {
    let f = FILES.indexOf(sq[0]), r = Number(sq[1]) - 1;
    if (this.flipped) { f = 7 - f; r = 7 - r; }
    return new THREE.Vector3((f - 3.5) * SQUARE, BOARD_THICK + 0.0003, (3.5 - r) * SQUARE);
  }

  squareWorld(sq: Square): THREE.Vector3 {
    return this.localToWorld(this.squareLocal(sq));
  }

  squareFromWorld(p: THREE.Vector3): Square | null {
    const l = this.worldToLocal(p.clone());
    let f = Math.floor(l.x / SQUARE + 4), r = Math.floor(4 - l.z / SQUARE);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    if (this.flipped) { f = 7 - f; r = 7 - r; }
    return `${FILES[f]}${r + 1}`;
  }

  private tex(kind: 'dot' | 'ring' | 'glow' | 'square') {
    return (this.texCache[kind] ??= markTexture(kind));
  }

  private makeMark(kind: MarkKind): THREE.Mesh {
    const conf: Record<MarkKind, { tex: 'dot' | 'ring' | 'glow' | 'square'; color: string; opacity: number; size: number; blend: THREE.Blending }> = {
      selected: { tex: 'square', color: '#d8b46a', opacity: 0.32, size: 1, blend: THREE.AdditiveBlending },
      hover: { tex: 'square', color: '#c9b48a', opacity: 0.12, size: 1, blend: THREE.AdditiveBlending },
      move: { tex: 'dot', color: '#1a120c', opacity: 0.55, size: 1, blend: THREE.NormalBlending },
      capture: { tex: 'ring', color: '#1a120c', opacity: 0.6, size: 1, blend: THREE.NormalBlending },
      last: { tex: 'square', color: '#b08a40', opacity: 0.16, size: 1, blend: THREE.AdditiveBlending },
      check: { tex: 'glow', color: '#7a1410', opacity: 0.85, size: 1.5, blend: THREE.NormalBlending },
    };
    const c = conf[kind];
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(SQUARE * c.size, SQUARE * c.size).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.tex(c.tex), color: c.color, transparent: true, opacity: c.opacity, depthWrite: false, blending: c.blend, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.renderOrder = 2;
    m.userData.kind = kind;
    return m;
  }

  clearMarks(kinds?: MarkKind[]) {
    this.marks = this.marks.filter((m) => {
      if (kinds && !kinds.includes(m.userData.kind)) return true;
      m.visible = false;
      this.remove(m);
      const pool = this.markPool.get(m.userData.kind) ?? [];
      pool.push(m);
      this.markPool.set(m.userData.kind, pool);
      return false;
    });
  }

  mark(kind: MarkKind, sq: Square) {
    const pool = this.markPool.get(kind);
    const m = pool?.pop() ?? this.makeMark(kind);
    m.visible = true;
    m.position.copy(this.squareLocal(sq));
    m.position.y += kind === 'check' ? 0.0004 : 0.0006;
    this.add(m);
    this.marks.push(m);
  }
}
