import fs from 'node:fs';
import nodePath from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { parseClientMessage, ChessRules, PROTOCOL_VERSION, TIME_CONTROLS, isFinished, aiLevelsOffered, isLeagueLevel, moveBudgetMs, LEAGUE_LEVELS, type ClientMessage, type ServerMessage, type TimeControl, type LeagueLevelId } from '@hc/shared';
import { AI_LEVELS, isAiLevel, type AiLevel } from '@hc/engine';
import { PlayerStore } from './players.js';
import { GameRoom, isAiSeat, newGameId, type RoomEvents, type RoomRecord } from './room.js';
import { AiPool } from './aiPool.js';
import { UciLeague, discoverUciEngine, type UciCommand, type LeagueOptions } from './uciEngine.js';

export interface HubOptions {
  allowedOrigins?: string[];
  trustProxy?: boolean;
  /** Required per-connection secret (local core / sidecar mode). Sent as `x-townchess-secret` or `?secret=`. */
  secret?: string;
  /** Directory for the unfinished-game journal (crash recovery). */
  journalDir?: string;
  /**
   * UCI engine for the league (Stockfish) levels. undefined = discover from env TC_STOCKFISH only; null = none.
   * The sidecar passes discoverUciEngine({ dataDir, coreDir }) so engines/ next to the core is found as well.
   */
  uciEngine?: UciCommand | null;
  /** Pool / timeout settings for the league engine processes (tests shorten them). */
  league?: LeagueOptions;
  /** Accept CREATE_AI_GAME.startFen (test-only; the sidecar sets it from TC_ALLOW_START_FEN=1). Default off. */
  allowCustomStart?: boolean;
}

/** Abuse limits. Per IP: concurrent sockets and new identities per minute. AI games: one active per player. */
export const LIMITS = { socketsPerIp: 20, newIdentitiesPerIpPerMinute: 10, aiGamesPerIp: 3, aiQueueMax: 64 };

/** Own-property lookup: `'toString' in TIME_CONTROLS` must not count as a time control. */
const timeControlOf = (key: string): TimeControl | undefined => (Object.hasOwn(TIME_CONTROLS, key) ? TIME_CONTROLS[key] : undefined);
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
  /** League (Stockfish / UCI) engine processes: separate OS processes, one per game in progress. */
  readonly league: UciLeague;
  /** League moves replaced by the house engine (no reply, timeout, crash or a move GameCore rejected). */
  leagueFallbacks = 0;
  /** Minimum engine "thinking" time so moves don't appear instantly (spent on the engine's own clock). */
  aiMinThinkMs = Number(process.env.HC_AI_MIN_THINK_MS ?? 700);

  constructor(server: Server, public players: PlayerStore, path = '/ws', opts: HubOptions = {}) {
    const allowed = opts.allowedOrigins ?? (process.env.HC_ALLOWED_ORIGINS ? process.env.HC_ALLOWED_ORIGINS.split(',') : null);
    this.trustProxy = opts.trustProxy ?? process.env.HC_TRUST_PROXY === '1';
    this.journalDir = opts.journalDir ?? null;
    this.allowCustomStart = opts.allowCustomStart ?? false;
    this.league = new UciLeague(opts.uciEngine === undefined ? discoverUciEngine() : opts.uciEngine, opts.league);
    if (this.league.cmd) console.log(`[hub] league engine: ${this.league.cmd.path}`);
    const secret = opts.secret ? Buffer.from(opts.secret) : null;
    this.wss = new WebSocketServer({
      server, path, maxPayload: 4096,
      verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
        // Browsers always send Origin; native clients (UE) don't. When an allow-list is configured, browser origins must match.
        if (allowed && info.origin && !allowed.includes(info.origin)) return false;
        if (secret) {
          // Local core (sidecar): only the process that launched it knows the per-launch secret.
          const given = Buffer.from(String(info.req.headers['x-townchess-secret'] ?? new URL(info.req.url ?? '/', 'http://x').searchParams.get('secret') ?? ''));
          if (given.length !== secret.length || !timingSafeEqual(given, secret)) return false;
        }
        return true;
      },
    });
    if (this.journalDir) {
      this.restoreJournal();
      this.journalTimer = setInterval(() => this.persistAll(), 5000);
      this.journalTimer.unref();
    }
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
  /** See HubOptions.allowCustomStart. */
  allowCustomStart: boolean;
  private journalDir: string | null;
  private journalTimer: NodeJS.Timeout | null = null;

  // ── journal (local core crash recovery) ──
  private journalFile(id: string) { return nodePath.join(this.journalDir!, `${id}.json`); }

  /**
   * RoomEvents: keep an up-to-date record of every unfinished game; finished games leave the journal.
   * Written to a temp file, fsynced, then renamed over the old record. On Windows the rename can briefly fail while
   * antivirus or the indexer holds the target open (EPERM/EBUSY), so it is retried.
   */
  persist(room: GameRoom) {
    if (!this.journalDir) return;
    const file = this.journalFile(room.id);
    try {
      if (isFinished(room.status)) { fs.rmSync(file, { force: true }); return; }
      fs.mkdirSync(this.journalDir, { recursive: true });
      const tmp = file + '.tmp';
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, JSON.stringify({ ...room.record(), savedAt: Date.now() })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(tmp, file); break; } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1)); // short synchronous backoff
        }
      }
    } catch (e) { console.error('[hub] journal write failed', e); }
  }

  /** Persist every unfinished game (shutdown, and periodically so a crash refunds at most a few seconds). */
  persistAll() {
    for (const r of this.rooms.values()) if (r.status === 'active') this.persist(r);
  }

  private restoreJournal() {
    if (!this.journalDir || !fs.existsSync(this.journalDir)) return;
    for (const f of fs.readdirSync(this.journalDir).filter((x) => x.endsWith('.tmp'))) fs.rmSync(nodePath.join(this.journalDir, f), { force: true });
    for (const f of fs.readdirSync(this.journalDir).filter((x) => x.endsWith('.json'))) {
      try {
        const rec = JSON.parse(fs.readFileSync(nodePath.join(this.journalDir, f), 'utf8')) as RoomRecord;
        const room = GameRoom.fromRecord(rec, this.players, this);
        if (room.status !== 'active') { fs.rmSync(nodePath.join(this.journalDir, f), { force: true }); continue; }
        this.rooms.set(room.id, room);
        for (const id of [room.white, room.black]) if (id && !isAiSeat(id)) this.activeGame.set(id, room.id);
        console.log(`[hub] restored ${room.id} at ply ${room.core.ply}`);
        room.resumeAfterRestore();
      } catch (e) {
        // never retry a broken record on every launch: move it aside for inspection
        console.error(`[hub] could not restore ${f}; moved to journal/corrupt`, e);
        const bad = nodePath.join(this.journalDir, 'corrupt');
        fs.mkdirSync(bad, { recursive: true });
        try { fs.renameSync(nodePath.join(this.journalDir, f), nodePath.join(bad, `${Date.now()}-${f}`)); } catch { /* best effort */ }
      }
    }
  }

  close() {
    if (this.journalTimer) clearInterval(this.journalTimer);
    this.persistAll(); // a clean shutdown keeps every unfinished game, clocks included
    this.ai.close();
    void this.league.close();
    clearInterval(this.matchTimer);
    clearInterval(this.pingTimer);
    for (const r of this.rooms.values()) r.dispose();
    for (const c of this.conns) c.ws.terminate();
    this.wss.close();
  }

  // ── RoomEvents ──
  broadcast(room: GameRoom, msg: ServerMessage) {
    for (const id of [room.white, room.black]) if (id) this.send(id, msg);
  }
  send(playerId: string, msg: ServerMessage) {
    const c = this.socketOf.get(playerId);
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }
  finished(room: GameRoom) {
    this.league.release(room.id);
    for (const id of [room.white, room.black]) if (id && this.activeGame.get(id) === room.id) this.activeGame.delete(id);
    // keep finished rooms briefly for rematch / late reconnects
    setTimeout(() => { if (isFinished(room.status)) { room.dispose(); this.rooms.delete(room.id); } }, 10 * 60_000).unref();
  }

  private reply(c: Conn, msg: ServerMessage) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    // With a trusted proxy, the *rightmost* X-Forwarded-For entry is the one our proxy appended; anything to its left
    // was supplied by the client and is spoofable.
    const fwd = this.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean).pop() ?? '' : '';
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
      // switching identity on an open socket: the identity it carried before is now disconnected
      if (c.playerId && c.playerId !== player.id && this.socketOf.get(c.playerId) === c) {
        this.socketOf.delete(c.playerId);
        const g = this.activeGame.get(c.playerId);
        if (g) this.rooms.get(g)?.disconnect(c.playerId);
      }
      const prev = this.socketOf.get(player.id);
      if (prev && prev !== c) { prev.playerId = null; prev.ws.close(4000, 'replaced'); }
      c.playerId = player.id;
      this.socketOf.set(player.id, c);
      const active = this.activeGame.get(player.id) ?? null;
      this.reply(c, { type: 'WELCOME', protocolVersion: PROTOCOL_VERSION, token, player: { ...this.players.publicOf(player.id)!, gamesPlayed: player.gamesPlayed, wins: player.wins, losses: player.losses, draws: player.draws }, activeGameId: active, aiLevels: aiLevelsOffered(this.league.available) });
      return;
    }
    const pid = c.playerId;
    if (!pid) { this.reply(c, { type: 'ERROR', code: 'auth', message: 'send HELLO first' }); return; }
    const room = 'gameId' in m ? this.rooms.get(m.gameId) : undefined;
    switch (m.type) {
      case 'PING': this.reply(c, { type: 'PONG', t: m.t, serverTime: Date.now() }); break;
      case 'SET_COSMETICS': this.players.setCosmetics(pid, m.cosmetics); break;
      case 'FIND_MATCH': {
        if (!timeControlOf(m.timeControl)) { this.reply(c, { type: 'ERROR', code: 'tc', message: 'unknown time control' }); break; }
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
        const tc = timeControlOf(m.timeControl);
        if (!tc) { this.reply(c, { type: 'ERROR', code: 'tc', message: 'unknown time control' }); break; }
        if (this.activeGame.has(pid)) { this.reply(c, { type: 'ERROR', code: 'busy', message: 'Finish or leave your current game first.' }); break; }
        const r = this.createRoom(tc, false, pid, null, true, m.drawPolicy);
        this.reply(c, { type: 'GAME_JOINED', color: 'w', state: r.dto() });
        break;
      }
      case 'CREATE_AI_GAME': {
        const tc = m.timeControl === 'untimed' ? null : timeControlOf(m.timeControl);
        if (tc === undefined) { this.reply(c, { type: 'ERROR', code: 'tc', message: 'unknown time control' }); break; }
        if (this.activeGame.has(pid)) { this.reply(c, { type: 'ERROR', code: 'busy', message: 'Finish or leave your current game first.' }); break; }
        if (isLeagueLevel(m.level) && !this.league.available) {
          this.reply(c, { type: 'ERROR', code: 'engine_unavailable', message: 'That engine is not installed on this core.' });
          break;
        }
        if (this.aiGamesForIp(c.ip) >= LIMITS.aiGamesPerIp || this.ai.pending >= LIMITS.aiQueueMax
          || (isLeagueLevel(m.level) && this.leagueGamesActive() >= this.league.maxEngines)) {
          this.reply(c, { type: 'ERROR', code: 'busy', message: 'The engine is busy. Try again shortly.' });
          break;
        }
        if (m.startFen !== undefined) {
          if (!this.allowCustomStart) { this.reply(c, { type: 'ERROR', code: 'start_fen_disabled', message: 'Custom start positions are disabled on this core.' }); break; }
          try { new ChessRules(m.startFen); } catch { this.reply(c, { type: 'ERROR', code: 'bad_fen', message: 'invalid start position' }); break; }
        }
        const human = m.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : m.color;
        const bot = `ai:${m.level}`;
        const r = this.createRoom(tc, false, human === 'w' ? pid : bot, human === 'w' ? bot : pid, false, m.drawPolicy, m.startFen);
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
        const nr = room?.rematch(pid, (w, b) => this.createRoom(room.untimed ? null : room.tc, room.rated, w, b, false, room.core.drawPolicy));
        if (nr) {
          for (const id of [nr.white!, nr.black!]) if (!isAiSeat(id)) this.send(id, { type: 'GAME_JOINED', color: nr.colorOf(id)!, state: nr.dto() });
        }
        break;
      }
    }
  }

  private rejoin(pid: string, gameId: string) {
    const r = this.rooms.get(gameId);
    if (!r) { this.activeGame.delete(pid); return; }
    const color = r.colorOf(pid);
    if (!color) { this.activeGame.delete(pid); return; }
    r.reconnect(pid);
    this.send(pid, { type: 'GAME_JOINED', color, state: r.dto() });
  }

  /** `tc` null = untimed. Engine seats (ai:*) are never tracked as active players and games with them are never rated. */
  createRoom(tc: TimeControl | null, rated: boolean, white: string, black: string | null, isPrivate = false, drawPolicy: 'automatic' | 'claim' = 'automatic', startFen?: string): GameRoom {
    let id = newGameId();
    while (this.rooms.has(id)) id = newGameId();
    const withAi = isAiSeat(white) || isAiSeat(black);
    const r = new GameRoom(id, tc ?? UNTIMED, rated && !withAi, white, black, this.players, this, { isPrivate, timeControl: tc, drawPolicy, startFen });
    this.rooms.set(id, r);
    if (!isAiSeat(white)) this.activeGame.set(white, id);
    if (black && !isAiSeat(black)) this.activeGame.set(black, id);
    if (black) r.start();
    return r;
  }

  /** Active engine games whose human player is connected from `ip` (per-IP engine quota). */
  private aiGamesForIp(ip: string): number {
    let n = 0;
    for (const r of this.rooms.values()) {
      if (r.status !== 'active' || !(isAiSeat(r.white) || isAiSeat(r.black))) continue;
      const human = isAiSeat(r.white) ? r.black : r.white;
      if (human && this.socketOf.get(human)?.ip === ip) n++;
    }
    return n;
  }

  /** Active games against a league (UCI) level: each holds one engine process. */
  private leagueGamesActive(): number {
    let n = 0;
    for (const r of this.rooms.values()) {
      if (r.status !== 'active') continue;
      if ([r.white, r.black].some((id) => isAiSeat(id) && isLeagueLevel(id!.slice(3)))) n++;
    }
    return n;
  }

  /** Remaining clock of the side to move (null = untimed) and the minimum display delay that clock can afford. */
  private clockBudget(room: GameRoom): { remaining: number | null; minThink: number } {
    const clock = room.untimed ? null : room.core.clock;
    const remaining = clock ? clock.peek(room.core.turn, room.now()) : null;
    return { remaining, minThink: remaining === null ? this.aiMinThinkMs : Math.min(this.aiMinThinkMs, Math.floor(remaining / 40)) };
  }

  /**
   * RoomEvents: the engine seat must move. League levels ask the UCI engine (separate process); house levels, and any
   * league failure, use the house engine in a worker thread. Either way the move is submitted through the same
   * GameCore validation as a human move. The engine is never asked about a finished position.
   */
  aiToMove(room: GameRoom) {
    if (room.status !== 'active') return;
    const level = room.playerOf(room.core.turn)!.slice(3);
    if (isLeagueLevel(level) && this.league.available) this.leagueMove(room, level);
    else this.houseMove(room, isAiLevel(level) ? level : 'warden');
  }

  private leagueMove(room: GameRoom, level: LeagueLevelId) {
    const ply = room.core.ply;
    const fen = room.core.fen;
    const aiId = room.playerOf(room.core.turn)!;
    if (room.core.legalMovesUci().length === 0) return; // finished position: never sent to the engine
    const { remaining, minThink } = this.clockBudget(room);
    const movetime = moveBudgetMs(LEAGUE_LEVELS[level].movetimeMs, remaining, room.tc.incrementMs, 100);
    const started = Date.now();
    void this.league.bestMove(room.id, level, room.core.startFen, movetime, room.core.movesUci()).then((uci) => {
      const wait = Math.max(0, minThink - (Date.now() - started));
      setTimeout(() => {
        if (room.status !== 'active' || room.core.ply !== ply) return; // game moved on (resign, flag, abort)
        if (!uci) {
          this.leagueFallbacks++;
          console.error(`[hub] league engine gave no move in ${room.id} at ply ${ply} (${level}); house engine moves instead: ${fen}`);
          this.houseMove(room, 'warden');
          return;
        }
        const err = room.move(aiId, uci.slice(0, 2), uci.slice(2, 4), (uci[4] || undefined) as never, ply);
        if (err) {
          this.leagueFallbacks++;
          console.error(`[hub] league engine move ${uci} rejected by GameCore in ${room.id} at ply ${ply} (${err}); house engine moves instead: ${fen}`);
          this.houseMove(room, 'warden');
        }
      }, wait).unref();
    });
  }

  /** House engine in the worker pool. */
  private houseMove(room: GameRoom, level: AiLevel, attempt = 1) {
    const ply = room.core.ply;
    const fen = room.core.fen;
    const aiId = room.playerOf(room.core.turn)!;
    const { maxDepth, timeMs, noise } = AI_LEVELS[level] ?? AI_LEVELS.patient;
    const { remaining, minThink } = this.clockBudget(room);
    const started = Date.now();
    void this.ai.search(fen, { maxDepth, timeMs: moveBudgetMs(timeMs, remaining, room.tc.incrementMs, 100), noise }).then((mv) => {
      const wait = Math.max(0, minThink - (Date.now() - started));
      setTimeout(() => {
        if (room.status !== 'active' || room.core.ply !== ply) return; // game moved on (resign, flag, abort)
        let move = mv;
        if (!move) {
          console.error(`[hub] engine returned no move in ${room.id} at ply ${ply} (attempt ${attempt}): ${fen}`);
          if (attempt < 2) { this.houseMove(room, level, attempt + 1); return; }
          // never leave a human waiting forever: fall back to any legal move
          const any = room.core.legalMovesUci()[0];
          if (!any) return;
          move = { from: any.slice(0, 2), to: any.slice(2, 4), promotion: any[4] };
        }
        const err = room.move(aiId, move.from, move.to, move.promotion as never, ply);
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
