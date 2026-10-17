import { Chess } from 'chess.js';

/**
 * Position identity for repetition and opening lookup (FIDE 9.2.3: same pieces on the same squares, same side to
 * move, same castling rights and same en passant *possibility*).
 *
 * chess.js writes an en passant square whenever an enemy pawn stands beside the pushed pawn, even when that capture
 * is illegal (for example the capturing pawn is pinned). Such a position is the same as one without the ep square,
 * so the ep field is kept only if a legal ep capture exists.
 */
export function positionKey(position: Chess | string): string {
  const chess = typeof position === 'string' ? new Chess(position) : position;
  const [placement, turn, castling, ep] = chess.fen().split(' ');
  let epField = ep;
  if (ep !== '-') {
    const legalEp = chess.moves({ verbose: true }).some((m) => m.flags.includes('e'));
    if (!legalEp) epField = '-';
  }
  return `${placement} ${turn} ${castling} ${epField}`;
}
