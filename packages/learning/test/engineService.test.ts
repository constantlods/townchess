import { describe, it, expect } from 'vitest';
import {
  collectAnalysis, goCommands, parseBestMove, parseIdLine, parseInfoLine, pvToSan, toWhitePov, type EngineId,
} from '../src/index.js';

/** Recorded Stockfish-style UCI output (format of Stockfish 16/17; values from real-looking searches). */
const SF: EngineId = { name: 'Stockfish 17', version: '17' };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parseInfoLine', () => {
  it('parses a full info line with score, bounds, wdl and pv', () => {
    const i = parseInfoLine('info depth 24 seldepth 33 multipv 1 score cp 31 wdl 61 908 31 nodes 2453310 nps 1226655 hashfull 803 tbhits 0 time 2000 pv e2e4 e7e5 g1f3 b8c6 f1b5');
    expect(i).toEqual({
      depth: 24, seldepth: 33, multipv: 1, score: { kind: 'cp', value: 31 }, bound: 'exact', wdl: [61, 908, 31],
      nodes: 2453310, nps: 1226655, hashfull: 803, tbhits: 0, timeMs: 2000, pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'],
    });
  });

  it('parses mate scores and lower/upper bounds', () => {
    expect(parseInfoLine('info depth 245 seldepth 3 multipv 1 score mate 2 nodes 1532 nps 766000 time 2 pv d1h5 g7g6 h5f7')).toMatchObject({ score: { kind: 'mate', value: 2 }, bound: 'exact', pv: ['d1h5', 'g7g6', 'h5f7'] });
    expect(parseInfoLine('info depth 18 seldepth 25 multipv 1 score cp 44 lowerbound nodes 912345 nps 1100000 time 829 pv d2d4')).toMatchObject({ bound: 'lower', score: { kind: 'cp', value: 44 } });
    expect(parseInfoLine('info depth 18 seldepth 25 multipv 1 score cp -12 upperbound nodes 1 time 1 pv g8f6')).toMatchObject({ bound: 'upper', score: { kind: 'cp', value: -12 } });
    expect(parseInfoLine('info depth 0 score mate 0')).toEqual({ depth: 0, score: { kind: 'mate', value: 0 }, bound: 'exact' });
    expect(parseInfoLine('info depth 12 score mate -3 pv h8g8 a1a8')).toMatchObject({ score: { kind: 'mate', value: -3 } });
  });

  it('parses currmove lines, info strings, and rejects non-info lines', () => {
    expect(parseInfoLine('info depth 22 currmove e2e4 currmovenumber 1')).toEqual({ depth: 22, currmove: 'e2e4', currmovenumber: 1 });
    expect(parseInfoLine('info string NNUE evaluation using nn-1111cefa1111.nnue enabled')).toEqual({ string: 'NNUE evaluation using nn-1111cefa1111.nnue enabled' });
    expect(parseInfoLine('bestmove e2e4')).toBeNull();
    expect(parseInfoLine('readyok')).toBeNull();
    expect(parseInfoLine('')).toBeNull();
  });

  it('tolerates unknown tokens and garbage values without throwing', () => {
    expect(parseInfoLine('info depth 5 foo 7 score cp 10 pv e2e4 e7e5 refutation e2e4')).toMatchObject({ depth: 5, score: { kind: 'cp', value: 10 }, pv: ['e2e4', 'e7e5'] });
    expect(parseInfoLine('info depth x score cp y')).toEqual({ bound: 'exact' });
  });

  it('parses promotion moves in a pv', () => {
    expect(parseInfoLine('info depth 9 score cp 900 pv b7b8q a8b8 a7a8n')!.pv).toEqual(['b7b8q', 'a8b8', 'a7a8n']);
  });
});

describe('parseBestMove / parseIdLine', () => {
  it('bestmove with and without ponder, and (none)', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ move: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove e7e8q')).toEqual({ move: 'e7e8q', ponder: null });
    expect(parseBestMove('bestmove (none)')).toEqual({ move: null, ponder: null });
    expect(parseBestMove('info depth 1')).toBeNull();
  });
  it('id lines', () => {
    expect(parseIdLine('id name Stockfish 17')).toEqual({ name: 'Stockfish 17', version: '17' });
    expect(parseIdLine('id name Stockfish 16.1')).toEqual({ name: 'Stockfish 16.1', version: '16.1' });
    expect(parseIdLine('id author the Stockfish developers (see AUTHORS file)')).toEqual({ author: 'the Stockfish developers (see AUTHORS file)' });
    expect(parseIdLine('uciok')).toBeNull();
  });
});

describe('score point of view', () => {
  it('side-to-move scores convert to White POV', () => {
    expect(toWhitePov({ kind: 'cp', value: 35 }, 'w')).toEqual({ kind: 'cp', value: 35 });
    expect(toWhitePov({ kind: 'cp', value: 35 }, 'b')).toEqual({ kind: 'cp', value: -35 });
    expect(toWhitePov({ kind: 'mate', value: 3 }, 'b')).toEqual({ kind: 'mate', value: -3 });
    expect(toWhitePov({ kind: 'mate', value: 0 }, 'b')).toEqual({ kind: 'mate', value: 0 });
  });
});

describe('collectAnalysis on recorded output', () => {
  it('MultiPV 3 from the start position: keeps the deepest line per index, White and STM POV', () => {
    const out = [
      'info string NNUE evaluation using nn-1c0000000000.nnue',
      'info depth 1 seldepth 2 multipv 1 score cp 18 nodes 20 nps 20000 time 1 pv e2e4',
      'info depth 1 seldepth 2 multipv 2 score cp 15 nodes 40 nps 40000 time 1 pv d2d4',
      'info depth 1 seldepth 2 multipv 3 score cp 9 nodes 60 nps 60000 time 1 pv g1f3',
      'info depth 20 currmove e2e4 currmovenumber 1',
      'info depth 20 seldepth 28 multipv 1 score cp 33 lowerbound nodes 900000 nps 1000000 time 900 pv e2e4',
      'info depth 20 seldepth 29 multipv 1 score cp 29 nodes 1000000 nps 1000000 time 1000 pv e2e4 e7e5 g1f3',
      'info depth 20 seldepth 27 multipv 2 score cp 24 nodes 1000000 nps 1000000 time 1000 pv d2d4 g8f6 c2c4',
      'info depth 20 seldepth 26 multipv 3 score cp 20 nodes 1000000 nps 1000000 time 1000 pv g1f3 d7d5 d2d4',
      'info depth 20 seldepth 27 multipv 2 score cp 20 upperbound nodes 1000001 nps 1000000 time 1000 pv d2d4',
      'bestmove e2e4 ponder e7e5',
    ];
    const a = collectAnalysis(START, SF, out);
    expect(a.engine.network).toBe('nn-1c0000000000.nnue');
    expect(a.depth).toBe(20);
    expect(a.bestMove).toBe('e2e4');
    expect(a.ponder).toBe('e7e5');
    expect(a.lines.map((l) => [l.multipv, l.scoreStm.value, l.pv[0], l.bound])).toEqual([
      [1, 29, 'e2e4', 'exact'], [2, 24, 'd2d4', 'exact'], [3, 20, 'g1f3', 'exact'],
    ]);
    expect(a.lines[0].scoreWhite).toEqual({ kind: 'cp', value: 29 });
  });

  it('Black to move: White-POV score is negated', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const a = collectAnalysis(fen, SF, ['info depth 18 seldepth 24 multipv 1 score cp -27 nodes 5 time 5 pv c7c5 g1f3', 'bestmove c7c5 ponder g1f3']);
    expect(a.lines[0].scoreStm).toEqual({ kind: 'cp', value: -27 });
    expect(a.lines[0].scoreWhite).toEqual({ kind: 'cp', value: 27 });
  });

  it('checkmated position: no lines, bestmove (none)', () => {
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const a = collectAnalysis(mated, SF, ['info depth 0 score mate 0', 'bestmove (none)']);
    expect(a.lines).toEqual([]);
    expect(a.bestMove).toBeNull();
  });

  it('pvToSan replays through the authoritative rules and flags an illegal pv', () => {
    expect(pvToSan(START, ['e2e4', 'e7e5', 'g1f3'])).toEqual({ san: ['e4', 'e5', 'Nf3'], illegalAt: null });
    expect(pvToSan(START, ['e2e4', 'e2e4'])).toEqual({ san: ['e4'], illegalAt: 1 });
    expect(pvToSan('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', ['b7b8n'])).toEqual({ san: ['b8=N'], illegalAt: null });
  });

  it('goCommands builds bounded searches only', () => {
    expect(goCommands(START, { depth: 18, multiPv: 3 })).toEqual(['setoption name MultiPV value 3', `position fen ${START}`, 'go depth 18']);
    expect(goCommands(START, { nodes: 100000 })[2]).toBe('go nodes 100000');
    expect(() => goCommands(START, {})).toThrow(/unbounded/);
  });
});
