import { randomBytes } from 'node:crypto';
import { ChessClock, ChessRules, isFinished, otherColor, type Color, type GameStateDTO, type GameStatus, type MoveRecord, type Promotion, type TimeControl } from '@hc/shared';
import type { PlayerStore } from './players.js';

export const DISCONNECT_GRACE_MS = 60_000;

export interface RoomEvents {
  /** Broadcast to both seats (and anyone else in the room). */
  broadcast(room: GameRoom, msg: object): void;
  /** Send to one player. */
  send(playerId: string, msg: object): void;
  finished(room: GameRoom): void;
}

export const newGameId = () => 'GAME-' + randomBytes(3).toString('hex').toUpperCase();

/**
 * One authoritative game. The server owns: legal moves, whose turn, the clocks and the result.
 * Clients only ask; nothing they send is trusted beyond their authenticated identity.
 */
export class GameRoom {
  rules = new ChessRules();
  clock: ChessClock;
  history: MoveRecord[] = [];
  status: GameStatus = 'waiting';
  winner: Color | null = null;
  drawOfferBy: Color | null = null;
  rematchOfferBy: Color | null = null;
  disconnected = new Map<Color, NodeJS.Timeout>();
  createdAt = Date.now();
  updatedAt = Date.now();
  private flagTimer: NodeJS.Timeout | null = null;
  /** For tests: injectable clock. */
  now: () => number = () => Date.now();

  constructor(
    public id: string,
    public tc: TimeControl,
    public rated: boolean,
    public white: string | null,
    public black: string | null,
    private players: PlayerStore,
    private ev: RoomEvents,
    public isPrivate = false,
  ) {
    this.clock = new ChessClock(tc);
  }

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
    this.status = 'active';
    this.clock.start('w', this.now());
    this.armFlag();
    this.touch();
  }

  private touch() { this.updatedAt = this.now(); }

  dto(): GameStateDTO {
    const now = this.now();
    return {
      id: this.id,
      white: this.white ? this.players.publicOf(this.white) : null,
      black: this.black ? this.players.publicOf(this.black) : null,
      fen: this.rules.fen,
      moveHistory: this.history,
      turn: this.rules.turn,
      whiteClockMs: this.clock.peek('w', now),
      blackClockMs: this.clock.peek('b', now),
      clockSampledAt: now,
      status: this.status,
      winner: this.winner,
      rated: this.rated,
      timeControl: this.tc,
      drawOfferBy: this.drawOfferBy,
      rematchOfferBy: this.rematchOfferBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      disconnected: [...this.disconnected.keys()],
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
    if (this.status !== 'active') return 'game is not active';
    if (this.rules.turn !== color) return 'not your turn';
    if (ply !== this.history.length) return 'stale move';
    const now = this.now();
    const flagged = this.clock.flagged(now);
    if (flagged) { this.flagFall(flagged); return 'time expired'; }
    const piece = this.rules.pieceAt(from);
    if (!piece || piece.color !== color) return 'not your piece';
    const rec = this.rules.tryMove({ from, to, promotion });
    if (!rec) return 'illegal move';
    this.clock.press(color, now);
    rec.clockAfterMs = this.clock.remaining[color];
    this.history.push(rec);
    this.drawOfferBy = null;
    const ps = this.rules.positionStatus();
    if (ps.status !== 'active') this.finish(ps.status, ps.winner, 'move');
    else { this.armFlag(); this.update('move'); }
    return null;
  }

  private armFlag() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    const c = this.clock.running;
    if (!c || this.status !== 'active') return;
    const ms = this.clock.peek(c, this.now());
    this.flagTimer = setTimeout(() => {
      const f = this.clock.flagged(this.now());
      if (f) this.flagFall(f); else this.armFlag();
    }, ms + 5);
    this.flagTimer.unref?.();
  }

  private flagFall(loser: Color) {
    const winner = otherColor(loser);
    // a flag is a draw if the side with time cannot possibly mate
    if (!this.rules.hasMatingMaterial(winner)) this.finish('draw_insufficient', null, 'timeout');
    else this.finish('timeout', winner, 'timeout');
  }

  finish(status: GameStatus, winner: Color | null, reason: string) {
    if (isFinished(this.status)) return;
    this.clock.stop(this.now());
    if (this.flagTimer) clearTimeout(this.flagTimer);
    for (const t of this.disconnected.values()) clearTimeout(t);
    this.status = status;
    this.winner = winner;
    this.drawOfferBy = null;
    if (this.white && this.black && this.history.length >= 2) {
      this.players.recordResult(this.white, this.black, winner === 'w' ? 1 : winner === 'b' ? 0 : 0.5, this.rated);
    }
    this.update(reason);
    this.ev.finished(this);
  }

  resign(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c || this.status !== 'active') return;
    this.finish('resigned', otherColor(c), 'resign');
  }

  offerDraw(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c || this.status !== 'active') return;
    if (this.drawOfferBy && this.drawOfferBy !== c) { this.finish('draw_agreed', null, 'draw'); return; }
    this.drawOfferBy = c;
    this.ev.broadcast(this, { type: 'DRAW_OFFER', gameId: this.id, by: c });
    this.update('draw_offer');
  }

  acceptDraw(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c || this.status !== 'active' || !this.drawOfferBy || this.drawOfferBy === c) return;
    this.finish('draw_agreed', null, 'draw');
  }

  declineDraw(playerId: string) {
    const c = this.colorOf(playerId);
    if (!c || !this.drawOfferBy || this.drawOfferBy === c) return;
    this.drawOfferBy = null;
    this.update('draw_declined');
  }

  /** Both players asking for a rematch creates a new room with colours swapped. Returns it. */
  rematch(playerId: string, create: (white: string, black: string) => GameRoom): GameRoom | null {
    const c = this.colorOf(playerId);
    if (!c || !isFinished(this.status) || !this.white || !this.black) return null;
    if (this.rematchOfferBy && this.rematchOfferBy !== c) {
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
      if (this.status === 'waiting') { this.finish('abandoned', null, 'abandoned'); return; }
      this.finish('abandoned', otherColor(c), 'abandoned');
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

  dispose() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    for (const t of this.disconnected.values()) clearTimeout(t);
  }
}
