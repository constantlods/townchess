import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GameCore, isFinished, otherColor, type Color, type GameStateDTO, type Promotion, type TimeControl, type MoveInput } from '@hc/shared';
import type { PlayerStore } from './players.js';

export const DISCONNECT_GRACE_MS = 60_000;
/** First-move window: clocks start after both first moves; no first move in time aborts the game. */
export const FIRST_MOVE_MS = 30_000;

export interface RoomEvents {
  /** Broadcast to both seats (and anyone else in the room). */
  broadcast(room: GameRoom, msg: object): void;
  /** Send to one player. */
  send(playerId: string, msg: object): void;
  finished(room: GameRoom): void;
  /** A seat played by the engine must move now (the hub schedules the search off the event loop). */
  aiToMove?(room: GameRoom): void;
}

export const newGameId = () => 'GAME-' + randomBytes(3).toString('hex').toUpperCase();

/** Player ids of engine seats look like `ai:<level>`. */
export const isAiSeat = (playerId: string | null) => !!playerId && playerId.startsWith('ai:');

export interface RoomOptions {
  isPrivate?: boolean;
  /** null = untimed. */
  timeControl: TimeControl | null;
}

/**
 * One authoritative game on the server. All chess and game-flow decisions are delegated to the shared GameCore; the
 * room adds identity (who sits where), timers, ratings and messaging. Clients only ask.
 *
 * Time: the core runs on a monotonic clock (performance.now) so an NTP step cannot flag anyone; wall-clock time
 * (Date.now) appears only in messages for display.
 */
export class GameRoom {
  core: GameCore;
  rematchOfferBy: Color | null = null;
  disconnected = new Map<Color, NodeJS.Timeout>();
  createdAt = Date.now();
  updatedAt = Date.now();
  readonly isPrivate: boolean;
  readonly untimed: boolean;
  private flagTimer: NodeJS.Timeout | null = null;
  private abortTimer: NodeJS.Timeout | null = null;
  /** Monotonic time source; injectable for tests. */
  now: () => number = () => performance.now();
  /** Wall time for display fields; injectable for tests. */
  wallNow: () => number = () => Date.now();

  constructor(
    public id: string,
    public tc: TimeControl,
    public rated: boolean,
    public white: string | null,
    public black: string | null,
    private players: PlayerStore,
    private ev: RoomEvents,
    opts: Partial<RoomOptions> = {},
  ) {
    this.isPrivate = opts.isPrivate ?? false;
    this.untimed = opts.timeControl === null;
    this.core = new GameCore({ timeControl: this.untimed ? null : tc, firstMoveMs: FIRST_MOVE_MS });
  }

  get status() { return this.core.status; }
  get history() { return this.core.history; }

  colorOf(playerId: string): Color | null {
    return this.white === playerId ? 'w' : this.black === playerId ? 'b' : null;
  }
  playerOf(c: Color) { return c === 'w' ? this.white : this.black; }

  /** Seat a second player in a waiting (private) room. */
  seat(playerId: string): Color | null {
    if (this.colorOf(playerId)) return this.colorOf(playerId);
    if (this.status !== 'waiting') return null;
    if (!this.white) this.white = playerId; else if (!this.black) this.black = playerId; else return null;
    if (this.white && this.black) this.start();
    return this.colorOf(playerId);
  }

  start() {
    this.core.start(this.now());
    this.armTimers();
    this.touch();
    this.maybeAi();
  }

  private touch() { this.updatedAt = this.wallNow(); }

  dto(): GameStateDTO {
    const now = this.now();
    const wall = this.wallNow();
    const snap = this.core.snapshot(now);
    const initial = this.tc.initialMs;
    return {
      id: this.id,
      white: this.white ? this.players.publicOf(this.white) : null,
      black: this.black ? this.players.publicOf(this.black) : null,
      fen: snap.fen,
      moveHistory: snap.history,
      turn: snap.turn,
      whiteClockMs: snap.clocks?.w ?? initial,
      blackClockMs: snap.clocks?.b ?? initial,
      clockSampledAt: wall,
      status: snap.status,
      winner: snap.winner,
      rated: this.rated,
      timeControl: this.tc,
      drawOfferBy: snap.drawOfferBy,
      rematchOfferBy: this.rematchOfferBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      disconnected: [...this.disconnected.keys()],
      termination: snap.termination,
      drawPolicy: this.core.drawPolicy,
      claimableDraw: snap.claimableDraw,
      legalMoves: snap.legalMoves,
      opening: snap.opening && {
        eco: snap.opening.eco, name: snap.opening.name, family: snap.opening.family, variation: snap.opening.variation,
        subvariation: snap.opening.subvariation, ply: snap.opening.ply, transposed: snap.opening.transposed,
      },
      inBook: snap.inBook,
      lastEvents: snap.lastEvents,
      firstMoveDeadline: snap.firstMoveDeadline === null ? null : wall + (snap.firstMoveDeadline - now),
    };
  }

  private update(reason: string) {
    this.touch();
    this.ev.broadcast(this, { type: 'GAME_STATE_UPDATED', state: this.dto(), reason });
  }

  /** Validate and apply a move. Returns null on success or a rejection reason. */
  move(playerId: string, from: string, to: string, promotion: Promotion | undefined, ply: number): string | null {
    const color = this.colorOf(playerId);
    if (!color) return 'not a player in this game';
    if (ply !== this.core.ply && this.status === 'active') return 'stale move';
    const statusBefore = this.status;
    const r = this.core.move(color, { from, to, promotion }, this.now());
    if (!r.ok) {
      // the attempt itself may have ended the game (flag fall, abort): report that to everyone
      if (isFinished(this.status) && !isFinished(statusBefore)) this.onFinished(this.status);
      return r.reason;
    }
    if (isFinished(this.status)) this.onFinished('move');
    else { this.armTimers(); this.update('move'); this.maybeAi(); }
    return null;
  }

  private armTimers() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    if (this.abortTimer) clearTimeout(this.abortTimer);
    this.flagTimer = this.abortTimer = null;
    if (this.status !== 'active') return;
    const now = this.now();
    const deadline = this.core.firstMoveDeadline;
    if (deadline !== null) {
      this.abortTimer = setTimeout(() => {
        if (this.core.checkAbort(this.now())) this.onFinished('aborted'); else this.armTimers();
      }, Math.max(0, deadline - now) + 5);
      this.abortTimer.unref?.();
      return;
    }
    const c = this.core.clock?.running;
    if (!c) return;
    this.flagTimer = setTimeout(() => {
      if (this.core.checkFlag(this.now())) this.onFinished('timeout'); else this.armTimers();
    }, this.core.clock!.peek(c, now) + 5);
    this.flagTimer.unref?.();
  }

  /** Called once whenever the core reports a finished game. Records ratings and notifies. */
  private onFinished(reason: string) {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    if (this.abortTimer) clearTimeout(this.abortTimer);
    for (const t of this.disconnected.values()) clearTimeout(t);
    const humans = this.white && this.black && !isAiSeat(this.white) && !isAiSeat(this.black);
    if (humans && this.status !== 'aborted' && this.history.length >= 2) {
      const w = this.core.winner;
      this.players.recordResult(this.white!, this.black!, w === 'w' ? 1 : w === 'b' ? 0 : 0.5, this.rated);
    }
    this.update(reason);
    this.ev.finished(this);
  }

  /** The creator left a private table before anyone joined. */
  leaveWaiting() {
    if (this.status !== 'waiting') return;
    this.core.abandon(null, this.now());
    this.onFinished('left');
  }

  resign(playerId: string) {
    const c = this.colorOf(playerId);
    if (c && this.core.resign(c, this.now())) this.onFinished('resign');
  }

  offerDraw(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c) return;
    const r = this.core.offerDraw(c, this.now());
    if (r === 'agreed') { this.onFinished('draw'); return; }
    if (r === 'offered') {
      this.ev.broadcast(this, { type: 'DRAW_OFFER', gameId: this.id, by: c });
      this.update('draw_offer');
    }
  }

  acceptDraw(playerId: string) {
    const c = this.colorOf(playerId);
    if (c && this.core.acceptDraw(c, this.now())) this.onFinished('draw');
  }

  declineDraw(playerId: string) {
    const c = this.colorOf(playerId);
    if (c && this.core.declineDraw(c)) this.update('draw_declined');
  }

  /** Returns a rejection reason, or null if the claim ended the game. */
  claimDraw(playerId: string, intended?: MoveInput): string | null {
    const c = this.colorOf(playerId);
    if (!c) return 'not a player in this game';
    const err = this.core.claimDraw(c, this.now(), intended);
    if (err === null) this.onFinished('draw_claim');
    return err;
  }

  /** Both players asking for a rematch creates a new room with colours swapped. Returns it. */
  rematch(playerId: string, create: (white: string, black: string) => GameRoom): GameRoom | null {
    const c = this.colorOf(playerId);
    if (!c || !isFinished(this.status) || !this.white || !this.black) return null;
    const opponentIsAi = isAiSeat(this.playerOf(otherColor(c)));
    if (opponentIsAi || (this.rematchOfferBy && this.rematchOfferBy !== c)) {
      this.rematchOfferBy = null;
      return create(this.black, this.white);
    }
    this.rematchOfferBy = c;
    this.ev.broadcast(this, { type: 'REMATCH', gameId: this.id, by: c });
    this.update('rematch_offer');
    return null;
  }

  /** A player's socket dropped. Their clock keeps running; after a grace period the game is abandoned. */
  disconnect(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c || isFinished(this.status) || this.disconnected.has(c)) return;
    const t = setTimeout(() => {
      this.disconnected.delete(c);
      if (this.status === 'waiting') { this.core.abandon(null, this.now()); this.onFinished('abandoned'); return; }
      this.core.abandon(c, this.now());
      this.onFinished('abandoned');
    }, DISCONNECT_GRACE_MS);
    t.unref?.();
    this.disconnected.set(c, t);
    const other = this.playerOf(otherColor(c));
    if (other) this.ev.send(other, { type: 'OPPONENT_DISCONNECTED', gameId: this.id, graceMs: DISCONNECT_GRACE_MS });
    this.update('disconnect');
  }

  reconnect(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c) return;
    const t = this.disconnected.get(c);
    if (t) {
      clearTimeout(t);
      this.disconnected.delete(c);
      const other = this.playerOf(otherColor(c));
      if (other) this.ev.send(other, { type: 'OPPONENT_RECONNECTED', gameId: this.id });
      this.update('reconnect');
    }
  }

  /** If the side to move is an engine seat, ask the hub to search. */
  private maybeAi() {
    if (this.status === 'active' && isAiSeat(this.playerOf(this.core.turn))) this.ev.aiToMove?.(this);
  }

  dispose() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    if (this.abortTimer) clearTimeout(this.abortTimer);
    for (const t of this.disconnected.values()) clearTimeout(t);
  }
}
