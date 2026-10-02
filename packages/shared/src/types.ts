/** Shared domain types for Horror Chess. Used by client and server. */
export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = string; // 'a1'..'h8'
export type Promotion = 'q' | 'r' | 'b' | 'n';

export interface TimeControl {
  /** Initial time per side in milliseconds. */
  initialMs: number;
  /** Increment per move in milliseconds. */
  incrementMs: number;
}

export const TIME_CONTROLS: Record<string, TimeControl> = {
  '1+0': { initialMs: 60_000, incrementMs: 0 },
  '3+2': { initialMs: 180_000, incrementMs: 2_000 },
  '5+0': { initialMs: 300_000, incrementMs: 0 },
  '10+0': { initialMs: 600_000, incrementMs: 0 },
  '15+10': { initialMs: 900_000, incrementMs: 10_000 },
};

export type GameStatus =
  | 'waiting'
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'draw_agreed'
  | 'draw_repetition'
  | 'draw_insufficient'
  | 'draw_fifty'
  | 'resigned'
  | 'timeout'
  | 'abandoned';

export const isFinished = (s: GameStatus) => s !== 'waiting' && s !== 'active';

export interface MoveRecord {
  from: Square;
  to: Square;
  promotion?: Promotion;
  san: string;
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  /** chess.js flags: 'k'/'q' castle, 'e' en passant, 'c' capture, 'p' promotion, 'b' double push */
  flags: string;
  fenAfter: string;
  /** Clock of the mover after the move (ms), as decided by the authority. */
  clockAfterMs?: number;
}

export interface PlayerPublic {
  id: string;
  username: string;
  rating: number;
  cosmetics: Cosmetics;
}

export interface Cosmetics {
  hands: 'bare' | 'dirty' | 'scarred' | 'tattooed';
  gloves: 'none' | 'leather' | 'worn';
  sleeves: 'none' | 'institutional' | 'jacket' | 'rolled';
  accessories: 'none' | 'watch' | 'strap' | 'bandage';
}

export const DEFAULT_COSMETICS: Cosmetics = {
  hands: 'dirty',
  gloves: 'none',
  sleeves: 'jacket',
  accessories: 'strap',
};

export interface GameResult {
  status: GameStatus;
  /** Winner colour, or null for a draw / abandoned without winner. */
  winner: Color | null;
}

/** The authoritative, serialisable game state that the server broadcasts. */
export interface GameStateDTO {
  id: string;
  white: PlayerPublic | null;
  black: PlayerPublic | null;
  fen: string;
  moveHistory: MoveRecord[];
  turn: Color;
  whiteClockMs: number;
  blackClockMs: number;
  /** Server timestamp (ms) at which the clocks above were sampled. */
  clockSampledAt: number;
  status: GameStatus;
  winner: Color | null;
  rated: boolean;
  timeControl: TimeControl;
  drawOfferBy: Color | null;
  rematchOfferBy: Color | null;
  createdAt: number;
  updatedAt: number;
  /** Colours whose player is currently disconnected (grace period running). */
  disconnected: Color[];
}
