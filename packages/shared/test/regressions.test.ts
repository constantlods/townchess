import { describe, it, expect } from 'vitest';
import { ChessRules, GameCore, sanitizeCastling } from '../src/index.js';

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

describe('BUG-006 a restored history carries fabricated clockAfterMs values', () => {
  // GameCore.restore replays the journal on a synthetic timeline (now = 0, 1, 2 ... ms per ply), so every replayed
  // MoveRecord gets clockAfterMs = initial + increments - ~1 ms instead of the time the player really had. The journal
  // (RoomRecord) does not store per-move clocks, so the values are invented and are sent to clients in moveHistory.
  // A restored game that ENDS on the replayed list also reports the synthetic clocks, not the saved ones.
  // Either fix is acceptable: store and restore the per-move clocks, or leave clockAfterMs undefined after a restore.
  const tc = { initialMs: 60_000, incrementMs: 1_000 };
  const play = () => {
    const g = new GameCore({ timeControl: tc, firstMoveMs: null });
    g.start(0);
    const moves: [string, string, number][] = [['e2', 'e4', 5_000], ['e7', 'e5', 12_000], ['g1', 'f3', 20_000], ['b8', 'c6', 41_000]];
    for (const [from, to, t] of moves) expect(g.move(g.turn, { from, to }, t).ok).toBe(true);
    return g;
  };

  it('control: the live game records the real clocks (60 000 - 5 000 + 1 000 = 56 000 after 1.e4)', () => {
    expect(play().history.map((h) => h.clockAfterMs)).toEqual([56_000, 54_000, 49_000, 34_000]);
  });

  it('BUG-006a: after restore every clockAfterMs is the original value or undefined, never invented', () => {
    const g = play();
    const clocks = { w: g.clock!.peek('w', 41_000), b: g.clock!.peek('b', 41_000) };
    const r = GameCore.restore({ timeControl: tc, firstMoveMs: null, moves: g.movesUci(), clocks }, 100_000);
    r.history.forEach((h, i) => expect([undefined, g.history[i].clockAfterMs], `ply ${i + 1}`).toContain(h.clockAfterMs));
  });
});

describe('restore applies the start-position checks (control; restore calls start() since e819a2a)', () => {
  it('a stalemate start FEN restored with no moves is a stalemate, not an active game', () => {
    const r = GameCore.restore({ startFen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', timeControl: null, moves: [], clocks: null }, 0);
    expect(r.status).toBe('stalemate');
  });
  it('a start FEN past 75 moves restored with no moves is drawn (BUG-003 on the restore path)', () => {
    const r = GameCore.restore({ startFen: '4k3/p7/8/8/8/8/P7/R3K3 w - - 150 200', timeControl: null, moves: [], clocks: null }, 0);
    expect([r.status, r.termination]).toEqual(['draw_seventyfive', 'seventy_five_move']);
  });
});

describe('sanitizeCastling FEN edge cases (behaviour pinned; see LIM-008)', () => {
  const B = 'r3k2r/8/8/8/8/8/8/R3K2R';
  const field = (c: string) => new ChessRules(`${B} w ${c} - 0 1`).fen.split(' ')[2];

  it('any order of valid letters is accepted and normalised (Kq, qK, kqKQ, KK)', () => {
    expect([field('Kq'), field('qK'), field('kqKQ'), field('KK')]).toEqual(['Kq', 'Kq', 'KQkq', 'K']);
  });
  it('invalid characters are dropped, not rejected (KQx -> KQ, KQkq3 -> KQkq)', () => {
    expect(sanitizeCastling(`${B} w KQx - 0 1`).split(' ')[2]).toBe('KQ');
    expect([field('KQx'), field('KQkq3')]).toEqual(['KQ', 'KQkq']);
  });
  it('LIM-008: X-FEN / Shredder letters (HAha, AHah, Hh) are ignored, so every castling right is silently lost', () => {
    expect([field('HAha'), field('AHah'), field('Hh')]).toEqual(['-', '-', '-']);
  });
  it('rights without the matching rook are stripped', () => {
    expect(new ChessRules('4k3/8/8/8/8/8/8/4K3 w K - 0 1').fen.split(' ')[2]).toBe('-');
  });
  it('en passant: a square nobody can capture on becomes "-"; a capturable one is kept and playable', () => {
    expect(new ChessRules('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1').fen.split(' ')[3]).toBe('-');
    const r = new ChessRules('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b Kkq e3 0 1');
    expect(r.fen).toBe('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b Kkq e3 0 1');
    expect(r.allLegalMoves().some((m) => m.from === 'd4' && m.to === 'e3')).toBe(true);
  });
  it('en passant on the wrong rank for the side to move is rejected (constructor throws)', () => {
    expect(() => new ChessRules('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1')).toThrow(/en-passant/);
  });
  it('extra whitespace and missing clock fields are tolerated', () => {
    expect(new ChessRules('  4k3/8/8/8/8/8/8/4K2R   w   K  -  0  1 ').fen).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
    expect(new ChessRules('4k3/8/8/8/8/8/8/4K2R w K').fen).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  });
});
