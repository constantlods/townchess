import type { Color, GameStatus, MoveRecord, PlayerPublic, Promotion, Square, TimeControl } from '@hc/shared';

/** What the presentation layer knows about a game. Owned by the session (local engine or server). */
export interface SessionState {
  id: string;
  fen: string;
  turn: Color;
  history: MoveRecord[];
  status: GameStatus;
  winner: Color | null;
  white: PlayerPublic | null;
  black: PlayerPublic | null;
  timeControl: TimeControl;
  /** Display clocks at `sampledAt` (performance.now() timebase on the client). */
  clocks: Record<Color, number>;
  sampledAt: number;
  running: Color | null;
  drawOfferBy: Color | null;
  rematchOfferBy: Color | null;
  rated: boolean;
  opponentDisconnected: boolean;
}

export type SessionEvent =
  | { type: 'state'; state: SessionState; reason: string }
  | { type: 'move'; move: MoveRecord; state: SessionState; mine: boolean }
  | { type: 'rejected'; reason: string; state: SessionState }
  | { type: 'drawOffer'; by: Color }
  | { type: 'rematchOffer'; by: Color }
  | { type: 'opponentThinking'; thinking: boolean }
  | { type: 'notice'; text: string }
  | { type: 'newGame'; state: SessionState; color: Color };

export interface Session {
  readonly kind: 'local' | 'network';
  readonly color: Color;
  readonly state: SessionState;
  on(fn: (e: SessionEvent) => void): () => void;
  submitMove(from: Square, to: Square, promotion?: Promotion): void;
  offerDraw(): void;
  acceptDraw(): void;
  declineDraw(): void;
  resign(): void;
  rematch(): void;
  /** Called every frame (local clock / flag fall). */
  tick(now: number): void;
  dispose(): void;
}

export function clockAt(s: SessionState, c: Color, now: number): number {
  if (s.running !== c) return s.clocks[c];
  return Math.max(0, s.clocks[c] - (now - s.sampledAt));
}
