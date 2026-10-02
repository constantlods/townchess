import * as THREE from 'three';
import { HandModel, POSES, lerpPose, type HandPose } from './hands';
import { FOREARM_LEN } from './handRig';

export const UPPER_ARM = 0.30;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export interface ArmState { wrist: THREE.Vector3; quat: THREE.Quaternion; pose: HandPose }

interface Tween {
  from: ArmState; to: ArmState; dur: number; t: number; arc: number;
  easeFn: (t: number) => number; resolve: () => void;
}

/** Build a hand orientation from a fingers-forward direction and a dorsal (back-of-hand) up vector. */
export function handQuat(forward: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const x = forward.clone().normalize();
  const y = up.clone().sub(x.clone().multiplyScalar(up.dot(x))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Two-bone IK arm driving a HandModel. The shoulder is fixed (relative to its parent space);
 * the wrist target and hand orientation are animated with tweens.
 */
export class ArmIK {
  state: ArmState;
  private tweens: Tween[] = [];
  /** Small idle motion amplitude (metres). */
  idle = 0.0015;
  idleSeed = Math.random() * 100;
  private elbow = new THREE.Vector3();

  constructor(
    public hand: HandModel,
    public shoulder: THREE.Vector3,
    public pole: THREE.Vector3,
    rest: ArmState,
    public l1 = UPPER_ARM,
    public l2 = FOREARM_LEN,
  ) {
    this.state = { wrist: rest.wrist.clone(), quat: rest.quat.clone(), pose: { ...rest.pose } };
  }

  get busy() { return this.tweens.length > 0; }

  /** Tween to a new state. `arc` lifts the path in +Y at its midpoint (metres). */
  to(target: Partial<ArmState>, dur: number, opts: { arc?: number; ease?: 'inout' | 'out' } = {}): Promise<void> {
    return new Promise((resolve) => {
      const last = this.tweens.length ? this.tweens[this.tweens.length - 1].to : this.state;
      const from: ArmState = { wrist: last.wrist.clone(), quat: last.quat.clone(), pose: last.pose };
      const to: ArmState = { wrist: (target.wrist ?? from.wrist).clone(), quat: (target.quat ?? from.quat).clone(), pose: target.pose ?? from.pose };
      if (dur <= 0) {
        this.state = to;
        this.tweens.length = 0;
        resolve();
        return;
      }
      this.tweens.push({ from, to, dur, t: 0, arc: opts.arc ?? 0, easeFn: opts.ease === 'out' ? easeOut : ease, resolve });
    });
  }

  wait(dur: number): Promise<void> {
    return this.to({}, dur);
  }

  /** Snap without animating. */
  set(s: Partial<ArmState>) {
    if (s.wrist) this.state.wrist.copy(s.wrist);
    if (s.quat) this.state.quat.copy(s.quat);
    if (s.pose) this.state.pose = s.pose;
    this.tweens.length = 0;
  }

  update(t: number, dt: number, motionScale = 1) {
    const tw = this.tweens[0];
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.easeFn(tw.t);
      this.state.wrist.lerpVectors(tw.from.wrist, tw.to.wrist, e);
      this.state.wrist.y += Math.sin(Math.PI * e) * tw.arc;
      this.state.quat.slerpQuaternions(tw.from.quat, tw.to.quat, e);
      this.state.pose = lerpPose(tw.from.pose, tw.to.pose, ease(Math.min(1, tw.t * 1.15)));
      if (tw.t >= 1) {
        this.tweens.shift();
        tw.resolve();
      }
    }
    const wrist = this.state.wrist.clone();
    if (!tw) {
      // breathing-coupled micro motion while resting
      const s = this.idleSeed;
      wrist.x += Math.sin(t * 0.7 + s) * this.idle * 0.5 * motionScale;
      wrist.y += (Math.sin(t * 1.51 + s) * 0.5 + 0.5) * this.idle * 0.4 * motionScale;
      wrist.z += Math.sin(t * 0.43 + s * 2) * this.idle * 0.6 * motionScale;
    }
    this.solve(wrist, this.state.quat);
    this.hand.applyPose(this.state.pose);
  }

  private solve(wristTarget: THREE.Vector3, handQ: THREE.Quaternion) {
    const s = this.shoulder;
    const toW = wristTarget.clone().sub(s);
    let d = toW.length();
    const dir = toW.clone().divideScalar(d || 1);
    const maxReach = this.l1 + this.l2 - 0.002;
    d = Math.min(Math.max(d, Math.abs(this.l1 - this.l2) + 0.01), maxReach);
    const w = s.clone().addScaledVector(dir, d);
    const a = (this.l1 * this.l1 - this.l2 * this.l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, this.l1 * this.l1 - a * a));
    const pv = this.pole.clone().sub(s);
    pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    this.elbow.copy(s).addScaledVector(dir, a).addScaledVector(pv, h);
    // forearm: +X toward wrist; roll so its dorsal side follows the hand's dorsal side (natural pronation)
    const fx = w.clone().sub(this.elbow).normalize();
    const handUp = new THREE.Vector3(0, 1, 0).applyQuaternion(handQ);
    const fq = handQuat(fx, handUp.lengthSq() > 0 ? handUp : new THREE.Vector3(0, 1, 0));
    const root = this.hand.bones[0], handBone = this.hand.bones[1];
    const parentInv = new THREE.Matrix4();
    const parent = this.hand.mesh;
    parent.updateMatrixWorld(true);
    parentInv.copy(parent.matrixWorld).invert();
    // Bones are expressed in the skinned mesh's space; ArmIK works in the hand group's parent space (world).
    root.position.copy(this.elbow).applyMatrix4(parentInv);
    const parentQ = new THREE.Quaternion();
    parent.getWorldQuaternion(parentQ);
    root.quaternion.copy(parentQ.clone().invert().multiply(fq));
    handBone.quaternion.copy(fq.clone().invert().multiply(handQ));
  }

  get elbowPos() { return this.elbow; }
}

/**
 * Grip point (between thumb, index and middle fingertips) in hand-bone space for a given pose.
 * Computed by walking the local bone matrices, without touching world matrices.
 */
export function gripLocal(hand: HandModel, pose: HandPose): THREE.Vector3 {
  const saved = hand.pose;
  hand.applyPose(pose);
  const toHand = (bi: number, len: number) => {
    let b: THREE.Object3D = hand.bones[bi];
    const p = new THREE.Vector3(len, 0, 0);
    while (b !== hand.bones[1]) { b.updateMatrix(); p.applyMatrix4(b.matrix); b = b.parent!; }
    return p;
  };
  const g = toHand(16, 0.022).add(toHand(4, 0.017)).add(toHand(7, 0.018)).multiplyScalar(1 / 3);
  hand.applyPose(saved);
  return g.multiplyScalar(hand.scale.x);
}

export { POSES };
