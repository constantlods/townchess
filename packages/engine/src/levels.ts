import type { SearchOptions } from './search.js';

export type AiLevel = 'novice' | 'patient' | 'warden';

/**
 * House-engine strength presets. Labels only: these are NOT calibrated ratings (no Elo is claimed until a
 * calibration run against rated engines exists; see docs/AI.md).
 */
export const AI_LEVELS: Record<AiLevel, SearchOptions & { label: string; description: string }> = {
  novice: { maxDepth: 2, timeMs: 400, noise: 60, label: 'Novice', description: 'Shallow search, often picks a weaker move' },
  patient: { maxDepth: 3, timeMs: 1200, noise: 25, label: 'Patient', description: 'Moderate search, occasional imprecision' },
  warden: { maxDepth: 5, timeMs: 2500, noise: 0, label: 'Warden', description: 'Deepest search, always its best move' },
};

export const isAiLevel = (v: string): v is AiLevel => v in AI_LEVELS;
