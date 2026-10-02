import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Hub } from '../src/hub';
import { PlayerStore } from '../src/players';
import { GameRoom } from '../src/room';
import type { ServerMessage } from '@hc/shared';

class Client {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      const w = this.waiters.findIndex((x) => x.pred(m));
      if (w >= 0) { const [x] = this.waiters.splice(w, 1); x.res(m); } else this.inbox.push(m);
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    const i = this.inbox.findIndex((m) => m.type === type && pred(m as never));
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as never);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for ' + type)), 4000);
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
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
afterEach(() => { hub.close(); server.close(); });

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
    await new Promise((r) => setTimeout(r, 300));
    expect(room.status).toBe('timeout');
    expect(room.winner).toBe('b');
    expect(events).toContain('timeout');
  });
});
