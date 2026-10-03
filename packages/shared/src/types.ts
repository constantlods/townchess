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
  | 'draw_repetition' // threefold (automatic policy, or claimed)
  | 'draw_fivefold' // FIDE 9.6.1, always automatic
  | 'draw_insufficient' // dead by material (5.2.2), or flag fell against a side that cannot mate (6.9)
  | 'draw_fifty' // fifty-move rule (automatic policy, or claimed)
  | 'draw_seventyfive' // FIDE 9.6.2, always automatic
  | 'resigned'
  | 'timeout'
  | 'abandoned'
  | 'aborted'; // no first move inside the first-move window: no result, never rated

export const isFinished = (s: GameStatus) => s !== 'waiting' && s !== 'active';

/** Why a game ended, precise enough for PGN [Termination] and for commentary. */
export type Termination =
  | 'checkmate' | 'stalemate' | 'insufficient_material' | 'threefold_repetition' | 'fivefold_repetition'
  | 'fifty_move' | 'seventy_five_move' | 'agreement' | 'resignation' | 'timeout' | 'timeout_vs_insufficient'
  | 'abandoned' | 'abandoned_vs_insufficient' | 'aborted';

/**
 * Physical consequences of a move, in the order they happen, so a presentation client can animate castling,
 * en passant and promotion without knowing any chess rules.
 */
export type MoveEffect =
  | { kind: 'capture'; square: Square; piece: PieceType; color: Color }
  | { kind: 'move'; piece: PieceType; color: Color; from: Square; to: Square }
  | { kind: 'promote'; square: Square; color: Color; from: 'p'; to: Promotion };

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
  /** Ordered physical effects (captures, every piece that moves, promotion swaps). */
  effects: MoveEffect[];
  /** Clock of the mover after the move (ms), as decided by the authority. */
  clockAfterMs?: number;
}

export interface PlayerPublic {
  id: string;
  username: string;
  /** Elo for humans. null for engine opponents: their strength labels are not calibrated ratings. */
  rating: number | null;
  cosmetics: Cosmetics;
  /** Present when this seat is played by the engine. */
  ai?: { level: string };
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
  termination: Termination | null;
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
  termination: Termination | null;
  drawPolicy: 'automatic' | 'claim';
  /** Draw the side to move may claim now (claim policy only). */
  claimableDraw: 'threefold' | 'fifty' | null;
  /** Legal moves for the side to move, UCI (e2e4, e7e8q). Empty when the game is not active. */
  legalMoves: string[];
  opening: OpeningSummary | null;
  /** Whether the current position is itself a named book position. */
  inBook: boolean;
  /** Deterministic events produced by the last event-bearing change (see events.ts). */
  lastEvents: GameEventDTO[];
  /** Increases whenever lastEvents changes. A client must act on lastEvents only when eventSeq is new to it. */
  eventSeq: number;
  /** Deadline (server epoch ms) for the side to move to make its first move, or null once both have moved. */
  firstMoveDeadline: number | null;
}

export interface OpeningSummary {
  eco: string;
  name: string;
  family: string;
  variation: string | null;
  subvariation: string | null;
  ply: number;
  transposed: boolean;
}

/** Wire form of a GameEvent (see events.ts). */
export interface GameEventDTO {
  type: string;
  ply: number;
  color: Color | null;
  san?: string;
  piece?: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  opening?: { eco: string; name: string; family: string; variation: string | null };
  balance?: number;
  swing?: number;
}
