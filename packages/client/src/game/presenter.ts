import * as THREE from 'three';
import { ChessRules, isFinished, otherColor, type Color, type MoveRecord, type Promotion, type Square } from '@hc/shared';
import type { Session, SessionEvent, SessionState } from './session';
import type { World } from '../scene/world';
import { PlayerArms, animateMove, type MoveVisual } from '../scene/choreo';
import type { Opponent } from '../scene/opponent';
import { POSES } from '../scene/hands';
import type { AudioEngine } from '../audio/audio';
import { animScale, type Settings } from '../settings';
import { PieceMesh } from '../scene/pieces';

export interface PresenterUI {
  setPlayers(state: SessionState, myColor: Color): void;
  setStatus(text: string): void;
  askPromotion(color: Color): Promise<Promotion | null>;
  showDrawOffer(onAccept: () => void, onDecline: () => void): void;
  showGameOver(title: string, result: string, detail: string): void;
  hideGameOver(): void;
  toast(text: string): void;
}

export function moveVisual(m: MoveRecord): MoveVisual {
  const v: MoveVisual = { from: m.from, to: m.to, color: m.color };
  if (m.flags.includes('c')) v.capturedSquare = m.to;
  if (m.flags.includes('e')) v.capturedSquare = `${m.to[0]}${m.from[1]}`;
  const r = m.color === 'w' ? '1' : '8';
  if (m.flags.includes('k')) v.rook = { from: `h${r}`, to: `f${r}` };
  if (m.flags.includes('q')) v.rook = { from: `a${r}`, to: `d${r}` };
  if (m.promotion) v.promotion = m.promotion;
  return v;
}

const resultText: Record<string, string> = {
  checkmate: 'CHECKMATE', stalemate: 'STALEMATE', draw_agreed: 'DRAW AGREED', draw_repetition: 'DRAW — REPETITION',
  draw_insufficient: 'DRAW — NO MATERIAL', draw_fifty: 'DRAW — FIFTY MOVES', resigned: 'RESIGNATION', timeout: 'TIME', abandoned: 'ABANDONED',
};

/**
 * Binds a Session (authority) to the physical scene: input, hints, hand animations, the opponent's
 * body language, check feedback and the slow game-over sequence. Holds no authority itself.
 */
export class Presenter {
  session: Session | null = null;
  private unsub: (() => void) | null = null;
  private mirror = new ChessRules();
  private queue: Promise<void> = Promise.resolve();
  private animating = 0;
  private selected: Square | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hover: Square | null = null;
  lastMove: MoveRecord | null = null;
  private gameOverShown = false;
  private idleSince = 0;
  private tipping: { mesh: PieceMesh; t: number; axis: THREE.Vector3 } | null = null;
  private mateGrade = 0;
  private checkGrade = 0;
  private checkTarget = 0;
  private mateTarget = 0;
  enabled = true;

  constructor(
    private world: World,
    private arms: PlayerArms,
    private opp: Opponent,
    private audio: AudioEngine,
    private settings: Settings,
    private ui: PresenterUI,
  ) {
    const c = world.renderer.domElement;
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  get myColor(): Color { return this.session?.color ?? 'w'; }

  attach(s: Session) {
    this.detach();
    this.session = s;
    this.unsub = s.on((e) => this.onEvent(e));
    this.resetBoard(s.state);
  }

  detach() {
    this.unsub?.();
    this.unsub = null;
    this.session?.dispose();
    this.session = null;
    this.selected = null;
  }

  private resetBoard(state: SessionState) {
    this.queue = Promise.resolve();
    this.animating = 0;
    this.gameOverShown = false;
    this.tipping = null;
    this.mateTarget = 0; this.checkTarget = 0;
    this.lastMove = null;
    this.world.board.flipped = this.myColor === 'b';
    this.world.playerColor = this.myColor;
    this.mirror = new ChessRules(state.fen);
    this.world.setPosition(this.mirror.pieces());
    this.world.board.clearMarks();
    this.world.rig.clearFocus();
    this.audio.setDuck(1);
    this.ui.hideGameOver();
    this.ui.setPlayers(state, this.myColor);
    this.arms.armL.set(this.arms.restL); this.arms.armR.set(this.arms.restR);
    void this.opp.setMode(state.turn === this.myColor ? 'rest' : 'think', 0.8);
    this.updateStatus(state);
  }

  private onEvent(e: SessionEvent) {
    switch (e.type) {
      case 'newGame':
        this.resetBoard(e.state);
        break;
      case 'move':
        this.mirror = new ChessRules(e.move.fenAfter);
        this.clearSelection();
        this.enqueue(e.move, e.mine, e.state);
        break;
      case 'rejected':
        this.ui.toast('Move rejected: ' + e.reason);
        this.queue = this.queue.then(() => this.reconcile(e.state.fen));
        break;
      case 'state':
        this.ui.setPlayers(e.state, this.myColor);
        if (isFinished(e.state.status)) this.queue = this.queue.then(() => this.gameOver(e.state));
        else this.updateStatus(e.state);
        break;
      case 'opponentThinking':
        if (e.thinking) { void this.opp.setMode('think', 1.0); this.ui.setStatus('UNKNOWN_13 is thinking'); }
        break;
      case 'drawOffer':
        if (e.by !== this.myColor) this.ui.showDrawOffer(() => this.session?.acceptDraw(), () => this.session?.declineDraw());
        break;
      case 'rematchOffer':
        if (e.by !== this.myColor) this.ui.toast('Your opponent wants a rematch.');
        break;
      case 'notice':
        this.ui.toast(e.text);
        break;
    }
  }

  private enqueue(move: MoveRecord, mine: boolean, state: SessionState) {
    this.animating++;
    this.queue = this.queue.then(async () => {
      const scale = animScale(this.settings);
      const v = moveVisual(move);
      this.world.board.clearMarks(['last', 'check', 'selected', 'move', 'capture', 'hover']);
      if (mine) {
        this.world.rig.leanIn(0.8);
        if (scale > 0) await this.arms.armL.wait(0); // let any pending selection gesture finish blending
        await animateMove(this.world, this.arms, v, scale, (k) => this.audio.play(k));
        this.world.rig.leanOut();
      } else {
        this.world.rig.attend(this.world.board.squareWorld(move.to));
        if (scale > 0 && this.opp.mode === 'think') await this.opp.setMode('rest', 0.45 * scale + 0.05);
        await animateMove(this.world, this.opp, v, scale, (k) => this.audio.play(k));
        this.world.rig.attend(null);
      }
      this.audio.play('clock');
      this.reconcile(move.fenAfter);
      this.lastMove = move;
      this.world.board.mark('last', move.from);
      this.world.board.mark('last', move.to);
      const after = new ChessRules(move.fenAfter);
      if (after.inCheck()) {
        const k = after.kingSquare(after.turn);
        if (k) this.world.board.mark('check', k);
        this.audio.play('check');
        this.checkTarget = 1;
      } else this.checkTarget = 0;
      this.ui.setPlayers(state, this.myColor);
      this.updateStatus(state);
      this.idleSince = this.world.time;
      if (!mine && !isFinished(state.status)) void this.opp.setMode('rest', 0.9);
      this.animating--;
    });
  }

  /** Make the meshes on the board match the authoritative position exactly. */
  private reconcile(fen: string) {
    const rules = new ChessRules(fen);
    const want = new Map(rules.pieces().map((p) => [p.square, p]));
    for (const [sq, m] of [...this.world.pieces]) {
      const w = want.get(sq);
      if (!w || w.type !== m.type || w.color !== m.color) { this.world.board.remove(m); this.world.pieces.delete(sq); }
    }
    let i = 100;
    for (const [sq, p] of want) {
      if (this.world.pieces.has(sq)) { this.world.placeOn(this.world.pieces.get(sq)!, sq); continue; }
      const m = new PieceMesh(p.type, p.color, this.world.pieceMats, i++);
      this.world.placeOn(m, sq);
      this.world.board.add(m);
      this.world.pieces.set(sq, m);
    }
  }

  private updateStatus(s: SessionState) {
    if (isFinished(s.status)) return;
    this.ui.setStatus(s.turn === this.myColor ? (this.mirror.inCheck() ? 'You are in check' : 'Your move') : 'Waiting');
  }

  private async gameOver(s: SessionState) {
    if (this.gameOverShown) return;
    this.gameOverShown = true;
    this.clearSelection();
    const me = this.myColor;
    const won = s.winner === me, lost = s.winner === otherColor(me);
    // camera slowly settles on the final position; ambience falls away
    const loserKing = s.winner ? new ChessRules(s.fen).kingSquare(otherColor(s.winner)) : null;
    const focus = loserKing ? this.world.board.squareWorld(loserKing) : this.world.board.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0));
    this.world.rig.focusOn(focus);
    this.audio.setDuck(0.25);
    this.audio.play('gameover');
    if (s.status === 'checkmate' || s.status === 'resigned') {
      const m = loserKing ? this.world.pieces.get(loserKing) : undefined;
      if (m) {
        const toCam = this.world.rig.camera.position.clone().sub(m.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
        const axis = new THREE.Vector3(0, 1, 0).cross(toCam).normalize().applyQuaternion(this.world.board.quaternion.clone().invert());
        this.tipping = { mesh: m, t: 0, axis: axis.multiplyScalar(lost ? 1 : -1) };
      }
    }
    this.mateTarget = s.status === 'checkmate' ? 1 : lost ? 0.35 : 0;
    this.checkTarget = 0;
    void this.opp.setMode(won ? 'think' : 'rest', 2.5);
    await new Promise((r) => setTimeout(r, 1600));
    const title = resultText[s.status] ?? 'GAME OVER';
    const result = won ? 'You Win' : lost ? 'You Lose' : 'Draw';
    const detail = s.status === 'timeout' ? (won ? 'Your opponent ran out of time.' : 'Your time ran out.')
      : s.status === 'resigned' ? (won ? 'Your opponent resigned.' : 'You resigned.') : '';
    this.ui.setStatus('');
    this.ui.showGameOver(title, result, detail);
  }

  // ── input ────────────────────────────────────────────────
  private pick(e: PointerEvent): Square | null {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.world.rig.camera);
    // pieces first (their heads overlap the squares behind them)
    const meshes = [...this.world.pieces.values()];
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit) for (const [sq, m] of this.world.pieces) if (m === hit.object) return sq;
    const p = this.raycaster.intersectObject(this.world.board.pickPlane, false)[0];
    return p ? this.world.board.squareFromWorld(p.point) : null;
  }

  private canAct(): boolean {
    const s = this.session;
    return !!s && this.enabled && !isFinished(s.state.status) && s.state.turn === this.myColor && this.animating === 0;
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    const sq = this.canAct() ? this.pick(e) : null;
    if (sq === this.hover) return;
    this.hover = sq;
    this.world.board.clearMarks(['hover']);
    const p = sq ? this.mirror.pieceAt(sq) : null;
    const dests: string[] = this.selected ? this.mirror.legalMovesFrom(this.selected).map((m) => m.to as string) : [];
    if (sq && ((p && p.color === this.myColor) || dests.includes(sq))) this.world.board.mark('hover', sq);
    this.world.renderer.domElement.style.cursor = sq && ((p && p.color === this.myColor) || dests.includes(sq)) ? 'pointer' : 'default';
  }

  private async onPointerDown(e: PointerEvent) {
    if (!this.canAct()) return;
    const sq = this.pick(e);
    if (!sq) { this.clearSelection(); return; }
    const p = this.mirror.pieceAt(sq);
    if (this.selected) {
      const legal = this.mirror.legalMovesFrom(this.selected).filter((m) => m.to === sq);
      if (legal.length) {
        let promo: Promotion | undefined;
        if (legal.some((m) => m.promotion)) {
          const choice = await this.ui.askPromotion(this.myColor);
          if (!choice) { this.clearSelection(); return; }
          promo = choice;
        }
        const from = this.selected;
        this.world.board.clearMarks(['selected', 'move', 'capture', 'hover']);
        this.selected = null;
        this.session!.submitMove(from, sq, promo);
        return;
      }
    }
    if (p && p.color === this.myColor) this.select(sq);
    else this.clearSelection();
  }

  private select(sq: Square) {
    this.selected = sq;
    this.world.board.clearMarks(['selected', 'move', 'capture']);
    this.world.board.mark('selected', sq);
    if (this.settings.showMoveHints) {
      for (const m of this.mirror.legalMovesFrom(sq)) this.world.board.mark(m.captured || m.flags.includes('e') ? 'capture' : 'move', m.to);
    }
    this.audio.play('select');
    // the hand begins to move: an anticipatory drift toward the chosen piece
    const scale = animScale(this.settings);
    if (scale > 0) {
      const pos = this.world.board.squareWorld(sq);
      const arm = this.arms.armFor(pos);
      const other = arm === this.arms.armL ? this.arms.armR : this.arms.armL;
      const rest = this.arms.restOf(arm);
      const toward = rest.wrist.clone().lerp(pos.clone().add(new THREE.Vector3(0, 0.07, 0.1)), 0.22);
      void arm.to({ wrist: toward, pose: POSES.reach }, 0.35 * scale);
      void other.to(this.arms.restOf(other), 0.35 * scale);
    }
    this.world.rig.leanIn(0.35);
  }

  private clearSelection() {
    if (this.selected && animScale(this.settings) > 0 && this.animating === 0) {
      void this.arms.armL.to(this.arms.restL, 0.3); void this.arms.armR.to(this.arms.restR, 0.3);
      this.world.rig.leanOut();
    }
    this.selected = null;
    this.world.board.clearMarks(['selected', 'move', 'capture', 'hover']);
  }

  /** Per-frame: clocks, idle behaviour, king tipping, grade accents. */
  update(t: number, dt: number) {
    const s = this.session;
    if (!s) return;
    s.tick(performance.now());
    if (this.tipping) {
      const tp = this.tipping;
      tp.t = Math.min(1, tp.t + dt / 1.3);
      const e = tp.t < 1 ? 1 - Math.pow(1 - tp.t, 2) * (1 + Math.sin(tp.t * 9) * 0.04) : 1;
      tp.mesh.quaternion.setFromAxisAngle(tp.axis, e * Math.PI * 0.5 * 0.96).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tp.mesh.userData.jitter.yaw));
      tp.mesh.position.y = this.world.board.squareLocal('a1').y + e * 0.016;
      if (tp.t >= 1 && !tp.mesh.userData.tipped) { tp.mesh.userData.tipped = true; this.audio.play('place'); }
    }
    this.checkGrade += (this.checkTarget - this.checkGrade) * Math.min(1, dt * 2);
    this.mateGrade += (this.mateTarget - this.mateGrade) * Math.min(1, dt * 0.6);
    const u = this.world.post.grade.uniforms;
    u.uCheck.value = this.checkGrade * (0.75 + 0.25 * Math.sin(t * 1.6));
    u.uMate.value = this.mateGrade * (this.settings.reducedHorror ? 0.5 : 1);
    // long silence on the player's turn: the opponent leans into its hands
    if (!isFinished(s.state.status) && s.state.turn === this.myColor && this.animating === 0 && this.opp.mode === 'rest' && t - this.idleSince > 9) {
      void this.opp.setMode('think', 1.6);
    }
  }
}
