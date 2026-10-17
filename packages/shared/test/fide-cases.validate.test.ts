/**
 * Independent validation of packages/shared/test/fixtures/fide-cases.json.
 *
 * This file deliberately talks to chess.js DIRECTLY (not the project wrapper in
 * packages/shared/src) so the fixtures are proven correct on their own. The game
 * core's own tests should then run the same fixtures against the wrapper/GameCore.
 *
 * Keys chess.js can judge are checked against chess.js. Keys it cannot judge
 * (fivefold, deadPosition, seventyFiveMoveDraw, timeoutResult) are checked
 * against the small reference helpers below; the lead's GameCore should
 * implement these rules identically.
 */
import { describe, it, expect } from 'vitest';
import { Chess, type Move } from 'chess.js';
import cases from './fixtures/fide-cases.json';

type Color = 'w' | 'b';
interface Expect {
  legal?: string[];
  illegal?: string[];
  inCheck?: boolean;
  checkmate?: boolean;
  stalemate?: boolean;
  insufficientMaterial?: boolean;
  deadPosition?: boolean;
  threefold?: boolean;
  fivefold?: boolean;
  halfmoveClock?: number;
  fiftyMoveClaimable?: boolean;
  seventyFiveMoveDraw?: boolean;
  timeoutResult?: { flagged: Color; result: 'win' | 'draw' };
  notes?: string;
}
interface FideCase {
  id: string;
  category: string;
  fide: string;
  description: string;
  fen: string;
  moves: string[];
  expect: Expect;
  knownChessJsDeviation?: boolean;
}

const CASES = cases as FideCase[];
const CATEGORIES = new Set([
  'castling', 'en-passant', 'promotion', 'check', 'pin', 'checkmate', 'stalemate', 'insufficient',
  'dead-position', 'repetition', 'fifty-move', 'seventy-five', 'timeout', 'move-legality',
]);
const EXPECT_KEYS = new Set([
  'legal', 'illegal', 'inCheck', 'checkmate', 'stalemate', 'insufficientMaterial', 'deadPosition',
  'threefold', 'fivefold', 'halfmoveClock', 'fiftyMoveClaimable', 'seventyFiveMoveDraw', 'timeoutResult', 'notes',
]);

// ---------------------------------------------------------------------------
// UCI helpers
// ---------------------------------------------------------------------------

/** Legal moves of the current position as UCI strings (from+to+promotion piece). */
function legalUci(chess: Chess): Set<string> {
  return new Set(chess.moves({ verbose: true }).map((m: Move) => m.from + m.to + (m.promotion ?? '')));
}

/** Plays one UCI move; throws if it is not legal. "a7a8" (no piece) is NOT a legal promotion. */
function playUci(chess: Chess, uci: string): Move {
  const m = chess.moves({ verbose: true }).find((mv: Move) => mv.from + mv.to + (mv.promotion ?? '') === uci);
  if (!m) throw new Error(`illegal UCI move ${uci} in ${chess.fen()}`);
  return chess.move(m);
}

// ---------------------------------------------------------------------------
// Reference helper 1: repetition key (FIDE 9.2.3)
//
// Two positions are the same iff the same player is to move, the same pieces
// stand on the same squares, and the possible moves are the same. We key on the
// first four FEN fields (placement, side to move, castling RIGHTS, ep square),
// where the ep square is kept ONLY if an en passant capture is actually legal
// (a pseudo-legal capture by a pinned pawn does not count). Castling is keyed by
// rights, not by whether castling is possible this move (9.2.3.2 talks about
// rights forfeited by moving king/rook).
// ---------------------------------------------------------------------------
function repetitionKey(chess: Chess): string {
  const [placement, turn, castling] = chess.fen().split(' ');
  const rawEp = chess.fen({ forceEnpassantSquare: true }).split(' ')[3];
  let ep = '-';
  if (rawEp !== '-') {
    const epLegal = chess.moves({ verbose: true }).some((m: Move) => m.to === rawEp && m.flags.includes('e'));
    if (epLegal) ep = rawEp;
  }
  return `${placement} ${turn} ${castling} ${ep}`;
}

/** Occurrences of the final position in the whole game (initial FEN included). */
function finalPositionCount(keys: string[]): number {
  const last = keys[keys.length - 1];
  return keys.filter((k) => k === last).length;
}

// ---------------------------------------------------------------------------
// Reference helper 2: material-class mating ability (FIDE 6.9 / 5.2.2)
//
// canMateByMaterial(board, side): can `side` ever deliver checkmate, assuming the
// opponent cooperates (helpmate)? Rules (same classes as lichess/scalachess):
//   1. side has a queen, rook or pawn                   -> yes
//   2. side has only its king                           -> no
//   3. side has a knight and a bishop, or >= 2 knights,
//      or bishops on both square colours                -> yes  (KNN vs K is a helpmate)
//   4. side has exactly one knight (and nothing else)   -> yes iff the opponent has a
//      rook, bishop, knight or pawn (something that can block its own king). Against
//      K or K+queen(s) only -> no (brute-forced: no K+N vs K+Q mate position exists).
//   5. side has only bishops, all on one colour C       -> yes iff the opponent has a
//      knight or pawn, or any bishop on the other colour. Against K, K+R, K+Q or
//      K+same-colour bishops -> no (brute-forced for K+B vs K+R and K+B vs K+Q).
// NOT covered by material classes: blocked pawn structures (see helper 3).
// ---------------------------------------------------------------------------
interface Material { q: number; r: number; p: number; n: number; bLight: number; bDark: number }

function material(chess: Chess, color: Color): Material {
  const m: Material = { q: 0, r: 0, p: 0, n: 0, bLight: 0, bDark: 0 };
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color) continue;
      if (sq.type === 'b') {
        if (chess.squareColor(sq.square) === 'light') m.bLight++;
        else m.bDark++;
      } else if (sq.type !== 'k') m[sq.type]++;
    }
  }
  return m;
}

function canMateByMaterial(chess: Chess, side: Color): boolean {
  const s = material(chess, side);
  const o = material(chess, side === 'w' ? 'b' : 'w');
  const sBishops = s.bLight + s.bDark;
  if (s.q || s.r || s.p) return true; // rule 1
  if (!s.n && !sBishops) return false; // rule 2
  if ((s.n && sBishops) || s.n >= 2 || (s.bLight && s.bDark)) return true; // rule 3
  if (s.n === 1) return o.r + o.bLight + o.bDark + o.n + o.p > 0; // rule 4
  // rule 5: only bishops of a single colour
  const otherColourBishops = s.bLight ? o.bDark : o.bLight;
  return o.n + o.p + otherColourBishops > 0;
}

// ---------------------------------------------------------------------------
// Reference helper 3: exhaustive reachable-position search (dead positions)
//
// BFS over every position reachable by legal moves, keyed by the repetition key
// (clocks ignored). Returns
//   'mate'    as soon as a checkmate of the requested victim is reachable,
//   'no-mate' if the whole reachable set was enumerated and no such mate exists
//             (proof that the position is dead for that victim),
//   'unknown' if the cap was hit.
// victim = 'w' | 'b' (whose king gets mated) or 'any'.
// This is only feasible for small/blocked positions; GameCore can gate it the
// same way (see isLockedCandidate) and otherwise rely on helper 2.
// ---------------------------------------------------------------------------
function searchMate(fen: string, victim: Color | 'any', cap = 200_000): 'mate' | 'no-mate' | 'unknown' {
  const c = new Chess(fen);
  const isVictimMated = (ch: Chess) => ch.isCheckmate() && (victim === 'any' || ch.turn() === victim);
  if (isVictimMated(c)) return 'mate';
  const seen = new Set<string>([repetitionKey(c)]);
  let frontier = [repetitionKey(c)];
  while (frontier.length) {
    const next: string[] = [];
    for (const key of frontier) {
      c.load(`${key} 0 1`);
      for (const m of c.moves({ verbose: true })) {
        c.move(m);
        if (isVictimMated(c)) return 'mate';
        const k = repetitionKey(c);
        if (!seen.has(k)) {
          seen.add(k);
          next.push(k);
          if (seen.size > cap) return 'unknown';
        }
        c.undo();
      }
    }
    frontier = next;
  }
  return 'no-mate';
}

/**
 * Gate for running helper 3 in the 6.9 rule: at least one pawn, no
 * queens/rooks/knights, and every pawn is blocked frontally by an enemy pawn.
 * (Cheap, conservative; pawnless positions are fully decided by helper 2.)
 */
function isLockedCandidate(chess: Chess): boolean {
  const board = chess.board(); // board[0] is rank 8
  if (!board.some((row) => row.some((sq) => sq?.type === 'p'))) return false;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      if (sq.type === 'q' || sq.type === 'r' || sq.type === 'n') return false;
      if (sq.type === 'p') {
        const ahead = board[sq.color === 'w' ? r - 1 : r + 1]?.[f];
        if (!ahead || ahead.type !== 'p' || ahead.color === sq.color) return false;
      }
    }
  }
  return true;
}

/**
 * FIDE 6.9: if `flagged` runs out of time, the opponent wins unless the opponent
 * cannot checkmate by ANY series of legal moves (helpmates included) -> draw.
 */
function timeoutResult(chess: Chess, flagged: Color): 'win' | 'draw' {
  const opponent: Color = flagged === 'w' ? 'b' : 'w';
  if (!canMateByMaterial(chess, opponent)) return 'draw';
  if (isLockedCandidate(chess) && searchMate(chess.fen(), flagged) === 'no-mate') return 'draw';
  return 'win';
}

/** 5.2.2 dead position: no series of legal moves can lead to checkmate for either side. */
function deadPosition(chess: Chess): boolean | 'unknown' {
  const r = searchMate(chess.fen(), 'any');
  return r === 'unknown' ? 'unknown' : r === 'no-mate';
}

// ---------------------------------------------------------------------------
// Fixture schema sanity
// ---------------------------------------------------------------------------
describe('fide-cases.json schema', () => {
  it('has unique ids, known categories and only allowed expect keys', () => {
    const ids = new Set<string>();
    for (const c of CASES) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(CATEGORIES.has(c.category), `${c.id}: category ${c.category}`).toBe(true);
      expect(c.fide, c.id).toBeTruthy();
      for (const k of Object.keys(c.expect)) expect(EXPECT_KEYS.has(k), `${c.id}: key ${k}`).toBe(true);
    }
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// chess.js behaviours the helpers rely on (verified, not assumed)
// ---------------------------------------------------------------------------
describe('chess.js behaviour checks', () => {
  it('fen() prints the ep square only when an ep capture is legal', () => {
    // no adjacent enemy pawn: chess.js does not even record the ep square internally
    const noPawn = new Chess();
    noPawn.move('e4');
    expect(noPawn.fen().split(' ')[3]).toBe('-');
    expect(noPawn.fen({ forceEnpassantSquare: true }).split(' ')[3]).toBe('-');

    const capturable = new Chess('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
    capturable.move('d5');
    expect(capturable.fen().split(' ')[3]).toBe('d6');

    // pseudo-legal but illegal (rank pin): hidden by fen()
    const pinned = new Chess('4k3/3p4/8/K3P2r/8/8/8/8 b - - 0 1');
    pinned.move('d5');
    expect(pinned.fen().split(' ')[3]).toBe('-');
    expect(pinned.fen({ forceEnpassantSquare: true }).split(' ')[3]).toBe('d6');

    // a FEN ep square with no capturing pawn is dropped on load
    expect(new Chess('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1').fen().split(' ')[3]).toBe('-');
  });

  it('repetitionKey matches the first four fields of chess.js fen()', () => {
    for (const c of CASES) {
      const chess = new Chess(c.fen);
      expect(repetitionKey(chess)).toBe(chess.fen().split(' ').slice(0, 4).join(' '));
      for (const uci of c.moves) {
        playUci(chess, uci);
        expect(repetitionKey(chess), c.id).toBe(chess.fen().split(' ').slice(0, 4).join(' '));
      }
    }
  });

  it('DEVIATION: chess.js counts an illegal (pinned) ep right as a different position', () => {
    const c = CASES.find((x) => x.id === 'repetition-illegal-ep-does-not-differ')!;
    const chess = new Chess(c.fen);
    for (const uci of c.moves) playUci(chess, uci);
    // FIDE (9.2.3) says threefold; chess.js 1.4 says no. If this starts failing,
    // chess.js was fixed and the knownChessJsDeviation flag can be removed.
    expect(chess.isThreefoldRepetition()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-case validation
// ---------------------------------------------------------------------------
describe('FIDE cases validated against chess.js + reference helpers', () => {
  for (const c of CASES) {
    it(`${c.category}: ${c.id}`, () => {
      const e = c.expect;
      const chess = new Chess(c.fen);
      const keys = [repetitionKey(chess)];
      for (const uci of c.moves) {
        playUci(chess, uci);
        keys.push(repetitionKey(chess));
      }

      const legal = legalUci(chess);
      for (const m of e.legal ?? []) expect(legal.has(m), `${m} should be legal`).toBe(true);
      for (const m of e.illegal ?? []) expect(legal.has(m), `${m} should be illegal`).toBe(false);

      if (e.inCheck !== undefined) expect(chess.inCheck()).toBe(e.inCheck);
      if (e.checkmate !== undefined) expect(chess.isCheckmate()).toBe(e.checkmate);
      if (e.stalemate !== undefined) expect(chess.isStalemate()).toBe(e.stalemate);
      if (e.insufficientMaterial !== undefined) expect(chess.isInsufficientMaterial()).toBe(e.insufficientMaterial);

      const halfmove = Number(chess.fen().split(' ')[4]);
      if (e.halfmoveClock !== undefined) expect(halfmove).toBe(e.halfmoveClock);
      if (e.fiftyMoveClaimable !== undefined) {
        expect(halfmove >= 100).toBe(e.fiftyMoveClaimable);
        expect(chess.isDrawByFiftyMoves()).toBe(e.fiftyMoveClaimable);
      }
      if (e.seventyFiveMoveDraw !== undefined) {
        // 9.6.2: >= 75 moves by each player without pawn move/capture, unless the last move mated.
        expect(halfmove >= 150 && !chess.isCheckmate()).toBe(e.seventyFiveMoveDraw);
      }

      const count = finalPositionCount(keys);
      if (e.threefold !== undefined) {
        expect(count >= 3, 'reference repetition count').toBe(e.threefold);
        if (!c.knownChessJsDeviation) expect(chess.isThreefoldRepetition(), 'chess.js threefold').toBe(e.threefold);
      }
      if (e.fivefold !== undefined) expect(count >= 5).toBe(e.fivefold);

      if (e.deadPosition !== undefined) {
        const dead = deadPosition(chess);
        expect(dead, 'dead-position search must be conclusive').not.toBe('unknown');
        expect(dead).toBe(e.deadPosition);
      }
      if (e.timeoutResult !== undefined) {
        expect(timeoutResult(chess, e.timeoutResult.flagged)).toBe(e.timeoutResult.result);
      }
    }, 60_000);
  }
});
