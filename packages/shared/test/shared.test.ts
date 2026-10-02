import { describe, it, expect } from 'vitest';
import { ChessRules, ChessClock, formatClock, parseClientMessage } from '../src/index';

describe('ChessRules', () => {
  it('accepts legal and rejects illegal moves', () => {
    const r = new ChessRules();
    expect(r.tryMove({ from: 'e2', to: 'e5' })).toBeNull();
    const m = r.tryMove({ from: 'e2', to: 'e4' });
    expect(m?.san).toBe('e4');
    expect(r.turn).toBe('b');
  });

  it('detects checkmate with the right winner', () => {
    const r = ChessRules.fromHistory([
      { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' }, { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
    ]);
    expect(r.positionStatus()).toEqual({ status: 'checkmate', winner: 'b' });
  });

  it('reports castling, en passant and promotion flags', () => {
    const c = new ChessRules('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(c.tryMove({ from: 'e1', to: 'g1' })?.flags).toContain('k');
    const ep = new ChessRules('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(ep.tryMove({ from: 'e5', to: 'd6' })?.flags).toContain('e');
    const p = new ChessRules('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    expect(p.isPromotionMove('b7', 'b8')).toBe(true);
    expect(p.tryMove({ from: 'b7', to: 'b8', promotion: 'n' })?.promotion).toBe('n');
  });

  it('knows mating material', () => {
    expect(new ChessRules('4k3/8/8/8/8/8/8/4KN2 w - - 0 1').hasMatingMaterial('w')).toBe(false);
    expect(new ChessRules('4k3/8/8/8/8/8/8/4KR2 w - - 0 1').hasMatingMaterial('w')).toBe(true);
  });
});

describe('ChessClock', () => {
  it('runs only the side to move and applies increment', () => {
    const c = new ChessClock({ initialMs: 10_000, incrementMs: 2_000 });
    c.start('w', 0);
    expect(c.peek('w', 3_000)).toBe(7_000);
    expect(c.peek('b', 3_000)).toBe(10_000);
    c.press('w', 3_000);
    expect(c.remaining.w).toBe(9_000);
    expect(c.running).toBe('b');
    expect(c.flagged(12_500)).toBeNull(); // black's 10 s started at t=3 s
    expect(c.flagged(13_000)).toBe('b');
  });
  it('formats clocks', () => {
    expect(formatClock(272_000)).toBe('04:32');
    expect(formatClock(9_400)).toBe('00:09.4');
  });
});

describe('protocol', () => {
  it('validates client messages', () => {
    expect('error' in parseClientMessage('{"type":"MOVE","gameId":"GAME-ABC123","seq":1,"from":"e2","to":"e4","ply":0}')).toBe(false);
    expect('error' in parseClientMessage('{"type":"MOVE","gameId":"x","seq":1,"from":"e9","to":"e4","ply":0}')).toBe(true);
    expect('error' in parseClientMessage('{"type":"DECLARE_CHECKMATE"}')).toBe(true);
    expect('error' in parseClientMessage('not json')).toBe(true);
  });
});
