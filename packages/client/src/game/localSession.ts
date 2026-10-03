import { GameCore, isFinished, otherColor, type Color, type PlayerPublic, type Promotion, type Square, type TimeControl, DEFAULT_COSMETICS } from '@hc/shared';
import type { Session, SessionEvent, SessionState } from './session';
import { AiClient, AI_LEVELS, type AiLevel } from './aiClient';

/**
 * Single-player session against the local engine, entirely in the tab. Game flow is the shared GameCore, the same
 * state machine the server's GameRoom uses, so rules, clocks, draws and results cannot diverge.
 */
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  private core: GameCore;
  private listeners = new Set<(e: SessionEvent) => void>();
  private ai = new AiClient();
  private thinkingToken = 0;
  state: SessionState;
  /** Extra delay so the opponent appears to deliberate (ms). Scaled by settings. */
  pondering = 1;

  constructor(public color: Color, tc: TimeControl, private level: AiLevel, me: PlayerPublic, startFen?: string) {
    // Offline: no first-move window (the clock starts with the game, as before).
    this.core = new GameCore({ startFen, timeControl: tc, firstMoveMs: null });
    const bot: PlayerPublic = { id: 'ai', username: 'UNKNOWN_13', rating: null, cosmetics: DEFAULT_COSMETICS, ai: { level: AI_LEVELS[level].label } };
    this.state = {
      id: 'LOCAL-' + Math.random().toString(16).slice(2, 8).toUpperCase(),
      fen: this.core.fen, turn: this.core.turn, history: [], status: 'active', winner: null,
      white: color === 'w' ? me : bot, black: color === 'b' ? me : bot,
      timeControl: tc, clocks: { w: tc.initialMs, b: tc.initialMs }, sampledAt: performance.now(), running: null,
      drawOfferBy: null, rematchOfferBy: null, rated: false, opponentDisconnected: false,
    };
  }

  start() {
    this.core.start(performance.now());
    this.snapshot();
    this.emit({ type: 'newGame', state: this.state, color: this.color });
    if (this.color !== this.core.turn) this.aiTurn();
  }

  on(fn: (e: SessionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: SessionEvent) { for (const l of this.listeners) l(e); }

  private snapshot() {
    const snap = this.core.snapshot(performance.now());
    this.state = {
      ...this.state, fen: snap.fen, turn: snap.turn, history: [...snap.history], status: snap.status, winner: snap.winner,
      drawOfferBy: snap.drawOfferBy, clocks: snap.clocks ?? this.state.clocks, sampledAt: performance.now(), running: snap.running,
    };
  }

  private apply(from: Square, to: Square, promotion: Promotion | undefined, mine: boolean): boolean {
    if (isFinished(this.core.status)) return false;
    const r = this.core.move(this.core.turn, { from, to, promotion }, performance.now());
    if (!r.ok) {
      if (isFinished(this.core.status)) { this.thinkingToken++; this.snapshot(); this.emit({ type: 'state', state: this.state, reason: this.core.status }); }
      return false;
    }
    this.snapshot();
    this.emit({ type: 'move', move: r.record, state: this.state, mine });
    if (isFinished(this.state.status)) this.emit({ type: 'state', state: this.state, reason: this.state.status });
    return true;
  }

  submitMove(from: Square, to: Square, promotion?: Promotion) {
    if (this.core.turn !== this.color) { this.emit({ type: 'rejected', reason: 'not your turn', state: this.state }); return; }
    if (!this.apply(from, to, promotion, true)) { this.emit({ type: 'rejected', reason: 'illegal move', state: this.state }); return; }
    if (!isFinished(this.state.status)) this.aiTurn();
  }

  private async aiTurn() {
    const token = ++this.thinkingToken;
    this.emit({ type: 'opponentThinking', thinking: true });
    const started = performance.now();
    const fen = this.core.fen;
    const mv = await this.ai.think(fen, this.level);
    // a human-ish minimum deliberation, never longer than a fraction of the remaining time
    const remaining = this.core.clock?.peek(otherColor(this.color), performance.now()) ?? Infinity;
    const minThink = Math.min(remaining * 0.05, (900 + Math.random() * 1600) * this.pondering);
    const wait = Math.max(0, minThink - (performance.now() - started));
    await new Promise((r) => setTimeout(r, wait));
    if (token !== this.thinkingToken || isFinished(this.state.status) || this.core.fen !== fen) return;
    this.emit({ type: 'opponentThinking', thinking: false });
    if (mv) this.apply(mv.from, mv.to, mv.promotion as Promotion | undefined, false);
  }

  tick(now: number) {
    if (isFinished(this.core.status)) return;
    if (this.core.checkFlag(now)) {
      this.thinkingToken++;
      this.snapshot();
      this.emit({ type: 'state', state: this.state, reason: 'timeout' });
    }
  }

  offerDraw() {
    if (isFinished(this.state.status)) return;
    // The engine accepts a draw only when it judges the position roughly level and the game is long enough.
    const accept = this.state.history.length >= 30 && Math.random() < 0.5;
    if (accept) {
      const now = performance.now();
      this.core.offerDraw(this.color, now);
      this.core.acceptDraw(otherColor(this.color), now);
      this.snapshot();
      this.emit({ type: 'state', state: this.state, reason: 'draw_agreed' });
    } else {
      this.emit({ type: 'notice', text: 'The offer is ignored.' });
    }
  }
  acceptDraw() { /* the engine never offers */ }
  declineDraw() { /* the engine never offers */ }

  resign() {
    if (!this.core.resign(this.color, performance.now())) return;
    this.thinkingToken++;
    this.snapshot();
    this.emit({ type: 'state', state: this.state, reason: 'resigned' });
  }

  rematch() { /* handled by the app: it creates a fresh LocalSession with colours swapped */ }

  dispose() { this.thinkingToken++; this.ai.dispose(); this.listeners.clear(); }

  /** Legal destinations for UI hints (presentation only). */
  legalFrom(sq: Square) { return this.core.rules.legalMovesFrom(sq); }
}
