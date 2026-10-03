import type { Chess } from 'chess.js';
import type { OpeningInfo } from './openings/index.js';
import { isGambit } from './openings/index.js';
import type { Color, MoveRecord, PieceType } from './types.js';

/**
 * Deterministic game events: the facts that presentation, commentary, the analysis cart and agents react to.
 * Everything here is derived from the rules; nothing depends on an engine. Engine-backed judgements (blunder,
 * brilliant, ...) are a later layer and get their own event types.
 */
export type GameEventType =
  | 'move' | 'capture' | 'check' | 'double_check' | 'discovered_check' | 'checkmate' | 'stalemate'
  | 'castle_kingside' | 'castle_queenside' | 'en_passant' | 'promotion'
  | 'opening_identified' | 'gambit_offered' | 'material_swing'
  | 'draw_repetition' | 'draw_fivefold' | 'draw_fifty' | 'draw_seventyfive' | 'draw_insufficient'
  | 'draw_agreed' | 'draw_offered' | 'draw_claimable' | 'resign' | 'timeout' | 'abandoned' | 'aborted';

export interface GameEvent {
  type: GameEventType;
  /** Ply the event belongs to (1 = White's first move; terminal events use the last ply). */
  ply: number;
  /** Side that caused the event (the mover, the resigning side, the side that flagged...). */
  color: Color | null;
  san?: string;
  piece?: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  opening?: { eco: string; name: string; family: string; variation: string | null };
  /** Material balance from White's point of view after the event, in pawn units. */
  balance?: number;
  /** For material_swing: change of the balance over the last two plies, from the mover's point of view. */
  swing?: number;
}

/** Squares of pieces of `by` attacking `square` (chess.js >= 1.0 `attackers`). */
function attackersOf(chess: Chess, square: string, by: Color): string[] {
  return (chess as unknown as { attackers(sq: string, c: Color): string[] }).attackers(square, by);
}

export interface MoveEventInput {
  record: MoveRecord;
  ply: number;
  /** Position after the move. */
  after: Chess;
  openingBefore: OpeningInfo | null;
  openingAfter: OpeningInfo | null;
  /** White-POV material balance two plies ago and now. */
  balanceTwoPliesAgo: number;
  balanceNow: number;
}

export function moveEvents(i: MoveEventInput): GameEvent[] {
  const { record: r, ply, after } = i;
  const base = { ply, color: r.color, san: r.san, piece: r.piece } as const;
  const ev: GameEvent[] = [{ type: 'move', ...base }];
  if (r.captured) ev.push({ type: 'capture', ...base, captured: r.captured });
  if (r.flags.includes('e')) ev.push({ type: 'en_passant', ...base, captured: 'p' });
  if (r.flags.includes('k')) ev.push({ type: 'castle_kingside', ...base });
  if (r.flags.includes('q')) ev.push({ type: 'castle_queenside', ...base });
  if (r.promotion) ev.push({ type: 'promotion', ...base, promotion: r.promotion });

  if (after.inCheck()) {
    const kingSq = after.board().flat().find((p) => p && p.type === 'k' && p.color !== r.color)!.square;
    const checkers = attackersOf(after, kingSq, r.color);
    // castling can only check with the rook, which is never on `to` (the king's square)
    const movedPieceSquare = r.flags.includes('k') || r.flags.includes('q') ? null : r.to;
    if (checkers.length >= 2) ev.push({ type: 'double_check', ...base });
    else if (movedPieceSquare && !checkers.includes(movedPieceSquare)) ev.push({ type: 'discovered_check', ...base });
    ev.push({ type: after.isCheckmate() ? 'checkmate' : 'check', ...base });
  } else if (after.isStalemate()) {
    ev.push({ type: 'stalemate', ...base });
  }

  const ob = i.openingBefore;
  const oa = i.openingAfter;
  if (oa && oa.name !== ob?.name) {
    const opening = { eco: oa.eco, name: oa.name, family: oa.family, variation: oa.variation };
    ev.push({ type: 'opening_identified', ...base, opening });
    if (isGambit(oa) && !(ob && isGambit(ob) && ob.family === oa.family)) ev.push({ type: 'gambit_offered', ...base, opening });
  }

  const mover = r.color === 'w' ? 1 : -1;
  const swing = (i.balanceNow - i.balanceTwoPliesAgo) * mover;
  if (Math.abs(swing) >= 3) ev.push({ type: 'material_swing', ...base, balance: i.balanceNow, swing });
  return ev;
}
