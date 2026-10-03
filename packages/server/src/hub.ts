import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { parseClientMessage, PROTOCOL_VERSION, TIME_CONTROLS, isFinished, type ClientMessage, type ServerMessage, type TimeControl } from '@hc/shared';
import { AI_LEVELS, type AiLevel } from '@hc/engine';
import { PlayerStore } from './players.js';
import { GameRoom, isAiSeat, newGameId, type RoomEvents } from './room.js';
import { AiPool } from './aiPool.js';

/** Abuse limits. Per IP: concurrent sockets and new identities per minute. AI games: one active per player. */
export const LIMITS = { socketsPerIp: 20, newIdentitiesPerIpPerMinute: 10 };
const UNTIMED: TimeControl = { initialMs: 0, incrementMs: 0 };

interface Conn { ws: WebSocket; ip: string; playerId: string | null; alive: boolean; msgCount: number; windowStart: number }
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
  private socketsByIp = new Map<string, number>();
  private identitiesByIp = new Map<string, number[]>();
  readonly ai = new AiPool();
  /** Minimum engine "thinking" time so moves don't appear instantly (spent on the engine's own clock). */
  aiMinThinkMs = Number(process.env.HC_AI_MIN_THINK_MS ?? 700);

  constructor(server: Server, public players: PlayerStore, path = '/ws', opts: { allowedOrigins?: string[]; trustProxy?: boolean } = {}) {
    const allowed = opts.allowedOrigins ?? (process.env.HC_ALLOWED_ORIGINS ? process.env.HC_ALLOWED_ORIGINS.split(',') : null);
    this.trustProxy = opts.trustProxy ?? process.env.HC_TRUST_PROXY === '1';
    this.wss = new WebSocketServer({
      server, path, maxPayload: 4096,
      // Browsers always send Origin; native clients (UE) don't. When an allow-list is configured, browser origins must match.
      verifyClient: allowed ? ({ origin }: { origin?: string }) => !origin || allowed.includes(origin) : undefined,
    });
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

  private trustProxy: boolean;

  close() {
    this.ai.close();
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

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const fwd = this.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const ip = fwd || req.socket.remoteAddress || 'unknown';
    const open = this.socketsByIp.get(ip) ?? 0;
    if (open >= LIMITS.socketsPerIp) { ws.close(4029, 'too many connections'); return; }
    this.socketsByIp.set(ip, open + 1);
    const c: Conn = { ws, ip, playerId: null, alive: true, msgCount: 0, windowStart: Date.now() };
    this.conns.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data) => {
      // basic flood control: 40 messages / 5 s
      const now = Date.now();
      if (now - c.windowStart > 5000) { c.windowStart = now; c.msgCount = 0; }
      if (++c.msgCount > 40) { this.reply(c, { type: 'ERROR', code: 'rate', message: 'slow down' }); return; }
      const msg = parseClientMessage(String(data));
      if ('error' in msg) { this.reply(c, { type: 'ERROR', code: 'bad_message', message: msg.error }); return; }
      try { this.handle(c, msg); } catch (e) {
        console.error('[hub] handler error', e); // details stay in the server log, never on the wire
        this.reply(c, { type: 'ERROR', code: 'server', message: 'internal error' });
      }
    });
    ws.on('close', () => {
      this.conns.delete(c);
      const n = (this.socketsByIp.get(c.ip) ?? 1) - 1;
      if (n <= 0) this.socketsByIp.delete(c.ip); else this.socketsByIp.set(c.ip, n);
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
      const resuming = !!m.token && this.players.hasToken(m.token);
      if (!resuming) {
        const now = Date.now();
        const recent = (this.identitiesByIp.get(c.ip) ?? []).filter((t) => now - t < 60_000);
        if (recent.length >= LIMITS.newIdentitiesPerIpPerMinute) { this.reply(c, { type: 'ERROR', code: 'rate', message: 'too many new identities' }); return; }
        recent.push(now);
        this.identitiesByIp.set(c.ip, recent);
      }
      const { player, token } = this.players.authenticate(m.token, m.username);
      if (m.cosmetics) this.players.setCosmetics(player.id, m.cosmetics);
      const prev = this.socketOf.get(player.id);
      if (prev && prev !== c) { prev.playerId = null; prev.ws.close(4000, 'replaced'); }
      c.playerId = player.id;
      this.socketOf.set(player.id, c);
      const active = this.activeGame.get(player.id) ?? null;
      this.reply(c, { type: 'WELCOME', protocolVersion: PROTOCOL_VERSION, token, player: { ...this.players.publicOf(player.id)!, gamesPlayed: player.gamesPlayed, wins: player.wins, losses: player.losses, draws: player.draws }, activeGameId: active });
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
      case 'CREATE_AI_GAME': {
        const tc = m.timeControl === 'untimed' ? null : TIME_CONTROLS[m.timeControl];
        if (tc === undefined) { this.reply(c, { type: 'ERROR', code: 'tc', message: 'unknown time control' }); break; }
        if (this.activeGame.has(pid)) { this.reply(c, { type: 'ERROR', code: 'busy', message: 'Finish or leave your current game first.' }); break; }
        const human = m.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : m.color;
        const bot = `ai:${m.level}`;
        const r = this.createRoom(tc, false, human === 'w' ? pid : bot, human === 'w' ? bot : pid);
        this.reply(c, { type: 'GAME_JOINED', color: human, state: r.dto() });
        break;
      }
      case 'CLAIM_DRAW': {
        if (!room) { this.reply(c, { type: 'ERROR', code: 'not_found', message: 'no such game' }); break; }
        const err = room.claimDraw(pid, m.intended);
        if (err) this.reply(c, { type: 'ERROR', code: 'claim_rejected', message: err });
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
          if (room.status === 'waiting') room.leaveWaiting();
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
        // a player already seated elsewhere cannot be pulled into a rematch
        if (room && [room.white, room.black].some((id) => id && !isAiSeat(id) && this.activeGame.has(id) && this.activeGame.get(id) !== room.id)) {
          this.reply(c, { type: 'ERROR', code: 'busy', message: 'Your opponent is already at another table.' });
          break;
        }
        const nr = room?.rematch(pid, (w, b) => this.createRoom(room.untimed ? null : room.tc, room.rated, w, b));
        if (nr) {
          for (const id of [nr.white!, nr.black!]) if (!isAiSeat(id)) this.send(id, { type: 'GAME_JOINED', color: nr.colorOf(id), state: nr.dto() });
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

  /** `tc` null = untimed. Engine seats (ai:*) are never tracked as active players and games with them are never rated. */
  createRoom(tc: TimeControl | null, rated: boolean, white: string, black: string | null, isPrivate = false): GameRoom {
    let id = newGameId();
    while (this.rooms.has(id)) id = newGameId();
    const withAi = isAiSeat(white) || isAiSeat(black);
    const r = new GameRoom(id, tc ?? UNTIMED, rated && !withAi, white, black, this.players, this, { isPrivate, timeControl: tc });
    this.rooms.set(id, r);
    if (!isAiSeat(white)) this.activeGame.set(white, id);
    if (black && !isAiSeat(black)) this.activeGame.set(black, id);
    if (black) r.start();
    return r;
  }

  /** RoomEvents: search for the engine seat off the event loop, then submit through the same validation as a human. */
  aiToMove(room: GameRoom) {
    const ply = room.core.ply;
    const fen = room.core.fen;
    const aiId = room.playerOf(room.core.turn)!;
    const level = aiId.split(':')[1] as AiLevel;
    const { maxDepth, timeMs, noise } = AI_LEVELS[level] ?? AI_LEVELS.patient;
    const started = Date.now();
    void this.ai.search(fen, { maxDepth, timeMs, noise }).then((mv) => {
      const wait = Math.max(0, this.aiMinThinkMs - (Date.now() - started));
      setTimeout(() => {
        if (room.status !== 'active' || room.core.ply !== ply) return; // game moved on (resign, flag, abort)
        if (!mv) { console.error(`[hub] engine returned no move in ${room.id} at ply ${ply}: ${fen}`); return; }
        const err = room.move(aiId, mv.from, mv.to, mv.promotion as never, ply);
        if (err) console.error(`[hub] engine move rejected in ${room.id}: ${err}`);
      }, wait).unref();
    });
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
