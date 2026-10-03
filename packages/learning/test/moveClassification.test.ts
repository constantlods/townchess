import { describe, it, expect } from 'vitest';
import { PROVISIONAL_THRESHOLDS, classifyMove, negateScore, winProbability, winningChances, type ClassificationThresholds } from '../src/index.js';

const cp = (value: number) => ({ kind: 'cp' as const, value });
const mate = (value: number) => ({ kind: 'mate' as const, value });

describe('win probability', () => {
  it('is 0.5 at 0, symmetric, monotonic and saturates', () => {
    expect(winProbability(cp(0))).toBeCloseTo(0.5, 10);
    expect(winProbability(cp(300)) + winProbability(cp(-300))).toBeCloseTo(1, 10);
    expect(winProbability(cp(100))).toBeGreaterThan(winProbability(cp(50)));
    expect(winProbability(cp(100))).toBeCloseTo(0.591, 3); // Lichess curve: +100 cp ≈ 59% expected score
    expect(winProbability(mate(5))).toBe(1);
    expect(winProbability(mate(-5))).toBe(0);
    expect(winningChances(cp(5000))).toBeLessThan(1);
  });
});

describe('classifyMove (provisional thresholds)', () => {
  const T = PROVISIONAL_THRESHOLDS;
  it('thresholds are data, marked provisional and versioned', () => {
    expect(T.status).toBe('provisional');
    expect(T.version).toMatch(/^provisional-/);
    expect(Object.isFrozen(T)).toBe(true);
    expect(classifyMove({ before: cp(0), after: cp(0) }).provisional).toBe(true);
  });

  it('labels by winning-chance loss bands', () => {
    expect(classifyMove({ before: cp(20), after: cp(10) }).label).toBe('best');
    expect(classifyMove({ before: cp(20), after: cp(-20) }).label).toBe('good');
    expect(classifyMove({ before: cp(30), after: cp(-30) }).label).toBe('inaccuracy'); // ~0.11 chances
    expect(classifyMove({ before: cp(50), after: cp(-70) }).label).toBe('mistake'); // ~0.22
    expect(classifyMove({ before: cp(50), after: cp(-200) }).label).toBe('blunder');
  });

  it('a big cp loss in a completely won position is not a blunder (the reason for win-chance basis)', () => {
    const r = classifyMove({ before: cp(1500), after: cp(900) });
    expect(r.cpLoss).toBe(100); // clamped at 1000
    expect(r.label).not.toBe('blunder');
    expect(['best', 'good']).toContain(r.label);
  });

  it('cp basis uses the 50/100/300 bands', () => {
    const cpT: ClassificationThresholds = { ...T, basis: 'cpLoss' };
    expect(classifyMove({ before: cp(0), after: cp(-49) }, cpT).label).not.toMatch(/inaccuracy|mistake|blunder/);
    expect(classifyMove({ before: cp(0), after: cp(-50) }, cpT).label).toBe('inaccuracy');
    expect(classifyMove({ before: cp(0), after: cp(-150) }, cpT).label).toBe('mistake');
    expect(classifyMove({ before: cp(0), after: cp(-300) }, cpT).label).toBe('blunder');
  });

  it('engine best move is always best', () => {
    expect(classifyMove({ before: cp(0), after: cp(-500), playedIsBest: true }).label).toBe('best');
  });

  it('mate lost: label depends on what is left', () => {
    expect(classifyMove({ before: mate(3), after: cp(1200) })).toMatchObject({ label: 'inaccuracy', reason: 'mate_lost' });
    expect(classifyMove({ before: mate(3), after: cp(800) })).toMatchObject({ label: 'mistake', reason: 'mate_lost' });
    expect(classifyMove({ before: mate(3), after: cp(100) })).toMatchObject({ label: 'blunder', reason: 'mate_lost' });
    expect(classifyMove({ before: mate(3), after: mate(-4) })).toMatchObject({ label: 'blunder', reason: 'mate_lost' });
  });

  it('mate created against the mover', () => {
    expect(classifyMove({ before: cp(0), after: mate(-2) })).toMatchObject({ label: 'blunder', reason: 'mate_created' });
    expect(classifyMove({ before: cp(-800), after: mate(-6) })).toMatchObject({ label: 'mistake', reason: 'mate_created' });
    expect(classifyMove({ before: cp(-1500), after: mate(-6) })).toMatchObject({ label: 'inaccuracy', reason: 'mate_created' });
  });

  it('mate kept / delayed, already being mated, and mate delivered', () => {
    expect(classifyMove({ before: mate(3), after: mate(2) })).toMatchObject({ label: 'best', reason: 'mate_kept' });
    expect(classifyMove({ before: mate(3), after: mate(5) })).toMatchObject({ label: 'good', reason: 'mate_delayed' });
    expect(classifyMove({ before: mate(-3), after: mate(-1) })).toMatchObject({ label: 'good', reason: 'mate_delayed' });
    // the engine reports "mate 0" for the mated opponent; negated it stays mate 0 = mate delivered
    expect(classifyMove({ before: mate(1), after: negateScore(mate(0)) })).toMatchObject({ label: 'best', reason: 'mate_delivered' });
  });

  it('is deterministic and reports both loss measures', () => {
    const a = classifyMove({ before: cp(40), after: cp(-100) });
    expect(a).toEqual(classifyMove({ before: cp(40), after: cp(-100) }));
    expect(a.cpLoss).toBe(140);
    expect(a.winChanceLoss).toBeGreaterThan(0);
    expect(a.thresholdsVersion).toBe(T.version);
  });
});
