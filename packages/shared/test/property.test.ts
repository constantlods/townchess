import { describe, it, expect } from 'vitest';
import {
  ChessRules, GameCore, START_FEN, identifyOpening, isFinished, lookupPosition, parsePgn, pgnFromHistory, positionKey,
  resultToken, type Color, type DrawPolicy, type GameStatus, type MoveRecord, type PieceType,
} from '../src/index.js';

/**
 * Layer A correctness audit: property-based random games through GameCore.
 *
 * Seeded and reproducible: a failure message names the seed and ply, and `replay(seed)` below reproduces it. No new
 * dependencies; the PRNG is mulberry32. Invariants checked on EVERY ply:
 *  1. FEN round-trip (ChessRules(fen).fen === fen);
 *  2. GameCore.legalMovesUci() equals an independent ChessRules on the same FEN (and is empty once finished);
 *  3. the move's `effects`, applied to the previous board, give exactly the new board;
 *  4. repetitionCount() >= 1, and equals an independent count of positionKey(fenAfter);
 *  5. the halfmove clock resets on pawn moves and captures and otherwise increments;
 *  6. a terminal checkmate/stalemate has no legal moves; an active game has at least one;
 *  7. automatic draw policy: threefold / fifty never survive a move; claim policy: fivefold / 75 never survive;
 *  8. opening lookups never throw;
 *  9. eventSeq strictly increases on every accepted move and never decreases.
 * At the end of each game: PGN export -> parsePgn reproduces the SAN list (and the start FEN), and identifyOpening
 * over the whole history agrees with GameCore's own opening tracking.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Board = Map<string, { type: PieceType; color: Color }>;
const boardOf = (r: ChessRules): Board => new Map(r.pieces().map((p) => [p.square, { type: p.type, color: p.color }]));
const boardStr = (b: Board) => [...b.entries()].sort(([a], [c]) => a.localeCompare(c)).map(([s, p]) => `${s}${p.color}${p.type}`).join(' ');

/** Apply a MoveRecord's effects to a board copy, asserting each effect is consistent with what is on the board. */
function applyEffects(before: Board, rec: MoveRecord): Board {
  const b: Board = new Map(before);
  for (const e of rec.effects) {
    if (e.kind === 'capture') {
      const p = b.get(e.square);
      if (!p || p.type !== e.piece || p.color !== e.color) throw new Error(`capture effect: no ${e.color}${e.piece} on ${e.square}`);
      b.delete(e.square);
    } else if (e.kind === 'move') {
      const p = b.get(e.from);
      if (!p || p.type !== e.piece || p.color !== e.color) throw new Error(`move effect: no ${e.color}${e.piece} on ${e.from}`);
      if (b.has(e.to)) throw new Error(`move effect: ${e.to} still occupied (capture effect missing or misordered)`);
      b.delete(e.from);
      b.set(e.to, p);
    } else {
      const p = b.get(e.square);
      if (!p || p.type !== 'p' || p.color !== e.color) throw new Error(`promote effect: no ${e.color} pawn on ${e.square}`);
      b.set(e.square, { type: e.to, color: e.color });
    }
  }
  return b;
}

const sorted = (xs: string[]) => [...xs].sort();
const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

/** Legal custom starts (valid castling rights) so SetUp/FEN export and non-book games are exercised too. */
const STARTS = [
  START_FEN, START_FEN, START_FEN, START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  '4k3/1P6/8/8/8/8/6p1/4K3 b - - 0 40',
];

interface GameSummary { seed: number; plies: number; status: string; termination: string | null }

export function playRandomGame(seed: number, maxPlies = 300): GameSummary {
  const rng = mulberry32(seed);
  const startFen = STARTS[Math.floor(rng() * STARTS.length)];
  const drawPolicy: DrawPolicy = rng() < 0.5 ? 'automatic' : 'claim';
  const g = new GameCore({ startFen, timeControl: null, drawPolicy });
  g.start(0);
  const where = () => `seed ${seed} ply ${g.ply} (${drawPolicy}, start ${startFen}) fen ${g.fen}`;
  const seen = new Map<string, number>([[positionKey(g.fen), 1]]);
  let lastSeq = g.eventSeq;
  let now = 1;

  while (g.status === 'active' && g.ply < maxPlies) {
    // 2. legal moves agree with an independent ChessRules on the same FEN
    const legal = g.legalMovesUci();
    expect(sorted(legal), where()).toEqual(sorted(new ChessRules(g.fen).allLegalMoves().map(uciOf)));
    expect(legal.length, `active game without legal moves: ${where()}`).toBeGreaterThan(0);

    // occasionally exercise a claim when one is available (claim policy)
    if (drawPolicy === 'claim' && g.claimableDraw() && rng() < 0.25) {
      expect(g.claimDraw(g.turn, now++), where()).toBeNull();
      expect(isFinished(g.status)).toBe(true);
      expect(g.eventSeq).toBeGreaterThan(lastSeq);
      lastSeq = g.eventSeq;
      break;
    }

    const pick = legal[Math.floor(rng() * legal.length)];
    const before = boardOf(g.rules);
    const halfBefore = g.halfmoveClock();
    const res = g.move(g.turn, { from: pick.slice(0, 2), to: pick.slice(2, 4), promotion: (pick[4] as never) || undefined }, now++);
    if (!res.ok) throw new Error(`legal move ${pick} rejected (${res.reason}): ${where()}`);
    const rec = res.record;

    // 9. eventSeq
    expect(g.eventSeq, `eventSeq not increasing: ${where()}`).toBeGreaterThan(lastSeq);
    lastSeq = g.eventSeq;

    // 1. FEN round-trip
    expect(new ChessRules(g.fen).fen, where()).toBe(g.fen);
    expect(rec.fenAfter).toBe(g.fen);

    // 3. effects reproduce the board change
    let applied: Board;
    try { applied = applyEffects(before, rec); } catch (e) { throw new Error(`${(e as Error).message} after ${rec.san}: ${where()}`); }
    expect(boardStr(applied), `effects of ${rec.san}: ${where()}`).toBe(boardStr(boardOf(g.rules)));

    // 4. repetition count
    const key = positionKey(g.fen);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    expect(g.repetitionCount(), where()).toBeGreaterThanOrEqual(1);
    expect(g.repetitionCount(), where()).toBe(seen.get(key));

    // 5. halfmove clock
    const resets = rec.piece === 'p' || !!rec.captured;
    expect(g.halfmoveClock(), `halfmove after ${rec.san}: ${where()}`).toBe(resets ? 0 : halfBefore + 1);

    // 8. opening lookup never throws
    expect(() => lookupPosition(key)).not.toThrow();

    // 6 + 7. terminal states
    // (an active game's non-empty move list is asserted at the top of the next iteration)
    const status = g.status as GameStatus; // re-read: move() may have finished the game
    if (status === 'checkmate' || status === 'stalemate') expect(g.rules.allLegalMoves().length, where()).toBe(0);
    if (status === 'active') {
      if (drawPolicy === 'automatic') {
        expect(g.repetitionCount(), `threefold survived: ${where()}`).toBeLessThan(3);
        expect(g.halfmoveClock(), `fifty survived: ${where()}`).toBeLessThan(100);
      }
      expect(g.repetitionCount(), `fivefold survived: ${where()}`).toBeLessThan(5);
      expect(g.halfmoveClock(), `75 survived: ${where()}`).toBeLessThan(150);
    } else {
      expect(g.legalMovesUci(), where()).toEqual([]);
    }
  }

  // PGN round-trip
  const pgn = pgnFromHistory(g.history, {
    white: 'Random A', black: 'Random B', result: resultToken(g.status, g.winner, g.termination), startFen,
    termination: g.termination, date: new Date(Date.UTC(2026, 9, 3)),
  });
  const parsed = parsePgn(pgn);
  expect(parsed.moves.map((m) => m.san), `PGN round-trip seed ${seed}`).toEqual(g.history.map((h) => h.san));
  expect(new ChessRules(parsed.startFen).fen).toBe(new ChessRules(startFen).fen);

  // whole-history opening identification agrees with the incremental tracking (and never throws)
  const ident = identifyOpening(g.history.map(uciOf), startFen);
  expect(ident.opening?.name ?? null, `opening seed ${seed}`).toBe(g.opening?.name ?? null);
  if (startFen !== START_FEN) expect(ident.opening).toBeNull();

  return { seed, plies: g.ply, status: g.status, termination: g.termination };
}

describe('property: seeded random games through GameCore', () => {
  // ~0.8 s per game: GameCore spends ~1 ms per ply in chess.js verbose move generation, and the invariants re-derive
  // the move list independently. 12 games (~3,000 checked plies) by default; PROPERTY_GAMES=500 for an audit run.
  const GAMES = Number(process.env.PROPERTY_GAMES ?? 12);
  const BATCH = 6;
  const summaries: GameSummary[] = [];
  for (let b = 0; b < GAMES; b += BATCH) {
    it(`games with seeds ${b + 1}..${Math.min(b + BATCH, GAMES)} keep every invariant`, () => {
      for (let s = b + 1; s <= Math.min(b + BATCH, GAMES); s++) summaries.push(playRandomGame(s));
    }, 60_000);
  }

  it('the sample covers several kinds of ending (the generator is not degenerate)', () => {
    const terminations = new Set(summaries.map((s) => s.termination ?? 'unfinished'));
    expect(summaries.length).toBe(GAMES);
    expect(terminations.size).toBeGreaterThanOrEqual(3);
  });

  it('is reproducible: the same seed plays the same game', () => {
    expect(playRandomGame(7, 80)).toEqual(playRandomGame(7, 80));
  });
});
