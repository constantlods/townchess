import { Chess } from 'chess.js';
import { ChessClock } from './clock.js';
import { moveEvents, type GameEvent } from './events.js';
import { canPossiblyMate, isDeadByMaterial, materialCount } from './material.js';
import { lookupPosition, type OpeningInfo } from './openings/index.js';
import { positionKey } from './position.js';
import { ChessRules, START_FEN, otherColor, type MoveInput } from './rules.js';
import type { Color, GameStatus, MoveRecord, Termination, TimeControl } from './types.js';
import { isFinished } from './types.js';

/**
 * Draw policy for threefold repetition (FIDE 9.2) and the fifty-move rule (9.3).
 * - 'automatic': the game ends as soon as either occurs (what most online platforms do; TownChess default).
 * - 'claim': the side to move may claim (CLAIM_DRAW); fivefold (9.6.1) and seventy-five moves (9.6.2) still end the
 *   game automatically.
 */
export type DrawPolicy = 'automatic' | 'claim';

export interface GameCoreOptions {
  startFen?: string;
  /** null = untimed. */
  timeControl: TimeControl | null;
  drawPolicy?: DrawPolicy;
  /**
   * First-move window (ms), timed games only. Clocks do not run until both sides have made their first move (an
   * intro sequence must not burn White's time). If the side to move does not make its first move inside the window,
   * the game is aborted (no result, never rated). null disables the window and starts White's clock immediately.
   */
  firstMoveMs?: number | null;
}

export type MoveResult =
  | { ok: true; record: MoveRecord; events: GameEvent[] }
  | { ok: false; reason: string; events: GameEvent[] };

export interface CoreSnapshot {
  fen: string;
  turn: Color;
  status: GameStatus;
  winner: Color | null;
  termination: Termination | null;
  history: MoveRecord[];
  drawOfferBy: Color | null;
  clocks: Record<Color, number> | null;
  running: Color | null;
  opening: OpeningInfo | null;
  inBook: boolean;
  /** Draw the side to move could claim now under the 'claim' policy. */
  claimableDraw: 'threefold' | 'fifty' | null;
  /** Legal moves for the side to move as UCI strings (empty when finished). */
  legalMoves: string[];
  lastEvents: GameEvent[];
  /** Increases every time lastEvents is replaced; clients process events only once per sequence number. */
  eventSeq: number;
  /** Same timebase as `now`. null when there is no pending first move. */
  firstMoveDeadline: number | null;
}

/**
 * The single authoritative game state machine. The server's GameRoom and the browser's offline LocalSession both
 * delegate to it, so game flow (moves, clocks, draws, claims, resignation, timeouts, results) exists once.
 * Time is always injected (`now`), which keeps it deterministic and testable.
 */
export class GameCore {
  readonly rules: ChessRules;
  readonly clock: ChessClock | null;
  readonly drawPolicy: DrawPolicy;
  readonly startFen: string;
  history: MoveRecord[] = [];
  status: GameStatus = 'waiting';
  winner: Color | null = null;
  termination: Termination | null = null;
  readonly firstMoveMs: number | null;
  firstMoveDeadline: number | null = null;
  drawOfferBy: Color | null = null;
  opening: OpeningInfo | null = null;
  inBook = false;
  lastEvents: GameEvent[] = [];
  /** See CoreSnapshot.eventSeq. Non-move state updates (disconnects, offers declined...) never re-deliver events. */
  eventSeq = 0;
  private repetitions = new Map<string, number>();
  private balances: number[] = [];

  constructor(opts: GameCoreOptions) {
    this.startFen = opts.startFen ?? START_FEN;
    this.rules = new ChessRules(this.startFen);
    this.clock = opts.timeControl ? new ChessClock(opts.timeControl) : null;
    this.drawPolicy = opts.drawPolicy ?? 'automatic';
    this.firstMoveMs = this.clock ? (opts.firstMoveMs === undefined ? 30_000 : opts.firstMoveMs) : null;
    this.repetitions.set(positionKey(this.board), 1);
    this.balances.push(this.balance());
  }

  /** Read-only chess.js view of the one and only position (owned by `rules`). */
  private get board(): Chess { return this.rules.chessView; }

  private setEvents(events: GameEvent[]) {
    this.lastEvents = events;
    this.eventSeq++;
  }

  get turn(): Color { return this.rules.turn; }
  get fen(): string { return this.rules.fen; }
  get ply(): number { return this.history.length; }

  start(now: number): void {
    if (this.status !== 'waiting') return;
    this.status = 'active';
    if (this.firstMoveMs === null) this.clock?.start(this.rules.turn, now);
    else this.firstMoveDeadline = now + this.firstMoveMs;
    // a custom start position can already be over (mate, stalemate, dead by material)
    if (this.board.isCheckmate()) this.finish('checkmate', otherColor(this.turn), now, 'checkmate', 'checkmate');
    else if (this.board.isStalemate()) this.finish('stalemate', null, now, 'stalemate', 'stalemate');
    else if (isDeadByMaterial(this.rules.pieces())) this.finish('draw_insufficient', null, now, 'draw_insufficient', 'insufficient_material');
  }

  /** Abort if the first-move window ran out. Returns true if the game was aborted here. */
  checkAbort(now: number): boolean {
    if (this.status !== 'active' || this.firstMoveDeadline === null || now < this.firstMoveDeadline) return false;
    this.finish('aborted', null, now, 'aborted', 'aborted', this.turn);
    return true;
  }

  /** Apply a move by `color`. Never throws; illegal requests return a reason and change nothing. */
  move(color: Color, input: MoveInput, now: number): MoveResult {
    if (this.status !== 'active') return { ok: false, reason: 'game is not active', events: [] };
    if (this.rules.turn !== color) return { ok: false, reason: 'not your turn', events: [] };
    if (this.checkAbort(now)) return { ok: false, reason: 'game aborted: first move not made in time', events: this.lastEvents };
    const flagged = this.checkFlag(now);
    if (flagged) return { ok: false, reason: 'time expired', events: this.lastEvents };
    const piece = this.rules.pieceAt(input.from);
    if (!piece || piece.color !== color) return { ok: false, reason: 'not your piece', events: [] };
    if (this.rules.isPromotionMove(input.from, input.to) && !input.promotion) {
      return { ok: false, reason: 'promotion piece required', events: [] };
    }
    const record = this.rules.tryMove(input);
    if (!record) return { ok: false, reason: 'illegal move', events: [] };
    this.history.push(record);
    if (this.clock) {
      if (this.firstMoveDeadline !== null) {
        // first moves: no clock runs and no increment is added
        if (this.ply >= 2) { this.firstMoveDeadline = null; this.clock.start(otherColor(color), now); }
        else this.firstMoveDeadline = now + (this.firstMoveMs ?? 0);
      } else {
        this.clock.press(color, now);
      }
      record.clockAfterMs = this.clock.remaining[color];
    }
    this.drawOfferBy = null;

    const key = positionKey(this.board);
    this.repetitions.set(key, (this.repetitions.get(key) ?? 0) + 1);
    this.balances.push(this.balance());

    const openingBefore = this.opening;
    const hit = this.startFen === START_FEN ? lookupPosition(key) : null;
    this.inBook = !!hit;
    if (hit) {
      const sans = this.history.map((h) => h.san);
      const bookSans = hit.pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
      const transposed = bookSans.length !== sans.length || bookSans.some((s, j) => s !== sans[j]);
      this.opening = { ...hit, ply: this.ply, transposed };
    }

    const events = moveEvents({
      record, ply: this.ply, after: this.board, openingBefore, openingAfter: this.opening,
      balanceTwoPliesAgo: this.balances[Math.max(0, this.balances.length - 3)], balanceNow: this.balances[this.balances.length - 1],
    });
    this.setEvents(events);
    this.resolveAfterMove(color, now);
    return { ok: true, record, events: this.lastEvents };
  }

  /** Position-driven endings, in FIDE precedence: mate/stalemate end the game before any draw rule applies. */
  private resolveAfterMove(mover: Color, now: number): void {
    if (this.board.isCheckmate()) return this.finish('checkmate', mover, now, null, 'checkmate');
    if (this.board.isStalemate()) return this.finish('stalemate', null, now, null, 'stalemate');
    if (isDeadByMaterial(this.rules.pieces())) return this.finish('draw_insufficient', null, now, 'draw_insufficient', 'insufficient_material', null, true);
    if (this.repetitionCount() >= 5) return this.finish('draw_fivefold', null, now, 'draw_fivefold', 'fivefold_repetition', null, true);
    if (this.halfmoveClock() >= 150) return this.finish('draw_seventyfive', null, now, 'draw_seventyfive', 'seventy_five_move', null, true);
    const claim = this.claimableDraw();
    if (claim && this.drawPolicy === 'automatic') return this.finishClaim(claim, now, true);
    if (claim) this.setEvents([...this.lastEvents, { type: 'draw_claimable', ply: this.ply, color: this.turn }]);
  }

  /** `byMove`: the draw arose from the move just played (its events stay); otherwise it is a claim (an action). */
  private finishClaim(claim: 'threefold' | 'fifty', now: number, byMove: boolean, claimant: Color | null = null) {
    if (claim === 'threefold') this.finish('draw_repetition', null, now, 'draw_repetition', 'threefold_repetition', claimant, byMove);
    else this.finish('draw_fifty', null, now, 'draw_fifty', 'fifty_move', claimant, byMove);
  }

  repetitionCount(): number { return this.repetitions.get(positionKey(this.board)) ?? 0; }
  halfmoveClock(): number { return Number(this.rules.fen.split(' ')[4]); }

  claimableDraw(): 'threefold' | 'fifty' | null {
    if (this.status !== 'active') return null;
    if (this.repetitionCount() >= 3) return 'threefold';
    if (this.halfmoveClock() >= 100) return 'fifty';
    return null;
  }

  /**
   * FIDE 9.2/9.3 claim by the side to move. Without `intended`, the current position must qualify. With an intended
   * move (9.2.1.1 / 9.3.1), the claim is valid if that move would produce a threefold position or complete fifty
   * moves; the move itself is not played (the game ends as drawn). An invalid claim changes nothing.
   * Deviation from FIDE 9.5.3, documented in docs/CHESS.md: an incorrect claim with an intended move does not force
   * that move to be played and gives no time bonus to the opponent; it is simply rejected.
   */
  claimDraw(color: Color, now: number, intended?: MoveInput): string | null {
    if (this.status !== 'active') return 'game is not active';
    if (color !== this.turn) return 'only the side to move may claim';
    if (this.checkFlag(now)) return 'time expired';
    if (!intended) {
      const claim = this.claimableDraw();
      if (!claim) return 'no draw to claim';
      this.finishClaim(claim, now, false, color);
      return null;
    }
    const probe = new Chess(this.board.fen());
    try {
      probe.move({ from: intended.from, to: intended.to, promotion: intended.promotion });
    } catch {
      return 'intended move is illegal';
    }
    const key = positionKey(probe);
    if ((this.repetitions.get(key) ?? 0) + 1 >= 3) { this.finishClaim('threefold', now, false, color); return null; }
    if (Number(probe.fen().split(' ')[4]) >= 100) { this.finishClaim('fifty', now, false, color); return null; }
    return 'no draw to claim';
  }

  /**
   * Flag fall (FIDE 6.9): the side whose time ran out loses, unless the opponent cannot checkmate by any sequence
   * of legal moves, in which case it is a draw. Returns the flagged colour if the game ended here.
   */
  checkFlag(now: number): Color | null {
    if (!this.clock || this.status !== 'active') return null;
    const flagged = this.clock.flagged(now);
    if (!flagged) return null;
    const opponent = otherColor(flagged);
    if (canPossiblyMate(this.rules.pieces(), opponent)) this.finish('timeout', opponent, now, 'timeout', 'timeout', flagged);
    else this.finish('draw_insufficient', null, now, 'timeout', 'timeout_vs_insufficient', flagged);
    return flagged;
  }

  resign(color: Color, now: number): boolean {
    if (this.status !== 'active') return false;
    if (this.checkFlag(now)) return false; // the flag fell first: the game is already over
    this.finish('resigned', otherColor(color), now, 'resign', 'resignation', color);
    return true;
  }

  /** Returns 'agreed' if this completes a pending offer by the other side. */
  offerDraw(color: Color, now: number): 'offered' | 'agreed' | null {
    if (this.status !== 'active') return null;
    if (this.checkFlag(now)) return null;
    if (this.drawOfferBy && this.drawOfferBy !== color) { this.finish('draw_agreed', null, now, 'draw_agreed', 'agreement'); return 'agreed'; }
    this.drawOfferBy = color;
    this.setEvents([{ type: 'draw_offered', ply: this.ply, color }]);
    return 'offered';
  }

  acceptDraw(color: Color, now: number): boolean {
    if (this.status !== 'active' || !this.drawOfferBy || this.drawOfferBy === color) return false;
    if (this.checkFlag(now)) return false;
    this.finish('draw_agreed', null, now, 'draw_agreed', 'agreement');
    return true;
  }

  declineDraw(color: Color): boolean {
    if (this.status !== 'active' || !this.drawOfferBy || this.drawOfferBy === color) return false;
    this.drawOfferBy = null;
    this.setEvents([]);
    return true;
  }

  /**
   * A player left for good (disconnect grace expired). Treated like a flag fall (6.9 analogue): the opponent wins
   * only if they could still checkmate. `loser` null ends the game without a winner.
   */
  abandon(loser: Color | null, now: number): void {
    if (isFinished(this.status)) return;
    if (!loser) return this.finish('abandoned', null, now, 'abandoned', 'abandoned');
    const opponent = otherColor(loser);
    if (canPossiblyMate(this.rules.pieces(), opponent)) this.finish('abandoned', opponent, now, 'abandoned', 'abandoned', loser);
    else this.finish('abandoned', null, now, 'abandoned', 'abandoned_vs_insufficient', loser);
  }

  /**
   * End the game. `byMove`: the ending was caused by the move just played, so its terminal event is appended to that
   * move's events; otherwise (resign, timeout, claim, agreement, abort...) the terminal event stands alone.
   */
  private finish(status: GameStatus, winner: Color | null, now: number, event: GameEvent['type'] | null, termination: Termination, actor: Color | null = null, byMove = false): void {
    if (isFinished(this.status)) return;
    this.clock?.stop(now);
    this.status = status;
    this.winner = winner;
    this.termination = termination;
    this.drawOfferBy = null;
    this.firstMoveDeadline = null;
    if (!event) return; // checkmate/stalemate after a move are already in that move's events
    const terminal: GameEvent = { type: event, ply: this.ply, color: actor };
    this.setEvents(byMove ? [...this.lastEvents, terminal] : [terminal]);
  }

  legalMovesUci(): string[] {
    if (this.status !== 'active') return [];
    return this.rules.allLegalMoves().map((m) => m.from + m.to + (m.promotion ?? ''));
  }

  snapshot(now: number): CoreSnapshot {
    return {
      fen: this.fen,
      turn: this.turn,
      status: this.status,
      winner: this.winner,
      termination: this.termination,
      history: this.history,
      drawOfferBy: this.drawOfferBy,
      clocks: this.clock ? { w: this.clock.peek('w', now), b: this.clock.peek('b', now) } : null,
      running: this.clock?.running ?? null,
      opening: this.opening,
      inBook: this.inBook,
      claimableDraw: this.drawPolicy === 'claim' ? this.claimableDraw() : null,
      legalMoves: this.legalMovesUci(),
      lastEvents: this.lastEvents,
      eventSeq: this.eventSeq,
      firstMoveDeadline: this.firstMoveDeadline,
    };
  }

  private balance(): number {
    const m = materialCount(this.rules.pieces());
    return m.w - m.b;
  }
}
