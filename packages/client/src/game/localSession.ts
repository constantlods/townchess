import { ChessClock, ChessRules, isFinished, otherColor, type Color, type PlayerPublic, type Promotion, type Square, type TimeControl, DEFAULT_COSMETICS } from '@hc/shared';
import type { Session, SessionEvent, SessionState } from './session';
import { AiClient, AI_LEVELS, type AiLevel } from './aiClient';

/**
 * Single-player session against the local engine. Rules and clocks run locally (there is no
 * opponent to cheat against); the same shared rules/clock code is what the server uses.
 */
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  private rules = new ChessRules();
  private clock: ChessClock;
  private listeners = new Set<(e: SessionEvent) => void>();
  private ai = new AiClient();
  private thinkingToken = 0;
  state: SessionState;
  /** Extra delay so the opponent appears to deliberate (ms). Scaled by settings. */
  pondering = 1;

  constructor(public color: Color, tc: TimeControl, private level: AiLevel, me: PlayerPublic) {
    this.clock = new ChessClock(tc);
    const bot: PlayerPublic = { id: 'ai', username: 'UNKNOWN_13', rating: AI_LEVELS[level].rating, cosmetics: DEFAULT_COSMETICS };
    this.state = {
      id: 'LOCAL-' + Math.random().toString(16).slice(2, 8).toUpperCase(),
      fen: this.rules.fen, turn: 'w', history: [], status: 'active', winner: null,
      white: color === 'w' ? me : bot, black: color === 'b' ? me : bot,
      timeControl: tc, clocks: { w: tc.initialMs, b: tc.initialMs }, sampledAt: performance.now(), running: null,
      drawOfferBy: null, rematchOfferBy: null, rated: false, opponentDisconnected: false,
    };
  }

  start() {
    this.clock.start('w', performance.now());
    this.snapshot();
    this.emit({ type: 'newGame', state: this.state, color: this.color });
    if (this.color !== 'w') this.aiTurn();
  }

  on(fn: (e: SessionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: SessionEvent) { for (const l of this.listeners) l(e); }

  private snapshot() {
    const now = performance.now();
    this.clock.sync(now);
    this.state = { ...this.state, fen: this.rules.fen, turn: this.rules.turn, clocks: { ...this.clock.remaining }, sampledAt: now, running: this.clock.running };
  }

  private apply(from: Square, to: Square, promotion: Promotion | undefined, mine: boolean): boolean {
    if (isFinished(this.state.status)) return false;
    const mover = this.rules.turn;
    const now = performance.now();
    const flag = this.clock.flagged(now);
    if (flag) { this.finishTimeout(flag); return false; }
    const rec = this.rules.tryMove({ from, to, promotion });
    if (!rec) return false;
    this.clock.press(mover, now);
    rec.clockAfterMs = this.clock.remaining[mover];
    this.state = { ...this.state, history: [...this.state.history, rec], drawOfferBy: null };
    const ps = this.rules.positionStatus();
    if (ps.status !== 'active') { this.clock.stop(now); this.state = { ...this.state, status: ps.status, winner: ps.winner }; }
    this.snapshot();
    this.emit({ type: 'move', move: rec, state: this.state, mine });
    if (isFinished(this.state.status)) this.emit({ type: 'state', state: this.state, reason: ps.status });
    return true;
  }

  submitMove(from: Square, to: Square, promotion?: Promotion) {
    if (this.rules.turn !== this.color) { this.emit({ type: 'rejected', reason: 'not your turn', state: this.state }); return; }
    if (!this.apply(from, to, promotion, true)) { this.emit({ type: 'rejected', reason: 'illegal move', state: this.state }); return; }
    if (!isFinished(this.state.status)) this.aiTurn();
  }

  private async aiTurn() {
    const token = ++this.thinkingToken;
    this.emit({ type: 'opponentThinking', thinking: true });
    const started = performance.now();
    const fen = this.rules.fen;
    const mv = await this.ai.think(fen, this.level);
    // a human-ish minimum deliberation, never longer than a fraction of the remaining time
    const remaining = this.clock.peek(otherColor(this.color), performance.now());
    const minThink = Math.min(remaining * 0.05, (900 + Math.random() * 1600) * this.pondering);
    const wait = Math.max(0, minThink - (performance.now() - started));
    await new Promise((r) => setTimeout(r, wait));
    if (token !== this.thinkingToken || isFinished(this.state.status) || this.rules.fen !== fen) return;
    this.emit({ type: 'opponentThinking', thinking: false });
    if (mv) this.apply(mv.from, mv.to, mv.promotion as Promotion | undefined, false);
  }

  private finishTimeout(loser: Color) {
    const now = performance.now();
    this.clock.stop(now);
    // timeout vs insufficient material: the winner needs mating material
    const winner = otherColor(loser);
    const draw = !this.rules.hasMatingMaterial(winner);
    this.state = { ...this.state, status: draw ? 'draw_insufficient' : 'timeout', winner: draw ? null : winner };
    this.snapshot();
    this.thinkingToken++;
    this.emit({ type: 'state', state: this.state, reason: 'timeout' });
  }

  tick(now: number) {
    if (isFinished(this.state.status)) return;
    const f = this.clock.flagged(now);
    if (f) this.finishTimeout(f);
  }

  offerDraw() {
    if (isFinished(this.state.status)) return;
    // The engine accepts a draw only when it judges the position roughly level and the game is long enough.
    const accept = this.state.history.length >= 30 && Math.random() < 0.5;
    if (accept) {
      this.clock.stop(performance.now());
      this.state = { ...this.state, status: 'draw_agreed', winner: null };
      this.snapshot();
      this.emit({ type: 'state', state: this.state, reason: 'draw_agreed' });
    } else {
      this.emit({ type: 'notice', text: 'The offer is ignored.' });
    }
  }
  acceptDraw() { /* the engine never offers */ }
  declineDraw() { /* the engine never offers */ }

  resign() {
    if (isFinished(this.state.status)) return;
    this.clock.stop(performance.now());
    this.thinkingToken++;
    this.state = { ...this.state, status: 'resigned', winner: otherColor(this.color) };
    this.snapshot();
    this.emit({ type: 'state', state: this.state, reason: 'resigned' });
  }

  rematch() { /* handled by the app: it creates a fresh LocalSession with colours swapped */ }

  dispose() { this.thinkingToken++; this.ai.dispose(); this.listeners.clear(); }

  /** Legal destinations for UI hints (presentation only). */
  legalFrom(sq: Square) { return this.rules.legalMovesFrom(sq); }
  get rulesView() { return this.rules; }
}
