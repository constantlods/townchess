import * as THREE from 'three';
import { TABLE_TOP } from './environment';

export interface CamPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

/**
 * First-person camera: a composed base pose (aspect-dependent), plus very subtle human motion:
 * idle sway (0.05–0.15°), breathing, a slight lean toward the board when moving, attention shifts
 * and the slow game-over focus. Never shakes.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private base: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
  private lean = 0;
  private leanTarget = 0;
  private attention = new THREE.Vector3();
  private attentionTarget = new THREE.Vector3();
  private focus: { pos: THREE.Vector3; look: THREE.Vector3; t: number } | null = null;
  motionScale = 1; // 0 = reduced camera movement
  largerBoard = false;
  override: Partial<{ h: number; back: number; pitch: number; fov: number }> = {};
  /** Alternate framings: looking at your own hands (customization) and a standing view (lobby). */
  view: 'play' | 'hands' | 'lobby' = 'play';
  private viewBlend = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 54, init: false };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.02, 30);
    this.compose(aspect);
  }

  /** Recompute composition for the current aspect ratio (desktop landscape vs. mobile portrait). */
  compose(aspect: number) {
    const portrait = aspect < 0.9;
    const tablet = aspect >= 0.9 && aspect < 1.4;
    // Landscape: eyes ~0.4 m above the table top, ~0.42 m behind the board edge, looking ~21° down (matches reference).
    let h = 0.40, back = 0.42, pitch = 19.5, fov = 54;
    if (tablet) { h = 0.62; back = 0.55; pitch = 33; fov = 52; }
    if (portrait) { h = 0.72; back = 0.42; pitch = 42; fov = 68; }
    if (this.largerBoard) { back -= 0.08; h -= 0.03; }
    h = this.override.h ?? h; back = this.override.back ?? back; pitch = this.override.pitch ?? pitch; fov = this.override.fov ?? fov;
    const nearEdge = 0.235;
    this.base.pos.set(0, TABLE_TOP + h, nearEdge + back);
    const pr = THREE.MathUtils.degToRad(pitch);
    this.base.look.copy(this.base.pos).add(new THREE.Vector3(0, -Math.sin(pr), -Math.cos(pr)));
    this.base.fov = fov;
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Lean toward the board briefly (player is moving). */
  leanIn(amount = 1) { this.leanTarget = amount; }
  leanOut() { this.leanTarget = 0; }
  /** Glance toward a world point (very small). */
  attend(p: THREE.Vector3 | null) { this.attentionTarget.copy(p ?? new THREE.Vector3()); if (!p) this.attentionTarget.set(0, 0, 0); }

  focusOn(target: THREE.Vector3) {
    const dir = target.clone().sub(this.base.pos).normalize();
    this.focus = { pos: this.base.pos.clone().addScaledVector(dir, 0.22), look: target.clone(), t: 0 };
  }
  clearFocus() { this.focus = null; }

  update(t: number, dt: number) {
    const m = this.motionScale;
    this.lean += (this.leanTarget - this.lean) * Math.min(1, dt * 3);
    this.attention.lerp(this.attentionTarget, Math.min(1, dt * 1.5));
    const pos = this.base.pos.clone();
    const look = this.base.look.clone();
    // breathing: ~0.25 Hz, ~1.5 mm
    pos.y += Math.sin(t * Math.PI * 2 * 0.24) * 0.0015 * m;
    pos.z += Math.sin(t * Math.PI * 2 * 0.24 + 1) * 0.001 * m;
    // lean forward ~4 cm
    const fwd = look.clone().sub(pos).normalize();
    pos.addScaledVector(fwd, this.lean * 0.04 * m);
    look.addScaledVector(fwd, this.lean * 0.04 * m);
    // attention: shift look target a few cm toward the point of interest
    if (this.attention.lengthSq() > 0) {
      const tgt = this.attention.clone();
      look.lerp(tgt, 0.06 * m);
    }
    // smooth transitions between framings
    let vp = pos, vl = look, vf = this.base.fov;
    if (this.view === 'hands') {
      const portrait = this.camera.aspect < 0.9;
      // offset to the right so the hands sit left of the customization panel
      vp = new THREE.Vector3(portrait ? 0.02 : 0.11, TABLE_TOP + (portrait ? 0.5 : 0.34), portrait ? 0.7 : 0.66);
      vl = new THREE.Vector3(portrait ? 0.02 : 0.11, TABLE_TOP, 0.33);
      vf = portrait ? 66 : 48;
    } else if (this.view === 'lobby') {
      vp = new THREE.Vector3(0.95, 1.6, 1.75);
      vl = new THREE.Vector3(-0.25, TABLE_TOP + 0.12, -0.25);
      vf = this.camera.aspect < 0.9 ? 75 : 50;
    }
    const vb = this.viewBlend;
    if (!vb.init) { vb.pos.copy(vp); vb.look.copy(vl); vb.fov = vf; vb.init = true; }
    const k = Math.min(1, dt * 2.2);
    vb.pos.lerp(vp, k); vb.look.lerp(vl, k); vb.fov += (vf - vb.fov) * k;
    pos.copy(vb.pos); look.copy(vb.look);
    if (Math.abs(this.camera.fov - vb.fov) > 0.01) { this.camera.fov = vb.fov; this.camera.updateProjectionMatrix(); }
    if (this.focus) {
      this.focus.t = Math.min(1, this.focus.t + dt / 6);
      const e = this.focus.t * this.focus.t * (3 - 2 * this.focus.t);
      pos.lerp(this.focus.pos, e);
      look.lerp(this.focus.look, e);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    // idle sway: sum of slow sines, 0.05–0.15°
    const d2r = Math.PI / 180;
    this.camera.rotateY((Math.sin(t * 0.21) * 0.08 + Math.sin(t * 0.53 + 2) * 0.03) * d2r * m);
    this.camera.rotateX((Math.sin(t * 0.17 + 1) * 0.06 + Math.sin(t * 0.41) * 0.025) * d2r * m);
    this.camera.rotateZ(Math.sin(t * 0.13) * 0.04 * d2r * m);
  }
}
