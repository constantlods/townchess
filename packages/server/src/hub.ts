import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { parseClientMessage, TIME_CONTROLS, isFinished, type ClientMessage, type ServerMessage } from '@hc/shared';
import { PlayerStore } from './players.js';
import { GameRoom, newGameId, type RoomEvents } from './room.js';

interface Conn { ws: WebSocket; playerId: string | null; alive: boolean; msgCount: number; windowStart: number }
interface QueueEntry { playerId: string; tc: string; rated: boolean; since: number }

/**
 * Connection hub: authentication, matchmaking, private tables, room routing and reconnection.
 */
export class Hub implements RoomEvents {
  readonly wss: WebSocketServer;
  private conns = new Set<Conn>();
  private socketOf = new Map<string, Conn>();
  readonly rooms = new Map<string, GameRoom>();
  private activeGame = new Map<string, string>(); // playerId -> gameId
  private queue: QueueEntry[] = [];
  private matchTimer: NodeJS.Timeout;
  private pingTimer: NodeJS.Timeout;

  constructor(server: Server, public players: PlayerStore, path = '/ws') {
    this.wss = new WebSocketServer({ server, path, maxPayload: 4096 });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.matchTimer = setInterval(() => this.matchmake(), 1000);
    this.pingTimer = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) { c.ws.terminate(); continue; }
        c.alive = false;
        try { c.ws.ping(); } catch { /* closed */ }
      }
    }, 15000);
  }

  close() {
    clearInterval(this.matchTimer);
    clearInterval(this.pingTimer);
    for (const r of this.rooms.values()) r.dispose();
    for (const c of this.conns) c.ws.terminate();
    this.wss.close();
  }

  // ── RoomEvents ──
  broadcast(room: GameRoom, msg: object) {
    for (const id of [room.white, room.black]) if (id) this.send(id, msg);
  }
  send(playerId: string, msg: object) {
    const c = this.socketOf.get(playerId);
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }
  finished(room: GameRoom) {
    for (const id of [room.white, room.black]) if (id && this.activeGame.get(id) === room.id) this.activeGame.delete(id);
    // keep finished rooms briefly for rematch / late reconnects
    setTimeout(() => { if (isFinished(room.status)) { room.dispose(); this.rooms.delete(room.id); } }, 10 * 60_000).unref();
  }

  private reply(c: Conn, msg: ServerMessage) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private onConnection(ws: WebSocket, _req: IncomingMessage) {
    const c: Conn = { ws, playerId: null, alive: true, msgCount: 0, windowStart: Date.now() };
    this.conns.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data) => {
      // basic flood control: 40 messages / 5 s
      const now = Date.now();
      if (now - c.windowStart > 5000) { c.windowStart = now; c.msgCount = 0; }
      if (++c.msgCount > 40) { this.reply(c, { type: 'ERROR', code: 'rate', message: 'slow down' }); return; }
      const msg = parseClientMessage(String(data));
      if ('error' in msg) { this.reply(c, { type: 'ERROR', code: 'bad_message', message: msg.error }); return; }
      try { this.handle(c, msg); } catch (e) { this.reply(c, { type: 'ERROR', code: 'server', message: String(e) }); }
    });
    ws.on('close', () => {
      this.conns.delete(c);
      if (!c.playerId) return;
      if (this.socketOf.get(c.playerId) === c) {
        this.socketOf.delete(c.playerId);
        this.queue = this.queue.filter((q) => q.playerId !== c.playerId);
        const g = this.activeGame.get(c.playerId);
        if (g) this.rooms.get(g)?.disconnect(c.playerId);
      }
    });
  }

  private handle(c: Conn, m: ClientMessage) {
    if (m.type === 'HELLO') {
      const { player, token } = this.players.authenticate(m.token, m.username);
      if (m.cosmetics) this.players.setCosmetics(player.id, m.cosmetics);
      const prev = this.socketOf.get(player.id);
      if (prev && prev !== c) { prev.playerId = null; prev.ws.close(4000, 'replaced'); }
      c.playerId = player.id;
      this.socketOf.set(player.id, c);
      const active = this.activeGame.get(player.id) ?? null;
      this.reply(c, { type: 'WELCOME', token, player: { ...this.players.publicOf(player.id)!, gamesPlayed: player.gamesPlayed, wins: player.wins, losses: player.losses, draws: player.draws }, activeGameId: active });
      return;
    }
    const pid = c.playerId;
    if (!pid) { this.reply(c, { type: 'ERROR', code: 'auth', message: 'send HELLO first' }); return; }
    const room = 'gameId' in m ? this.rooms.get(m.gameId) : undefined;
    switch (m.type) {
      case 'PING': this.reply(c, { type: 'PONG', t: m.t, serverTime: Date.now() }); break;
      case 'SET_COSMETICS': this.players.setCosmetics(pid, m.cosmetics); break;
      case 'FIND_MATCH': {
        if (!TIME_CONTROLS[m.timeControl]) { this.reply(c, { type: 'ERROR', code: 'tc', message: 'unknown time control' }); break; }
        if (this.activeGame.has(pid)) { this.rejoin(pid, this.activeGame.get(pid)!); break; }
        this.queue = this.queue.filter((q) => q.playerId !== pid);
        this.queue.push({ playerId: pid, tc: m.timeControl, rated: m.rated, since: Date.now() });
        this.reply(c, { type: 'QUEUED', timeControl: m.timeControl, rated: m.rated });
        this.matchmake();
        break;
      }
      case 'CANCEL_MATCH':
        this.queue = this.queue.filter((q) => q.playerId !== pid);
        this.reply(c, { type: 'MATCH_CANCELLED' });
        break;
      case 'CREATE_PRIVATE': {
        if (!TIME_CONTROLS[m.timeControl]) break;
        const r = this.createRoom(TIME_CONTROLS[m.timeControl], false, pid, null, true);
        this.reply(c, { type: 'GAME_JOINED', color: 'w', state: r.dto() });
        break;
      }
      case 'JOIN_GAME': {
        const r = this.rooms.get(m.gameId);
        if (!r) { this.reply(c, { type: 'ERROR', code: 'not_found', message: 'No table with that code.' }); break; }
        const existing = r.colorOf(pid);
        if (existing) { this.rejoin(pid, r.id); break; }
        if (this.activeGame.has(pid)) { this.reply(c, { type: 'ERROR', code: 'busy', message: 'You are already seated at another table.' }); break; }
        const color = r.seat(pid);
        if (!color) { this.reply(c, { type: 'ERROR', code: 'full', message: 'That table is taken.' }); break; }
        this.activeGame.set(pid, r.id);
        this.reply(c, { type: 'GAME_JOINED', color, state: r.dto() });
        this.broadcast(r, { type: 'GAME_STATE_UPDATED', state: r.dto(), reason: 'start' });
        break;
      }
      case 'LEAVE_GAME':
        if (room && room.colorOf(pid)) {
          if (room.status === 'waiting') room.finish('abandoned', null, 'left');
          else if (room.status === 'active') room.resign(pid);
          this.activeGame.delete(pid);
        }
        break;
      case 'MOVE': {
        if (!room) { this.reply(c, { type: 'ERROR', code: 'not_found', message: 'no such game' }); break; }
        const err = room.move(pid, m.from, m.to, m.promotion, m.ply);
        if (err) this.reply(c, { type: 'MOVE_REJECTED', seq: m.seq, gameId: room.id, reason: err, state: room.dto() });
        else this.reply(c, { type: 'MOVE_ACCEPTED', seq: m.seq, gameId: room.id });
        break;
      }
      case 'DRAW_OFFER': room?.offerDraw(pid); break;
      case 'DRAW_ACCEPT': room?.acceptDraw(pid); break;
      case 'DRAW_DECLINE': room?.declineDraw(pid); break;
      case 'RESIGN': room?.resign(pid); break;
      case 'REMATCH': {
        const nr = room?.rematch(pid, (w, b) => this.createRoom(room.tc, room.rated, w, b));
        if (nr) {
          for (const id of [nr.white!, nr.black!]) this.send(id, { type: 'GAME_JOINED', color: nr.colorOf(id), state: nr.dto() });
        }
        break;
      }
    }
  }

  private rejoin(pid: string, gameId: string) {
    const r = this.rooms.get(gameId);
    if (!r) { this.activeGame.delete(pid); return; }
    r.reconnect(pid);
    this.send(pid, { type: 'GAME_JOINED', color: r.colorOf(pid), state: r.dto() });
  }

  createRoom(tc: typeof TIME_CONTROLS[string], rated: boolean, white: string, black: string | null, isPrivate = false): GameRoom {
    let id = newGameId();
    while (this.rooms.has(id)) id = newGameId();
    const r = new GameRoom(id, tc, rated, white, black, this.players, this, isPrivate);
    this.rooms.set(id, r);
    this.activeGame.set(white, id);
    if (black) { this.activeGame.set(black, id); r.start(); }
    return r;
  }

  /** Pair waiting players. Casual: first come. Rated: rating window widens with waiting time. */
  matchmake() {
    const now = Date.now();
    const used = new Set<string>();
    for (const a of this.queue) {
      if (used.has(a.playerId)) continue;
      const ra = this.players.get(a.playerId)?.rating ?? 1200;
      const windowA = 100 + (now - a.since) / 1000 * 25;
      let best: QueueEntry | null = null, bestDiff = Infinity;
      for (const b of this.queue) {
        if (b === a || used.has(b.playerId) || b.tc !== a.tc || b.rated !== a.rated) continue;
        const diff = Math.abs(ra - (this.players.get(b.playerId)?.rating ?? 1200));
        const windowB = 100 + (now - b.since) / 1000 * 25;
        if (a.rated && diff > Math.max(windowA, windowB)) continue;
        if (diff < bestDiff) { best = b; bestDiff = diff; }
      }
      if (!best) continue;
      used.add(a.playerId); used.add(best.playerId);
      const [w, b] = Math.random() < 0.5 ? [a.playerId, best.playerId] : [best.playerId, a.playerId];
      const room = this.createRoom(TIME_CONTROLS[a.tc], a.rated, w, b);
      this.send(w, { type: 'GAME_JOINED', color: 'w', state: room.dto() });
      this.send(b, { type: 'GAME_JOINED', color: 'b', state: room.dto() });
    }
    if (used.size) this.queue = this.queue.filter((q) => !used.has(q.playerId));
  }
}
