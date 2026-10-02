import { Chess, type Move } from 'chess.js';
import type { Color, GameStatus, MoveRecord, PieceType, Promotion, Square } from './types.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface BoardPiece {
  square: Square;
  type: PieceType;
  color: Color;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: Promotion;
}

/**
 * Thin authoritative rules wrapper around chess.js.
 * The same class runs on the server (authority) and the client (move hints / local play).
 */
export class ChessRules {
  private chess: Chess;

  constructor(fen: string = START_FEN) {
    this.chess = new Chess(fen);
  }

  static fromHistory(moves: MoveInput[], startFen = START_FEN): ChessRules {
    const r = new ChessRules(startFen);
    for (const m of moves) {
      if (!r.tryMove(m)) throw new Error(`illegal move in history: ${m.from}${m.to}`);
    }
    return r;
  }

  clone(): ChessRules {
    const r = new ChessRules();
    r.chess.loadPgn(this.chess.pgn());
    return r;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn();
  }

  pieces(): BoardPiece[] {
    const out: BoardPiece[] = [];
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (cell) out.push({ square: cell.square, type: cell.type, color: cell.color });
      }
    }
    return out;
  }

  pieceAt(sq: Square): BoardPiece | null {
    const p = this.chess.get(sq as never);
    return p ? { square: sq, type: p.type, color: p.color } : null;
  }

  legalMovesFrom(sq: Square): Move[] {
    return this.chess.moves({ square: sq as never, verbose: true });
  }

  allLegalMoves(): Move[] {
    return this.chess.moves({ verbose: true });
  }

  isPromotionMove(from: Square, to: Square): boolean {
    return this.legalMovesFrom(from).some((m) => m.to === to && !!m.promotion);
  }

  /** Attempts a move. Returns a MoveRecord, or null if illegal. Never throws. */
  tryMove(input: MoveInput): MoveRecord | null {
    let m: Move;
    try {
      m = this.chess.move({ from: input.from, to: input.to, promotion: input.promotion ?? 'q' });
    } catch {
      return null;
    }
    return {
      from: m.from,
      to: m.to,
      promotion: m.promotion as Promotion | undefined,
      san: m.san,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      flags: m.flags,
      fenAfter: this.chess.fen(),
    };
  }

  undo(): void {
    this.chess.undo();
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  kingSquare(color: Color): Square | null {
    return this.pieces().find((p) => p.type === 'k' && p.color === color)?.square ?? null;
  }

  /** Status derived purely from the position (not clocks, resignations, or agreements). */
  positionStatus(): { status: GameStatus; winner: Color | null } {
    const c = this.chess;
    if (c.isCheckmate()) return { status: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
    if (c.isStalemate()) return { status: 'stalemate', winner: null };
    if (c.isInsufficientMaterial()) return { status: 'draw_insufficient', winner: null };
    if (c.isThreefoldRepetition()) return { status: 'draw_repetition', winner: null };
    if (c.isDrawByFiftyMoves()) return { status: 'draw_fifty', winner: null };
    return { status: 'active', winner: null };
  }

  /** True if `color` has enough material to theoretically mate (used for timeout-vs-insufficient). */
  hasMatingMaterial(color: Color): boolean {
    const mine = this.pieces().filter((p) => p.color === color && p.type !== 'k');
    if (mine.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
    const minors = mine.filter((p) => p.type === 'n' || p.type === 'b').length;
    return minors >= 2;
  }
}

export const otherColor = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const FILES = 'abcdefgh';
export const squareToFR = (sq: Square): [number, number] => [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
export const frToSquare = (f: number, r: number): Square => `${FILES[f]}${r + 1}`;
