import * as THREE from 'three';
import { SDFModel, meshSDF, type Prim } from '../render/sdf';
import { fabricTexture, metalTexture } from '../render/textures';
import { Noise3D, Noise2D } from '../render/noise';
import { HandModel, POSES } from './hands';
import { ArmIK, handQuat } from './arms';
import { TABLE_TOP } from './environment';
import { defGeo } from '../render/geometry';

const T = TABLE_TOP;
const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

/** Hunched torso in worn institutional clothing (opponent faces +Z, toward the player). */
const torsoGeometry = defGeo('torso', (): THREE.BufferGeometry => {
  const prims: Prim[] = [
    // chest & ribcage, leaning forward
    { kind: 'ell', c: [0, T + 0.12, -0.70], r: [0.185, 0.26, 0.125], q: q(0.42, 0, 0), bone: 0, k: 0.06 },
    { kind: 'ell', c: [0, T - 0.08, -0.80], r: [0.17, 0.2, 0.12], q: q(0.2, 0, 0), bone: 0, k: 0.06 },
    // shoulders / trapezius
    { kind: 'ell', c: [-0.17, T + 0.25, -0.63], r: [0.075, 0.06, 0.07], bone: 0, k: 0.05 },
    { kind: 'ell', c: [0.17, T + 0.25, -0.63], r: [0.075, 0.06, 0.07], bone: 0, k: 0.05 },
    { kind: 'ell', c: [0, T + 0.30, -0.62], r: [0.12, 0.05, 0.07], bone: 0, k: 0.05 },
    // neck & collar
    { kind: 'cone', a: [0, T + 0.27, -0.6], b: [0, T + 0.37, -0.53], ra: 0.055, rb: 0.048, bone: 0, k: 0.03 },
    { kind: 'ell', c: [0, T + 0.31, -0.565], r: [0.085, 0.035, 0.06], q: q(0.5, 0, 0), bone: 0, k: 0.015 },
  ];
  const model = new SDFModel(prims);
  const n = new Noise3D(17);
  model.displace = (x, y, z) => n.noise(x * 7, y * 5, z * 7) * 0.006 + Math.sin(y * 38 + x * 6 + n.noise(x * 3, y * 3, z) * 2) * 0.0022;
  return meshSDF(model, { cell: 0.007, uv: 'xy', cavity: 0.02, bounds: { min: [-0.32, T - 0.32, -1.0], max: [0.32, T + 0.45, -0.42] } });
});

/** Hood: a cloth shell around the head with an opening at the face. */
const hoodGeometry = defGeo('hood', (): THREE.BufferGeometry => {
  const prims: Prim[] = [
    { kind: 'ell', c: [0, 0.015, -0.015], r: [0.118, 0.142, 0.13], bone: 0, k: 0.02 },
    { kind: 'ell', c: [0, -0.09, -0.04], r: [0.13, 0.07, 0.12], bone: 0, k: 0.04 },
    { kind: 'ell', c: [0, 0.008, 0.0], r: [0.1, 0.122, 0.112], bone: 0, sub: true, k: 0.01 },
    { kind: 'box', c: [0, -0.01, 0.14], h: [0.075, 0.1, 0.09], round: 0.03, bone: 0, sub: true, k: 0.02 },
  ];
  const model = new SDFModel(prims);
  const n = new Noise3D(23);
  model.displace = (x, y, z) => n.noise(x * 30, y * 30, z * 30) * 0.004 + Math.sin(y * 70 + z * 20) * 0.0012;
  return meshSDF(model, { cell: 0.0045, uv: 'xy', cavity: 0.012, bounds: { min: [-0.16, -0.2, -0.18], max: [0.16, 0.18, 0.16] } });
});

/** Original riveted iron cage mask: curved vertical bars and bands over the face. */
function cageMask(): THREE.Group {
  const g = new THREE.Group();
  const mt = metalTexture(91, '#4a4438', 0.75);
  const iron = new THREE.MeshStandardMaterial({ map: mt.map, normalMap: mt.normalMap, roughnessMap: mt.roughnessMap, roughness: 1, metalness: 0.85, color: '#9a9080' });
  const face = (y: number, x: number) => {
    // a curved surface hugging the face: z offset as function of x,y
    const z = 0.105 - x * x * 3.2 - Math.max(0, y - 0.03) * y * 1.6 - Math.max(0, -y - 0.05) * 0.6;
    return new THREE.Vector3(x, y, z);
  };
  const bar = (pts: THREE.Vector3[], r: number) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 6, false), iron);
    m.castShadow = true;
    g.add(m);
  };
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.021;
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 8; s++) { const y = 0.085 - (s / 8) * 0.19; pts.push(face(y, x * (1 - Math.max(0, -y - 0.04) * 2.2))); }
    bar(pts, 0.0032);
  }
  for (const y of [0.075, 0.03, -0.025, -0.075]) {
    const pts: THREE.Vector3[] = [];
    const w = y < -0.05 ? 0.055 : 0.075;
    for (let s = 0; s <= 10; s++) pts.push(face(y, -w + (s / 10) * w * 2));
    bar(pts, 0.0045);
  }
  // outer frame band across the brow and down the cheeks
  const frame: THREE.Vector3[] = [];
  for (let s = 0; s <= 16; s++) { const a = Math.PI * (s / 16); frame.push(face(-0.105 + Math.sin(a) * 0.2, -Math.cos(a) * 0.082)); }
  bar(frame, 0.006);
  // strap around the head
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 40, Math.PI * 1.15), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.75 }));
  strap.rotation.set(Math.PI / 2, 0, Math.PI * 0.93);
  strap.position.set(0, 0.04, -0.01);
  g.add(strap);
  // rivets
  const rivet = new THREE.SphereGeometry(0.0055, 10, 8);
  for (const y of [0.075, 0.03, -0.025]) for (const x of [-0.075, 0.075]) { const r = new THREE.Mesh(rivet, iron); r.position.copy(face(y, x * 0.98)); g.add(r); }
  return g;
}

/**
 * The opponent: original masked figure, seated, leaning over the table.
 * Idle breathing, small head movement, finger twitches; thinking pose with hands clasped below the mask;
 * IK arms that reach across and move pieces.
 */
export class Opponent extends THREE.Group {
  readonly torso: THREE.Mesh;
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armR: ArmIK; // opponent's right arm = player's left (x < 0)
  readonly armL: ArmIK;
  readonly handR: HandModel;
  readonly handL: HandModel;
  private upperR: THREE.Mesh;
  private upperL: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private noise = new Noise2D(5);
  mode: 'think' | 'rest' | 'move' = 'think';
  readonly shoulderBase = { R: new THREE.Vector3(-0.18, T + 0.245, -0.60), L: new THREE.Vector3(0.18, T + 0.245, -0.60) };
  readonly restR: { wrist: THREE.Vector3; quat: THREE.Quaternion };
  readonly restL: { wrist: THREE.Vector3; quat: THREE.Quaternion };
  readonly thinkR: { wrist: THREE.Vector3; quat: THREE.Quaternion };
  readonly thinkL: { wrist: THREE.Vector3; quat: THREE.Quaternion };
  lean = 0;

  constructor(opts: { reducedHorror: boolean }) {
    super();
    const shirt = fabricTexture(101, '#7a7052', opts.reducedHorror ? 0.4 : 1.0);
    for (const t of [shirt.map, shirt.normalMap]) t.repeat.set(2, 2);
    const cloth = new THREE.MeshStandardMaterial({ map: shirt.map, normalMap: shirt.normalMap, roughness: 0.96, vertexColors: true, normalScale: new THREE.Vector2(0.6, 0.6), color: '#c0b498' });
    this.torso = new THREE.Mesh(torsoGeometry(), cloth);
    this.torso.castShadow = true; this.torso.receiveShadow = true;
    this.body.add(this.torso);
    this.add(this.body);

    // head: dark face, hood, cage
    const hoodTex = fabricTexture(102, '#262420', 0.6);
    const hood = new THREE.Mesh(hoodGeometry(), new THREE.MeshStandardMaterial({ map: hoodTex.map, normalMap: hoodTex.normalMap, roughness: 1, vertexColors: true }));
    hood.castShadow = true;
    const faceMat = new THREE.MeshStandardMaterial({ color: '#2a1e18', roughness: 0.8 });
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.095, 32, 24), faceMat);
    face.scale.set(0.82, 1.12, 0.95);
    face.position.set(0, -0.005, 0.0);
    // brow/nose shadows to suggest a face behind the bars
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.04, 10), faceMat);
    nose.position.set(0, -0.012, 0.085); nose.rotation.x = 1.4;
    this.head.add(face, nose, hood, cageMask());
    if (!opts.reducedHorror) {
      // two faint wet glints behind the cage (never glowing)
      for (const x of [-0.032, 0.032]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#1a1410', roughness: 0.08, clearcoat: 1 }));
        eye.position.set(x, 0.018, 0.074);
        this.head.add(eye);
        this.eyes.push(eye);
      }
    }
    this.head.position.set(0, T + 0.43, -0.5);
    this.head.rotation.x = 0.28;
    this.body.add(this.head);

    // arms
    const oppCos = { hands: 'dirty' as const, gloves: 'none' as const, sleeves: 'jacket' as const, accessories: 'none' as const };
    this.handR = new HandModel('right', oppCos, { tone: '#9a7058' });
    this.handL = new HandModel('left', { ...oppCos, accessories: 'watch' }, { tone: '#9a7058' });
    this.add(this.handR, this.handL);
    const upperMat = cloth.clone();
    upperMat.vertexColors = false;
    const upperGeo = new THREE.CapsuleGeometry(0.048, 0.22, 6, 16);
    upperGeo.scale(1, 1, 0.9);
    this.upperR = new THREE.Mesh(upperGeo, upperMat);
    this.upperL = new THREE.Mesh(upperGeo, upperMat);
    for (const u of [this.upperR, this.upperL]) { u.castShadow = true; this.add(u); }

    const fwd = new THREE.Vector3(0, 0, 1);
    // thinking pose: elbows on the table, hands clasped below the mask
    this.thinkR = { wrist: new THREE.Vector3(-0.045, T + 0.19, -0.37), quat: handQuat(new THREE.Vector3(0.45, 0.85, 0.2), new THREE.Vector3(-0.8, 0.1, 0.55)) };
    this.thinkL = { wrist: new THREE.Vector3(0.045, T + 0.19, -0.37), quat: handQuat(new THREE.Vector3(-0.45, 0.85, 0.2), new THREE.Vector3(0.8, 0.1, 0.55)) };
    // resting pose: forearms on the table near the far edge of the board
    this.restR = { wrist: new THREE.Vector3(-0.24, T + 0.035, -0.47), quat: handQuat(new THREE.Vector3(0.35, -0.25, 1), new THREE.Vector3(0.1, 1, 0.1)) };
    this.restL = { wrist: new THREE.Vector3(0.24, T + 0.035, -0.47), quat: handQuat(new THREE.Vector3(-0.35, -0.25, 1), new THREE.Vector3(-0.1, 1, 0.1)) };
    void fwd;
    this.armR = new ArmIK(this.handR, this.shoulderBase.R.clone(), new THREE.Vector3(-0.7, T - 0.4, -0.75), { ...this.thinkR, pose: POSES.clasp });
    this.armL = new ArmIK(this.handL, this.shoulderBase.L.clone(), new THREE.Vector3(0.7, T - 0.4, -0.75), { ...this.thinkL, pose: POSES.clasp });
    this.armR.idle = 0.002; this.armL.idle = 0.002;
  }

  /** Arm to use for a board point: opponent's right arm for squares on the player's left. */
  armFor(p: THREE.Vector3): ArmIK { return p.x < 0.02 ? this.armR : this.armL; }

  restOf(arm: ArmIK) {
    const r = this.mode === 'think' ? (arm === this.armR ? this.thinkR : this.thinkL) : (arm === this.armR ? this.restR : this.restL);
    return { ...r, pose: this.mode === 'think' ? POSES.clasp : POSES.rest };
  }

  async setMode(mode: 'think' | 'rest', dur = 1.2) {
    this.mode = mode;
    const r = mode === 'think' ? this.thinkR : this.restR, l = mode === 'think' ? this.thinkL : this.restL;
    const pose = mode === 'think' ? POSES.clasp : POSES.rest;
    await Promise.all([this.armR.to({ ...r, pose }, dur), this.armL.to({ ...l, pose }, dur * 1.1)]);
  }

  update(t: number, dt: number, motion: number) {
    // breathing: slow chest rise
    const br = Math.sin(t * Math.PI * 2 * 0.2);
    this.torso.scale.set(1 + br * 0.006, 1 + br * 0.004, 1 + br * 0.008);
    // lean follows the reaching arm's shoulder offset
    const leanTarget = Math.max(this.armR.shoulder.z - this.shoulderBase.R.z, this.armL.shoulder.z - this.shoulderBase.L.z);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 6);
    this.body.position.set(0, -this.lean * 0.25 + br * 0.0015, this.lean * 0.9);
    // head: small, slow movements; occasionally tilts
    const n1 = this.noise.fbm(t * 0.08, 1, 2), n2 = this.noise.fbm(t * 0.06, 9, 2);
    this.head.rotation.set(0.28 + n1 * 0.06 * motion + this.lean * 0.6, n2 * 0.12 * motion, n1 * 0.04 * motion);
    // arms
    for (const [arm, base] of [[this.armR, this.shoulderBase.R], [this.armL, this.shoulderBase.L]] as const) {
      const reach = arm.state.wrist.distanceTo(base);
      const extra = Math.max(0, reach - 0.54);
      const dir = arm.state.wrist.clone().sub(base).setY(0).normalize();
      arm.shoulder.copy(base).addScaledVector(dir, extra).add(new THREE.Vector3(0, -extra * 0.25 + br * 0.0015, 0));
      arm.update(t, dt, motion);
    }
    // occasional finger twitch while idle
    if (!this.armR.busy && this.mode === 'rest' && Math.sin(t * 0.9) > 0.97) this.handR.pose.curl[0] -= 0.05;
    this.orientUpper(this.upperR, this.armR);
    this.orientUpper(this.upperL, this.armL);
  }

  private orientUpper(m: THREE.Mesh, arm: ArmIK) {
    const a = arm.shoulder, b = arm.elbowPos;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.scale.set(1, a.distanceTo(b) / 0.3, 1);
  }
}
