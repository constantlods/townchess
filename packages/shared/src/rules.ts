import { Chess, type Move } from 'chess.js';
import type { Color, MoveEffect, MoveRecord, PieceType, Promotion, Square } from './types.js';

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
    this.chess = new Chess(sanitizeCastling(fen));
  }

  static fromHistory(moves: MoveInput[], startFen = START_FEN): ChessRules {
    const r = new ChessRules(startFen);
    for (const m of moves) {
      if (!r.tryMove(m)) throw new Error(`illegal move in history: ${m.from}${m.to}`);
    }
    return r;
  }

  /** Copy of the current position (history is not carried over; GameCore tracks history and repetitions). */
  clone(): ChessRules {
    return new ChessRules(this.chess.fen());
  }

  /**
   * The underlying chess.js instance, for read-only queries (attackers, mate, legal moves) by GameCore. Mutating it
   * directly would bypass the wrapper; only ChessRules itself moves pieces.
   */
  get chessView(): Chess {
    return this.chess;
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

  /**
   * Attempts a move. Returns a MoveRecord, or null if illegal. Never throws.
   * A promotion move must name its piece: there is no silent promotion to a queen.
   */
  tryMove(input: MoveInput): MoveRecord | null {
    const promoting = this.isPromotionMove(input.from, input.to);
    if (!input.promotion && promoting) return null;
    if (input.promotion && !promoting) return null; // a promotion piece on a non-promotion move is malformed
    let m: Move;
    try {
      m = this.chess.move({ from: input.from, to: input.to, promotion: input.promotion });
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
      effects: moveEffects(m),
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

}

export const otherColor = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const FILES = 'abcdefgh';
export const squareToFR = (sq: Square): [number, number] => [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
export const frToSquare = (f: number, r: number): Square => `${FILES[f]}${r + 1}`;

/** Physical effects of a chess.js move, in order: capture, every piece movement, promotion swap. */
export function moveEffects(m: Move): MoveEffect[] {
  const color = m.color as Color;
  const enemy = otherColor(color);
  const out: MoveEffect[] = [];
  if (m.flags.includes('e')) out.push({ kind: 'capture', square: `${m.to[0]}${m.from[1]}`, piece: 'p', color: enemy });
  else if (m.captured) out.push({ kind: 'capture', square: m.to, piece: m.captured as PieceType, color: enemy });
  out.push({ kind: 'move', piece: m.piece as PieceType, color, from: m.from, to: m.to });
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rank = m.from[1];
    const kingside = m.flags.includes('k');
    out.push({ kind: 'move', piece: 'r', color, from: `${kingside ? 'h' : 'a'}${rank}`, to: `${kingside ? 'f' : 'd'}${rank}` });
  }
  if (m.promotion) out.push({ kind: 'promote', square: m.to, color, from: 'p', to: m.promotion as Promotion });
  return out;
}

/**
 * FIDE 3.8.2: castling rights exist only while the king and that rook stand on their original squares. chess.js
 * trusts the FEN's castling field, so impossible rights are stripped here (regression BUG-001).
 */
export function sanitizeCastling(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 3 || parts[2] === '-') return fen;
  const board: Record<string, string> = {};
  parts[0].split('/').forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      board[`${FILES[file]}${8 - i}`] = ch;
      file++;
    }
  });
  const ok: Record<string, boolean> = {
    K: board.e1 === 'K' && board.h1 === 'R', Q: board.e1 === 'K' && board.a1 === 'R',
    k: board.e8 === 'k' && board.h8 === 'r', q: board.e8 === 'k' && board.a8 === 'r',
  };
  const rights = [...parts[2]].filter((c) => ok[c]).join('') || '-';
  parts[2] = rights;
  return parts.join(' ');
}
