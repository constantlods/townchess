import { Chess, type Move } from 'chess.js';

/**
 * Small alpha-beta chess engine for the CPU opponent. Runs in a browser Web Worker or a Node worker thread; never on
 * a thread that renders or serves. This is the TownChess house engine for casual play, not an analysis engine
 * (Stockfish arrives in Milestone 5).
 * Negamax + alpha-beta, iterative deepening within a time budget, MVV-LVA ordering,
 * capture-only quiescence, tapered piece-square tables. Strength is tuned by depth/time/noise.
 */

const VAL: Record<string, number> = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };

// Piece-square tables from white's point of view, a8..h1 order (rank 8 first).
const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ke: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

function evaluate(c: Chess): number {
  const board = c.board();
  let score = 0, material = 0;
  for (const row of board) for (const p of row) if (p && p.type !== 'k' && p.type !== 'p') material += VAL[p.type];
  const endgame = material < 2600;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (!p) continue;
    const idx = p.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
    const table = p.type === 'k' && endgame ? PST.ke : PST[p.type];
    const v = VAL[p.type] + table[idx];
    score += p.color === 'w' ? v : -v;
  }
  return c.turn() === 'w' ? score : -score;
}

function order(moves: Move[]): Move[] {
  return moves.sort((a, b) => score(b) - score(a));
  function score(m: Move) {
    let s = 0;
    if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece];
    if (m.promotion) s += VAL[m.promotion];
    if (m.san.includes('+')) s += 50;
    return s;
  }
}

class Timeout extends Error {}

export interface SearchOptions {
  maxDepth: number;
  /** Wall-clock budget. Strength then depends on machine load; set `nodeLimit` for reproducible strength. */
  timeMs: number;
  /** Centipawn window for picking a near-best move (human-like imperfection). */
  noise: number;
  /** Optional hard node budget: makes the search deterministic regardless of machine speed. */
  nodeLimit?: number;
  /** Optional RNG seed for the noise choice: same seed + same position + nodeLimit = same move. */
  seed?: number;
}

/** mulberry32: tiny seeded PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function search(fen: string, opt: SearchOptions): { from: string; to: string; promotion?: string } | null {
  const c = new Chess(fen);
  const deadline = opt.nodeLimit ? Infinity : performance.now() + opt.timeMs;
  const random = opt.seed === undefined ? Math.random : seededRandom(opt.seed);
  let nodes = 0;
  const MATE = 100000;

  const quiesce = (alpha: number, beta: number, depth: number): number => {
    if ((++nodes & 1023) === 0 && (performance.now() > deadline || (opt.nodeLimit !== undefined && nodes > opt.nodeLimit))) throw new Timeout();
    const stand = evaluate(c);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha;
    for (const m of order(c.moves({ verbose: true }).filter((x) => x.captured))) {
      c.move(m);
      const v = -quiesce(-beta, -alpha, depth - 1);
      c.undo();
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };

  const negamax = (depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && (performance.now() > deadline || (opt.nodeLimit !== undefined && nodes > opt.nodeLimit))) throw new Timeout();
    if (c.isCheckmate()) return -MATE + ply;
    if (c.isDraw()) return 0;
    if (depth === 0) return quiesce(alpha, beta, 4);
    let best = -Infinity;
    for (const m of order(c.moves({ verbose: true }))) {
      c.move(m);
      const v = -negamax(depth - 1, -beta, -alpha, ply + 1);
      c.undo();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };

  const root = order(c.moves({ verbose: true }));
  if (!root.length) return null;
  let bestMove = root[0];
  let scored: { m: Move; v: number }[] = root.map((m) => ({ m, v: 0 }));
  for (let d = 1; d <= opt.maxDepth; d++) {
    try {
      const results: { m: Move; v: number }[] = [];
      let alpha = -Infinity;
      for (const { m } of scored) {
        c.move(m);
        // With noise, every candidate needs an exact score (a narrowed window makes all non-best moves look alike, so
        // the noise window would admit blunders such as allowing mate in one: regression BUG-004).
        const v = opt.noise > 0 ? -negamax(d - 1, -Infinity, Infinity, 1) : -negamax(d - 1, -Infinity, -alpha + 1, 1);
        c.undo();
        results.push({ m, v });
        if (v > alpha) alpha = v;
      }
      results.sort((a, b) => b.v - a.v);
      scored = results;
      bestMove = results[0].m;
      if (results[0].v > MATE / 2) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      while (c.history().length > new Chess(fen).history().length) c.undo();
      break;
    }
  }
  // Human-like imperfection: occasionally pick a near-best alternative.
  if (opt.noise > 0 && scored.length > 1) {
    const near = scored.filter((s) => s.v >= scored[0].v - opt.noise);
    bestMove = near[Math.floor(random() * near.length)].m;
  }
  return { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion };
}
