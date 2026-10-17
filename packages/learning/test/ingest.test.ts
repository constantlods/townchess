import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { GameCore, positionKey, START_FEN } from '@hc/shared';
import { IngestError, assertOpaqueProfileId, ingestGame, parseTimeControl, scoreFor, timeControlClass } from '../src/index.js';

const OPERA = fs.readFileSync(new URL('../../shared/test/fixtures/pgn/opera-game.pgn', import.meta.url), 'utf8');
const META = { gameId: 'g-0001', source: 'pgn_import' as const };

describe('ingestGame from PGN', () => {
  it('normalizes the Opera Game: moves, keys per ply, opening, result, termination', () => {
    const r = ingestGame(OPERA, META);
    expect(r.schemaVersion).toBe(1);
    expect(r.plies).toBe(33);
    expect(r.moves[0]).toEqual({ ply: 1, san: 'e4', uci: 'e2e4', color: 'w' });
    expect(r.moves[22]).toMatchObject({ ply: 23, san: 'O-O-O', uci: 'e1c1' });
    expect(r.moves.at(-1)).toMatchObject({ san: 'Rd8#', uci: 'd1d8', color: 'w' });
    expect(r.positionKeys).toHaveLength(34);
    expect(r.positionKeys[0]).toBe(positionKey(START_FEN));
    expect(r.opening).toMatchObject({ eco: 'C41', name: 'Philidor Defense' });
    expect(r.result).toBe('1-0');
    expect(r.termination).toBe('checkmate');
    expect(r.playedOn).toBeNull(); // "1858.??.??" is not a full date
    expect(r.quality.warnings).toEqual([]);
  });

  it('drops every PGN name and free-text header (privacy)', () => {
    const r = ingestGame(OPERA, META);
    const json = JSON.stringify(r);
    for (const leaked of ['Morphy', 'Brunswick', 'Isouard', 'Paris']) expect(json).not.toContain(leaked);
    expect(r.white).toEqual({ profileId: null, kind: 'unknown' });
  });

  it('flags a result that contradicts the final position instead of trusting it', () => {
    const bad = OPERA.replace(/1-0/g, '0-1');
    expect(ingestGame(bad, META).quality.warnings).toContain('result_contradicts_checkmate');
  });

  it('rejects an illegal PGN', () => {
    expect(() => ingestGame('1. e4 e5 2. Ke3 *', META)).toThrow(IngestError);
  });

  it('reads TimeControl and Date headers, and Termination "time forfeit"', () => {
    const pgn = '[Event "x"]\n[Date "2026.09.30"]\n[Result "0-1"]\n[TimeControl "180+2"]\n[Termination "time forfeit"]\n\n1. e4 e5 0-1\n';
    const r = ingestGame(pgn, META);
    expect(r.timeControl).toEqual({ initialMs: 180_000, incrementMs: 2_000 });
    expect(r.timeControlClass).toBe('blitz');
    expect(r.playedOn).toBe('2026-09-30');
    expect(r.termination).toBe('timeout');
  });
});

describe('ingestGame from a GameCore history', () => {
  it('matches the core: same SAN, keys and opening as GameCore produced', () => {
    const g = new GameCore({ timeControl: { initialMs: 300_000, incrementMs: 0 } });
    g.start(0);
    for (const m of ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4e5']) g.move(g.turn, { from: m.slice(0, 2), to: m.slice(2, 4) }, 0);
    const r = ingestGame(g.history, {
      gameId: 'g-0002', source: 'townchess', result: '1-0', termination: 'resignation', timeControl: { initialMs: 300_000, incrementMs: 0 },
      white: { profileId: 'p_8f3a1c2b9d', kind: 'human' }, black: { profileId: null, kind: 'engine' }, playedAt: '2026-10-03T21:14:00Z', rated: true,
    });
    expect(r.moves.map((m) => m.san)).toEqual(g.history.map((h) => h.san));
    expect(r.positionKeys.at(-1)).toBe(positionKey(g.fen));
    expect(r.opening?.name).toBe(g.opening?.name);
    expect(r.opening?.name).toBe('French Defense: Advance Variation');
    expect(r.timeControlClass).toBe('blitz');
    expect(r.playedOn).toBe('2026-10-03'); // day only, no time of day
    expect(r.white.profileId).toBe('p_8f3a1c2b9d');
    expect(r.quality.warnings).toEqual([]);
  });

  it('accepts UCI strings, keeps transposition keys equal', () => {
    const a = ingestGame(['g1f3', 'g8f6', 'c2c4', 'e7e6', 'd2d4'], { ...META, gameId: 'a-00001' });
    const b = ingestGame(['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3'], { ...META, gameId: 'b-00001' });
    expect(a.positionKeys.at(-1)).toBe(b.positionKeys.at(-1));
    expect(a.opening?.name).toBe(b.opening?.name);
    expect(a.opening?.transposed !== b.opening?.transposed).toBe(true);
    expect(a.quality.warnings).toEqual(['result_unknown']);
  });

  it('rejects malformed and illegal moves', () => {
    expect(() => ingestGame(['e2e5'], META)).toThrow(/illegal move at ply 1/);
    expect(() => ingestGame(['e2-e4'], META)).toThrow(/not a UCI move/);
  });

  it('marks non-standard starts and empty games', () => {
    const r = ingestGame([], { ...META, startFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1' });
    expect(r.quality.warnings).toEqual(expect.arrayContaining(['nonstandard_start', 'empty_game']));
    expect(r.opening).toBeNull();
  });
});

describe('privacy guards and helpers', () => {
  it('profile ids must be opaque', () => {
    expect(() => assertOpaqueProfileId('p_8f3a1c2b9d')).not.toThrow();
    for (const bad of ['someone@example.com', '192.168.0.105', 'Magnus Carlsen', 'bob', '']) {
      expect(() => assertOpaqueProfileId(bad), bad).toThrow(IngestError);
    }
    expect(() => ingestGame(['e2e4'], { ...META, white: { profileId: 'player@mail.test' } })).toThrow(IngestError);
  });

  it('time-control classes (Lichess estimate: initial + 40 x increment)', () => {
    expect(timeControlClass(null)).toBe('untimed');
    expect(timeControlClass(undefined)).toBe('unknown');
    expect(timeControlClass(parseTimeControl('15')!)).toBe('ultrabullet');
    expect(timeControlClass(parseTimeControl('60+0')!)).toBe('bullet');
    expect(timeControlClass(parseTimeControl('180+2')!)).toBe('blitz');
    expect(timeControlClass(parseTimeControl('600+0')!)).toBe('rapid');
    expect(timeControlClass(parseTimeControl('900+10')!)).toBe('rapid');
    expect(timeControlClass(parseTimeControl('1800+0')!)).toBe('classical');
    expect(timeControlClass(parseTimeControl('86400')!)).toBe('correspondence');
    expect(parseTimeControl('-')).toBeNull();
    expect(parseTimeControl('40/7200:3600')).toBeUndefined();
  });

  it('scoreFor', () => {
    expect(scoreFor('1-0', 'w')).toBe(1);
    expect(scoreFor('1-0', 'b')).toBe(0);
    expect(scoreFor('1/2-1/2', 'b')).toBe(0.5);
    expect(scoreFor('*', 'w')).toBeNull();
  });
});
