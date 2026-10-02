import { z } from 'zod';

/**
 * WebSocket protocol. Every message is JSON `{ type, ...payload }`.
 * Client messages are validated with zod on the server; nothing the client says is trusted
 * beyond "this connection (authenticated by token) asks to do X".
 */

const square = z.string().regex(/^[a-h][1-8]$/);
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
  z.object({ type: z.literal('CREATE_PRIVATE'), timeControl: z.string().max(10) }),
  z.object({ type: z.literal('JOIN_GAME'), gameId: z.string().regex(/^GAME-[0-9A-F]{6}$/) }),
  z.object({ type: z.literal('LEAVE_GAME'), gameId: z.string() }),
  z.object({
    type: z.literal('MOVE'),
    gameId: z.string(),
    /** Client-side sequence number so the client can match MOVE_ACCEPTED/REJECTED. */
    seq: z.number().int().nonnegative(),
    from: square,
    to: square,
    promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
    /** Ply index the client believes it is moving at; stale moves are rejected. */
    ply: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('DRAW_OFFER'), gameId: z.string() }),
  z.object({ type: z.literal('DRAW_ACCEPT'), gameId: z.string() }),
  z.object({ type: z.literal('DRAW_DECLINE'), gameId: z.string() }),
  z.object({ type: z.literal('RESIGN'), gameId: z.string() }),
  z.object({ type: z.literal('REMATCH'), gameId: z.string() }),
  z.object({ type: z.literal('SET_COSMETICS'), cosmetics }),
  z.object({ type: z.literal('PING'), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

import type { GameStateDTO, PlayerPublic, Color } from './types.js';

export type ServerMessage =
  | { type: 'WELCOME'; token: string; player: PlayerPublic & { gamesPlayed: number; wins: number; losses: number; draws: number }; activeGameId: string | null }
  | { type: 'QUEUED'; timeControl: string; rated: boolean }
  | { type: 'MATCH_CANCELLED' }
  | { type: 'GAME_JOINED'; color: Color; state: GameStateDTO }
  | { type: 'GAME_STATE_UPDATED'; state: GameStateDTO; reason: string }
  | { type: 'MOVE_ACCEPTED'; seq: number; gameId: string }
  | { type: 'MOVE_REJECTED'; seq: number; gameId: string; reason: string; state: GameStateDTO }
  | { type: 'CLOCK_UPDATE'; gameId: string; whiteClockMs: number; blackClockMs: number; sampledAt: number; turn: Color }
  | { type: 'DRAW_OFFER'; gameId: string; by: Color }
  | { type: 'REMATCH'; gameId: string; by: Color }
  | { type: 'OPPONENT_DISCONNECTED'; gameId: string; graceMs: number }
  | { type: 'OPPONENT_RECONNECTED'; gameId: string }
  | { type: 'ERROR'; code: string; message: string }
  | { type: 'PONG'; t: number; serverTime: number };

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
