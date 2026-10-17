import { describe, it, expect } from 'vitest';
import { ChessRules } from '@hc/shared';
import { AI_LEVELS, search, type SearchOptions } from '../src/index.js';

/**
 * Layer B (engine integration) audit of the house engine. Every engine move is validated through the authoritative
 * rules (@hc/shared ChessRules), never trusted. Reproducible mode only (nodeLimit + seed), as docs/AI.md requires
 * for the agent lab.
 */

const legalUci = (fen: string) => new ChessRules(fen).allLegalMoves().map((m) => m.from + m.to + (m.promotion ?? ''));
const uci = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');
// nodeLimit is checked every 1024 nodes; the engine runs ~1-1.5k nodes/s (chess.js verbose move generation), so
// budgets here stay small.
const repro = (o: SearchOptions, seed: number, nodeLimit = 2048): SearchOptions => ({ ...o, nodeLimit, seed });

const POSITIONS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', // in check
  '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', // promotion must carry a piece
];

// After 1.e4 e5 2.Qh5 Nc6 3.Bc4: Black must stop Qxf7#.
const SCHOLAR_THREAT = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';

describe('house engine: integration with the rules', () => {
  it('returns a legal move (validated by ChessRules) in every audit position, promotions named', () => {
    for (const fen of POSITIONS) {
      for (const seed of [1, 2]) {
        const m = search(fen, { maxDepth: 2, timeMs: 0, noise: 30, nodeLimit: 1024, seed });
        expect(m, fen).not.toBeNull();
        expect(legalUci(fen), fen).toContain(uci(m!));
      }
    }
  }, 60_000);

  it('every level preset returns a legal move', () => {
    for (const lvl of Object.values(AI_LEVELS)) {
      const m = search(POSITIONS[4], repro(lvl, 1, 1024));
      expect(legalUci(POSITIONS[4]), lvl.label).toContain(uci(m!));
    }
  }, 30_000);

  it('returns null when there is no legal move (checkmate, stalemate)', () => {
    expect(search('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', repro(AI_LEVELS.warden, 1))).toBeNull();
    expect(search('k7/P7/1K6/8/8/8/8/8 b - - 0 1', repro(AI_LEVELS.warden, 1))).toBeNull();
  });

  it('reproducible mode: same position + nodeLimit + seed = same move', () => {
    for (const lvl of Object.values(AI_LEVELS)) {
      expect(search(POSITIONS[0], repro(lvl, 42, 1024))).toEqual(search(POSITIONS[0], repro(lvl, 42, 1024)));
    }
  }, 30_000);

  it('Warden finds a mate in one and parries one', () => {
    const m = search('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', repro(AI_LEVELS.warden, 1, 4096));
    expect(uci(m!)).toBe('h5f7');
    const r = new ChessRules(SCHOLAR_THREAT);
    r.tryMove(search(SCHOLAR_THREAT, repro(AI_LEVELS.warden, 1, 4096))! as never);
    expect(r.allLegalMoves().some((x) => x.san.endsWith('#'))).toBe(false);
  }, 30_000);
});

describe('BUG-004 house engine: the noise window picks among fail-low bounds, so noisy levels hang mate in one', () => {
  // search.ts scores root moves with a narrowed window (-negamax(d-1, -Infinity, -alpha + 1)) and quiescence is
  // fail-hard, so every move worse than the current best comes back as (about) alpha - 1, an upper bound, not its
  // value. The noise filter `s.v >= scored[0].v - noise` then keeps nearly EVERY root move, and Novice/Patient pick
  // uniformly among them. Reproduction: SCHOLAR_THREAT, Patient (noise 25), nodeLimit 20000, seeds 1..40 allowed
  // Qxf7# in 26/40 games with 19 different replies; Warden (noise 0) played 3...g6 in 40/40.
  // Expected: a 25 cp noise window never contains a move that allows mate in one.
  it('BUG-004: Patient never allows mate in one (seeds 1..4)', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const m = search(SCHOLAR_THREAT, repro(AI_LEVELS.patient, seed, 2048))!;
      const r = new ChessRules(SCHOLAR_THREAT);
      r.tryMove(m as never);
      expect(r.allLegalMoves().some((x) => x.san.endsWith('#')), `seed ${seed}: ${uci(m)} allows mate`).toBe(false);
    }
  }, 60_000);
});
