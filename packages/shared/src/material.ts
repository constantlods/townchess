import type { Color, PieceType } from './types.js';

export interface PieceOnBoard {
  square: string;
  type: PieceType;
  color: Color;
}

const squareColour = (sq: string) => ('abcdefgh'.indexOf(sq[0]) + Number(sq[1])) % 2; // 1 = dark (a1), 0 = light

/**
 * Can `color` still checkmate by *any* sequence of legal moves (opponent cooperating)? This is the test FIDE 6.9
 * uses for "flag fell but the opponent cannot win" and that 5.2.2 uses for dead positions by material.
 *
 * Decided by material class, which covers every dead-by-material case:
 * - bare king: never;
 * - any pawn, rook or queen: yes;
 * - a knight plus any other minor, or bishops on both square colours: yes (mate with help is possible);
 * - only bishops, all on one square colour: only if the opponent owns a pawn, a knight, or a bishop on the other
 *   colour (a rook or queen cannot be forced into a blocking role that allows mate);
 * - a single knight: only if the opponent owns a pawn, knight, bishop or rook (no mate exists against K+Q alone).
 *
 * The rook/queen exclusions are backed by exhaustive enumeration of every K+X vs K+Y placement (no mate exists for
 * N vs Q, B vs R, B vs Q); see packages/shared/test/fixtures/fide-cases.json and docs/CHESS.md.
 *
 * Not covered (documented in docs/CHESS.md): positions dead because of pawn structure or blockade, which need search.
 */
export function canPossiblyMate(pieces: readonly PieceOnBoard[], color: Color): boolean {
  const mine = pieces.filter((p) => p.color === color && p.type !== 'k');
  const theirs = pieces.filter((p) => p.color !== color && p.type !== 'k');
  if (mine.length === 0) return false;
  if (mine.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  const knights = mine.filter((p) => p.type === 'n');
  const bishops = mine.filter((p) => p.type === 'b');
  if (knights.length >= 2) return true;
  if (knights.length >= 1 && bishops.length >= 1) return true;
  const myBishopColours = new Set(bishops.map((b) => squareColour(b.square)));
  if (myBishopColours.size === 2) return true;
  if (knights.length === 1) return theirs.some((p) => p.type !== 'q');
  // only bishops, all on one colour
  const [mineColour] = [...myBishopColours];
  return theirs.some((p) => p.type === 'p' || p.type === 'n' || (p.type === 'b' && squareColour(p.square) !== mineColour));
}

/** Dead by material: neither side can checkmate by any legal sequence (FIDE 5.2.2, material cases only). */
export const isDeadByMaterial = (pieces: readonly PieceOnBoard[]) => !canPossiblyMate(pieces, 'w') && !canPossiblyMate(pieces, 'b');

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material in conventional pawn units. */
export function materialCount(pieces: readonly PieceOnBoard[]): Record<Color, number> {
  const out: Record<Color, number> = { w: 0, b: 0 };
  for (const p of pieces) out[p.color] += VALUE[p.type];
  return out;
}

export const pieceValue = (t: PieceType) => VALUE[t];
