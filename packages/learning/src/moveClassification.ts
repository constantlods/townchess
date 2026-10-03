import type { Score } from './engineService.js';

/**
 * Move classification: inaccuracy / mistake / blunder from two engine evaluations.
 *
 * PROVISIONAL. Every threshold below is data, not code, and is a starting point taken from public practice
 * (Lichess's winning-chances judgement and its mate rules; the classic 50/100/300 centipawn bands). They are NOT
 * validated for TownChess. Before any player-facing label ships (Milestone 5), they must be checked against a
 * labelled set of games (human-annotated ?!, ?, ?? moves) and the agreement reported. Changing a threshold is a data
 * change with its own version string, so stored classifications can always be traced to the table that produced
 * them.
 *
 * Engines calculate, agents explain: this function only turns numbers into a label. It never decides legality and
 * never writes commentary.
 */

export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface ClassificationThresholds {
  /** Bump on any change; stored with every classification. */
  version: string;
  status: 'provisional' | 'validated';
  /** Which measure decides the label for non-mate evaluations. */
  basis: 'winChance' | 'cpLoss';
  /**
   * Logistic slope converting centipawns to winning chances: chances = 2 / (1 + exp(-k * cp)) - 1, in [-1, 1].
   * 0.00368208 is Lichess's published fit to its game database (not to TownChess games).
   */
  winChanceSlope: number;
  /** Loss of winning chances (on the [-1, 1] scale) at which each label starts. */
  winChanceLoss: { inaccuracy: number; mistake: number; blunder: number };
  /** Centipawn loss at which each label starts (used when basis = 'cpLoss', always reported). */
  cpLoss: { inaccuracy: number; mistake: number; blunder: number };
  /** Evaluations are clamped to +/- this before computing cp loss (a 2000 vs 1500 "loss" is meaningless). */
  cpClamp: number;
  /**
   * Mate handling (Lichess's rules):
   * - mateLost: the mover had a forced mate and the move gives it up. The label depends on how winning the position
   *   still is: above `inaccuracyAboveCp` → inaccuracy, above `mistakeAboveCp` → mistake, otherwise blunder.
   * - mateCreated: the move allows a forced mate against the mover. Symmetric: if the mover was already losing by
   *   more than `inaccuracyBelowCp` → inaccuracy, more than `mistakeBelowCp` → mistake, otherwise blunder.
   * - a slower mate (mate delayed) or a mate against a side already being mated is never labelled.
   */
  mateLost: { inaccuracyAboveCp: number; mistakeAboveCp: number };
  mateCreated: { inaccuracyBelowCp: number; mistakeBelowCp: number };
  /** Below this win-chance loss (and not the engine's best move) the move is 'good' rather than 'best'. */
  bestTolerance: number;
}

export const PROVISIONAL_THRESHOLDS: ClassificationThresholds = Object.freeze({
  version: 'provisional-2026-10-03',
  status: 'provisional',
  basis: 'winChance',
  winChanceSlope: 0.00368208,
  winChanceLoss: Object.freeze({ inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 }),
  cpLoss: Object.freeze({ inaccuracy: 50, mistake: 100, blunder: 300 }),
  cpClamp: 1000,
  mateLost: Object.freeze({ inaccuracyAboveCp: 999, mistakeAboveCp: 700 }),
  mateCreated: Object.freeze({ inaccuracyBelowCp: -999, mistakeBelowCp: -700 }),
  bestTolerance: 0.02,
}) as ClassificationThresholds;

/** Winning chances in [-1, 1] for the side whose point of view `score` is in. Mates are +/-1. */
export function winningChances(score: Score, t: ClassificationThresholds = PROVISIONAL_THRESHOLDS): number {
  if (score.kind === 'mate') return score.value > 0 ? 1 : -1; // mate 0: the side is mated
  return 2 / (1 + Math.exp(-t.winChanceSlope * score.value)) - 1;
}

/** Win probability in [0, 1] (expected score, draws counted as half), for graphs and the analysis cart. */
export const winProbability = (score: Score, t: ClassificationThresholds = PROVISIONAL_THRESHOLDS) =>
  (winningChances(score, t) + 1) / 2;

/** Centipawns for cp arithmetic: mates become +/- cpClamp. */
export function clampedCp(score: Score, t: ClassificationThresholds = PROVISIONAL_THRESHOLDS): number {
  if (score.kind === 'mate') return score.value > 0 ? t.cpClamp : -t.cpClamp;
  return Math.max(-t.cpClamp, Math.min(t.cpClamp, score.value));
}

export interface ClassificationInput {
  /** Evaluation of the position before the move (the engine's best line), from the MOVER's point of view. */
  before: Score;
  /**
   * Evaluation after the played move, from the MOVER's point of view: negate the engine's opponent-to-move score with
   * `negateScore`. After a checkmating move the engine reports `mate 0` for the mated opponent; negated it stays
   * `mate 0`, and because a side can never be checkmated by its own move, `after = mate 0` is read as "the mover
   * delivered mate" (label 'best').
   */
  after: Score;
  /** True when the played move is the engine's best move (it is then 'best' whatever the noise in `after`). */
  playedIsBest?: boolean;
}

export interface Classification {
  label: MoveClass;
  /** Which rule decided it. */
  reason: 'engine_best' | 'mate_delivered' | 'win_chance_loss' | 'cp_loss' | 'mate_lost' | 'mate_created' | 'mate_kept' | 'mate_delayed' | 'within_tolerance';
  cpLoss: number;
  winChanceLoss: number;
  thresholdsVersion: string;
  provisional: boolean;
}

function band(loss: number, b: { inaccuracy: number; mistake: number; blunder: number }): MoveClass | null {
  if (loss >= b.blunder) return 'blunder';
  if (loss >= b.mistake) return 'mistake';
  if (loss >= b.inaccuracy) return 'inaccuracy';
  return null;
}

/** Classify one move. Pure and deterministic. */
export function classifyMove(i: ClassificationInput, t: ClassificationThresholds = PROVISIONAL_THRESHOLDS): Classification {
  const cpLoss = Math.max(0, clampedCp(i.before, t) - clampedCp(i.after, t));
  const winChanceLoss = Math.max(0, winningChances(i.before, t) - winningChances(i.after, t));
  const base = { cpLoss, winChanceLoss, thresholdsVersion: t.version, provisional: t.status !== 'validated' };
  if (i.after.kind === 'mate' && i.after.value === 0) return { ...base, cpLoss: 0, winChanceLoss: 0, label: 'best', reason: 'mate_delivered' };
  if (i.playedIsBest) return { ...base, label: 'best', reason: 'engine_best' };

  const hadMate = i.before.kind === 'mate' && i.before.value > 0;
  const facesMate = i.after.kind === 'mate' && i.after.value < 0;
  const stillMates = i.after.kind === 'mate' && i.after.value > 0;
  const wasBeingMated = i.before.kind === 'mate' && i.before.value <= 0;

  if (hadMate && !stillMates) {
    const cp = i.after.kind === 'cp' ? i.after.value : -Infinity; // mate -> mated: worst case
    const label: MoveClass = cp > t.mateLost.inaccuracyAboveCp ? 'inaccuracy' : cp > t.mateLost.mistakeAboveCp ? 'mistake' : 'blunder';
    return { ...base, label, reason: 'mate_lost' };
  }
  // mate in N before; the shortest continuation leaves mate in N-1. Anything slower is "delayed", never an error.
  if (hadMate && stillMates) return { ...base, ...(i.after.value < i.before.value ? { label: 'best' as const, reason: 'mate_kept' as const } : { label: 'good' as const, reason: 'mate_delayed' as const }) };
  if (facesMate && !wasBeingMated) {
    const cp = i.before.kind === 'cp' ? i.before.value : Infinity;
    const label: MoveClass = cp < t.mateCreated.inaccuracyBelowCp ? 'inaccuracy' : cp < t.mateCreated.mistakeBelowCp ? 'mistake' : 'blunder';
    return { ...base, label, reason: 'mate_created' };
  }
  if (wasBeingMated) return { ...base, label: 'good', reason: 'mate_delayed' };

  const label = t.basis === 'winChance' ? band(winChanceLoss, t.winChanceLoss) : band(cpLoss, t.cpLoss);
  if (label) return { ...base, label, reason: t.basis === 'winChance' ? 'win_chance_loss' : 'cp_loss' };
  return { ...base, label: winChanceLoss <= t.bestTolerance ? 'best' : 'good', reason: 'within_tolerance' };
}

/** Negate a score (switch point of view). Mate 0 stays 0. */
export const negateScore = (s: Score): Score => ({ kind: s.kind, value: s.value === 0 ? 0 : -s.value });
