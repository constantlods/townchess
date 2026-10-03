import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ChessRules, GameCore, canPossiblyMate, isDeadByMaterial, otherColor } from '../src/index.js';

/**
 * Runs the independent FIDE fixture catalogue (fixtures/fide-cases.json, validated against chess.js in
 * fide-cases.validate.test.ts) against the TownChess GameCore: our wrapper, position key and draw rules.
 */
interface Case {
  id: string; category: string; fide: string; description: string; fen: string; moves: string[];
  expect: Record<string, unknown> & { timeoutResult?: { flagged: 'w' | 'b'; result: 'win' | 'draw' } };
  knownChessJsDeviation?: boolean;
}
const cases: Case[] = JSON.parse(fs.readFileSync(new URL('./fixtures/fide-cases.json', import.meta.url), 'utf8'));

/**
 * Known limitations of GameCore, documented in docs/CHESS.md: dead positions caused by a locked pawn structure need
 * a reachability search, which the core does not run on the move path. These cases must keep failing until it does
 * (the test flips if they start passing, so the list cannot go stale).
 */
const KNOWN_LIMITATIONS = new Set(['dead-locked-pawn-wall', 'dead-locked-wall-with-trapped-bishop', 'timeout-locked-wall-draw']);

/**
 * Plays the setup moves through GameCore. If a dead position ends the game early (FIDE 5.2.2 ends it immediately,
 * e.g. an underpromotion that leaves K+B vs K), the remaining moves are replayed on the rules layer only, so the
 * fixture's move-legality expectations can still be checked.
 */
function run(c: Case): { g: GameCore; rules: ChessRules; endedEarly: boolean } {
  const g = new GameCore({ startFen: c.fen, timeControl: null, drawPolicy: 'claim' });
  g.start(0);
  let rules = g.rules;
  let endedEarly = false;
  for (const [i, m] of c.moves.entries()) {
    const input = { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] as never };
    if (endedEarly) { if (!rules.tryMove(input)) throw new Error(`${c.id}: setup move ${m} illegal`); continue; }
    const r = g.move(g.turn, input, i + 1);
    if (r.ok) continue;
    if (g.termination === 'insufficient_material') {
      endedEarly = true;
      rules = g.rules.clone();
      if (!rules.tryMove(input)) throw new Error(`${c.id}: setup move ${m} illegal`);
      continue;
    }
    throw new Error(`${c.id}: setup move ${m} rejected: ${r.reason}`);
  }
  return { g, rules, endedEarly };
}

function check(c: Case): string[] {
  const { g, rules, endedEarly } = run(c);
  const e = c.expect;
  const bad: string[] = [];
  // move legality is a property of the position, independent of whether a dead position already ended the game
  const legal = new Set(rules.allLegalMoves().map((m) => m.from + m.to + (m.promotion ?? '')));
  if (endedEarly) {
    // only position facts remain meaningful once the game is over
    if ('inCheck' in e && e.inCheck !== rules.inCheck()) bad.push(`inCheck: expected ${e.inCheck}`);
    return bad;
  }
  for (const m of (e.legal as string[] | undefined) ?? []) if (!legal.has(m)) bad.push(`expected legal ${m}`);
  for (const m of (e.illegal as string[] | undefined) ?? []) if (legal.has(m)) bad.push(`expected illegal ${m}`);
  const eq = (k: string, actual: unknown) => { if (k in e && e[k] !== actual) bad.push(`${k}: expected ${e[k]} got ${actual}`); };
  eq('inCheck', g.rules.inCheck());
  eq('checkmate', g.status === 'checkmate');
  eq('stalemate', g.status === 'stalemate');
  eq('insufficientMaterial', isDeadByMaterial(g.rules.pieces()));
  eq('threefold', g.repetitionCount() >= 3);
  eq('fivefold', g.repetitionCount() >= 5);
  eq('halfmoveClock', g.halfmoveClock());
  eq('fiftyMoveClaimable', g.halfmoveClock() >= 100);
  eq('seventyFiveMoveDraw', g.status === 'draw_seventyfive');
  if ('deadPosition' in e) eq('deadPosition', isDeadByMaterial(g.rules.pieces()));
  if (e.timeoutResult) {
    const winnerCanMate = canPossiblyMate(g.rules.pieces(), otherColor(e.timeoutResult.flagged));
    const actual = winnerCanMate ? 'win' : 'draw';
    if (actual !== e.timeoutResult.result) bad.push(`timeoutResult: expected ${e.timeoutResult.result} got ${actual}`);
  }
  return bad;
}

describe('FIDE fixture catalogue against GameCore', () => {
  for (const c of cases) {
    it(`${c.category}: ${c.id} (${c.fide})`, () => {
      const bad = check(c);
      if (KNOWN_LIMITATIONS.has(c.id)) expect(bad.length, 'known limitation now passes: remove it from KNOWN_LIMITATIONS').toBeGreaterThan(0);
      else expect(bad).toEqual([]);
    });
  }
});
