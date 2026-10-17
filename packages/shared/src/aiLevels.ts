/**
 * Engine opponent level ids shared by the protocol, the core and every client. Pure data (browser-safe).
 *
 * Two families:
 *  - house levels (novice / patient / warden): the TownChess house engine (@hc/engine). Labels only; no Elo is
 *    claimed for them (docs/AI.md).
 *  - league levels (sf*): Stockfish, or any UCI engine with UCI_LimitStrength / UCI_Elo, run by the core as a separate
 *    OS process over UCI (never linked or bundled into JS: GPL-3.0, see packages/server/src/uciEngine.ts). Those levels
 *    are labelled by the engine's own UCI_Elo setting, which is Stockfish's calibrated scale, not a TownChess claim.
 *    They exist only when the core has found an engine binary; the core lists what it offers in WELCOME.aiLevels.
 */
export const HOUSE_LEVEL_IDS = ['novice', 'patient', 'warden'] as const;
export type HouseLevelId = (typeof HOUSE_LEVEL_IDS)[number];

export interface LeagueLevel {
  /** UCI_Elo with UCI_LimitStrength=true, or null for full strength. */
  uciElo: number | null;
  /** Upper bound on thinking time per move (ms); lowered further by the remaining clock in timed games. */
  movetimeMs: number;
  label: string;
}

/** Stockfish ladder. UCI_Elo values sit inside Stockfish's supported range (1320..3190 in Stockfish 16 to 19). */
export const LEAGUE_LEVELS = {
  sf1350: { uciElo: 1350, movetimeMs: 600, label: 'Stockfish (UCI_Elo 1350)' },
  sf1600: { uciElo: 1600, movetimeMs: 700, label: 'Stockfish (UCI_Elo 1600)' },
  sf1900: { uciElo: 1900, movetimeMs: 800, label: 'Stockfish (UCI_Elo 1900)' },
  sf2200: { uciElo: 2200, movetimeMs: 1000, label: 'Stockfish (UCI_Elo 2200)' },
  sf2500: { uciElo: 2500, movetimeMs: 1200, label: 'Stockfish (UCI_Elo 2500)' },
  sfmax: { uciElo: null, movetimeMs: 1500, label: 'Stockfish (full strength)' },
} as const satisfies Record<string, LeagueLevel>;
export type LeagueLevelId = keyof typeof LEAGUE_LEVELS;
export const LEAGUE_LEVEL_IDS = Object.keys(LEAGUE_LEVELS) as LeagueLevelId[];

export type AiLevelId = HouseLevelId | LeagueLevelId;
/** Every level id the protocol accepts (whether a given core can play it is announced in WELCOME.aiLevels). */
export const AI_LEVEL_IDS = [...HOUSE_LEVEL_IDS, ...LEAGUE_LEVEL_IDS] as [AiLevelId, ...AiLevelId[]];

export const isLeagueLevel = (v: string): v is LeagueLevelId => Object.hasOwn(LEAGUE_LEVELS, v);
export const isHouseLevel = (v: string): v is HouseLevelId => (HOUSE_LEVEL_IDS as readonly string[]).includes(v);

/** One entry of WELCOME.aiLevels. */
export interface AiLevelInfo {
  id: AiLevelId;
  label: string;
  engine: 'house' | 'uci';
  /** The UCI_Elo the engine is set to (league levels with limited strength), else null. Never set for house levels. */
  uciElo: number | null;
}

const HOUSE_LABELS: Record<HouseLevelId, string> = { novice: 'Novice', patient: 'Patient', warden: 'Warden' };

/** The levels a core offers: always the house levels, plus the league ladder when a UCI engine is available. */
export function aiLevelsOffered(uciAvailable: boolean): AiLevelInfo[] {
  const house = HOUSE_LEVEL_IDS.map((id): AiLevelInfo => ({ id, label: HOUSE_LABELS[id], engine: 'house', uciElo: null }));
  if (!uciAvailable) return house;
  return [...house, ...LEAGUE_LEVEL_IDS.map((id): AiLevelInfo => ({ id, label: LEAGUE_LEVELS[id].label, engine: 'uci', uciElo: LEAGUE_LEVELS[id].uciElo }))];
}

/**
 * Thinking-time budget for one engine move so a timed game never flags: about 1/30 of the remaining clock plus most
 * of the increment, capped by the level's own budget and floored at 50 ms. `overheadMs` (process round trip,
 * minimum display delay) is reserved first. `remainingMs` null = untimed.
 */
export function moveBudgetMs(levelMs: number, remainingMs: number | null, incrementMs = 0, overheadMs = 0): number {
  if (remainingMs === null) return levelMs;
  const usable = Math.max(0, remainingMs - overheadMs);
  return Math.max(50, Math.min(levelMs, Math.floor(usable / 30 + incrementMs * 0.75)));
}
