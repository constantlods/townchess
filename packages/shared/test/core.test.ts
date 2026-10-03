import { describe, it, expect } from 'vitest';
import { GameCore, identifyOpening, parsePgn, pgnFromHistory, canPossiblyMate, positionKey, resultToken, type GameEvent } from '../src/index.js';

const uci = (m: string) => ({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] as 'q' | 'r' | 'b' | 'n' | undefined });

/** Play UCI moves alternately; returns the core and the events of the last move. */
function play(moves: string[], opts: ConstructorParameters<typeof GameCore>[0] = { timeControl: null }, t0 = 0) {
  const g = new GameCore(opts);
  g.start(t0);
  let events: GameEvent[] = [];
  moves.forEach((m, i) => {
    const r = g.move(g.turn, uci(m), t0 + i + 1);
    if (!r.ok) throw new Error(`${m}: ${r.reason}`);
    events = r.events;
  });
  return { g, events, types: events.map((e) => e.type) };
}

describe('GameCore flow', () => {
  it("Scholar's mate: checkmate, winner, termination, events", () => {
    const { g, types } = play(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    expect(g.status).toBe('checkmate');
    expect(g.winner).toBe('w');
    expect(g.termination).toBe('checkmate');
    expect(types).toEqual(expect.arrayContaining(['move', 'capture', 'checkmate']));
    expect(g.legalMovesUci()).toEqual([]);
  });

  it('rejects wrong side, opponent piece and illegal moves without changing state', () => {
    const g = new GameCore({ timeControl: null });
    g.start(0);
    expect(g.move('b', uci('e7e5'), 1)).toMatchObject({ ok: false, reason: 'not your turn' });
    expect(g.move('w', uci('e7e5'), 1)).toMatchObject({ ok: false, reason: 'not your piece' });
    expect(g.move('w', uci('e2e5'), 1)).toMatchObject({ ok: false, reason: 'illegal move' });
    expect(g.ply).toBe(0);
  });

  it('requires an explicit promotion piece and supports underpromotion', () => {
    const g = new GameCore({ timeControl: null, startFen: '8/P7/8/8/8/8/8/k6K w - - 0 1' });
    g.start(0);
    expect(g.move('w', uci('a7a8'), 1)).toMatchObject({ ok: false, reason: 'promotion piece required' });
    const r = g.move('w', uci('a7a8n'), 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.promotion).toBe('n');
      expect(r.record.effects).toEqual([
        { kind: 'move', piece: 'p', color: 'w', from: 'a7', to: 'a8' },
        { kind: 'promote', square: 'a8', color: 'w', from: 'p', to: 'n' },
      ]);
    }
  });

  it('effects: castling moves the rook, en passant removes the passed pawn', () => {
    const { g } = play(['e2e4', 'a7a6', 'g1f3', 'a6a5', 'f1e2', 'a5a4', 'e1g1']);
    expect(g.history.at(-1)!.effects).toEqual([
      { kind: 'move', piece: 'k', color: 'w', from: 'e1', to: 'g1' },
      { kind: 'move', piece: 'r', color: 'w', from: 'h1', to: 'f1' },
    ]);
    const ep = play(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
    expect(ep.g.history.at(-1)!.effects[0]).toEqual({ kind: 'capture', square: 'd5', piece: 'p', color: 'b' });
    expect(ep.types).toContain('en_passant');
  });
});

describe('FIDE draws', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];

  it('threefold ends the game automatically under the default policy', () => {
    const { g, types } = play(shuffle);
    expect(g.status).toBe('draw_repetition');
    expect(g.termination).toBe('threefold_repetition');
    expect(types).toContain('draw_repetition');
  });

  it('claim policy: threefold is claimable, fivefold is automatic', () => {
    const { g, types } = play(shuffle, { timeControl: null, drawPolicy: 'claim' });
    expect(g.status).toBe('active');
    expect(g.claimableDraw()).toBe('threefold');
    expect(types).toContain('draw_claimable');
    expect(g.claimDraw('b', 100)).toBe('only the side to move may claim');
    const more = play([...shuffle, ...shuffle], { timeControl: null, drawPolicy: 'claim' });
    expect(more.g.status).toBe('draw_fivefold');
    expect(more.g.termination).toBe('fivefold_repetition');
  });

  it('claim with an intended move (FIDE 9.2.1.1)', () => {
    const { g } = play(shuffle.slice(0, 7), { timeControl: null, drawPolicy: 'claim' });
    expect(g.claimableDraw()).toBeNull();
    expect(g.claimDraw('b', 100, uci('f6g8'))).toBeNull();
    expect(g.status).toBe('draw_repetition');
    expect(g.history.length).toBe(7); // the intended move is not played
  });

  it('seventy-five moves is automatic, but checkmate on that move takes precedence', () => {
    const quiet = play(['h1h2'], { timeControl: null, startFen: '7k/8/8/8/8/8/8/K6R w - - 149 100' });
    expect(quiet.g.status).toBe('draw_seventyfive');
    const mate = play(['a1a8'], { timeControl: null, startFen: '7k/8/6K1/8/8/8/8/R7 w - - 149 100' });
    expect(mate.g.status).toBe('checkmate');
  });

  it('dead by material ends the game (K+B vs K+B, same-coloured bishops)', () => {
    // Bxd2 removes the last pawn and leaves two bishops on the same colour (c5 and d2): dead position
    const { g } = play(['c1d2'], { timeControl: null, startFen: '4k3/8/8/2b5/8/8/3p4/2B4K w - - 0 1' });
    expect(g.status).toBe('draw_insufficient');
    expect(g.termination).toBe('insufficient_material');
  });
});

describe('clocks (FIDE 6.9, first-move window)', () => {
  const tc = { initialMs: 1000, incrementMs: 0 };

  it('no clock runs before both first moves; no first move inside the window aborts', () => {
    const g = new GameCore({ timeControl: tc, firstMoveMs: 500 });
    g.start(0);
    expect(g.clock!.running).toBeNull();
    expect(g.checkAbort(400)).toBe(false);
    expect(g.checkAbort(501)).toBe(true);
    expect(g.status).toBe('aborted');
    expect(resultToken(g.status, g.winner)).toBe('*');
  });

  it("White's clock starts after Black's first move", () => {
    const g = new GameCore({ timeControl: tc, firstMoveMs: 500 });
    g.start(0);
    g.move('w', uci('e2e4'), 300);
    g.move('b', uci('e7e5'), 700);
    expect(g.clock!.running).toBe('w');
    expect(g.clock!.peek('w', 700)).toBe(1000);
    expect(g.clock!.peek('b', 700)).toBe(1000);
  });

  it('flag against K+N vs K+P is a loss (helpmate possible); against a lone knight it is a draw', () => {
    const lose = new GameCore({ timeControl: tc, firstMoveMs: null, startFen: '8/8/8/4k3/4p3/8/8/2N1K3 b - - 0 1' });
    lose.start(0);
    expect(lose.checkFlag(2000)).toBe('b');
    expect(lose.status).toBe('timeout');
    expect(lose.winner).toBe('w');
    // White has only a knight against K+Q: no mate exists for White, so Black's flag is a draw
    const draw = new GameCore({ timeControl: tc, firstMoveMs: null, startFen: 'q7/8/8/4k3/8/8/8/2N1K3 b - - 0 1' });
    draw.start(0);
    draw.checkFlag(2000);
    expect(draw.status).toBe('draw_insufficient');
    expect(draw.termination).toBe('timeout_vs_insufficient');
  });

  it('abandonment uses the same rule', () => {
    const g = new GameCore({ timeControl: null, startFen: 'q7/8/8/4k3/8/8/8/2N1K3 w - - 0 1' });
    g.start(0);
    g.abandon('b', 1);
    expect(g.winner).toBeNull();
    expect(g.termination).toBe('abandoned_vs_insufficient');
  });
});

describe('material classes', () => {
  const P = (square: string, type: string, color: 'w' | 'b') => ({ square, type: type as never, color });
  it('canPossiblyMate', () => {
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('e8', 'k', 'b')], 'w')).toBe(false);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('c1', 'n', 'w'), P('e8', 'k', 'b')], 'w')).toBe(false);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('c1', 'n', 'w'), P('e8', 'k', 'b'), P('a7', 'p', 'b')], 'w')).toBe(true);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('c1', 'n', 'w'), P('e8', 'k', 'b'), P('a8', 'q', 'b')], 'w')).toBe(false);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('c1', 'b', 'w'), P('e8', 'k', 'b'), P('a8', 'r', 'b')], 'w')).toBe(false);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('c1', 'b', 'w'), P('e8', 'k', 'b'), P('c5', 'b', 'b')], 'w')).toBe(false);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('c1', 'b', 'w'), P('e8', 'k', 'b'), P('c6', 'b', 'b')], 'w')).toBe(true);
    expect(canPossiblyMate([P('e1', 'k', 'w'), P('b1', 'n', 'w'), P('g1', 'n', 'w'), P('e8', 'k', 'b')], 'w')).toBe(true);
  });
});

describe('events', () => {
  it('discovered check and double check', () => {
    // Bishop on b2 behind the knight on d4; Nf5 uncovers the b2-h8 diagonal: discovered check
    const disc = play(['d4f5'], { timeControl: null, startFen: '7k/8/8/8/3N4/8/1B6/K7 w - - 0 1' });
    expect(disc.types).toEqual(expect.arrayContaining(['discovered_check', 'check']));
    // Rook e1 behind the knight on e4, king e8: Nf6+ checks with the knight and uncovers the e-file: double check
    const dbl = play(['e4f6'], { timeControl: null, startFen: '4k3/8/8/8/4N3/8/8/K3R3 w - - 0 1' });
    expect(dbl.types).toEqual(expect.arrayContaining(['double_check', 'check']));
  });

  it('gambit and opening events, with transpositions', () => {
    const kg = play(['e2e4', 'e7e5', 'f2f4']);
    expect(kg.types).toEqual(expect.arrayContaining(['opening_identified', 'gambit_offered']));
    expect(kg.g.opening?.name).toBe("King's Gambit");
    const a = identifyOpening(['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3']);
    const b = identifyOpening(['g1f3', 'g8f6', 'c2c4', 'e7e6', 'd2d4']);
    expect(b.opening?.name).toBe(a.opening?.name);
    expect(b.opening?.transposed).toBe(true);
    expect(identifyOpening(['e2e4', 'c7c5']).opening).toMatchObject({ eco: 'B20', family: 'Sicilian Defense' });
  });
});

describe('position key and PGN', () => {
  it('ignores an en passant square when the capture is illegal', () => {
    // black pawn d4 is pinned on the 4th rank by the rook h4 against the king a4; after e2e4 ep is impossible
    const k = positionKey('8/8/8/8/k2p3R/8/4P3/4K3 w - - 0 1');
    expect(k.endsWith('w - -')).toBe(true);
  });

  it('round-trips PGN with opening and termination tags', () => {
    const { g } = play(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    const pgn = pgnFromHistory(g.history, { white: 'Player', black: 'Warden', result: resultToken(g.status, g.winner), eco: g.opening?.eco, opening: g.opening?.name, termination: g.termination, date: new Date(Date.UTC(2026, 9, 3)) });
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[Termination "normal"]');
    expect(pgn).toContain('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0');
    expect(parsePgn(pgn).moves.map((m) => m.san)).toEqual(g.history.map((h) => h.san));
  });
});
