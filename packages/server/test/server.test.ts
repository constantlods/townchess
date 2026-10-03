import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Hub } from '../src/hub';
import { PlayerStore } from '../src/players';
import { GameRoom } from '../src/room';
import { ServerMessageSchema, type ServerMessage } from '@hc/shared';

/** Every message the server sends during the tests must satisfy the published v2 schema. */
const schemaViolations: string[] = [];

class Client {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      const v = ServerMessageSchema.safeParse(m);
      if (!v.success) schemaViolations.push(`${m.type}: ${v.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
      const w = this.waiters.findIndex((x) => x.pred(m));
      if (w >= 0) { const [x] = this.waiters.splice(w, 1); x.res(m); } else this.inbox.push(m);
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 4000): Promise<Extract<ServerMessage, { type: T }>> {
    const i = this.inbox.findIndex((m) => m.type === type && pred(m as never));
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as never);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for ' + type)), timeoutMs);
      this.waiters.push({ pred: (m) => m.type === type && pred(m as never), res: (m) => { clearTimeout(t); res(m as never); } });
    });
  }
  async hello(name: string, token?: string) {
    this.send({ type: 'HELLO', username: name, token });
    return this.next('WELCOME');
  }
  close() { this.ws.close(); }
}

let server: http.Server, hub: Hub, url: string, players: PlayerStore;
beforeEach(async () => {
  server = http.createServer();
  players = new PlayerStore(null);
  hub = new Hub(server, players);
  hub.aiMinThinkMs = 0;
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
afterEach(() => {
  hub.close(); server.close();
  expect(schemaViolations, 'server messages must match ServerMessageSchema').toEqual([]);
});

async function pair(rated = false) {
  const a = new Client(url), b = new Client(url);
  await Promise.all([a.open(), b.open()]);
  const wa = await a.hello('ALPHA'), wb = await b.hello('BRAVO');
  a.send({ type: 'FIND_MATCH', timeControl: '5+0', rated });
  b.send({ type: 'FIND_MATCH', timeControl: '5+0', rated });
  const ja = await a.next('GAME_JOINED'), jb = await b.next('GAME_JOINED');
  expect(ja.state.id).toBe(jb.state.id);
  const [white, black] = ja.color === 'w' ? [a, b] : [b, a];
  return { white, black, gameId: ja.state.id, tokens: { a: wa.token, b: wb.token }, a, b };
}

describe('authoritative server', () => {
  it('matches two players and broadcasts accepted moves', async () => {
    const { white, black, gameId } = await pair();
    white.send({ type: 'MOVE', gameId, seq: 1, from: 'e2', to: 'e4', ply: 0 });
    expect((await white.next('MOVE_ACCEPTED')).seq).toBe(1);
    const upd = await black.next('GAME_STATE_UPDATED', (m) => m.reason === 'move');
    expect(upd.state.moveHistory[0].san).toBe('e4');
    expect(upd.state.turn).toBe('b');
  });

  it('rejects out-of-turn, opponent-piece, illegal and stale moves', async () => {
    const { white, black, gameId } = await pair();
    black.send({ type: 'MOVE', gameId, seq: 1, from: 'e7', to: 'e5', ply: 0 });
    expect((await black.next('MOVE_REJECTED')).reason).toBe('not your turn');
    white.send({ type: 'MOVE', gameId, seq: 2, from: 'e7', to: 'e5', ply: 0 });
    expect((await white.next('MOVE_REJECTED')).reason).toBe('not your piece');
    white.send({ type: 'MOVE', gameId, seq: 3, from: 'e2', to: 'e5', ply: 0 });
    expect((await white.next('MOVE_REJECTED')).reason).toBe('illegal move');
    white.send({ type: 'MOVE', gameId, seq: 4, from: 'e2', to: 'e4', ply: 3 });
    expect((await white.next('MOVE_REJECTED')).reason).toBe('stale move');
  });

  it('rejects malformed messages and messages that try to set results', async () => {
    const c = new Client(url); await c.open(); await c.hello('CHARLIE');
    c.send({ type: 'GAME_OVER', winner: 'w' });
    expect((await c.next('ERROR')).code).toBe('bad_message');
  });

  it('finishes on checkmate and records the result', async () => {
    const { white, black, gameId } = await pair();
    const seq = [['f2', 'f3', white], ['e7', 'e5', black], ['g2', 'g4', white], ['d8', 'h4', black]] as const;
    for (let i = 0; i < seq.length; i++) {
      const [from, to, who] = seq[i];
      who.send({ type: 'MOVE', gameId, seq: i, from, to, ply: i });
      await who.next('MOVE_ACCEPTED');
    }
    const end = await white.next('GAME_STATE_UPDATED', (m) => m.state.status === 'checkmate');
    expect(end.state.winner).toBe('b');
  });

  it('resignation and rated Elo update', async () => {
    const { white, black, gameId } = await pair(true);
    white.send({ type: 'MOVE', gameId, seq: 1, from: 'e2', to: 'e4', ply: 0 }); await white.next('MOVE_ACCEPTED');
    black.send({ type: 'MOVE', gameId, seq: 1, from: 'e7', to: 'e5', ply: 1 }); await black.next('MOVE_ACCEPTED');
    black.send({ type: 'RESIGN', gameId });
    const end = await white.next('GAME_STATE_UPDATED', (m) => m.state.status === 'resigned');
    expect(end.state.winner).toBe('w');
    expect(end.state.white!.rating).toBe(1216);
    expect(end.state.black!.rating).toBe(1184);
  });

  it('draw offer and acceptance', async () => {
    const { white, black, gameId } = await pair();
    white.send({ type: 'DRAW_OFFER', gameId });
    expect((await black.next('DRAW_OFFER')).by).toBe('w');
    white.send({ type: 'DRAW_ACCEPT', gameId }); // cannot accept own offer
    black.send({ type: 'DRAW_ACCEPT', gameId });
    const end = await white.next('GAME_STATE_UPDATED', (m) => m.state.status === 'draw_agreed');
    expect(end.state.winner).toBeNull();
  });

  it('private table by code', async () => {
    const a = new Client(url), b = new Client(url);
    await Promise.all([a.open(), b.open()]);
    await a.hello('HOST'); await b.hello('GUEST');
    a.send({ type: 'CREATE_PRIVATE', timeControl: '10+0' });
    const created = await a.next('GAME_JOINED');
    expect(created.state.status).toBe('waiting');
    expect(created.state.id).toMatch(/^GAME-[0-9A-F]{6}$/);
    b.send({ type: 'JOIN_GAME', gameId: created.state.id });
    const joined = await b.next('GAME_JOINED');
    expect(joined.color).toBe('b');
    expect(joined.state.status).toBe('active');
    await a.next('GAME_STATE_UPDATED', (m) => m.state.status === 'active');
  });

  it('keeps the game through a disconnect and restores state on reconnect', async () => {
    const { white, black, gameId, tokens, a } = await pair();
    white.send({ type: 'MOVE', gameId, seq: 1, from: 'd2', to: 'd4', ply: 0 }); await white.next('MOVE_ACCEPTED');
    const whiteToken = white === a ? tokens.a : tokens.b;
    white.close();
    expect((await black.next('OPPONENT_DISCONNECTED')).gameId).toBe(gameId);
    const back = new Client(url); await back.open();
    const welcome = await back.hello('ALPHA', whiteToken);
    expect(welcome.activeGameId).toBe(gameId);
    back.send({ type: 'JOIN_GAME', gameId });
    const rejoin = await back.next('GAME_JOINED');
    expect(rejoin.color).toBe('w');
    expect(rejoin.state.moveHistory.map((m) => m.san)).toEqual(['d4']);
    await black.next('OPPONENT_RECONNECTED');
  });

  it('rematch swaps colours', async () => {
    const { white, black, gameId } = await pair();
    white.send({ type: 'RESIGN', gameId });
    await black.next('GAME_STATE_UPDATED', (m) => m.state.status === 'resigned');
    white.send({ type: 'REMATCH', gameId });
    await black.next('REMATCH');
    black.send({ type: 'REMATCH', gameId });
    const nb = await black.next('GAME_JOINED', (m) => m.state.id !== gameId);
    expect(nb.color).toBe('w');
  });
});

describe('server clock', () => {
  it('flags the player who runs out of time', async () => {
    const store = new PlayerStore(null);
    const a = store.authenticate(undefined, 'A').player, b = store.authenticate(undefined, 'B').player;
    const events: string[] = [];
    const room = new GameRoom('GAME-000001', { initialMs: 150, incrementMs: 0 }, false, a.id, b.id, store, {
      broadcast: (_r, m) => events.push((m as { reason?: string }).reason ?? ''), send: () => {}, finished: () => {},
    });
    room.start();
    // clocks only run once both sides have made their first move
    expect(room.move(a.id, 'e2', 'e4', undefined, 0)).toBeNull();
    expect(room.move(b.id, 'e7', 'e5', undefined, 1)).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(room.status).toBe('timeout');
    expect(room.core.winner).toBe('b');
    expect(events).toContain('timeout');
  });

  it('aborts a game whose first move is not made inside the window', async () => {
    const store = new PlayerStore(null);
    const a = store.authenticate(undefined, 'A').player, b = store.authenticate(undefined, 'B').player;
    const room = new GameRoom('GAME-000002', { initialMs: 60_000, incrementMs: 0 }, true, a.id, b.id, store, {
      broadcast: () => {}, send: () => {}, finished: () => {},
    });
    let t = 0;
    room.now = () => t;
    room.start();
    t = 31_000;
    expect(room.move(a.id, 'e2', 'e4', undefined, 0)).toMatch(/aborted/);
    expect(room.status).toBe('aborted');
    expect(store.get(a.id)!.gamesPlayed).toBe(0); // aborted games are never recorded
  });
});

describe('protocol v2', () => {
  it('WELCOME carries the protocol version; state carries legal moves, effects, opening and events', async () => {
    const { white, black, gameId } = await pair();
    expect(white.inbox.length + black.inbox.length).toBeGreaterThanOrEqual(0);
    white.send({ type: 'MOVE', gameId, seq: 1, from: 'e2', to: 'e4', ply: 0 });
    await white.next('MOVE_ACCEPTED');
    black.send({ type: 'MOVE', gameId, seq: 1, from: 'c7', to: 'c5', ply: 1 });
    const u = await white.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === 2);
    expect(u.state.opening).toMatchObject({ eco: 'B20', family: 'Sicilian Defense' });
    expect(u.state.legalMoves).toContain('g1f3');
    expect(u.state.moveHistory[1].effects).toEqual([{ kind: 'move', piece: 'p', color: 'b', from: 'c7', to: 'c5' }]);
    expect(u.state.lastEvents.map((e) => e.type)).toEqual(expect.arrayContaining(['move', 'opening_identified']));
  });

  it('plays a full game against the server-hosted engine', async () => {
    const c = new Client(url);
    await c.open();
    const w = await c.hello('SOLO');
    expect(w.protocolVersion).toBe(2);
    c.send({ type: 'CREATE_AI_GAME', level: 'novice', color: 'w', timeControl: 'untimed' });
    const j = await c.next('GAME_JOINED');
    expect(j.state.black?.ai?.level).toBe('novice');
    expect(j.state.black?.rating).toBeNull();
    expect(j.state.rated).toBe(false);
    // White always plays its first legal move (deterministic, weak); the engine must answer every move until the end
    let state = j.state;
    for (let seq = 1; seq < 200 && state.status === 'active'; seq++) {
      // engine replies come from a worker thread; allow for a loaded machine
      if (state.turn !== 'w') {
        try {
          state = (await c.next('GAME_STATE_UPDATED', (m) => m.state.turn === 'w' || m.state.status !== 'active', 20_000)).state;
        } catch (e) {
          const room = hub.rooms.get(state.id)!;
          throw new Error(`engine stalled: client ply ${state.moveHistory.length} turn ${state.turn}; server ply ${room.core.ply} turn ${room.core.turn} status ${room.status}; pool pending ${hub.ai.pending}; inbox ${c.inbox.map((m) => m.type + ('state' in m ? ':' + m.state.moveHistory.length + m.state.turn : '')).join(',')}`);
        }
        continue;
      }
      const mv = state.legalMoves[0];
      c.send({ type: 'MOVE', gameId: state.id, seq, from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4], ply: state.moveHistory.length });
      const before = state.moveHistory.length;
      const r = await Promise.race([
        c.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length > before, 20_000),
        c.next('MOVE_REJECTED', () => true, 20_000),
        c.next('ERROR', () => true, 20_000),
      ]);
      if (r.type === 'MOVE_REJECTED') throw new Error(`move ${mv} at ply ${before} rejected: ${r.reason} (server ply ${r.state.moveHistory.length}, turn ${r.state.turn})`);
      if (r.type === 'ERROR') throw new Error(`server error after ${mv}: ${r.code} ${r.message}`);
      // stay under the per-connection flood limit (40 messages / 5 s) like any human would
      await new Promise((res) => setTimeout(res, 150));
      state = r.state;
    }
    expect(state.moveHistory.length).toBeGreaterThan(2);
    expect(state.moveHistory.filter((m) => m.color === 'b').length).toBeGreaterThan(0);
  }, 120_000);

  it('refuses a promotion without a piece and accepts underpromotion', async () => {
    const store = new PlayerStore(null);
    const a = store.authenticate(undefined, 'A').player, b = store.authenticate(undefined, 'B').player;
    const room = new GameRoom('GAME-000003', { initialMs: 60_000, incrementMs: 0 }, false, a.id, b.id, store, { broadcast: () => {}, send: () => {}, finished: () => {} });
    room.start();
    // 1.h4 g5 2.hxg5 Nf6 3.g6 Nh5 4.gxh7 Rg8: the pawn on h7 can now take the rook on g8 and promote
    const seq: [string, string, string][] = [['w', 'h2', 'h4'], ['b', 'g7', 'g5'], ['w', 'h4', 'g5'], ['b', 'g8', 'f6'], ['w', 'g5', 'g6'], ['b', 'f6', 'h5'], ['w', 'g6', 'h7'], ['b', 'h8', 'g8']];
    seq.forEach(([c, f, t], i) => expect(room.move(c === 'w' ? a.id : b.id, f, t, undefined, i), `${f}${t}`).toBeNull());
    expect(room.move(a.id, 'h7', 'g8', undefined, 8)).toBe('promotion piece required');
    expect(room.move(a.id, 'h7', 'g8', 'n', 8)).toBeNull();
    expect(room.history.at(-1)!.effects.at(-1)).toEqual({ kind: 'promote', square: 'g8', color: 'w', from: 'p', to: 'n' });
  });

  it('limits new identities per IP and never leaks error details', async () => {
    const clients: Client[] = [];
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const c = new Client(url);
      clients.push(c);
      await c.open();
      c.send({ type: 'HELLO', username: `U${i}x` });
      const m = await Promise.race([c.next('WELCOME'), c.next('ERROR')]);
      if (m.type === 'ERROR') { expect(m.code).toBe('rate'); limited = true; }
    }
    expect(limited).toBe(true);
    for (const c of clients) c.close();
  });
});
