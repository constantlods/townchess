// Exports the wire protocol as JSON Schema plus golden example messages for non-TypeScript clients (UE5 C++).
// Run: npm run build:schema  →  docs/protocol/{client,server}-messages.schema.json and docs/protocol/examples/*.json
// Every example is produced by the real GameCore and validated against the schema before it is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ClientMessage, GameCore, PROTOCOL_VERSION, ServerMessageSchema, aiLevelsOffered, type GameStateDTO } from '../packages/shared/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/protocol');
fs.mkdirSync(path.join(out, 'examples'), { recursive: true });

const write = (name: string, data: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
write('client-messages.schema.json', { $comment: `TownChess protocol v${PROTOCOL_VERSION}`, ...z.toJSONSchema(ClientMessage) });
write('server-messages.schema.json', { $comment: `TownChess protocol v${PROTOCOL_VERSION}`, ...z.toJSONSchema(ServerMessageSchema) });

const human = { id: 'P-EXAMPLE01', username: 'PATIENT_07', rating: 1204, cosmetics: { hands: 'dirty', gloves: 'none', sleeves: 'jacket', accessories: 'strap' } } as const;
const engine = { id: 'ai:warden', username: 'UNKNOWN_13', rating: null, cosmetics: human.cosmetics, ai: { level: 'warden' } } as const;

function stateAfter(moves: string[], startFen?: string): GameStateDTO {
  const g = new GameCore({ timeControl: { initialMs: 300_000, incrementMs: 0 }, startFen, firstMoveMs: 30_000 });
  g.start(0);
  moves.forEach((m, i) => {
    const r = g.move(g.turn, { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] as never }, 1000 * (i + 1));
    if (!r.ok) throw new Error(`${m}: ${r.reason}`);
  });
  const s = g.snapshot(1000 * moves.length + 500);
  const epoch = Date.UTC(2026, 9, 3, 12, 0, 0);
  return {
    id: 'GAME-0A1B2C', white: human, black: engine, fen: s.fen, moveHistory: s.history, turn: s.turn,
    whiteClockMs: s.clocks!.w, blackClockMs: s.clocks!.b, clockSampledAt: epoch, clockRunning: s.status === 'active' ? s.running : null, status: s.status, winner: s.winner,
    rated: false, timeControl: { initialMs: 300_000, incrementMs: 0 }, drawOfferBy: s.drawOfferBy, rematchOfferBy: null,
    createdAt: epoch - 60_000, updatedAt: epoch, disconnected: [], termination: s.termination, drawPolicy: 'automatic',
    claimableDraw: s.claimableDraw, legalMoves: s.legalMoves,
    opening: s.opening && { eco: s.opening.eco, name: s.opening.name, family: s.opening.family, variation: s.opening.variation, subvariation: s.opening.subvariation, ply: s.opening.ply, transposed: s.opening.transposed },
    inBook: s.inBook, lastEvents: s.lastEvents, eventSeq: s.eventSeq, firstMoveDeadline: s.firstMoveDeadline === null ? null : epoch + 29_000,
  };
}

const examples: Record<string, unknown> = {
  'client-hello': { type: 'HELLO', username: 'PATIENT_07' },
  'client-create-ai-game': { type: 'CREATE_AI_GAME', level: 'warden', color: 'w', timeControl: '5+0' },
  'client-create-ai-game-league': { type: 'CREATE_AI_GAME', level: 'sf1600', color: 'b', timeControl: '10+5' },
  'client-move-promotion': { type: 'MOVE', gameId: 'GAME-0A1B2C', seq: 12, from: 'b7', to: 'a8', promotion: 'n', ply: 22 },
  'client-claim-draw-intended': { type: 'CLAIM_DRAW', gameId: 'GAME-0A1B2C', intended: { from: 'f6', to: 'g8' } },
  'server-welcome': { type: 'WELCOME', protocolVersion: PROTOCOL_VERSION, token: '<opaque-48-hex>', player: { ...human, gamesPlayed: 3, wins: 1, losses: 1, draws: 1 }, activeGameId: null, aiLevels: aiLevelsOffered(true) },
  'server-game-joined': { type: 'GAME_JOINED', color: 'w', state: stateAfter([]) },
  'server-state-castling': { type: 'GAME_STATE_UPDATED', reason: 'move', state: stateAfter(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1']) },
  'server-state-en-passant': { type: 'GAME_STATE_UPDATED', reason: 'move', state: stateAfter(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']) },
  'server-state-capture-promotion': { type: 'GAME_STATE_UPDATED', reason: 'move', state: stateAfter(['b7a8n'], 'r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1') },
  'server-state-checkmate': { type: 'GAME_STATE_UPDATED', reason: 'move', state: stateAfter(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']) },
  'server-move-rejected': { type: 'MOVE_REJECTED', seq: 3, gameId: 'GAME-0A1B2C', reason: 'promotion piece required', state: stateAfter([]) },
};
for (const [name, msg] of Object.entries(examples)) {
  const schema = name.startsWith('client-') ? ClientMessage : ServerMessageSchema;
  const r = schema.safeParse(msg);
  if (!r.success) throw new Error(`${name} does not match the schema: ${r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
  write(`examples/${name}.json`, msg);
}
console.log(`protocol v${PROTOCOL_VERSION}: 2 schemas, ${Object.keys(examples).length} validated examples -> docs/protocol/`);
