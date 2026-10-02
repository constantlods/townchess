import * as THREE from 'three';
import type { Color, PieceType, Square } from '@hc/shared';
import { ArmIK, gripLocal, handQuat, type ArmState } from './arms';
import { HandModel, POSES, type HandPose } from './hands';
import { TABLE_TOP } from './environment';
import type { World } from './world';
import { PieceMesh } from './pieces';

/** Description of a move for presentation purposes (derived from an authoritative MoveRecord). */
export interface MoveVisual {
  from: Square;
  to: Square;
  color: Color;
  capturedSquare?: Square;
  rook?: { from: Square; to: Square };
  promotion?: PieceType;
}

/** Player arms: resting on the table in the foreground, reaching across the board on demand. */
export class PlayerArms {
  readonly handL: HandModel;
  readonly handR: HandModel;
  readonly armL: ArmIK;
  readonly armR: ArmIK;
  restL: ArmState;
  restR: ArmState;
  readonly shoulderBase = { L: new THREE.Vector3(-0.2, TABLE_TOP + 0.2, 0.66), R: new THREE.Vector3(0.2, TABLE_TOP + 0.2, 0.66) };

  constructor(public world: World, cosmetics: import('@hc/shared').Cosmetics) {
    this.handL = new HandModel('left', cosmetics);
    this.handR = new HandModel('right', cosmetics);
    world.scene.add(this.handL, this.handR);
    const T = TABLE_TOP;
    // Relaxed, palms down, fingertips touching the near corners of the board frame (reference composition).
    this.restL = { wrist: new THREE.Vector3(-0.33, T + 0.03, 0.27), quat: handQuat(new THREE.Vector3(0.5, -0.2, -1), new THREE.Vector3(-0.22, 1, 0)), pose: POSES.rest };
    this.restR = { wrist: new THREE.Vector3(0.33, T + 0.03, 0.27), quat: handQuat(new THREE.Vector3(-0.5, -0.2, -1), new THREE.Vector3(0.22, 1, 0)), pose: POSES.rest };
    this.armL = new ArmIK(this.handL, this.shoulderBase.L.clone(), new THREE.Vector3(-0.8, T - 0.3, 0.75), this.restL);
    this.armR = new ArmIK(this.handR, this.shoulderBase.R.clone(), new THREE.Vector3(0.8, T - 0.3, 0.75), this.restR);
  }

  /** Portrait screens: rest the hands closer together so they stay in the (narrow) frame. */
  layout(aspect: number) {
    const T = TABLE_TOP;
    const portrait = aspect < 0.9;
    const x = portrait ? 0.15 : 0.33, z = portrait ? 0.37 : 0.27;
    const spread = portrait ? 0.15 : 0.5;
    this.restL = { wrist: new THREE.Vector3(-x, T + 0.03, z), quat: handQuat(new THREE.Vector3(spread, -0.2, -1), new THREE.Vector3(-0.22, 1, 0)), pose: POSES.rest };
    this.restR = { wrist: new THREE.Vector3(x, T + 0.03, z), quat: handQuat(new THREE.Vector3(-spread, -0.2, -1), new THREE.Vector3(0.22, 1, 0)), pose: POSES.rest };
    if (!this.armL.busy) this.armL.set(this.restL);
    if (!this.armR.busy) this.armR.set(this.restR);
  }

  setCosmetics(c: import('@hc/shared').Cosmetics) {
    this.handL.setCosmetics(c);
    this.handR.setCosmetics(c);
  }

  armFor(p: THREE.Vector3): ArmIK { return p.x < -0.06 ? this.armL : this.armR; }
  restOf(arm: ArmIK): ArmState { return arm === this.armL ? this.restL : this.restR; }

  update(t: number, dt: number, motion: number) {
    for (const [arm, base] of [[this.armL, this.shoulderBase.L], [this.armR, this.shoulderBase.R]] as const) {
      // the torso leans in when a target is far away (shoulders move; the camera barely does)
      const reach = arm.state.wrist.distanceTo(base);
      const extra = Math.max(0, reach - 0.5);
      const dir = arm.state.wrist.clone().sub(base).setY(0).normalize();
      arm.shoulder.copy(base).addScaledVector(dir, extra);
      arm.update(t, dt, motion);
    }
  }
}

export interface ArmSet {
  armFor(p: THREE.Vector3): ArmIK;
  restOf(arm: ArmIK): ArmState;
}

/** Hand orientation for picking a piece from above, approaching from the arm's own shoulder. */
function graspState(arm: ArmIK, gripWorld: THREE.Vector3, pose: HandPose, pitch = 0.42): ArmState {
  const horiz = gripWorld.clone().sub(arm.shoulder).setY(0).normalize();
  const fwd = horiz.clone().multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, -Math.sin(pitch), 0)).normalize();
  const upBase = new THREE.Vector3(0, 1, 0).sub(fwd.clone().multiplyScalar(fwd.y)).normalize();
  const roll = arm.hand.side === 'right' ? 0.28 : -0.28; // thumb dips to the side for a pinch
  const up = upBase.applyAxisAngle(fwd, roll);
  const quat = handQuat(fwd, up);
  const wrist = gripWorld.clone().sub(gripLocal(arm.hand, pose).applyQuaternion(quat));
  return { wrist, quat, pose };
}

/** Second grip (ring + little finger tucked against the palm) used to carry a captured piece. */
function palmLocal(hand: HandModel): THREE.Vector3 {
  const saved = hand.pose;
  hand.applyPose(POSES.pinch);
  const toHand = (bi: number, len: number) => {
    let b: THREE.Object3D = hand.bones[bi];
    const p = new THREE.Vector3(len, 0, 0);
    while (b !== hand.bones[1]) { b.updateMatrix(); p.applyMatrix4(b.matrix); b = b.parent!; }
    return p;
  };
  const g = toHand(10, 0.006).add(toHand(13, 0.006)).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.012, 0));
  hand.applyPose(saved);
  return g;
}

const grabHeight = (m: PieceMesh) => Math.min(0.06, m.height * 0.62);

/**
 * Animate a move physically with a hand: reach, grip, lift, carry, (capture), place, release, retract.
 * `scale` multiplies all durations; 0 snaps instantly.
 */
export async function animateMove(world: World, arms: ArmSet, mv: MoveVisual, scale: number, onSound?: (kind: 'pickup' | 'place' | 'capture' | 'slide') => void): Promise<void> {
  const piece = world.pieces.get(mv.from);
  if (!piece) return;
  const captured = mv.capturedSquare ? world.pieces.get(mv.capturedSquare) : undefined;
  const dest = world.board.squareWorld(mv.to);
  world.pieces.delete(mv.from);
  if (captured && mv.capturedSquare) world.pieces.delete(mv.capturedSquare);

  if (scale <= 0) {
    if (captured) setAside(world, captured);
    world.placeOn(piece, mv.to);
    world.pieces.set(mv.to, piece);
    if (mv.promotion) promote(world, mv.to, mv.promotion, mv.color);
    onSound?.(captured ? 'capture' : 'place');
    if (mv.rook) {
      const rook = world.pieces.get(mv.rook.from);
      if (rook) { world.pieces.delete(mv.rook.from); world.placeOn(rook, mv.rook.to); world.pieces.set(mv.rook.to, rook); }
    }
    return;
  }

  const s = scale * 0.82;
  const src = piece.getWorldPosition(new THREE.Vector3());
  const arm = arms.armFor(src.clone().lerp(dest, 0.35));
  const hand = arm.hand;
  hand.grip.position.copy(gripLocal(hand, POSES.pinch).divideScalar(hand.scale.x));
  const gSrc = src.clone().setY(src.y + grabHeight(piece));
  const atSrc = graspState(arm, gSrc, POSES.open);
  const pinchSrc = graspState(arm, gSrc, POSES.pinch);
  const hover = (st: ArmState, h: number) => ({ ...st, wrist: st.wrist.clone().setY(st.wrist.y + h) });

  // 1-4: reach toward the piece with fingers opening, then close around it
  await arm.to(hover(atSrc, 0.05), 0.26 * s, { arc: 0.02 });
  await arm.to(atSrc, 0.09 * s, { ease: 'out' });
  await arm.to(pinchSrc, 0.07 * s);
  hand.grip.attach(piece);
  onSound?.('pickup');

  const dist = src.distanceTo(dest);
  const gDst = dest.clone().setY(dest.y + grabHeight(piece));
  const pinchDst = graspState(arm, gDst, POSES.pinch);

  if (captured) {
    // carry to the victim, take it with the tucked fingers
    const palm = palmLocal(hand);
    hand.updateMatrixWorld(true);
    const capPos = captured.getWorldPosition(new THREE.Vector3());
    const gCap = capPos.clone().setY(capPos.y + grabHeight(captured) * 0.8);
    const st = graspState(arm, gCap, POSES.pinch);
    // shift wrist so the palm grip (not the pinch) lands on the captured piece
    const delta = palm.clone().sub(gripLocal(hand, POSES.pinch)).applyQuaternion(st.quat);
    const atCap: ArmState = { ...st, wrist: st.wrist.clone().sub(delta).add(new THREE.Vector3(0, 0.004, 0)) };
    await arm.to(hover(atCap, 0.03), 0.24 * s, { arc: 0.03 + dist * 0.05 });
    await arm.to(atCap, 0.08 * s, { ease: 'out' });
    const palmObj = new THREE.Object3D();
    palmObj.position.copy(palm);
    hand.bones[1].add(palmObj);
    palmObj.attach(captured);
    onSound?.('capture');
    await arm.to(hover(atCap, 0.025), 0.07 * s);
    // set the attacker down on the vacated square
    await arm.to(hover(pinchDst, 0.012), 0.12 * s);
    await arm.to(pinchDst, 0.07 * s, { ease: 'out' });
    world.board.attach(piece);
    world.placeOn(piece, mv.to);
    piece.rotation.set(0, piece.userData.jitter.yaw, 0);
    world.pieces.set(mv.to, piece);
    onSound?.('place');
    if (mv.promotion) promote(world, mv.to, mv.promotion, mv.color);
    // carry the captured piece off the board and put it down beside it
    const spot = world.capturedSpot(captured.color);
    const gSpot = spot.clone().setY(spot.y + grabHeight(captured) * 0.8);
    const sp = graspState(arm, gSpot, POSES.pinch);
    const atSpot: ArmState = { ...sp, wrist: sp.wrist.clone().sub(palm.clone().sub(gripLocal(hand, POSES.pinch)).applyQuaternion(sp.quat)), pose: { ...POSES.open, curl: [0.2, 0.25, 0.9, 0.95] } };
    await arm.to(hover(atSpot, 0.02), 0.26 * s, { arc: 0.04 });
    await arm.to(atSpot, 0.08 * s);
    world.scene.attach(captured);
    captured.rotation.set(0, captured.rotation.y, 0);
    captured.position.copy(spot);
    world.captured.push(captured);
    palmObj.removeFromParent();
    onSound?.('place');
  } else {
    // 5-9: lift, carry over, set down, release
    await arm.to(hover(pinchDst, 0.012), (0.24 + dist * 0.25) * s, { arc: 0.035 + dist * 0.06 });
    await arm.to(pinchDst, 0.09 * s, { ease: 'out' });
    world.board.attach(piece);
    world.placeOn(piece, mv.to);
    piece.rotation.set(0, piece.userData.jitter.yaw, 0);
    world.pieces.set(mv.to, piece);
    onSound?.('place');
    if (mv.promotion) promote(world, mv.to, mv.promotion, mv.color);
    await arm.to({ pose: POSES.open }, 0.06 * s);
  }

  if (mv.rook) {
    // castling: the same hand moves the rook
    const rook = world.pieces.get(mv.rook.from);
    if (rook) {
      world.pieces.delete(mv.rook.from);
      const rp = rook.getWorldPosition(new THREE.Vector3());
      const gR = rp.clone().setY(rp.y + grabHeight(rook));
      await arm.to(hover(graspState(arm, gR, POSES.open), 0.03), 0.2 * s, { arc: 0.02 });
      await arm.to(graspState(arm, gR, POSES.pinch), 0.08 * s);
      hand.grip.attach(rook);
      onSound?.('pickup');
      const rd = world.board.squareWorld(mv.rook.to);
      const gRd = rd.clone().setY(rd.y + grabHeight(rook));
      await arm.to(graspState(arm, gRd, POSES.pinch), 0.2 * s, { arc: 0.03 });
      world.board.attach(rook);
      world.placeOn(rook, mv.rook.to);
      rook.rotation.set(0, rook.userData.jitter.yaw, 0);
      world.pieces.set(mv.rook.to, rook);
      onSound?.('place');
    }
  }
  // 10: retract to rest
  const rest = arms.restOf(arm);
  await arm.to(hover(arm.state, 0.03), 0.08 * s, { ease: 'out' });
  await arm.to(rest, 0.3 * s);
}

function setAside(world: World, m: PieceMesh) {
  const spot = world.capturedSpot(m.color);
  world.scene.attach(m);
  m.position.copy(spot);
  m.rotation.set(0, m.rotation.y, 0);
  world.captured.push(m);
}

function promote(world: World, sq: Square, type: PieceType, color: Color) {
  const old = world.pieces.get(sq);
  if (!old) return;
  const m = new PieceMesh(type, color, world.pieceMats, Math.floor(Math.random() * 30));
  world.board.remove(old);
  world.placeOn(m, sq);
  world.board.add(m);
  world.pieces.set(sq, m);
}
