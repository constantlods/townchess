import { describe, it, expect } from 'vitest';
import { ChessRules, GameCore } from '../src/index.js';

/**
 * Pinned rules bugs found by the Layer A audit (docs/ENGINE_AGENT.md, docs/KNOWN_LIMITATIONS.md).
 *
 * Each bug is an `it.fails` test: it asserts the CORRECT behaviour, so it fails today and the suite stays green.
 * When the lead fixes the bug in packages/shared/src, vitest reports the `it.fails` test as unexpectedly passing:
 * flip it to a plain `it` (do not delete it) and mark the entry in KNOWN_LIMITATIONS.md as resolved.
 */

describe('BUG-001 castling rights from a start FEN are not checked against the rooks (FIDE 3.8.2)', () => {
  // chess.js 1.4.0 trusts the FEN castling field: with "K" and no rook on h1 it still generates O-O, and with a bishop
  // on h1 it "castles" and carries the bishop to f1. GameCore accepts any startFen (LocalSession offline play, tests,
  // and later puzzles / PGN import with [SetUp "1"]), so the illegal castle reaches legalMoves and is playable.
  // Either fix is acceptable: reject the FEN (constructor throws) or strip the impossible rights.

  /** Returns the legal UCI moves, or null when the FEN is rejected (an acceptable fix). */
  const legalFrom = (fen: string): string[] | null => {
    let g: GameCore;
    try { g = new GameCore({ startFen: fen, timeControl: null }); } catch { return null; }
    g.start(0);
    return g.legalMovesUci();
  };

  it('BUG-001a: king without a rook on h1 must not castle (4k3/p7/8/8/8/8/8/4K3 w K - 0 1)', () => {
    // rules layer directly (no GameCore needed to show the move generation)
    let r: ChessRules | null = null;
    try { r = new ChessRules('4k3/p7/8/8/8/8/8/4K3 w K - 0 1'); } catch { /* rejecting the FEN is a fix */ }
    if (!r) return;
    expect(r.allLegalMoves().map((m) => m.from + m.to)).not.toContain('e1g1');
  });

  it('BUG-001b: a bishop on h1 is not a castling rook (4k3/p7/8/8/8/8/8/4K2B w K - 0 1)', () => {
    const legal = legalFrom('4k3/p7/8/8/8/8/8/4K2B w K - 0 1');
    if (legal === null) return;
    expect(legal).not.toContain('e1g1');
  });

  it('BUG-001c: the side not to move gets the bogus right too (black O-O-O with no rook on a8)', () => {
    const g = new GameCore({ startFen: '4k3/p7/8/8/8/8/P7/R3K2R w KQkq - 0 1', timeControl: null });
    g.start(0);
    expect(g.move('w', { from: 'a2', to: 'a3' }, 1).ok).toBe(true);
    expect(g.legalMovesUci()).not.toContain('e8c8');
  });

  it('BUG-001d: impossible rights make the start position count as different for repetition (FIDE 9.2.3)', () => {
    // Start: no rooks, FEN claims KQkq. After Kd1 Kd8 Ke1 Ke8 twice the start position has occurred three times
    // (castling was never possible, so the "possible moves" are identical), but the start key carries "KQkq" and
    // the later keys "-", so the automatic threefold is missed.
    const g = new GameCore({ startFen: '4k3/p7/8/8/8/8/P7/4K3 w KQkq - 0 1', timeControl: null, drawPolicy: 'automatic' });
    g.start(0);
    for (const m of ['e1d1', 'e8d8', 'd1e1', 'd8e8', 'e1d1', 'e8d8', 'd1e1', 'd8e8']) {
      if (g.status !== 'active') break;
      g.move(g.turn, { from: m.slice(0, 2), to: m.slice(2, 4) }, 1);
    }
    expect(g.status).toBe('draw_repetition');
  });

  it('control: legitimate rights from a FEN still castle (guards the fix against over-stripping)', () => {
    const g = new GameCore({ startFen: '4k3/p7/8/8/8/8/P7/R3K2R w KQ - 0 1', timeControl: null });
    g.start(0);
    expect(g.legalMovesUci()).toEqual(expect.arrayContaining(['e1g1', 'e1c1']));
  });
});

describe('BUG-002 a promotion piece on a non-promotion move is silently accepted', () => {
  // GameCore.move('w', { from: 'e2', to: 'e4', promotion: 'q' }) succeeds and plays e2-e4, although "e2e4q" is not
  // in legalMovesUci(). chess.js 1.4 ignores `promotion` when the matched move is not a promotion. The protocol's
  // zod schema allows `promotion` on any MOVE, so a client can send it. Harmless to the board (the record has no
  // promotion) but the authority accepts input that is not one of the legal moves it advertises.

  it('BUG-002a: GameCore rejects e2e4 with promotion q', () => {
    const g = new GameCore({ timeControl: null });
    g.start(0);
    expect(g.legalMovesUci()).not.toContain('e2e4q');
    expect(g.move('w', { from: 'e2', to: 'e4', promotion: 'q' }, 1).ok).toBe(false);
  });

  it('BUG-002b: ChessRules.tryMove rejects a knight move with a promotion piece', () => {
    expect(new ChessRules().tryMove({ from: 'g1', to: 'f3', promotion: 'n' })).toBeNull();
  });

  it('control: a real promotion still requires and accepts a named piece', () => {
    const r = new ChessRules('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    expect(r.tryMove({ from: 'b7', to: 'b8' })).toBeNull();
    expect(r.tryMove({ from: 'b7', to: 'b8', promotion: 'n' })?.san).toBe('b8=N');
  });
});

describe('BUG-003 a start FEN that is already drawn by the 75-move rule is not ended at start (FIDE 9.6.2)', () => {
  // GameCore.start() already ends a custom start position that is checkmate, stalemate or dead by material, but it
  // does not apply the halfmove-clock rules. With a halfmove clock of 150 the game stays active, and the draw only
  // happens if the first move is quiet; a pawn move or capture resets the clock and the 75-move draw is lost.
  const FEN = '4k3/p7/8/8/8/8/P7/R3K3 w - - 150 200';

  it('BUG-003a: start() ends a position whose halfmove clock is already 150', () => {
    const g = new GameCore({ startFen: FEN, timeControl: null });
    g.start(0);
    expect(g.status).toBe('draw_seventyfive');
  });

  it('after the BUG-003 fix: no move is accepted, a pawn move can no longer escape the 75-move draw', () => {
    const g = new GameCore({ startFen: FEN, timeControl: null });
    g.start(0);
    expect([g.status, g.termination]).toEqual(['draw_seventyfive', 'seventy_five_move']);
    expect(g.move('w', { from: 'a2', to: 'a3' }, 1)).toMatchObject({ ok: false, reason: 'game is not active' });
  });
});
