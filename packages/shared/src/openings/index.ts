import { Chess } from 'chess.js';
import { positionKey } from '../position.js';
import { START_FEN } from '../rules.js';
import book from './book.json' with { type: 'json' };

/** Data: Lichess chess-openings (CC0), see packages/shared/data/openings/SOURCE.md. */
type BookRow = [eco: string, name: string, plies: number, pgn: string, aliases?: string[]];
const BOOK = book as unknown as Record<string, BookRow>;

export interface OpeningInfo {
  eco: string;
  /** Full Lichess name, e.g. "Sicilian Defense: Najdorf Variation, English Attack". */
  name: string;
  /** "Sicilian Defense" */
  family: string;
  /** "Najdorf Variation" */
  variation: string | null;
  /** "English Attack" (everything after the first comma) */
  subvariation: string | null;
  /** Book line that names this position, as PGN movetext. */
  pgn: string;
  /** Other names that reach the same position. */
  aliases: string[];
  /** Ply of the game at which this position was reached (1 = after White's first move). */
  ply: number;
  /** True when the game reached the named position by a different move order than the book line. */
  transposed: boolean;
}

export interface OpeningState {
  /** Deepest named position reached so far (it stays named after the game leaves book). */
  opening: OpeningInfo | null;
  /** Whether the current position is itself a named book position. */
  inBook: boolean;
  /** Number of named positions in the book, for diagnostics. */
  bookSize: number;
}

export function splitOpeningName(name: string): { family: string; variation: string | null; subvariation: string | null } {
  const [family, rest] = name.split(/:\s*/, 2);
  if (!rest) return { family, variation: null, subvariation: null };
  const [variation, ...sub] = rest.split(/,\s*/);
  return { family, variation, subvariation: sub.length ? sub.join(', ') : null };
}

export function lookupPosition(key: string): Omit<OpeningInfo, 'ply' | 'transposed'> | null {
  const row = BOOK[key];
  if (!row) return null;
  const [eco, name, , pgn, aliases] = row;
  return { eco, name, ...splitOpeningName(name), pgn, aliases: aliases ?? [] };
}

/** True if the opening name marks a gambit line (offered, accepted or declined). */
export const isGambit = (o: { name: string }) => /\bgambit\b/i.test(o.name);

/**
 * Identify the opening from the actual move history (UCI or SAN moves from `startFen`).
 * Matching is by position, so transpositions into a named position are recognised regardless of move order.
 * Games from a non-standard start position are never "in book".
 */
export function identifyOpening(moves: ReadonlyArray<string | { from: string; to: string; promotion?: string }>, startFen = START_FEN): OpeningState {
  const state: OpeningState = { opening: null, inBook: false, bookSize: Object.keys(BOOK).length };
  if (startFen !== START_FEN) return state;
  const chess = new Chess();
  const sans: string[] = [];
  moves.forEach((m, i) => {
    const mv = typeof m === 'string' ? (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m) ? { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] } : m) : m;
    sans.push(chess.move(mv as never).san);
    const hit = lookupPosition(positionKey(chess));
    state.inBook = !!hit;
    if (hit) {
      const bookSans = hit.pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
      const transposed = bookSans.length !== sans.length || bookSans.some((s, j) => s !== sans[j]);
      state.opening = { ...hit, ply: i + 1, transposed };
    }
  });
  return state;
}
