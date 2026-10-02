import * as THREE from 'three';
import type { Cosmetics } from '@hc/shared';
import { SDFModel, meshSDF, type Prim } from '../render/sdf';
import { fabricTexture, leatherTexture, metalTexture } from '../render/textures';
import { Noise3D } from '../render/noise';
import { handGeometry, buildRig, handSkinTexture, fingerBone, FOREARM_LEN, type Side } from './handRig';
import { defGeo } from '../render/geometry';

/** Finger pose: per-finger curl 0..1 (relaxed bind ≈ 0.15), thumb flex/opposition, spread. */
export interface HandPose {
  curl: [number, number, number, number];
  thumbFlex: number;
  thumbOpp: number;
  spread: number;
}

export const POSES: Record<string, HandPose> = {
  rest: { curl: [0.42, 0.5, 0.55, 0.62], thumbFlex: 0.15, thumbOpp: 0.1, spread: 0.2 },
  restTap: { curl: [0.3, 0.48, 0.55, 0.62], thumbFlex: 0.12, thumbOpp: 0.1, spread: 0.25 },
  reach: { curl: [0.12, 0.16, 0.3, 0.42], thumbFlex: 0.0, thumbOpp: 0.25, spread: 0.45 },
  open: { curl: [0.18, 0.22, 0.55, 0.7], thumbFlex: 0.05, thumbOpp: 0.55, spread: 0.3 },
  pinch: { curl: [0.5, 0.52, 0.85, 0.95], thumbFlex: 0.45, thumbOpp: 0.95, spread: 0.0 },
  fist: { curl: [1, 1, 1, 1], thumbFlex: 0.6, thumbOpp: 0.7, spread: 0 },
  clasp: { curl: [0.85, 0.85, 0.9, 0.95], thumbFlex: 0.35, thumbOpp: 0.4, spread: 0.0 },
};

export function lerpPose(a: HandPose, b: HandPose, t: number): HandPose {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    curl: [l(a.curl[0], b.curl[0]), l(a.curl[1], b.curl[1]), l(a.curl[2], b.curl[2]), l(a.curl[3], b.curl[3])],
    thumbFlex: l(a.thumbFlex, b.thumbFlex), thumbOpp: l(a.thumbOpp, b.thumbOpp), spread: l(a.spread, b.spread),
  };
}


function nailGeometry(len: number, width: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, 0.0012, width, 6, 1, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / (width / 2), x = p.getX(i) / (len / 2);
    // curved across, rounded at the free edge
    p.setY(i, p.getY(i) - z * z * width * 0.18 - Math.max(0, x) * 0.0004);
    if (x > 0.6) p.setZ(i, p.getZ(i) * (1 - (x - 0.6) * 0.35));
  }
  g.computeVertexNormals();
  return g;
}

/** Sleeve: a cloth tube over the forearm bone with fold displacement, cut at the cuff. */
export const sleeveGeometry = defGeo('sleeve', (kind: Exclude<Cosmetics['sleeves'], 'none'>, side: Side): THREE.BufferGeometry => {
  const t = side === 'right' ? -1 : 1;
  const cuffX = kind === 'rolled' ? -0.125 : kind === 'institutional' ? -0.045 : -0.06;
  const loose = kind === 'jacket' ? 0.016 : kind === 'institutional' ? 0.012 : 0.006;
  const prims: Prim[] = [];
  for (const s of [-1, 1]) prims.push({ kind: 'cone', a: [-FOREARM_LEN - 0.05, 0.002, s * 0.014], b: [cuffX, 0.0, s * 0.011], ra: 0.03 + loose, rb: 0.0165 + loose, bone: 0, k: 0.02 });
  prims.push({ kind: 'ell', c: [-0.2, 0.006, t * 0.006], r: [0.09, 0.036 + loose, 0.038 + loose], bone: 0, k: 0.03 });
  if (kind === 'rolled') {
    // a thick rolled band
    prims.push({ kind: 'ell', c: [cuffX + 0.012, 0.001, 0], r: [0.016, 0.034, 0.04], bone: 0, k: 0.008 });
  }
  if (kind === 'jacket') prims.push({ kind: 'ell', c: [cuffX + 0.01, 0.001, 0], r: [0.014, 0.031, 0.037], bone: 0, k: 0.008 });
  // cut open at the cuff
  prims.push({ kind: 'box', c: [cuffX + 0.15, 0, 0], h: [0.15, 0.1, 0.1], round: 0, bone: 0, sub: true, k: 0.002 });
  const model = new SDFModel(prims);
  const n3 = new Noise3D(side === 'left' ? 4 : 8);
  model.displace = (x, y, z) => {
    const ang = Math.atan2(y, z);
    const folds = Math.sin(x * 90 + Math.sin(ang * 2) * 1.5) * 0.0011 + n3.noise(x * 18, ang * 1.2, 0) * 0.0018;
    return folds * (kind === 'rolled' ? 0.5 : 1);
  };
  const geo = meshSDF(model, { cell: 0.0028, uv: 'xy', bounds: { min: [-0.36, -0.06, -0.07], max: [cuffX + 0.03, 0.06, 0.07] } });
  geo.deleteAttribute('color');
  return geo;
});

/**
 * One skinned forearm + hand with nails, sleeve and accessories, plus a pose driver.
 * The root bone is the elbow; place `root` (an Object3D) to position the arm in the world.
 */
export class HandModel extends THREE.Group {
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  private bindQ: THREE.Quaternion[];
  private nails: THREE.Mesh[] = [];
  private sleeve: THREE.Mesh | null = null;
  private accessories = new THREE.Group();
  /** Point between thumb and index fingertip, in hand-bone space: where a gripped piece sits. */
  readonly grip = new THREE.Object3D();
  pose: HandPose = { ...POSES.rest, curl: [...POSES.rest.curl] as HandPose['curl'] };
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();

  constructor(public side: Side, cosmetics: Cosmetics, opts: { scale?: number; tone?: string } = {}) {
    super();
    const geo = handGeometry(side);
    const rig = buildRig(side);
    // Clone bones from the build (each HandModel needs its own skeleton)
    const root = rig.bones[0].clone(true) as THREE.Bone;
    const bones: THREE.Bone[] = [];
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    bones.sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1)));
    this.bones = bones;
    this.bindQ = bones.map((b) => b.quaternion.clone());
    this.mesh = new THREE.SkinnedMesh(geo, [new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial()]);
    this.mesh.add(root);
    this.mesh.updateMatrixWorld(true);
    // bind matrices: geometry is authored in arm space with bones at bind; root offset = 0
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.add(this.mesh);
    if (opts.scale) this.scale.setScalar(opts.scale);

    // nails
    rig.nailSlots.forEach((s) => {
      const nail = new THREE.Mesh(nailGeometry(s.len * 0.55, s.r * 1.45), new THREE.MeshPhysicalMaterial({ color: '#c9a48c', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.4 }));
      nail.position.set(s.len * 0.56, s.r * 0.86, 0);
      nail.rotation.z = -0.08;
      nail.castShadow = true;
      this.bones[s.bone].add(nail);
      this.nails.push(nail);
    });
    // grip point: between thumb tip and index tip in bind pose; refined each frame in update()
    this.bones[1].add(this.grip);
    this.bones[1].add(this.accessories);
    this.tone = opts.tone ?? '#b88a6e';
    this.setCosmetics(cosmetics);
  }

  private tone: string;

  setCosmetics(c: Cosmetics) {
    const skin = handSkinTexture(c.hands, this.side, this.tone);
    const skinMat = new THREE.MeshPhysicalMaterial({
      map: skin.map, normalMap: skin.normalMap, roughnessMap: skin.roughnessMap, roughness: 1,
      normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true,
      sheen: 0.35, sheenColor: new THREE.Color('#c0503c'), sheenRoughness: 0.5,
      clearcoat: 0.22, clearcoatRoughness: 0.42, envMapIntensity: 0.6,
      specularIntensity: 0.6,
    });
    // cheap subsurface hint: lift the terminator with a warm wrap term
    skinMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.10, 0.03, 0.02) * (1.0 - dot(normal, normalize(vViewPosition)));
         reflectedLight.directDiffuse *= vec3(1.0, 0.94, 0.9);`,
      );
    };
    let handMat: THREE.Material = skinMat, tipMat: THREE.Material = skinMat;
    if (c.gloves !== 'none') {
      const lt = leatherTexture(c.gloves === 'leather' ? 71 : 72, c.gloves === 'leather' ? '#2a1e16' : '#3a2c20', c.gloves === 'leather' ? 0.25 : 0.85);
      const glove = new THREE.MeshPhysicalMaterial({
        map: lt.map, normalMap: lt.normalMap, roughnessMap: lt.roughnessMap, roughness: 1, vertexColors: true,
        clearcoat: c.gloves === 'leather' ? 0.35 : 0.1, clearcoatRoughness: 0.5, sheen: 0.2, sheenColor: new THREE.Color('#806040'),
      });
      handMat = glove;
      tipMat = c.gloves === 'leather' ? glove : skinMat;
    }
    (this.mesh.material as THREE.Material[]).forEach((m) => m.dispose());
    this.mesh.material = [skinMat, handMat, tipMat];
    this.nails.forEach((n, i) => { n.visible = c.gloves !== 'leather' || i === -1; });
    // glove thickness: inflate gloved regions slightly via a tiny normal push in the vertex shader
    if (c.gloves !== 'none') {
      (handMat as THREE.MeshPhysicalMaterial).onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += objectNormal * 0.0011;');
      };
    }

    // sleeves
    if (this.sleeve) { this.bones[0].remove(this.sleeve); this.sleeve.geometry.dispose(); this.sleeve = null; }
    if (c.sleeves !== 'none') {
      const fab = c.sleeves === 'institutional' ? fabricTexture(81, '#7a7e66', 0.9) : c.sleeves === 'jacket' ? fabricTexture(82, '#2e2a22', 0.7) : fabricTexture(83, '#8a8470', 0.8);
      const mat = new THREE.MeshStandardMaterial({ map: fab.map, normalMap: fab.normalMap, roughness: 0.95, normalScale: new THREE.Vector2(1.2, 1.2) });
      for (const tx of [fab.map, fab.normalMap]) tx.repeat.set(1, 1);
      this.sleeve = new THREE.Mesh(sleeveGeometry(c.sleeves, this.side), mat);
      this.sleeve.position.set(FOREARM_LEN, 0, 0); // forearm bone origin is at the elbow; sleeve authored in wrist-origin arm space
      this.sleeve.castShadow = true; this.sleeve.receiveShadow = true;
      this.bones[0].add(this.sleeve);
    }

    // accessories (attached to the hand bone at the wrist)
    this.accessories.clear();
    const t = this.side === 'right' ? -1 : 1;
    if (c.accessories === 'watch' && this.side === 'left') {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0045, 8, 40), new THREE.MeshPhysicalMaterial({ color: '#2a1c12', roughness: 0.6, clearcoat: 0.3 }));
      strap.scale.set(0.75, 1.05, 1); strap.rotation.y = Math.PI / 2;
      strap.position.set(-0.026, 0.0, 0);
      const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.008, 32), new THREE.MeshStandardMaterial({ color: '#8a8478', metalness: 1, roughness: 0.3 }));
      caseM.position.set(-0.026, 0.018, 0);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0145, 32), new THREE.MeshPhysicalMaterial({ color: '#d8d0b8', roughness: 0.3, clearcoat: 1 }));
      face.rotation.x = -Math.PI / 2; face.position.set(-0.026, 0.0225, 0);
      const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.0005, 0.0012), new THREE.MeshBasicMaterial({ color: '#111' }));
      hand1.position.set(-0.024, 0.023, 0.002); hand1.rotation.y = 0.8;
      this.accessories.add(strap, caseM, face, hand1);
    } else if (c.accessories === 'strap' || (c.accessories === 'watch' && this.side === 'right')) {
      if (c.accessories === 'strap') {
        const lt = leatherTexture(73, '#3a2414', 0.7);
        const prof = [new THREE.Vector2(0.0285, -0.014), new THREE.Vector2(0.0315, -0.0135), new THREE.Vector2(0.0322, 0), new THREE.Vector2(0.0315, 0.0135), new THREE.Vector2(0.0285, 0.014), new THREE.Vector2(0.0285, -0.014)];
        const strap = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), new THREE.MeshPhysicalMaterial({ map: lt.map, normalMap: lt.normalMap, roughness: 0.65, clearcoat: 0.25, clearcoatRoughness: 0.5 }));
        strap.rotation.z = Math.PI / 2;
        strap.scale.set(0.7, 1, 1.0); // local x → thickness after the z-rotation
        strap.position.set(-0.03, 0.0, 0);
        const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0012, 6, 4), new THREE.MeshStandardMaterial({ color: '#7a6a4a', metalness: 1, roughness: 0.5, map: metalTexture(74, '#7a6a4a', 0.5).map }));
        buckle.position.set(-0.03, 0.022, t * 0.0); buckle.rotation.x = Math.PI / 2;
        this.accessories.add(strap, buckle);
      }
    } else if (c.accessories === 'bandage') {
      const ft = fabricTexture(75, '#b0a488', 1.0);
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.031, 0.05, 36, 4, true), new THREE.MeshStandardMaterial({ map: ft.map, normalMap: ft.normalMap, roughness: 1, side: THREE.DoubleSide }));
      wrap.rotation.z = Math.PI / 2; wrap.scale.set(0.62, 1, 1.0); wrap.position.set(0.02, -0.001, -t * 0.003);
      this.accessories.add(wrap);
    }
    this.accessories.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  }

  /** Apply finger pose deltas on top of the bind pose. */
  applyPose(p: HandPose) {
    this.pose = p;
    const b = this.bones;
    const t = this.side === 'right' ? -1 : 1;
    const jointScale = [0.95, 1.15, 0.75];
    for (let f = 0; f < 4; f++) {
      const c = p.curl[f];
      for (let j = 0; j < 3; j++) {
        const bone = b[fingerBone(f, j)];
        const spread = j === 0 ? (f - 1.5) * 0.06 * p.spread * -t : 0;
        this.tmpE.set(0, spread, -(c - 0.15) * jointScale[j] * 1.25, 'YZX');
        bone.quaternion.copy(this.bindQ[fingerBone(f, j)]).multiply(this.tmpQ.setFromEuler(this.tmpE));
      }
    }
    // thumb: opposition swings the metacarpal across the palm; flex bends the phalanges
    this.tmpE.set(-t * p.thumbOpp * 0.35, t * p.thumbOpp * 0.55, -p.thumbOpp * 0.25, 'XYZ');
    b[14].quaternion.copy(this.bindQ[14]).multiply(this.tmpQ.setFromEuler(this.tmpE));
    this.tmpE.set(0, 0, -p.thumbFlex * 0.6);
    b[15].quaternion.copy(this.bindQ[15]).multiply(this.tmpQ.setFromEuler(this.tmpE));
    this.tmpE.set(0, 0, -p.thumbFlex * 0.8);
    b[16].quaternion.copy(this.bindQ[16]).multiply(this.tmpQ.setFromEuler(this.tmpE));
  }

  /** Recompute the grip point = midpoint of thumb tip and index/middle tips (hand-bone space). */
  updateGrip() {
    this.updateMatrixWorld(true);
    const tip = (bi: number, len: number) => new THREE.Vector3(len, 0, 0).applyMatrix4(this.bones[bi].matrixWorld);
    const thumb = tip(16, 0.024), index = tip(fingerBone(0, 2), 0.019), middle = tip(fingerBone(1, 2), 0.02);
    const mid = thumb.clone().add(index).add(middle).multiplyScalar(1 / 3);
    this.grip.position.copy(this.bones[1].worldToLocal(mid));
  }
}
