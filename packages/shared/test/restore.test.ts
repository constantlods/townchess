import { describe, it, expect } from 'vitest';
import {
  ChessRules, GameCore, START_FEN, isFinished, parsePgn, pgnFromHistory, positionKey, resultToken,
  type Color, type DrawPolicy, type MoveRecord, type TimeControl,
} from '../src/index.js';

/**
 * Layer A audit of GameCore.restore (the journal replay used by the server after a restart, and by any crash
 * recovery). Seeded random games; at a random checkpoint the game is rebuilt from `movesUci()` and the rebuilt game is
 * then driven in lockstep with the original. Checked on every ply after the checkpoint:
 *  - same FEN, turn, status, winner, termination, ply, halfmove clock, claimable draw, legal moves, opening/inBook;
 *  - same history (SAN, flags, fenAfter, effects, promotion) except `clockAfterMs` (BUG-006);
 *  - the same repetition table (so threefold / fivefold after restore are decided identically);
 *  - same clocks at the same `now` (timed games), eventSeq equal at restore and strictly increasing afterwards.
 * At the end of every game the full move list is restored again (a game that ENDS on the restored list), the PGN of
 * the restored game must equal the original's and round-trip through parsePgn + restore.
 * Claim paths: on claim-policy games a random intended move is claimed every ply and the verdict is compared with an
 * independent prediction (positionKey count + halfmove clock of a probe). Successful claims run on a restored clone.
 *
 * PROPERTY_GAMES (shared with property.test.ts) scales the sample; default 12.
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

const STARTS = [
  START_FEN, START_FEN, START_FEN, START_FEN, START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '4k3/1P6/8/8/8/8/6p1/4K3 b - - 0 40', // promotions on both sides, underpromotion picks
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  '8/8/4k3/8/8/4K3/4R3/8 w - - 96 80', // fifty-move rule a few plies away
];
const TC: TimeControl = { initialMs: 300_000, incrementMs: 3_000 };

type Internals = { repetitions: Map<string, number> };
const reps = (g: GameCore) => [...(g as unknown as Internals).repetitions.entries()].sort(([a], [b]) => a.localeCompare(b));
const noClock = (h: readonly MoveRecord[]) => h.map(({ clockAfterMs: _c, ...r }) => r);
const sorted = (xs: string[]) => [...xs].sort();
const toInput = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: (u[4] as 'q' | 'r' | 'b' | 'n' | undefined) || undefined });

export function restoreOf(g: GameCore, now: number, timed = !!g.clock): GameCore {
  return GameCore.restore({
    startFen: g.startFen, timeControl: timed ? g.clock!.tc : null, drawPolicy: g.drawPolicy, moves: g.movesUci(), firstMoveMs: g.firstMoveMs,
    clocks: timed ? { w: g.clock!.peek('w', now), b: g.clock!.peek('b', now) } : null,
  }, now);
}

export function expectSameState(a: GameCore, b: GameCore, now: number, where: string) {
  expect(b.fen, where).toBe(a.fen);
  expect([b.turn, b.status, b.winner, b.termination, b.ply], where).toEqual([a.turn, a.status, a.winner, a.termination, a.ply]);
  expect(b.history.map((h) => h.san), where).toEqual(a.history.map((h) => h.san));
  expect(noClock(b.history), where).toEqual(noClock(a.history));
  expect(b.repetitionCount(), where).toBe(a.repetitionCount());
  expect(reps(b), where).toEqual(reps(a));
  expect(b.halfmoveClock(), where).toBe(a.halfmoveClock());
  expect(b.claimableDraw(), where).toBe(a.claimableDraw());
  expect(sorted(b.legalMovesUci()), where).toEqual(sorted(a.legalMovesUci()));
  expect(b.opening, where).toEqual(a.opening);
  expect(b.inBook, where).toBe(a.inBook);
  const clocks = (g: GameCore) => g.clock && [g.clock.peek('w', now), g.clock.peek('b', now), g.clock.running];
  expect(clocks(b), where).toEqual(clocks(a));
}

/** Independent verdict for claimDraw(turn, now, intended): FIDE 9.2.1.1 / 9.3.1. */
function predictClaim(g: GameCore, seen: Map<string, number>, uci: string): 'threefold' | 'fifty' | null {
  const probe = new ChessRules(g.fen);
  if (!probe.tryMove(toInput(uci))) throw new Error('probe rejected a legal move');
  if ((seen.get(positionKey(probe.fen)) ?? 0) + 1 >= 3) return 'threefold';
  if (Number(probe.fen.split(' ')[4]) >= 100) return 'fifty';
  return null;
}

interface Summary { seed: number; plies: number; status: string; claims: number; claimFailures: number; restoredEnd: boolean; promotions: number }

export function playRestoreGame(seed: number, maxPlies = 160): Summary {
  const rng = mulberry32(seed * 7919 + 13);
  const startFen = STARTS[Math.floor(rng() * STARTS.length)];
  const drawPolicy: DrawPolicy = rng() < 0.5 ? 'automatic' : 'claim';
  const timed = rng() < 0.35;
  const repeatBias = rng() < 0.6 ? 0.55 : 0; // shuffle pieces back and forth so repetitions really happen
  const g = new GameCore({ startFen, timeControl: timed ? TC : null, drawPolicy, firstMoveMs: null });
  let now = 1000;
  g.start(now);
  const checkpoint = Math.floor(rng() * Math.min(60, maxPlies));
  const where = () => `restore seed ${seed} ply ${g.ply} (${drawPolicy}${timed ? ', timed' : ''}, start ${startFen}) fen ${g.fen}`;
  const seen = new Map<string, number>([[positionKey(g.fen), 1]]);
  let r: GameCore | null = null;
  let claims = 0, claimFailures = 0, promotions = 0;

  while (true) {
    if (g.ply === checkpoint && !r) {
      r = restoreOf(g, now);
      expectSameState(g, r, now, `at restore: ${where()}`);
      expect(r.eventSeq, `eventSeq at restore: ${where()}`).toBe(g.eventSeq);
    }
    if (g.status !== 'active' || g.ply >= maxPlies) break;
    const legal = g.legalMovesUci();

    // claim with an intended move (claim policy): verdict must match the independent prediction
    if (drawPolicy === 'claim') {
      const intended = legal[Math.floor(rng() * legal.length)];
      const expected = predictClaim(g, seen, intended);
      if (expected === null) {
        const fen = g.fen, seq = g.eventSeq;
        expect(g.claimDraw(g.turn, now, toInput(intended)), `claim ${intended}: ${where()}`).toBe('no draw to claim');
        expect([g.fen, g.eventSeq, g.status], `failed claim changed state: ${where()}`).toEqual([fen, seq, 'active']);
        claimFailures++;
      } else if (rng() < 0.3) { // a successful claim needs a restored clone (O(plies)): sample it
        const c = restoreOf(g, now);
        const seq = c.eventSeq, turn = c.turn;
        expect(c.claimDraw(turn, now, toInput(intended)), `claim ${intended}: ${where()}`).toBeNull();
        expect([c.status, c.winner, c.termination], where()).toEqual(
          expected === 'threefold' ? ['draw_repetition', null, 'threefold_repetition'] : ['draw_fifty', null, 'fifty_move']);
        expect(c.ply, 'the intended move is not played').toBe(g.ply);
        expect(c.eventSeq, where()).toBeGreaterThan(seq);
        expect(c.lastEvents.at(-1), where()).toMatchObject({ color: turn });
        claims++;
      }
      // a claim without a move on a clone, whenever the current position qualifies
      if (g.claimableDraw() && rng() < 0.1) {
        const c = restoreOf(g, now);
        expect(c.claimDraw(c.turn, now), where()).toBeNull();
        expect(isFinished(c.status), where()).toBe(true);
        claims++;
      }
    }

    let pick = legal[Math.floor(rng() * legal.length)];
    if (repeatBias && g.ply >= 2 && rng() < repeatBias) {
      const back = g.history[g.ply - 2];
      const rev = back.to + back.from;
      if (!back.promotion && legal.includes(rev)) pick = rev;
    }
    now += 100 + Math.floor(rng() * 4000);
    const res = g.move(g.turn, toInput(pick), now);
    if (!res.ok) throw new Error(`legal move ${pick} rejected (${res.reason}): ${where()}`);
    if (res.record.promotion) promotions++;
    const key = positionKey(g.fen);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (r) {
      const seqBefore = r.eventSeq;
      const rr = r.move(r.turn, toInput(pick), now);
      expect(rr.ok, `restored game rejected ${pick}: ${where()}`).toBe(true);
      expect(r.eventSeq, `eventSeq after restore: ${where()}`).toBeGreaterThan(seqBefore);
      expect(r.lastEvents, where()).toEqual(g.lastEvents);
      expectSameState(g, r, now, `lockstep: ${where()}`);
    }
  }

  // the whole move list, including a final move that ended the game, restores to the same state
  const end = restoreOf(g, now, false);
  // (successful claims only ever run on clones, so `g` ended by a move or is still active)
  expect([end.status, end.winner, end.termination], `end: ${where()}`).toEqual([g.status, g.winner, g.termination]);
  if (isFinished(end.status)) expect(end.legalMovesUci()).toEqual([]);
  expect(end.fen).toBe(g.fen);
  expect(noClock(end.history)).toEqual(noClock(g.history));
  expect(reps(end)).toEqual(reps(g));

  // PGN of the restored game equals the original's and round-trips back through restore
  const meta = { white: 'A', black: 'B', result: resultToken(g.status, g.winner, g.termination), startFen, termination: g.termination, date: new Date(Date.UTC(2026, 9, 3)) };
  const pgn = pgnFromHistory(g.history, meta);
  expect(pgnFromHistory(end.history, meta), `pgn: ${where()}`).toBe(pgn);
  const parsed = parsePgn(pgn);
  const back = GameCore.restore({
    startFen: parsed.startFen, timeControl: null, drawPolicy, clocks: null,
    moves: parsed.moves.map((m) => m.from + m.to + (m.promotion ?? '')),
  }, now);
  expect(back.fen, `pgn replay: ${where()}`).toBe(g.fen);
  expect(back.history.map((h) => h.san)).toEqual(g.history.map((h) => h.san));

  return { seed, plies: g.ply, status: g.status, claims, claimFailures, restoredEnd: isFinished(end.status), promotions };
}

describe('restore: random games rebuilt from their journal behave identically', () => {
  const GAMES = Number(process.env.PROPERTY_GAMES ?? 12);
  const BATCH = 6;
  const summaries: Summary[] = [];
  for (let b = 0; b < GAMES; b += BATCH) {
    it(`restore seeds ${b + 1}..${Math.min(b + BATCH, GAMES)} reproduce state, repetitions, claims and PGN`, () => {
      for (let s = b + 1; s <= Math.min(b + BATCH, GAMES); s++) summaries.push(playRestoreGame(s));
    }, 120_000);
  }

  it('the sample exercises successful claims, failed claims, promotions and games ending on the restored list', () => {
    expect(summaries.length).toBe(GAMES);
    expect(summaries.reduce((n, s) => n + s.claims, 0)).toBeGreaterThan(0);
    expect(summaries.reduce((n, s) => n + s.claimFailures, 0)).toBeGreaterThan(0);
    expect(summaries.reduce((n, s) => n + s.promotions, 0)).toBeGreaterThan(0);
    expect(summaries.some((s) => s.restoredEnd)).toBe(true);
  });

  it('is reproducible', () => {
    expect(playRestoreGame(3, 40)).toEqual(playRestoreGame(3, 40));
  });
});

describe('restore: hand-picked endings and repetition counts', () => {
  const restore = (moves: string[], drawPolicy: DrawPolicy = 'automatic', startFen?: string) =>
    GameCore.restore({ startFen, timeControl: null, drawPolicy, moves, clocks: null }, 0);
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];

  it("a restored list that ends in checkmate (fool's mate) is finished with the winner", () => {
    const g = restore(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect([g.status, g.winner, g.termination]).toEqual(['checkmate', 'b', 'checkmate']);
    expect(g.legalMovesUci()).toEqual([]);
    expect(g.lastEvents.some((e) => e.type === 'checkmate')).toBe(true);
  });

  it('automatic policy: the third occurrence on the restored list ends the game (threefold)', () => {
    const g = restore([...shuffle, ...shuffle]);
    expect([g.status, g.termination, g.repetitionCount()]).toEqual(['draw_repetition', 'threefold_repetition', 3]);
  });

  it('claim policy: threefold after restore is claimable, fivefold on the restored list ends the game', () => {
    const three = restore([...shuffle, ...shuffle], 'claim');
    expect([three.status, three.repetitionCount(), three.claimableDraw()]).toEqual(['active', 3, 'threefold']);
    expect(three.claimDraw(three.turn, 1)).toBeNull();
    expect(three.status).toBe('draw_repetition');
    const five = restore([...shuffle, ...shuffle, ...shuffle, ...shuffle], 'claim');
    expect([five.status, five.termination, five.repetitionCount()]).toEqual(['draw_fivefold', 'fivefold_repetition', 5]);
  });

  it('claim policy: a restored game at count 2 accepts a claim with the intended repeating move, not with another', () => {
    const g = restore([...shuffle, 'g1f3', 'g8f6', 'f3g1'], 'claim');
    expect(g.repetitionCount()).toBe(2);
    expect(g.claimDraw('b', 1, { from: 'f6', to: 'e4' })).toBe('no draw to claim');
    expect(g.status).toBe('active');
    expect(g.claimDraw('b', 1, { from: 'f6', to: 'g8' })).toBeNull();
    expect([g.status, g.ply]).toEqual(['draw_repetition', 7]);
  });

  it('halfmove clock: a restored game near the fifty-move limit claims fifty with the intended move', () => {
    const start = '8/8/4k3/8/8/4K3/4R3/8 w - - 97 80';
    const g = restore(['e2a2', 'e6d6'], 'claim', start);
    expect(g.halfmoveClock()).toBe(99);
    expect(g.claimableDraw()).toBeNull();
    expect(g.claimDraw('w', 1, { from: 'a2', to: 'a6' })).toBeNull();
    expect(g.termination).toBe('fifty_move');
    const auto = restore(['e2a2', 'e6d6', 'a2a6'], 'automatic', start);
    expect([auto.status, auto.halfmoveClock()]).toEqual(['draw_fifty', 100]);
  });

  it('promotion and underpromotion survive restore with identical effects and SAN', () => {
    const start = '4k3/1P6/8/8/8/8/6p1/4K3 b - - 0 40';
    const moves = ['g2g1n', 'b7b8r', 'e8e7', 'b8b2'];
    const g = new GameCore({ startFen: start, timeControl: null });
    g.start(0);
    moves.forEach((m, i) => expect(g.move(g.turn, toInput(m), i).ok).toBe(true));
    const r = restore(moves, 'automatic', start);
    expect(r.history.map((h) => h.san)).toEqual(['g1=N', 'b8=R+', 'Ke7', 'Rb2']);
    expect(noClock(r.history)).toEqual(noClock(g.history));
    expect(r.history[0].effects.at(-1)).toEqual({ kind: 'promote', square: 'g1', color: 'b', from: 'p', to: 'n' });
    expect(r.movesUci()).toEqual(moves);
  });

  it('a corrupt journal fails loudly: an illegal move, or a promotion without a piece, throws', () => {
    expect(() => restore(['e2e4', 'e2e4'])).toThrow(/move 2 \(e2e4\) rejected/);
    expect(() => restore(['b7b8'], 'automatic', '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1')).toThrow(/promotion piece required/);
  });

  it('timed restore: clocks resume from the saved remaining times with the side to move running', () => {
    const tc = { initialMs: 60_000, incrementMs: 1_000 };
    const r = GameCore.restore({ timeControl: tc, moves: ['e2e4', 'e7e5', 'g1f3'], clocks: { w: 50_000, b: 40_000 } }, 1_000_000);
    expect(r.snapshot(1_005_000).clocks).toEqual({ w: 50_000, b: 35_000 });
    expect(r.clock!.running).toBe<Color>('b');
  });
});
