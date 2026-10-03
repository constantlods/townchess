import { describe, it, expect } from 'vitest';
import type { DrawPolicy, GameStateDTO } from '@hc/shared';
import { PlayerStore } from '../src/players';
import { GameRoom, type RoomRecord } from '../src/room';

/**
 * Rules audit of the server journal: GameRoom.record() -> JSON file -> GameRoom.fromRecord() (hub.restoreJournal).
 * See docs/ENGINE_AGENT.md (restore audit) and docs/KNOWN_LIMITATIONS.md (BUG-005, LIM-009).
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

const ev = () => {
  let finished = 0;
  return { finishedCount: () => finished, ev: { broadcast: () => {}, send: () => {}, finished: () => { finished++; } } };
};

function newRoom(id: string, drawPolicy: DrawPolicy, store = new PlayerStore(null), timed = false) {
  const a = store.authenticate(undefined, `W${id.slice(-4)}`).player, b = store.authenticate(undefined, `B${id.slice(-4)}`).player;
  const e = ev();
  const tc = { initialMs: 600_000, incrementMs: 0 };
  const room = new GameRoom(id, tc, false, a.id, b.id, store, e.ev, { timeControl: timed ? tc : null, drawPolicy });
  room.start();
  return { room, store, a: a.id, b: b.id, e };
}

/** The journal is a JSON file: always go through a real serialisation. */
const reload = (room: GameRoom, store: PlayerStore) => {
  const rec = JSON.parse(JSON.stringify(room.record())) as RoomRecord;
  return GameRoom.fromRecord(rec, store, ev().ev);
};

const rulesView = (d: GameStateDTO) => ({
  fen: d.fen, turn: d.turn, status: d.status, winner: d.winner, termination: d.termination, drawPolicy: d.drawPolicy,
  claimableDraw: d.claimableDraw, legalMoves: [...d.legalMoves].sort(), opening: d.opening, inBook: d.inBook,
  history: d.moveHistory.map(({ clockAfterMs: _c, ...m }) => m),
});

describe('server journal: record -> JSON -> fromRecord reproduces the game', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: random game restored at a random ply plays on identically`, () => {
      const rng = mulberry32(seed * 104729);
      const policy: DrawPolicy = seed % 2 ? 'claim' : 'automatic';
      const { room, store, a, b } = newRoom(`GAME-J0000${seed}`, policy);
      const cut = 4 + Math.floor(rng() * 40);
      let restored: GameRoom | null = null;
      const pid = (r: GameRoom) => (r.core.turn === 'w' ? a : b);
      for (let i = 0; i < 140 && room.status === 'active'; i++) {
        if (i === cut) {
          restored = reload(room, store);
          expect(rulesView(restored.dto())).toEqual(rulesView(room.dto()));
          expect(restored.dto().eventSeq).toBe(room.dto().eventSeq); // moves only: replay gives the same sequence
        }
        const legal = room.core.legalMovesUci();
        let pick = legal[Math.floor(rng() * legal.length)];
        if (i >= 2 && rng() < 0.5) { // shuffle back so repetitions happen
          const back = room.history[i - 2];
          if (!back.promotion && legal.includes(back.to + back.from)) pick = back.to + back.from;
        }
        const promo = (pick[4] as 'q' | 'r' | 'b' | 'n' | undefined) || undefined;
        expect(room.move(pid(room), pick.slice(0, 2), pick.slice(2, 4), promo, i)).toBeNull();
        if (restored) {
          const before = restored.dto().eventSeq;
          expect(restored.move(pid(restored), pick.slice(0, 2), pick.slice(2, 4), promo, i)).toBeNull();
          expect(restored.dto().eventSeq).toBeGreaterThan(before);
          expect(rulesView(restored.dto())).toEqual(rulesView(room.dto()));
        }
      }
    });
  }

  it('a claim-policy game restored at a threefold position can be claimed, with and without an intended move', () => {
    const { room, store, a, b } = newRoom('GAME-J00010', 'claim');
    const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
    moves.forEach((m, i) => expect(room.move(i % 2 ? b : a, m.slice(0, 2), m.slice(2, 4), undefined, i)).toBeNull());
    const r1 = reload(room, store);
    expect([r1.status, r1.dto().claimableDraw]).toEqual(['active', 'threefold']);
    expect(r1.claimDraw(a)).toBeNull();
    expect([r1.status, r1.dto().termination]).toEqual(['draw_repetition', 'threefold_repetition']);
    // one ply earlier (count 2): the claim needs the intended move that repeats
    const { room: early, store: s2, a: a2, b: b2 } = newRoom('GAME-J00011', 'claim');
    moves.slice(0, 7).forEach((m, i) => expect(early.move(i % 2 ? b2 : a2, m.slice(0, 2), m.slice(2, 4), undefined, i)).toBeNull());
    const r2 = reload(early, s2);
    expect(r2.claimDraw(b2, { from: 'f6', to: 'e4' })).toBe('no draw to claim');
    expect(r2.claimDraw(b2, { from: 'f6', to: 'g8' })).toBeNull();
    expect(r2.status).toBe('draw_repetition');
  });

  it('promotion and underpromotion survive the journal (UCI with a piece letter)', () => {
    const { room, store, a, b } = newRoom('GAME-J00012', 'automatic');
    // 1.h4 g5 2.hxg5 Nf6 3.g6 Nh5 4.gxh7 Rg8 5.hxg8=N
    const seq = ['h2h4', 'g7g5', 'h4g5', 'g8f6', 'g5g6', 'f6h5', 'g6h7', 'h8g8'];
    seq.forEach((m, i) => expect(room.move(i % 2 ? b : a, m.slice(0, 2), m.slice(2, 4), undefined, i)).toBeNull());
    expect(room.move(a, 'h7', 'g8', 'n', 8)).toBeNull();
    expect(room.record().moves.at(-1)).toBe('h7g8n');
    const r = reload(room, store);
    expect(r.history.at(-1)!.san).toBe('hxg8=N');
    expect(r.history.at(-1)!.effects).toEqual(room.history.at(-1)!.effects);
    expect(rulesView(r.dto())).toEqual(rulesView(room.dto()));
  });
});

describe('BUG-005 eventSeq goes backwards across a journal restore', () => {
  // GameStateDTO.eventSeq contract (types.ts): "A client must act on lastEvents only when eventSeq is new to it."
  // The journal does not store eventSeq; restore() re-derives it from the replayed moves only. Draw offers and
  // declines (and any other non-move setEvents) are lost, so after a restart the sequence is LOWER than what the
  // clients already saw, and the next real events reuse numbers the clients treat as already processed.
  // Repro: 1.e4, Black offers a draw (seq 2), White declines (seq 3), server restarts: seq is 1; 1...e5 -> seq 2.
  const setup = () => {
    const { room, store, a, b } = newRoom('GAME-J00020', 'automatic');
    expect(room.move(a, 'e2', 'e4', undefined, 0)).toBeNull();
    room.offerDraw(b);
    room.declineDraw(a);
    return { room, store, a, b, seen: room.dto().eventSeq };
  };

  it('control: the original room sequence is 3 after move, offer, decline', () => {
    expect(setup().seen).toBe(3);
  });

  it('BUG-005a: the restored room never reports a lower eventSeq than the clients already saw', () => {
    const { room, store, seen } = setup();
    expect(reload(room, store).dto().eventSeq).toBeGreaterThanOrEqual(seen);
  });

  it('BUG-005b: the first move after the restore gets an eventSeq the clients have not seen yet', () => {
    const { room, store, b, seen } = setup();
    const r = reload(room, store);
    expect(r.move(b, 'e7', 'e5', undefined, 1)).toBeNull();
    expect(r.dto().eventSeq).toBeGreaterThan(seen);
  });
});

describe('LIM-009 what a journal restore does not bring back (pinned current behaviour)', () => {
  it('control (since e819a2a): at ply 0 the first-move window is restored, fresh from the restart, and no clock runs', () => {
    const { room, store } = newRoom('GAME-J00030', 'automatic', new PlayerStore(null), true);
    expect(room.dto().firstMoveDeadline).not.toBeNull();
    const r = reload(room, store);
    expect(r.dto().firstMoveDeadline).not.toBeNull();
    expect([r.dto().clockRunning, r.core.clock!.running]).toEqual([null, null]);
  });

  it('a pending draw offer is not restored', () => {
    const { room, store, a, b } = newRoom('GAME-J00031', 'automatic');
    expect(room.move(a, 'e2', 'e4', undefined, 0)).toBeNull();
    room.offerDraw(b);
    expect(room.dto().drawOfferBy).toBe('b');
    expect(reload(room, store).dto().drawOfferBy).toBeNull();
  });

  it('an "active" record whose moves already end the game comes back finished, without a result being recorded', () => {
    // Only reachable if the journal write of the final state was lost. hub.restoreJournal then deletes the file
    // (status !== 'active'), so the result of the game is never recorded or rated.
    const { room, store, a, b } = newRoom('GAME-J00032', 'automatic');
    ['f2f3', 'e7e5', 'g2g4'].forEach((m, i) => expect(room.move(i % 2 ? b : a, m.slice(0, 2), m.slice(2, 4), undefined, i)).toBeNull());
    const rec = JSON.parse(JSON.stringify(room.record())) as RoomRecord;
    rec.moves.push('d8h4');
    const e = ev();
    const r = GameRoom.fromRecord(rec, store, e.ev);
    expect([r.status, r.core.winner, r.core.termination]).toEqual(['checkmate', 'b', 'checkmate']);
    expect(e.finishedCount()).toBe(0);
    expect(store.get(b)!.wins).toBe(0);
  });
});
