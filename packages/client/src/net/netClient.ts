import type { Color, Cosmetics, GameStateDTO, Promotion, ServerMessage, Square, ClientMessage } from '@hc/shared';
import type { Session, SessionEvent, SessionState } from '../game/session';
import type { Settings } from '../settings';

const TOKEN_KEY = 'horror-chess.token';

function toState(d: GameStateDTO, prev?: SessionState): SessionState {
  return {
    id: d.id, fen: d.fen, turn: d.turn, history: d.moveHistory, status: d.status, winner: d.winner,
    white: d.white, black: d.black, timeControl: d.timeControl,
    clocks: { w: d.whiteClockMs, b: d.blackClockMs }, sampledAt: performance.now(),
    running: d.status === 'active' ? d.turn : null,
    drawOfferBy: d.drawOfferBy, rematchOfferBy: d.rematchOfferBy, rated: d.rated,
    opponentDisconnected: prev?.opponentDisconnected ?? false,
  };
}

/** A game whose authority is the server. Only sends requests; renders what the server decides. */
export class NetSession implements Session {
  readonly kind = 'network' as const;
  state: SessionState;
  private listeners = new Set<(e: SessionEvent) => void>();
  private seq = 0;
  disposed = false;

  constructor(public color: Color, dto: GameStateDTO, private send: (m: ClientMessage) => void) {
    this.state = toState(dto);
    this.state.opponentDisconnected = dto.disconnected.includes(color === 'w' ? 'b' : 'w');
  }

  on(fn: (e: SessionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e: SessionEvent) { for (const l of this.listeners) l(e); }

  /** Apply an authoritative state; emits moves the client hasn't shown yet. */
  apply(dto: GameStateDTO, reason: string) {
    const prev = this.state;
    const next = toState(dto, prev);
    next.opponentDisconnected = dto.disconnected.includes(this.color === 'w' ? 'b' : 'w');
    this.state = next;
    const known = prev.history.length;
    if (dto.moveHistory.length > known && dto.moveHistory.length - known <= 2 && prev.id === dto.id) {
      for (const m of dto.moveHistory.slice(known)) this.emit({ type: 'move', move: m, state: next, mine: m.color === this.color });
      if (dto.status !== 'active') this.emit({ type: 'state', state: next, reason });
    } else if (dto.moveHistory.length !== known) {
      // resynchronise (e.g. after reconnecting): treat as a fresh position
      this.emit({ type: 'newGame', state: next, color: this.color });
    } else {
      this.emit({ type: 'state', state: next, reason });
    }
  }

  submitMove(from: Square, to: Square, promotion?: Promotion) {
    this.send({ type: 'MOVE', gameId: this.state.id, seq: ++this.seq, from, to, promotion, ply: this.state.history.length });
  }
  offerDraw() { this.send({ type: 'DRAW_OFFER', gameId: this.state.id }); this.emit({ type: 'notice', text: 'Draw offered.' }); }
  acceptDraw() { this.send({ type: 'DRAW_ACCEPT', gameId: this.state.id }); }
  declineDraw() { this.send({ type: 'DRAW_DECLINE', gameId: this.state.id }); }
  resign() { this.send({ type: 'RESIGN', gameId: this.state.id }); }
  rematch() { this.send({ type: 'REMATCH', gameId: this.state.id }); }
  tick() { /* the server owns the clock and flag fall */ }
  dispose() {
    if (!this.disposed && this.state.status === 'active') { /* leaving mid-game: keep the seat; the server's grace period applies */ }
    this.disposed = true;
    this.listeners.clear();
  }
}

export interface NetCallbacks {
  onSession(s: NetSession): void;
  onStatus(text: string): void;
  onQueued(text: string): void;
}

/** WebSocket connection with token identity and automatic reconnection. */
export class NetClient {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  session: NetSession | null = null;
  private pendingPrivate: string | null = null;
  private retry = 0;
  private wantOpen = false;
  me: { id: string; rating: number } | null = null;

  constructor(private settings: Settings, private cb: NetCallbacks) {}

  private url() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect(): Promise<void> {
    if (this.ready && this.ws && this.ws.readyState <= 1) return this.ready;
    this.wantOpen = true;
    this.ready = new Promise((resolve, reject) => {
      let welcomed = false;
      const ws = new WebSocket(this.url());
      this.ws = ws;
      const timer = setTimeout(() => { if (!welcomed) { ws.close(); reject(new Error('timeout')); } }, 5000);
      ws.onopen = () => {
        let token: string | undefined;
        try { token = localStorage.getItem(TOKEN_KEY) ?? undefined; } catch { /* no storage */ }
        this.raw({ type: 'HELLO', token, username: this.settings.username, cosmetics: this.settings.cosmetics });
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as ServerMessage;
        if (m.type === 'WELCOME') {
          welcomed = true; clearTimeout(timer); this.retry = 0;
          try { localStorage.setItem(TOKEN_KEY, m.token); } catch { /* ignore */ }
          this.me = { id: m.player.id, rating: m.player.rating };
          // reconnect: resume the game we were seated at
          const gid = this.session?.state.id ?? m.activeGameId;
          if (gid) this.raw({ type: 'JOIN_GAME', gameId: gid });
          resolve();
          return;
        }
        this.onMessage(m);
      };
      ws.onerror = () => { if (!welcomed) { clearTimeout(timer); reject(new Error('connect failed')); } };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!welcomed) return;
        this.ready = null;
        if (this.session && !this.session.disposed) this.session.emit({ type: 'notice', text: 'Connection lost. Reconnecting…' });
        if (this.wantOpen) {
          const delay = Math.min(8000, 500 * 2 ** this.retry++);
          setTimeout(() => this.connect().catch(() => { /* retried by onclose */ }), delay);
        }
      };
    });
    return this.ready;
  }

  private raw(m: ClientMessage) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private onMessage(m: ServerMessage) {
    const s = this.session;
    switch (m.type) {
      case 'QUEUED': this.cb.onQueued(`Searching for an opponent (${m.timeControl}${m.rated ? ', rated' : ''})…`); break;
      case 'MATCH_CANCELLED': break;
      case 'GAME_JOINED':
        if (s && s.state.id === m.state.id && !s.disposed) { s.apply(m.state, 'rejoin'); s.emit({ type: 'notice', text: 'Reconnected.' }); break; }
        if (m.state.status === 'waiting') {
          this.pendingPrivate = m.state.id;
          this.cb.onQueued(`Table <span class="code">${m.state.id}</span><br>Share this code. Waiting for your opponent…`);
          break;
        }
        this.startSession(m.color, m.state);
        break;
      case 'GAME_STATE_UPDATED':
        if (this.pendingPrivate === m.state.id && m.state.status === 'active') {
          this.pendingPrivate = null;
          const color: Color = m.state.white?.id === this.me?.id ? 'w' : 'b';
          this.startSession(color, m.state);
        } else if (s && s.state.id === m.state.id) s.apply(m.state, m.reason);
        break;
      case 'MOVE_REJECTED':
        if (s && s.state.id === m.gameId) { s.apply(m.state, 'rejected'); s.emit({ type: 'rejected', reason: m.reason, state: s.state }); }
        break;
      case 'DRAW_OFFER': if (s && s.state.id === m.gameId) s.emit({ type: 'drawOffer', by: m.by }); break;
      case 'REMATCH': if (s && s.state.id === m.gameId) s.emit({ type: 'rematchOffer', by: m.by }); break;
      case 'OPPONENT_DISCONNECTED': if (s) { s.state.opponentDisconnected = true; s.emit({ type: 'notice', text: `Opponent disconnected. They have ${Math.round(m.graceMs / 1000)} s to return.` }); s.emit({ type: 'state', state: s.state, reason: 'disconnect' }); } break;
      case 'OPPONENT_RECONNECTED': if (s) { s.state.opponentDisconnected = false; s.emit({ type: 'notice', text: 'Opponent reconnected.' }); s.emit({ type: 'state', state: s.state, reason: 'reconnect' }); } break;
      case 'ERROR': this.cb.onStatus(m.message); if (s) s.emit({ type: 'notice', text: m.message }); break;
      default: break;
    }
  }

  private startSession(color: Color, state: GameStateDTO) {
    const session = new NetSession(color, state, (msg) => this.raw(msg));
    this.session = session;
    this.cb.onSession(session);
    session.emit({ type: 'newGame', state: session.state, color });
  }

  findMatch(tc: string, rated: boolean) { this.raw({ type: 'FIND_MATCH', timeControl: tc, rated }); }
  cancel() {
    this.raw({ type: 'CANCEL_MATCH' });
    if (this.pendingPrivate) { this.raw({ type: 'LEAVE_GAME', gameId: this.pendingPrivate }); this.pendingPrivate = null; }
  }
  createPrivate(tc: string) { this.raw({ type: 'CREATE_PRIVATE', timeControl: tc }); }
  joinGame(code: string) {
    if (!/^GAME-[0-9A-F]{6}$/.test(code)) { this.cb.onStatus('Codes look like GAME-8F3A21.'); return; }
    this.raw({ type: 'JOIN_GAME', gameId: code });
  }
  setCosmetics(c: Cosmetics) { this.raw({ type: 'SET_COSMETICS', cosmetics: c }); }
  leave() {
    if (this.session && this.session.state.status === 'active') this.raw({ type: 'LEAVE_GAME', gameId: this.session.state.id });
    this.session = null;
  }
}
