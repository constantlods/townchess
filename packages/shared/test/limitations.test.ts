import { describe, it, expect } from 'vitest';
import { GameCore, canPossiblyMate, type PieceOnBoard } from '../src/index.js';

/**
 * Pins for the documented, deliberate limitations in docs/KNOWN_LIMITATIONS.md that are NOT bugs (bugs live in
 * regressions.test.ts as `it.fails`). These tests assert today's behaviour, so changing it is a visible, reviewed
 * decision: when a limitation is resolved, update the test and the registry entry in the same change.
 * (The locked-pawn dead positions are pinned in fide-cases.core.test.ts KNOWN_LIMITATIONS; the chess.js
 * ep repetition-hash work-around by the fixture `repetition-illegal-ep-does-not-differ`.)
 */

const P = (spec: string): PieceOnBoard[] =>
  spec.split(' ').map((t) => ({ color: t[0] as 'w' | 'b', type: t[1] as PieceOnBoard['type'], square: t.slice(2) }));

describe('LIM-002 FIDE 9.5.3: an incorrect draw claim with an intended move is simply rejected', () => {
  it('the intended move is not played, the opponent gets no time, and play continues', () => {
    const g = new GameCore({ timeControl: { initialMs: 60_000, incrementMs: 0 }, firstMoveMs: null, drawPolicy: 'claim' });
    g.start(0);
    g.move('w', { from: 'g1', to: 'f3' }, 1000);
    g.move('b', { from: 'g8', to: 'f6' }, 2000);
    const before = g.snapshot(3000);
    // FIDE 9.5.3 would force Nf3-g1 to be played and give Black 2 extra minutes; TownChess only rejects the claim
    expect(g.claimDraw('w', 3000, { from: 'f3', to: 'g1' })).toBe('no draw to claim');
    const after = g.snapshot(3000);
    expect(after.history.length).toBe(before.history.length);
    expect(after.fen).toBe(before.fen);
    expect(after.clocks).toEqual(before.clocks);
    expect(after.status).toBe('active');
  });
});

describe('LIM-003 multi-piece material classes are decided by class, not proven by enumeration', () => {
  // Current decisions (lichess/scalachess classes). Single-piece cases are proven (docs/CHESS.md); these are not.
  const cases: [string, 'w' | 'b', boolean][] = [
    ['wke1 wbc1 bke8 bra8 brh8', 'w', false], // B vs R+R
    ['wke1 wbc1 bke8 bqd8 bra8', 'w', false], // B vs Q+R
    ['wke1 wnb1 bke8 bqd8 bqa8', 'w', false], // N vs Q+Q
    ['wke1 wbc1 wbe3 bke8 bra8', 'w', false], // same-coloured B+B vs R
    ['wke1 wnb1 bke8 bqd8 bra8', 'w', true], // N vs Q+R: the rook can block, mate possible
  ];
  for (const [spec, color, expected] of cases) {
    it(`${spec}: ${color} ${expected ? 'can' : 'cannot'} mate (unproven)`, () => {
      expect(canPossiblyMate(P(spec), color)).toBe(expected);
    });
  }
});

describe('LIM-004 no lag compensation on flag fall', () => {
  it('a move that arrives 1 ms after the flag loses on time, even if it would have been checkmate', () => {
    // Fool's mate set-up: Black's 2...Qh4# arrives 1 ms late
    const g = new GameCore({ timeControl: { initialMs: 10_000, incrementMs: 0 }, firstMoveMs: null });
    g.start(0);
    g.move('w', { from: 'f2', to: 'f3' }, 0);
    g.move('b', { from: 'e7', to: 'e5' }, 0);
    g.move('w', { from: 'g2', to: 'g4' }, 0);
    // Black's clock started at 0 with 10 000 ms left
    const r = g.move('b', { from: 'd8', to: 'h4' }, 10_001);
    expect(r.ok).toBe(false);
    expect(g.status).toBe('timeout');
    expect(g.winner).toBe('w');
  });
});
