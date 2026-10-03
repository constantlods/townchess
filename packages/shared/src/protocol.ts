import { z } from 'zod';
import type { GameStateDTO } from './types.js';

/**
 * WebSocket protocol. Every message is JSON `{ type, ...payload }`.
 * Client messages are validated with zod on the server; nothing the client says is trusted
 * beyond "this connection (authenticated by token) asks to do X".
 */

/**
 * v2 (2026-10): AI games hosted by the core, draw claims, legal moves / opening / events / effects / termination in
 * state, runtime schemas for server messages (exported as JSON Schema for the UE client: npm run build:schema).
 */
export const PROTOCOL_VERSION = 2;

const square = z.string().regex(/^[a-h][1-8]$/);
const promotion = z.enum(['q', 'r', 'b', 'n']);
const color = z.enum(['w', 'b']);
const cosmetics = z.object({
  hands: z.enum(['bare', 'dirty', 'scarred', 'tattooed']),
  gloves: z.enum(['none', 'leather', 'worn']),
  sleeves: z.enum(['none', 'institutional', 'jacket', 'rolled']),
  accessories: z.enum(['none', 'watch', 'strap', 'bandage']),
});

export const ClientMessage = z.discriminatedUnion('type', [
  /** First message on every connection. `token` resumes an existing identity (reconnect). */
  z.object({
    type: z.literal('HELLO'),
    token: z.string().max(128).optional(),
    username: z.string().min(2).max(20).regex(/^[A-Za-z0-9_]+$/).optional(),
    cosmetics: cosmetics.optional(),
  }),
  z.object({ type: z.literal('FIND_MATCH'), timeControl: z.string().max(10), rated: z.boolean() }),
  z.object({ type: z.literal('CANCEL_MATCH') }),
  z.object({ type: z.literal('CREATE_PRIVATE'), timeControl: z.string().max(10), drawPolicy: z.enum(['automatic', 'claim']).optional() }),
  /** Play the house engine through the core (offline UE play uses a local core the same way). Never rated. */
  z.object({
    type: z.literal('CREATE_AI_GAME'),
    level: z.enum(['novice', 'patient', 'warden']),
    color: z.enum(['w', 'b', 'random']),
    /** A key of TIME_CONTROLS, or 'untimed'. */
    timeControl: z.string().max(10),
    /** Threefold/fifty handling (see docs/CHESS.md). Default 'automatic'. */
    drawPolicy: z.enum(['automatic', 'claim']).optional(),
  }),
  z.object({ type: z.literal('JOIN_GAME'), gameId: z.string().regex(/^GAME-[0-9A-F]{6}$/) }),
  z.object({ type: z.literal('LEAVE_GAME'), gameId: z.string() }),
  z.object({
    type: z.literal('MOVE'),
    gameId: z.string(),
    /** Client-side sequence number so the client can match MOVE_ACCEPTED/REJECTED. */
    seq: z.number().int().nonnegative(),
    from: square,
    to: square,
    promotion: promotion.optional(),
    /** Ply index the client believes it is moving at; stale moves are rejected. */
    ply: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('DRAW_OFFER'), gameId: z.string() }),
  z.object({ type: z.literal('DRAW_ACCEPT'), gameId: z.string() }),
  z.object({ type: z.literal('DRAW_DECLINE'), gameId: z.string() }),
  z.object({ type: z.literal('RESIGN'), gameId: z.string() }),
  /** Claim threefold/fifty (claim policy only), optionally with the move that would produce it (FIDE 9.2.1.1). */
  z.object({
    type: z.literal('CLAIM_DRAW'),
    gameId: z.string(),
    intended: z.object({ from: square, to: square, promotion: promotion.optional() }).optional(),
  }),
  z.object({ type: z.literal('REMATCH'), gameId: z.string() }),
  z.object({ type: z.literal('SET_COSMETICS'), cosmetics }),
  z.object({ type: z.literal('PING'), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ── Server → client. Runtime schemas so outgoing messages can be validated in tests and exported as JSON Schema. ──
const pieceType = z.enum(['p', 'n', 'b', 'r', 'q', 'k']);
const cosmeticsOut = cosmetics;
export const PlayerPublicSchema = z.object({
  id: z.string(), username: z.string(), rating: z.number().nullable(), cosmetics: cosmeticsOut,
  ai: z.object({ level: z.string() }).optional(),
});
export const MoveEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capture'), square, piece: pieceType, color }),
  z.object({ kind: z.literal('move'), piece: pieceType, color, from: square, to: square }),
  z.object({ kind: z.literal('promote'), square, color, from: z.literal('p'), to: promotion }),
]);
export const MoveRecordSchema = z.object({
  from: square, to: square, promotion: promotion.optional(), san: z.string(), color, piece: pieceType,
  captured: pieceType.optional(), flags: z.string(), fenAfter: z.string(), effects: z.array(MoveEffectSchema),
  clockAfterMs: z.number().optional(),
});
export const GameEventSchema = z.object({
  type: z.string(), ply: z.number().int(), color: color.nullable(), san: z.string().optional(),
  piece: pieceType.optional(), captured: pieceType.optional(), promotion: pieceType.optional(),
  opening: z.object({ eco: z.string(), name: z.string(), family: z.string(), variation: z.string().nullable() }).optional(),
  balance: z.number().optional(), swing: z.number().optional(),
});
export const GameStateSchema = z.object({
  id: z.string(),
  white: PlayerPublicSchema.nullable(),
  black: PlayerPublicSchema.nullable(),
  fen: z.string(),
  moveHistory: z.array(MoveRecordSchema),
  turn: color,
  whiteClockMs: z.number(),
  blackClockMs: z.number(),
  clockSampledAt: z.number(),
  clockRunning: color.nullable(),
  status: z.enum(['waiting', 'active', 'checkmate', 'stalemate', 'draw_agreed', 'draw_repetition', 'draw_fivefold', 'draw_insufficient', 'draw_fifty', 'draw_seventyfive', 'resigned', 'timeout', 'abandoned', 'aborted']),
  winner: color.nullable(),
  rated: z.boolean(),
  timeControl: z.object({ initialMs: z.number(), incrementMs: z.number() }),
  drawOfferBy: color.nullable(),
  rematchOfferBy: color.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  disconnected: z.array(color),
  termination: z.enum(['checkmate', 'stalemate', 'insufficient_material', 'threefold_repetition', 'fivefold_repetition', 'fifty_move', 'seventy_five_move', 'agreement', 'resignation', 'timeout', 'timeout_vs_insufficient', 'abandoned', 'abandoned_vs_insufficient', 'aborted']).nullable(),
  drawPolicy: z.enum(['automatic', 'claim']),
  claimableDraw: z.enum(['threefold', 'fifty']).nullable(),
  legalMoves: z.array(z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/)),
  opening: z.object({ eco: z.string(), name: z.string(), family: z.string(), variation: z.string().nullable(), subvariation: z.string().nullable(), ply: z.number().int(), transposed: z.boolean() }).nullable(),
  inBook: z.boolean(),
  lastEvents: z.array(GameEventSchema),
  eventSeq: z.number().int().nonnegative(),
  firstMoveDeadline: z.number().nullable(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WELCOME'), protocolVersion: z.number().int(), token: z.string(), player: PlayerPublicSchema.extend({ gamesPlayed: z.number(), wins: z.number(), losses: z.number(), draws: z.number() }), activeGameId: z.string().nullable() }),
  z.object({ type: z.literal('QUEUED'), timeControl: z.string(), rated: z.boolean() }),
  z.object({ type: z.literal('MATCH_CANCELLED') }),
  z.object({ type: z.literal('GAME_JOINED'), color, state: GameStateSchema }),
  z.object({ type: z.literal('GAME_STATE_UPDATED'), state: GameStateSchema, reason: z.string() }),
  z.object({ type: z.literal('MOVE_ACCEPTED'), seq: z.number().int(), gameId: z.string() }),
  z.object({ type: z.literal('MOVE_REJECTED'), seq: z.number().int(), gameId: z.string(), reason: z.string(), state: GameStateSchema }),
  z.object({ type: z.literal('CLOCK_UPDATE'), gameId: z.string(), whiteClockMs: z.number(), blackClockMs: z.number(), sampledAt: z.number(), turn: color }),
  z.object({ type: z.literal('DRAW_OFFER'), gameId: z.string(), by: color }),
  z.object({ type: z.literal('REMATCH'), gameId: z.string(), by: color }),
  z.object({ type: z.literal('OPPONENT_DISCONNECTED'), gameId: z.string(), graceMs: z.number() }),
  z.object({ type: z.literal('OPPONENT_RECONNECTED'), gameId: z.string() }),
  z.object({ type: z.literal('ERROR'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('PONG'), t: z.number(), serverTime: z.number() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'invalid json' };
  }
  const res = ClientMessage.safeParse(data);
  if (!res.success) return { error: res.error.issues.map((i) => i.message).join('; ').slice(0, 200) };
  return res.data;
}

// Compile-time guard: the wire schema and the TypeScript DTO must describe the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _stateSchemaMatchesDto: Same<z.infer<typeof GameStateSchema>, GameStateDTO> = true;
void _stateSchemaMatchesDto;
