import { describe, it, expect } from 'vitest';
import { ChessRules } from '../src/index.js';

/**
 * Layer A correctness audit: perft (performance test, move path enumeration) through OUR wrapper.
 *
 * Every interior node is expanded with ChessRules.allLegalMoves() and each move is played with ChessRules.tryMove()
 * and taken back with ChessRules.undo(), exactly the calls GameCore uses. A wrong node count means move generation,
 * the promotion-must-be-named guard in tryMove, or undo disagrees with the published reference values.
 *
 * Reference counts: Chess Programming Wiki, "Perft Results" (positions 1-6), which agree with Stockfish `go perft`.
 * At the last ply the moves are bulk-counted (allLegalMoves().length), the standard perft optimisation; the
 * `full make` variants below also play every leaf move through tryMove so that path is checked too.
 */
function perft(r: ChessRules, depth: number, bulk = true): number {
  if (depth === 0) return 1;
  const moves = r.allLegalMoves();
  if (depth === 1 && bulk) return moves.length;
  let n = 0;
  for (const m of moves) {
    const rec = r.tryMove({ from: m.from, to: m.to, promotion: m.promotion as never });
    if (!rec) throw new Error(`tryMove rejected generated legal move ${m.from}${m.to}${m.promotion ?? ''} in ${r.fen}`);
    n += perft(r, depth - 1, bulk);
    r.undo();
  }
  return n;
}

/** Divide: per-root-move counts, for debugging a mismatch against `stockfish go perft N`. */
export function divide(fen: string, depth: number): Record<string, number> {
  const r = new ChessRules(fen);
  const out: Record<string, number> = {};
  for (const m of r.allLegalMoves()) {
    r.tryMove({ from: m.from, to: m.to, promotion: m.promotion as never });
    out[m.from + m.to + (m.promotion ?? '')] = depth <= 1 ? 1 : perft(r, depth - 1);
    r.undo();
  }
  return out;
}

interface PerftCase { name: string; fen: string; counts: number[]; depth: number; deepDepth?: number }

/** PERFT_DEEP=1 runs the slower `deepDepth` levels as well (about a minute; for audits, not every CI run). */
const DEEP = !!process.env.PERFT_DEEP;

// counts[i] = perft(i + 1). `depth` is the deepest level run by default; the whole file takes ~20 s of CPU, mostly in
// chess.js verbose move generation (each verbose Move carries before/after FENs, ~0.7 ms per expanded node).
const CASES: PerftCase[] = [
  { name: 'initial position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', counts: [20, 400, 8902, 197281], depth: 4 },
  { name: 'position 2 "Kiwipete"', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862], depth: 3 },
  { name: 'position 3 (rook endgame, ep and discovered checks)', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238, 674624], depth: 4, deepDepth: 5 },
  { name: 'position 4 (promotions, castling into check)', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467], depth: 3 },
  { name: 'position 4 mirrored (colour symmetry)', fen: 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', counts: [6, 264, 9467], depth: 3 },
  { name: 'position 5 (underpromotion with check)', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379], depth: 3 },
  { name: 'position 6 (symmetrical middlegame)', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890], depth: 2, deepDepth: 3 },
];

describe('perft through ChessRules (allLegalMoves + tryMove/undo)', () => {
  for (const c of CASES) {
    const max = DEEP && c.deepDepth ? c.deepDepth : c.depth;
    it(`${c.name}: depth 1..${max}`, () => {
      const r = new ChessRules(c.fen);
      for (let d = 1; d <= max; d++) {
        const t0 = performance.now();
        const n = perft(r, d);
        const ms = performance.now() - t0;
        if (d === max && process.env.PERFT_VERBOSE) console.log(`perft ${c.name} d${d} = ${n} (${ms.toFixed(0)} ms)`);
        expect(n, `perft(${d})`).toBe(c.counts[d - 1]);
      }
      // undo restored the root exactly
      expect(r.fen).toBe(new ChessRules(c.fen).fen);
    }, 180_000);
  }

  it('full make: every leaf move is also played through tryMove (initial d3, Kiwipete d2, position 4/5 d2)', () => {
    expect(perft(new ChessRules(CASES[0].fen), 3, false)).toBe(8902);
    expect(perft(new ChessRules(CASES[1].fen), 2, false)).toBe(2039);
    expect(perft(new ChessRules(CASES[3].fen), 2, false)).toBe(264);
    expect(perft(new ChessRules(CASES[5].fen), 2, false)).toBe(1486);
  }, 60_000);

  it('divide sums to perft (Kiwipete d2) and contains both castles', () => {
    const d = divide(CASES[1].fen, 2);
    expect(Object.keys(d)).toHaveLength(48);
    expect(Object.values(d).reduce((a, b) => a + b, 0)).toBe(2039);
    expect(d).toHaveProperty('e1g1');
    expect(d).toHaveProperty('e1c1');
  });

  it('every generated promotion is offered for all four pieces, and tryMove refuses an unnamed one', () => {
    const r = new ChessRules(CASES[3].fen); // White is in check; only 6 replies, none a promotion
    const r5 = new ChessRules(CASES[5].fen); // d7xc8=Q/R/B/N
    const promos = r5.allLegalMoves().filter((m) => m.promotion);
    const byTarget = new Map<string, Set<string>>();
    for (const m of promos) byTarget.set(m.from + m.to, (byTarget.get(m.from + m.to) ?? new Set()).add(m.promotion!));
    expect(byTarget.size).toBeGreaterThan(0);
    for (const [ft, set] of byTarget) {
      expect([...set].sort(), ft).toEqual(['b', 'n', 'q', 'r']);
      expect(r5.tryMove({ from: ft.slice(0, 2), to: ft.slice(2, 4) }), `${ft} without a piece`).toBeNull();
    }
    expect(r.allLegalMoves().length).toBe(6);
  });
});
