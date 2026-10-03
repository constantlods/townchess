import { describe, it, expect } from 'vitest';
import {
  addGame, addToRepertoire, aggregate, attachQuality, createAggregate, createRepertoire, detectNovelty, ingestGame,
  publicView, recurringOpenings, whiteScore, type GameRecord, type ResultToken,
} from '../src/index.js';

let n = 0;
function game(moves: string[], result: ResultToken, white: string | null = null, black: string | null = null, playedAt = '2026-10-01'): GameRecord {
  n++;
  return ingestGame(moves, {
    gameId: `game-${String(n).padStart(6, '0')}`, source: 'townchess', result, termination: result === '*' ? null : 'resignation',
    white: { profileId: white, kind: 'human' }, black: { profileId: black, kind: 'human' }, playedAt,
  });
}

const FRENCH_ADVANCE = ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4e5', 'c7c5', 'c2c3', 'b8c6'];
const FRENCH_ADVANCE_ALT = ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4e5', 'c7c5', 'g1f3', 'b8c6'];
const SICILIAN = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'];
const QGD = ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'];
const ME = 'p_profile_alpha';

describe('global aggregate: frequency and result facets', () => {
  it('counts positions and moves, results White POV', () => {
    const agg = aggregate([game(FRENCH_ADVANCE, '1-0'), game(FRENCH_ADVANCE_ALT, '0-1'), game(SICILIAN, '1/2-1/2')]);
    expect(agg.games).toBe(3);
    const root = Object.values(agg.nodes).find((x) => x.key.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'))!;
    expect(root.count).toBe(3);
    expect(root.results).toEqual({ whiteWins: 1, draws: 1, blackWins: 1, unknown: 0 });
    expect(root.moves.e2e4.count).toBe(3);
    expect(whiteScore(root.results)).toBe(0.5);
    const afterE4 = agg.nodes[root.moves.e2e4.to];
    expect(afterE4.moves.e7e6.count).toBe(2);
    expect(afterE4.moves.c7c5.count).toBe(1);
    expect(afterE4.moves.e7e6.results).toEqual({ whiteWins: 1, draws: 0, blackWins: 1, unknown: 0 });
  });

  it('is transposition-aware: two move orders update one node', () => {
    const a = game(['g1f3', 'g8f6', 'c2c4', 'e7e6', 'd2d4'], '1-0');
    const b = game(['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3'], '0-1');
    const agg = aggregate([a, b]);
    const node = agg.nodes[a.positionKeys[5]];
    expect(a.positionKeys[5]).toBe(b.positionKeys[5]);
    expect(node.count).toBe(2);
    expect(node.book?.name).toBe(a.opening?.name);
  });

  it('a position repeated inside one game counts once for that game', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6'];
    const agg = aggregate([game(shuffle, '1/2-1/2')]);
    const startKey = Object.keys(agg.nodes).find((k) => k.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'))!;
    expect(agg.nodes[startKey].count).toBe(1);
    expect(agg.nodes[startKey].moves.g1f3.count).toBe(2); // the move itself was played twice
  });

  it('respects maxPly and rejects games that fail data-quality checks', () => {
    const agg = createAggregate(4);
    expect(addGame(agg, game(SICILIAN, '1-0')).accepted).toBe(true);
    expect(Object.keys(agg.nodes)).toHaveLength(5); // start + 4 plies
    const bad = ingestGame(['f2f3', 'e7e5', 'g2g4', 'd8h4'], { gameId: 'bad-000001', source: 'townchess', result: '1-0' });
    expect(bad.quality.warnings).toContain('result_contradicts_checkmate');
    expect(addGame(agg, bad).accepted).toBe(false);
    expect(agg.games).toBe(1);
  });

  it('holds no profile ids (global scope), and publicView suppresses rare lines', () => {
    const recs = [...Array(5)].map(() => game(FRENCH_ADVANCE, '1-0', ME, 'p_profile_beta'));
    recs.push(game(SICILIAN, '0-1', ME, 'p_profile_beta'));
    const agg = aggregate(recs);
    expect(JSON.stringify(agg)).not.toContain('p_profile');
    const pub = publicView(agg, 5);
    const startKey = Object.keys(pub.nodes).find((k) => k.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'))!;
    const afterE4 = pub.nodes[pub.nodes[startKey].moves.e2e4.to];
    expect(afterE4.moves.e7e6.count).toBe(5);
    expect(afterE4.moves.c7c5).toBeUndefined(); // played once: suppressed
    expect(Object.keys(pub.nodes).length).toBeLessThan(Object.keys(agg.nodes).length);
  });
});

describe('quality facet (engine slot)', () => {
  it('is null until attached, and validates the slot', () => {
    const r = game(QGD, '1-0');
    const agg = aggregate([r]);
    const key = r.positionKeys[6];
    expect(agg.nodes[key].quality).toBeNull();
    const q = { cp: 25, mate: null, depth: 30, engine: { name: 'Stockfish 17', version: '17' }, analysedOn: '2026-10-03' };
    expect(attachQuality(agg, key, q)).toBe(true);
    expect(agg.nodes[key].quality).toEqual(q);
    expect(attachQuality(agg, 'not-a-key', q)).toBe(false);
    expect(() => attachQuality(agg, key, { ...q, mate: 3 })).toThrow();
  });
});

describe('novelty facet', () => {
  it('reports leaving the book and the first unseen move separately', () => {
    const agg = aggregate([game(FRENCH_ADVANCE, '1-0')]);
    const same = detectNovelty(game(FRENCH_ADVANCE, '1-0'), agg);
    expect(same.noveltyAtPly).toBeNull();
    const alt = detectNovelty(game(FRENCH_ADVANCE_ALT, '1-0'), agg);
    expect(alt.noveltyAtPly).toBe(7); // 4.Nf3 instead of 4.c3
    expect(alt.perPly.slice(0, 6).every((p) => p === 'book' || p === 'known')).toBe(true);
    expect(alt.perPly[6]).toBe('novelty');
    expect(alt.perPly[7]).toBe('beyond_novelty');
    expect(alt.leftBookAtPly).not.toBeNull();
  });

  it('uses an injectable book lookup (pure)', () => {
    const agg = createAggregate();
    const r = game(['e2e4', 'e7e5'], '*');
    const rep = detectNovelty(r, agg, () => null);
    expect(rep).toEqual({ perPly: ['novelty', 'beyond_novelty'], leftBookAtPly: null, noveltyAtPly: 1 });
  });
});

describe('per-profile repertoire', () => {
  it('detects a recurring French Defense: Advance Variation as Black', () => {
    const rep = createRepertoire(ME);
    // ME plays Black in the French Advance 4 times (two move orders), plus other games
    addToRepertoire(rep, game(FRENCH_ADVANCE, '0-1', 'p_opp_00001', ME, '2026-09-01'));
    addToRepertoire(rep, game(FRENCH_ADVANCE, '1-0', 'p_opp_00002', ME, '2026-09-05'));
    addToRepertoire(rep, game(FRENCH_ADVANCE_ALT, '1/2-1/2', 'p_opp_00003', ME, '2026-09-20'));
    addToRepertoire(rep, game(FRENCH_ADVANCE, '0-1', 'p_opp_00004', ME, '2026-09-11'));
    addToRepertoire(rep, game(SICILIAN, '1-0', 'p_opp_00005', ME));
    addToRepertoire(rep, game(QGD, '1-0', ME, 'p_opp_00006'));
    expect(addToRepertoire(rep, game(QGD, '1-0', 'p_x_000001', 'p_y_000001'))).toBeNull(); // not this profile's game

    expect(rep.games).toEqual({ w: 1, b: 5 });
    const rec = recurringOpenings(rep, { minGames: 3, minShare: 0.5 });
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ color: 'b', games: 4, share: 0.8, lastPlayedOn: '2026-09-20', results: { wins: 2, draws: 1, losses: 1, unknown: 0 } });
    expect(rec[0].name).toBe('French Defense: Advance Variation'); // groups the Nimzowitsch System sub-variation
    // at full-name granularity the sub-variation is a separate (and here non-recurring) entry
    expect(recurringOpenings(rep, { minGames: 3, minShare: 0.5, level: 'name' }).map((r) => r.games)).toEqual([3]);

    const fam = recurringOpenings(rep, { minGames: 3, level: 'family' });
    expect(fam.map((f) => `${f.color} ${f.name}`)).toEqual(['b French Defense']);
    // colour trees: the White tree holds only the QGD game
    expect(rep.trees.w.games).toBe(1);
    expect(rep.trees.b.games).toBe(5);
  });

  it('is deterministic: same games in the same order give the same repertoire', () => {
    const build = () => {
      const rep = createRepertoire(ME);
      for (const m of [FRENCH_ADVANCE, SICILIAN, FRENCH_ADVANCE_ALT]) addToRepertoire(rep, { ...game(m, '0-1', 'p_opp_99999', ME), gameId: 'fixed' });
      return rep;
    };
    expect(build()).toEqual(build());
  });
});
