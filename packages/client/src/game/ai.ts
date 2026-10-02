import { Chess, type Move } from 'chess.js';

/**
 * Small alpha-beta chess engine for "Play vs AI". Runs in a Web Worker.
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

export interface SearchOptions { maxDepth: number; timeMs: number; noise: number }

export function search(fen: string, opt: SearchOptions): { from: string; to: string; promotion?: string } | null {
  const c = new Chess(fen);
  const deadline = performance.now() + opt.timeMs;
  let nodes = 0;
  const MATE = 100000;

  const quiesce = (alpha: number, beta: number, depth: number): number => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
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
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
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
        const v = -negamax(d - 1, -Infinity, -alpha + 1, 1);
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
    bestMove = near[Math.floor(Math.random() * near.length)].m;
  }
  return { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion };
}
